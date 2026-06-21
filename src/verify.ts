import type { Env, TgCallbackQuery, TgInlineKeyboardMarkup } from './types';
import { getConfig, dbConfigGet, dbConfigPut, dbConfigDelete, dbUserGet, dbUserUpdate } from './db';
import { sendMessage, editMessageText, answerCallbackQuery } from './telegram';

export const DEFAULT_WELCOME = '👋 欢迎！开始聊天前，请先完成一步真人验证。';

// 出题用的图标池（emoji 当按钮、name 当题面）。点错即拦截，所以用易区分的图标。
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

// 当前挑战的正确 token 存在 config 表（key=vrf:<userId>），按钮上只放不透明 token。
const challengeKey = (uid: string | number) => `vrf:${uid}`;

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

// 生成并发送一道按钮验证题：随机选 N 个图标、随机指定一个为正确项，正确 token 存库。
async function sendChallenge(env: Env, userId: string | number, prefix = ''): Promise<void> {
  const raw = Number(await getConfig(env, 'verify_options', '4'));
  const count = Math.min(8, Math.max(2, Number.isFinite(raw) ? raw : 4));
  const picked = shuffle(ICON_POOL).slice(0, count);
  const targetIdx = Math.floor(Math.random() * picked.length);
  const target = picked[targetIdx];

  const buttons = picked.map((p) => ({ e: p.e, token: randToken() }));
  const correctToken = buttons[targetIdx].token;
  await dbConfigPut(env, challengeKey(userId), correctToken);

  const markup: TgInlineKeyboardMarkup = {
    inline_keyboard: chunk(
      buttons.map((b) => ({ text: b.e, callback_data: `vrf:${userId}:${b.token}` })),
      4,
    ),
  };
  const text =
    `${prefix}🤖 <b>真人验证</b>\n\n` +
    `请点击下面的 【${target.e} ${target.name}】 按钮。\n\n` +
    `⚠️ 点错或乱点会被直接拦截，请看清楚再点。`;
  await sendMessage(env, userId, text, { parse_mode: 'HTML', reply_markup: markup });
}

// 首次接触：发欢迎语 + 第一道验证题，置 pending_verification（不建话题、不调 AI）。
export async function startVerification(env: Env, userId: string | number): Promise<void> {
  const welcome = await getConfig(env, 'welcome_msg', DEFAULT_WELCOME);
  await sendMessage(env, userId, welcome);
  await sendChallenge(env, userId);
  await dbUserUpdate(env, userId, { verify_state: 'pending_verification' });
}

// pending 期间用户打字而不是点按钮：重新出一道新题并提醒（旧题作废）。
export async function remindVerification(env: Env, userId: string | number): Promise<void> {
  await sendChallenge(env, userId, '请用下面的按钮完成验证，不要打字喔～\n\n');
}

// 处理验证按钮回调（陌生人点击，不受“仅管理员”限制）。点对=放行，点错=直接拉黑。
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

  const correct = await dbConfigGet(env, challengeKey(userId));
  const msgId = cb.message?.message_id;
  if (!correct) {
    await answerCallbackQuery(env, cb.id, '验证已过期，请重新发条消息获取新题。', true);
    await dbUserUpdate(env, userId, { verify_state: 'new' });
    return;
  }

  if (token && token === correct) {
    await dbConfigDelete(env, challengeKey(userId));
    await dbUserUpdate(env, userId, { verify_state: 'verified' });
    await answerCallbackQuery(env, cb.id, '🎉 验证通过！');
    if (msgId) {
      await editMessageText(env, userId, msgId, '✅ 验证通过，现在可以开始聊天啦！').catch(() => {});
    }
  } else {
    // 点错 → 直接拦截（视为机器人）。误触可让对方 /reset 重来或 /allow 放行。
    await dbConfigDelete(env, challengeKey(userId));
    await dbUserUpdate(env, userId, { is_blocked: true });
    await answerCallbackQuery(env, cb.id, '❌ 验证失败，你已被拦截。', true);
    if (msgId) {
      await editMessageText(env, userId, msgId, '🚫 验证失败，已被拦截。').catch(() => {});
    }
  }
}
