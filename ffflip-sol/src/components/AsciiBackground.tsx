import { useEffect, useRef, useState } from "react";
import { AsciiEngine } from "../ascii/engine";
import { DEFAULT_PARAMS, AsciiParams } from "../ascii/types";
import { loadArtwork } from "../ascii/source";

interface Props {
  src?: string;
  params?: Partial<AsciiParams>;
  onPlaceholder?: (isPlaceholder: boolean) => void;
  /** Centre of the artwork (the gap between the hands) in stage px. */
  onGap?: (g: { x: number; y: number }) => void;
}

/** Full-bleed animated ASCII/dither rendering of the artwork. */
export function AsciiBackground({ src = "/hands.png", params, onPlaceholder, onGap }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<AsciiEngine | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = wrap.current!, cv = canvas.current!;
    let disposed = false;
    let eng: AsciiEngine;
    try {
      eng = new AsciiEngine(cv, { ...DEFAULT_PARAMS, ...params }, {
        anchorY: 0.38,
        onError: () => setFailed(true),
      });
    } catch {
      setFailed(true);
      return;
    }
    engine.current = eng;

    const layout = () => {
      const r = host.getBoundingClientRect();
      // On narrow screens keep the hands readable: zoom past "contain".
      const narrow = r.width < 700;
      eng.setOptions({ fit: narrow ? "contain" : "cover", zoom: narrow ? 1.8 : 1, anchorY: 0.5 });
      eng.resize(r.width, r.height);
      const a = eng.getArtRect();
      if (a) onGap?.({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
    };

    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(layout, 80); // debounce
    });
    ro.observe(host);

    loadArtwork(src).then((s) => {
      if (disposed) return;
      onPlaceholder?.(s.isPlaceholder);
      eng.setSource(s.image, s.width, s.height);
      layout();
      eng.start();
    }).catch(() => setFailed(true));

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      ro.disconnect();
      eng.destroy();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => { if (params) engine.current?.setParams(params); }, [params]);

  return (
    <div ref={wrap} className="ascii-stage" aria-hidden="true">
      {failed
        ? <img className="ascii-fallback" src={src} alt="" />
        : <canvas ref={canvas} />}
    </div>
  );
}
