import type { RenderMode } from "./types";

const CHARSETS: Record<string, string> = {
  standard: " .:-=+*#%@",
  blocks: " ░▒▓█",
  binary: " 01",
};

export function charRamp(set: string, custom: string): string {
  if (set === "custom" && custom.length > 1) return custom;
  return CHARSETS[set] ?? CHARSETS.standard;
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
export const bayer = (cx: number, cy: number) => (BAYER4[cy & 3][cx & 3] + 0.5) / 16;

const HEX = "0123456789ABCDEF";
const MATRIX = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ01234789";

export interface CellCtx {
  ctx: CanvasRenderingContext2D;
  x: number; y: number;      // top-left px
  s: number;                 // cell size px
  v: number;                 // 0..1 level after adjustments/animation
  cx: number; cy: number;    // grid coords
  rgb: string;               // fill colour
  ramp: string;
  coverage: number;          // 0..1
  edge: number;              // 0..1
  seed: number;              // 0..1 stable per cell
  t: number;
}

const poly = (ctx: CanvasRenderingContext2D, pts: [number, number][]) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
};

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function heart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.4, cy, cx - r * 0.7, cy - r * 1.1, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.7, cy - r * 1.1, cx + r * 1.4, cy, cx, cy + r * 0.9);
  ctx.fill();
}

function hexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function glyph(c: CellCtx, ch: string) {
  const { ctx, x, y, s } = c;
  ctx.font = `${Math.round(s * 1.05)}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(ch, x + s / 2, y + s / 2 + 0.5);
}

const BRAILLE_BITS = [0x1, 0x8, 0x2, 0x10, 0x4, 0x20, 0x40, 0x80];

/** Draws one cell. Returns nothing; colour is pre-set via ctx.fillStyle. */
export function drawCell(mode: RenderMode, c: CellCtx): void {
  const { ctx, x, y, s, v, cx, cy } = c;
  if (v <= 0.02) return;
  const cov = c.coverage;
  const mid = (n: number) => n / 2;
  const r = (s / 2) * cov;
  const px = x + mid(s), py = y + mid(s);
  ctx.fillStyle = c.rgb;

  switch (mode) {
    case "characters": {
      const i = Math.min(c.ramp.length - 1, Math.floor(v * c.ramp.length));
      if (c.ramp[i] !== " ") glyph(c, c.ramp[i]);
      break;
    }
    case "dither": {
      if (v > bayer(cx, cy)) {
        const d = Math.max(1, Math.floor(s * cov) - 1);
        ctx.fillRect(x, y, d, d);
      }
      break;
    }
    case "mosaic": {
      ctx.globalAlpha *= 0.35 + v * 0.65;
      const d = s * cov - 1;
      ctx.fillRect(x, y, d, d);
      break;
    }
    case "pixel": ctx.fillRect(x, y, s, s); break;
    case "dots": ctx.beginPath(); ctx.arc(px, py, r * Math.sqrt(v), 0, 6.2832); ctx.fill(); break;
    case "bubbles":
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.strokeStyle = c.rgb;
      ctx.beginPath(); ctx.arc(px, py, Math.max(0.6, r * v), 0, 6.2832); ctx.stroke();
      break;
    case "cross": {
      const w = Math.max(1, s * 0.16), l = s * cov * (0.4 + v * 0.6);
      ctx.fillRect(px - l / 2, py - w / 2, l, w);
      ctx.fillRect(px - w / 2, py - l / 2, w, l);
      break;
    }
    case "diamond": {
      const k = r * (0.3 + v * 0.8);
      poly(ctx, [[px, py - k], [px + k, py], [px, py + k], [px - k, py]]);
      break;
    }
    case "voxel": {
      const k = s * cov * (0.4 + v * 0.6);
      ctx.fillRect(x, y + s - k, k, k);
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(x + 1, y + s - k - 1, k, 1.5);
      ctx.fillRect(x + k, y + s - k, 1.5, k);
      break;
    }
    case "lego": {
      const d = s * cov - 1;
      ctx.fillRect(x, y, d, d);
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * 0.6;
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(px, py, s * 0.22, 0, 6.2832); ctx.fill();
      ctx.fillStyle = c.rgb;
      ctx.globalAlpha = a0;
      ctx.beginPath(); ctx.arc(px, py - 0.5, s * 0.18, 0, 6.2832); ctx.fill();
      break;
    }
    case "mixed": {
      if (v > 0.66) { const i = Math.min(c.ramp.length - 1, Math.floor(v * c.ramp.length)); glyph(c, c.ramp[i]); }
      else if (v > 0.33) { ctx.beginPath(); ctx.arc(px, py, r * v * 1.2, 0, 6.2832); ctx.fill(); }
      else if (v > bayer(cx, cy)) ctx.fillRect(x, y, s - 1, s - 1);
      break;
    }
    case "lines": {
      const h = Math.max(1, s * 0.7 * v * cov);
      ctx.fillRect(x, py - h / 2, s, h);
      break;
    }
    case "diagonal": {
      ctx.strokeStyle = c.rgb;
      ctx.lineWidth = Math.max(1, s * 0.22 * v + 0.4);
      ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x + s, y); ctx.stroke();
      break;
    }
    case "hatch": {
      ctx.strokeStyle = c.rgb;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + s); ctx.lineTo(x + s, y);
      if (v > 0.45) { ctx.moveTo(x, y); ctx.lineTo(x + s, y + s); }
      if (v > 0.75) { ctx.moveTo(x, py); ctx.lineTo(x + s, py); }
      ctx.stroke();
      break;
    }
    case "braille": {
      const dot = s * 0.16;
      for (let i = 0; i < 8; i++) {
        const col = i < 6 ? (i % 2) : (i - 6);
        const row = i < 6 ? (i / 2) | 0 : 3;
        const on = v * 0.9 > (BRAILLE_BITS[i] % 7) / 8 * 0.9 + (c.seed * 0.1);
        if (!on) continue;
        ctx.beginPath();
        ctx.arc(x + s * (0.3 + 0.4 * col), y + s * (0.14 + 0.24 * row), dot, 0, 6.2832);
        ctx.fill();
      }
      break;
    }
    case "disco": {
      const hue = ((cx * 7 + cy * 13 + c.t * 40) % 360 + 360) % 360;
      ctx.fillStyle = `hsl(${hue} 15% ${30 + v * 65}%)`;
      ctx.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
      break;
    }
    case "hexdump": {
      const k = Math.min(15, Math.floor(v * 16));
      glyph(c, HEX[k]);
      break;
    }
    case "matrix": {
      const i = Math.floor((c.seed * 997 + c.t * 3 + cy * 0.5) % MATRIX.length);
      ctx.globalAlpha *= 0.4 + v * 0.6;
      glyph(c, MATRIX[i]);
      break;
    }
    case "rings": {
      ctx.strokeStyle = c.rgb;
      ctx.lineWidth = Math.max(1, s * 0.1);
      ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, r * v * 0.95), 0, 6.2832); ctx.stroke();
      if (v > 0.6) { ctx.beginPath(); ctx.arc(px, py, r * v * 0.45, 0, 6.2832); ctx.stroke(); }
      break;
    }
    case "hearts": heart(ctx, px, py, r * (0.4 + v * 0.7)); break;
    case "stars": star(ctx, px, py, r * (0.5 + v * 0.7)); break;
    case "hexagons": hexagon(ctx, px, py, r * (0.45 + v * 0.7)); break;
    case "triangles": {
      const k = r * (0.5 + v * 0.7);
      const up = (cx + cy) % 2 === 0;
      poly(ctx, up
        ? [[px, py - k], [px + k, py + k], [px - k, py + k]]
        : [[px - k, py - k], [px + k, py - k], [px, py + k]]);
      break;
    }
    case "contour": {
      const band = Math.floor(v * 6);
      if (band % 2 === 0 || c.edge > 0.4) {
        const d = Math.max(1, s * cov * 0.5);
        ctx.fillRect(px - d / 2, py - d / 2, d, d);
      }
      break;
    }
    case "halfblocks": {
      const hh = s / 2;
      ctx.fillRect(x, y, s, hh * Math.min(1, v * 1.6));
      ctx.globalAlpha *= 0.5;
      ctx.fillRect(x, y + hh, s, hh * Math.min(1, v * 1.2));
      break;
    }
  }
}
