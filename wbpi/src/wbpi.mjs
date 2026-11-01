import { createHash } from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const REFERER = 'https://www.bilibili.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (s) => createHash('md5').update(s).digest('hex');

const rand2 = () => {
  const s = 'ABCDEFGHIJK';
  return s[Math.floor(Math.random() * s.length)] + s[Math.floor(Math.random() * s.length)];
};

export function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n] ?? '').join('').slice(0, 32);
}

export function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const p = { ...params, wts: Math.round(Date.now() / 1000) };
  if (!p.web_location) p.web_location = 1550101;
  const query = Object.keys(p)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

export function parseCookie(cookie) {
  const o = {};
  for (const part of String(cookie).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 'SESSDATA') o.sessdata = v;
    else if (k === 'bili_jct') o.biliJct = v;
    else if (k === 'buvid3') o.buvid3 = v;
    else if (k === 'buvid4') o.buvid4 = v;
    else if (k === 'DedeUserID') o.dedeUserID = v;
    else if (k === 'ac_time_value') o.acTimeValue = v;
  }
  return o;
}

function normalizeCredential(credential) {
  if (credential == null) return {};
  return typeof credential === 'string' ? parseCookie(credential) : credential;
}

const MASK = (1n << 64n) - 1n;
const rotl = (x, k) => ((x << BigInt(k)) | (x >> BigInt(64 - k))) & MASK;
const fmix64 = (k) => {
  const C1 = 0xff51afd7ed558ccdn;
  const C2 = 0xc4ceb9fe1a85ec53n;
  let t = k;
  t ^= t >> 33n;
  t = (t * C1) & MASK;
  t ^= t >> 33n;
  t = (t * C2) & MASK;
  t ^= t >> 33n;
  return t;
};

function murmur3(bytes, seed) {
  const C1 = 0x87c37b91114253d5n;
  const C2 = 0x4cf5ad432745937fn;
  const C3 = 0x52dce729n;
  const C4 = 0x38495ab5n;
  let h1 = BigInt(seed);
  let h2 = BigInt(seed);
  let off = 0;
  let processed = 0;
  const n = bytes.length;
  for (;;) {
    const rem = n - off;
    if (rem >= 16) {
      let k1 = 0n;
      let k2 = 0n;
      for (let i = 7; i >= 0; i--) k1 = (k1 << 8n) | BigInt(bytes[off + i]);
      for (let i = 7; i >= 0; i--) k2 = (k2 << 8n) | BigInt(bytes[off + 8 + i]);
      off += 16;
      processed += 16;
      h1 ^= (rotl((k1 * C1) & MASK, 31) * C2) & MASK;
      h1 = ((rotl(h1, 27) + h2) * 5n + C3) & MASK;
      h2 ^= (rotl((k2 * C2) & MASK, 33) * C1) & MASK;
      h2 = ((rotl(h2, 31) + h1) * 5n + C4) & MASK;
    } else if (rem === 0) {
      h1 ^= BigInt(processed);
      h2 ^= BigInt(processed);
      h1 = (h1 + h2) & MASK;
      h2 = (h2 + h1) & MASK;
      h1 = fmix64(h1);
      h2 = fmix64(h2);
      h1 = (h1 + h2) & MASK;
      h2 = (h2 + h1) & MASK;
      return (h2 << 64n) | h1;
    } else {
      let k1 = 0n;
      let k2 = 0n;
      if (rem >= 15) k2 ^= BigInt(bytes[off + 14]) << 48n;
      if (rem >= 14) k2 ^= BigInt(bytes[off + 13]) << 40n;
      if (rem >= 13) k2 ^= BigInt(bytes[off + 12]) << 32n;
      if (rem >= 12) k2 ^= BigInt(bytes[off + 11]) << 24n;
      if (rem >= 11) k2 ^= BigInt(bytes[off + 10]) << 16n;
      if (rem >= 10) k2 ^= BigInt(bytes[off + 9]) << 8n;
      if (rem >= 9) {
        k2 ^= BigInt(bytes[off + 8]);
        k2 = (rotl((k2 * C2) & MASK, 33) * C1) & MASK;
        h2 ^= k2;
      }
      if (rem >= 8) k1 ^= BigInt(bytes[off + 7]) << 56n;
      if (rem >= 7) k1 ^= BigInt(bytes[off + 6]) << 48n;
      if (rem >= 6) k1 ^= BigInt(bytes[off + 5]) << 40n;
      if (rem >= 5) k1 ^= BigInt(bytes[off + 4]) << 32n;
      if (rem >= 4) k1 ^= BigInt(bytes[off + 3]) << 24n;
      if (rem >= 3) k1 ^= BigInt(bytes[off + 2]) << 16n;
      if (rem >= 2) k1 ^= BigInt(bytes[off + 1]) << 8n;
      if (rem >= 1) k1 ^= BigInt(bytes[off]);
      k1 = (rotl((k1 * C1) & MASK, 31) * C2) & MASK;
      h1 ^= k1;
      off += rem;
      processed += rem;
    }
  }
}

// ponytail: gaia 风控指纹, 抄自 bilibili-api-python 的实现 (murmur3_x64_128 + 固定上报体)。
// 目的：让 space/wbi/* 这类重风控接口返回 200 而不是 412；省略它则命中率约 1/8。
const FP_AB =
  '{"in_new_ab":true,"ab_version":{"remove_back_version":"REMOVE","login_dialog_version":"V_PLAYER_PLAY_TOAST","open_recommend_blank":"SELF","storage_back_btn":"HIDE","call_pc_app":"FORBID","clean_version_old":"GO_NEW","optimize_fmp_version":"LOADED_METADATA","for_ai_home_version":"V_OTHER","bmg_fallback_version":"DEFAULT","ai_summary_version":"SHOW","weixin_popup_block":"ENABLE","rcmd_tab_version":"DISABLE","in_new_ab":true},"ab_split_num":{"remove_back_version":11,"login_dialog_version":43,"open_recommend_blank":90,"storage_back_btn":87,"call_pc_app":47,"clean_version_old":46,"optimize_fmp_version":28,"for_ai_home_version":38,"bmg_fallback_version":86,"ai_summary_version":466,"weixin_popup_block":45,"rcmd_tab_version":90,"in_new_ab":0},"pageVersion":"new_video","videoGoOldVersion":-1}';

function fpContent() {
  return {
    '3064': 1,
    '5062': Date.now(),
    '03bf': 'https%3A%2F%2Fwww.bilibili.com%2F',
    '39c8': '333.788.fp.risk',
    '34f1': '',
    'd402': '',
    '654a': '',
    '6e7c': '839x959',
    '3c43': {
      '2673': 0,
      '5766': 24,
      '6527': 0,
      '7003': 1,
      '807e': 1,
      'b8ce': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
      '641c': 0,
      '07a4': 'en-US',
      '1c57': 'not available',
      '0bd0': 8,
      '748e': [900, 1440],
      'd61f': [875, 1440],
      'fc9d': -480,
      '6aa9': 'Asia/Shanghai',
      '75b8': 1,
      '3b21': 1,
      '8a1c': 0,
      'd52f': 'not available',
      'adca': 'MacIntel',
      '80c9': [
        ['PDF Viewer', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]],
        ['Chrome PDF Viewer', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]],
        ['Chromium PDF Viewer', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]],
        ['Microsoft Edge PDF Viewer', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]],
        ['WebKit built-in PDF', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]],
      ],
      '13ab': '0dAAAAAASUVORK5CYII=',
      'bfe9': 'QgAAEIQAACEIAABCCQN4FXANGq7S8KTZayAAAAAElFTkSuQmCC',
      'a3c1': [
        'extensions:ANGLE_instanced_arrays;EXT_blend_minmax;EXT_color_buffer_half_float;EXT_float_blend;EXT_frag_depth;EXT_shader_texture_lod;EXT_texture_compression_bptc;EXT_texture_compression_rgtc;EXT_texture_filter_anisotropic;EXT_sRGB;KHR_parallel_shader_compile;OES_element_index_uint;OES_fbo_render_mipmap;OES_standard_derivatives;OES_texture_float;OES_texture_float_linear;OES_texture_half_float;OES_texture_half_float_linear;OES_vertex_array_object;WEBGL_color_buffer_float;WEBGL_compressed_texture_astc;WEBGL_compressed_texture_etc;WEBGL_compressed_texture_etc1;WEBGL_compressed_texture_pvrtc;WEBKIT_WEBGL_compressed_texture_pvrtc;WEBGL_compressed_texture_s3tc;WEBGL_compressed_texture_s3tc_srgb;WEBGL_debug_renderer_info;WEBGL_debug_shaders;WEBGL_depth_texture;WEBGL_draw_buffers;WEBGL_lose_context;WEBGL_multi_draw',
        'webgl aliased line width range:[1, 1]', 'webgl aliased point size range:[1, 511]', 'webgl alpha bits:8',
        'webgl antialiasing:yes', 'webgl blue bits:8', 'webgl depth bits:24', 'webgl green bits:8',
        'webgl max anisotropy:16', 'webgl max combined texture image units:32', 'webgl max cube map texture size:16384',
        'webgl max fragment uniform vectors:1024', 'webgl max render buffer size:16384', 'webgl max texture image units:16',
        'webgl max texture size:16384', 'webgl max varying vectors:30', 'webgl max vertex attribs:16',
        'webgl max vertex texture image units:16', 'webgl max vertex uniform vectors:1024', 'webgl max viewport dims:[16384, 16384]',
        'webgl red bits:8', 'webgl renderer:WebKit WebGL', 'webgl shading language version:WebGL GLSL ES 1.0 (1.0)',
        'webgl stencil bits:0', 'webgl vendor:WebKit', 'webgl version:WebGL 1.0', 'webgl unmasked vendor:Apple Inc.',
        'webgl unmasked renderer:Apple GPU', 'webgl vertex shader high float precision:23',
        'webgl vertex shader high float precision rangeMin:127', 'webgl vertex shader high float precision rangeMax:127',
        'webgl vertex shader medium float precision:23', 'webgl vertex shader medium float precision rangeMin:127',
        'webgl vertex shader medium float precision rangeMax:127', 'webgl vertex shader low float precision:23',
        'webgl vertex shader low float precision rangeMin:127', 'webgl vertex shader low float precision rangeMax:127',
        'webgl fragment shader high float precision:23', 'webgl fragment shader high float precision rangeMin:127',
        'webgl fragment shader high float precision rangeMax:127', 'webgl fragment shader medium float precision:23',
        'webgl fragment shader medium float precision rangeMin:127', 'webgl fragment shader medium float precision rangeMax:127',
        'webgl fragment shader low float precision:23', 'webgl fragment shader low float precision rangeMin:127',
        'webgl fragment shader low float precision rangeMax:127', 'webgl vertex shader high int precision:0',
        'webgl vertex shader high int precision rangeMin:31', 'webgl vertex shader high int precision rangeMax:30',
        'webgl vertex shader medium int precision:0', 'webgl vertex shader medium int precision rangeMin:31',
        'webgl vertex shader medium int precision rangeMax:30', 'webgl vertex shader low int precision:0',
        'webgl vertex shader low int precision rangeMin:31', 'webgl vertex shader low int precision rangeMax:30',
        'webgl fragment shader high int precision:0', 'webgl fragment shader high int precision rangeMin:31',
        'webgl fragment shader high int precision rangeMax:30', 'webgl fragment shader medium int precision:0',
        'webgl fragment shader medium int precision rangeMin:31', 'webgl fragment shader medium int precision rangeMax:30',
        'webgl fragment shader low int precision:0', 'webgl fragment shader low int precision rangeMin:31',
        'webgl fragment shader low int precision rangeMax:30',
      ],
      '6bc5': 'Apple Inc.~Apple GPU',
      'ed31': 0,
      '72bd': 0,
      '097b': 0,
      '52cd': [0, 0, 0],
      'a658': ['Andale Mono', 'Arial', 'Arial Black', 'Arial Hebrew', 'Arial Narrow', 'Arial Rounded MT Bold', 'Arial Unicode MS', 'Comic Sans MS', 'Courier', 'Courier New', 'Geneva', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'LUCIDA GRANDE', 'Microsoft Sans Serif', 'Monaco', 'Palatino', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Wingdings', 'Wingdings 2', 'Wingdings 3'],
      'd02f': '124.04345259929687',
    },
    '54ef': FP_AB,
    '8b94': 'https%3A%2F%2Fwww.bilibili.com%2F',
    '5f45': null,
    'db46': 0,
  };
}

function genUuid() {
  const t = Date.now() % 100000;
  const mp = [...'123456789ABCDEF', '10'];
  const part = (x) => Array.from({ length: x }, () => mp[Math.floor(Math.random() * mp.length)]).join('');
  return [8, 4, 4, 4, 12].map(part).join('-') + String(t).padEnd(5, '0') + 'infoc';
}

const te = new TextEncoder();
const fpHex = (m) => (m & MASK).toString(16) + (m >> 64n).toString(16);

export async function activateBuvid(buvid3, buvid4) {
  const uuid = genUuid();
  const content = fpContent();
  content.df35 = uuid;
  const payload = JSON.stringify({ payload: JSON.stringify(content) });
  const buvidFp = fpHex(murmur3(te.encode(payload), 31));
  await fetch('https://api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi', {
    method: 'POST',
    headers: { 'User-Agent': UA, Referer: REFERER, 'Content-Type': 'application/json' },
    body: payload,
  });
  return { uuid, buvidFp };
}

let _buvid = null;
export async function getBuvid() {
  if (_buvid) return _buvid;
  const j = await (await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': UA, Referer: REFERER } })).json();
  _buvid = { buvid3: j?.data?.b_3, buvid4: j?.data?.b_4 };
  try {
    const { uuid, buvidFp } = await activateBuvid(_buvid.buvid3, _buvid.buvid4);
    _buvid.uuid = uuid;
    _buvid.buvidFp = buvidFp;
  } catch {
    /* ponytail: 激活失败不致命，接口仍有命中率 */
  }
  return _buvid;
}

async function cookieHeader(credential) {
  const c = normalizeCredential(credential);
  const parts = [];
  if (c.sessdata) parts.push(`SESSDATA=${c.sessdata}`);
  if (c.biliJct) parts.push(`bili_jct=${c.biliJct}`);
  if (c.dedeUserID) parts.push(`DedeUserID=${c.dedeUserID}`);
  if (c.acTimeValue) parts.push(`ac_time_value=${c.acTimeValue}`);
  const b = await getBuvid();
  const buvid3 = c.buvid3 || b.buvid3;
  const buvid4 = c.buvid4 || b.buvid4;
  if (buvid3) parts.push(`buvid3=${buvid3}`);
  if (buvid4) parts.push(`buvid4=${buvid4}`);
  if (b.buvidFp) parts.push(`buvid_fp=${b.buvidFp}`);
  if (b.uuid) parts.push(`_uuid=${b.uuid}`);
  return parts.join('; ');
}

async function fetchJson(url, { method = 'GET', credential, referer } = {}) {
  const headers = { 'User-Agent': UA, Referer: referer || REFERER };
  const cookie = await cookieHeader(credential);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { method, headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`non-JSON response (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const isRisk = (e) => e?.status === 412 || e?.code === -352 || e?.code === 412;

let _keys = null;
let _keysDay = '';
export async function getWbiKeys(credential) {
  const day = new Date().toISOString().slice(0, 10);
  if (_keys && _keysDay === day) return _keys;
  const j = await fetchJson('https://api.bilibili.com/x/web-interface/nav', { credential });
  const img = j?.data?.wbi_img?.img_url;
  const sub = j?.data?.wbi_img?.sub_url;
  if (!img || !sub) throw new Error(`cannot obtain wbi keys (code ${j?.code})`);
  const base = (u) => u.split('/').pop().split('.')[0];
  _keys = { imgKey: base(img), subKey: base(sub) };
  _keysDay = day;
  return _keys;
}

export async function api(url, { params, method = 'GET', credential, wbi = false, dm = false, referer, throwOnError = true, retry = 8 } = {}) {
  const q = { ...(params || {}) };
  if (dm) {
    Object.assign(q, {
      dm_img_list: '[]',
      dm_img_str: rand2(),
      dm_cover_img_str: rand2(),
      dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
    });
  }
  let full = url;
  if (wbi) {
    const { imgKey, subKey } = await getWbiKeys(credential);
    full = `${url}?${encWbi(q, imgKey, subKey)}`;
  } else if (Object.keys(q).length) {
    full = `${url}?${new URLSearchParams(q)}`;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const json = await fetchJson(full, { method, credential, referer });
      if (throwOnError && json.code !== 0) {
        const err = new Error(`bilibili code ${json.code}: ${json.message}`);
        err.code = json.code;
        err.response = json;
        throw err;
      }
      return json;
    } catch (e) {
      if (!isRisk(e) || attempt >= retry) throw e;
      // ponytail: 412/-352 是概率性风控，等一会重签重试；wts 容差内沿用同一签名
      await sleep(1200 + attempt * 700);
    }
  }
}

export async function getUserVideos({ mid, pn = 1, ps = 30, tid = 0, keyword = '', order = 'pubdate', wWebid, credential } = {}) {
  const params = { mid, ps, tid, pn, keyword, order, order_avoided: 1, platform: 'web' };
  if (wWebid) params.w_webid = wWebid;
  const j = await api('https://api.bilibili.com/x/space/wbi/arc/search', {
    params,
    wbi: true,
    dm: true,
    credential,
  });
  return j.data;
}

export async function getTopVideo({ mid, credential } = {}) {
  const j = await api('https://api.bilibili.com/x/space/top/arc', { params: { vmid: mid }, credential });
  return j.data;
}

export async function getFavFolders({ mid, credential } = {}) {
  const j = await api('https://api.bilibili.com/x/v3/fav/folder/created/list-all', {
    params: { up_mid: mid, web_location: '333.1387' },
    credential,
  });
  return j.data?.list || [];
}

export async function getDefaultFavFolder({ mid, credential } = {}) {
  const list = await getFavFolders({ mid, credential });
  return list.find((f) => (f.attr & 2) === 0) || list[0];
}

export async function getFavContents({ mediaId, pn = 1, ps = 20, credential } = {}) {
  const j = await api('https://api.bilibili.com/x/v3/fav/resource/list', {
    params: { media_id: mediaId, pn, ps, platform: 'web', web_location: '333.1387' },
    credential,
  });
  return j.data;
}
