// 临时集成测试：验证 weeklyCheck 提醒逻辑（mock KV 与 Telegram API，无网络）
import worker from "./src/index.js";

function makeEnv() {
  const kvData = new Map();
  const kv = {
    get: async (k, type) => {
      const v = kvData.get(k);
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k, v) => { kvData.set(k, v); },
  };
  return {
    env: {
      TG_SUBBOT: kv,
      BOT_TOKEN: "TEST",
      ALLOWED_USERNAME: "for_the_zero",
      WEB_APP_URL: "",
      WEBHOOK_SECRET: "",
    },
    kvData,
  };
}

function fmt(d) { return d.toISOString().slice(0, 10); }
function daysFromNow(n) { return fmt(new Date(Date.now() + n * 86400000)); }

let sent = [];
function mockFetch(ok) {
  sent = [];
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok }), { headers: { "Content-Type": "application/json" } });
  };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

// ---- 场景 1：一次跨多个阈值只发一条 ----
{
  const { env, kvData } = makeEnv();
  mockFetch(true);
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "multi", url: "https://a.com/x_(1)", start: daysFromNow(-30), expire: daysFromNow(5), durationDays: 35, reminded: [] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("跨多阈值只发 1 条", sent.length === 1, "实际 " + sent.length);
  const text = sent[0] && sent[0].body.text || "";
  check("消息含剩余天数", text.includes("剩余"), text.slice(0, 50));
  check("URL 的 ) 已转义（( 无需转义）", text.includes("x_(1\\))"), text.split("打开链接](")[1]);
}

// ---- 场景 2：发送失败仍尝试，且不影响重复提醒逻辑 ----
{
  const { env, kvData } = makeEnv();
  mockFetch(false);
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "failing", url: "", start: daysFromNow(-30), expire: daysFromNow(3), durationDays: 33, reminded: [] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("发送失败仍尝试发送", sent.length === 1);
}

// ---- 场景 3：脏 expire 数据跳过不崩 ----
{
  const { env, kvData } = makeEnv();
  mockFetch(true);
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "dirty", url: "", start: "bad", expire: "not-a-date", durationDays: 1, reminded: [] },
    { id: "2", name: "good", url: "", start: daysFromNow(-30), expire: daysFromNow(2), durationDays: 32, reminded: [] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("脏数据被跳过，正常订阅仍提醒", sent.length === 1, "实际 " + sent.length);
  check("消息属于正常订阅", sent[0] && sent[0].body.text.includes("good"));
}

// ---- 场景 4：订阅单独阈值优先于全局 ----
{
  const { env, kvData } = makeEnv();
  mockFetch(true);
  kvData.set("reminders", JSON.stringify([14, 7, 0]));
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "custom", url: "", start: daysFromNow(-30), expire: daysFromNow(10), durationDays: 40, reminded: [], reminders: [12, 0] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("用订阅自己的阈值 [12,0]（剩 10 天，12 跌破、14 未设）", sent.length === 1);
}

// ---- 场景 5：允许重复提醒（每次周检都发，只要仍低于阈值）----
{
  const { env, kvData } = makeEnv();
  mockFetch(true);
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "repeat", url: "", start: daysFromNow(-30), expire: daysFromNow(5), durationDays: 35, reminded: [14, 7] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("即使之前已提醒过，再次检测仍发送", sent.length === 1, "实际 " + sent.length);
}

// ---- 场景 5b：高于阈值时不提醒 ----
{
  const { env, kvData } = makeEnv();
  mockFetch(true);
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "far", url: "", start: daysFromNow(-30), expire: daysFromNow(120), durationDays: 150, reminded: [] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("剩余天数高于所有阈值时不发", sent.length === 0, "实际 " + sent.length);
}

// ---- 场景 6：到期当天 / 已过期 文案 ----
{
  const { env, kvData } = makeEnv();
  mockFetch(true);
  kvData.set("subs", JSON.stringify([
    { id: "1", name: "today", url: "", start: daysFromNow(-30), expire: daysFromNow(0), durationDays: 30, reminded: [14, 7] },
    { id: "2", name: "past", url: "", start: daysFromNow(-40), expire: daysFromNow(-3), durationDays: 37, reminded: [14, 7] },
  ]));
  kvData.set("chats", JSON.stringify([777]));
  await worker.scheduled({}, env);
  check("剩 0 天触发当天提醒或已过期（取决于运行时刻的时区边界）", sent.some((s) => s.body.text.includes("今天到期") || s.body.text.includes("已过期")));
  check("已过期也触发", sent.some((s) => s.body.text.includes("已过期")));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
