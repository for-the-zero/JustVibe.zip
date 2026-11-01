import assert from 'node:assert';
import { getMixinKey, getWbiKeys, getUserVideos, getFavFolders, getDefaultFavFolder, getFavContents } from './src/wbpi.mjs';

const UID = 513066052;
const COOKIE = process.env.BILI_COOKIE || process.env.BILI_SESSDATA || '';

async function main() {
  const mixin = getMixinKey('7cd084941338484aae1ad9425b84077c' + '4932caff0ff746eab6f01bf08b70ac45');
  assert.strictEqual(mixin, 'ea1db124af3c7062474693fa704f4ff8', 'getMixinKey doc vector');
  assert.match(mixin, /^[0-9a-f]{32}$/);
  console.log('[ok] getMixinKey ->', mixin);

  const keys = await getWbiKeys(COOKIE);
  assert.match(keys.imgKey, /^[0-9a-f]{32}$/);
  assert.match(keys.subKey, /^[0-9a-f]{32}$/);
  console.log('[ok] wbi keys ->', keys.imgKey, keys.subKey);

  const videos = await getUserVideos({ mid: UID, ps: 10, credential: COOKIE });
  assert.ok(Array.isArray(videos?.list?.vlist), 'vlist should be array');
  console.log(`[ok] user ${UID} videos: ${videos.page.count} total, first ->`, videos.list.vlist[0]?.title);

  const folders = await getFavFolders({ mid: UID, credential: COOKIE });
  console.log(`[ok] fav folders: ${folders.length} ->`, folders.map((f) => f.title).join(' | '));
  const def = await getDefaultFavFolder({ mid: UID, credential: COOKIE });
  if (!def) {
    console.log('[skip] no default fav folder visible', COOKIE ? '' : '(set BILI_COOKIE for private data)');
    return;
  }
  console.log(`[ok] default folder -> id=${def.id} "${def.title}" media_count=${def.media_count}`);
  try {
    const fav = await getFavContents({ mediaId: def.id, ps: 20, credential: COOKIE });
    assert.ok(Array.isArray(fav?.medias), 'medias should be array');
    console.log(`[ok] default fav contents: ${fav.info.media_count} total, page ->`, fav.medias.slice(0, 3).map((m) => m.title).join(' | '));
  } catch (e) {
    console.log('[skip] fav contents need login:', e.message, COOKIE ? '' : '(set BILI_COOKIE)');
  }
  console.log('ALL CHECKS PASSED');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
