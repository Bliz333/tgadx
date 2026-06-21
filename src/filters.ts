import type { Env, TgMessage, UserRecord, TgEntity } from './types';
import { getConfig, getBlockKeywords, getAutoReplyRules, dbUserUpdate } from './db';
import { sendMessage } from './telegram';

// 关键词屏蔽：命中则 block_count+1 并丢弃；达阈值自动拉黑。
// 返回 true 表示消息已被拦截、应停止后续处理。
export async function applyKeywordBlock(env: Env, user: UserRecord, text: string): Promise<boolean> {
  if (!text) return false;
  const keywords = await getBlockKeywords(env);
  if (keywords.length === 0) return false;
  const threshold = parseInt(await getConfig(env, 'block_threshold', '5'), 10) || 5;
  const userId = user.user_id;

  for (const kw of keywords) {
    let hit = false;
    try {
      hit = new RegExp(kw, 'i').test(text);
    } catch {
      // 无效正则当作普通子串匹配
      hit = text.toLowerCase().includes(kw.toLowerCase());
    }
    if (!hit) continue;

    const count = user.block_count + 1;
    await dbUserUpdate(env, userId, { block_count: count });

    if (count >= threshold) {
      await dbUserUpdate(env, userId, { is_blocked: true });
      await sendMessage(env, userId, `⚠️ 您的消息触发了屏蔽关键词（${count}/${threshold}），此消息未转发。`);
      await sendMessage(env, userId, '❌ 您已多次触发屏蔽关键词，已被自动屏蔽，机器人将不再接收您的消息。');
    } else {
      await sendMessage(env, userId, `⚠️ 您的消息触发了屏蔽关键词（${count}/${threshold}），此消息未转发给对方。`);
    }
    return true;
  }
  return false;
}

function hasLinks(msg: TgMessage): boolean {
  const ents: TgEntity[] = [...(msg.entities || []), ...(msg.caption_entities || [])];
  return ents.some((e) => e.type === 'url' || e.type === 'text_link');
}

// 内容类型过滤：按 8 个开关判断是否放行；被过滤返回 true（已丢弃 + 提示）。
export async function applyContentFilter(env: Env, msg: TgMessage): Promise<boolean> {
  const on = async (key: string) => (await getConfig(env, key, 'true')).toLowerCase() === 'true';
  const f = {
    media: await on('enable_media_forwarding'),
    link: await on('enable_link_forwarding'),
    text: await on('enable_text_forwarding'),
    audio: await on('enable_audio_forwarding'),
    sticker: await on('enable_sticker_forwarding'),
    userFwd: await on('enable_user_forwarding'),
    groupFwd: await on('enable_group_forwarding'),
    channelFwd: await on('enable_channel_forwarding'),
  };

  let blocked = false;
  let reason = '';

  if (msg.forward_from) {
    if (!f.userFwd) ((blocked = true), (reason = '用户转发消息'));
  } else if (msg.forward_from_chat) {
    const type = msg.forward_from_chat.type;
    if (type === 'channel') {
      if (!f.channelFwd) ((blocked = true), (reason = '频道转发消息'));
    } else if (type === 'group' || type === 'supergroup') {
      if (!f.groupFwd) ((blocked = true), (reason = '群组转发消息'));
    }
  } else if (msg.audio || msg.voice) {
    if (!f.audio) ((blocked = true), (reason = '音频/语音消息'));
  } else if (msg.sticker || msg.animation) {
    if (!f.sticker) ((blocked = true), (reason = '贴纸/GIF'));
  } else if (msg.photo || msg.video || msg.document) {
    if (!f.media) ((blocked = true), (reason = '媒体内容（图片/视频/文件）'));
  }

  if (!blocked && hasLinks(msg) && !f.link) {
    blocked = true;
    reason = '包含链接的内容';
  }

  const isPureText =
    !!msg.text &&
    !msg.photo &&
    !msg.video &&
    !msg.document &&
    !msg.sticker &&
    !msg.audio &&
    !msg.voice &&
    !msg.animation &&
    !msg.forward_from &&
    !msg.forward_from_chat;
  if (!blocked && isPureText && !f.text) {
    blocked = true;
    reason = '纯文本内容';
  }

  if (blocked) {
    await sendMessage(env, msg.from!.id, `此消息已被过滤：${reason}。根据设置，此类内容不会转发给对方。`);
    return true;
  }
  return false;
}

// 关键词自动回复：命中则回复并返回 true（停止后续中继）。
export async function applyAutoReply(env: Env, userId: string | number, text: string): Promise<boolean> {
  if (!text) return false;
  const rules = await getAutoReplyRules(env);
  for (const rule of rules) {
    let hit = false;
    try {
      hit = new RegExp(rule.keywords, 'i').test(text);
    } catch {
      hit = text.toLowerCase().includes(rule.keywords.toLowerCase());
    }
    if (hit) {
      await sendMessage(env, userId, `此消息为自动回复\n\n${rule.response}`);
      return true;
    }
  }
  return false;
}
