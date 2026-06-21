import type { Env, TgCallbackQuery, AutoReplyRule, TgInlineKeyboardMarkup } from './types';
import {
  getConfig,
  dbConfigPut,
  getAutoReplyRules,
  getBlockKeywords,
  dbAdminStatePut,
  dbAdminStateGet,
  dbAdminStateDelete,
} from './db';
import { sendMessage, editMessageText, answerCallbackQuery } from './telegram';
import { escapeHtml } from './cards';
import { DEFAULT_WELCOME } from './verify';

// 统一：有 messageId 就编辑，否则发送新消息
async function render(
  env: Env,
  chatId: number | string,
  messageId: number,
  text: string,
  markup: TgInlineKeyboardMarkup,
): Promise<void> {
  const params = { parse_mode: 'HTML', reply_markup: markup };
  if (messageId && messageId !== 0) {
    try {
      await editMessageText(env, chatId, messageId, text, params);
      return;
    } catch (e) {
      console.warn('编辑菜单失败，改为发送新消息:', e);
    }
  }
  await sendMessage(env, chatId, text, params);
}

// ---------- 主菜单 ----------
export async function handleAdminConfigStart(env: Env, chatId: number | string, messageId = 0): Promise<void> {
  await dbAdminStateDelete(env, chatId); // 清掉未完成的输入态
  const text = '⚙️ <b>机器人配置菜单</b>\n\n请选择要管理的配置类别：';
  const markup: TgInlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '📝 基础配置（验证）', callback_data: 'config:menu:base' }],
      [{ text: '🤖 自动回复管理', callback_data: 'config:menu:autoreply' }],
      [{ text: '🚫 关键词屏蔽管理', callback_data: 'config:menu:keyword' }],
      [{ text: '🔗 按类型过滤管理', callback_data: 'config:menu:filter' }],
      [{ text: '🔄 刷新主菜单', callback_data: 'config:menu:' }],
    ],
  };
  await render(env, chatId, messageId, text, markup);
}

// ---------- 基础配置（验证） ----------
async function baseMenu(env: Env, chatId: number | string, messageId: number): Promise<void> {
  const welcome = await getConfig(env, 'welcome_msg', DEFAULT_WELCOME);
  const options = await getConfig(env, 'verify_options', '4');
  const enabled = (await getConfig(env, 'verify_enabled', 'true')).toLowerCase() === 'true';
  const text = [
    '📝 <b>基础配置（人机验证）</b>',
    '',
    '验证方式：<b>图标按钮验证</b>——随机给出若干图标，让对方点出指定的那个；',
    '点错或乱点直接拦截，纯发广告的脚本不会点按钮，因此挡得住。',
    '',
    `• 验证开关: ${enabled ? '✅ 已开启' : '❌ 已关闭'}`,
    `• 欢迎消息: ${escapeHtml(welcome).slice(0, 30)}...`,
    `• 按钮个数: <code>${escapeHtml(options)}</code> 个（越多越难蒙对，范围 2–8）`,
    '',
    '请选择要修改的项：',
  ].join('\n');
  const markup: TgInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: enabled ? '🔌 关闭人机验证' : '🔌 开启人机验证',
          callback_data: `config:toggle:verify_enabled:${enabled ? 'false' : 'true'}`,
        },
      ],
      [{ text: '📝 编辑欢迎消息', callback_data: 'config:edit:welcome_msg' }],
      [{ text: '🔢 修改按钮个数', callback_data: 'config:edit:verify_options' }],
      [{ text: '⬅️ 返回主菜单', callback_data: 'config:menu:' }],
    ],
  };
  await render(env, chatId, messageId, text, markup);
}

// ---------- 自动回复 ----------
async function autoReplyMenu(env: Env, chatId: number | string, messageId: number): Promise<void> {
  const rules = await getAutoReplyRules(env);
  const text = `🤖 <b>自动回复管理</b>\n\n当前规则总数：<b>${rules.length}</b> 条。\n\n请选择操作：`;
  const markup: TgInlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '➕ 新增自动回复规则', callback_data: 'config:add:keyword_responses' }],
      [{ text: `🗑️ 管理/删除规则（${rules.length} 条）`, callback_data: 'config:list:keyword_responses' }],
      [{ text: '⬅️ 返回主菜单', callback_data: 'config:menu:' }],
    ],
  };
  await render(env, chatId, messageId, text, markup);
}

// ---------- 关键词屏蔽 ----------
async function keywordMenu(env: Env, chatId: number | string, messageId: number): Promise<void> {
  const keywords = await getBlockKeywords(env);
  const threshold = await getConfig(env, 'block_threshold', '5');
  const text = [
    '🚫 <b>关键词屏蔽管理</b>',
    '',
    `当前屏蔽关键词总数：<b>${keywords.length}</b> 个。`,
    `屏蔽次数阈值：<code>${escapeHtml(threshold)}</code> 次。`,
    '',
    '请选择操作：',
  ].join('\n');
  const markup: TgInlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '➕ 新增屏蔽关键词', callback_data: 'config:add:block_keywords' }],
      [{ text: `🗑️ 管理/删除关键词（${keywords.length} 个）`, callback_data: 'config:list:block_keywords' }],
      [{ text: `✏️ 修改屏蔽阈值（${threshold} 次）`, callback_data: 'config:edit:block_threshold' }],
      [{ text: '⬅️ 返回主菜单', callback_data: 'config:menu:' }],
    ],
  };
  await render(env, chatId, messageId, text, markup);
}

// ---------- 按类型过滤 ----------
const FILTER_KEYS: { key: string; label: string }[] = [
  { key: 'enable_user_forwarding', label: '转发消息（用户）' },
  { key: 'enable_group_forwarding', label: '转发消息（群组）' },
  { key: 'enable_channel_forwarding', label: '转发消息（频道）' },
  { key: 'enable_audio_forwarding', label: '音频/语音消息' },
  { key: 'enable_sticker_forwarding', label: '贴纸/GIF' },
  { key: 'enable_media_forwarding', label: '图片/视频/文件' },
  { key: 'enable_link_forwarding', label: '链接消息' },
  { key: 'enable_text_forwarding', label: '纯文本消息' },
];

async function filterMenu(env: Env, chatId: number | string, messageId: number): Promise<void> {
  const states: boolean[] = [];
  for (const f of FILTER_KEYS) states.push((await getConfig(env, f.key, 'true')).toLowerCase() === 'true');

  const lines = FILTER_KEYS.map(
    (f, i) => `${i + 1}. ${states[i] ? '✅ <b>允许</b>' : '❌ <b>屏蔽</b>'} | ${f.label}`,
  );
  const text = ['🔗 <b>按类型过滤管理</b>', '点击下方按钮切换状态。', '', ...lines].join('\n');

  const rows: TgInlineKeyboardMarkup['inline_keyboard'] = [];
  for (let i = 0; i < FILTER_KEYS.length; i += 2) {
    const row = [];
    for (let j = i; j < i + 2 && j < FILTER_KEYS.length; j++) {
      row.push({
        text: `${j + 1}. ${states[j] ? '✅ 允许' : '❌ 屏蔽'}`,
        callback_data: `config:toggle:${FILTER_KEYS[j].key}:${states[j] ? 'false' : 'true'}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: '⬅️ 返回主菜单', callback_data: 'config:menu:' }]);
  await render(env, chatId, messageId, text, { inline_keyboard: rows });
}

// ---------- 规则列表 / 删除 ----------
async function ruleList(env: Env, chatId: number | string, messageId: number, key: string): Promise<void> {
  let text = '';
  let backCb = 'config:menu:';
  const rows: TgInlineKeyboardMarkup['inline_keyboard'] = [];

  if (key === 'keyword_responses') {
    const rules = await getAutoReplyRules(env);
    backCb = 'config:menu:autoreply';
    text = `🤖 <b>自动回复规则列表（${rules.length} 条）</b>\n格式：<code>关键词</code> ➡️ 回复\n点击下方按钮删除对应规则。`;
    if (rules.length === 0) text += '\n\n<i>（列表为空）</i>';
    rules.forEach((r, i) => {
      text += `\n${i + 1}. <code>${escapeHtml(r.keywords.slice(0, 15))}</code> ➡️ ${escapeHtml(
        r.response.slice(0, 20),
      )}`;
      rows.push([{ text: `🗑️ 删除 ${i + 1}`, callback_data: `config:delete:keyword_responses:${r.id}` }]);
    });
  } else if (key === 'block_keywords') {
    const kws = await getBlockKeywords(env);
    backCb = 'config:menu:keyword';
    text = `🚫 <b>屏蔽关键词列表（${kws.length} 个）</b>\n点击下方按钮删除对应关键词。`;
    if (kws.length === 0) text += '\n\n<i>（列表为空）</i>';
    kws.forEach((kw, i) => {
      text += `\n${i + 1}. <code>${escapeHtml(kw.slice(0, 30))}</code>`;
      rows.push([{ text: `🗑️ 删除 ${i + 1}`, callback_data: `config:delete:block_keywords:${kw}` }]);
    });
  } else {
    return;
  }
  rows.push([{ text: '⬅️ 返回', callback_data: backCb }]);
  await render(env, chatId, messageId, text, { inline_keyboard: rows });
}

async function ruleDelete(env: Env, key: string, value: string): Promise<void> {
  if (key === 'keyword_responses') {
    const rules = await getAutoReplyRules(env);
    const next = rules.filter((r) => String(r.id) !== String(value));
    await dbConfigPut(env, key, JSON.stringify(next));
  } else if (key === 'block_keywords') {
    const kws = await getBlockKeywords(env);
    const next = kws.filter((kw) => kw !== value);
    await dbConfigPut(env, key, JSON.stringify(next));
  }
}

// ---------- 文本输入态 ----------
const EDIT_META: Record<string, { prompt: string; back: string }> = {
  welcome_msg: { prompt: '请发送新的<b>欢迎消息</b>：', back: 'config:menu:base' },
  verify_options: { prompt: '请发送<b>验证按钮个数</b>（2–8 的数字，越多越难蒙对）：', back: 'config:menu:base' },
  block_threshold: { prompt: '请发送新的<b>屏蔽次数阈值</b>（数字）：', back: 'config:menu:keyword' },
  block_keywords: { prompt: '请发送新的<b>屏蔽关键词</b>（支持正则）：', back: 'config:menu:keyword' },
  keyword_responses: {
    prompt: '请发送新的<b>自动回复规则</b>，格式：<code>关键词===回复内容</code>',
    back: 'config:menu:autoreply',
  },
};

// 处理管理员处于输入态时发来的文本。返回 true 表示已消费。
export async function handleAdminConfigInput(env: Env, userId: string | number, text: string): Promise<boolean> {
  const stateJson = await dbAdminStateGet(env, userId);
  if (!stateJson) return false;

  let state: { action: string; key: string };
  try {
    state = JSON.parse(stateJson);
  } catch {
    await dbAdminStateDelete(env, userId);
    await sendMessage(env, userId, '⚠️ 状态错误，已重置。请重新 /start。');
    return true;
  }

  const meta = EDIT_META[state.key.replace(/_add$/, '')] || { prompt: '', back: 'config:menu:' };

  if (text.trim().toLowerCase() === '/cancel') {
    await dbAdminStateDelete(env, userId);
    await sendMessage(env, userId, '❌ 已取消输入。');
    await routeMenu(env, userId, 0, meta.back.split(':')[2] || '');
    return true;
  }

  // 新增屏蔽关键词
  if (state.key === 'block_keywords_add') {
    const kw = text.trim();
    const kws = await getBlockKeywords(env);
    if (kw && !kws.includes(kw)) {
      kws.push(kw);
      await dbConfigPut(env, 'block_keywords', JSON.stringify(kws));
      await sendMessage(env, userId, `✅ 已添加屏蔽关键词：<code>${escapeHtml(kw)}</code>`, { parse_mode: 'HTML' });
    } else {
      await sendMessage(env, userId, '⚠️ 未添加：内容为空或已存在。');
    }
    await dbAdminStateDelete(env, userId);
    await keywordMenu(env, userId, 0);
    return true;
  }

  // 新增自动回复规则
  if (state.key === 'keyword_responses_add') {
    const parts = text.split('===');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      const rules = await getAutoReplyRules(env);
      const rule: AutoReplyRule = { keywords: parts[0].trim(), response: parts[1].trim(), id: Date.now() };
      rules.push(rule);
      await dbConfigPut(env, 'keyword_responses', JSON.stringify(rules));
      await sendMessage(env, userId, `✅ 已添加自动回复规则：<code>${escapeHtml(rule.keywords)}</code>`, {
        parse_mode: 'HTML',
      });
    } else {
      await sendMessage(env, userId, '⚠️ 格式错误，应为：<code>关键词===回复内容</code>', { parse_mode: 'HTML' });
    }
    await dbAdminStateDelete(env, userId);
    await autoReplyMenu(env, userId, 0);
    return true;
  }

  // 一般配置项
  const value = text.trim();
  if (value.length === 0) {
    await sendMessage(env, userId, '⚠️ 内容不能为空，请重新发送。');
    return true;
  }
  await dbConfigPut(env, state.key, value);
  await dbAdminStateDelete(env, userId);
  await sendMessage(env, userId, `✅ 配置项 <code>${escapeHtml(state.key)}</code> 已更新。`, { parse_mode: 'HTML' });
  await routeMenu(env, userId, 0, meta.back.split(':')[2] || '');
  return true;
}

// 跳转到指定子菜单
async function routeMenu(env: Env, chatId: number | string, messageId: number, menu: string): Promise<void> {
  if (menu === 'base') await baseMenu(env, chatId, messageId);
  else if (menu === 'autoreply') await autoReplyMenu(env, chatId, messageId);
  else if (menu === 'keyword') await keywordMenu(env, chatId, messageId);
  else if (menu === 'filter') await filterMenu(env, chatId, messageId);
  else await handleAdminConfigStart(env, chatId, messageId);
}

// ---------- 回调路由（config:*） ----------
// 返回 true 表示已处理。
export async function handleConfigCallback(env: Env, cb: TgCallbackQuery): Promise<boolean> {
  const data = cb.data || '';
  if (!data.startsWith('config:')) return false;
  const message = cb.message;
  if (!message) return true;

  const parts = data.split(':');
  const action = parts[1];
  const key = parts[2];
  const value = parts.slice(3).join(':'); // 关键词可能含 ':'
  const chatId = cb.from.id;
  const messageId = message.message_id;

  // 先停掉按钮的 loading 圈；其失败不应阻断后续真正的状态变更
  await answerCallbackQuery(env, cb.id, '处理中...').catch(() => {});

  if (action === 'menu') {
    await routeMenu(env, chatId, messageId, key);
  } else if (action === 'toggle' && key) {
    await dbConfigPut(env, key, value);
    // 验证开关在基础菜单，其余在过滤菜单
    if (key === 'verify_enabled') await baseMenu(env, chatId, messageId);
    else await filterMenu(env, chatId, messageId);
  } else if (action === 'edit' && key) {
    await dbAdminStatePut(env, chatId, JSON.stringify({ action: 'awaiting_input', key }));
    const meta = EDIT_META[key] || { prompt: `请发送新的 <code>${key}</code> 值：`, back: 'config:menu:' };
    await editMessageText(env, chatId, messageId, `${meta.prompt}\n\n发送 /cancel 取消。`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '❌ 取消', callback_data: meta.back }]] },
    });
  } else if (action === 'add' && key) {
    await dbAdminStatePut(env, chatId, JSON.stringify({ action: 'awaiting_input', key: `${key}_add` }));
    const meta = EDIT_META[key] || { prompt: '请发送内容：', back: 'config:menu:' };
    await editMessageText(env, chatId, messageId, `${meta.prompt}\n\n发送 /cancel 取消。`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '❌ 取消', callback_data: meta.back }]] },
    });
  } else if (action === 'list' && key) {
    await ruleList(env, chatId, messageId, key);
  } else if (action === 'delete' && key) {
    await ruleDelete(env, key, value);
    await answerCallbackQuery(env, cb.id, '✅ 已删除。');
    await ruleList(env, chatId, messageId, key);
  }
  return true;
}
