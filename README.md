# tgadx · Telegram 防广告中继机器人

陌生人通过 bot 联系你：消息先经 **AI 判广告**——正常人自动在你的管理群里开一个独立话题转发给你，你在话题里回复就转回给对方；广告进单独的「🚫 广告拦截」话题并自动拉黑。对方只看到 bot，看不到你的账号。

跑在 **Cloudflare Workers**，免费、免运维。

## ✨ 特性

- AI 判广告（默认 DeepSeek，可换任意 OpenAI 兼容模型）；明显广告本地秒拦、不耗 AI
- 每个联系人一个话题，井井有条；你回复过的人之后永不再被判
- 广告集中隔离 + 自动拉黑，误判一条命令救回
- 话题可自动 / 手动清理；只认你本人操作，已做安全加固

## 🚀 部署

**先准备好**：① bot token（[@BotFather](https://t.me/BotFather)）② 你的 TG 用户 id（[@userinfobot](https://t.me/userinfobot)）③ 一个开启「话题/Topics」、并把 bot 设为管理员（勾「管理话题」）的群 + 它的群 id ④ Cloudflare 账号（免费）⑤ DeepSeek（或任意 OpenAI 兼容）API key。

然后二选一：

### 方式 A：网页后台（推荐，零终端）

不用装任何东西，全程浏览器点击 + 粘贴一个文件。
👉 **[按 `dashboard/README.md` 图文教程做](dashboard/README.md)**

### 方式 B：命令行（适合要改代码的人）

<details>
<summary>展开步骤</summary>

先装 [Node.js](https://nodejs.org)（自带 npm）和 [Git](https://git-scm.com)，然后在终端里：

```bash
git clone https://github.com/Bliz333/tgadx.git && cd tgadx
npm install

npx wrangler login                          # 登录 Cloudflare
npx wrangler kv namespace create STATE      # 把输出的 id 填进 wrangler.toml 的 kv_namespaces.id
# 在 wrangler.toml 的 [vars] 填上 ADMIN_GROUP_ID(群id) 和 ADMIN_USER_ID(你的id)

npx wrangler secret put BOT_TOKEN           # 依次再 put：AI_API_KEY、WEBHOOK_SECRET（自定义一段随机串）
npx wrangler deploy                         # 部署，记下输出的 Worker 网址

# 绑定 webhook + 命令菜单（值替换成你自己的）：
BOT_TOKEN='...' WORKER_URL='https://tgadx.xxx.workers.dev' \
WEBHOOK_SECRET='上面那段随机串' ADMIN_GROUP_ID='-100xxxxxxxxxx' \
node scripts/setup-telegram.mjs
```

之后改了代码 `npx wrangler deploy` 重新发布即可。日志：Cloudflare 后台 → Workers & Pages → tgadx → Logs。
</details>

## 🕹 管理命令（在管理群里打 `/` 会有菜单）

| 命令 | 作用 |
|---|---|
| `/allow <用户ID>` | 放行某人（信任，之后不再判定）；救回误判 |
| `/ban` / `/unban` | 在某人话题里发，屏蔽 / 解除屏蔽 |
| `/del` | 在某话题里发，删除当前话题 |
| `/cleannow` | 立即清理过期的未回复话题 |
| `/reset <用户ID>` | 重置为新用户、重新判定（测试用） |

## 🛡 怎么用 / 测试

- 别人正常私聊 → 群里建话题、你回复即可对话。
- 想测广告拦截：用一个小号发广告 → 进「广告拦截」话题并被拉黑；**只要你不回复它**，它就一直被判，可反复测；`/reset <它的ID>` 可重来。

<details>
<summary>🧠 工作原理 & 判定规则</summary>

- 新人 / 你还没回复过的人，**每条消息都判**：先本地强规则（含 `t.me/xxxbot`、`?start=` 等明显广告直接拦、不调 AI），否则交给 AI（喂入正文 + 隐藏链接 + 是否转发）。
- 判正常 → 建/复用独立话题转发（状态 `pending`）；判广告 → 进「广告拦截」话题，默认**自动拉黑**（后续静默丢弃，`/allow` 救回）。
- **你回复某人一次** → 他变 `trusted`，之后自由通过、不再判、不被自动清理。
- 判定标准就是 `src/ai.ts` 里的系统提示词，想调宽/严改那段即可。
- 入口 `src/index.ts` → 逻辑 `src/handlers.ts` → 判定 `src/ai.ts` → 存储 `src/store.ts` → 接口 `src/telegram.ts`。
</details>

<details>
<summary>⚙️ 配置项（变量 / 密钥）</summary>

| 位置 | 键 | 说明 |
|---|---|---|
| `wrangler.toml [vars]` | `ADMIN_GROUP_ID` | 管理群 id（负数） |
| | `ADMIN_USER_ID` | 你的 TG 用户 id |
| | `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容端点 / 模型 |
| | `CLEANUP_DAYS` | 自动清理阈值（天）；`"0"` 关闭 |
| | `AUTO_BLOCK` | `"1"` 判广告后自动拉黑；`"0"` 只拦不拉黑 |
| `wrangler.toml [triggers]` | `crons` | 定时清理（默认每天 03:00 UTC） |
| `wrangler secret` | `BOT_TOKEN` / `AI_API_KEY` / `WEBHOOK_SECRET` | 三个密钥 |
| KV | `STATE` | 状态存储（用户/话题映射） |

> 仓库不含任何密钥：密钥用 `wrangler secret` 设、群/用户 id 填进 `wrangler.toml`；`note`/`.dev.vars` 已被 `.gitignore`。
</details>

<details>
<summary>🔒 安全加固</summary>

- 只认最高管理员本人，别人进群也无法操作或冒充你回复。
- webhook 校验 fail-closed：没带正确密钥一律拒绝。
- 明显广告本地预筛，省 AI 成本、也防 AI 提示注入绕过。
- 熟人消息写节流（6 小时），不触及 KV 免费额度；过期话题与旧拉黑记录定期清理。
</details>

## 其它

- 不想用 Cloudflare、想在自己服务器常驻跑：见 [`server/README.md`](server/README.md)（Node 长轮询版）。
- License：MIT。
