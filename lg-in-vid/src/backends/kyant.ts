import type { GlassElementConfig } from '../vendor/liquid-glass/renderer/index';
import { LiquidGlassRenderer } from '../vendor/liquid-glass/renderer/index';
import type { GlassBackend, GlassPanel } from './types';

/** Renderer internals we drive directly. The vendored source is left untouched. */
interface Internals {
	gl: WebGLRenderingContext;
	dpr: number;
	wallpaperTexture: WebGLTexture | null;
	wallpaperSize: [number, number];
	wallpaperReady: boolean;
	wallpaperVersion: number;
	needsRedraw: boolean;
	clearBackdropBlurCache(): void;
	markAllDirty(): void;
	resize(w: number, h: number): void;
	render(opts?: { force?: boolean; dpr?: number }): void;
	setElements(els: GlassElementConfig[]): void;
	dispose?(): void;
}

/** Create the wallpaper texture once; frames are streamed in with texSubImage2D. */
function ensureVideoWallpaper(r: Internals, w: number, h: number) {
	const gl = r.gl;
	if (r.wallpaperTexture) gl.deleteTexture(r.wallpaperTexture);
	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	r.wallpaperTexture = tex;
	r.wallpaperSize = [w, h];
	r.wallpaperReady = true;
	r.wallpaperVersion++;
	r.clearBackdropBlurCache();
	r.markAllDirty();
}

function uploadFrame(r: Internals, src: TexImageSource) {
	if (!r.wallpaperReady || !r.wallpaperTexture) return;
	const gl = r.gl;
	gl.bindTexture(gl.TEXTURE_2D, r.wallpaperTexture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
	r.clearBackdropBlurCache();
	r.wallpaperVersion++;
	r.markAllDirty();
}

function toElement(p: GlassPanel): GlassElementConfig {
	const short = Math.min(p.w, p.h);
	return {
		kind: 'glass-shape',
		rect: { x: p.x, y: p.y, w: p.w, h: p.h },
		cornerRadius: Math.max(0, Math.min(p.cr, short / 2)),
		refractionHeight: p.rh,
		refractionAmount: -p.ra,
		chromaticAberration: p.ca,
		blurRadius: p.blur,
		saturation: p.sat,
		brightness: 0,
		contrast: 1,
		tintColor: [p.tint[0], p.tint[1], p.tint[2], p.tintA],
		surfaceColor: [0, 0, 0, 0],
		highlight: p.hlA > 0 ? { mode: 0, color: [1, 1, 1], angle: 2.356, falloff: 1, alpha: p.hlA, widthDp: 0.5 } : null,
		outerShadow: p.shOn ? { radius: 24, alpha: 0.1, offsetX: 0, offsetY: 4, color: [0, 0, 0] } : null,
		independentBackdrop: true,
		isInteractive: false,
	} as GlassElementConfig;
}

export class KyantBackend implements GlassBackend {
	readonly id = 'kyant';
	readonly label = 'Kyant 玻璃';
	readonly canvas: HTMLCanvasElement;
	private r: Internals;
	private panels: GlassPanel[] = [];

	constructor() {
		this.canvas = document.createElement('canvas');
		this.canvas.style.cssText = 'position:absolute;left:0;top:0;';
		this.r = new LiquidGlassRenderer(this.canvas) as unknown as Internals;
	}

	resize(w: number, h: number, dpr: number) {
		this.canvas.style.width = w + 'px';
		this.canvas.style.height = h + 'px';
		this.r.dpr = dpr;
		this.r.resize(w, h);
		ensureVideoWallpaper(this.r, w, h);
	}

	setFrame(src: TexImageSource) {
		uploadFrame(this.r, src);
	}

	setElements(els: GlassPanel[]) {
		this.panels = els;
	}

	render() {
		this.r.setElements(this.panels.map(toElement));
		this.r.needsRedraw = true;
		this.r.render();
	}

	grabFrame(): ImageData {
		const gl = this.r.gl;
		const W = this.canvas.width;
		const H = this.canvas.height;
		const buf = new Uint8ClampedArray(W * H * 4);
		gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
		const flip = new Uint8ClampedArray(W * H * 4);
		const row = W * 4;
		for (let y = 0; y < H; y++) flip.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
		return new ImageData(flip, W, H);
	}

	dispose() {
		this.r.dispose?.();
		this.canvas.remove();
	}
}