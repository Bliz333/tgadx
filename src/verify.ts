import type { Env } from './types';
import { getConfig, dbUserUpdate } from './db';
import { sendMessage } from './telegram';

export const DEFAULT_WELCOME = '👋 欢迎！在开始聊天前，请先完成人机验证。';
export const DEFAULT_VERIF_Q =
  '问题：1 + 1 = ?\n\n提示：\n1. 正确答案不是「2」。\n2. 答案藏在机器人简介里，请按简介提示回答。';
export const DEFAULT_VERIF_A = '3';

// 首次接触：发欢迎语 + 验证问题，置 pending_verification（不建话题、不调 AI）
export async function startVerification(env: Env, userId: string | number): Promise<void> {
  const welcome = await getConfig(env, 'welcome_msg', DEFAULT_WELCOME);
  const question = await getConfig(env, 'verif_q', DEFAULT_VERIF_Q);
  await sendMessage(env, userId, welcome);
  await sendMessage(env, userId, question);
  await dbUserUpdate(env, userId, { verify_state: 'pending_verification' });
}

// 校验答案：支持 "a|b|c" 多答案、忽略大小写与首尾空格。
// 返回是否通过；通过时置 verified。
export async function checkVerification(env: Env, userId: string | number, answer: string): Promise<boolean> {
  const expected = (await getConfig(env, 'verif_a', DEFAULT_VERIF_A))
    .split('|')
    .map((a) => a.trim().toLowerCase());
  const got = (answer || '').trim().toLowerCase();
  const ok = expected.some((e) => e === got);
  if (ok) {
    await dbUserUpdate(env, userId, { verify_state: 'verified' });
    await sendMessage(env, userId, '🎉 验证成功，可以开始聊天啦！');
  } else {
    await sendMessage(env, userId, '🥺 答案不对哦。提示在机器人简介里，找不到就去问主人要答案吧～');
  }
  return ok;
}
