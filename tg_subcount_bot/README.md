# Telegram 订阅到期提醒 Bot

部署在 Cloudflare Workers 上，使用 KV 存储，每周一（UTC 01:00 / 北京时间 09:00）检测订阅到期，在**到期前 14 天、7 天和当天**发送提醒。仅允许用户 **@for_the_zero** 使用。

## 命令

| 命令 | 说明 |
|---|---|
| `/start` / `/help` | 绑定当前聊天，显示帮助 |
| `/list` | 列出所有订阅（按到期日排序，显示剩余天数与跳转链接） |
| `/add 名称 \| 链接 \| 2026-09-14` | 按到期时间添加 |
| `/add 名称 \| 链接 \| 2026-09-01 \| 3m` | 按开始时间 + 期限添加（期限支持 `30d` / `3m` / `1y`） |
| `/del 名称` | 删除订阅 |
| `/refresh 名称` | 保留期限，把开始时间重置为今天（续订后用） |

## 部署步骤

1. **创建 Bot**：在 Telegram 找 [@BotFather](https://t.me/BotFather) 创建 bot，拿到 token。

2. **创建 KV namespace 并填入 wrangler.toml**：

   ```bash
   npx wrangler kv namespace create SUBS_KV
   # 把输出的 id 填到 wrangler.toml 的 kv_namespaces.id
   ```

3. **配置 token**（不要写进代码）：

   ```bash
   npx wrangler secret put BOT_TOKEN
   # 粘贴 BotFather 给的 token
   ```

4. **部署**：

   ```bash
   npm install
   npm run deploy
   ```

5. **设置 Webhook**（把 URL 换成你的 worker 地址）：

   ```
   https://api.telegram.org/bot<你的TOKEN>/setWebhook?url=https://tg-subcount-bot.<你的子域>.workers.dev/
   ```

6. 在 Telegram 里给你的 bot 发送 `/start`，即可绑定提醒聊天并开始使用。

## Mini App 面板（可选）

bot 自带一个网页面板，可在手机上可视化地添加 / 删除 / 续期订阅：

1. 部署后，把 worker 地址（如 `https://tg-subcount-bot.<你的子域>.workers.dev`）填进 `wrangler.toml` 的 `WEB_APP_URL`，再 `npm run deploy` 一次。
2. 给 bot 发送 `/start`，消息里会出现「📅 打开订阅面板」按钮；也可以在 BotFather 用 `/setmenubutton` 把它设为输入框旁的菜单按钮。

面板身份通过 Telegram initData 的 HMAC-SHA256 签名校验，同样只允许 `ALLOWED_USERNAME`，数据与 bot 命令共用同一份 KV。

## 数据结构（KV）

- `subs`：订阅数组 `[{ id, name, url, start, expire, durationDays }]`，日期均为 `YYYY-MM-DD`（UTC）。
- `chats`：已绑定 `/start` 的聊天 id 列表，提醒会发送到这些聊天。

`/refresh` 依赖 `durationDays`；按到期时间添加的订阅会以添加当天为起点自动计算期限。

## 安全

- 消息按用户名校验，只有 `ALLOWED_USERNAME`（默认 `for_the_zero`）可用。
- 添加订阅时校验链接：仅允许 http/https，拒绝 localhost、私有和保留网段地址。
