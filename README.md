# tgadx · Telegram 防广告中继机器人

陌生人通过 bot 联系你：先过**人机验证**挡掉机器人，再经 **AI 判广告**——正常人自动在你的管理群里开一个独立话题转发给你，你在话题里回复就转回给对方；广告进单独的「🚫 广告拦截」话题并自动拉黑。对方只看到 bot，看不到你的账号。

跑在 **Cloudflare Workers + D1**，免费、免运维。配置全程在 Telegram 里用 `/start` 菜单点按完成，无需改代码。

## ✨ 特性

- **分层防御**：① 人机验证先挡机器人（不建话题、不调 AI，省 token）→ ② 通过的人发的内容仍过 AI 判广告 → ③ 正常消息中继到话题。
- **图形化配置菜单**：管理员私聊 bot 发 `/start`，在线编辑验证问答、关键词屏蔽、自动回复、内容类型过滤，全部内联按钮操作。
- **用户资料卡**：每个话题顶部带按钮——一键 🚫屏蔽 / 🔕静音 / 📌置顶 / 👤查看资料；屏蔽与静音状态自动汇总到「🚫 屏蔽与静音名单」话题。
- **关键词屏蔽**（超阈值自动拉黑）+ **关键词自动回复** + **细粒度内容过滤**（文本/媒体/链接/转发-用户·群组·频道/语音/贴纸）。
- AI 判广告（默认 DeepSeek，可换任意 OpenAI 兼容模型）；明显广告本地秒拦、不耗 AI。
- 每个联系人一个话题；你回复过的人之后永不再被判；过期话题可自动 / 手动清理；只认你本人操作，已做安全加固。

## 🚀 部署（命令行）

**先准备好**：① bot token（[@BotFather](https://t.me/BotFather)）② 你的 TG 用户 id（[@userinfobot](https://t.me/userinfobot)）③ 一个开启「话题/Topics」、并把 bot 设为管理员（勾「管理话题」）的群 + 它的群 id ④ Cloudflare 账号（免费）⑤ DeepSeek（或任意 OpenAI 兼容）API key。

```bash
git clone https://github.com/Bliz333/tgadx.git && cd tgadx
npm install

npx wrangler login                          # 登录 Cloudflare
npx wrangler d1 create tg-bot-db            # 把输出的 database_id 填进 wrangler.toml 的 [[d1_databases]].database_id
# 在 wrangler.toml 的 [vars] 填上 ADMIN_GROUP_ID(群id) 和 ADMIN_USER_ID(你的id)

npx wrangler secret put BOT_TOKEN           # 依次再 put：AI_API_KEY、WEBHOOK_SECRET（自定义一段随机串）
npx wrangler deploy                         # 部署，记下输出的 Worker 网址

# 绑定 webhook + 命令菜单（值替换成你自己的）：
BOT_TOKEN='...' WORKER_URL='https://tgadx.xxx.workers.dev' \
WEBHOOK_SECRET='上面那段随机串' ADMIN_GROUP_ID='-100xxxxxxxxxx' \
node scripts/setup-telegram.mjs
```

> **D1 表结构无需手动创建**：首次收到请求时代码会自动建表（`users` / `config` / `messages`）。
> 之后改了代码 `npx wrangler deploy` 重新发布即可。日志：Cloudflare 后台 → Workers & Pages → tgadx → Logs。

## ⚙️ 配置菜单（管理员私聊 bot 发 `/start`）

| 子菜单 | 能做什么 |
|---|---|
| 📝 基础配置（验证） | 开关人机验证、编辑欢迎语 / 验证问题 / 验证答案（多答案用 `|` 分隔） |
| 🤖 自动回复管理 | 新增 / 删除「关键词 ➡️ 自动回复」规则（新增格式：`关键词===回复内容`） |
| 🚫 关键词屏蔽管理 | 新增 / 删除屏蔽关键词，修改触发自动拉黑的次数阈值 |
| 🔗 按类型过滤管理 | 一键开关 8 类内容是否转发（文本/媒体/链接/转发-用户·群组·频道/语音/贴纸） |

> 验证答案建议写在 bot 简介里提示用户（真人能看简介作答，机器人通常不会）。验证开关默认开启，可在「基础配置」关闭恢复零摩擦模式。

## 🕹 管理操作

话题顶部资料卡上的**内联按钮**即可完成屏蔽 / 解禁 / 静音 / 置顶；也保留以下命令（在管理群里打 `/` 会有菜单）：

| 命令 | 作用 |
|---|---|
| `/allow <用户ID>` | 放行某人（验证通过 + 信任，之后不再判定）；救回误判 |
| `/ban` / `/unban` | 在某人话题里发，屏蔽 / 解除屏蔽 |
| `/del` | 在某话题里发，删除当前话题 |
| `/cleannow` | 立即清理过期的未回复话题 |
| `/reset <用户ID>` | 重置为新用户、重新验证 + 判定（测试用） |

## 🛡 怎么用 / 测试

- 别人正常私聊 → 先收到验证问题，答对后才会在群里建话题、你回复即可对话。
- 想测广告拦截：用一个小号通过验证后发广告 → 进「广告拦截」话题并被拉黑；**只要你不回复它**，它就一直被判，可反复测；`/reset <它的ID>` 可重来。

<details>
<summary>🧠 工作原理 & 分层流程</summary>

陌生人消息按顺序处理（`src/handlers.ts` → `handleInbound`）：

1. **验证门**（可在菜单关闭）：新人先发欢迎语 + 验证问题并置 `pending_verification`（不建话题、不调 AI）；下一条当作答案校验，答对置 `verified`。
2. **内容处理**：关键词屏蔽（命中计数，超阈值自动拉黑）→ 内容类型过滤 → 关键词自动回复。
3. **AI 门 + 中继**：已信任（你回复过）的人免判直接中继；否则本地强规则预筛（`t.me/xxxbot`、`?start=` 等直接拦）→ 否则 AI 判定（喂入正文 + 隐藏链接 + 是否转发）。判广告 → 进「广告拦截」话题，默认自动拉黑；判正常 → 建/复用带资料卡的话题转发。
4. **你回复某人一次** → 他变 `trusted`，之后自由通过、不再判、不被自动清理。

判定标准就是 `src/ai.ts` 里的系统提示词，想调宽/严改那段即可。

代码结构：入口 `src/index.ts` → 路由/业务 `src/handlers.ts` → 验证 `src/verify.ts` → 过滤 `src/filters.ts` → 资料卡/按钮 `src/cards.ts` → 配置菜单 `src/menu.ts` → AI 判定 `src/ai.ts` → D1 数据层 `src/db.ts` → Telegram 接口 `src/telegram.ts`。
</details>

<details>
<summary>⚙️ 配置项（变量 / 密钥 / 数据库）</summary>

| 位置 | 键 | 说明 |
|---|---|---|
| `wrangler.toml [vars]` | `ADMIN_GROUP_ID` | 管理群 id（负数） |
| | `ADMIN_USER_ID` | 你的 TG 用户 id |
| | `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容端点 / 模型 |
| | `CLEANUP_DAYS` | 自动清理阈值（天）；`"0"` 关闭 |
| | `AUTO_BLOCK` | `"1"` 判广告后自动拉黑；`"0"` 只拦不拉黑 |
| `wrangler.toml [triggers]` | `crons` | 定时清理（默认每天 03:00 UTC） |
| `wrangler secret` | `BOT_TOKEN` / `AI_API_KEY` / `WEBHOOK_SECRET` | 三个密钥 |
| `[[d1_databases]]` | `TG_BOT_DB` | D1 数据库（用户 / 配置 / 消息）。菜单里改的所有配置都存这里 |

> 仓库不含任何密钥：密钥用 `wrangler secret` 设、群/用户 id 填进 `wrangler.toml`；`note`/`.dev.vars` 已被 `.gitignore`。
</details>

<details>
<summary>🔒 安全加固</summary>

- 只认最高管理员本人（`ADMIN_USER_ID`）：别人进群也无法操作菜单、点按钮或冒充你回复。
- webhook 校验 fail-closed：没带正确密钥一律拒绝。
- 人机验证 + 明显广告本地预筛：挡机器人、省 AI 成本、也防 AI 提示注入绕过。
- 熟人消息写节流（6 小时），省 D1 写额度；过期话题与旧拉黑记录定期清理。
</details>

## 其它

- 旧的网页后台单文件 `dashboard/worker.js` 与 VPS 长轮询版 `server/` **暂未同步**本次 D1 + 菜单升级，仅 `src/` 为最新主版本。
- License：MIT。
