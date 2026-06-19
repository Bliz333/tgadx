# 网页后台零终端部署（不用装 Node、不碰命令行）

全程在浏览器里点点点即可。需要的就是 `worker.js` 这一个文件（在本目录，直接在 GitHub 上点开 → 右上 **Raw** → 全选复制）。

## 先准备
1. bot token（[@BotFather](https://t.me/BotFather)）
2. 你的 Telegram 用户 id（[@userinfobot](https://t.me/userinfobot)）
3. 一个**开启「话题/Topics」的群**，把 bot 拉进去**设为管理员**（勾「管理话题」），记下**群 id**（负数）
4. 一个 **Cloudflare 账号**（免费）
5. 一个 **DeepSeek（或任意 OpenAI 兼容）API key**

## 步骤

### 1) 建 Worker 并贴代码
1. 登录 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create** → **Create Worker**。
2. 起个名字（比如 `tgadx`）→ **Deploy**（先把默认示例部署掉）。
3. 点 **Edit code**，把编辑器里的内容**全部删掉**，粘贴 `worker.js` 的全部内容 → 右上 **Deploy**。
4. 记下 Worker 网址：`https://tgadx.<你的子域>.workers.dev`。

### 2) 建 KV 并绑定
1. 左侧 **Storage & Databases → KV** → **Create namespace**，名字随意（如 `tgadx-STATE`）→ 创建。
2. 回到你的 Worker → **Settings** → **Bindings**（或 Variables）→ **Add binding → KV namespace**：
   - **Variable name 必须填 `STATE`**
   - Namespace 选刚建的那个 → 保存。

### 3) 加变量和密钥
进 Worker → **Settings → Variables and Secrets**，逐个添加：

**普通变量（Plaintext）**
| 名称 | 值 |
|---|---|
| `ADMIN_GROUP_ID` | 你的群 id，如 `-1001234567890` |
| `ADMIN_USER_ID` | 你的 TG 用户 id |
| `AI_BASE_URL` | `https://api.deepseek.com/chat/completions` |
| `AI_MODEL` | `deepseek-v4-flash` |
| `CLEANUP_DAYS` | `30`（自动清理：未回复过的话题超过这么多天没消息就删；填 `0` 关闭） |

**密钥（选 Secret / Encrypt）**
| 名称 | 值 |
|---|---|
| `BOT_TOKEN` | 你的 bot token |
| `AI_API_KEY` | DeepSeek key |
| `WEBHOOK_SECRET` | 自己编一段随机字符串（字母+数字，越长越好，记下来下一步要用） |

保存后再点一次 **Deploy** 让绑定生效。

### 4) 绑 webhook（浏览器打开一个网址）
把下面网址里的 `<BOT_TOKEN>`、`<子域>`、`<WEBHOOK_SECRET>` 换成你的值，在浏览器打开：

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://tgadx.<子域>.workers.dev&secret_token=<WEBHOOK_SECRET>&allowed_updates=["message"]
```

看到 `{"ok":true,...}` 就成了。

### 5)（推荐）开启自动清理的定时任务
让"每天自动删未回复的过期话题"生效：进 Worker → **Settings → Triggers → Cron Triggers → Add Cron Trigger**，填 `0 3 * * *`（每天一次）→ 保存。不加这个的话，自动清理不会跑（手动 `/del`、`/cleannow` 仍可用）。

### 6)（可选）命令菜单
想在群里打 `/` 弹出命令，最省事：私聊 [@BotFather](https://t.me/BotFather) 发 `/setcommands` → 选你的 bot → 粘贴：

```
allow - 放行用户（之后不再判定）：/allow 用户ID
reset - 重置为新用户、重新AI判定：/reset 用户ID
ban - 屏蔽当前话题的联系人
unban - 解除屏蔽并信任
del - 删除当前话题（在要删的话题里发）
cleannow - 立即清理未回复过的过期话题
```

（注意：BotFather 这种方式会让命令在所有聊天里都可见。不影响安全——陌生人就算看到也用不了，只有你在管理群里有效。想做到「只对管理群可见」需要用命令行版的 `scripts/setup-telegram.mjs`。）

## 完成
用一个小号私聊 bot：正常消息会在管理群建话题；广告进「🚫 广告拦截」话题。日志看 Worker 页面的 **Logs**。

> `worker.js` 是从 `src/` 打包出来的单文件。改了 `src/` 里的源码后，需要重新打包（`npx wrangler deploy --dry-run --outdir dashboard`）再把新的 `worker.js` 贴进后台；如果你只用网页后台、不改代码，就不用管。
