import type { Env, TgEntity, TgMessage, TgUpdate } from './types';
import { classify } from './ai';
import {
  getUser,
  setUser,
  deleteUser,
  listUsers,
  getUserIdByTopic,
  setTopicMap,
  deleteTopicMap,
  getSpamTopicId,
  setSpamTopicId,
  clearSpamTopicId,
} from './store';
import { sendMessage, copyMessage, createForumTopic, deleteForumTopic } from './telegram';

function displayName(msg: TgMessage): string {
  const u = msg.from;
  if (!u) return 'Unknown';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.username || String(u.id);
}

function isServiceMessage(msg: TgMessage): boolean {
  return Boolean(
    msg.forum_topic_created ||
      msg.forum_topic_closed ||
      msg.forum_topic_edited ||
      msg.forum_topic_reopened,
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

export async function handleUpdate(update: TgUpdate, env: Env): Promise<void> {
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
    if (msg.from.id === adminUserId) return; // 管理员私聊 bot 本身，忽略
    await handleInbound(env, msg);
  }
}

// 管理员在话题里回复 / 发命令
async function handleAdminGroup(env: Env, msg: TgMessage): Promise<void> {
  const topicId = msg.message_thread_id;
  const text = msg.text?.trim() ?? '';
  const reply = topicId ? { message_thread_id: topicId } : {};

  // /allow <ID>：放行（信任，之后不再判定、永不自动清理）
  if (text.startsWith('/allow')) {
    const id = Number(text.split(/\s+/)[1]);
    if (!id) return void (await sendMessage(env, env.ADMIN_GROUP_ID, '用法：/allow <用户ID>', reply));
    await allowUser(env, id);
    return;
  }

  // /reset <ID>：重置为新用户，下条重新 AI 判定（测试用）
  if (text.startsWith('/reset')) {
    const id = Number(text.split(/\s+/)[1]);
    if (!id) return void (await sendMessage(env, env.ADMIN_GROUP_ID, '用法：/reset <用户ID>', reply));
    const r = await getUser(env, id);
    if (r) await deleteTopicMap(env, r.topicId);
    await deleteUser(env, id);
    await sendMessage(env, env.ADMIN_GROUP_ID, `♻️ 已重置用户 ${id}，其下一条消息会被当作新用户重新 AI 判定。`, reply);
    return;
  }

  // /cleannow：立即按规则清理（删除未回复过、且超过 CLEANUP_DAYS 天没新消息的话题）
  if (text.startsWith('/cleannow')) {
    const n = await runCleanup(env);
    await sendMessage(env, env.ADMIN_GROUP_ID, `🧹 清理完成，删除了 ${n} 个未回复的过期话题。`, reply);
    return;
  }

  // /del：删除当前话题（手动清理一个）
  if (text === '/del') {
    if (!topicId) return void (await sendMessage(env, env.ADMIN_GROUP_ID, '请在要删除的话题里发送 /del。'));
    const spamTopicId = await getSpamTopicId(env);
    const userId = await getUserIdByTopic(env, topicId);
    try {
      await deleteForumTopic(env, env.ADMIN_GROUP_ID, topicId);
    } catch (e) {
      console.error('删除话题失败', e);
    }
    if (userId) {
      await deleteTopicMap(env, topicId);
      await deleteUser(env, userId);
    }
    if (spamTopicId && topicId === spamTopicId) await clearSpamTopicId(env);
    return; // 话题已删，无需回执
  }

  if (!topicId) return; // 非话题内（如 General）忽略
  const spamTopicId = await getSpamTopicId(env);
  if (spamTopicId && topicId === spamTopicId) return; // 广告隔离话题里的消息不转发

  const userId = await getUserIdByTopic(env, topicId);
  if (!userId) return;

  if (text === '/ban' || text === '/unban') {
    const rec = await getUser(env, userId);
    if (rec) {
      rec.status = text === '/ban' ? 'blocked' : 'trusted';
      await setUser(env, userId, rec);
      await sendMessage(env, env.ADMIN_GROUP_ID, text === '/ban' ? '已屏蔽该用户。' : '已解除屏蔽并信任。', reply);
    }
    return;
  }

  // 普通回复 → 标记信任（之后不再判定/不再自动清理）+ 转发给用户
  const rec = await getUser(env, userId);
  if (rec && rec.status === 'pending') {
    rec.status = 'trusted';
    await setUser(env, userId, rec);
  }
  try {
    await copyMessage(env, userId, env.ADMIN_GROUP_ID, msg.message_id);
  } catch (e) {
    console.error('转发给用户失败', e);
    await sendMessage(env, env.ADMIN_GROUP_ID, '⚠️ 转发给用户失败（对方可能已停用 bot）。', reply);
  }
}

// 放行某个用户：建正常话题（若无）并标记 trusted
async function allowUser(env: Env, userId: number): Promise<void> {
  const rec = await getUser(env, userId);
  if (rec?.status === 'trusted') {
    await sendMessage(env, env.ADMIN_GROUP_ID, `用户 ${userId} 已是放行状态。`, { message_thread_id: rec.topicId });
    return;
  }
  let topicId = rec?.topicId;
  if (!topicId) {
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, `${rec?.name || '放行用户'} #${userId}`.slice(0, 128));
    await setTopicMap(env, topicId, userId);
  }
  await setUser(env, userId, {
    topicId,
    status: 'trusted',
    name: rec?.name || String(userId),
    firstSeen: rec?.firstSeen || Date.now(),
    lastSeen: Date.now(),
  });
  await sendMessage(env, env.ADMIN_GROUP_ID, `✅ 已放行用户 ${userId}，其后续消息会进入本话题，你可在此直接回复。`, {
    message_thread_id: topicId,
  });
}

// 陌生人发来的消息
async function handleInbound(env: Env, msg: TgMessage): Promise<void> {
  const userId = msg.from!.id;
  const rec = await getUser(env, userId);

  if (rec?.status === 'blocked') return;

  if (rec?.status === 'trusted') {
    rec.lastSeen = Date.now();
    await setUser(env, userId, rec);
    await relayToTopic(env, msg, rec.topicId, userId);
    return;
  }

  // 新用户 或 pending（你还没回复过他）：每条消息都过 AI 判定
  const content = extractContent(msg);
  const verdict = await classify(env, content);
  console.log(`入站判定 user=${userId} 状态=${rec ? 'pending' : 'new'} spam=${verdict.isSpam} 理由=${verdict.reason} 内容=${JSON.stringify(content).slice(0, 300)}`);

  if (verdict.isSpam) {
    await quarantine(env, msg, verdict.reason);
    return;
  }

  // 正常：确保有话题并转发；状态保持 pending（等你回复才转 trusted）
  let topicId = rec?.topicId;
  if (!topicId) {
    const name = displayName(msg);
    const topicName = `${name} #${userId}`.slice(0, 128);
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, topicName);
    await setTopicMap(env, topicId, userId);
    const uname = msg.from!.username ? `@${msg.from!.username}` : '（无用户名）';
    await sendMessage(
      env,
      env.ADMIN_GROUP_ID,
      `🆕 新联系人\n姓名：${name}\n用户名：${uname}\nID：${userId}\nAI 判定：正常（${verdict.reason}）\n（你在本话题回复后，对方后续消息将不再判定）`,
      { message_thread_id: topicId },
    );
  }
  await setUser(env, userId, {
    topicId,
    status: 'pending',
    name: rec?.name || displayName(msg),
    firstSeen: rec?.firstSeen || Date.now(),
    lastSeen: Date.now(),
  });
  await relayToTopic(env, msg, topicId, userId);
}

// 把广告消息扔进固定的“🚫 广告拦截”隔离话题（含来源 + 理由 + 原文）
async function quarantine(env: Env, msg: TgMessage, reason: string): Promise<void> {
  let topicId = await getSpamTopicId(env);
  if (!topicId) {
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, '🚫 广告拦截');
    await setSpamTopicId(env, topicId);
  }
  const name = displayName(msg);
  const uname = msg.from!.username ? `@${msg.from!.username}` : '（无用户名）';
  await sendMessage(
    env,
    env.ADMIN_GROUP_ID,
    `🚫 拦截广告\n来自：${name} ${uname}\nID：${msg.from!.id}\n理由：${reason}\n误判的话发 /allow ${msg.from!.id} 放行`,
    { message_thread_id: topicId },
  );
  try {
    await copyMessage(env, env.ADMIN_GROUP_ID, msg.chat.id, msg.message_id, { message_thread_id: topicId });
  } catch (e) {
    console.error('转发到广告话题失败', e);
  }
}

// 转发到话题；若话题已被手动删除则自愈（清掉映射，下条消息会自动重建）
async function relayToTopic(env: Env, msg: TgMessage, topicId: number, userId: number): Promise<void> {
  try {
    await copyMessage(env, env.ADMIN_GROUP_ID, msg.chat.id, msg.message_id, { message_thread_id: topicId });
  } catch (e: any) {
    const desc = String(e?.message || '');
    if (desc.includes('thread not found') || desc.includes('TOPIC_DELETED') || desc.includes('topic')) {
      console.log(`话题 ${topicId} 已不存在，自愈：清除用户 ${userId} 记录，下条消息将重建话题`);
      await deleteTopicMap(env, topicId);
      await deleteUser(env, userId);
    } else {
      console.error('转发到话题失败', e);
    }
  }
}

// 自动清理：删除「从没回复过(pending)」且超过 CLEANUP_DAYS 天没新消息的话题
export async function runCleanup(env: Env): Promise<number> {
  const days = Number(env.CLEANUP_DAYS || '0');
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  const users = await listUsers(env);
  let n = 0;
  for (const { userId, rec } of users) {
    if (rec.status === 'pending' && (rec.lastSeen || rec.firstSeen) < cutoff) {
      try {
        await deleteForumTopic(env, env.ADMIN_GROUP_ID, rec.topicId);
      } catch (e) {
        console.error('删除话题失败', e);
      }
      await deleteTopicMap(env, rec.topicId);
      await deleteUser(env, userId);
      n++;
    }
  }
  console.log(`自动清理：删除 ${n} 个未回复的过期话题（阈值 ${days} 天）`);
  return n;
}
