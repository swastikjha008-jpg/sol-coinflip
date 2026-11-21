export type RenderMode =
  | "characters" | "dither" | "mosaic" | "pixel" | "dots" | "cross" | "diamond"
  | "voxel" | "lego" | "mixed" | "lines" | "diagonal" | "braille" | "disco"
  | "hexdump" | "matrix" | "rings" | "hearts" | "stars" | "hexagons"
  | "triangles" | "bubbles" | "hatch" | "contour" | "halfblocks";

export const RENDER_MODES: RenderMode[] = [
  "characters", "dither", "mosaic", "pixel", "dots", "cross", "diamond", "voxel",
  "lego", "mixed", "lines", "diagonal", "braille", "disco", "hexdump", "matrix",
  "rings", "hearts", "stars", "hexagons", "triangles", "bubbles", "hatch",
  "contour", "halfblocks",
];

export type AnimStyle = "wave" | "pulse" | "shimmer" | "ripple" | "flicker";
export type BgMode = "blur" | "solid" | "original" | "transparent";
export type BlurType = "none" | "tilt" | "lens" | "progressive" | "directional";
export type CharSet = "standard" | "blocks" | "binary" | "custom";

export interface Toggle { enabled: boolean; intensity: number }

export interface PostFx {
  vignette: Toggle; scanLines: Toggle; chromatic: Toggle; bloom: Toggle;
  filmGrain: Toggle; glitch: Toggle; pixelate: Toggle; halftone: Toggle; filmDust: Toggle;
}

export interface LightPoint { x: number; y: number; radius?: number; intensity?: number; color?: string }

export interface AsciiParams {
  renderMode: RenderMode;
  bgMode: BgMode;
  bgBlur: number;
  bgOpacity: number;
  cellSize: number;
  coverage: number;
  invert: boolean;
  styleBlend: GlobalCompositeOperation;
  charSet: CharSet;
  customChars: string;
  brightness: number;
  contrast: number;
  edgeEmphasis: number;
  density: number;
  toneCurve: { x: number; y: number }[];
  tint: string;
  tintOpacity: number;
  overlayBlend: GlobalCompositeOperation;
  saturation: number;
  grayscale: number;
  blurType: BlurType;
  blurAmount: number;
  blurAngle: number;
  directionalBothSides: boolean;
  tiltFocus: number;
  tiltPosition: number;
  tiltFeather: number;
  lensFocus: number;
  blurCenterX: number;
  blurCenterY: number;
  progressivePosition: number;
  progressiveReverse: boolean;
  pfx: PostFx;
  animated: boolean;
  animStyle: AnimStyle;
  animSpeed: Toggle;
  animIntensity: Toggle;
  lights: { enabled: boolean; points: LightPoint[] };
  mask: {
    enabled: boolean; tool: string; brushSize: number; showOverlay: boolean;
    invert: boolean; dataUrl: string | null; shapes: unknown[];
  };
}

/** Parameters supplied in the brief. */
export const DEFAULT_PARAMS: AsciiParams = {
  renderMode: "dither",
  bgMode: "blur",
  bgBlur: 2,
  bgOpacity: 90,
  cellSize: 9,
  coverage: 100,
  invert: false,
  styleBlend: "screen",
  charSet: "standard",
  customChars: "",
  brightness: 0,
  contrast: 128,
  edgeEmphasis: 0,
  density: 0,
  toneCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  tint: "#3ca6ff",
  tintOpacity: 0,
  overlayBlend: "multiply",
  saturation: 0,
  grayscale: 100,
  blurType: "tilt",
  blurAmount: 30,
  blurAngle: 0,
  directionalBothSides: false,
  tiltFocus: 35,
  tiltPosition: 50,
  tiltFeather: 15,
  lensFocus: 40,
  blurCenterX: 50,
  blurCenterY: 50,
  progressivePosition: 55,
  progressiveReverse: false,
  pfx: {
    vignette: { enabled: true, intensity: 58 },
    scanLines: { enabled: false, intensity: 40 },
    chromatic: { enabled: false, intensity: 15 },
    bloom: { enabled: false, intensity: 25 },
    filmGrain: { enabled: true, intensity: 32 },
    glitch: { enabled: false, intensity: 20 },
    pixelate: { enabled: false, intensity: 15 },
    halftone: { enabled: false, intensity: 20 },
    filmDust: { enabled: false, intensity: 20 },
  },
  animated: true,
  animStyle: "shimmer",
  animSpeed: { enabled: true, intensity: 100 },
  animIntensity: { enabled: true, intensity: 60 },
  lights: { enabled: false, points: [] },
  mask: {
    enabled: false, tool: "freehand", brushSize: 30, showOverlay: false,
    invert: false, dataUrl: null, shapes: [],
  },
};
