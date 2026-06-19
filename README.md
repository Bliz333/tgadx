# tgadx — Telegram 双向中继机器人（AI 防广告 + 话题模式）

陌生人私聊你的 bot，消息先经 **AI 判定**：明显是广告的进入一个独立的「🚫 广告拦截」隔离话题（不打扰你、但你能随时翻查纠错）；正常人则在你的**管理群里自动开一个独立话题（Topic）**转发过来。你在话题里回复，bot 转回给对方。对方永远只看到 bot，看不到你的账号。

默认部署在 **Cloudflare Workers**（免费、免运维、用 KV 存状态、webhook 驱动）。仓库里也带一份可在自有服务器常驻运行的 **VPS 版**（`server/`，Node 长轮询）。

> ⚠️ 本仓库**不含任何密钥**。bot token / AI key / webhook 密钥都通过 `wrangler secret` 设置；群 id、用户 id 等部署时填进 `wrangler.toml`。本地的 `note`、`.dev.vars`、`.webhook_secret` 已在 `.gitignore` 中，不会上传。

---

## 判定与转发规则

- **未信任的人（新用户，或你还没回复过的人）发的每一条消息都过 AI 判定**：
  - 判为广告 → 进「🚫 广告拦截」隔离话题，并**自动拉黑该用户**：他后续消息一律静默丢弃，直到你 `/allow` 放行（这样多次发广告的号只会在拦截话题留一条，不再骚扰）。
  - 判为正常 → 在管理群给他建/复用独立话题并转发，状态记为 `pending`。
- **你在某人的话题里回复一次后**，他变为 `trusted`，之后消息自由通过、**不再判定**（熟人不会被误拦）。
- 喂给 AI 的内容 = 正文 + 标题 + **消息里隐藏的链接/@提及**（识别 `t.me/xxxbot`、`?start=` 等引流广告的关键）+ 是否转发。
- AI 用 OpenAI 兼容接口（默认 DeepSeek `deepseek-v4-flash`，关闭思考），任何请求失败都**默认放行**，避免误杀。判定标准就是 `src/ai.ts` 里的系统提示词，想调宽/调严改那段即可。

### 管理命令（在管理群里用，打 `/` 有菜单）

| 命令 | 作用 |
|---|---|
| `/allow <用户ID>` | 放行某人（标记信任，之后不再判定）；用于救回误判 |
| `/reset <用户ID>` | 把某人重置为「新用户」，下一条重新 AI 判定（测试用） |
| `/ban` | 在某人的话题里发，屏蔽该联系人 |
| `/unban` | 解除屏蔽并信任 |
| `/del` | 在某个话题里发，删除当前话题（手动清理一个） |
| `/cleannow` | 立即清理：删除所有「未回复过」且超过 `CLEANUP_DAYS` 天没新消息的话题 |

### 话题清理（避免话题太多）

- **自动**：每天定时（`wrangler.toml` 的 `[triggers] crons`）删除「你从没回复过的(pending)」且超过 `CLEANUP_DAYS`（默认 30）天没新消息的话题；**你回复过的(trusted)永不自动删**。
- **手动**：`/del`（删当前话题）、`/cleannow`（立即按上面规则批量清）。
- **App 里直接删**：你也可以在 Telegram 里长按话题删除；bot 有自愈——对方下次再来会自动重建话题，状态不会错乱。
- 关掉自动清理：把 `CLEANUP_DAYS` 设为 `"0"`。

---

## 你需要准备

1. 一个 **bot** 的 token（[@BotFather](https://t.me/BotFather)）。
2. 你的 **Telegram 用户 id**（[@userinfobot](https://t.me/userinfobot)）。
3. 一个**开启了「话题/Topics」的群**，把 bot 拉进去**设为管理员**（勾「管理话题」；管理员才能收到群消息、建话题）。拿到**群 id**（负数）。
4. 一个 **Cloudflare 账号**（免费）。
5. 一个 **DeepSeek（或任意 OpenAI 兼容）API key**。

---

## 部署方式（二选一）

- **方式 A — 网页后台，零终端、不用装任何东西**：见 [`dashboard/README.md`](dashboard/README.md)。全程在 Cloudflare 网页里点点点 + 粘贴一个文件，适合不想碰命令行的人。**推荐新手用这个。**
- **方式 B — 命令行（wrangler）**：见下方，适合要改代码、习惯终端的人。

---

## 方式 B：命令行手动部署到 Cloudflare Workers

### 前置：先装好这两样
- **Node.js（自带 npm）**：到 https://nodejs.org 下载 LTS 版安装（装完 `npm` 就有了）。验证：终端跑 `node -v` 能看到版本号即可。
- **Git**：https://git-scm.com （Mac 装了 Xtools 通常自带）。

### 步骤

```bash
# 1. 把仓库拉到本地，并进入项目目录（后面所有命令都在这个目录里跑）
git clone https://github.com/Bliz333/tgadx.git
cd tgadx

# 2. 安装依赖（就在 tgadx 目录里执行）
npm install

# 3. 登录 Cloudflare（二选一）
npx wrangler login                       # 本机有浏览器：弹出授权
# 或无浏览器/CI：用 API Token（dash → My Profile → API Tokens → 模板「Edit Cloudflare Workers」）
#   export CLOUDFLARE_API_TOKEN=xxxxx
#   export CLOUDFLARE_ACCOUNT_ID=xxxxx

# 4. 创建 KV 命名空间，把输出的 id 填进 wrangler.toml 的 kv_namespaces.id
npx wrangler kv namespace create STATE

# 5. 在 wrangler.toml 的 [vars] 填好（非机密）：
#    ADMIN_GROUP_ID = "-100xxxxxxxxxx"
#    ADMIN_USER_ID  = "你的TG用户id"
#    AI_BASE_URL / AI_MODEL 默认 DeepSeek，可改

# 6. 设置机密（不写进仓库）。WEBHOOK_SECRET 自己生成一段随机串：
#    例如  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
npx wrangler secret put BOT_TOKEN
npx wrangler secret put AI_API_KEY
npx wrangler secret put WEBHOOK_SECRET

# 7. 部署，记下输出的 Worker URL（形如 https://tgadx.<子域>.workers.dev）
npx wrangler deploy

# 8. 设置 webhook + 命令菜单（用仓库自带脚本，从环境变量读，不留密钥）
BOT_TOKEN='你的bot token' \
WORKER_URL='https://tgadx.<子域>.workers.dev' \
WEBHOOK_SECRET='第4步设的同一个值' \
ADMIN_GROUP_ID='-100xxxxxxxxxx' \
node scripts/setup-telegram.mjs
```

完成后：用一个小号私聊 bot，正常消息会在管理群建话题；发广告会进「🚫 广告拦截」话题。

### 改完代码重新部署

```bash
npx wrangler deploy            # 重新发布
# 改了命令/换了 Worker 地址才需要再跑一次 scripts/setup-telegram.mjs
```

### 看日志

Cloudflare 后台 → Workers & Pages → **tgadx** → **Logs**，或本机 `npx wrangler tail`。每条入站都会打印 `入站判定 spam=.. 理由=.. 内容=..`。

---

## 测试技巧（只有一个小号也能反复测）

只要你**不在某个小号的话题里回复它**，它就一直是未信任状态、每条消息都被判：
1. 小号发广告 → 进「🚫 广告拦截」。
2. 小号发正常消息 → 进它的话题。
3. 想再测一轮：管理群里发 `/reset <小号ID>`（ID 在新联系人/拦截消息里能看到）。
4. 想验证「信任后放行」：在小号话题里回它一句 → 之后它发啥都直接进话题、不再判。

---

## 配置项

| 位置 | 键 | 说明 |
|---|---|---|
| `wrangler.toml [vars]` | `ADMIN_GROUP_ID` | 管理群 id（负数） |
| | `ADMIN_USER_ID` | 你的 TG 用户 id |
| | `AI_BASE_URL` | OpenAI 兼容 chat completions 端点 |
| | `AI_MODEL` | 判定模型 |
| | `CLEANUP_DAYS` | 自动清理阈值（天）；`"0"` 关闭 |
| `wrangler.toml [triggers]` | `crons` | 定时清理的 cron（默认每天 03:00 UTC） |
| `wrangler secret` | `BOT_TOKEN` | bot token |
| | `AI_API_KEY` | AI 接口 key |
| | `WEBHOOK_SECRET` | 校验 Telegram webhook 的密钥（与 setWebhook 一致） |
| KV | `STATE` | 存用户状态、话题映射、广告话题 id |

---

## 文件结构

```
wrangler.toml            Cloudflare 配置（KV 绑定、vars）
dashboard/               网页后台零终端部署：单文件 worker.js + 图文教程
scripts/setup-telegram.mjs  设置 webhook + 命令菜单（无密钥）
src/index.ts             入口：校验 webhook secret，分派 update
src/handlers.ts          业务逻辑：入站判定、群内回复中继、/allow /reset /ban /unban
src/ai.ts                AI 广告判定（判定标准/提示词在此）
src/telegram.ts          Telegram Bot API 封装
src/store.ts             KV 读写封装
src/types.ts             类型定义
server/                  备用：VPS 常驻版（Node 长轮询，见下）
```

---

## 备用方案：在自有服务器常驻运行（VPS 版）

不想用 Cloudflare、想直接在一台服务器上跑，可用 `server/tgbot.mjs`（纯 Node，无第三方依赖，长轮询，无需域名/HTTPS/webhook）：

```bash
# 服务器上（Node 18+）
mkdir -p /opt/tgadx && cp server/tgbot.mjs /opt/tgadx/
# 写环境变量文件（chmod 600，勿提交）
cat > /opt/tgadx/tgadx.env <<'ENV'
BOT_TOKEN=...
ADMIN_GROUP_ID=-100xxxxxxxxxx
ADMIN_USER_ID=...
AI_BASE_URL=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-v4-flash
AI_API_KEY=...
STATE_FILE=/opt/tgadx/state.json
ENV
chmod 600 /opt/tgadx/tgadx.env
# 用 systemd 常驻（unit 见 server/tgadx.service）
cp server/tgadx.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tgadx
journalctl -u tgadx -f
```

> 注意：webhook（Cloudflare 版）和长轮询（VPS 版）**同一个 bot 只能用一种**。切换到长轮询前，先 `deleteWebhook`。
