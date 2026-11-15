import '@m3e/web/button-group';
import '@m3e/web/card';
import '@m3e/web/icon';
import '@m3e/web/icon-button';
import '@m3e/web/loading-indicator';
import '@m3e/icons/outlined/close';
import '@m3e/icons/outlined/chevron_left';
import '@m3e/icons/outlined/chevron_right';
import '@m3e/icons/outlined/zoom_in';
import '@m3e/icons/outlined/zoom_out';
import '@m3e/icons/outlined/crop_free';
import '@m3e/icons/outlined/center_focus_strong';
import '@m3e/icons/outlined/rotate_left';
import '@m3e/icons/outlined/rotate_right';
import '@m3e/icons/outlined/flip';
import '@m3e/icons/outlined/download';
import '@m3e/icons/outlined/fullscreen';
import '@m3e/icons/outlined/fullscreen_exit';

let e_root = null;
let e_stage;
let e_loading;
let e_tip;
let e_count;
let e_zoom;
let e_thumbs;
let e_fs;
let viewer = null;
let list = [];
let idx = 0;
let close_timer = 0;
let key_bound = false;

const KEYS = {
  Escape: 'close',
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  '+': 'zoom_in',
  '=': 'zoom_in',
  '-': 'zoom_out',
  '_': 'zoom_out',
  '0': 'fit',
  f: 'fs',
  F: 'fs',
  s: 'save',
  S: 'save',
};

async function init_viewer() {
  if (viewer) return;
  const { default: OpenSeadragon } = await import('openseadragon');
  viewer = OpenSeadragon({
    element: e_stage,
    showNavigationControl: false,
    crossOriginPolicy: 'Anonymous',
    maxZoomPixelRatio: 4,
    constrainDuringPan: false,
    pixelsPerWheelLine: 50,
    zoomPerScroll: 1.6,
    gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: false, scrollToZoom: true, dragToPan: true, flickEnabled: true },
    gestureSettingsTouch: { pinchToZoom: true, dblClickToZoom: false, dragToPan: true, flickEnabled: true, flickMomentum: 0.15 },
  });
  viewer.addHandler('zoom', render_zoom);
  viewer.addHandler('open', on_open);
  viewer.addHandler('tile-loaded', hide_loading);
  viewer.addHandler('open-failed', hide_loading);
  viewer.addHandler('canvas-click', on_canvas_click);
  viewer.addHandler('canvas-double-click', on_dblclick);
  viewer.addHandler('full-screen', on_fs);
}

function build() {
  e_root = document.createElement('div');
  e_root.className = 'img-viewer';
  e_root.setAttribute('hidden', '');
  e_root.innerHTML = `<div class="iv-stage"></div>
        <m3e-loading-indicator class="iv-loading" hidden></m3e-loading-indicator>
        <div class="iv-title"></div>
        <div class="iv-nav">
            <m3e-icon-button class="iv-btn iv-arrow" data-act="prev" aria-label="上一张" title="上一张  ←"><m3e-icon name="chevron_left"></m3e-icon></m3e-icon-button>
            <m3e-icon-button class="iv-btn iv-arrow" data-act="next" aria-label="下一张" title="下一张  →"><m3e-icon name="chevron_right"></m3e-icon></m3e-icon-button>
        </div>
        <div class="iv-thumbs" hidden></div>
        <div class="iv-bar">
            <m3e-card>
                <div class="iv-card-row">
                    <span class="iv-count"></span>
                    <m3e-button-group size="extra-small">
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="zoom_out" aria-label="缩小" title="缩小  -"><m3e-icon name="zoom_out"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="zoom_in" aria-label="放大" title="放大  +"><m3e-icon name="zoom_in"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="fit" aria-label="适应窗口" title="适应窗口  0"><m3e-icon name="crop_free"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="real" aria-label="原始大小" title="原始大小"><m3e-icon name="center_focus_strong"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="rot_l" aria-label="向左旋转" title="向左旋转"><m3e-icon name="rotate_left"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="rot_r" aria-label="向右旋转" title="向右旋转"><m3e-icon name="rotate_right"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="flip" aria-label="水平翻转" title="水平翻转"><m3e-icon name="flip"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="save" aria-label="保存图片" title="保存图片  S"><m3e-icon name="download"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="fs" aria-label="全屏" title="全屏  F"><m3e-icon name="fullscreen"></m3e-icon></m3e-icon-button>
                        <m3e-icon-button class="iv-btn" size="extra-small" data-act="close" aria-label="关闭" title="关闭  Esc"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
                    </m3e-button-group>
                    <span class="iv-zoom"></span>
                </div>
            </m3e-card>
        </div>`;
  document.documentElement.append(e_root);
  e_stage = e_root.querySelector('.iv-stage');
  e_loading = e_root.querySelector('.iv-loading');
  e_tip = e_root.querySelector('.iv-title');
  e_count = e_root.querySelector('.iv-count');
  e_zoom = e_root.querySelector('.iv-zoom');
  e_thumbs = e_root.querySelector('.iv-thumbs');
  e_fs = e_root.querySelector('[data-act="fs"]');
  e_root.addEventListener('click', on_click);
  e_thumbs.addEventListener(
    'wheel',
    (e) => {
      if (e_thumbs.scrollWidth <= e_thumbs.clientWidth) return;
      e.preventDefault();
      e_thumbs.scrollLeft += e.deltaY + e.deltaX;
    },
    { passive: false },
  );
  if (!key_bound) {
    document.addEventListener('keydown', on_key);
    key_bound = true;
  }
}

function render_zoom() {
  const home = viewer?.viewport.getHomeZoom();
  if (!home) return;
  e_zoom.textContent = `${Math.round((viewer.viewport.getZoom() / home) * 100)}%`;
}

function on_open() {
  e_loading.removeAttribute('hidden');
  mark_thumb();
  render_zoom();
}

function hide_loading() {
  e_loading.setAttribute('hidden', '');
}

function mark_thumb() {
  [...e_thumbs.children].forEach((e_item, i) => e_item.classList.toggle('on', i === idx));
  e_thumbs.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function build_thumbs() {
  e_thumbs.replaceChildren();
  e_thumbs.toggleAttribute('hidden', list.length < 2);
  if (list.length < 2) return;
  list.forEach((e, i) => {
    const e_thumb = document.createElement('button');
    e_thumb.className = 'iv-thumb';
    e_thumb.setAttribute('aria-label', e.alt || `第 ${i + 1} 张`);
    e_thumb.innerHTML = `<img src="${e.src}" alt="" loading="lazy" draggable="false">`;
    e_thumb.onclick = () => {
      load(i);
    };
    e_thumbs.append(e_thumb);
  });
  mark_thumb();
}

function load(i) {
  idx = i;
  const e = list[idx];
  e_tip.textContent = e.alt || '';
  e_count.textContent = list.length > 1 ? `${idx + 1} / ${list.length}` : '';
  mark_thumb();
  e_loading.removeAttribute('hidden');
  viewer?.open({ type: 'image', url: e.src, buildPyramid: false });
}

function go(delta) {
  if (list.length < 2) return;
  load((idx + delta + list.length) % list.length);
}

async function save() {
  const e = list[idx];
  const name = (e.title || e.alt || 'image').replace(/[\\/:*?"<>|]/g, '_');
  try {
    const res = await fetch(e.src);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  } catch {
    window.open(e.src);
  }
}

function act(name) {
  const vp = viewer?.viewport;
  switch (name) {
    case 'prev': go(-1); break;
    case 'next': go(1); break;
    case 'zoom_in': vp?.zoomBy(1.4); break;
    case 'zoom_out': vp?.zoomBy(1 / 1.4); break;
    case 'fit': vp?.goHome(); break;
    case 'real': vp?.zoomTo(1); vp?.applyConstraints(); break;
    case 'rot_l': vp?.setRotation((vp.getRotation() + 270) % 360); break;
    case 'rot_r': vp?.setRotation((vp.getRotation() + 90) % 360); break;
    case 'flip': vp?.toggleFlip(); break;
    case 'save': save(); break;
    case 'fs': viewer?.setFullScreen(!viewer.isFullScreen()); break;
    case 'close': closeViewer(); break;
  }
}

export function closeViewer() {
  clearTimeout(close_timer);
  e_root?.setAttribute('hidden', '');
  viewer?.close();
}

function on_canvas_click(e) {
  if (!e.quick) return;
  e.preventDefaultAction = true;
  clearTimeout(close_timer);
  close_timer = window.setTimeout(closeViewer, 320);
}

function on_dblclick(e) {
  e.preventDefaultAction = true;
  clearTimeout(close_timer);
  const vp = viewer.viewport;
  if (vp.getZoom() > vp.getHomeZoom() * 1.01) {
    vp.goHome();
  } else {
    vp.zoomBy(2, vp.pointFromPixel(e.position, true));
  }
}

function on_fs() {
  e_fs.querySelector('m3e-icon').setAttribute('name', viewer?.isFullScreen() ? 'fullscreen_exit' : 'fullscreen');
}

function on_click(e) {
  const e_btn = e.target.closest('.iv-btn');
  if (e_btn) act(e_btn.dataset.act);
}

function on_key(e) {
  if (!e_root || e_root.hasAttribute('hidden')) return;
  if (e.key === 'Escape' && document.fullscreenElement) return;
  const name = KEYS[e.key];
  if (!name) return;
  act(name);
  e.preventDefault();
}

export async function openViewer(target, options = {}) {
  if (!e_root) build();
  const selector = options.selector || 'm3e-img-mask, m3e-lazy-image';
  let box = null;
  if (options.container instanceof Element) box = options.container;
  else if (typeof options.container === 'string') box = document.querySelector(options.container);
  else box = target.closest('[data-viewer-group]') || target.parentElement || document.body;
  list = [...(box?.querySelectorAll(selector) || [])];
  idx = Math.max(list.indexOf(target), 0);
  if (idx < 0 && target.src) {
    list = [target];
    idx = 0;
  }
  build_thumbs();
  e_root?.removeAttribute('hidden');
  e_loading.removeAttribute('hidden');
  await init_viewer();
  load(idx);
}

export function installViewer(options = {}) {
  document.addEventListener('open-image', (e) => {
    if (e.detail?.target) openViewer(e.detail.target, options);
  });
}
