/**
 * One glass panel in video-pixel coordinates (CSS px of the video frame).
 * Geometry is already normalised by the app: circles are square, cr is the
 * final corner radius, so backends only map material params.
 */
export interface GlassPanel {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	cr: number;
	/** refraction strength */
	ra: number;
	/** refraction (bevel) height */
	rh: number;
	/** blur radius, px */
	blur: number;
	/** saturation, 1 = neutral */
	sat: number;
	ca: boolean;
	/** highlight alpha */
	hlA: number;
	shOn: boolean;
	tint: [number, number, number];
	tintA: number;
}

export type BackendId = 'kyant' | 'ybouane';

export interface GlassBackend {
	readonly id: BackendId;
	readonly label: string;
	/** Canvas to show in the stage; sized in CSS px by resize(). */
	readonly canvas: HTMLCanvasElement;
	resize(w: number, h: number, dpr: number): void;
	/** New source frame (2D relay canvas). */
	setFrame(src: TexImageSource): void;
	setElements(els: GlassPanel[]): void;
	/** Draw synchronously. */
	render(): void;
	/** Full-resolution pixels for export (RGBA, top-left origin). */
	grabFrame(): ImageData;
	dispose(): void;
}