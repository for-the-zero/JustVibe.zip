// buvid3/buvid4 from bilibili's fingerprint SPI (same as src/wbpi.mjs getBuvid).
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const REFERER = 'https://www.bilibili.com';

let cache = null;

export function getBuvid() {
  // per-isolate cache; enough for one worker instance, no KV needed
  if (!cache) {
    cache = fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA, Referer: REFERER },
    })
      .then((r) => r.json())
      .then((j) => ({ buvid3: j?.data?.b_3, buvid4: j?.data?.b_4 }))
      .catch(() => ({ buvid3: 'D1296254-EAB1-36F2-A5DA-32B6318C41DD09610infoc', buvid4: '' })); // fixed fallback when WAF blocks the SPI endpoint
  }
  return cache;
}
