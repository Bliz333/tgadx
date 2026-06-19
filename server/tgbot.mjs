// VPS 版：Node 长轮询的 Telegram 双向中继机器人（AI 防广告 + 话题模式）
// 无需 Cloudflare / 域名 / HTTPS / 数据库。状态存本地 JSON 文件。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_GROUP_ID = Number(process.env.ADMIN_GROUP_ID);
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID);
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';
const AI_API_KEY = process.env.AI_API_KEY;
const STATE_FILE = process.env.STATE_FILE || '/opt/tgadx/state.json';

if (!BOT_TOKEN || !ADMIN_GROUP_ID || !ADMIN_USER_ID || !AI_API_KEY) {
  console.error('缺少环境变量：BOT_TOKEN / ADMIN_GROUP_ID / ADMIN_USER_ID / AI_API_KEY');
  process.exit(1);
}

// ---------- 状态持久化 ----------
// users[userId] = { topicId, status: 'verified'|'blocked', name, firstSeen }
//   verified = 第一条消息被判为正常（或被 /allow 放行），之后消息自由通过
//   blocked  = 被 /ban 屏蔽，消息直接丢弃
// topics[topicId] = userId       话题反查用户
// spamTopicId = number           “🚫 广告拦截”隔离话题的 id
let state = { users: {}, topics: {}, spamTopicId: 0 };
if (existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    console.error('读取状态文件失败，使用空状态', e);
  }
}
state.users ||= {};
state.topics ||= {};
function saveState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.error('保存状态失败', e);
  }
}

// ---------- Telegram ----------
async function tg(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`TG ${method}: ${data.error_code} ${data.description}`);
  return data.result;
}
const sendMessage = (chatId, text, extra = {}) =>
  tg('sendMessage', { chat_id: chatId, text, ...extra });
const copyMessage = (chatId, fromChatId, messageId, extra = {}) =>
  tg('copyMessage', { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...extra });
async function createForumTopic(chatId, name) {
  const r = await tg('createForumTopic', { chat_id: chatId, name });
  return r.message_thread_id;
}

// ---------- AI 判定 ----------
const SYSTEM_PROMPT = `你是一个 Telegram 私聊反垃圾判定器。用户会发来某个陌生人私聊的消息内容（可能包含正文、消息里的链接、@提及、以及是否为转发的标注）。判断它是否属于垃圾消息。
判为垃圾(is_spam=true)的典型特征：
- 引流到其他 Telegram 机器人或群/频道（如 t.me/xxxbot、带 ?start= 推广码的链接、点击某蓝色机器人开始）
- 体育/博彩/彩票/棋牌/娱乐城、刷单返利、代开会员、贷款、色情、加密货币/USDT 套利、点击领取奖励
- 明显的营销推广、群发广告、客服引导话术
正常的问候、咨询、找人办事、自我介绍、日常聊天都不算垃圾。
只输出一个 JSON 对象，不要任何多余文字，格式：
{"is_spam": true 或 false, "confidence": 0到1的小数, "reason": "简短中文理由"}`;

async function classify(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { isSpam: false, reason: '无文本内容，默认放行' };
  try {
    const res = await fetch(AI_BASE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: trimmed.slice(0, 2000) },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' }, // 关闭思考：分类任务更快更省（deepseek-v4-flash 支持）
        temperature: 0,
        max_tokens: 512,
      }),
    });
    if (!res.ok) {
      console.error('AI 请求失败', res.status, await res.text());
      return { isSpam: false, reason: 'AI 请求失败，默认放行' };
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    return { isSpam: Boolean(parsed.is_spam), reason: String(parsed.reason ?? '') };
  } catch (e) {
    console.error('AI 判定异常', e);
    return { isSpam: false, reason: 'AI 异常，默认放行' };
  }
}

// ---------- 业务逻辑 ----------
function displayName(msg) {
  const u = msg.from;
  if (!u) return 'Unknown';
  const n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return n || u.username || String(u.id);
}
function isService(msg) {
  return !!(
    msg.forum_topic_created ||
    msg.forum_topic_closed ||
    msg.forum_topic_edited ||
    msg.forum_topic_reopened
  );
}

// 把消息的正文 + 隐藏在实体里的链接/@提及 + 是否转发，整理成给 AI 判定的文本。
// 广告常把 t.me/xxxbot 之类的链接藏在“超链接实体(text_link)”里，纯 msg.text 看不到。
function extractContent(msg) {
  const parts = [];
  if (msg.text) parts.push(msg.text);
  if (msg.caption) parts.push(msg.caption);
  const baseText = msg.text || msg.caption || '';
  const ents = [...(msg.entities || []), ...(msg.caption_entities || [])];
  const links = [];
  for (const e of ents) {
    if (e.type === 'text_link' && e.url) links.push(e.url);
    else if ((e.type === 'url' || e.type === 'mention') && typeof e.offset === 'number') {
      links.push(baseText.slice(e.offset, e.offset + e.length));
    }
  }
  if (links.length) parts.push('消息中的链接/提及: ' + links.join(' '));
  if (msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name) {
    parts.push('[这是一条转发消息]');
  }
  return parts.join('\n').trim();
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  if (isService(msg)) return;
  if (msg.chat.id === ADMIN_GROUP_ID) return handleAdminGroup(msg);
  if (msg.chat.type === 'private') {
    if (msg.from.id === ADMIN_USER_ID) return; // 管理员私聊 bot 本身，忽略
    return handleInbound(msg);
  }
}

async function handleAdminGroup(msg) {
  const topicId = msg.message_thread_id;
  const text = (msg.text || '').trim();

  // /allow <用户ID>：放行某个被拦截的人（任何话题里都能用，含“广告拦截”话题）
  if (text.startsWith('/allow')) {
    const id = Number(text.split(/\s+/)[1]);
    const reply = topicId ? { message_thread_id: topicId } : {};
    if (!id) {
      await sendMessage(ADMIN_GROUP_ID, '用法：/allow <用户ID>', reply);
      return;
    }
    await allowUser(id);
    return;
  }

  if (!topicId) return; // 非话题内（如 General）忽略
  if (topicId === state.spamTopicId) return; // 广告隔离话题里的消息不转发给任何人

  const userId = state.topics[topicId];
  if (!userId) return;

  if (text === '/ban' || text === '/unban') {
    const rec = state.users[userId];
    if (rec) {
      rec.status = text === '/ban' ? 'blocked' : 'verified';
      saveState();
      await sendMessage(ADMIN_GROUP_ID, text === '/ban' ? '已屏蔽该用户。' : '已解除屏蔽。', {
        message_thread_id: topicId,
      });
    }
    return;
  }

  // 普通回复 → 转发给用户
  try {
    await copyMessage(userId, msg.chat.id, msg.message_id);
  } catch (e) {
    console.error('转发给用户失败', e);
    await sendMessage(ADMIN_GROUP_ID, '⚠️ 转发给用户失败（对方可能已停用 bot）。', {
      message_thread_id: topicId,
    });
  }
}

// 把某个用户放行：建正常话题（若无）并标记 verified
async function allowUser(userId) {
  const rec = state.users[userId];
  if (rec?.status === 'verified') {
    await sendMessage(ADMIN_GROUP_ID, `用户 ${userId} 已是放行状态。`, { message_thread_id: rec.topicId });
    return;
  }
  let topicId = rec?.topicId;
  if (!topicId) {
    topicId = await createForumTopic(ADMIN_GROUP_ID, `${rec?.name || '放行用户'} #${userId}`.slice(0, 128));
    state.topics[topicId] = userId;
  }
  state.users[userId] = {
    topicId,
    status: 'verified',
    name: rec?.name || String(userId),
    firstSeen: rec?.firstSeen || Date.now(),
  };
  saveState();
  await sendMessage(ADMIN_GROUP_ID, `✅ 已放行用户 ${userId}，其后续消息会进入本话题，你可在此直接回复。`, {
    message_thread_id: topicId,
  });
}

async function handleInbound(msg) {
  const userId = msg.from.id;
  const rec = state.users[userId];
  if (rec?.status === 'blocked') return;
  if (rec?.status === 'verified') return relay(msg, rec.topicId);

  // 新用户：判第一条消息（喂入正文 + 链接 + 转发标注）
  const content = extractContent(msg);
  const verdict = await classify(content);
  console.log(`入站判定 user=${userId} spam=${verdict.isSpam} 理由=${verdict.reason} 内容=${JSON.stringify(content).slice(0, 300)}`);
  if (verdict.isSpam) {
    // 广告：不进正常对话，集中扔进“🚫 广告拦截”隔离话题，便于你事后查看/纠错
    await quarantine(msg, verdict);
    return;
  }

  // 正常：在管理群建独立话题并转发
  const name = displayName(msg);
  const topicName = `${name} #${userId}`.slice(0, 128);
  const topicId = await createForumTopic(ADMIN_GROUP_ID, topicName);
  state.topics[topicId] = userId;
  state.users[userId] = { topicId, status: 'verified', name, firstSeen: Date.now() };
  saveState();

  const uname = msg.from.username ? `@${msg.from.username}` : '（无用户名）';
  await sendMessage(
    ADMIN_GROUP_ID,
    `🆕 新联系人\n姓名：${name}\n用户名：${uname}\nID：${userId}\nAI 判定：正常（${verdict.reason}）`,
    { message_thread_id: topicId },
  );
  await relay(msg, topicId);
}

// 把被判为广告的消息扔进固定的“广告拦截”隔离话题（含来源信息 + AI 理由 + 原文）
async function quarantine(msg, verdict) {
  if (!state.spamTopicId) {
    state.spamTopicId = await createForumTopic(ADMIN_GROUP_ID, '🚫 广告拦截');
    saveState();
  }
  const name = displayName(msg);
  const uname = msg.from.username ? `@${msg.from.username}` : '（无用户名）';
  await sendMessage(
    ADMIN_GROUP_ID,
    `🚫 拦截广告\n来自：${name} ${uname}\nID：${msg.from.id}\n理由：${verdict.reason}\n误判的话发 /allow ${msg.from.id} 放行`,
    { message_thread_id: state.spamTopicId },
  );
  try {
    await copyMessage(ADMIN_GROUP_ID, msg.chat.id, msg.message_id, {
      message_thread_id: state.spamTopicId,
    });
  } catch (e) {
    console.error('转发到广告话题失败', e);
  }
}

async function relay(msg, topicId) {
  try {
    await copyMessage(ADMIN_GROUP_ID, msg.chat.id, msg.message_id, { message_thread_id: topicId });
  } catch (e) {
    console.error('转发到话题失败', e);
  }
}

// ---------- 长轮询主循环 ----------
async function main() {
  const me = await tg('getMe');
  console.log(`启动成功：@${me.username} (id=${me.id})`);
  try {
    await tg('deleteWebhook', { drop_pending_updates: false });
  } catch {}
  let offset = 0;
  while (true) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          await handleUpdate(u);
        } catch (e) {
          console.error('处理更新出错', e);
        }
      }
    } catch (e) {
      console.error('拉取更新出错，5 秒后重试：', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
main();
