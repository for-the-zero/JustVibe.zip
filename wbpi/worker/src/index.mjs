// Cloudflare Worker entry: HTTP front-end for the wasm gRPC codec + bilibili gRPC calls.
import { Encode, Decode, Types, b64ToBytes } from './codec.mjs';
import { grpcCall, APP_UA, genTraceId, grpcFrame } from './grpc.mjs';
import { getBuvid } from './buvid.mjs';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...cors } });

async function readBody(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return req.json();
  return req.text();
}

const ROUTES = {
  'GET /': (req, url) =>
    json({
      endpoints: {
        'GET /types': 'list registered protobuf message types',
        'POST /encode?type=T': 'body: JSON message -> base64 protobuf',
        'POST /decode?type=T': 'body: base64 protobuf -> JSON message',
        'POST /rpc': '{ path, req_type, request, reply_type } -> { messages, headers }',
        'GET /popular?idx=0': 'bilibili.app.show.v1.Popular/Index, first message',
        'GET /view?aid=2 | ?bvid=BV..': 'bilibili.app.view.v1.View/View, first message',
        'GET /debug?aid=2': 'raw upstream gRPC response (status, headers, body) for diagnosing WAF blocks',
        'GET /user/videos?mid=..': 'Bilibili REST x/space/arc/search, user video list (REST fallback)',
        'GET /user/favorites?mid=..': 'Bilibili REST x/v3/fav/folder/created/list-all, user favorite folders (REST fallback)',
      },
    }),
  'GET /types': () => text(Types().join('\n')),
  'POST /encode': async (req, url) => {
    const t = url.searchParams.get('type');
    if (!t) return json({ error: 'missing ?type' }, 400);
    try {
      return text(Encode(t, await readBody(req)));
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  },
  'POST /decode': async (req, url) => {
    const t = url.searchParams.get('type');
    if (!t) return json({ error: 'missing ?type' }, 400);
    try {
      return text(Decode(t, String(await readBody(req)).trim()));
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  },
  'POST /rpc': async (req) => {
    let b;
    try {
      b = await req.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }
    if (!b.path || !b.req_type || !b.reply_type) return json({ error: 'need path, req_type, reply_type' }, 400);
    return call(() => grpcCall(b.path, b.req_type, b.request, b.reply_type));
  },
  'GET /popular': async (req, url) => {
    const req_ = { idx: Number(url.searchParams.get('idx') || 0), login_event: 0 };
    return call(() => grpcCall('/bilibili.app.show.v1.Popular/Index', 'bilibili.app.show.v1.PopularResultReq', req_, 'bilibili.app.show.v1.PopularReply'), true);
  },
  'GET /view': async (req, url) => {
    const aid = url.searchParams.get('aid');
    const bvid = url.searchParams.get('bvid');
    if (!aid && !bvid) return json({ error: 'missing ?aid or ?bvid' }, 400);
    const req_ = bvid ? { bvid } : { aid: Number(aid) };
    return call(() => grpcCall('/bilibili.app.view.v1.View/View', 'bilibili.app.view.v1.ViewReq', req_, 'bilibili.app.view.v1.ViewReply'), true);
  },
  'GET /debug': async (req, url) => {
    const aid = url.searchParams.get('aid') || '2';
    try {
      const path = '/bilibili.app.view.v1.View/View';
      const buvid = (await getBuvid()).buvid3;
      const metadata = Encode(
        'bilibili.metadata.Metadata',
        JSON.stringify({ mobi_app: 'android', device: 'NOH-AN01', build: 7380300, channel: 'master', buvid, platform: 'android' })
      );
      const frame = grpcFrame(b64ToBytes(Encode('bilibili.app.view.v1.ViewReq', JSON.stringify({ aid: Number(aid) }))));
      const res = await fetch('https://grpc.biliapi.net' + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/grpc',
          'grpc-accept-encoding': 'identity',
          'user-agent': APP_UA,
          'referer': 'https://www.bilibili.com',
          'origin': 'https://www.bilibili.com',
          'x-bili-mid': '0',
          'x-bili-aurora-zone': '',
          'x-bili-aurora-eid': '',
          'x-bili-gaia-vtoken': '',
          'x-bili-trace-id': genTraceId(),
          buvid,
          cookie: `buvid3=${buvid}`,
          'x-bili-metadata-bin': metadata,
        },
        body: frame,
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = String.fromCharCode(...buf.slice(0, Math.min(200, buf.length)));
      return json({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers),
        grpc_status: res.headers.get('grpc-status'),
        grpc_message: res.headers.get('grpc-message'),
        body_head: head,
        body_len: buf.length,
      });
    } catch (e) {
      return json({ ok: false, error: String(e), stack: String(e.stack) }, 502);
    }
  },
  'GET /user/videos': async (req, url) => {
    const mid = url.searchParams.get('mid');
    if (!mid) return json({ error: 'missing ?mid' }, 400);
    try {
      const res = await fetch(`https://api.bilibili.com/x/space/arc/search?mid=${mid}&pn=1&ps=30`, {
        headers: { 'User-Agent': APP_UA, Referer: 'https://www.bilibili.com' },
      });
      return json(await res.json());
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
  'GET /user/favorites': async (req, url) => {
    const mid = url.searchParams.get('mid');
    if (!mid) return json({ error: 'missing ?mid' }, 400);
    try {
      const res = await fetch(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, {
        headers: { 'User-Agent': APP_UA, Referer: 'https://www.bilibili.com' },
      });
      return json(await res.json());
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};

async function call(fn, firstMessageOnly = false) {
  try {
    const r = await fn();
    return json(firstMessageOnly ? (r.messages[0] ?? null) : r);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const handler = ROUTES[`${req.method} ${url.pathname}`];
    if (!handler) return json({ error: `no route: ${req.method} ${url.pathname}` }, 404);
    return handler(req, url);
  },
};
