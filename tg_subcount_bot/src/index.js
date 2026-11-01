/**
 * Telegram 订阅到期提醒 Bot — Cloudflare Workers + KV
 *
 * Bot 命令：
 *   /start                绑定当前聊天、显示帮助和应用入口
 *   /help                 帮助
 *   /list                 列出所有订阅及剩余天数
 *   /add 名称 | 链接 | 2026-09-14            按到期时间添加
 *   /add 名称 | 链接 | 2026-09-01 | 3m       按开始时间 + 期限添加
 *   /del 名称             删除订阅
 *   /refresh 名称         保留期限，把开始时间重置为今天
 *   /remind [阈值...]     自定义提醒阈值，如 120d 1w 2w（可多个）
 *
 * Web App（Mini App）：
 *   GET  /            面板页面
 *   POST /api/subs    列表       POST /api/add  添加
 *   POST /api/del     删除       POST /api/refresh 续期
 *   均以 Authorization: tma <initData> 校验身份
 *
 * Cron：每天 09:00（北京时间）检测，进入自定义阈值期（默认到期前 14/7/0 天）后每天提醒。
 */

const SUBS_KEY = "subs";
const CHATS_KEY = "chats";
const REMINDERS_KEY = "reminders";
// 默认提醒阈值：到期前 14 / 7 / 0 天
const DEFAULT_REMINDERS = [14, 7, 0];

// 注意：MarkdownV2 中反引号代码块内只能转义 \ 和 `，其余特殊字符原样保留
const HELP = [
  "📅 *订阅到期提醒 Bot*",
  "",
  "`/list` — 列出所有订阅",
  "`/add 名称 \\| 链接 \\| 到期日` — 按到期时间添加，如：",
  "`/add ChatGPT | https://example.com | 2026-09-14`",
  "`/add 名称 \\| 链接 \\| 开始日 \\| 期限` — 按期限添加，期限如 `30d` / `3m` / `1y`：",
  "`/add Netflix | https://example.com | 2026-09-01 | 3m`",
  "`/del 名称` — 删除订阅",
  "`/refresh 名称` — 保留期限，开始时间重置为今天",
  "`/remind` — 查看默认提醒阈值",
  "`/remind 120d 1w 2w` — 设默认阈值（可多个，0 即到期当天）",
  "`/remind 名称 120d 1w` — 给某订阅单独设阈值",
].join("\n");

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      // 从 env 中读取配置
      const BOT_TOKEN = env.BOT_TOKEN;
      const WEBHOOK_SECRET = env.WEBHOOK_SECRET;
      const WEB_APP_URL = env.WEB_APP_URL;
      const ALLOWED_USERNAME = env.ALLOWED_USERNAME;

      if (request.method === "GET" && (path === "/" || path === "/app")) {
        return new Response(HTML_PAGE, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (request.method === "POST" && path.startsWith("/api/")) {
        return handleApi(request, path, env);
      }

      if (request.method === "POST") {
        // 校验 Telegram 携带的 secret_token
        if (WEBHOOK_SECRET) {
          const headerToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
          if (headerToken !== WEBHOOK_SECRET) {
            return new Response("unauthorized", { status: 401 });
          }
        }
        const update = await request.json();
        if (update.message) await handleMessage(update.message, env);
        return new Response("ok");
      }
      return new Response("ok");
    } catch (err) {
      // 返回详细错误方便排查，生产环境可改为通用信息
      console.error("Worker fetch error:", err);
      return new Response(`Internal Server Error: ${err.message || err}`, { status: 500 });
    }
  },

  async scheduled(event, env) {
    // 从 env 中读取配置（仅 dailyCheck 需要 TG_SUBBOT，它是全局绑定）
    await dailyCheck(env);
  },
};

// ---------- Telegram Bot API ----------

async function tg(method, body, BOT_TOKEN) {
  const url = new URL("https://api.telegram.org");
  url.pathname = "/bot" + BOT_TOKEN + "/" + encodeURIComponent(method);
  const res = await fetch(url.href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function sendMessage(chatId, text, extra, BOT_TOKEN) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
    ...extra,
  }, BOT_TOKEN);
}

// 操作结果等含用户文本的消息：不带 parse_mode，避免 Markdown 解析失败
function sendPlain(chatId, text, BOT_TOKEN) {
  return tg("sendMessage", { chat_id: chatId, text }, BOT_TOKEN);
}

function mdEscape(s) {
  // MarkdownV2: escape all special chars in plain text
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// MarkdownV2 代码块内只需转义 ` 和 \
function mdCode(s) {
  return "`" + s.replace(/([`\\])/g, "\\$1") + "`";
}

// ---------- 存储 ----------

async function getSubs(env) {
  return (await env.TG_SUBBOT.get(SUBS_KEY, "json")) || [];
}
async function saveSubs(subs, env) {
  await env.TG_SUBBOT.put(SUBS_KEY, JSON.stringify(subs));
}
async function getChats(env) {
  return (await env.TG_SUBBOT.get(CHATS_KEY, "json")) || [];
}
async function addChat(chatId, env) {
  const chats = await getChats(env);
  if (!chats.includes(chatId)) {
    chats.push(chatId);
    await env.TG_SUBBOT.put(CHATS_KEY, JSON.stringify(chats));
  }
}

// 提醒阈值（到期前天数列表，降序），全局生效
async function getReminders(env) {
  const v = await env.TG_SUBBOT.get(REMINDERS_KEY, "json");
  if (Array.isArray(v) && v.length && v.every((n) => typeof n === "number" && n >= 0)) {
    return [...new Set(v)].sort((a, b) => b - a);
  }
  return [...DEFAULT_REMINDERS];
}
async function saveReminders(days, env) {
  await env.TG_SUBBOT.put(REMINDERS_KEY, JSON.stringify(days));
}

// ---------- 日期工具 ----------

function parseDate(s) {
  if (typeof s !== "string") return null;
  const parts = s.trim().split("-");
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if ([y, mo, d].some((n) => isNaN(n) || n <= 0)) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(date.getTime())) return null;
  // 防止 2026-13-01 之类被自动进位
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function todayUTC() {
  return new Date();
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// 期限解析："30d" / "3m" / "1y" -> 天数
function parseDuration(s) {
  if (typeof s !== "string") return null;
  s = s.trim().toLowerCase();
  if (!s) return null;
  // 纯数字按天计，0 表示到期当天
  if (s !== "" && [...s].every((c) => c >= "0" && c <= "9")) return parseInt(s, 10);
  const unit = s.slice(-1);
  const num = parseInt(s.slice(0, -1), 10);
  if (isNaN(num)) return null;
  if (unit === "d") return num;
  if (unit === "w") return num * 7;
  if (unit === "m") return num * 30;
  if (unit === "y") return num * 365;
  return null;
}

// ---------- URL 校验（仅 http/https，拒绝本地/私有/保留地址） ----------

function isSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  // IPv4 字面量：拒绝环回 / 私有 / 保留段
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  // IPv6 字面量：拒绝环回、未指定与唯一本地地址
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return false;
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return false;
  }
  return true;
}

// ---------- 核心操作（bot 命令与 Web App 共用） ----------

async function coreAdd(name, url, d1, d2, env) {
  if (!name || !url || !d1) return { ok: false, error: "名称、链接、日期均不能为空。" };
  if (!isSafeUrl(url)) return { ok: false, error: "链接无效（仅支持 http/https 公网地址）。" };
  let start, expire, durationDays;
  if (d2) {
    start = parseDate(d1);
    durationDays = parseDuration(d2);
    if (!start || !durationDays) return { ok: false, error: "日期格式应为 YYYY-MM-DD，期限如 30d / 3m / 1y。" };
    expire = new Date(start.getTime() + durationDays * 86400000);
  } else {
    expire = parseDate(d1);
    if (!expire) return { ok: false, error: "日期格式应为 YYYY-MM-DD。" };
    start = todayUTC();
    durationDays = daysBetween(start, expire);
  }
  const subs = await getSubs(env);
  if (subs.some((s) => s.name === name)) return { ok: false, error: "已存在同名订阅。" };
  subs.push({
    id: crypto.randomUUID(),
    name,
    url,
    start: fmtDate(start),
    expire: fmtDate(expire),
    durationDays,
  });
  await saveSubs(subs, env);
  return { ok: true, message: `已添加，到期 ${fmtDate(expire)}，期限 ${durationDays} 天。` };
}

async function coreDel(name, env) {
  const subs = await getSubs(env);
  const idx = subs.findIndex((s) => s.name === name);
  if (idx === -1) return { ok: false, error: "未找到该订阅。" };
  const removed = subs.splice(idx, 1)[0];
  await saveSubs(subs, env);
  return { ok: true, message: `已删除 ${removed.name}。` };
}

async function coreRefresh(name, env) {
  const subs = await getSubs(env);
  const sub = subs.find((s) => s.name === name);
  if (!sub) return { ok: false, error: "未找到该订阅。" };
  const start = todayUTC();
  const dur = sub.durationDays || daysBetween(parseDate(sub.start), parseDate(sub.expire));
  sub.start = fmtDate(start);
  sub.durationDays = dur;
  sub.expire = fmtDate(new Date(start.getTime() + dur * 86400000));
  await saveSubs(subs, env);
  return { ok: true, message: `已刷新，新到期日 ${sub.expire}。` };
}

function listWithStatus(subs) {
  const now = todayUTC();
  return subs
    .map((s) => ({
      name: s.name,
      url: s.url,
      start: s.start,
      expire: s.expire,
      durationDays: s.durationDays,
      daysLeft: daysBetween(now, parseDate(s.expire)),
    }))
    .sort((a, b) => a.expire.localeCompare(b.expire));
}

// 把天数列表转成可读文字，如 [120,7,0] -> "120天、7天、到期当天"
function fmtDurList(days) {
  return days.map((d) => (d <= 0 ? "到期当天" : d + "天")).join("、");
}

// ---------- Bot 消息处理 ----------

async function handleMessage(msg, env) {
  const { BOT_TOKEN, ALLOWED_USERNAME, WEB_APP_URL } = env;
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const allowed = (ALLOWED_USERNAME || "").replace(/^@/, "");
  if (!allowed || (from.username || "").toLowerCase() !== allowed.toLowerCase()) {
    await sendMessage(chatId, "⛔ 你没有权限使用这个 bot。", {}, BOT_TOKEN);
    return;
  }
  await addChat(chatId, env);

  const text = (msg.text || "").trim();
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  try {
    if (cmd === "/start") {
      await sendMessage(chatId, "📅 *订阅到期提醒 Bot*\n\n" + HELP, {
        reply_markup: {
          inline_keyboard: WEB_APP_URL
            ? [[{ text: "📅 打开订阅面板", web_app: { url: WEB_APP_URL } }]]
            : [],
        },
      }, BOT_TOKEN);
    } else if (cmd === "/help") {
      await sendMessage(chatId, HELP, {}, BOT_TOKEN);
    } else if (cmd === "/list") {
      const subs = listWithStatus(await getSubs(env));
      if (!subs.length) {
        await sendMessage(chatId, "暂无订阅，用 /add 添加。", {}, BOT_TOKEN);
        return;
      }
      const lines = subs.map((s) => {
        let status;
        if (s.daysLeft > 0) status = "剩余 *" + s.daysLeft + "* 天";
        else if (s.daysLeft === 0) status = "⚠️ *今天到期*";
        else status = "已过期 *" + -s.daysLeft + "* 天";
        const link = s.url ? "  [打开链接](" + mdLinkUrl(s.url) + ")" : "";
        return "• *" + mdEscape(s.name) + "* — 到期 `" + s.expire + "`，" + status + link;
      });
      await sendMessage(chatId, "📋 *订阅列表*\n\n" + lines.join("\n"), {}, BOT_TOKEN);
    } else if (cmd === "/add") {
      const body = text.replace(/^\/\S+\s*/, "");
      const parts = body.split("|").map((p) => p.trim());
      if (parts.length < 3 || parts.length > 4) {
        await sendMessage(chatId, "用法：`/add 名称 | 链接 | 到期日` 或 `/add 名称 | 链接 | 开始日 | 期限`", {}, BOT_TOKEN);
        return;
      }
      const r = await coreAdd(parts[0], parts[1], parts[2], parts[3], env);
      await sendPlain(chatId, (r.ok ? "✅ " : "❌ ") + (r.ok ? r.message : r.error), BOT_TOKEN);
    } else if (cmd === "/del" || cmd === "/delete" || cmd === "/rm") {
      const name = text.replace(/^\/\S+\s*/, "").trim();
      if (!name) {
        await sendMessage(chatId, "用法：`/del 名称`", {}, BOT_TOKEN);
        return;
      }
      const r = await coreDel(name, env);
      await sendPlain(chatId, (r.ok ? "🗑 " : "❌ ") + (r.ok ? r.message : r.error), BOT_TOKEN);
    } else if (cmd === "/remind" || cmd === "/setremind") {
      const body = text.replace(/^\/\S+\s*/, "").trim();
      const subs = await getSubs(env);
      if (!body) {
        const cur = await getReminders(env);
        await sendPlain(
          chatId,
          "默认提醒阈值（到期前）：" + fmtDurList(cur)
            + "\n\n设默认：/remind 120d 1w 2w\n设某订阅：/remind 名称 120d 1w 2w\n查看某订阅：/remind 名称",
          BOT_TOKEN
        );
        return;
      }
      const toks = body.split(/\s+/);
      // 首个 token 不是期限则视为订阅名；不存在时明确报错
      let target = null;
      if (parseDuration(toks[0]) == null) {
        const hit = subs.find((s) => s.name === toks[0]);
        if (hit) { target = toks[0]; toks.shift(); }
        else {
          await sendPlain(chatId, "❌ 未找到订阅「" + toks[0] + "」，用 /list 查看名称。", BOT_TOKEN);
          return;
        }
      }
      // 仅「名称」无期限 -> 查看该订阅的阈值
      if (target && toks.length === 0) {
        const sub = subs.find((s) => s.name === target);
        const list = sub.reminders && sub.reminders.length ? sub.reminders : await getReminders(env);
        await sendPlain(chatId, "「" + target + "」提醒阈值（到期前）：" + fmtDurList(list), BOT_TOKEN);
        return;
      }
      const days = [];
      for (const tok of toks) {
        const d = parseDuration(tok);
        if (d == null) {
          await sendPlain(chatId, "❌ 无效阈值：" + tok + "（支持 30d / 2w / 3m / 1y，0=到期当天）", BOT_TOKEN);
          return;
        }
        days.push(d);
      }
      if (!days.length) {
        await sendPlain(chatId, "❌ 请提供至少一个时间，如 120d 1w 2w", BOT_TOKEN);
        return;
      }
      const uniq = [...new Set(days)].sort((a, b) => b - a);
      if (target) {
        const sub = subs.find((s) => s.name === target);
        sub.reminders = uniq;
        await saveSubs(subs, env);
        await sendPlain(chatId, "✅ 「" + target + "」提醒阈值设为：" + fmtDurList(uniq), BOT_TOKEN);
      } else {
        await saveReminders(uniq, env);
        await sendPlain(chatId, "✅ 默认提醒阈值设为：" + fmtDurList(uniq) + "\n（未单独设阈值的订阅按此默认提醒）", BOT_TOKEN);
      }
    } else if (cmd === "/refresh") {
      const name = text.replace(/^\/\S+\s*/, "").trim();
      if (!name) {
        await sendMessage(chatId, "用法：`/refresh 名称`", {}, BOT_TOKEN);
        return;
      }
      const r = await coreRefresh(name, env);
      await sendPlain(chatId, (r.ok ? "🔄 " : "❌ ") + (r.ok ? r.message : r.error), BOT_TOKEN);
    } else {
      await sendMessage(chatId, "未知命令，发送 /help 查看帮助。", {}, BOT_TOKEN);
    }
  } catch (e) {
    await sendMessage(chatId, "❌ 出错：" + mdEscape(String(e && e.message ? e.message : e)), {}, BOT_TOKEN);
  }
}

// ---------- Web App：initData 校验 ----------

async function hmacHex(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// 按 Telegram Mini App 规范校验 initData 的 hash
async function validateInitData(initData, BOT_TOKEN) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const dataCheckString = pairs.map((kv) => kv.join("=")).join("\n");
  const secret = await hmacHex(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const computed = await hmacHex(hexToBytes(secret), dataCheckString);
  if (computed !== hash) return null;
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // 24h 有效
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handleApi(request, path, env) {
  const { BOT_TOKEN, ALLOWED_USERNAME } = env;
  const auth = request.headers.get("Authorization") || "";
  const initData = auth.startsWith("tma ") ? auth.slice(4) : "";
  const user = await validateInitData(initData, BOT_TOKEN);
  const allowed = (ALLOWED_USERNAME || "").replace(/^@/, "").toLowerCase();
  if (!user || (user.username || "").toLowerCase() !== allowed) {
    return jsonResp({ ok: false, error: "无权限" }, 403);
  }

  const body = await request.json().catch(() => ({}));
  switch (path) {
    case "/api/subs":
      return jsonResp({ ok: true, subs: listWithStatus(await getSubs(env)) });
    case "/api/add":
      return jsonResp(await coreAdd((body.name || "").trim(), (body.url || "").trim(), body.date || "", body.duration || "", env));
    case "/api/del":
      return jsonResp(await coreDel((body.name || "").trim(), env));
    case "/api/refresh":
      return jsonResp(await coreRefresh((body.name || "").trim(), env));
    default:
      return jsonResp({ ok: false, error: "未知接口" }, 404);
  }
}

// ---------- 每日检测（cron 每天 09:00 北京时间触发） ----------

// MarkdownV2 行内链接的 URL 里 ) 和 \ 必须转义，否则整条消息被拒
function mdLinkUrl(url) {
  return url.split("\\").join("\\\\").split(")").join("\\)");
}

async function dailyCheck(env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const subs = await getSubs(env);
  const chats = await getChats(env);
  if (!subs.length || !chats.length) return;
  const globalThresholds = await getReminders(env);

  const now = todayUTC();
  const due = [];
  for (const sub of subs) {
    const expireDate = parseDate(sub.expire);
    if (!expireDate) continue; // 脏数据跳过，避免 NaN 比较导致永不提醒
    const left = daysBetween(now, expireDate);
    // 订阅单独设置过阈值则用它，否则回退全局默认；
    // 剩余天数落入任一阈值即提醒，**每天重复**，直到用户 /refresh 续期
    const thresholds =
      sub.reminders && sub.reminders.length
        ? [...new Set(sub.reminders)].sort((a, b) => b - a)
        : globalThresholds;
    if (thresholds.some((t) => left <= t)) due.push({ sub, left });
  }
  if (!due.length) return;

  // 到期日近的先发
  due.sort((a, b) => a.left - b.left);
  for (const { sub, left } of due) {
    const when =
      left < 0 ? "⚠️ *已过期*（" + -left + " 天）"
      : left === 0 ? "⚠️ *今天到期！*"
      : "⏰ *到期提醒*（剩余 *" + left + "* 天）";
    const link = sub.url ? "\n[打开链接](" + mdLinkUrl(sub.url) + ")" : "";
    for (const chatId of chats) {
      await sendMessage(
        chatId,
        when + "\n*" + mdEscape(sub.name) + "* 到期日 `" + sub.expire + "`" + link
          + "\n\n续订后用 " + mdCode("/refresh " + sub.name) + " 重置。",
        {},
        BOT_TOKEN
      );
    }
  }
}

// ---------- Mini App 页面 ----------
// 列表渲染不把任何数据拼进 JS 代码字符串：按钮只带 data-index，
// 点击时用事件委托从当前数组取值，避免代码注入。

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>订阅面板</title>
<script src="https://telegram.org/js/telegram-web-app.js"><\/script>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: var(--tg-theme-bg-color, #ffffff); color: var(--tg-theme-text-color, #000000); }
  header { height: 48px; display: flex; align-items: center; justify-content: space-between;
           padding: 0 12px; background: var(--tg-theme-header-bg-color, var(--tg-theme-button-color, #2481cc));
           color: var(--tg-theme-header-text-color, #ffffff); }
  header .title { font-size: 17px; font-weight: 600; }
  .header-btn { background: transparent; border: 0; color: inherit; font-size: 18px; cursor: pointer; padding: 4px; }
  #toast { position: fixed; left: 50%; top: 56px; transform: translateX(-50%);
           padding: 6px 14px; border-radius: 16px; font-size: 13px; color: #fff;
           background: rgba(0,0,0,.75); pointer-events: none; opacity: 0; transition: opacity .2s; z-index: 20; }
  #toast.show { opacity: 1; }
  .list-wrap { padding: 10px 12px 76px; }
  .empty { text-align: center; padding: 60px 12px; color: var(--tg-theme-hint-color, #8e8e93); font-size: 15px; }
  .sub { border: 1px solid var(--tg-theme-hint-color, #c7c7cc); border-radius: 16px;
         padding: 12px 14px; margin-bottom: 10px;
         background: var(--tg-theme-secondary-bg-color, #f4f5f7);
         color: var(--tg-theme-text-color, #000000); }
  .sub .name { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .sub .meta { font-size: 13px; opacity: .85; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-block; border-radius: 10px; padding: 2px 10px; font-size: 12px; font-weight: 600;
           margin-left: 8px; color: #fff; }
  .badge.danger { background: #ed3f2f; } .badge.warn { background: #f4a100; }
  .badge.info { background: #2481cc; } .badge.ok { background: #6db44f; }
  .sub .actions { display: flex; gap: 6px; margin-top: 6px; }
  .sub .btn { flex: 1; border: 0; border-radius: 10px; padding: 6px 0; font-size: 13px; font-weight: 600; cursor: pointer;
              text-decoration: none; }
  .sub .btn.primary { background: var(--tg-theme-button-color, #2481cc); color: var(--tg-theme-button-text-color, #fff); }
  .sub .btn.ghost { background: transparent; color: var(--tg-theme-button-color, #2481cc); border: 1px solid var(--tg-theme-button-color, #2481cc); }
  footer.add-bar { position: fixed; bottom: env(safe-area-inset-bottom, 0); left: 0; right: 0;
                   padding: 10px 12px; background: var(--tg-theme-bg-color, #ffffff);
                   border-top: 1px solid var(--tg-theme-hint-color, #c7c7cc); z-index: 15; }
  footer.add-bar form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  footer.add-bar input { flex: 1 1 120px; min-width: 90px; padding: 7px 10px; border-radius: 10px;
                         border: 1px solid var(--tg-theme-hint-color, #c7c7cc);
                         background: var(--tg-theme-secondary-bg-color, #f4f5f7);
                         color: var(--tg-theme-text-color, #000000); font-size: 13px; }
  footer.add-bar button { flex-shrink: 0; border: 0; border-radius: 10px; padding: 7px 16px;
                          background: var(--tg-theme-button-color, #2481cc);
                          color: var(--tg-theme-button-text-color, #fff); font-size: 13px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<header>
  <div class="title">📅 订阅面板</div>
  <button class="header-btn" id="btn-refresh-list" title="刷新">↻</button>
</header>
<div id="toast"></div>
<div class="list-wrap" id="list"><div class="empty">加载中…</div></div>
<footer class="add-bar">
  <form id="add-form">
    <input id="f-name" placeholder="名称" required>
    <input id="f-url" placeholder="链接 https://..." required>
    <input id="f-date" type="date" required>
    <input id="f-dur" placeholder="期限 30d/3m/1y">
    <button type="submit">添加</button>
  </form>
</footer>

<script>
var tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

var current = [];

function api(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { Authorization: "tma " + tg.initData, "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  }).then(function (r) { return r.json(); });
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function badgeHtml(daysLeft) {
  var text = daysLeft < 0 ? "已过期 " + (-daysLeft) + " 天"
    : daysLeft === 0 ? "今天到期"
    : daysLeft <= 7 ? "剩余 " + daysLeft + " 天"
    : daysLeft <= 14 ? "剩余 " + daysLeft + " 天"
    : "";
  var cls = daysLeft < 0 ? " danger"
    : daysLeft === 0 ? " danger"
    : daysLeft <= 7 ? " warn"
    : daysLeft <= 14 ? " info"
    : " ok";
  return text ? '<span class="badge' + cls + '">' + text + "</span>" : "";
}

function render(subs) {
  current = subs;
  var list = document.getElementById("list");
  if (!subs.length) {
    list.innerHTML = '<div class="empty">暂无订阅，下方添加一个吧</div>';
    return;
  }
  list.innerHTML = subs.map(function (s, i) {
    var link = s.url
      ? '<a class="btn ghost" href="' + esc(s.url) + '" target="_blank" rel="noopener">链接</a>'
      : "";
    return '<div class="sub">'
      + '<div class="name">' + esc(s.name) + "</div>"
      + '<div class="meta">到期 ' + esc(s.expire) + " " + badgeHtml(s.daysLeft) + "</div>"
      + '<div class="actions">'
      + '<button class="btn primary" data-act="refresh" data-index="' + i + '">续期</button>'
      + '<button class="btn ghost" data-act="del" data-index="' + i + '">删除</button>'
      + link
      + "</div></div>";
  }).join("");
}

function notify(text, ok) {
  var toast = document.getElementById("toast");
  toast.textContent = text;
  toast.style.background = ok ? "var(--tg-theme-button-color, #2481cc)" : "#ed3f2f";
  toast.classList.add("show");
  setTimeout(function () { toast.classList.remove("show"); }, 2000);
}

function load() {
  api("/api/subs").then(function (data) {
    if (data.ok) { render(data.subs); notify("已加载 " + data.subs.length + " 个订阅", true); }
    else notify(data.error || "加载失败", false);
  });
}

document.getElementById("btn-refresh-list").addEventListener("click", load);

document.getElementById("list").addEventListener("click", function (ev) {
  var btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  var sub = current[parseInt(btn.getAttribute("data-index"), 10)];
  if (!sub) return;
  var call = btn.getAttribute("data-act") === "del"
    ? api("/api/del", { name: sub.name })
    : api("/api/refresh", { name: sub.name });
  call.then(function (data) {
    notify(data.ok ? data.message : data.error, data.ok);
    if (data.ok) load();
  });
});

document.getElementById("add-form").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var name = document.getElementById("f-name").value.trim();
  var url = document.getElementById("f-url").value.trim();
  var date = document.getElementById("f-date").value;
  var duration = document.getElementById("f-dur").value.trim();
  if (!name || !url || !date) { notify("请填写名称、链接和日期", false); return; }
  api("/api/add", { name: name, url: url, date: date, duration: duration }).then(function (data) {
    notify(data.ok ? data.message : data.error, data.ok);
    if (data.ok) { document.getElementById("add-form").reset(); load(); }
  });
});

load();
<\/script>
</body>
</html>`;
