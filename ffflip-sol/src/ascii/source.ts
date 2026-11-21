export interface LoadedSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** true when no artwork file could be loaded and a stand-in was drawn. */
  isPlaceholder: boolean;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

/**
 * Loads the supplied artwork, trying a few common file names.
 * If none load, draws a temporary stand-in.
 */
export async function loadArtwork(url: string): Promise<LoadedSource> {
  const candidates = [url, "/hands.webp", "/hands.png.webp", "/hands.jpg", "/hands.jpeg"];
  for (const u of candidates) {
    try {
      const img = await loadImage(u);
      if (img.naturalWidth > 64) {
        return { image: img, width: img.naturalWidth, height: img.naturalHeight, isPlaceholder: false };
      }
    } catch { /* try next */ }
  }
  return placeholder();
}

function placeholder(): LoadedSource {
  const W = 1600, H = 900;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const arm = (dir: 1 | -1) => {
    g.save();
    g.translate(dir === 1 ? 0 : W, 0);
    g.scale(dir, 1);
    const grad = g.createLinearGradient(0, 0, 720, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.45, "rgba(210,210,215,0.85)");
    grad.addColorStop(1, "rgba(255,255,255,0.95)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 420); g.bezierCurveTo(260, 380, 420, 400, 600, 440);
    g.lineTo(700, 436); g.lineTo(716, 452); g.lineTo(690, 466);
    g.lineTo(720, 480); g.lineTo(690, 494); g.lineTo(640, 520);
    g.bezierCurveTo(440, 600, 260, 560, 0, 560);
    g.closePath(); g.fill();
    g.restore();
  };
  arm(1); arm(-1);
  return { image: c, width: W, height: H, isPlaceholder: true };
}