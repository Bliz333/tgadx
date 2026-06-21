import type { Env, TgCallbackQuery, TgInlineKeyboardMarkup } from './types';
import { getConfig, dbConfigGet, dbConfigPut, dbConfigDelete, dbUserGet, dbUserUpdate } from './db';
import { sendMessage, editMessageText, answerCallbackQuery } from './telegram';

export const DEFAULT_WELCOME = '👋 欢迎！开始聊天前，请先完成一步真人验证。';

// 允许的总作答次数：点错一次还有第二次（换一道题），再错才拦截。
const MAX_ATTEMPTS = 2;

// 出题用的图标池（emoji 当按钮、name 当题面）。点错有第二次机会，所以用易区分的图标。
const ICON_POOL: { e: string; name: string }[] = [
  { e: '🍎', name: '苹果' },
  { e: '🍌', name: '香蕉' },
  { e: '🍇', name: '葡萄' },
  { e: '🍉', name: '西瓜' },
  { e: '🍓', name: '草莓' },
  { e: '🍊', name: '橙子' },
  { e: '🐱', name: '猫' },
  { e: '🐶', name: '狗' },
  { e: '⭐', name: '星星' },
  { e: '❤️', name: '红心' },
  { e: '🌙', name: '月亮' },
  { e: '☀️', name: '太阳' },
];

// 当前挑战存在 config 表（key=vrf:<userId>），值为 JSON：正确 token + 已错次数 + 上一题目标（避免重复）。
const challengeKey = (uid: string | number) => `vrf:${uid}`;
interface Challenge {
  token: string;
  tries: number; // 已经点错的次数
  target: string; // 本题正确图标，用于下一题排除、避免重复
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getChallenge(env: Env, userId: string | number): Promise<Challenge | null> {
  const raw = await dbConfigGet(env, challengeKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Challenge;
  } catch {
    return null;
  }
}

// 生成并发送一道按钮验证题：随机选 N 个图标、随机指定一个为正确项，正确 token + 计数存库。
// tries=已错次数；excludeEmoji=上一题的正确图标（换题时排除，保证“不是同样的问题”）。
async function issueChallenge(
  env: Env,
  userId: string | number,
  tries: number,
  prefix = '',
  excludeEmoji?: string,
): Promise<void> {
  const raw = Number(await getConfig(env, 'verify_options', '4'));
  const count = Math.min(8, Math.max(2, Number.isFinite(raw) ? raw : 4));
  const picked = shuffle(ICON_POOL).slice(0, count);
  let targetIdx = Math.floor(Math.random() * picked.length);
  // 换题时若随机到的目标和上一题相同，挪一个，保证目标图标不同（picked 内图标各不相同）。
  if (excludeEmoji && picked[targetIdx].e === excludeEmoji) {
    targetIdx = (targetIdx + 1) % picked.length;
  }
  const target = picked[targetIdx];

  const buttons = picked.map((p) => ({ e: p.e, token: randToken() }));
  const correctToken = buttons[targetIdx].token;
  await dbConfigPut(env, challengeKey(userId), JSON.stringify({ token: correctToken, tries, target: target.e }));

  const markup: TgInlineKeyboardMarkup = {
    inline_keyboard: chunk(
      buttons.map((b) => ({ text: b.e, callback_data: `vrf:${userId}:${b.token}` })),
      4,
    ),
  };
  const remaining = MAX_ATTEMPTS - tries;
  const tail =
    remaining > 1 ? '⚠️ 点错还有机会，但请看清楚再点。' : '⚠️ 这是最后一次机会，点错将被拦截，请看清楚再点。';
  const text =
    `${prefix}🤖 <b>真人验证</b>\n\n` + `请点击下面的 【${target.e} ${target.name}】 按钮。\n\n` + tail;
  await sendMessage(env, userId, text, { parse_mode: 'HTML', reply_markup: markup });
}

// 首次接触：发欢迎语 + 第一道验证题，置 pending_verification（不建话题、不调 AI）。
export async function startVerification(env: Env, userId: string | number): Promise<void> {
  const welcome = await getConfig(env, 'welcome_msg', DEFAULT_WELCOME);
  await sendMessage(env, userId, welcome);
  await issueChallenge(env, userId, 0);
  await dbUserUpdate(env, userId, { verify_state: 'pending_verification' });
}

// pending 期间用户打字而不是点按钮：重新出一道题并提醒（打字不算错，沿用已错次数）。
export async function remindVerification(env: Env, userId: string | number): Promise<void> {
  const ch = await getChallenge(env, userId);
  await issueChallenge(env, userId, ch?.tries ?? 0, '请用下面的按钮完成验证，不要打字喔～\n\n', ch?.target);
}

// 处理验证按钮回调（陌生人点击，不受“仅管理员”限制）。点对=放行；点错=给第二次机会换题，再错才拦截。
export async function handleVerifyCallback(env: Env, cb: TgCallbackQuery): Promise<void> {
  const [, uidStr, token] = (cb.data || '').split(':');
  // 按钮只属于题面里的那个用户，别人点无效
  if (!uidStr || uidStr !== String(cb.from.id)) {
    await answerCallbackQuery(env, cb.id, '这不是给你的验证。', true);
    return;
  }
  const userId = uidStr;
  const user = await dbUserGet(env, userId);
  if (!user || user.is_blocked || user.verify_state === 'verified') {
    await answerCallbackQuery(env, cb.id, '无需验证。');
    return;
  }

  const ch = await getChallenge(env, userId);
  const msgId = cb.message?.message_id;
  if (!ch) {
    await answerCallbackQuery(env, cb.id, '验证已过期，请重新发条消息获取新题。', true);
    await dbUserUpdate(env, userId, { verify_state: 'new' });
    return;
  }

  // 点对 → 放行
  if (token && token === ch.token) {
    await dbConfigDelete(env, challengeKey(userId));
    await dbUserUpdate(env, userId, { verify_state: 'verified' });
    await answerCallbackQuery(env, cb.id, '🎉 验证通过！');
    if (msgId) await editMessageText(env, userId, msgId, '✅ 验证通过，现在可以开始聊天啦！').catch(() => {});
    return;
  }

  // 点错 → 累加次数
  const tries = ch.tries + 1;
  if (tries >= MAX_ATTEMPTS) {
    // 用完机会，拦截（误触可让对方 /reset 重来或你 /allow 放行）
    await dbConfigDelete(env, challengeKey(userId));
    await dbUserUpdate(env, userId, { is_blocked: true });
    await answerCallbackQuery(env, cb.id, '❌ 验证失败，你已被拦截。', true);
    if (msgId) await editMessageText(env, userId, msgId, '🚫 两次都点错了，已被拦截。').catch(() => {});
    return;
  }
  // 还有机会 → 作废旧题、换一道不同的题
  await answerCallbackQuery(env, cb.id, '❌ 点错啦，再给你一次机会，换道题～', true);
  if (msgId) await editMessageText(env, userId, msgId, '❌ 上一题点错了，请看下面这道新题。').catch(() => {});
  await issueChallenge(env, userId, tries, '', ch.target);
}
