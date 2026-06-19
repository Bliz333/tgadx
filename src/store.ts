import type { Env } from './types';

export interface UserRecord {
  topicId: number;
  // pending = 已建话题但你还没回复过他，期间每条消息仍过 AI 判定
  // trusted = 你已回复过（或 /allow 放行），之后消息自由通过、不再判定
  // blocked = 被 /ban 屏蔽
  status: 'pending' | 'trusted' | 'blocked';
  name: string;
  firstSeen: number;
}

// user:<userId> -> UserRecord
export function getUser(env: Env, userId: number): Promise<UserRecord | null> {
  return env.STATE.get<UserRecord>(`user:${userId}`, 'json');
}

export async function setUser(env: Env, userId: number, rec: UserRecord): Promise<void> {
  await env.STATE.put(`user:${userId}`, JSON.stringify(rec));
}

export async function deleteUser(env: Env, userId: number): Promise<void> {
  await env.STATE.delete(`user:${userId}`);
}

// topic:<topicId> -> userId（管理群话题反查用户）
export async function getUserIdByTopic(env: Env, topicId: number): Promise<number | null> {
  const v = await env.STATE.get(`topic:${topicId}`);
  return v ? Number(v) : null;
}

export async function setTopicMap(env: Env, topicId: number, userId: number): Promise<void> {
  await env.STATE.put(`topic:${topicId}`, String(userId));
}

export async function deleteTopicMap(env: Env, topicId: number): Promise<void> {
  await env.STATE.delete(`topic:${topicId}`);
}

// meta:spamTopic -> “🚫 广告拦截”隔离话题的 id
export async function getSpamTopicId(env: Env): Promise<number | null> {
  const v = await env.STATE.get('meta:spamTopic');
  return v ? Number(v) : null;
}

export async function setSpamTopicId(env: Env, topicId: number): Promise<void> {
  await env.STATE.put('meta:spamTopic', String(topicId));
}
