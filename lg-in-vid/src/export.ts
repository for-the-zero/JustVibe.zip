import type { GlassBackend, GlassPanel } from './backends';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export interface ExportOpts {
  video: HTMLVideoElement;
  /** Offscreen backend at dpr 1, sized W×H. Owned by the caller. */
  backend: GlassBackend;
  relay: HTMLCanvasElement;
  relayCtx: CanvasRenderingContext2D;
  W: number;
  H: number;
  dur: number;
  fps: number;
  file: File;
  getPanels: (t: number) => GlassPanel[];
  onProgress: (p: number, label: string) => void;
  signal: { cancelled: boolean };
}

export async function exportVideo(o: ExportOpts): Promise<{ blob: Blob; ext: string }> {
  const { video, relay, relayCtx, backend, W, H, dur, fps } = o;
  if (typeof VideoEncoder === 'undefined') throw new Error('浏览器不支持 WebCodecs');

  const bitrate = Math.min(12_000_000, Math.max(2_500_000, Math.round(W * H * 3.2)));
  const n = Math.max(1, Math.round(dur * fps));

  const candidates = [
    { codec: 'avc1.42001f', mux: 'mp4' as const, mc: 'avc' },
    { codec: 'vp09.00.10.08', mux: 'webm' as const, mc: 'V_VP9' },
    { codec: 'vp8', mux: 'webm' as const, mc: 'V_VP8' },
  ];
  let sel: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec: c.codec, width: W, height: H, bitrate, framerate: fps });
      if (s.supported) { sel = c; break; }
    } catch { /* try next */ }
  }
  if (!sel) throw new Error('无可用视频编码器');

  let audioCfg: { codec: string; sampleRate: number; numberOfChannels: number; data: AudioBuffer } | null = null;
  try {
    const abuf = await o.file.arrayBuffer();
    const ac = new AudioContext();
    const decoded = await ac.decodeAudioData(abuf);
    ac.close();
    const sampleRate = decoded.sampleRate;
    const numberOfChannels = Math.min(2, decoded.numberOfChannels);
    const acodec = sel.mux === 'mp4' ? 'mp4a.40.2' : 'opus';
    const s = await AudioEncoder.isConfigSupported({ codec: acodec, sampleRate, numberOfChannels, bitrate: 128_000 });
    if (s.supported) audioCfg = { codec: acodec, sampleRate, numberOfChannels, data: decoded };
  } catch { audioCfg = null; }

  const target = sel.mux === 'mp4' ? new Mp4Target() : new WebmTarget();
  const muxer: any = sel.mux === 'mp4'
    ? new Mp4Muxer({
        target: target as any,
        video: { codec: 'avc', width: W, height: H },
        ...(audioCfg ? { audio: { codec: 'aac', numberOfChannels: audioCfg.numberOfChannels, sampleRate: audioCfg.sampleRate } } : {}),
        fastStart: 'in-memory',
      })
    : new WebmMuxer({
        target: target as any,
        video: { codec: sel.mc, width: W, height: H, frameRate: fps },
        ...(audioCfg ? { audio: { codec: 'A_OPUS', numberOfChannels: audioCfg.numberOfChannels, sampleRate: audioCfg.sampleRate } } : {}),
      });

  let encErr: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encErr = e as Error; },
  });
  enc.configure({ codec: sel.codec, width: W, height: H, bitrate, framerate: fps });

  video.pause();

  try {
    for (let i = 0; i < n; i++) {
      if (o.signal.cancelled) throw new Error('已取消');
      if (encErr) throw encErr;
      const t = Math.min(i / fps, Math.max(0, dur - 1e-3));
      await seekTo(video, t);
      relayCtx.drawImage(video, 0, 0, W, H);
      backend.setFrame(relay);
      backend.setElements(o.getPanels(t));
      backend.render();
      const img = backend.grabFrame();
      const vf = new VideoFrame(img.data, {
        format: 'RGBA',
        codedWidth: img.width,
        codedHeight: img.height,
        timestamp: Math.round(t * 1e6),
        duration: Math.round(1e6 / fps),
      });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      o.onProgress(((i + 1) / n) * 0.92, `渲染 ${i + 1}/${n}`);
      if (enc.encodeQueueSize > 8) await waitEvent(enc, 'dequeue');
    }
    await enc.flush();
    if (encErr) throw encErr;

    if (audioCfg) {
      o.onProgress(0.94, '编码音频');
      await encodeAudio(muxer, audioCfg);
    }
    o.onProgress(0.98, '封装');
    muxer.finalize();
    const blob = new Blob([(target as any).buffer], { type: sel.mux === 'mp4' ? 'video/mp4' : 'video/webm' });
    return { blob, ext: sel.mux === 'mp4' ? 'mp4' : 'webm' };
  } finally {
    try { enc.close(); } catch { /* ignore */ }
  }
}

function seekTo(v: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) { res(); return; }
    const on = () => { v.removeEventListener('seeked', on); res(); };
    v.addEventListener('seeked', on);
    v.currentTime = t;
  });
}

function waitEvent(t: EventTarget, type: string) {
  return new Promise<void>((res) => {
    const on = () => { t.removeEventListener(type, on); res(); };
    t.addEventListener(type, on);
  });
}

async function encodeAudio(muxer: any, cfg: { codec: string; sampleRate: number; numberOfChannels: number; data: AudioBuffer }) {
  let err: Error | null = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { err = e as Error; },
  });
  enc.configure({ codec: cfg.codec, sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels, bitrate: 128_000 });
  const CH = cfg.numberOfChannels;
  const total = cfg.data.length;
  const planes: Float32Array[] = [];
  for (let c = 0; c < CH; c++) planes.push(cfg.data.getChannelData(c));
  const N = 4096;
  for (let off = 0; off < total; off += N) {
    if (err) throw err;
    const n = Math.min(N, total - off);
    const f32 = new Float32Array(n * CH);
    for (let c = 0; c < CH; c++) f32.set(planes[c].subarray(off, off + n), c * n);
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: cfg.sampleRate,
      numberOfFrames: n,
      numberOfChannels: CH,
      timestamp: Math.round((off / cfg.sampleRate) * 1e6),
      data: f32,
    });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 16) await waitEvent(enc, 'dequeue');
  }
  await enc.flush();
  if (err) throw err;
  enc.close();
}
