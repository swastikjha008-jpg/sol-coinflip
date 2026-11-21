import { AsciiParams, DEFAULT_PARAMS } from "./types";
import { charRamp, drawCell } from "./shapes";

export interface EngineOptions {
  /** "contain" keeps the whole artwork visible (default). */
  fit?: "contain" | "cover";
  /** Vertical anchor of the artwork inside the stage, 0 = top, 1 = bottom. */
  anchorY?: number;
  /** Scale multiplier applied on top of the fit. */
  zoom?: number;
  maxFps?: number;
  /** Called if rendering throws, so the host can fall back to the raw image. */
  onError?: (e: unknown) => void;
}

// How much of the (greyscale) photograph shows under the glyph layer.
// bgOpacity is honoured as a fraction of this so the effect stays dominant.
const BG_VISIBILITY = 0.32;

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

type Cnv = HTMLCanvasElement;
const mk = (w = 1, h = 1): Cnv => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

export class AsciiEngine {
  private canvas: Cnv;
  private ctx: CanvasRenderingContext2D;
  private p: AsciiParams;
  private o: Required<Omit<EngineOptions, "onError">> & Pick<EngineOptions, "onError">;

  private source: CanvasImageSource | null = null;
  private srcW = 1;
  private srcH = 1;
  private maskImg: HTMLImageElement | null = null;

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  // cached layers
  private bgLayer: Cnv | null = null;
  private cols = 0;
  private rows = 0;
  private base = new Float32Array(0);   // processed luminance 0..1
  private edge = new Float32Array(0);
  private seeds = new Float32Array(0);
  private colours: string[] = [];
  private mono = true;
  private ramp = " .:-=+*#%@";
  private dirty = true;

  private grain: Cnv | null = null;
  private tmp: Cnv = mk();
  private raf = 0;
  private running = false;
  private lastDraw = 0;
  private t0 = 0;
  private frame = 0;
  private reduced = false;
  private mql: MediaQueryList | null = null;
  private onVis = () => this.syncRunning();
  private onMql = () => { this.reduced = !!this.mql?.matches; this.syncRunning(); this.renderOnce(); };

  constructor(canvas: Cnv, params: Partial<AsciiParams> = {}, options: EngineOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D unavailable");
    this.ctx = ctx;
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.o = { fit: "contain", anchorY: 0.5, zoom: 1, maxFps: 30, ...options } as EngineOptions & Required<Omit<EngineOptions, "onError">>;
    this.mql = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reduced = !!this.mql?.matches;
    this.mql?.addEventListener?.("change", this.onMql);
    document.addEventListener("visibilitychange", this.onVis);
  }

  /* ------------------------------ public API ------------------------------ */

  setSource(src: CanvasImageSource, w: number, h: number) {
    this.source = src; this.srcW = w; this.srcH = h; this.dirty = true; this.renderOnce();
  }

  setParams(partial: Partial<AsciiParams>) {
    this.p = { ...this.p, ...partial };
    if (partial.mask?.dataUrl !== undefined) this.loadMask();
    this.dirty = true; this.syncRunning(); this.renderOnce();
  }

  setOptions(o: EngineOptions) {
    this.o = { ...this.o, ...o } as typeof this.o; this.dirty = true; this.renderOnce();
  }

  resize(cssW: number, cssH: number, dpr = window.devicePixelRatio || 1) {
    cssW = Math.max(1, Math.floor(cssW)); cssH = Math.max(1, Math.floor(cssH));
    dpr = Math.min(2, dpr);
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return;
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.dirty = true;
    this.renderOnce();
  }

  start() { this.running = true; this.syncRunning(); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.raf = 0; }

  destroy() {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVis);
    this.mql?.removeEventListener?.("change", this.onMql);
  }

  /** Where the artwork sits in the stage, in CSS px (after fit/zoom/anchor). */
  getArtRect() { return this.cssW ? { ...this.fitRect(), W: this.cssW, H: this.cssH } : null; }

  /* ------------------------------- looping -------------------------------- */

  private shouldAnimate() {
    return this.running && this.p.animated && !this.reduced && !document.hidden;
  }

  private syncRunning() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.shouldAnimate()) {
      this.t0 = performance.now() - (this.lastDraw - this.t0);
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    if (!this.shouldAnimate()) return;
    this.raf = requestAnimationFrame(this.tick);
    if (now - this.lastDraw < 1000 / this.o.maxFps) return;
    this.lastDraw = now;
    this.safeDraw((now - this.t0) / 1000);
  };

  private renderOnce() {
    if (!this.cssW || !this.source) return;
    if (this.shouldAnimate()) return; // loop will pick up the dirty flag
    this.safeDraw(this.reduced ? 0 : (this.lastDraw - this.t0) / 1000);
  }

  private safeDraw(t: number) {
    try { this.draw(t); } catch (e) { this.stop(); this.o.onError?.(e); }
  }

  /* ----------------------------- preparation ------------------------------ */

  private loadMask() {
    const url = this.p.mask.dataUrl;
    if (!url) { this.maskImg = null; return; }
    const img = new Image();
    img.onload = () => { this.maskImg = img; this.renderOnce(); };
    img.src = url;
  }

  private fitRect() {
    const { cssW: W, cssH: H, srcW, srcH } = this;
    const s = (this.o.fit === "cover" ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH)) * this.o.zoom;
    const w = srcW * s, h = srcH * s;
    return { x: (W - w) / 2, y: (H - h) * this.o.anchorY, w, h };
  }

  /** Steps 1-4: background layer, grid sampling, colour adjustments, blur. */
  private prepare() {
    const p = this.p;
    const cell = Math.max(3, p.cellSize);
    const W = this.cssW, H = this.cssH;
    const r = this.fitRect();
    this.cols = Math.ceil(W / cell);
    this.rows = Math.ceil(H / cell);

    /* ---- step 1: background layer ---- */
    const bg = this.bgLayer && this.bgLayer.width === Math.round(W * this.dpr) && this.bgLayer.height === Math.round(H * this.dpr)
      ? this.bgLayer : (this.bgLayer = mk(W * this.dpr, H * this.dpr));
    const b = bg.getContext("2d")!;
    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    b.clearRect(0, 0, W, H);
    b.fillStyle = "#000"; b.fillRect(0, 0, W, H);
    const alpha = (p.bgOpacity / 100) * BG_VISIBILITY;
    if (p.bgMode === "blur" || p.bgMode === "original") {
      b.save();
      b.globalAlpha = alpha;
      b.filter = `grayscale(1) ${p.bgMode === "blur" ? `blur(${p.bgBlur}px)` : ""}`.trim();
      b.drawImage(this.source!, r.x, r.y, r.w, r.h);
      b.restore();
    } else if (p.bgMode === "solid") {
      b.fillStyle = `rgba(255,255,255,${alpha * 0.08})`; b.fillRect(0, 0, W, H);
    }

    /* ---- step 2: grid sampling (small canvas = area-averaged cells) ---- */
    const small = mk(this.cols, this.rows);
    const sc = small.getContext("2d", { willReadFrequently: true })!;
    sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = "high";
    sc.fillStyle = "#000"; sc.fillRect(0, 0, this.cols, this.rows);
    // draw in cell units so each pixel of `small` = one cell
    const k = 1 / cell;
    sc.drawImage(this.source!, r.x * k, r.y * k, r.w * k, r.h * k);

    /* ---- step 4 (blur part): applied on the sampled grid via masked blur ---- */
    if (p.blurType !== "none" && p.blurAmount > 0) this.applyBlur(small, sc);

    const data = sc.getImageData(0, 0, this.cols, this.rows).data;
    const n = this.cols * this.rows;
    if (this.base.length !== n) {
      this.base = new Float32Array(n); this.edge = new Float32Array(n); this.seeds = new Float32Array(n);
      for (let i = 0; i < n; i++) this.seeds[i] = hash(i + 1);
    }
    this.mono = p.grayscale >= 100 && p.tintOpacity <= 0;
    this.colours = this.mono ? [] : new Array(n);
    this.ramp = charRamp(p.charSet, p.customChars);

    /* ---- step 4: brightness -> contrast -> saturation -> grayscale -> tint ---- */
    const bAdd = (p.brightness / 100) * 255;
    const cF = p.contrast / 128;
    const sat = 1 + p.saturation / 100;
    const gray = Math.min(1, p.grayscale / 100);
    const tint = hexToRgb(p.tint);
    const tA = p.tintOpacity / 100;
    const curve = [...p.toneCurve].sort((a, c) => a.x - c.x);
    const lum = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      let R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
      R += bAdd; G += bAdd; B += bAdd;
      R = (R - 128) * cF + 128; G = (G - 128) * cF + 128; B = (B - 128) * cF + 128;
      let l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      R = l + (R - l) * sat; G = l + (G - l) * sat; B = l + (B - l) * sat;
      l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      R += (l - R) * gray; G += (l - G) * gray; B += (l - B) * gray;
      if (tA > 0) { R += (tint[0] * (R / 255) - R) * tA; G += (tint[1] * (G / 255) - G) * tA; B += (tint[2] * (B / 255) - B) * tA; }
      let v = clamp01(l / 255);
      v = applyCurve(curve, v);
      lum[i] = v;
      if (!this.mono) this.colours[i] = `rgb(${clamp255(R)},${clamp255(G)},${clamp255(B)})`;
    }

    /* edge emphasis (sobel on the cell grid) */
    const ee = p.edgeEmphasis / 100;
    const cols = this.cols, rows = this.rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let e = 0;
      if (x > 0 && y > 0 && x < cols - 1 && y < rows - 1) {
        const gx = lum[i - cols + 1] + 2 * lum[i + 1] + lum[i + cols + 1] - lum[i - cols - 1] - 2 * lum[i - 1] - lum[i + cols - 1];
        const gy = lum[i + cols - 1] + 2 * lum[i + cols] + lum[i + cols + 1] - lum[i - cols - 1] - 2 * lum[i - cols] - lum[i - cols + 1];
        e = clamp01(Math.hypot(gx, gy) / 2);
      }
      this.edge[i] = e;
      let v = lum[i] + e * ee;
      v *= 1 + p.density / 100;
      v = clamp01(v);
      this.base[i] = p.invert ? 1 - v : v;
    }
    this.dirty = false;
  }

  private applyBlur(small: Cnv, sc: CanvasRenderingContext2D) {
    const p = this.p;
    const w = small.width, h = small.height;
    const px = (p.blurAmount / 100) * Math.max(1, Math.min(w, h) * 0.06);
    const blurred = mk(w, h);
    const bc = blurred.getContext("2d")!;
    bc.filter = `blur(${px}px)`;
    bc.drawImage(small, 0, 0);
    bc.filter = "none";

    if (p.blurType !== "directional") {
      const m = bc; // mask the blurred copy with an alpha gradient
      m.globalCompositeOperation = "destination-in";
      m.save();
      if (p.blurType === "tilt") {
        m.translate(w / 2, h / 2); m.rotate((p.blurAngle * Math.PI) / 180);
        const L = Math.hypot(w, h);
        const g = m.createLinearGradient(0, -L / 2, 0, L / 2);
        const c = p.tiltPosition / 100, half = p.tiltFocus / 200, f = p.tiltFeather / 100;
        const st = (o: number, a: number) => g.addColorStop(clamp01(o), `rgba(0,0,0,${a})`);
        // positions are relative to the visible height, mapped around the centre
        const map = (o: number) => 0.5 + (o - 0.5) * (h / L);
        st(0, 1); st(map(c - half - f), 1); st(map(c - half), 0); st(map(c + half), 0); st(map(c + half + f), 1); st(1, 1);
        m.fillStyle = g; m.fillRect(-L, -L, L * 2, L * 2);
      } else if (p.blurType === "lens") {
        const cx = (p.blurCenterX / 100) * w, cy = (p.blurCenterY / 100) * h;
        const R = Math.hypot(w, h) / 2;
        const inner = (p.lensFocus / 100) * R * 0.8;
        const g = m.createRadialGradient(cx, cy, inner, cx, cy, R);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
        m.fillStyle = g; m.fillRect(0, 0, w, h);
      } else {
        const g = m.createLinearGradient(0, 0, 0, h);
        const pos = p.progressivePosition / 100;
        const a = p.progressiveReverse ? 1 : 0, bb = p.progressiveReverse ? 0 : 1;
        g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(clamp01(pos), `rgba(0,0,0,${a})`); g.addColorStop(1, `rgba(0,0,0,${bb})`);
        m.fillStyle = g; m.fillRect(0, 0, w, h);
      }
      m.restore();
      m.globalCompositeOperation = "source-over";
    }
    sc.drawImage(blurred, 0, 0);
  }

  /* -------------------------------- drawing ------------------------------- */

  private draw(t: number) {
    if (!this.source || !this.cssW) return;
    if (this.dirty || !this.bgLayer) this.prepare();
    const { ctx, p } = this;
    const W = this.cssW, H = this.cssH, cell = Math.max(3, p.cellSize);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bgLayer!, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    /* ---- step 3 + 8: shapes with animation ---- */
    const speed = p.animSpeed.enabled ? p.animSpeed.intensity / 100 : 0;
    const amp = p.animIntensity.enabled ? p.animIntensity.intensity / 100 : 0;
    const anim = p.animated && !this.reduced;
    const tt = t * (speed || 0.0001);
    const cov = Math.max(0.1, p.coverage / 100);
    const cc = this.cols, cr = this.rows;
    const cx0 = cc / 2, cy0 = cr / 2;
    const monoFill = "#e9e9ee";

    ctx.globalCompositeOperation = p.styleBlend;
    ctx.fillStyle = monoFill;
    const cellCtx = {
      ctx, x: 0, y: 0, s: cell, v: 0, cx: 0, cy: 0, rgb: monoFill, ramp: this.ramp,
      coverage: cov, edge: 0, seed: 0, t: tt,
    };
    for (let y = 0; y < cr; y++) {
      for (let x = 0; x < cc; x++) {
        const i = y * cc + x;
        let v = this.base[i];
        if (v < 0.03) continue;
        const sd = this.seeds[i];
        if (anim && amp > 0) {
          let m = 1;
          switch (p.animStyle) {
            case "shimmer": m = 1 + amp * 0.55 * Math.sin(tt * 2.4 + sd * 18.85); break;
            case "wave": m = 1 + amp * 0.6 * Math.sin(x * 0.12 + y * 0.08 - tt * 2.2); break;
            case "pulse": m = 1 + amp * 0.4 * Math.sin(tt * 1.7); break;
            case "ripple": m = 1 + amp * 0.7 * Math.sin(Math.hypot(x - cx0, y - cy0) * 0.28 - tt * 3); break;
            case "flicker": m = hash(sd * 100 + Math.floor(tt * 12)) < 0.12 ? 1 - amp * 0.85 : 1; break;
          }
          v = clamp01(v * m);
        }
        ctx.globalAlpha = this.mono ? (p.renderMode === "dither" ? 1 : 0.4 + 0.6 * v) : 1;
        ctx.fillStyle = this.mono ? monoFill : this.colours[i];
        cellCtx.x = x * cell; cellCtx.y = y * cell; cellCtx.v = v; cellCtx.cx = x; cellCtx.cy = y;
        cellCtx.rgb = this.mono ? monoFill : this.colours[i];
        cellCtx.edge = this.edge[i]; cellCtx.seed = sd;
        drawCell(p.renderMode, cellCtx);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    /* tint overlay (overlayBlend) for non-per-cell tint */
    if (p.tintOpacity > 0 && this.mono === false) {
      ctx.globalCompositeOperation = p.overlayBlend;
      ctx.globalAlpha = (p.tintOpacity / 100) * 0.5;
      ctx.fillStyle = p.tint; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }

    this.post(t, W, H);
    this.lighting(W, H);
    this.reveal(W, H);
    this.frame++;
  }

  /** Step 5. */
  private post(t: number, W: number, H: number) {
    const { ctx, p } = this;
    const fx = p.pfx;
    const tmpFor = () => {
      const w = Math.round(W * this.dpr), h = Math.round(H * this.dpr);
      if (this.tmp.width !== w || this.tmp.height !== h) this.tmp = mk(w, h);
      return this.tmp;
    };
    const snapshot = () => {
      const tc = tmpFor(); const c = tc.getContext("2d")!;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, tc.width, tc.height); c.drawImage(this.canvas, 0, 0);
      return tc;
    };
    const raw = (fn: () => void) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); fn(); ctx.restore(); };
    const cw = this.canvas.width, ch = this.canvas.height;

    if (fx.pixelate.enabled) {
      const f = Math.max(2, Math.round(fx.pixelate.intensity / 4));
      const sm = mk(Math.ceil(cw / f), Math.ceil(ch / f));
      sm.getContext("2d")!.drawImage(this.canvas, 0, 0, sm.width, sm.height);
      raw(() => { ctx.imageSmoothingEnabled = false; ctx.drawImage(sm, 0, 0, cw, ch); ctx.imageSmoothingEnabled = true; });
    }
    if (fx.bloom.enabled) {
      const tc = snapshot();
      raw(() => {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = fx.bloom.intensity / 100;
        ctx.filter = `blur(${Math.round(6 * this.dpr)}px) brightness(1.4)`; ctx.drawImage(tc, 0, 0);
      });
    }
    if (fx.chromatic.enabled) {
      const tc = snapshot(); const off = Math.max(1, (fx.chromatic.intensity / 100) * 8 * this.dpr);
      raw(() => {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.35;
        ctx.filter = "sepia(1) hue-rotate(160deg) saturate(4)"; ctx.drawImage(tc, -off, 0);
        ctx.filter = "sepia(1) hue-rotate(-50deg) saturate(4)"; ctx.drawImage(tc, off, 0);
      });
    }
    if (fx.glitch.enabled && hash(Math.floor(t * 8)) < fx.glitch.intensity / 100) {
      const tc = snapshot();
      raw(() => {
        for (let i = 0; i < 3; i++) {
          const y = hash(this.frame + i) * ch, hh = 4 + hash(i + 9) * 24 * this.dpr;
          const dx = (hash(this.frame * 3 + i) - 0.5) * 60 * this.dpr;
          ctx.drawImage(tc, 0, y, cw, hh, dx, y, cw, hh);
        }
      });
    }
    if (fx.halftone.enabled) {
      raw(() => {
        const step = Math.max(4, Math.round(6 * this.dpr));
        ctx.globalAlpha = (fx.halftone.intensity / 100) * 0.6; ctx.fillStyle = "#000";
        for (let y = 0; y < ch; y += step) for (let x = ((y / step) & 1) * (step / 2); x < cw; x += step) {
          ctx.beginPath(); ctx.arc(x, y, step * 0.28, 0, 6.2832); ctx.fill();
        }
      });
    }
    if (fx.scanLines.enabled) {
      raw(() => {
        ctx.globalAlpha = (fx.scanLines.intensity / 100) * 0.5; ctx.fillStyle = "#000";
        const step = Math.max(2, Math.round(3 * this.dpr));
        for (let y = 0; y < ch; y += step) ctx.fillRect(0, y, cw, Math.ceil(step / 2));
      });
    }
    if (fx.filmGrain.enabled) {
      if (!this.grain) {
        this.grain = mk(256, 256);
        const g = this.grain.getContext("2d")!; const d = g.createImageData(256, 256);
        for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
        g.putImageData(d, 0, 0);
      }
      raw(() => {
        ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = (fx.filmGrain.intensity / 100) * 0.5;
        const ox = Math.floor(hash(this.frame) * 256), oy = Math.floor(hash(this.frame + 5) * 256);
        const pat = ctx.createPattern(this.grain!, "repeat")!;
        ctx.translate(-ox, -oy); ctx.fillStyle = pat; ctx.fillRect(0, 0, cw + 256, ch + 256);
      });
    }
    if (fx.filmDust.enabled) {
      raw(() => {
        ctx.fillStyle = "#fff";
        const n = Math.round(fx.filmDust.intensity / 3);
        for (let i = 0; i < n; i++) {
          ctx.globalAlpha = 0.15 + hash(this.frame + i * 3) * 0.4;
          ctx.fillRect(hash(this.frame * 7 + i) * cw, hash(this.frame * 5 + i * 11) * ch, 1 + hash(i) * 2 * this.dpr, 1 + hash(i + 3) * 6 * this.dpr);
        }
      });
    }
    if (fx.vignette.enabled) {
      raw(() => {
        const R = Math.hypot(cw, ch) / 2;
        const g = ctx.createRadialGradient(cw / 2, ch / 2, R * (1 - fx.vignette.intensity / 100) * 0.55, cw / 2, ch / 2, R);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${0.55 + fx.vignette.intensity / 250})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      });
    }
    ctx.globalAlpha = 1; ctx.filter = "none"; ctx.globalCompositeOperation = "source-over";
  }

  /** Step 6. */
  private lighting(W: number, H: number) {
    const { ctx, p } = this;
    if (!p.lights.enabled) return;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "screen";
    for (const l of p.lights.points) {
      const R = (l.radius ?? 0.25) * Math.max(W, H);
      const g = ctx.createRadialGradient(l.x * W, l.y * H, 0, l.x * W, l.y * H, R);
      g.addColorStop(0, hexA(l.color ?? "#ffffff", l.intensity ?? 0.5)); g.addColorStop(1, hexA(l.color ?? "#ffffff", 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** Step 7. */
  private reveal(W: number, H: number) {
    const { ctx, p } = this;
    if (!p.mask.enabled || !this.maskImg) return;
    const tc = mk(Math.round(W), Math.round(H)); const c = tc.getContext("2d")!;
    const r = this.fitRect();
    c.drawImage(this.source!, r.x, r.y, r.w, r.h);
    c.globalCompositeOperation = p.mask.invert ? "destination-out" : "destination-in";
    c.drawImage(this.maskImg, 0, 0, W, H);
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.drawImage(tc, 0, 0); ctx.restore();
  }
}

/* -------------------------------- helpers --------------------------------- */
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp255 = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}
function hexA(hex: string, a: number) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function applyCurve(pts: { x: number; y: number }[], v: number) {
  if (pts.length < 2) return v;
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i].x) {
      const a = pts[i - 1], b = pts[i]; const span = b.x - a.x || 1;
      return clamp01(a.y + ((v - a.x) / span) * (b.y - a.y));
    }
  }
  return clamp01(pts[pts.length - 1].y);
}
