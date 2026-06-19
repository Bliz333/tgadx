import type { Env } from './types';

// 统一调用 Telegram Bot API，失败抛错
async function call(env: Env, method: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data: any = await res.json();
  if (!data || !data.ok) {
    throw new Error(`Telegram ${method} 失败: ${data?.error_code} ${data?.description}`);
  }
  return data.result;
}

export function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  return call(env, 'sendMessage', { chat_id: chatId, text, ...extra });
}

// 复制消息：保留图片/视频/文件等各种类型，且不带“转发自”抬头
export function copyMessage(
  env: Env,
  chatId: number | string,
  fromChatId: number | string,
  messageId: number,
  extra: Record<string, unknown> = {},
): Promise<any> {
  return call(env, 'copyMessage', {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    ...extra,
  });
}

// 在管理群里为某个联系人新建一个话题，返回 message_thread_id
export async function createForumTopic(env: Env, chatId: number | string, name: string): Promise<number> {
  const result = await call(env, 'createForumTopic', { chat_id: chatId, name });
  return result.message_thread_id as number;
}

// 删除一个话题（清理用）
export function deleteForumTopic(env: Env, chatId: number | string, topicId: number): Promise<any> {
  return call(env, 'deleteForumTopic', { chat_id: chatId, message_thread_id: topicId });
}
