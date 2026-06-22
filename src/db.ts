import type { Env, UserRecord, UserInfo, AutoReplyRule } from './types';

// ---------- 建表 / 迁移 ----------
// 入口处先跑，确保表结构存在；ALTER 容错，旧库也能平滑加列。
export async function dbMigrate(env: Env): Promise<void> {
  if (!env.TG_BOT_DB) throw new Error("D1 数据库绑定 'TG_BOT_DB' 缺失。");

  const usersTable = `
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY NOT NULL,
      verify_state TEXT NOT NULL DEFAULT 'new',
      relay_state TEXT NOT NULL DEFAULT 'pending',
      is_blocked INTEGER NOT NULL DEFAULT 0,
      is_muted INTEGER NOT NULL DEFAULT 0,
      block_count INTEGER NOT NULL DEFAULT 0,
      topic_id TEXT,
      info_card_message_id TEXT,
      block_log_message_id TEXT,
      user_info_json TEXT,
      first_seen INTEGER,
      last_seen INTEGER
    );`;
  const configTable = `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);`;
  const messagesTable = `
    CREATE TABLE IF NOT EXISTS messages (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      text TEXT,
      date INTEGER,
      PRIMARY KEY (user_id, message_id)
    );`;

  try {
    await env.TG_BOT_DB.batch([
      env.TG_BOT_DB.prepare(usersTable),
      env.TG_BOT_DB.prepare(configTable),
      env.TG_BOT_DB.prepare(messagesTable),
    ]);
    // 旧表平滑加列（已存在会报错，忽略）
    const addColumns = [
      "ALTER TABLE users ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN info_card_message_id TEXT",
      "ALTER TABLE users ADD COLUMN block_log_message_id TEXT",
      "ALTER TABLE users ADD COLUMN first_seen INTEGER",
      "ALTER TABLE users ADD COLUMN last_seen INTEGER",
    ];
    for (const q of addColumns) {
      try {
        await env.TG_BOT_DB.prepare(q).run();
      } catch {
        /* 字段已存在，忽略 */
      }
    }
  } catch (e: any) {
    console.error('D1 迁移失败:', e);
    throw new Error(`D1 初始化失败: ${e?.message || e}`);
  }
}

// ---------- config 表 ----------
export async function dbConfigGet(env: Env, key: string): Promise<string | null> {
  const row = await env.TG_BOT_DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? row.value : null;
}

export async function dbConfigPut(env: Env, key: string, value: string): Promise<void> {
  await env.TG_BOT_DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, value).run();
}

export async function dbConfigDelete(env: Env, key: string): Promise<void> {
  await env.TG_BOT_DB.prepare('DELETE FROM config WHERE key = ?').bind(key).run();
}

// 三级回退：D1 config → 环境变量（大写 key）→ 代码默认值
export async function getConfig(env: Env, key: string, defaultValue: string): Promise<string> {
  const v = await dbConfigGet(env, key);
  if (v !== null) return v;
  const envVal = (env as unknown as Record<string, string | undefined>)[key.toUpperCase()];
  if (envVal !== undefined && envVal !== null) return envVal;
  return defaultValue;
}

// ---------- 行 → UserRecord ----------
function rowToUser(row: any): UserRecord {
  let info: UserInfo | null = null;
  if (row.user_info_json) {
    try {
      info = JSON.parse(row.user_info_json);
    } catch {
      info = null;
    }
  }
  return {
    user_id: String(row.user_id),
    verify_state: row.verify_state || 'new',
    relay_state: row.relay_state || 'pending',
    is_blocked: row.is_blocked === 1,
    is_muted: row.is_muted === 1,
    block_count: Number(row.block_count || 0),
    topic_id: row.topic_id ?? null,
    info_card_message_id: row.info_card_message_id ?? null,
    block_log_message_id: row.block_log_message_id ?? null,
    user_info: info,
    first_seen: row.first_seen ?? null,
    last_seen: row.last_seen ?? null,
  };
}

// ---------- users 表 ----------
// 取用户；不存在则创建默认记录后返回。
export async function dbUserGetOrCreate(env: Env, userId: string | number): Promise<UserRecord> {
  const id = String(userId);
  let row = await env.TG_BOT_DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(id).first<any>();
  if (!row) {
    const now = Date.now();
    await env.TG_BOT_DB.prepare(
      "INSERT INTO users (user_id, verify_state, relay_state, is_blocked, is_muted, block_count, first_seen, last_seen) VALUES (?, 'new', 'pending', 0, 0, 0, ?, ?)",
    )
      .bind(id, now, now)
      .run();
    row = await env.TG_BOT_DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(id).first<any>();
  }
  return rowToUser(row);
}

// 仅查询，不创建（路由判断用）
export async function dbUserGet(env: Env, userId: string | number): Promise<UserRecord | null> {
  const row = await env.TG_BOT_DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(String(userId)).first<any>();
  return row ? rowToUser(row) : null;
}

// 更新若干字段。布尔转 0/1；user_info 对象转 JSON 存入 user_info_json。
type UserUpdate = Partial<{
  verify_state: string;
  relay_state: string;
  is_blocked: boolean;
  is_muted: boolean;
  block_count: number;
  topic_id: string | null;
  info_card_message_id: string | null;
  block_log_message_id: string | null;
  user_info: UserInfo;
  user_info_json: string | null;
  first_seen: number;
  last_seen: number;
}>;

export async function dbUserUpdate(env: Env, userId: string | number, data: UserUpdate): Promise<void> {
  const patch: Record<string, unknown> = { ...data };
  if (patch.user_info !== undefined) {
    patch.user_info_json = JSON.stringify(patch.user_info);
    delete patch.user_info;
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const fields = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => {
    const v = patch[k];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  await env.TG_BOT_DB.prepare(`UPDATE users SET ${fields} WHERE user_id = ?`)
    .bind(...values, String(userId))
    .run();
}

export async function dbUserDelete(env: Env, userId: string | number): Promise<void> {
  await env.TG_BOT_DB.prepare('DELETE FROM users WHERE user_id = ?').bind(String(userId)).run();
}

// 根据 topic_id 反查 user_id
export async function dbTopicUserGet(env: Env, topicId: string | number): Promise<string | null> {
  const row = await env.TG_BOT_DB.prepare('SELECT user_id FROM users WHERE topic_id = ?')
    .bind(String(topicId))
    .first<{ user_id: string }>();
  return row ? String(row.user_id) : null;
}

// 创建话题前的“占位标记”值：表示某条消息正在为该用户建话题。
export const TOPIC_CREATING = '__creating__';

// 原子占位：把 topic_id 从空改成占位符。D1 写串行，并发/连发时只有第一条会成功（changes===1），
// 其余拿到 false 去等真实 id，从根上杜绝“同一个人一次建出好几个话题”。
export async function dbClaimTopicSlot(env: Env, userId: string | number): Promise<boolean> {
  const res = await env.TG_BOT_DB.prepare(
    `UPDATE users SET topic_id = '${TOPIC_CREATING}' WHERE user_id = ? AND (topic_id IS NULL OR topic_id = '')`,
  )
    .bind(String(userId))
    .run();
  return (res.meta?.changes ?? 0) === 1;
}

// 列出所有用户（清理用）
export async function listUsers(env: Env): Promise<UserRecord[]> {
  const res = await env.TG_BOT_DB.prepare('SELECT * FROM users').all<any>();
  return (res.results || []).map(rowToUser);
}

// ---------- messages 表（编辑通知预留） ----------
export async function dbMessageDataPut(
  env: Env,
  userId: string,
  messageId: string,
  text: string,
  date: number,
): Promise<void> {
  await env.TG_BOT_DB.prepare('INSERT OR REPLACE INTO messages (user_id, message_id, text, date) VALUES (?, ?, ?, ?)')
    .bind(userId, messageId, text, date)
    .run();
}

export async function dbMessageDataGet(
  env: Env,
  userId: string,
  messageId: string,
): Promise<{ text: string; date: number } | null> {
  const row = await env.TG_BOT_DB.prepare('SELECT text, date FROM messages WHERE user_id = ? AND message_id = ?')
    .bind(userId, messageId)
    .first<{ text: string; date: number }>();
  return row || null;
}

// ---------- 规则 / 关键词（存 config 的 JSON） ----------
export async function getAutoReplyRules(env: Env): Promise<AutoReplyRule[]> {
  const json = await getConfig(env, 'keyword_responses', '[]');
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function getBlockKeywords(env: Env): Promise<string[]> {
  const json = await getConfig(env, 'block_keywords', '[]');
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ---------- 管理员输入态（存 config 的 admin_state:<id>） ----------
export function dbAdminStateGet(env: Env, userId: string | number): Promise<string | null> {
  return dbConfigGet(env, `admin_state:${userId}`);
}
export function dbAdminStatePut(env: Env, userId: string | number, stateJson: string): Promise<void> {
  return dbConfigPut(env, `admin_state:${userId}`, stateJson);
}
export function dbAdminStateDelete(env: Env, userId: string | number): Promise<void> {
  return dbConfigDelete(env, `admin_state:${userId}`);
}

// ---------- 广告隔离话题 id（meta:spamTopic） ----------
export async function getSpamTopicId(env: Env): Promise<number | null> {
  const v = await dbConfigGet(env, 'meta:spamTopic');
  return v ? Number(v) : null;
}
export async function setSpamTopicId(env: Env, topicId: number): Promise<void> {
  await dbConfigPut(env, 'meta:spamTopic', String(topicId));
}
export async function clearSpamTopicId(env: Env): Promise<void> {
  await dbConfigDelete(env, 'meta:spamTopic');
}
