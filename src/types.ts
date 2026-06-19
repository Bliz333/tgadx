// 环境绑定（wrangler.toml 的 vars/kv + secret）
export interface Env {
  STATE: KVNamespace;
  // secrets
  BOT_TOKEN: string;
  AI_API_KEY: string;
  WEBHOOK_SECRET: string;
  // vars
  ADMIN_GROUP_ID: string;
  ADMIN_USER_ID: string;
  AI_BASE_URL: string;
  AI_MODEL: string;
  CLEANUP_DAYS: string; // 自动清理：未回复过的话题超过这么多天没新消息就删；"0" 关闭
  AUTO_BLOCK: string; // "1"=判为广告后自动拉黑该用户；"0"=只拦截不拉黑（每条仍进广告话题）
}

// Telegram 数据结构（仅用到的字段）
export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: string; // 'private' | 'group' | 'supergroup' | 'channel'
}

export interface TgEntity {
  type: string; // 'url' | 'text_link' | 'mention' | ...
  offset: number;
  length: number;
  url?: string; // text_link 的真实链接藏在这里
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  // 转发标记（任一存在即为转发消息）
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_sender_name?: string;
  // 话题服务消息（出现时忽略）
  forum_topic_created?: unknown;
  forum_topic_closed?: unknown;
  forum_topic_edited?: unknown;
  forum_topic_reopened?: unknown;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}
