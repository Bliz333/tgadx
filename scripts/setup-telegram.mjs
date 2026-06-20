// 一次性设置 Telegram：把 webhook 指向你的 Worker，并注册命令菜单。
// 不含任何密钥，全部从环境变量读取。部署完 Worker 后跑一次即可。
//
// 用法：
//   BOT_TOKEN=xxx \
//   WORKER_URL=https://tgadx.<你的子域>.workers.dev \
//   WEBHOOK_SECRET=和 wrangler secret 里设的一致 \
//   ADMIN_GROUP_ID=-100xxxxxxxxxx \
//   node scripts/setup-telegram.mjs

const { BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET, ADMIN_GROUP_ID } = process.env;

if (!BOT_TOKEN || !WORKER_URL || !ADMIN_GROUP_ID) {
  console.error('缺少环境变量：BOT_TOKEN / WORKER_URL / ADMIN_GROUP_ID（WEBHOOK_SECRET 可选但强烈建议）');
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const commands = [
  { command: 'allow', description: '放行用户（之后不再判定）：/allow 用户ID' },
  { command: 'reset', description: '重置为新用户、重新 AI 判定（测试用）：/reset 用户ID' },
  { command: 'ban', description: '屏蔽当前话题的联系人' },
  { command: 'unban', description: '解除屏蔽并信任' },
  { command: 'del', description: '删除当前话题（在要删的话题里发）' },
  { command: 'cleannow', description: '立即清理未回复过的过期话题' },
];

(async () => {
  console.log(
    'setWebhook:',
    JSON.stringify(
      await api('setWebhook', {
        url: WORKER_URL,
        secret_token: WEBHOOK_SECRET || undefined,
        allowed_updates: ['message'],
        drop_pending_updates: true,
        max_connections: 1, // 串行投递：一条处理完再来下一条，避免并发绕过"自动拉黑"
      }),
    ),
  );
  // 管理命令：在管理群对管理员显示
  console.log(
    '命令(群管理员):',
    JSON.stringify(
      await api('setMyCommands', {
        commands,
        scope: { type: 'chat_administrators', chat_id: Number(ADMIN_GROUP_ID) },
      }),
    ),
  );
  // 同时注册到「该群所有成员」作用域，让 / 菜单更稳地弹出（管理群只有你，不会泄露给陌生人）
  console.log(
    '命令(该群):',
    JSON.stringify(
      await api('setMyCommands', {
        commands,
        scope: { type: 'chat', chat_id: Number(ADMIN_GROUP_ID) },
      }),
    ),
  );
  // 陌生人私聊里不显示任何命令
  console.log('命令(私聊清空):', JSON.stringify(await api('setMyCommands', { commands: [], scope: { type: 'all_private_chats' } })));
  console.log('命令(默认清空):', JSON.stringify(await api('setMyCommands', { commands: [] })));
})();
