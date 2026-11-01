import assert from 'node:assert';
import { Encode, Decode, Types } from './src/codec.mjs';
import { grpcFrame, unframe } from './src/grpc.mjs';
import { codec as refCodec } from '../grpc/client.mjs';

const types = Types();
assert.ok(types.includes('bilibili.app.show.v1.PopularResultReq'));
assert.ok(types.includes('bilibili.metadata.Metadata'));
assert.ok(types.includes('bilibili.app.view.v1.ViewReply'));
console.log(`[ok] ${types.length} types registered`);

// same JSON -> identical protobuf bytes as the dotnet wasm codec
const ex = await refCodec();
const cases = [
  ['bilibili.metadata.Metadata', { mobi_app: 'android', device: 'NOH-AN01', build: 7380300, channel: 'master', buvid: 'x', platform: 'android' }],
  ['bilibili.app.show.v1.PopularResultReq', { idx: 0, login_event: 0 }],
  ['bilibili.app.view.v1.ViewReq', { aid: 2 }],
];
for (const [type, msg] of cases) {
  const mine = Encode(type, JSON.stringify(msg));
  const ref = ex.Encode(type, JSON.stringify(msg));
  assert.strictEqual(mine, ref, `encode mismatch for ${type}`);
  const round = JSON.parse(Decode(type, mine));
  assert.deepStrictEqual(round, JSON.parse(ex.Decode(type, ref)), `decode mismatch for ${type}`);
  // camelCase input must give the same bytes too
  assert.strictEqual(Encode(type, JSON.stringify(round)), mine, `camelCase encode mismatch for ${type}`);
  console.log(`[ok] ${type} -> ${mine} (matches wasm)`);
}

// framing: byte-identical to grpc/client.mjs
const body = Uint8Array.from(atob(Encode('bilibili.app.view.v1.ViewReq', '{"aid":2}')), (c) => c.charCodeAt(0));
const frame = grpcFrame(body);
assert.strictEqual(frame.length, body.length + 5);
assert.strictEqual(new DataView(frame.buffer).getUint32(1), body.length);
assert.deepStrictEqual(unframe(frame)[0], body);
assert.strictEqual(unframe(Uint8Array.from([...frame, 0, 0])).length, 1, 'truncated tail ignored');
console.log('[ok] grpc framing round-trips');

console.log('ALL CHECKS PASSED');
