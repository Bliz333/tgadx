// 环境绑定（wrangler.toml 的 vars/d1 + secret）
export interface Env {
  TG_BOT_DB: D1Database; // D1 数据库绑定（users / config / messages）
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

export interface TgPhotoSize {
  file_id: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date?: number;
  edit_date?: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  reply_markup?: TgInlineKeyboardMarkup;
  // 媒体类型（内容过滤用）
  photo?: TgPhotoSize[];
  video?: { file_id: string };
  document?: { file_id: string };
  audio?: { file_id: string };
  voice?: { file_id: string };
  sticker?: { file_id: string };
  animation?: { file_id: string };
  // 转发标记
  forward_origin?: unknown;
  forward_from?: TgUser;
  forward_from_chat?: TgChat;
  forward_sender_name?: string;
  // 话题服务消息（出现时忽略）
  forum_topic_created?: unknown;
  forum_topic_closed?: unknown;
  forum_topic_edited?: unknown;
  forum_topic_reopened?: unknown;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

// 内联键盘
export interface TgInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

// 存在 users 表的 user_info_json 里的精简资料
export interface UserInfo {
  name: string;
  username: string;
  firstSeen: number;
}

// users 表一行（is_blocked/is_muted 已转 boolean，user_info 已解析）
export interface UserRecord {
  user_id: string;
  // 验证门：new=未接触 / pending_verification=已发问题待答 / verified=已通过（或验证关闭）
  verify_state: 'new' | 'pending_verification' | 'verified';
  // AI 门：pending=仍逐条过 AI / trusted=管理员已回复过，之后免判、永不自动清理
  relay_state: 'pending' | 'trusted';
  is_blocked: boolean;
  is_muted: boolean;
  block_count: number;
  topic_id: string | null;
  info_card_message_id: string | null;
  block_log_message_id: string | null;
  user_info: UserInfo | null;
  first_seen: number | null;
  last_seen: number | null;
}

// 自动回复规则
export interface AutoReplyRule {
  keywords: string;
  response: string;
  id: number;
}
