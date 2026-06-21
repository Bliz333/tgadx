import type { Env, TgEntity, TgMessage, TgUpdate, TgCallbackQuery, UserRecord } from './types';
import { classify } from './ai';
import {
  dbUserGet,
  dbUserGetOrCreate,
  dbUserUpdate,
  dbUserDelete,
  dbTopicUserGet,
  listUsers,
  getConfig,
  getSpamTopicId,
  setSpamTopicId,
  clearSpamTopicId,
} from './db';
import { sendMessage, copyMessage, createForumTopic, deleteForumTopic, answerCallbackQuery } from './telegram';
import { startVerification, remindVerification, handleVerifyCallback } from './verify';
import { applyKeywordBlock, applyContentFilter, applyAutoReply } from './filters';
import { buildInfoCard, getInfoCardButtons, displayNameOf, handleCardCallback } from './cards';
import { handleAdminConfigStart, handleAdminConfigInput, handleConfigCallback } from './menu';

function displayName(msg: TgMessage): string {
  return msg.from ? displayNameOf(msg.from) : 'Unknown';
}

function isServiceMessage(msg: TgMessage): boolean {
  return Boolean(
    msg.forum_topic_created || msg.forum_topic_closed || msg.forum_topic_edited || msg.forum_topic_reopened,
  );
}

// 正文 + 隐藏在实体里的链接/@提及 + 是否转发，整理成给 AI 判定的文本。
function extractContent(msg: TgMessage): string {
  const parts: string[] = [];
  if (msg.text) parts.push(msg.text);
  if (msg.caption) parts.push(msg.caption);
  const baseText = msg.text || msg.caption || '';
  const ents: TgEntity[] = [...(msg.entities || []), ...(msg.caption_entities || [])];
  const links: string[] = [];
  for (const e of ents) {
    if (e.type === 'text_link' && e.url) links.push(e.url);
    else if (e.type === 'url' || e.type === 'mention') links.push(baseText.slice(e.offset, e.offset + e.length));
  }
  if (links.length) parts.push('消息中的链接/提及: ' + links.join(' '));
  if (msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name) {
    parts.push('[这是一条转发消息]');
  }
  return parts.join('\n').trim();
}

const SIX_HOURS = 6 * 3600 * 1000;

// 本地强规则预筛：命中"明显广告特征"直接判广告，不调 AI（省钱 + 防 AI 提示注入绕过）
function looksObviouslySpam(text: string): boolean {
  const t = text || '';
  if (/t\.me\/[a-z0-9_]*bot\b/i.test(t)) return true; // t.me/xxxbot 引流到其他机器人
  if (/[?&]start=/i.test(t)) return true; // 带 ?start= 推广码
  return false;
}

export async function handleUpdate(update: TgUpdate, env: Env): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  if (isServiceMessage(msg)) return;

  const adminGroupId = Number(env.ADMIN_GROUP_ID);
  const adminUserId = Number(env.ADMIN_USER_ID);

  if (msg.chat.id === adminGroupId) {
    await handleAdminGroup(env, msg);
    return;
  }

  if (msg.chat.type === 'private') {
    if (msg.from.id === adminUserId) {
      await handleAdminPrivate(env, msg);
      return;
    }
    await handleInbound(env, msg);
  }
}

// 管理员私聊 bot：配置菜单 / 输入态
async function handleAdminPrivate(env: Env, msg: TgMessage): Promise<void> {
  const text = msg.text?.trim() ?? '';
  if (text === '/start' || text === '/help') {
    await handleAdminConfigStart(env, msg.from!.id);
    return;
  }
  // 处于某项配置输入态时，消费这条文本
  await handleAdminConfigInput(env, msg.from!.id, msg.text ?? '');
}

// 回调路由
async function handleCallback(env: Env, cb: TgCallbackQuery): Promise<void> {
  // 真人验证按钮：陌生人点击，必须在“仅管理员”校验之前放行
  if ((cb.data || '').startsWith('vrf:')) {
    await handleVerifyCallback(env, cb);
    return;
  }
  // 以下（配置菜单 + 资料卡按钮）仅最高管理员可操作
  if (Number(cb.from.id) !== Number(env.ADMIN_USER_ID)) {
    await answerCallbackQuery(env, cb.id, '您无权操作此菜单。', true);
    return;
  }
  if ((cb.data || '').startsWith('config:')) {
    await handleConfigCallback(env, cb);
    return;
  }
  await handleCardCallback(env, cb);
}

// 管理员在话题里回复 / 发命令
async function handleAdminGroup(env: Env, msg: TgMessage): Promise<void> {
  // 只认最高管理员本人：群里其他成员不能发命令、不能借话题冒充你回复
  if (Number(msg.from?.id) !== Number(env.ADMIN_USER_ID)) return;

  const topicId = msg.message_thread_id;
  const text = msg.text?.trim() ?? '';
  const reply = topicId ? { message_thread_id: topicId } : {};

  // /allow <ID>：放行（验证通过 + 信任，之后不再判定、永不自动清理）
  if (text.startsWith('/allow')) {
    const id = Number(text.split(/\s+/)[1]);
    if (!id) return void (await sendMessage(env, env.ADMIN_GROUP_ID, '用法：/allow <用户ID>', reply));
    await allowUser(env, id);
    return;
  }

  // /reset <ID>：重置为新用户，下条重新验证 + AI 判定
  if (text.startsWith('/reset')) {
    const id = Number(text.split(/\s+/)[1]);
    if (!id) return void (await sendMessage(env, env.ADMIN_GROUP_ID, '用法：/reset <用户ID>', reply));
    await dbUserDelete(env, id);
    await sendMessage(env, env.ADMIN_GROUP_ID, `♻️ 已重置用户 ${id}，其下一条消息会重新走验证 + AI 判定。`, reply);
    return;
  }

  // /cleannow：立即按规则清理
  if (text.startsWith('/cleannow')) {
    const n = await runCleanup(env);
    await sendMessage(env, env.ADMIN_GROUP_ID, `🧹 清理完成，删除了 ${n} 项过期记录。`, reply);
    return;
  }

  // /del：删除当前话题
  if (text === '/del') {
    if (!topicId) return void (await sendMessage(env, env.ADMIN_GROUP_ID, '请在要删除的话题里发送 /del。'));
    const spamTopicId = await getSpamTopicId(env);
    const userId = await dbTopicUserGet(env, topicId);
    try {
      await deleteForumTopic(env, env.ADMIN_GROUP_ID, topicId);
    } catch (e) {
      console.error('删除话题失败', e);
    }
    if (userId) await dbUserDelete(env, userId);
    if (spamTopicId && topicId === spamTopicId) await clearSpamTopicId(env);
    return;
  }

  if (!topicId) return; // 非话题内（如 General）忽略
  const spamTopicId = await getSpamTopicId(env);
  if (spamTopicId && topicId === spamTopicId) return; // 广告隔离话题里的消息不转发

  const userId = await dbTopicUserGet(env, topicId);
  if (!userId) return;

  if (text === '/ban' || text === '/unban') {
    await dbUserUpdate(env, userId, { is_blocked: text === '/ban' });
    await sendMessage(env, env.ADMIN_GROUP_ID, text === '/ban' ? '已屏蔽该用户。' : '已解除屏蔽。', reply);
    return;
  }

  // 普通回复 → 标记信任（之后不再判定/不再自动清理）+ 转发给用户
  const rec = await dbUserGet(env, userId);
  if (rec && rec.relay_state === 'pending') {
    await dbUserUpdate(env, userId, { relay_state: 'trusted' });
  }
  try {
    await copyMessage(env, userId, env.ADMIN_GROUP_ID, msg.message_id);
  } catch (e) {
    console.error('转发给用户失败', e);
    await sendMessage(env, env.ADMIN_GROUP_ID, '⚠️ 转发给用户失败（对方可能已停用 bot）。', reply);
  }
}

// 放行某个用户：建正常话题（若无）并标记 verified + trusted
async function allowUser(env: Env, userId: number): Promise<void> {
  const rec = await dbUserGetOrCreate(env, userId);
  if (rec.relay_state === 'trusted' && rec.topic_id) {
    await sendMessage(env, env.ADMIN_GROUP_ID, `用户 ${userId} 已是放行状态。`, {
      message_thread_id: Number(rec.topic_id),
    });
    return;
  }
  let topicId = rec.topic_id ? Number(rec.topic_id) : 0;
  if (!topicId) {
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, `${rec.user_info?.name || '放行用户'} #${userId}`.slice(0, 128));
  }
  await dbUserUpdate(env, userId, {
    topic_id: String(topicId),
    verify_state: 'verified',
    relay_state: 'trusted',
    last_seen: Date.now(),
  });
  await sendMessage(env, env.ADMIN_GROUP_ID, `✅ 已放行用户 ${userId}，其后续消息会进入本话题，你可在此直接回复。`, {
    message_thread_id: topicId,
  });
}

// 陌生人发来的消息（分层：验证 → 关键词/过滤/自动回复 → AI → 中继）
async function handleInbound(env: Env, msg: TgMessage): Promise<void> {
  const userId = msg.from!.id;
  const user = await dbUserGetOrCreate(env, userId);
  const now = Date.now();

  if (user.is_blocked) return;

  const text = msg.text || msg.caption || '';

  // ① 验证门
  const verifyEnabled = (await getConfig(env, 'verify_enabled', 'true')).toLowerCase() === 'true';
  if (verifyEnabled && user.verify_state !== 'verified') {
    if (user.verify_state === 'new') {
      await startVerification(env, userId);
    } else {
      // pending_verification：用户打字而非点按钮 → 重新出题提醒（不中继）
      await remindVerification(env, userId);
    }
    return;
  }

  // ② 内容处理（关键词屏蔽 / 类型过滤 / 自动回复）
  if (await applyKeywordBlock(env, user, text)) return;
  if (await applyContentFilter(env, msg)) return;
  if (await applyAutoReply(env, userId, text)) return;

  // ③ 已信任：免 AI 直接中继
  if (user.relay_state === 'trusted' && user.topic_id) {
    if (now - (user.last_seen || 0) > SIX_HOURS) await dbUserUpdate(env, userId, { last_seen: now });
    await relayToTopic(env, msg, Number(user.topic_id), userId, user.is_muted);
    return;
  }

  // ④ pending / 新用户：本地预筛 → AI 判定
  const content = extractContent(msg);
  const verdict = looksObviouslySpam(content)
    ? { isSpam: true, confidence: 1, reason: '命中明显广告特征（bot 引流/推广码）' }
    : await classify(env, content);
  console.log(`入站判定 user=${userId} relay=${user.relay_state} spam=${verdict.isSpam} 理由=${verdict.reason}`);

  if (verdict.isSpam) {
    const willBlock = env.AUTO_BLOCK !== '0';
    await quarantine(env, msg, verdict.reason, willBlock);
    if (willBlock) await dbUserUpdate(env, userId, { is_blocked: true, last_seen: now });
    return;
  }

  // 正常：确保有话题（带资料卡）并转发；relay_state 保持 pending（等你回复才转 trusted）
  let topicId = user.topic_id ? Number(user.topic_id) : 0;
  if (!topicId) {
    const name = displayName(msg);
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, `${name} #${userId}`.slice(0, 128));
    // 资料卡（带按钮），保存其 message_id 以便后续屏蔽/静音同步刷新
    const card = await sendMessage(env, env.ADMIN_GROUP_ID, buildInfoCard(msg.from!), {
      message_thread_id: topicId,
      parse_mode: 'HTML',
      reply_markup: getInfoCardButtons(userId, false, user.is_muted),
    });
    await sendMessage(
      env,
      env.ADMIN_GROUP_ID,
      `🆕 新联系人已通过验证。AI 判定：正常（${verdict.reason}）\n（你在本话题回复后，对方后续消息将不再判定）`,
      { message_thread_id: topicId },
    );
    await dbUserUpdate(env, userId, {
      topic_id: String(topicId),
      info_card_message_id: String(card.message_id),
      user_info: { name, username: msg.from!.username ? `@${msg.from!.username}` : '无', firstSeen: now },
      last_seen: now,
    });
  } else if (now - (user.last_seen || 0) > SIX_HOURS) {
    await dbUserUpdate(env, userId, { last_seen: now });
  }
  await relayToTopic(env, msg, topicId, userId, user.is_muted);
}

// 把广告消息扔进固定的“🚫 广告拦截”隔离话题（含来源 + 理由 + 原文）
async function quarantine(env: Env, msg: TgMessage, reason: string, blocked: boolean): Promise<void> {
  let topicId = await getSpamTopicId(env);
  if (!topicId) {
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, '🚫 广告拦截');
    await setSpamTopicId(env, topicId);
  }
  const name = displayName(msg);
  const uname = msg.from!.username ? `@${msg.from!.username}` : '（无用户名）';
  const head = blocked ? '🚫 拦截广告（已自动拉黑，后续消息将被忽略）' : '🚫 拦截广告';
  await sendMessage(
    env,
    env.ADMIN_GROUP_ID,
    `${head}\n来自：${name} ${uname}\nID：${msg.from!.id}\n理由：${reason}\n误判？发 /allow ${msg.from!.id} 放行`,
    { message_thread_id: topicId },
  );
  try {
    await copyMessage(env, env.ADMIN_GROUP_ID, msg.chat.id, msg.message_id, { message_thread_id: topicId });
  } catch (e) {
    console.error('转发到广告话题失败', e);
  }
}

// 转发到话题；若话题已被手动删除则自愈（清掉记录，下条消息会自动重建）
async function relayToTopic(
  env: Env,
  msg: TgMessage,
  topicId: number,
  userId: number,
  muted: boolean,
): Promise<void> {
  try {
    await copyMessage(env, env.ADMIN_GROUP_ID, msg.chat.id, msg.message_id, {
      message_thread_id: topicId,
      disable_notification: muted, // 静音用户：仍转发但不提示
    });
  } catch (e: any) {
    const desc = String(e?.message || '');
    if (desc.includes('thread not found') || desc.includes('TOPIC_DELETED') || desc.includes('topic')) {
      console.log(`话题 ${topicId} 已不存在，自愈：清除用户 ${userId} 记录，下条消息将重建话题`);
      await dbUserDelete(env, userId);
    } else {
      console.error('转发到话题失败', e);
    }
  }
}

// 自动清理：① 删除「从没回复过(pending)」且超过 CLEANUP_DAYS 天没新消息的话题；
//          ② 删除超过 90 天没动静的拉黑记录，防数据库无限增长
export async function runCleanup(env: Env): Promise<number> {
  const now = Date.now();
  const days = Number(env.CLEANUP_DAYS || '0');
  const pendingCutoff = days > 0 ? now - days * 86400000 : null;
  const blockedCutoff = now - 90 * 86400000;
  const users = await listUsers(env);
  let n = 0;
  for (const rec of users) {
    const last = rec.last_seen || rec.first_seen || 0;
    const topicId = rec.topic_id ? Number(rec.topic_id) : 0;
    if (!rec.is_blocked && rec.relay_state === 'pending' && pendingCutoff !== null && last < pendingCutoff) {
      if (topicId) {
        try {
          await deleteForumTopic(env, env.ADMIN_GROUP_ID, topicId);
        } catch (e) {
          console.error('删除话题失败', e);
        }
      }
      await dbUserDelete(env, rec.user_id);
      n++;
    } else if (rec.is_blocked && last < blockedCutoff) {
      if (topicId) {
        try {
          await deleteForumTopic(env, env.ADMIN_GROUP_ID, topicId);
        } catch {}
      }
      await dbUserDelete(env, rec.user_id);
      n++;
    }
  }
  console.log(`清理：删除 ${n} 项过期记录（pending 阈值 ${days} 天 / blocked 90 天）`);
  return n;
}
