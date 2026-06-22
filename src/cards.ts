import type { Env, TgUser, TgCallbackQuery, UserRecord, TgInlineKeyboardButton, TgInlineKeyboardMarkup } from './types';
import {
  dbConfigGet,
  dbConfigPut,
  dbConfigDelete,
  dbUserGetOrCreate,
  dbUserUpdate,
} from './db';
import {
  sendMessage,
  createForumTopic,
  editMessageReplyMarkup,
  editMessageText,
  answerCallbackQuery,
  pinChatMessage,
} from './telegram';

export function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function displayNameOf(u: TgUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.username || String(u.id);
}

// 话题顶部资料卡正文（HTML）
export function buildInfoCard(u: TgUser): string {
  const name = displayNameOf(u);
  const username = u.username ? `@${u.username}` : '无';
  return [
    '<b>👤 用户资料卡</b>',
    `• 昵称: ${escapeHtml(name)}`,
    `• 用户名: <code>${escapeHtml(username)}</code>`,
    `• ID: <code>${escapeHtml(u.id)}</code>`,
  ].join('\n');
}

// 资料卡下方按钮（屏蔽/解禁、静音/取消、查看资料、置顶）
// withProfileLink=false 时省去 tg://user 按钮——对方隐私设置会让该按钮触发
// BUTTON_USER_PRIVACY_RESTRICTED 导致整条卡片发送失败，失败时退化用无此按钮的版本重发。
export function getInfoCardButtons(
  userId: string | number,
  isBlocked: boolean,
  isMuted: boolean,
  withProfileLink = true,
): TgInlineKeyboardMarkup {
  const blockAction = isBlocked ? 'unblock' : 'block';
  const blockText = isBlocked ? '✅ 解除屏蔽' : '🚫 屏蔽此人';
  const muteAction = isMuted ? 'unmute' : 'mute';
  const muteText = isMuted ? '🔔 解除静音' : '🔕 静音通知';
  const rows: TgInlineKeyboardButton[][] = [
    [
      { text: blockText, callback_data: `${blockAction}:${userId}` },
      { text: muteText, callback_data: `${muteAction}:${userId}` },
    ],
  ];
  if (withProfileLink) rows.push([{ text: '👤 查看用户资料', url: `tg://user?id=${userId}` }]);
  rows.push([{ text: '📌 置顶此卡片', callback_data: `pin_card:${userId}` }]);
  return { inline_keyboard: rows };
}

// 发资料卡到话题，并把它的 message_id 存库（供后续屏蔽/静音刷新）。
// 容错：若带 tg://user 按钮发送被隐私限制拒绝，自动退化为不带该按钮重发，绝不让卡片失败影响主流程。
export async function sendInfoCard(
  env: Env,
  topicId: number,
  user: TgUser,
  isMuted: boolean,
): Promise<void> {
  const userId = user.id;
  const send = (withLink: boolean) =>
    sendMessage(env, env.ADMIN_GROUP_ID, buildInfoCard(user), {
      message_thread_id: topicId,
      parse_mode: 'HTML',
      reply_markup: getInfoCardButtons(userId, false, isMuted, withLink),
    });
  try {
    const card = await send(true);
    await dbUserUpdate(env, userId, { info_card_message_id: String(card.message_id) });
  } catch (e) {
    console.error('资料卡发送失败（疑似 tg://user 隐私限制），退化为不带资料按钮重发', e);
    try {
      const card = await send(false);
      await dbUserUpdate(env, userId, { info_card_message_id: String(card.message_id) });
    } catch (e2) {
      console.error('资料卡重发仍失败，跳过卡片', e2);
    }
  }
}

// 确保存在「屏蔽与静音名单」汇总话题，返回其 topicId
async function ensureBlockLogTopic(env: Env): Promise<number | null> {
  const key = 'user_block_log_topic_id';
  let id = await dbConfigGet(env, key);
  if (!id) {
    try {
      const topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, '🚫 屏蔽与静音名单');
      id = String(topicId);
      await dbConfigPut(env, key, id);
    } catch (e) {
      console.error('创建屏蔽名单话题失败:', e);
      return null;
    }
  }
  return Number(id);
}

// 同步用户状态到「屏蔽与静音名单」：有记录则编辑，无则发送，话题丢失自动重建
export async function syncToBlockLog(env: Env, user: UserRecord): Promise<void> {
  const logTopicId = await ensureBlockLogTopic(env);
  if (!logTopicId) return;

  const userId = user.user_id;
  const name = user.user_info?.name || userId;
  let statusText = '✅ <b>用户正常（无屏蔽/无静音）</b>';
  if (user.is_blocked) statusText = '🚫 <b>用户被屏蔽</b>';
  else if (user.is_muted) statusText = '🔕 <b>用户被静音</b>';

  const logText =
    `${statusText}\n用户: <a href="tg://user?id=${userId}">${escapeHtml(name)}</a>\nID: <code>${userId}</code>`;
  const markup = getInfoCardButtons(userId, user.is_blocked, user.is_muted);
  if (user.topic_id) {
    const cleanGroupId = env.ADMIN_GROUP_ID.replace(/^-100/, '');
    markup.inline_keyboard.push([
      { text: '💬 跳转到会话窗口', url: `https://t.me/c/${cleanGroupId}/${user.topic_id}` },
    ]);
  }

  // 已有记录 → 尝试编辑
  if (user.block_log_message_id) {
    try {
      await editMessageText(env, env.ADMIN_GROUP_ID, Number(user.block_log_message_id), logText, {
        parse_mode: 'HTML',
        reply_markup: markup,
      });
      return;
    } catch (e) {
      console.warn('编辑屏蔽名单失败，改为发送新消息:', e);
      await dbUserUpdate(env, userId, { block_log_message_id: null });
    }
  }

  // 发送新记录（话题丢失则重建一次）
  const sendNew = async (topicId: number) => {
    const sent = await sendMessage(env, env.ADMIN_GROUP_ID, logText, {
      message_thread_id: topicId,
      parse_mode: 'HTML',
      reply_markup: markup,
    });
    await dbUserUpdate(env, userId, { block_log_message_id: String(sent.message_id) });
  };
  try {
    await sendNew(logTopicId);
  } catch (e: any) {
    const s = String(e?.message || e);
    if (s.includes('thread not found') || s.includes('TOPIC_DELETED') || s.includes('topic')) {
      await dbConfigDelete(env, 'user_block_log_topic_id');
      const newId = await ensureBlockLogTopic(env);
      if (newId) await sendNew(newId);
    } else {
      console.error('写屏蔽名单失败:', e);
    }
  }
}

// 处理资料卡按钮回调（block/unblock/mute/unmute/pin_card）。
// 返回 true 表示已处理。
export async function handleCardCallback(env: Env, cb: TgCallbackQuery): Promise<boolean> {
  const data = cb.data || '';
  const message = cb.message;
  if (!message) return false;
  const [action, targetUserId] = data.split(':');
  if (!['block', 'unblock', 'mute', 'unmute', 'pin_card'].includes(action) || !targetUserId) return false;

  // 仅管理群内有效
  if (String(message.chat.id) !== env.ADMIN_GROUP_ID) {
    await answerCallbackQuery(env, cb.id, '仅在管理群内有效。', true);
    return true;
  }

  const currentTopicId = message.message_thread_id ? String(message.message_thread_id) : null;
  let user = await dbUserGetOrCreate(env, targetUserId);

  // 自动关联当前卡片消息 id（便于后续同步刷新）
  if (user.topic_id === currentTopicId && !user.info_card_message_id) {
    await dbUserUpdate(env, targetUserId, { info_card_message_id: String(message.message_id) });
    user.info_card_message_id = String(message.message_id);
  }
  const blockLogTopicId = await dbConfigGet(env, 'user_block_log_topic_id');
  if (blockLogTopicId === currentTopicId && !user.block_log_message_id) {
    await dbUserUpdate(env, targetUserId, { block_log_message_id: String(message.message_id) });
    user.block_log_message_id = String(message.message_id);
  }

  if (action === 'pin_card') {
    try {
      await pinChatMessage(env, message.chat.id, message.message_id, {
        message_thread_id: currentTopicId ?? undefined,
        disable_notification: true,
      });
      await answerCallbackQuery(env, cb.id, '✅ 已置顶该资料卡。');
    } catch (e: any) {
      await answerCallbackQuery(env, cb.id, `❌ 置顶失败: ${e?.message || e}`, true);
    }
    return true;
  }

  // block / mute 切换
  const isBlockAction = action === 'block' || action === 'unblock';
  const newState = action === 'block' || action === 'mute';
  try {
    await dbUserUpdate(env, targetUserId, isBlockAction ? { is_blocked: newState } : { is_muted: newState });
    user = await dbUserGetOrCreate(env, targetUserId);
    const baseMarkup = getInfoCardButtons(targetUserId, user.is_blocked, user.is_muted);

    // 刷新【当前点击】的这条消息按钮，保留其末尾的「跳转会话」链接（若有）
    const preserved: TgInlineKeyboardMarkup = JSON.parse(JSON.stringify(baseMarkup));
    const origRows = message.reply_markup?.inline_keyboard;
    if (origRows && origRows.length) {
      const lastRow = origRows[origRows.length - 1];
      if (lastRow?.[0]?.url?.includes('t.me/c/')) preserved.inline_keyboard.push(lastRow);
    }
    await editMessageReplyMarkup(env, message.chat.id, message.message_id, preserved);

    const toast = isBlockAction
      ? newState
        ? '🚫 已屏蔽该用户'
        : '✅ 已解除屏蔽'
      : newState
        ? '🔕 已静音通知'
        : '🔔 已恢复通知';
    await answerCallbackQuery(env, cb.id, toast);

    // 同步屏蔽名单
    await syncToBlockLog(env, user);

    // 同步私聊话题资料卡（若不是当前点击的这条）
    if (user.info_card_message_id && String(message.message_id) !== user.info_card_message_id) {
      try {
        await editMessageReplyMarkup(env, env.ADMIN_GROUP_ID, Number(user.info_card_message_id), baseMarkup);
      } catch (e) {
        console.warn('同步私聊资料卡失败:', e);
      }
    }

    // 话题内操作 block 时，补一条文本提示
    if (isBlockAction && currentTopicId && currentTopicId === user.topic_id) {
      const name = user.user_info?.name || targetUserId;
      await sendMessage(
        env,
        message.chat.id,
        newState ? `❌ 用户 [${name}] 已被屏蔽。` : `✅ 用户 [${name}] 已解除屏蔽。`,
        { message_thread_id: Number(currentTopicId) },
      );
    }
  } catch (e: any) {
    console.error(`处理 ${action} 失败:`, e);
    await answerCallbackQuery(env, cb.id, '❌ 操作失败，请重试。', true);
  }
  return true;
}
