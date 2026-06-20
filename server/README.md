# VPS 版（备用）：在自己的服务器常驻运行

不想用 Cloudflare、想直接在一台服务器上跑，用这里的 `tgbot.mjs`：纯 Node、无第三方依赖、长轮询，**不需要域名 / HTTPS / webhook**。功能和 Cloudflare 版一致。

> ⚠️ 同一个 bot **只能用一种**接收方式。如果之前用过 Cloudflare（webhook），切到这里前先调用一次
> `https://api.telegram.org/bot<token>/deleteWebhook` 取消 webhook，否则长轮询会冲突。

## 部署（服务器需 Node 18+）

```bash
mkdir -p /opt/tgadx && cp tgbot.mjs /opt/tgadx/

# 写环境变量文件（chmod 600，勿提交）
cat > /opt/tgadx/tgadx.env <<'ENV'
BOT_TOKEN=你的bot token
ADMIN_GROUP_ID=-100xxxxxxxxxx
ADMIN_USER_ID=你的TG用户id
AI_BASE_URL=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-v4-flash
AI_API_KEY=你的DeepSeek key
STATE_FILE=/opt/tgadx/state.json
ENV
chmod 600 /opt/tgadx/tgadx.env

# 用 systemd 常驻
cp tgadx.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tgadx

systemctl status tgadx      # 看状态
journalctl -u tgadx -f      # 看实时日志
```

## 备注

- 状态存在本地 `STATE_FILE`（JSON）。
- 这一版是早期实现：有广告隔离话题、`/allow`、链接提取、关思考；但**没有** Cloudflare 版后来加的关键词预筛、自动拉黑、judge-until-reply、话题清理、`/reset /del /cleannow` 等。功能以 Cloudflare 版（`src/`）为准，需要可参照 `src/handlers.ts` 同步过来。
- 彻底删除：`systemctl disable --now tgadx && rm -rf /opt/tgadx /etc/systemd/system/tgadx.service && systemctl daemon-reload`。
