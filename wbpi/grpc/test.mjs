import assert from 'node:assert';
import { grpcCall, codec } from './client.mjs';

const ex = await codec();
assert.ok(ex.Types().includes('bilibili.app.show.v1.PopularResultReq'));
assert.ok(ex.Types().includes('bilibili.metadata.Metadata'));
console.log('[ok] wasm codec types registered');

const md = ex.Encode('bilibili.metadata.Metadata', JSON.stringify({ mobi_app: 'android', buvid: 'x' }));
assert.ok(Buffer.from(md, 'base64').length > 0);
console.log('[ok] metadata encodes ->', md);

const pop = await grpcCall(
  '/bilibili.app.show.v1.Popular/Index',
  'bilibili.app.show.v1.PopularResultReq',
  { idx: 0, login_event: 0 },
  'bilibili.app.show.v1.PopularReply'
);
const items = pop.messages[0].items;
assert.ok(Array.isArray(items) && items.length > 0, 'popular items non-empty');
const titles = items.map((i) => i.smallCoverV5?.base?.title || i.base?.title).filter(Boolean);
assert.ok(titles.length > 0, 'popular has video titles');
console.log(`[ok] Popular/Index: ${items.length} items, titles ->`, titles.slice(0, 3).join(' | '));

const view = await grpcCall(
  '/bilibili.app.view.v1.View/View',
  'bilibili.app.view.v1.ViewReq',
  { aid: 2 },
  'bilibili.app.view.v1.ViewReply'
);
const reply = view.messages[0];
const arc = reply.arc;
assert.strictEqual(reply.bvid, 'BV1xx411c7mD', 'av2 -> BV1xx411c7mD');
assert.ok(arc.title, 'view has title');
console.log(`[ok] View/View av2: bvid=${reply.bvid} title="${arc.title}"`);

console.log('ALL CHECKS PASSED');
