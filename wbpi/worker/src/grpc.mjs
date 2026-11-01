// gRPC over fetch(), port of grpc/client.mjs (node:http2) for Cloudflare Workers.
import { Encode, Decode, b64ToBytes, bytesToB64 } from './codec.mjs';
import { getBuvid } from './buvid.mjs';

export const HOST = 'https://grpc.biliapi.net';
export const APP_UA =
  'Mozilla/5.0 BiliDroid/7.38.0 (bbcallen@gmail.com) os/android model/NOH-AN01 ' +
  'mobi_app/android build/7380300 channel/master innerVer/7380310 osVer/12 network/2 grpc-java-cronet/1.36.1';

export function grpcFrame(body) {
  const out = new Uint8Array(5 + body.length);
  out[0] = 0;
  new DataView(out.buffer).setUint32(1, body.length);
  out.set(body, 5);
  return out;
}

export function unframe(buf) {
  const out = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let o = 0; o + 5 <= buf.length; ) {
    const len = dv.getUint32(o + 1);
    const end = o + 5 + len;
    if (end > buf.length) break;
    out.push(buf.subarray(o + 5, end));
    o = end;
  }
  return out;
}

export function genTraceId() {
  const cs = '0123456789abcdefghijklmnopqrstuvwxyz';
  let r = '';
  for (let i = 0; i < 32; i++) r += cs[Math.floor(Math.random() * cs.length)];
  let rt = r.slice(0, 24);
  let ts = Math.floor(Date.now() / 1000);
  for (let i = 2; i >= 0; i--) {
    rt += (ts & 0xff).toString(16).padStart(2, '0');
    ts >>= 8;
  }
  rt += r.slice(30, 32);
  return `${rt}:${rt.slice(16, 32)}:0:0`;
}

export async function grpcCall(path, reqType, reqMessage, replyType) {
  const buvid = (await getBuvid()).buvid3;
  const metadata = Encode(
    'bilibili.metadata.Metadata',
    JSON.stringify({ mobi_app: 'android', device: 'NOH-AN01', build: 7380300, channel: 'master', buvid, platform: 'android' })
  );
  const frame = grpcFrame(b64ToBytes(Encode(reqType, JSON.stringify(reqMessage || {}))));
  const res = await fetch(HOST + path, {
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
  // fetch() hides HTTP/2 trailers, so grpc-status is only visible on trailers-only
  // (error) responses; a 200 body with frames is treated as success.
  const status = res.headers.get('grpc-status');
  const buf = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html') || (buf.length > 0 && String.fromCharCode(...buf.slice(0, Math.min(20, buf.length))).includes('<'))) {
    throw new Error(`bilibili returned HTML (${res.status} ${ct}) — likely WAF/challenge page from this Cloudflare egress IP; body: ${new TextDecoder().decode(buf.slice(0, 300))}`);
  }
  if (status !== null && status !== '0') {
    throw new Error(`grpc failed (status ${status}, ${res.headers.get('grpc-message') || 'unknown'})`);
  }
  if (!res.ok && buf.length === 0) {
    throw new Error(`grpc http ${res.status} ${res.statusText}`);
  }
  const messages = unframe(buf).map((m) => JSON.parse(Decode(replyType, bytesToB64(m))));
  return { messages, headers: Object.fromEntries(res.headers) };
}
