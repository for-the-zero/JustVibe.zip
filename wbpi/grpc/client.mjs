import http2 from 'node:http2';
import { dotnet } from '../grpc-wasm/bin/Release/net10.0/browser-wasm/AppBundle/_framework/dotnet.js';
import { getBuvid } from '../src/wbpi.mjs';

export const HOST = 'grpc.biliapi.net';
const APP_UA =
  'Mozilla/5.0 BiliDroid/7.38.0 (bbcallen@gmail.com) os/android model/NOH-AN01 ' +
  'mobi_app/android build/7380300 channel/master innerVer/7380310 osVer/12 network/2 grpc-java-cronet/1.36.1';

let _codec;
export function codec() {
  if (!_codec) {
    _codec = (async () => {
      const { getAssemblyExports, getConfig } = await dotnet.create();
      return (await getAssemblyExports(getConfig().mainAssemblyName)).Exports;
    })();
  }
  return _codec;
}

const grpcFrame = (body) =>
  Buffer.concat([
    Buffer.from([0]),
    Buffer.from([(body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255]),
    body,
  ]);

function unframe(buf) {
  const out = [];
  let o = 0;
  while (o + 5 <= buf.length) {
    const len = buf.readUInt32BE(o + 1);
    const end = o + 5 + len;
    if (end > buf.length) break;
    out.push(buf.subarray(o + 5, end));
    o = end;
  }
  return out;
}

function genTraceId() {
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

function call(path, headers, frame) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${HOST}`);
    const req = client.request({ ':method': 'POST', ':path': path, ...headers });
    const ev = { data: Buffer.alloc(0) };
    req.on('response', (h) => (ev.headers = h));
    req.on('trailers', (t) => (ev.trailers = t));
    req.on('data', (c) => (ev.data = Buffer.concat([ev.data, c])));
    req.on('end', () => {
      client.close();
      resolve(ev);
    });
    req.on('error', (e) => {
      client.close();
      reject(e);
    });
    req.end(frame);
  });
}

export async function grpcCall(path, reqType, reqMessage, replyType, credential) {
  const ex = await codec();
  const buvid = (await getBuvid()).buvid3;
  const metadata = ex.Encode(
    'bilibili.metadata.Metadata',
    JSON.stringify({ mobi_app: 'android', device: 'NOH-AN01', build: 7380300, channel: 'master', buvid, platform: 'android' })
  );
  const frame = grpcFrame(Buffer.from(ex.Encode(reqType, JSON.stringify(reqMessage || {})), 'base64'));
  const headers = {
    'content-type': 'application/grpc',
    te: 'trailers',
    'grpc-accept-encoding': 'identity,gzip',
    'user-agent': APP_UA,
    'x-bili-mid': '0',
    'x-bili-aurora-zone': '',
    'x-bili-aurora-eid': '',
    'x-bili-gaia-vtoken': '',
    'x-bili-trace-id': genTraceId(),
    buvid,
    cookie: `buvid3=${buvid}`,
    'x-bili-metadata-bin': metadata,
  };
  const ev = await call(path, headers, frame);
  const status = (ev.trailers || ev.headers || {})['grpc-status'] ?? (ev.headers || {})['grpc-status'];
  if (status !== '0') {
    const msg = (ev.trailers || ev.headers)['grpc-message'] || (ev.headers || {})['bili-status-code'] || 'unknown';
    const err = new Error(`grpc failed (status ${status}, ${msg})`);
    err.headers = ev.headers;
    err.trailers = ev.trailers;
    throw err;
  }
  const messages = unframe(ev.data).map((m) => JSON.parse(ex.Decode(replyType, m.toString('base64'))));
  return { messages, raw: ev.data, headers: ev.headers, trailers: ev.trailers };
}
