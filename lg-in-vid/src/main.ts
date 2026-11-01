import { KyantBackend } from './backends';
import type { GlassBackend, GlassPanel } from './backends';
import { tickStep } from 'd3-array';
import { exportVideo } from './export';

type Shape = 'rect' | 'pill' | 'circle';
interface Rect { x: number; y: number; w: number; h: number; cr: number }
interface KF extends Rect { t: number }
interface Layer {
  id: string; name: string; start: number; end: number; shape: Shape;
  base: Rect; kfs: KF[];
  rh: number; ra: number; blur: number; sat: number;
  ca: boolean; hlA: number; shOn: boolean;
  tint: string; tintA: number;
}

const G = { ra: 24, rh: 12, blur: 2, sat: 1.5, hlA: 0.5, ca: false, shOn: true, bounce: 0.6 };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>('video');
const stage = $('stage');
const sel = $('sel');
const view = $('view');
const timeLab = $('time');
const playBtn = $<HTMLButtonElement>('playBtn');
const exportBtn = $<HTMLButtonElement>('exportBtn');
const addBtn = $<HTMLButtonElement>('addBtn');
const hint = $('hint');
const tlScroll = $('tlScroll');
const zPct = $('zPct');

const S = {
  W: 0, H: 0, dur: 0, scale: 1,
  layers: [] as Layer[], selId: null as string | null,
  file: null as File | null, name: 'video',
  exporting: false, layerN: 0,
};
let backend: GlassBackend | null = null;
let pxps = 100;
const THEAD = 160;
let previewDpr = 1;
let url0 = '';
let dirty = true;
const relay = document.createElement('canvas');
const relayCtx = relay.getContext('2d')!;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function easeOutBack(u: number, s: number) {
  const p = u - 1;
  return 1 + (s + 1) * p * p * p + s * p * p;
}

function fmt(s: number, dec = 1): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const rs = dec === 0 ? String(Math.floor(r)).padStart(2, '0') : r.toFixed(dec).padStart(dec + 3, '0');
  return m + ':' + rs;
}

const valStr = (v: number, step = 0.01) => (step >= 1 ? String(Math.round(v)) : v.toFixed(2));

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function cur(): Layer | null {
  return S.layers.find((l) => l.id === S.selId) ?? null;
}

/* ---------------- sampling / elements ---------------- */

function sampleAt(l: Layer, t: number): Rect {
  const k = l.kfs;
  if (!k.length) return l.base;
  if (t <= k[0].t) return k[0];
  const last = k[k.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t <= t) i++;
  const a = k[i], b = k[i + 1];
  const u = (t - a.t) / (b.t - a.t || 1);
  const e = easeOutBack(u, G.bounce * 2.2);
  return {
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, e),
    w: Math.max(16, lerp(a.w, b.w, e)),
    h: Math.max(16, lerp(a.h, b.h, e)),
    cr: Math.max(0, lerp(a.cr, b.cr, e)),
  };
}

function buildPanels(t: number): GlassPanel[] {
  const out: GlassPanel[] = [];
  for (const l of S.layers) {
    if (t < l.start || t > l.end) continue;
    const s = sampleAt(l, t);
    const short = Math.min(s.w, s.h);
    let { x, y, w, h, cr } = s;
    if (l.shape === 'circle') {
      w = h = short;
      x = s.x + (s.w - short) / 2;
      y = s.y + (s.h - short) / 2;
      cr = short / 2;
    } else if (l.shape === 'pill') {
      cr = short / 2;
    }
    out.push({
      id: l.id, x, y, w, h, cr,
      ra: l.ra, rh: l.rh, blur: l.blur, sat: l.sat,
      ca: l.ca, hlA: l.hlA, shOn: l.shOn,
      tint: hexRgb(l.tint), tintA: l.tintA,
    });
  }
  return out;
}

function uploadCurrentFrame() {
  if (!backend || video.readyState < 2) return;
  relayCtx.drawImage(video, 0, 0, S.W, S.H);
  backend.setFrame(relay);
  dirty = true;
}

/* ---------------- editing / commit ---------------- */

function commitRect(l: Layer, r: Partial<Rect>) {
  const t = video.currentTime;
  if (!l.kfs.length) {
    Object.assign(l.base, r);
  } else {
    const s = sampleAt(l, t);
    const kf: KF = { t, x: r.x ?? s.x, y: r.y ?? s.y, w: r.w ?? s.w, h: r.h ?? s.h, cr: r.cr ?? s.cr };
    const i = l.kfs.findIndex((k) => Math.abs(k.t - t) < 0.03);
    if (i >= 0) l.kfs[i] = kf; else l.kfs.push(kf);
    l.kfs.sort((a, b) => a.t - b.t);
  }
  dirty = true;
  renderTimeline();
}

function addKf() {
  const l = cur();
  if (!l) return;
  const t = video.currentTime;
  const s = sampleAt(l, t);
  const kf: KF = { t, x: s.x, y: s.y, w: s.w, h: s.h, cr: s.cr };
  const i = l.kfs.findIndex((k) => Math.abs(k.t - t) < 0.03);
  if (i >= 0) l.kfs[i] = kf; else l.kfs.push(kf);
  l.kfs.sort((a, b) => a.t - b.t);
  dirty = true;
  renderTimeline();
  syncProps();
}

function removeKfAtPlayhead() {
  const l = cur();
  if (!l) return;
  const t = video.currentTime;
  const i = l.kfs.findIndex((k) => Math.abs(k.t - t) < 0.05);
  if (i >= 0) {
    l.kfs.splice(i, 1);
    dirty = true;
    renderTimeline();
    syncProps();
  }
}

/* ---------------- layers ---------------- */

function addLayer(start?: number, end?: number) {
  if (!backend || S.layers.length >= 12) return;
  S.layerN++;
  const w = Math.round(S.W * 0.4);
  const h = Math.round(S.H * 0.25);
  let st = clamp(start ?? 0, 0, S.dur || 0);
  let en = clamp(end ?? (S.dur || 0), st + 0.1, Math.max(st + 0.1, S.dur || 1));
  if (S.dur && en - st < 0.1) { st = Math.max(0, S.dur - 0.1); en = S.dur; }
  const l: Layer = {
    id: 'L' + S.layerN,
    name: '图层 ' + S.layerN,
    start: st,
    end: en,
    shape: 'rect',
    base: { x: Math.round((S.W - w) / 2), y: Math.round((S.H - h) / 2), w, h, cr: Math.round(Math.min(w, h) * 0.25) },
    kfs: [],
    rh: G.rh, ra: G.ra, blur: G.blur, sat: G.sat,
    ca: G.ca, hlA: G.hlA, shOn: G.shOn,
    tint: '#ffffff', tintA: 0.08,
  };
  S.layers.push(l);
  selectLayer(l.id);
}

function addAtPlayhead() {
  if (!backend || !S.dur) return;
  const st = clamp(video.currentTime, 0, Math.max(0, S.dur - 0.1));
  addLayer(st, Math.min(S.dur, st + 5));
}

function removeLayer(id: string) {
  S.layers = S.layers.filter((l) => l.id !== id);
  if (S.selId === id) S.selId = null;
  dirty = true;
  renderLayerList();
  renderTimeline();
  syncProps();
}

function selectLayer(id: string | null) {
  S.selId = id;
  renderLayerList();
  renderTimeline();
  syncProps();
}

/* ---------------- UI sync ---------------- */

function syncSelBox() {
  const l = cur();
  const t = video.currentTime;
  if (!l || t < l.start || t > l.end) { sel.hidden = true; return; }
  const s = sampleAt(l, t);
  sel.hidden = false;
  sel.style.left = s.x + 'px';
  sel.style.top = s.y + 'px';
  sel.style.width = s.w + 'px';
  sel.style.height = s.h + 'px';
}

function syncPlayhead() {
  const ph = $('playhead');
  const rr = $('ruler').getBoundingClientRect();
  const pct = S.dur ? clamp(video.currentTime / S.dur, 0, 1) : 0;
  ph.style.left = (THEAD + rr.width * pct) + 'px';
  ph.style.height = tlScroll.scrollHeight + 'px';
}

function contentW(): number {
  const avail = tlScroll.clientWidth - THEAD;
  return S.dur ? Math.max(avail, Math.ceil(S.dur * pxps)) : avail;
}

function applyZoom() {
  const w = contentW() + 'px';
  $('ruler').style.width = w;
  $('ruler').style.minWidth = w;
  for (const el of document.querySelectorAll<HTMLElement>('.tlane')) {
    el.style.width = w;
    el.style.minWidth = w;
  }
  zPct.textContent = Math.round(pxps) + ' px/s';
  renderRuler();
}

function setPxps(p: number, anchorX?: number) {
  const br = tlScroll.getBoundingClientRect();
  const rr = $('ruler').getBoundingClientRect();
  const t = S.dur && anchorX !== undefined ? (anchorX - rr.left) / pxps : 0;
  pxps = clamp(p, 4, 8000);
  applyZoom();
  if (S.dur && anchorX !== undefined) {
    tlScroll.scrollLeft = clamp(t * pxps + THEAD - (anchorX - br.left), 0, tlScroll.scrollWidth - tlScroll.clientWidth);
  }
}

function fitZoom() {
  pxps = S.dur ? clamp((tlScroll.clientWidth - THEAD) / S.dur, 4, 8000) : 100;
  applyZoom();
}

function renderRuler() {
  const ruler = $('ruler');
  ruler.innerHTML = '';
  if (!S.dur) return;
  const w = ruler.clientWidth || 600;
  const step = tickStep(0, S.dur, Math.max(4, Math.floor(w / 70)));
  const dec = step < 0.5 ? 2 : step < 1 ? 1 : 0;
  const n = Math.ceil(S.dur / step - 1e-9);
  for (let i = 0; i <= n; i++) {
    const t = +(i * step).toFixed(6);
    const d = document.createElement('div');
    d.className = 'tick';
    d.style.left = ((t / S.dur) * 100) + '%';
    d.textContent = fmt(t, dec);
    ruler.appendChild(d);
  }
}

function renderLayerList() {
  const box = $('layerList');
  if (!S.layers.length) {
    box.innerHTML = '<span class="dim">暂无图层</span>';
    return;
  }
  box.innerHTML = '';
  for (const l of S.layers) {
    const row = document.createElement('div');
    row.className = 'lrow' + (l.id === S.selId ? ' lsel' : '');
    row.innerHTML = `<span class="lname">${l.name}</span><span class="ltime">${fmt(l.start, 2)}–${fmt(l.end, 2)}</span>`;
    row.addEventListener('click', () => selectLayer(l.id));
    box.appendChild(row);
  }
}

function renderTimeline() {
  const rows = $('rows');
  rows.innerHTML = '';
  for (const l of S.layers) {
    const row = document.createElement('div');
    row.className = 'trow' + (l.id === S.selId ? ' tsel' : '');
    const head = document.createElement('div');
    head.className = 'thead';
    head.innerHTML = `<span class="tname">${l.name}</span><button class="tdel" title="删除图层">×</button>`;
    const lane = document.createElement('div');
    lane.className = 'tlane';
    const clip = document.createElement('div');
    clip.className = 'tclip';
    if (S.dur) {
      clip.style.left = (l.start / S.dur * 100) + '%';
      clip.style.width = ((l.end - l.start) / S.dur * 100) + '%';
    }
    clip.innerHTML = '<div class="trim l"></div><div class="trim r"></div>';
    lane.appendChild(clip);
    for (const k of l.kfs) {
      const d = document.createElement('div');
      d.className = 'kf';
      if (S.dur) d.style.left = (k.t / S.dur * 100) + '%';
      d.title = fmt(k.t, 2);
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        selectLayer(l.id);
        drag = { kind: 'kf', l, kf: k, x: e.clientX };
      });
      d.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        l.kfs = l.kfs.filter((x) => x !== k);
        dirty = true;
        renderTimeline();
        syncProps();
      });
      lane.appendChild(d);
    }
    head.addEventListener('pointerdown', () => selectLayer(l.id));
    (head.querySelector('.tdel') as HTMLElement).addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      removeLayer(l.id);
    });
    clip.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('trim')) return;
      e.preventDefault();
      e.stopPropagation();
      selectLayer(l.id);
      drag = { kind: 'clip', l, orig: { start: l.start, end: l.end }, x: e.clientX };
    });
    const trims = clip.querySelectorAll<HTMLElement>('.trim');
    trims.forEach((h, i) => h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectLayer(l.id);
      drag = { kind: 'trim', l, edge: i === 0 ? 'l' : 'r', orig: { start: l.start, end: l.end }, x: e.clientX };
    }));
    lane.addEventListener('pointerdown', (e) => {
      if (e.target !== lane) return;
      drag = { kind: 'scrub' };
      seekFromClientX(e.clientX);
    });
    row.appendChild(head);
    row.appendChild(lane);
    rows.appendChild(row);
  }
  applyZoom();
}

function syncProps() {
  const box = $('propsBox');
  const l = cur();
  if (!l) { box.hidden = true; return; }
  box.hidden = false;
  $<HTMLInputElement>('pStart').value = l.start.toFixed(2);
  $<HTMLInputElement>('pEnd').value = l.end.toFixed(2);
  for (const btn of $('shapeSeg').querySelectorAll<HTMLElement>('button')) {
    btn.classList.toggle('on', btn.dataset.shape === l.shape);
  }
  const s = sampleAt(l, video.currentTime);
  for (const row of $('pRows').children) {
    const inp = row.querySelector('input') as HTMLInputElement;
    const pv = row.querySelector('.pv') as HTMLElement;
    const key = (row as HTMLElement).dataset.k!;
    const v = key === 'cr' ? s.cr : (l as any)[key];
    inp.value = String(v);
    inp.disabled = key === 'cr' && l.shape !== 'rect';
    pv.textContent = valStr(v);
  }
  $<HTMLInputElement>('pColor').value = l.tint;
  $<HTMLInputElement>('pCa').checked = l.ca;
  $<HTMLInputElement>('pSh').checked = l.shOn;
  $('kfN').textContent = `关键帧 ${l.kfs.length}`;
}

/* ---------------- inspector build ---------------- */

type NumKey = 'ra' | 'rh' | 'blur' | 'sat' | 'hlA' | 'bounce';

const GROWS: [NumKey, string, number, number, number][] = [
  ['ra', '折射强度', 0, 60, 1],
  ['rh', '折射高度', 4, 40, 1],
  ['blur', '模糊', 0, 24, 0.5],
  ['sat', '饱和度', 0, 2, 0.05],
  ['hlA', '高光', 0, 1, 0.01],
  ['bounce', '弹性回弹', 0, 1, 0.01],
];

const LROWS: [string, string, number, number, number][] = [
  ['cr', '圆角', 0, 240, 1],
  ['rh', '折射高度', 4, 40, 1],
  ['ra', '折射强度', 0, 60, 1],
  ['blur', '模糊', 0, 24, 0.5],
  ['sat', '饱和度', 0, 2, 0.05],
  ['hlA', '高光', 0, 1, 0.01],
  ['tintA', '染色', 0, 0.6, 0.01],
];

function sliderRow(key: string, label: string, min: number, max: number, step: number, val: number) {
  const row = document.createElement('div');
  row.className = 'prow';
  row.dataset.k = key;
  row.innerHTML = `<span class="pl">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><span class="pv">${valStr(val, step)}</span>`;
  return row;
}

function initInspector() {
  const box = $('matRows');
  for (const [key, label, min, max, step] of GROWS) {
    const row = sliderRow(key, label, min, max, step, G[key]);
    const inp = row.querySelector('input') as HTMLInputElement;
    const pv = row.querySelector('.pv') as HTMLElement;
    inp.addEventListener('input', () => {
      const v = +inp.value;
      G[key] = v;
      pv.textContent = valStr(v, step);
      if (key !== 'bounce') for (const l of S.layers) (l as any)[key] = v;
      dirty = true;
      if (key !== 'bounce') syncProps();
    });
    box.appendChild(row);
  }
  $<HTMLInputElement>('gCa').addEventListener('change', (e) => {
    G.ca = (e.target as HTMLInputElement).checked;
    for (const l of S.layers) l.ca = G.ca;
    dirty = true;
    syncProps();
  });
  $<HTMLInputElement>('gSh').addEventListener('change', (e) => {
    G.shOn = (e.target as HTMLInputElement).checked;
    for (const l of S.layers) l.shOn = G.shOn;
    dirty = true;
    syncProps();
  });

  const pbox = $('pRows');
  for (const [key, label, min, max, step] of LROWS) {
    const row = sliderRow(key, label, min, max, step, key === 'cr' ? 60 : (G as any)[key] ?? 0);
    const inp = row.querySelector('input') as HTMLInputElement;
    const pv = row.querySelector('.pv') as HTMLElement;
    inp.addEventListener('input', () => {
      const l = cur();
      if (!l) return;
      const v = +inp.value;
      pv.textContent = valStr(v, step);
      if (key === 'cr') commitRect(l, { cr: v });
      else {
        (l as any)[key] = v;
        dirty = true;
      }
    });
    pbox.appendChild(row);
  }

  $<HTMLInputElement>('pStart').addEventListener('change', (e) => {
    const l = cur();
    if (!l) return;
    l.start = clamp(+(e.target as HTMLInputElement).value || 0, 0, l.end - 0.05);
    dirty = true;
    renderLayerList();
    renderTimeline();
  });
  $<HTMLInputElement>('pEnd').addEventListener('change', (e) => {
    const l = cur();
    if (!l) return;
    l.end = clamp(+(e.target as HTMLInputElement).value || 0, l.start + 0.05, S.dur);
    dirty = true;
    renderLayerList();
    renderTimeline();
  });

  for (const btn of $('shapeSeg').querySelectorAll<HTMLElement>('button')) {
    btn.addEventListener('click', () => {
      const l = cur();
      if (!l) return;
      const sh = btn.dataset.shape as Shape;
      if (l.shape === sh) return;
      l.shape = sh;
      if (sh === 'circle') {
        const s = sampleAt(l, video.currentTime);
        const side = Math.min(s.w, s.h);
        commitRect(l, { x: s.x + (s.w - side) / 2, y: s.y + (s.h - side) / 2, w: side, h: side });
      }
      dirty = true;
      syncProps();
    });
  }

  $<HTMLInputElement>('pColor').addEventListener('input', (e) => {
    const l = cur();
    if (!l) return;
    l.tint = (e.target as HTMLInputElement).value;
    dirty = true;
  });
  $<HTMLInputElement>('pCa').addEventListener('change', (e) => {
    const l = cur();
    if (!l) return;
    l.ca = (e.target as HTMLInputElement).checked;
    dirty = true;
  });
  $<HTMLInputElement>('pSh').addEventListener('change', (e) => {
    const l = cur();
    if (!l) return;
    l.shOn = (e.target as HTMLInputElement).checked;
    dirty = true;
  });
}

/* ---------------- interactions ---------------- */

type DragState =
  | { kind: 'move' | 'resize'; l: Layer; h: string; orig: Rect; cx: number; cy: number }
  | { kind: 'scrub' }
  | { kind: 'clip' | 'trim'; l: Layer; edge?: 'l' | 'r'; orig: { start: number; end: number }; x: number }
  | { kind: 'kf'; l: Layer; kf: KF; x: number };
let drag: DragState | null = null;

function seekFromClientX(cx: number) {
  const rr = $('ruler').getBoundingClientRect();
  const pct = clamp((cx - rr.left) / rr.width, 0, 1);
  if (S.dur) video.currentTime = pct * S.dur;
}

function snapT(t: number): number {
  if (!S.dur) return t;
  const pxps = ($('ruler').clientWidth || 600) / S.dur;
  const th = 8 / pxps;
  const cands: number[] = [0, S.dur, video.currentTime];
  for (const l of S.layers) {
    cands.push(l.start, l.end);
    for (const k of l.kfs) cands.push(k.t);
  }
  let best = t, bd = th;
  for (const c of cands) {
    const d = Math.abs(c - t);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function hitLayer(cx: number, cy: number): Layer | null {
  const sr = stage.getBoundingClientRect();
  const x = (cx - sr.left) / S.scale;
  const y = (cy - sr.top) / S.scale;
  const t = video.currentTime;
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    if (t < l.start || t > l.end) continue;
    const s = sampleAt(l, t);
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return l;
  }
  return null;
}

function initSelDrag() {
  sel.addEventListener('pointerdown', (e) => {
    const l = cur();
    if (!l) return;
    const h = (e.target as HTMLElement).dataset.h ?? '';
    drag = { kind: h ? 'resize' : 'move', l, h, orig: { ...sampleAt(l, video.currentTime) }, cx: e.clientX, cy: e.clientY };
    e.preventDefault();
  });
  view.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const t = e.target as HTMLElement;
    if (t !== video && t !== view && t !== backend?.canvas) return;
    const l = hitLayer(e.clientX, e.clientY);
    if (l) {
      selectLayer(l.id);
      drag = { kind: 'move', l, h: '', orig: { ...sampleAt(l, video.currentTime) }, cx: e.clientX, cy: e.clientY };
    } else {
      selectLayer(null);
    }
  });
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  if (drag.kind === 'move') {
    const dx = (e.clientX - drag.cx) / S.scale;
    const dy = (e.clientY - drag.cy) / S.scale;
    commitRect(drag.l, { x: drag.orig.x + dx, y: drag.orig.y + dy });
  } else if (drag.kind === 'resize') {
    const dx = (e.clientX - drag.cx) / S.scale;
    const dy = (e.clientY - drag.cy) / S.scale;
    const o = drag.orig;
    const h = drag.h;
    let x = o.x, y = o.y, w = o.w, hh = o.h;
    if (h.includes('e')) w = o.w + dx;
    if (h.includes('w')) w = o.w - dx;
    if (h.includes('s')) hh = o.h + dy;
    if (h.includes('n')) hh = o.h - dy;
    if (drag.l.shape === 'circle') { const side = Math.max(w, hh); w = side; hh = side; }
    w = Math.max(16, w);
    hh = Math.max(16, hh);
    if (h.includes('w')) x = o.x + o.w - w;
    if (h.includes('n')) y = o.y + o.h - hh;
    commitRect(drag.l, { x, y, w, h: hh });
  } else if (drag.kind === 'scrub') {
    seekFromClientX(e.clientX);
  } else if (drag.kind === 'clip') {
    const rr = $('ruler').getBoundingClientRect();
    const dt = ((e.clientX - drag.x) / rr.width) * S.dur;
    const len = drag.orig.end - drag.orig.start;
    let st = clamp(drag.orig.start + dt, 0, Math.max(0, S.dur - len));
    st = snapT(st);
    st = clamp(st, 0, Math.max(0, S.dur - len));
    drag.l.start = st;
    drag.l.end = st + len;
    renderTimeline();
    dirty = true;
  } else if (drag.kind === 'trim') {
    const rr = $('ruler').getBoundingClientRect();
    const dt = ((e.clientX - drag.x) / rr.width) * S.dur;
    if (drag.edge === 'l') {
      let s = clamp(snapT(drag.orig.start + dt), 0, drag.l.end - 0.1);
      s = clamp(s, 0, drag.l.end - 0.1);
      drag.l.start = s;
    } else {
      let en = clamp(snapT(drag.orig.end + dt), drag.l.start + 0.1, S.dur);
      en = clamp(en, drag.l.start + 0.1, S.dur);
      drag.l.end = en;
    }
    renderTimeline();
    dirty = true;
  } else if (drag.kind === 'kf') {
    const rr = $('ruler').getBoundingClientRect();
    let t = clamp((e.clientX - rr.left) / rr.width * S.dur, 0, S.dur);
    t = snapT(t);
    drag.kf.t = clamp(t, 0, S.dur);
    drag.l.kfs.sort((a, b) => a.t - b.t);
    renderTimeline();
    dirty = true;
  }
}

/* ---------------- playback ---------------- */

function togglePlay() {
  if (!S.dur || S.exporting) return;
  if (video.paused || video.ended) void video.play();
  else video.pause();
}

function onKey(e: KeyboardEvent) {
  const ae = document.activeElement as HTMLElement | null;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
    e.preventDefault();
    addAtPlayhead();
    return;
  }
  if (ae && ae.tagName === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowLeft' && S.dur) {
    e.preventDefault();
    video.pause();
    video.currentTime = clamp(video.currentTime - 1 / 30, 0, S.dur);
  } else if (e.code === 'ArrowRight' && S.dur) {
    e.preventDefault();
    video.pause();
    video.currentTime = clamp(video.currentTime + 1 / 30, 0, S.dur);
  }
}

/* ---------------- load / resize ---------------- */

async function loadFile(f: File) {
  if (S.exporting) return;
  const modal = $('loadModal');
  modal.hidden = false;
  try {
    await loadFileInner(f);
  } finally {
    modal.hidden = true;
  }
}

async function loadFileInner(f: File) {
  S.file = f;
  S.name = f.name.replace(/\.[^.]+$/, '') || 'video';
  if (url0) URL.revokeObjectURL(url0);
  url0 = URL.createObjectURL(f);
  video.src = url0;
  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('视频加载失败'));
  });
  // webm (MediaRecorder 等) 的时长元数据可能缺失/异常 (Infinity 或 ~0)，统一用 seek 夹取真实时长
  await new Promise<void>((res) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; video.removeEventListener('seeked', on); res(); } };
    const on = () => done();
    video.addEventListener('seeked', on);
    setTimeout(done, 3000);
    video.currentTime = 1e7;
  });
  S.dur = Math.max(isFinite(video.duration) ? video.duration : 0, video.currentTime);
  if (S.dur < 0.1) S.dur = 0.1;
  const k = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  S.W = Math.max(2, Math.round(video.videoWidth * k));
  S.H = Math.max(2, Math.round(video.videoHeight * k));
  relay.width = S.W;
  relay.height = S.H;
  stage.style.width = S.W + 'px';
  stage.style.height = S.H + 'px';
  previewDpr = Math.max(0.5, Math.min(1, 960 / Math.max(S.W, S.H)));
  if (!backend) initBackend();
  else backend.resize(S.W, S.H, previewDpr);
  S.layers = [];
  S.selId = null;
  S.layerN = 0;
  video.currentTime = 0;
  uploadCurrentFrame();
  hint.hidden = true;
  stage.hidden = false;
  playBtn.disabled = false;
  exportBtn.disabled = false;
  addBtn.disabled = false;
  renderLayerList();
  renderTimeline();
  syncProps();
  resizeStage();
  requestAnimationFrame(() => { renderRuler(); fitZoom(); });
  addLayer();
}

function resizeStage() {
  if (!S.W) return;
  const vw = view.clientWidth - 48;
  const vh = view.clientHeight - 48;
  const f = Math.min(vw / S.W, vh / S.H, 2);
  S.scale = Math.max(0.05, f);
  stage.style.transform = `translate(-50%, -50%) scale(${S.scale})`;
  stage.style.setProperty('--f', String(1 / S.scale));
}

/* ---------------- export ---------------- */

function initBackend() {
  if (backend) backend.dispose();
  backend = new KyantBackend();
  stage.insertBefore(backend.canvas, sel);
  if (S.W) backend.resize(S.W, S.H, S.exporting ? 1 : previewDpr);
  if (video.readyState >= 2) {
    relayCtx.drawImage(video, 0, 0, S.W, S.H);
    backend.setFrame(relay);
    backend.setElements(buildPanels(video.currentTime));
    backend.render();
  }
  dirty = true;
}

async function doExport() {
  if (!S.file || !backend || S.exporting || !S.dur) return;
  S.exporting = true;
  video.pause();
  exportBtn.disabled = true;
  addBtn.disabled = true;
  playBtn.disabled = true;
  $('expBox').hidden = false;
  $('expMsg').textContent = '';
  const bar = $('expBar').firstElementChild as HTMLElement;
  bar.style.width = '0%';
  const signal = { cancelled: false };
  $('cancelBtn').onclick = () => { signal.cancelled = true; };
  const off = new KyantBackend();
  off.resize(S.W, S.H, 1);
  try {
    const res = await exportVideo({
      video,
      relay,
      relayCtx,
      backend: off,
      W: S.W,
      H: S.H,
      dur: S.dur,
      fps: 30,
      file: S.file,
      getPanels: (t) => buildPanels(t),
      onProgress: (p, label) => {
        bar.style.width = (p * 100).toFixed(1) + '%';
        $('expText').textContent = `${label} ${Math.round(p * 100)}%`;
      },
      signal,
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(res.blob);
    a.download = S.name + '-lg.' + res.ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    $('expMsg').textContent = '完成 ✓';
  } catch (e: any) {
    $('expMsg').textContent = (e && e.message) || '导出失败';
  } finally {
    off.dispose();
    S.exporting = false;
    $('expBox').hidden = true;
    exportBtn.disabled = false;
    addBtn.disabled = false;
    playBtn.disabled = false;
    video.currentTime = 0;
    if (backend) {
      backend.resize(S.W, S.H, previewDpr);
      uploadCurrentFrame();
    }
  }
}

/* ---------------- main loop ---------------- */

function tick() {
  requestAnimationFrame(tick);
  if (!backend || S.exporting) return;
  const playing = !video.paused && !video.ended && video.readyState >= 2;
  if (playing) {
    relayCtx.drawImage(video, 0, 0, S.W, S.H);
    backend.setFrame(relay);
  }
  if (playing || dirty) {
    backend.setElements(buildPanels(video.currentTime));
    backend.render();
    dirty = false;
  }
  syncSelBox();
  syncPlayhead();
  timeLab.textContent = fmt(video.currentTime, 1) + ' / ' + fmt(S.dur, 1);
  playBtn.textContent = video.paused ? '播放' : '暂停';
  const ae = document.activeElement as HTMLElement | null;
  const editing = !!ae && ae.tagName === 'INPUT' && (ae as HTMLInputElement).type === 'number';
  if (!editing && !$('propsBox').hidden) syncProps();
}

/* ---------------- init ---------------- */

function init() {
  const file = $<HTMLInputElement>('file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) void loadFile(f);
    file.value = '';
  });
  playBtn.addEventListener('click', togglePlay);
  exportBtn.addEventListener('click', () => void doExport());
  addBtn.addEventListener('click', () => addLayer());
  $('zIn').addEventListener('click', () => { const br = tlScroll.getBoundingClientRect(); setPxps(pxps * 1.5, br.left + br.width / 2); });
  $('zOut').addEventListener('click', () => { const br = tlScroll.getBoundingClientRect(); setPxps(pxps / 1.5, br.left + br.width / 2); });
  $('zFit').addEventListener('click', fitZoom);
  tlScroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !S.dur) return;
    e.preventDefault();
    setPxps(pxps * (e.deltaY < 0 ? 1.25 : 1 / 1.25), e.clientX);
  }, { passive: false });
  $('delBtn').addEventListener('click', () => { if (S.selId) removeLayer(S.selId); });
  $('kfAdd').addEventListener('click', addKf);
  $('kfDel').addEventListener('click', removeKfAtPlayhead);
  initInspector();
  initSelDrag();

  $('ruler').addEventListener('pointerdown', (e) => {
    drag = { kind: 'scrub' };
    seekFromClientX(e.clientX);
  });
  $('playhead').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = { kind: 'scrub' };
    seekFromClientX(e.clientX);
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('resize', () => { resizeStage(); applyZoom(); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  video.addEventListener('seeked', () => { if (!S.exporting) uploadCurrentFrame(); });
  video.addEventListener('play', () => { dirty = true; });
  video.addEventListener('pause', () => { dirty = true; });
  video.addEventListener('ended', () => { dirty = true; });

  requestAnimationFrame(tick);
  (window as any).__app = { S, G, loadFile, addLayer, addAtPlayhead, doExport, sampleAt, buildPanels, setPxps, fitZoom, snapT, getBackend: () => backend };
}

init();
