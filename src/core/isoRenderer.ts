// Pure integer pixel-buffer isometric 3D primitive renderer + procedural pixel facade patterns
// Never uses Canvas 2D anti-aliased path fills: every solid pixel has alpha === 255.

import {
  buildArchCrossSection,
  cloneArchNodes,
  createArchPresetNodes,
  getArchSampleCount,
  type ArchHollowStyle,
  type ArchInnerMode,
  type ArchNode,
} from './arch';
import { clamp, shadeColorHsv, shadeColorSoftHsv, type RGBA } from './color';
import {
  buildColumnRings,
  cloneColumnSections,
  getColumnLocalBounds,
  hasActiveColumnSections,
  isPolygonalColumnShape,
  type ColumnInterpMode,
  type ColumnSection,
} from './columnSections';
import {
  isoToScreenPx,
  normalizeRotation,
  worldBoxToView,
  type ViewRotation,
} from './isoMath';
import {
  buildAlignedLoftRings,
  cloneLoftSections,
  createDefaultLoftSections,
  getLoftLocalBounds,
  normalizeLoftSections,
  type LoftInterpMode,
  type LoftSection,
} from './loft';
import { stampIsoBaseToBuffer } from './theotownAssets';
import {
  cloneFaceTextures,
  getLocalDimsFromShape,
  getPlanarFacesForShape,
  isPlanarTextureShape,
  sampleFaceTextureRGBA,
  sanitizeFaceTexturesForShape,
  type FaceTextureSlot,
  type PlanarFaceSpec,
} from './textures';

export type ShapeKind =
  | 'box'
  | 'right_tri_prism'
  | 'arch'
  | 'cylinder'
  | 'loft'
  | 'prism'
  | 'wedge'
  | 'pyramid'
  | 'cone'
  | 'dome'
  | 'sphere'
  | 'theotown_base';

export type TriPrismCut = 'vertical' | 'slope';

export type TiltPivot = 'center' | 'bottom';

export type OutlineMode = 'none' | 'outer' | 'all_edges';

export type FacadePatternType =
  | 'none'
  | 'windows'
  | 'curtain_v'
  | 'curtain_h'
  | 'brick'
  | 'roof_grid';

export interface FacadePatternConfig {
  type: FacadePatternType;
  primaryColor: RGBA;
  rows: number;
  cols: number;
  spacingPx: number;
  marginPx: number;
  applyTop: boolean;
}

export interface ParametricShape {
  shapeType: ShapeKind;
  u: number;
  v: number;
  zPx: number;
  sizeU: number;
  sizeV: number;
  heightPx: number;
  ori: ViewRotation;
  flipZ?: boolean;
  /** Vertical-plane tilt in local U-Z plane (-180..+180 deg; +90 lays +Z flat along +U) */
  tiltUDeg?: number;
  /** Vertical-plane tilt in local V-Z plane (-180..+180 deg; +90 lays +Z flat along +V) */
  tiltVDeg?: number;
  /** Tilt rotation pivot: geometric center (default) or base center */
  tiltPivot?: TiltPivot;
  prismSides: number;
  triPrismCut: TriPrismCut;
  wedgeMode: 'ramp' | 'gable';
  domeMode: 'dome' | 'sphere';
  archHollow?: boolean;
  archHollowStyle?: ArchHollowStyle;
  archInnerMode?: ArchInnerMode;
  archThickness?: number;
  archNodes?: ArchNode[];
  archInnerNodes?: ArchNode[];
  loftSections?: LoftSection[];
  loftInterp?: LoftInterpMode;
  loftHollow?: boolean;
  loftFloorT?: number;
  activeLoftSectionId?: string;
  colSections?: ColumnSection[];
  colInterp?: ColumnInterpMode;
  activeColSectionId?: string;
  baseColor: RGBA;
  roofColor: RGBA | null;
  autoShade: boolean;
  shadeContrast: number;
  outlineMode: OutlineMode;
  outlineColor: RGBA | null;
  edgeHighlight: boolean;
  pattern: FacadePatternConfig;
  faceTextures?: Record<string, FaceTextureSlot>;
  activeFaceId?: string;
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  box: '立方体 / 长方体',
  right_tri_prism: '直角三棱柱',
  arch: '拱形 / 拱券',
  cylinder: '圆柱体',
  loft: '曲面柱 / 平放拱 (控制面)',
  prism: '多棱柱',
  wedge: '楔形 / 坡屋顶',
  pyramid: '四棱锥',
  cone: '圆锥体',
  dome: '穹顶 / 球体',
  sphere: '球体 / 椭球体',
  theotown_base: 'TheoTown 绿地底座',
};

export function createDefaultShape(
  shapeType: ShapeKind = 'box',
  overrides: Partial<ParametricShape> = {},
): ParametricShape {
  const baseColor: RGBA = overrides.baseColor
    ? { ...overrides.baseColor }
    : { r: 168, g: 176, b: 194, a: 255 };
  const pattern: FacadePatternConfig = {
    type: 'none',
    primaryColor: { r: 96, g: 185, b: 245, a: 255 },
    rows: 3,
    cols: 3,
    spacingPx: 2,
    marginPx: 3,
    applyTop: false,
    ...(overrides.pattern ?? {}),
  };
  const hasLoftData = shapeType === 'loft';
  const loftSections = hasLoftData
    ? overrides.loftSections
      ? cloneLoftSections(overrides.loftSections)
      : createDefaultLoftSections()
    : undefined;
  const hasArchData = shapeType === 'arch';
  const archNodes = hasArchData
    ? overrides.archNodes
      ? cloneArchNodes(overrides.archNodes)
      : createArchPresetNodes('semicircle')
    : undefined;
  const out: ParametricShape = {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 1,
    sizeV: 1,
    heightPx: shapeType === 'theotown_base' ? 0 : shapeType === 'sphere' ? 18 : 24,
    ori: 0,
    prismSides: 6,
    triPrismCut: 'vertical',
    wedgeMode: 'ramp',
    domeMode: 'dome',
    roofColor: null,
    autoShade: true,
    shadeContrast: 1.0,
    outlineMode: 'none',
    outlineColor: null,
    edgeHighlight: true,
    ...overrides,
    shapeType,
    baseColor,
    pattern,
  };
  if (overrides.flipZ && shapeType !== 'theotown_base') {
    out.flipZ = true;
  } else {
    delete out.flipZ;
  }
  if (shapeType !== 'theotown_base') {
    const tu = normalizeTiltDeg(overrides.tiltUDeg);
    const tv = normalizeTiltDeg(overrides.tiltVDeg);
    if (tu !== 0) out.tiltUDeg = tu;
    else delete out.tiltUDeg;
    if (tv !== 0) out.tiltVDeg = tv;
    else delete out.tiltVDeg;
    if (overrides.tiltPivot === 'bottom') out.tiltPivot = 'bottom';
    else delete out.tiltPivot;
  } else {
    delete out.tiltUDeg;
    delete out.tiltVDeg;
    delete out.tiltPivot;
  }
  if (hasLoftData && loftSections) {
    out.loftSections = loftSections;
    out.loftInterp = overrides.loftInterp ?? 'smooth';
    out.loftHollow = Boolean(overrides.loftHollow);
    if (overrides.loftFloorT && Number.isFinite(overrides.loftFloorT) && overrides.loftFloorT > 0) {
      out.loftFloorT = clamp(overrides.loftFloorT, 0, 0.90);
    } else {
      delete out.loftFloorT;
    }
    out.activeLoftSectionId = overrides.activeLoftSectionId ?? loftSections[loftSections.length - 1]?.id;
  } else {
    delete out.loftSections;
    delete out.loftInterp;
    delete out.loftHollow;
    delete out.loftFloorT;
    delete out.activeLoftSectionId;
  }
  if (hasArchData && archNodes) {
    out.archNodes = archNodes;
    out.archHollow = overrides.archHollow ?? false;
    out.archHollowStyle = overrides.archHollowStyle ?? 'shell';
    out.archInnerMode = overrides.archInnerMode ?? 'parallel';
    out.archThickness = clamp(
      Number.isFinite(overrides.archThickness) ? overrides.archThickness! : 0.28,
      0.06,
      0.78,
    );
    if (overrides.archInnerNodes && overrides.archInnerNodes.length >= 2) {
      out.archInnerNodes = cloneArchNodes(overrides.archInnerNodes);
    } else {
      delete out.archInnerNodes;
    }
  } else {
    delete out.archNodes;
    delete out.archInnerNodes;
    delete out.archHollow;
    delete out.archHollowStyle;
    delete out.archInnerMode;
    delete out.archThickness;
  }
  if (hasActiveColumnSections(out)) {
    out.colSections = cloneColumnSections(out.colSections!);
    out.colInterp = out.colInterp ?? 'smooth';
    out.activeColSectionId = out.activeColSectionId ?? out.colSections[out.colSections.length - 1]?.id;
  } else {
    delete out.colSections;
    delete out.colInterp;
    delete out.activeColSectionId;
  }
  if (isPlanarTextureShape(out) && overrides.faceTextures) {
    out.faceTextures = cloneFaceTextures(overrides.faceTextures);
    sanitizeFaceTexturesForShape(out);
  } else {
    delete out.faceTextures;
    delete out.activeFaceId;
  }
  return out;
}

export function cloneShape(s: ParametricShape): ParametricShape {
  const copy: ParametricShape = {
    ...s,
    baseColor: { ...s.baseColor },
    roofColor: s.roofColor ? { ...s.roofColor } : null,
    outlineColor: s.outlineColor ? { ...s.outlineColor } : null,
    pattern: {
      ...s.pattern,
      primaryColor: { ...s.pattern.primaryColor },
    },
    faceTextures: cloneFaceTextures(s.faceTextures),
  };
  if (s.flipZ && s.shapeType !== 'theotown_base') {
    copy.flipZ = true;
  } else {
    delete copy.flipZ;
  }
  if (s.shapeType !== 'theotown_base') {
    const tu = normalizeTiltDeg(s.tiltUDeg);
    const tv = normalizeTiltDeg(s.tiltVDeg);
    if (tu !== 0) copy.tiltUDeg = tu;
    else delete copy.tiltUDeg;
    if (tv !== 0) copy.tiltVDeg = tv;
    else delete copy.tiltVDeg;
    if (s.tiltPivot === 'bottom') copy.tiltPivot = 'bottom';
    else delete copy.tiltPivot;
  } else {
    delete copy.tiltUDeg;
    delete copy.tiltVDeg;
    delete copy.tiltPivot;
  }
  if (s.shapeType === 'loft') {
    copy.loftSections = cloneLoftSections(s.loftSections ?? createDefaultLoftSections());
    copy.loftInterp = s.loftInterp ?? 'smooth';
    copy.loftHollow = Boolean(s.loftHollow);
    if (s.loftFloorT && Number.isFinite(s.loftFloorT) && s.loftFloorT > 0) {
      copy.loftFloorT = clamp(s.loftFloorT, 0, 0.90);
    } else {
      delete copy.loftFloorT;
    }
  } else {
    delete copy.loftSections;
    delete copy.loftInterp;
    delete copy.loftHollow;
    delete copy.loftFloorT;
    delete copy.activeLoftSectionId;
  }
  if (s.shapeType === 'arch') {
    copy.archNodes = cloneArchNodes(s.archNodes ?? createArchPresetNodes('semicircle'));
    copy.archHollow = s.archHollow ?? false;
    copy.archHollowStyle = s.archHollowStyle ?? 'shell';
    copy.archInnerMode = s.archInnerMode ?? 'parallel';
    copy.archThickness = clamp(
      Number.isFinite(s.archThickness) ? s.archThickness! : 0.28,
      0.06,
      0.78,
    );
    if (s.archInnerNodes && s.archInnerNodes.length >= 2) {
      copy.archInnerNodes = cloneArchNodes(s.archInnerNodes);
    } else {
      delete copy.archInnerNodes;
    }
  } else {
    delete copy.archNodes;
    delete copy.archInnerNodes;
    delete copy.archHollow;
    delete copy.archHollowStyle;
    delete copy.archInnerMode;
    delete copy.archThickness;
  }
  if (hasActiveColumnSections(s)) {
    copy.colSections = cloneColumnSections(s.colSections!);
    copy.colInterp = s.colInterp ?? 'smooth';
    if (s.activeColSectionId) {
      copy.activeColSectionId = s.activeColSectionId;
    } else {
      delete copy.activeColSectionId;
    }
  } else {
    delete copy.colSections;
    delete copy.colInterp;
    delete copy.activeColSectionId;
  }
  if (isPlanarTextureShape(copy)) {
    if (!copy.faceTextures) delete copy.faceTextures;
    if (!s.activeFaceId) delete copy.activeFaceId;
  } else {
    delete copy.faceTextures;
    delete copy.activeFaceId;
  }
  return copy;
}

// ---------------- Pixel Rasterization Primitives ----------------

function setPixel(dst: Uint8ClampedArray, w: number, h: number, x: number, y: number, col: RGBA) {
  if (col.a <= 0) return;
  const ix = x | 0;
  const iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
  const di = (iy * w + ix) * 4;
  dst[di] = col.r;
  dst[di + 1] = col.g;
  dst[di + 2] = col.b;
  dst[di + 3] = 255;
}

export function drawPixelLine(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  col: RGBA,
  skipEndpoints = false,
) {
  let ix0 = Math.round(x0);
  let iy0 = Math.round(y0);
  const ix1 = Math.round(x1);
  const iy1 = Math.round(y1);
  const sx0 = ix0;
  const sy0 = iy0;
  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;

  for (let guard = 0; guard < 16384; guard++) {
    const isEnd = (ix0 === sx0 && iy0 === sy0) || (ix0 === ix1 && iy0 === iy1);
    if (!skipEndpoints || !isEnd) {
      setPixel(dst, w, h, ix0, iy0, col);
    }
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; ix0 += sx; }
    if (e2 < dx) { err += dx; iy0 += sy; }
  }
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function isTopLeftEdge(x0: number, y0: number, x1: number, y1: number): boolean {
  const dy = y1 - y0;
  const dx = x1 - x0;
  return (dy < 0) || (dy === 0 && dx > 0);
}

/**
 * Watertight integer pixel convex polygon fill using half-pixel centers (px + 0.5, py + 0.5).
 */
export function fillConvexPolyInt(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  pts: [number, number][],
  shader: (px: number, py: number) => RGBA | null,
  onWrite?: (px: number, py: number) => void,
) {
  const n = pts.length;
  if (n < 3) return;
  let signedArea2 = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    signedArea2 += x0 * y1 - x1 * y0;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x0 > maxX) maxX = x0;
    if (y0 > maxY) maxY = y0;
  }
  if (Math.abs(signedArea2) < 1e-5) return;
  const sign = signedArea2 > 0 ? 1 : -1;

  const xStart = Math.max(0, Math.floor(minX));
  const yStart = Math.max(0, Math.floor(minY));
  const xEnd = Math.min(w - 1, Math.ceil(maxX));
  const yEnd = Math.min(h - 1, Math.ceil(maxY));

  for (let py = yStart; py <= yEnd; py++) {
    const cy = py + 0.5;
    for (let px = xStart; px <= xEnd; px++) {
      const cx = px + 0.5;
      let inside = true;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        const c = sign * cross2(x1 - x0, y1 - y0, cx - x0, cy - y0);
        if (c < -1e-6) { inside = false; break; }
        if (c <= 1e-6 && !isTopLeftEdge(x0, y0, x1, y1)) { inside = false; break; }
      }
      if (!inside) continue;
      const col = shader(px, py);
      if (col) {
        setPixel(dst, w, h, px, py, col);
        onWrite?.(px, py);
      }
    }
  }
}

// ---------------- Shading & Procedural Pattern Sampling ----------------

export const MIN_SHADE_CONTRAST = 0.3;
export const MAX_SHADE_CONTRAST = 5.0;

export function clampShadeContrast(contrast: number): number {
  return clamp(Number.isFinite(contrast) ? contrast : 1.0, MIN_SHADE_CONTRAST, MAX_SHADE_CONTRAST);
}

/** 0 = continuous smooth shading; 3..64 = quantized discrete shade steps */
export function normalizeShadeSteps(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return clamp(Math.round(v), 3, 64);
}

export function quantizeShadeNdl(ndl: number, shadeSteps: number): number {
  if (shadeSteps <= 0) return ndl;
  const n = clamp(Math.round(shadeSteps), 3, 64);
  const lo = -0.72;
  const hi = 1.0;
  const t = clamp((ndl - lo) / (hi - lo), 0, 1);
  const bin = Math.min(n - 1, Math.floor(t * n));
  return lo + (bin / (n - 1)) * (hi - lo);
}

export interface ShapeRenderAuxBuffers {
  zData: Float32Array;
  sunFacing: Uint8Array;
}

const SUN_METRIC_LEN = Math.hypot(-0.5625, 0.5625, 1);

/**
 * Classifies outward metric normal (18u', 18v', z) against the 1:1 right-cast TheoTown sun (-0.5625, +0.5625, +1):
 * 0 = back-facing (never receives cast shadow),
 * 1 = grazing sun-facing (receives inter-block shadow from other shapes),
 * 2 = clearly sun-facing (also eligible for concave self-shadowing on arch/loft/multi-section shapes).
 */
export function classifySunFacingMetricNormal(nx: number, ny: number, nz: number): 0 | 1 | 2 {
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-8) return 0;
  const dot = (-0.5625 * nx + 0.5625 * ny + nz) / (len * SUN_METRIC_LEN);
  if (dot <= 1e-4) return 0;
  return dot > 0.36 ? 2 : 1;
}

/** True if outward metric normal (18u', 18v', z) faces the 1:1 right-cast TheoTown sun vector (-0.5625, +0.5625, +1). */
export function isSunFacingMetricNormal(nx: number, ny: number, nz: number): boolean {
  return -0.5625 * nx + 0.5625 * ny + nz > 1e-4;
}

let activeShadeSteps = 0;
let activeRenderAux: ShapeRenderAuxBuffers | null = null;

interface PaletteTriad {
  top: RGBA;
  left: RGBA;
  right: RGBA;
  outline: RGBA;
  highlight: RGBA;
}

function buildShadingTriad(shape: ParametricShape): PaletteTriad {
  const c = clampShadeContrast(shape.shadeContrast);
  const base = shape.baseColor;
  const roofBase = shape.roofColor ?? base;
  const kTop = Math.tanh(0.28 * c);
  const kLeft = Math.tanh(0.11 * c);
  const kRight = Math.tanh(0.35 * c);
  const top = shape.autoShade
    ? shadeColorSoftHsv(roofBase, 1 - 0.28 * kTop, 1 + 0.50 * kTop)
    : { ...roofBase };
  const left = shape.autoShade
    ? shadeColorSoftHsv(base, 1 + 0.14 * kLeft, 1 - 0.46 * kLeft)
    : { ...base };
  const right = shape.autoShade
    ? shadeColorSoftHsv(base, 1 + 0.22 * kRight, 1 - 0.88 * kRight)
    : { ...base };
  const outline = shape.outlineColor
    ? { ...shape.outlineColor }
    : shadeColorHsv(base, 1.15, 0.28);
  const highlight = shadeColorSoftHsv(roofBase, 0.72, 1.32);
  return { top, left, right, outline, highlight };
}

function shadeByNormal(
  base: RGBA,
  nx: number,
  ny: number,
  nz: number,
  autoShade: boolean,
  contrast: number,
  roofBase?: RGBA | null,
): RGBA {
  const len = Math.hypot(nx, ny, nz) || 1;
  const ux = nx / len, uy = ny / len, uz = nz / len;
  if (!autoShade) return uz > 0.7 && roofBase ? { ...roofBase } : { ...base };
  // Light vector in isometric (u', v', z) space: upper-left-top (-0.55, +0.45, +0.70)
  const lx = -0.55, ly = 0.45, lz = 0.70;
  const lLen = Math.hypot(lx, ly, lz);
  const ndl = (ux * lx + uy * ly + uz * lz) / lLen; // [-1, 1]
  const effNdl = quantizeShadeNdl(ndl, activeShadeSteps);
  const c = clampShadeContrast(contrast);
  const x = effNdl - 0.22;
  let vFactor: number;
  let sFactor: number;
  if (x >= 0) {
    const k = Math.tanh(x * 0.52 * c);
    vFactor = 1 + 0.54 * k;
    sFactor = 1 - 0.26 * k;
  } else {
    const k = Math.tanh((-x) * 0.42 * c);
    vFactor = 1 - 0.90 * k;
    sFactor = 1 + 0.28 * k;
  }
  const src = uz > 0.7 && roofBase ? roofBase : base;
  return shadeColorSoftHsv(src, sFactor, vFactor);
}

function sampleWallPattern(
  wx: number,
  wy: number,
  wallW: number,
  wallH: number,
  pattern: FacadePatternConfig,
  wallCol: RGBA,
  faceShade: 'left' | 'right' | 'curve',
): RGBA {
  if (pattern.type === 'none' || pattern.type === 'roof_grid') return wallCol;
  if (wallW < 4 || wallH < 4) return wallCol;

  const margin = Math.max(0, Math.round(pattern.marginPx));
  const spacing = Math.max(1, Math.round(pattern.spacingPx));
  const rows = Math.max(1, Math.round(pattern.rows));
  const cols = Math.max(1, Math.round(pattern.cols));

  const patCol = faceShade === 'right'
    ? shadeColorHsv(pattern.primaryColor, 1.05, 0.76)
    : faceShade === 'curve'
      ? shadeColorHsv(pattern.primaryColor, 1.02, 0.90)
      : pattern.primaryColor;

  if (pattern.type === 'brick') {
    const brickH = Math.max(3, Math.floor(wallH / Math.max(2, rows * 2)));
    const brickW = Math.max(5, Math.floor(wallW / Math.max(2, cols)));
    const rowIdx = Math.floor(wy / brickH);
    const yInBrick = wy - rowIdx * brickH;
    const xShifted = wx + (rowIdx % 2 === 1 ? Math.floor(brickW / 2) : 0);
    const xInBrick = ((xShifted % brickW) + brickW) % brickW;
    if (yInBrick === 0 || xInBrick === 0) {
      return shadeColorHsv(wallCol, 1.05, 0.74);
    }
    if (rowIdx % 3 === 1 && yInBrick === 1 && xInBrick > 1 && xInBrick < brickW - 1) {
      return shadeColorHsv(wallCol, 0.92, 1.08);
    }
    return wallCol;
  }

  const ix = Math.floor(wx);
  const iy = Math.floor(wy);
  if (ix < margin || ix >= wallW - margin || iy < margin || iy >= wallH - margin) {
    return wallCol;
  }
  const innerW = wallW - margin * 2;
  const innerH = wallH - margin * 2;
  const rx = ix - margin;
  const ry = iy - margin;

  if (pattern.type === 'windows') {
    const cellW = (innerW + spacing) / cols;
    const cellH = (innerH + spacing) / rows;
    const winW = Math.floor(cellW - spacing);
    const winH = Math.floor(cellH - spacing);
    if (winW < 1 || winH < 1) return wallCol;
    const colIdx = Math.floor(rx / cellW);
    const rowIdx = Math.floor(ry / cellH);
    if (colIdx >= cols || rowIdx >= rows) return wallCol;
    const lx = rx - Math.floor(colIdx * cellW);
    const ly = ry - Math.floor(rowIdx * cellH);
    if (lx >= 0 && lx < winW && ly >= 0 && ly < winH) {
      if (winH >= 3 && ly === 0) return shadeColorHsv(patCol, 1.08, 0.72);
      return patCol;
    }
    return wallCol;
  }

  if (pattern.type === 'curtain_v') {
    const cellW = (innerW + spacing) / cols;
    const barW = Math.max(1, Math.floor(cellW - spacing));
    const colIdx = Math.floor(rx / cellW);
    if (colIdx >= cols) return wallCol;
    const lx = rx - Math.floor(colIdx * cellW);
    return lx >= 0 && lx < barW ? patCol : wallCol;
  }

  if (pattern.type === 'curtain_h') {
    const cellH = (innerH + spacing) / rows;
    const bandH = Math.max(1, Math.floor(cellH - spacing));
    const rowIdx = Math.floor(ry / cellH);
    if (rowIdx >= rows) return wallCol;
    const ly = ry - Math.floor(rowIdx * cellH);
    if (ly >= 0 && ly < bandH) {
      return bandH >= 3 && ly === 0 ? shadeColorHsv(patCol, 1.08, 0.75) : patCol;
    }
    return wallCol;
  }

  return wallCol;
}

function sampleTopGridColor(
  uFrac: number,
  vFrac: number,
  sizeU: number,
  sizeV: number,
  topCol: RGBA,
  pattern: FacadePatternConfig,
): RGBA {
  if (pattern.type !== 'roof_grid' && !pattern.applyTop) return topCol;
  const cols = Math.max(1, Math.round(pattern.cols));
  const rows = Math.max(1, Math.round(pattern.rows));
  const stepU = 1 / cols;
  const stepV = 1 / rows;
  const tolU = 1 / Math.max(12, sizeU * 16);
  const tolV = 1 / Math.max(12, sizeV * 16);
  const du = Math.abs((uFrac / stepU) - Math.round(uFrac / stepU)) * stepU;
  const dv = Math.abs((vFrac / stepV) - Math.round(vFrac / stepV)) * stepV;
  if (du < tolU || dv < tolV) {
    return pattern.type === 'roof_grid'
      ? pattern.primaryColor
      : shadeColorHsv(topCol, 1.05, 0.82);
  }
  return topCol;
}

function applyInnerSilhouetteOutline(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  outlineCol: RGBA,
) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (buf[i * 4 + 3] > 0) mask[i] = 1;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx]) continue;
      const isEdge =
        x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[idx - 1] || !mask[idx + 1] || !mask[idx - w] || !mask[idx + w];
      if (isEdge) {
        const di = idx * 4;
        buf[di] = outlineCol.r;
        buf[di + 1] = outlineCol.g;
        buf[di + 2] = outlineCol.b;
        buf[di + 3] = 255;
      }
    }
  }
}

// ---------------- Convex 3D Mesh Helper (for Box, Prism, Wedge, Pyramid) ----------------

export interface Vec3 { x: number; y: number; z: number } // (u', v', zPx)

export interface MeshFace {
  verts: Vec3[];
  kind: 'top' | 'left' | 'right' | 'slope';
  faceId?: string;
  uvOrigin?: Vec3;
  uvEndU?: Vec3;
  uvEndV?: Vec3;
}

function computeFaceTextureShadeFactor(
  nx: number,
  ny: number,
  nz: number,
  autoShade: boolean,
  contrast: number,
): number {
  if (!autoShade) return 1;
  const c = clampShadeContrast(contrast);
  const isTopFlat = Math.abs(nx) < 1e-4 && Math.abs(ny) < 1e-4 && nz > 0;
  const isLeftPure = Math.abs(nx) < 1e-4 && ny > 0 && Math.abs(nz) < 1e-4;
  const isRightPure = nx > 0 && Math.abs(ny) < 1e-4 && Math.abs(nz) < 1e-4;
  if (isTopFlat) return 1 + 0.28 * Math.tanh(0.28 * c);
  if (isLeftPure) return 1 - 0.38 * Math.tanh(0.11 * c);
  if (isRightPure) return 1 - 0.78 * Math.tanh(0.35 * c);
  const len = Math.hypot(nx, ny, nz) || 1;
  const ux = nx / len, uy = ny / len, uz = nz / len;
  const lx = -0.55, ly = 0.45, lz = 0.70;
  const lLen = Math.hypot(lx, ly, lz);
  const ndl = (ux * lx + uy * ly + uz * lz) / lLen;
  const effNdl = quantizeShadeNdl(ndl, activeShadeSteps);
  const x = effNdl - 0.22;
  if (x >= 0) return 1 + 0.35 * Math.tanh(x * 0.50 * c);
  return 1 - 0.78 * Math.tanh((-x) * 0.40 * c);
}

function compositeFaceTexelOverBase(base: RGBA, tex: RGBA, shadeFactor: number): RGBA {
  const tr = clamp(Math.round(tex.r * shadeFactor), 0, 255);
  const tg = clamp(Math.round(tex.g * shadeFactor), 0, 255);
  const tb = clamp(Math.round(tex.b * shadeFactor), 0, 255);
  if (tex.a >= 250) {
    return { r: tr, g: tg, b: tb, a: 255 };
  }
  const a = tex.a / 255;
  const inv = 1 - a;
  return {
    r: clamp(Math.round(base.r * inv + tr * a), 0, 255),
    g: clamp(Math.round(base.g * inv + tg * a), 0, 255),
    b: clamp(Math.round(base.b * inv + tb * a), 0, 255),
    a: 255,
  };
}

export const METRIC_PX_PER_CELL = 18; // 1 cell = 9.6m, 1 zPx = 1.6/3 m => 1 cell = 18 zPx

export function normalizeTiltDeg(deg?: number | null): number {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 0;
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  d = Math.round(d * 100) / 100;
  if (Math.abs(d) < 1e-6) return 0;
  if (d <= -180 + 1e-6) return 180;
  return d;
}

export function hasActiveTilt(
  shape?: Pick<ParametricShape, 'shapeType' | 'tiltUDeg' | 'tiltVDeg'> | null,
): boolean {
  if (!shape || shape.shapeType === 'theotown_base') return false;
  return Math.abs(normalizeTiltDeg(shape.tiltUDeg)) > 1e-4 || Math.abs(normalizeTiltDeg(shape.tiltVDeg)) > 1e-4;
}

export interface TiltTransform {
  cuView: number;
  cvView: number;
  /** Local vertical rotation pivot elevation before any bottom-flush compensation */
  czView: number;
  /** Output vertical elevation origin (equals czView for 'center' pivot; shifted upward for 'bottom' pivot so minZ === z0) */
  czOut: number;
  lsu: number;
  lsv: number;
  ori: ViewRotation;
  z0: number;
  z1: number;
  /** Orthogonal 3x3 matrix M = R_ori * R_v(tv) * R_u(tu) mapping local metric (lx, ly, lz) -> view metric (vx, vy, vz) */
  m00: number; m01: number; m02: number;
  m10: number; m11: number; m12: number;
  m20: number; m21: number; m22: number;
}

function computeBottomPivotMinVz(
  lsu: number,
  lsv: number,
  H: number,
  m20: number,
  m21: number,
  m22: number,
  shape?: ParametricShape,
): number {
  const rx = Math.max(0.5, lsu * METRIC_PX_PER_CELL * 0.5);
  const ry = Math.max(0.5, lsv * METRIC_PX_PER_CELL * 0.5);
  const evalPt = (lu: number, lv: number, lz: number) =>
    m20 * ((lu - 0.5) * lsu * METRIC_PX_PER_CELL) +
    m21 * ((lv - 0.5) * lsv * METRIC_PX_PER_CELL) +
    m22 * lz;

  if (!shape || (shape.shapeType === 'box' && !hasActiveColumnSections(shape))) {
    return -Math.abs(m20) * rx - Math.abs(m21) * ry + Math.min(0, m22 * H);
  }
  const flipZ = Boolean(shape.flipZ);
  if (shape.shapeType === 'sphere' || (shape.shapeType === 'dome' && shape.domeMode === 'sphere')) {
    const rz = Math.max(0.5, H * 0.5);
    return m22 * (H * 0.5) - Math.hypot(m20 * rx, m21 * ry, m22 * rz);
  }
  if (shape.shapeType === 'cylinder' && !hasActiveColumnSections(shape)) {
    return Math.min(0, m22 * H) - Math.hypot(m20 * rx, m21 * ry);
  }
  if (shape.shapeType === 'cone') {
    const lzBase = flipZ ? H : 0;
    const lzApex = flipZ ? 0 : H;
    return Math.min(m22 * lzBase - Math.hypot(m20 * rx, m21 * ry), m22 * lzApex);
  }
  if (shape.shapeType === 'dome') {
    const zPlane = flipZ ? H : 0;
    const signZ = flipZ ? -1 : 1;
    const a = m20 * rx;
    const b = m21 * ry;
    const c = m22 * signZ * Math.max(0.5, H);
    return m22 * zPlane - (c < 0 ? Math.hypot(a, b, c) : Math.hypot(a, b));
  }

  let minVz = Infinity;
  const check = (lu: number, lv: number, lz: number) => {
    const v = evalPt(lu, lv, lz);
    if (v < minVz) minVz = v;
  };

  if (shape.shapeType === 'loft') {
    const rawLoft = buildAlignedLoftRings(
      normalizeLoftSections(shape.loftSections),
      24,
      16,
      shape.loftInterp ?? 'smooth',
      false,
      lsu,
      lsv,
      0,
    );
    for (const ring of rawLoft.rings) {
      const lz = (flipZ ? 1 - ring.t : ring.t) * H;
      for (const [lu, lv] of ring.pts) check(lu, lv, lz);
    }
    return Number.isFinite(minVz) ? minVz : 0;
  }
  if (hasActiveColumnSections(shape)) {
    const rawRings = buildColumnRings(shape, 16, 24);
    for (const ring of rawRings) {
      const lz = (flipZ ? 1 - ring.t : ring.t) * H;
      for (const [lu, lv] of ring.pts) check(lu, lv, lz);
    }
    return Number.isFinite(minVz) ? minVz : 0;
  }
  if (shape.shapeType === 'right_tri_prism') {
    if ((shape.triPrismCut ?? 'vertical') === 'slope') {
      const lzBase = flipZ ? H : 0;
      const lzTop = flipZ ? 0 : H;
      check(0, 0, lzBase); check(0, 1, lzBase); check(1, 1, lzBase); check(1, 0, lzBase);
      check(1, 0, lzTop); check(1, 1, lzTop);
    } else {
      for (const lz of [0, H]) {
        check(0, 0, lz); check(0, 1, lz); check(1, 0, lz);
      }
    }
    return minVz;
  }
  if (shape.shapeType === 'prism') {
    const n = Math.max(3, Math.min(12, Math.round(shape.prismSides)));
    const startAngle = Math.PI / n;
    for (let i = 0; i < n; i++) {
      const ang = startAngle - (i * Math.PI * 2) / n;
      const lu = 0.5 + Math.cos(ang) * 0.5;
      const lv = 0.5 + Math.sin(ang) * 0.5;
      check(lu, lv, 0);
      check(lu, lv, H);
    }
    return minVz;
  }
  if (shape.shapeType === 'wedge') {
    const lzBase = flipZ ? H : 0;
    const lzTop = flipZ ? 0 : H;
    check(0, 0, lzBase); check(0, 1, lzBase); check(1, 1, lzBase); check(1, 0, lzBase);
    if (shape.wedgeMode === 'gable') {
      check(0, 0.5, lzTop); check(1, 0.5, lzTop);
    } else {
      check(1, 0, lzTop); check(1, 1, lzTop);
    }
    return minVz;
  }
  if (shape.shapeType === 'pyramid') {
    const lzBase = flipZ ? H : 0;
    const lzTop = flipZ ? 0 : H;
    check(0, 0, lzBase); check(0, 1, lzBase); check(1, 1, lzBase); check(1, 0, lzBase);
    check(0.5, 0.5, lzTop);
    return minVz;
  }
  if (shape.shapeType === 'arch') {
    const cs = buildArchCrossSection({
      outerNodes: shape.archNodes,
      hollow: shape.archHollow ?? false,
      hollowStyle: shape.archHollowStyle ?? 'shell',
      innerMode: shape.archInnerMode ?? 'parallel',
      thickness: shape.archThickness ?? 0.28,
      innerNodes: shape.archInnerNodes,
      spanMetric: Math.max(4, lsu * 18),
      heightMetric: Math.max(4, H),
      sampleCount: 18,
    });
    for (const [s, hFrac] of cs.poly) {
      const lz = (flipZ ? 1 - hFrac : hFrac) * H;
      check(s, 0, lz);
      check(s, 1, lz);
    }
    return Number.isFinite(minVz) ? minVz : 0;
  }
  return -Math.abs(m20) * rx - Math.abs(m21) * ry + Math.min(0, m22 * H);
}

export function buildTiltTransform(
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  ori: ViewRotation,
  tiltUDeg?: number,
  tiltVDeg?: number,
  tiltPivot?: TiltPivot,
  shape?: ParametricShape,
): TiltTransform {
  const tu = (normalizeTiltDeg(tiltUDeg) * Math.PI) / 180;
  const tv = (normalizeTiltDeg(tiltVDeg) * Math.PI) / 180;
  const cu = Math.cos(tu);
  const suSin = Math.sin(tu);
  const cv = Math.cos(tv);
  const svSin = Math.sin(tv);

  // R_tilt = R_v(tv) * R_u(tu)
  const r00 = cu,          r01 = 0,     r02 = suSin;
  const r10 = -suSin * svSin, r11 = cv, r12 = cu * svSin;
  const r20 = -suSin * cv, r21 = -svSin, r22 = cu * cv;

  let m00: number, m01: number, m02: number;
  let m10: number, m11: number, m12: number;
  switch (ori) {
    case 0:
      m00 = r00; m01 = r01; m02 = r02;
      m10 = r10; m11 = r11; m12 = r12;
      break;
    case 1:
      m00 = -r10; m01 = -r11; m02 = -r12;
      m10 = r00;  m11 = r01;  m12 = r02;
      break;
    case 2:
      m00 = -r00; m01 = -r01; m02 = -r02;
      m10 = -r10; m11 = -r11; m12 = -r12;
      break;
    case 3:
      m00 = r10;  m01 = r11;  m02 = r12;
      m10 = -r00; m11 = -r01; m12 = -r02;
      break;
  }
  const m20 = r20, m21 = r21, m22 = r22;

  const odd = ori % 2 === 1;
  const lsu = odd ? sv : su;
  const lsv = odd ? su : sv;
  const cuView = u0 + su * 0.5;
  const cvView = v0 + sv * 0.5;
  const czView = tiltPivot === 'bottom' ? z0 : z0 + (z1 - z0) * 0.5;
  const czOut =
    tiltPivot === 'bottom'
      ? czView - computeBottomPivotMinVz(lsu, lsv, Math.max(0, z1 - z0), m20, m21, m22, shape)
      : czView;

  return {
    cuView,
    cvView,
    czView,
    czOut,
    lsu,
    lsv,
    ori,
    z0,
    z1,
    m00, m01, m02,
    m10, m11, m12,
    m20, m21, m22,
  };
}

export function transformLocalPointWithTilt(
  lu: number,
  lv: number,
  z: number,
  tilt: TiltTransform,
): Vec3 {
  const lx = (lu - 0.5) * tilt.lsu * METRIC_PX_PER_CELL;
  const ly = (lv - 0.5) * tilt.lsv * METRIC_PX_PER_CELL;
  const lz = z - tilt.czView;
  const vx = tilt.m00 * lx + tilt.m01 * ly + tilt.m02 * lz;
  const vy = tilt.m10 * lx + tilt.m11 * ly + tilt.m12 * lz;
  const vz = tilt.m20 * lx + tilt.m21 * ly + tilt.m22 * lz;
  return {
    x: tilt.cuView + vx / METRIC_PX_PER_CELL,
    y: tilt.cvView + vy / METRIC_PX_PER_CELL,
    z: tilt.czOut + vz,
  };
}

export function tiltVec3WithTransform(pt: Vec3, tilt: TiltTransform): Vec3 {
  const dx = (pt.x - tilt.cuView) * METRIC_PX_PER_CELL;
  const dy = (pt.y - tilt.cvView) * METRIC_PX_PER_CELL;
  const dz = pt.z - tilt.czView;
  let lx: number, ly: number;
  switch (tilt.ori) {
    case 0: lx = dx; ly = dy; break;
    case 1: lx = dy; ly = -dx; break;
    case 2: lx = -dx; ly = -dy; break;
    case 3: lx = -dy; ly = dx; break;
  }
  const vx = tilt.m00 * lx + tilt.m01 * ly + tilt.m02 * dz;
  const vy = tilt.m10 * lx + tilt.m11 * ly + tilt.m12 * dz;
  const vz = tilt.m20 * lx + tilt.m21 * ly + tilt.m22 * dz;
  return {
    x: tilt.cuView + vx / METRIC_PX_PER_CELL,
    y: tilt.cvView + vy / METRIC_PX_PER_CELL,
    z: tilt.czOut + vz,
  };
}

export function tiltNormalToView(
  nxLoc: number,
  nyLoc: number,
  nzLoc: number,
  tilt: TiltTransform,
): [number, number, number] {
  return [
    tilt.m00 * nxLoc + tilt.m01 * nyLoc + tilt.m02 * nzLoc,
    tilt.m10 * nxLoc + tilt.m11 * nyLoc + tilt.m12 * nzLoc,
    tilt.m20 * nxLoc + tilt.m21 * nyLoc + tilt.m22 * nzLoc,
  ];
}

export function tiltMeshFaces(faces: MeshFace[], tilt: TiltTransform): MeshFace[] {
  return faces.map((f) => ({
    ...f,
    verts: f.verts.map((pt) => tiltVec3WithTransform(pt, tilt)),
    uvOrigin: f.uvOrigin ? tiltVec3WithTransform(f.uvOrigin, tilt) : undefined,
    uvEndU: f.uvEndU ? tiltVec3WithTransform(f.uvEndU, tilt) : undefined,
    uvEndV: f.uvEndV ? tiltVec3WithTransform(f.uvEndV, tilt) : undefined,
  }));
}

export function transformLocalToViewPoint(
  lu: number,
  lv: number,
  z: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  ori: ViewRotation,
): Vec3 {
  let fu = lu, fv = lv;
  switch (ori) {
    case 0: fu = lu; fv = lv; break;
    case 1: fu = 1 - lv; fv = lu; break;
    case 2: fu = 1 - lu; fv = 1 - lv; break;
    case 3: fu = lv; fv = 1 - lu; break;
  }
  return { x: u0 + fu * su, y: v0 + fv * sv, z };
}

function viewFracToLocal(
  vuFrac: number,
  vvFrac: number,
  viewOri: ViewRotation,
  vsu: number,
  vsv: number,
): { luFrac: number; lvFrac: number; lsu: number; lsv: number } {
  const odd = viewOri % 2 === 1;
  const lsu = odd ? vsv : vsu;
  const lsv = odd ? vsu : vsv;
  switch (viewOri) {
    case 0: return { luFrac: vuFrac, lvFrac: vvFrac, lsu, lsv };
    case 1: return { luFrac: vvFrac, lvFrac: 1 - vuFrac, lsu, lsv };
    case 2: return { luFrac: 1 - vuFrac, lvFrac: 1 - vvFrac, lsu, lsv };
    case 3: return { luFrac: 1 - vvFrac, lvFrac: vuFrac, lsu, lsv };
  }
}

function renderConvexMesh(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  faces: MeshFace[],
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  viewOri: ViewRotation,
) {
  const visibleFaces: {
    face: MeshFace;
    screen: [number, number][];
    nx: number;
    ny: number;
    nz: number;
  }[] = [];

  let meshMinX = Infinity, meshMinY = Infinity, meshMaxX = -Infinity, meshMaxY = -Infinity;

  for (const face of faces) {
    if (face.verts.length < 3) continue;
    const screen = face.verts.map((pt) => isoToScreenPx(pt.x, pt.y, pt.z, originX, originY));
    // Test visibility via 2D screen cross product.
    // Because vertices are wound CCW when viewed from outside (and screen Y is downward),
    // visible front-facing polygons have negative signed area.
    let area2 = 0;
    for (let i = 0; i < screen.length; i++) {
      const [ax, ay] = screen[i];
      const [bx, by] = screen[(i + 1) % screen.length];
      area2 += ax * by - bx * ay;
    }
    if (area2 >= -1e-2) continue;

    for (const [sx, sy] of screen) {
      if (sx < meshMinX) meshMinX = sx;
      if (sy < meshMinY) meshMinY = sy;
      if (sx > meshMaxX) meshMaxX = sx;
      if (sy > meshMaxY) meshMaxY = sy;
    }

    // Metric-scaled outward normal in (u'*18, v'*18, z) space
    const p0 = face.verts[0];
    const p1 = face.verts[1];
    const p2 = face.verts[2];
    const e1x = (p1.x - p0.x) * 18, e1y = (p1.y - p0.y) * 18, e1z = p1.z - p0.z;
    const e2x = (p2.x - p0.x) * 18, e2y = (p2.y - p0.y) * 18, e2z = p2.z - p0.z;
    const nx = -(e1y * e2z - e1z * e2y);
    const ny = -(e1z * e2x - e1x * e2z);
    const nz = -(e1x * e2y - e1y * e2x);

    visibleFaces.push({ face, screen, nx, ny, nz });
  }

  if (visibleFaces.length === 0) return;

  const bMinX = clamp(Math.floor(meshMinX) - 1, 0, w - 1);
  const bMaxX = clamp(Math.ceil(meshMaxX) + 1, 0, w - 1);
  const bMinY = clamp(Math.floor(meshMinY) - 1, 0, h - 1);
  const bMaxY = clamp(Math.ceil(meshMaxY) + 1, 0, h - 1);
  if (bMinX > bMaxX || bMinY > bMaxY) return;

  const bw = bMaxX - bMinX + 1;
  const bh = bMaxY - bMinY + 1;
  const mask = new Uint8Array(bw * bh);
  const faceSpecMap = shape.faceTextures
    ? new Map<string, PlanarFaceSpec>(getPlanarFacesForShape(shape).map((fs) => [fs.id, fs]))
    : null;

  for (const vf of visibleFaces) {
    const { face, screen, nx, ny, nz } = vf;
    const isTopFlat = Math.abs(nx) < 1e-4 && Math.abs(ny) < 1e-4 && nz > 0;
    const isLeftPure = Math.abs(nx) < 1e-4 && ny > 0 && Math.abs(nz) < 1e-4;
    const isRightPure = nx > 0 && Math.abs(ny) < 1e-4 && Math.abs(nz) < 1e-4;

    let flatCol: RGBA;
    if (isTopFlat) flatCol = triad.top;
    else if (isLeftPure) flatCol = triad.left;
    else if (isRightPure) flatCol = triad.right;
    else flatCol = shadeByNormal(shape.baseColor, nx, ny, nz, shape.autoShade, shape.shadeContrast, shape.roofColor);

    const isVerticalSide = Math.abs(nz) < 1e-4;
    const isTiltedShape = hasActiveTilt(shape);
    let minSx = Infinity, maxSx = -Infinity;
    for (const [sx] of screen) {
      if (sx < minSx) minSx = sx;
      if (sx > maxSx) maxSx = sx;
    }
    const spanW = Math.max(1, Math.round(maxSx - minSx));

    // Precompute top edge y(px) for vertical walls so 2:1 sheared facade patterns align cleanly
    let wallMinZ = Infinity, wallMaxZ = -Infinity;
    for (const pt of face.verts) {
      if (pt.z < wallMinZ) wallMinZ = pt.z;
      if (pt.z > wallMaxZ) wallMaxZ = pt.z;
    }
    const wallH = Math.max(1, Math.round(wallMaxZ - wallMinZ));

    // Precompute face screen UV basis (shared by custom faceTextures and tilted procedural patterns)
    let rawUvBasis: {
      ox: number;
      oy: number;
      dux: number;
      duy: number;
      dvx: number;
      dvy: number;
      invDet: number;
      metricW: number;
      metricH: number;
    } | null = null;
    if (face.uvOrigin && face.uvEndU && face.uvEndV) {
      const [ox, oy] = isoToScreenPx(face.uvOrigin.x, face.uvOrigin.y, face.uvOrigin.z, originX, originY);
      const [u1x, u1y] = isoToScreenPx(face.uvEndU.x, face.uvEndU.y, face.uvEndU.z, originX, originY);
      const [v1x, v1y] = isoToScreenPx(face.uvEndV.x, face.uvEndV.y, face.uvEndV.z, originX, originY);
      const dux = u1x - ox;
      const duy = u1y - oy;
      const dvx = v1x - ox;
      const dvy = v1y - oy;
      const det = dux * dvy - duy * dvx;
      if (Math.abs(det) > 1e-4) {
        const uLenMetric = Math.hypot(
          (face.uvEndU.x - face.uvOrigin.x) * METRIC_PX_PER_CELL,
          (face.uvEndU.y - face.uvOrigin.y) * METRIC_PX_PER_CELL,
          face.uvEndU.z - face.uvOrigin.z,
        );
        const vLenMetric = Math.hypot(
          (face.uvEndV.x - face.uvOrigin.x) * METRIC_PX_PER_CELL,
          (face.uvEndV.y - face.uvOrigin.y) * METRIC_PX_PER_CELL,
          face.uvEndV.z - face.uvOrigin.z,
        );
        rawUvBasis = {
          ox,
          oy,
          dux,
          duy,
          dvx,
          dvy,
          invDet: 1 / det,
          metricW: Math.max(4, Math.round((uLenMetric * 16) / METRIC_PX_PER_CELL)),
          metricH: Math.max(4, Math.round(vLenMetric)),
        };
      }
    }

    // Optional per-face custom texture UV affine basis on screen
    const slot = face.faceId && shape.faceTextures ? shape.faceTextures[face.faceId] : undefined;
    const faceSpec = face.faceId && faceSpecMap ? faceSpecMap.get(face.faceId) : undefined;
    const uvBasis = slot && slot.mode !== 'none' && rawUvBasis
      ? {
          ...rawUvBasis,
          faceW: faceSpec?.faceW ?? spanW,
          faceH: faceSpec?.faceH ?? wallH,
          shadeFactor: slot.shadeWithFace !== false
            ? computeFaceTextureShadeFactor(nx, ny, nz, shape.autoShade, shape.shadeContrast)
            : 1,
          slot,
        }
      : null;

    const oddOri = viewOri % 2 === 1;
    const lsuLocal = oddOri ? sv : su;
    const lsvLocal = oddOri ? su : sv;

    const p0v = face.verts[0];
    const p1v = face.verts[1];
    const p2v = face.verts[2];
    const [s0x, s0y] = screen[0];
    const [s1x, s1y] = screen[1];
    const [s2x, s2y] = screen[2];
    const s10x = s1x - s0x;
    const s10y = s1y - s0y;
    const s20x = s2x - s0x;
    const s20y = s2y - s0y;
    const planeDet = s10x * s20y - s10y * s20x;
    const hasPlaneZ = Math.abs(planeDet) > 1e-6;
    const invPlaneDet = hasPlaneZ ? 1 / planeDet : 0;
    const zVert0 = p0v.z;
    const dz10 = p1v.z - zVert0;
    const dz20 = p2v.z - zVert0;
    const sunBit = classifySunFacingMetricNormal(nx, ny, nz);

    fillConvexPolyInt(
      dst,
      w,
      h,
      screen,
      (px, py) => {
        let baseOut = flatCol;
        if (!isTiltedShape) {
          if (isTopFlat && (shape.pattern.type === 'roof_grid' || shape.pattern.applyTop)) {
            const dx = px + 0.5 - originX;
            const dy = (py + 0.5 + wallMaxZ) - originY;
            const pu = dx / 32 + dy / 16;
            const pv = dy / 16 - dx / 32;
            const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
            const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
            const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
            baseOut = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, flatCol, shape.pattern);
          } else if (isVerticalSide && shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid') {
            // Compute local wall coordinates (wx, wy)
            const wx = px - Math.floor(minSx);
            // Find top-most y on this face at column px
            let topYAtPx = Infinity;
            for (let i = 0; i < screen.length; i++) {
              const [ax, ay] = screen[i];
              const [bx, by] = screen[(i + 1) % screen.length];
              const loX = Math.min(ax, bx), hiX = Math.max(ax, bx);
              if (px + 0.5 >= loX - 0.5 && px + 0.5 <= hiX + 0.5 && Math.abs(bx - ax) > 0.1) {
                const t = clamp((px + 0.5 - ax) / (bx - ax), 0, 1);
                const yEdge = ay + (by - ay) * t;
                if (yEdge < topYAtPx) topYAtPx = yEdge;
              }
            }
            const rawWy = Math.max(0, Math.floor(py - topYAtPx));
            const wy = shape.flipZ ? Math.max(0, wallH - 1 - rawWy) : rawWy;
            const faceShade: 'left' | 'right' | 'curve' = isRightPure ? 'right' : isLeftPure ? 'left' : 'curve';
            baseOut = sampleWallPattern(wx, wy, spanW, wallH, shape.pattern, flatCol, faceShade);
          }
        } else if (rawUvBasis && shape.pattern.type !== 'none') {
          const rx = px + 0.5 - rawUvBasis.ox;
          const ry = py + 0.5 - rawUvBasis.oy;
          const uPat = clamp((rx * rawUvBasis.dvy - ry * rawUvBasis.dvx) * rawUvBasis.invDet, 0, 0.9999);
          const vPat = clamp((rawUvBasis.dux * ry - rawUvBasis.duy * rx) * rawUvBasis.invDet, 0, 0.9999);
          const isCapFace = face.faceId === 'top' || face.faceId === 'bottom';
          if (isCapFace && (shape.pattern.type === 'roof_grid' || shape.pattern.applyTop)) {
            baseOut = sampleTopGridColor(uPat, vPat, lsuLocal, lsvLocal, flatCol, shape.pattern);
          } else if (!isCapFace && shape.pattern.type !== 'roof_grid') {
            const wx = Math.floor(uPat * rawUvBasis.metricW);
            const wy = Math.floor(vPat * rawUvBasis.metricH);
            const faceShade: 'left' | 'right' | 'curve' = isRightPure ? 'right' : isLeftPure ? 'left' : 'curve';
            baseOut = sampleWallPattern(wx, wy, rawUvBasis.metricW, rawUvBasis.metricH, shape.pattern, flatCol, faceShade);
          }
        }

        if (uvBasis) {
          const rx = px + 0.5 - uvBasis.ox;
          const ry = py + 0.5 - uvBasis.oy;
          const uTex = (rx * uvBasis.dvy - ry * uvBasis.dvx) * uvBasis.invDet;
          const vTex = (uvBasis.dux * ry - uvBasis.duy * rx) * uvBasis.invDet;
          const texCol = sampleFaceTextureRGBA(uvBasis.slot, uTex, vTex, uvBasis.faceW, uvBasis.faceH);
          if (texCol) {
            return compositeFaceTexelOverBase(baseOut, texCol, uvBasis.shadeFactor);
          }
        }

        return baseOut;
      },
      (px, py) => {
        if (px >= bMinX && px <= bMaxX && py >= bMinY && py <= bMaxY) {
          mask[(py - bMinY) * bw + (px - bMinX)] = 1;
        }
        if (activeRenderAux) {
          const pIdx = py * w + px;
          let zVal = wallMaxZ;
          if (hasPlaneZ) {
            const rx = px + 0.5 - s0x;
            const ry = py + 0.5 - s0y;
            const b1 = (rx * s20y - ry * s20x) * invPlaneDet;
            const b2 = (s10x * ry - s10y * rx) * invPlaneDet;
            zVal = clamp(zVert0 + b1 * dz10 + b2 * dz20, wallMinZ, wallMaxZ);
          }
          activeRenderAux.zData[pIdx] = zVal;
          activeRenderAux.sunFacing[pIdx] = sunBit;
        }
      },
    );
  }

  const isInteriorMaskPixel = (px: number, py: number): boolean => {
    if (px <= 0 || py <= 0 || px >= w - 1 || py >= h - 1) return false;
    const lx = px - bMinX;
    const ly = py - bMinY;
    if (lx <= 0 || ly <= 0 || lx >= bw - 1 || ly >= bh - 1) return false;
    const mi = ly * bw + lx;
    return mask[mi] === 1 && mask[mi - 1] === 1 && mask[mi + 1] === 1 && mask[mi - bw] === 1 && mask[mi + bw] === 1;
  };

  const drawMaskedEdgeLine = (x0: number, y0: number, x1: number, y1: number, col: RGBA) => {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 16384; guard++) {
      if (isInteriorMaskPixel(ix0, iy0)) {
        setPixel(dst, w, h, ix0, iy0, col);
      }
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; ix0 += sx; }
      if (e2 < dx) { err += dx; iy0 += sy; }
    }
  };

  // Edge highlights & outlines: interior creases clipped strictly inside mask; outer silhouette drawn via 4-neighbor inner border
  if (shape.edgeHighlight || shape.outlineMode !== 'none') {
    if (shape.edgeHighlight || shape.outlineMode === 'all_edges') {
      const edgeMap = new Map<string, { a: [number, number]; b: [number, number]; count: number }>();
      const ptKey = (x: number, y: number) => `${Math.round(x * 16)},${Math.round(y * 16)}`;
      for (const vf of visibleFaces) {
        const scr = vf.screen;
        for (let i = 0; i < scr.length; i++) {
          const j = (i + 1) % scr.length;
          const [ax, ay] = scr[i];
          const [bx, by] = scr[j];
          const ka = ptKey(ax, ay);
          const kb = ptKey(bx, by);
          const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          const prev = edgeMap.get(ek);
          if (prev) prev.count += 1;
          else edgeMap.set(ek, { a: [ax, ay], b: [bx, by], count: 1 });
        }
      }

      if (shape.edgeHighlight) {
        for (const e of edgeMap.values()) {
          if (e.count >= 2) {
            drawMaskedEdgeLine(e.a[0], e.a[1], e.b[0], e.b[1], triad.highlight);
          }
        }
      } else if (shape.outlineMode === 'all_edges') {
        for (const e of edgeMap.values()) {
          if (e.count >= 2) {
            drawMaskedEdgeLine(e.a[0], e.a[1], e.b[0], e.b[1], triad.outline);
          }
        }
      }
    }

    if (shape.outlineMode === 'outer' || shape.outlineMode === 'all_edges') {
      for (let ly = 0; ly < bh; ly++) {
        const py = bMinY + ly;
        for (let lx = 0; lx < bw; lx++) {
          const px = bMinX + lx;
          if (!mask[ly * bw + lx]) continue;
          if (!isInteriorMaskPixel(px, py)) {
            setPixel(dst, w, h, px, py, triad.outline);
          }
        }
      }
    }
  }
}

// ---------------- Individual Geometry Builders ----------------

function flipVec3Z(pt: Vec3, zSum: number): Vec3 {
  return { x: pt.x, y: pt.y, z: zSum - pt.z };
}

function flipMeshFacesZ(
  faces: MeshFace[],
  z0: number,
  z1: number,
  topCap?: MeshFace,
): MeshFace[] {
  const zSum = z0 + z1;
  const out: MeshFace[] = faces.map((f) => ({
    ...f,
    verts: [...f.verts].reverse().map((pt) => flipVec3Z(pt, zSum)),
    uvOrigin: f.uvOrigin ? flipVec3Z(f.uvOrigin, zSum) : undefined,
    uvEndU: f.uvEndU ? flipVec3Z(f.uvEndU, zSum) : undefined,
    uvEndV: f.uvEndV ? flipVec3Z(f.uvEndV, zSum) : undefined,
  }));
  if (topCap) out.push(topCap);
  return out;
}

export function buildBoxFaces(
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  ori: ViewRotation,
  flipZ = false,
  includeBottom = false,
): MeshFace[] {
  const P = (lu: number, lv: number, z: number) => transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);
  const p000 = P(0, 0, z0);
  const p100 = P(1, 0, z0);
  const p110 = P(1, 1, z0);
  const p010 = P(0, 1, z0);
  const p001 = P(0, 0, z1);
  const p101 = P(1, 0, z1);
  const p111 = P(1, 1, z1);
  const p011 = P(0, 1, z1);

  const faces: MeshFace[] = [
    { verts: [p001, p011, p111, p101], kind: 'top', faceId: 'top', uvOrigin: p001, uvEndU: p101, uvEndV: p011 },
    { verts: [p010, p110, p111, p011], kind: 'left', faceId: 'wall_pv', uvOrigin: flipZ ? p010 : p011, uvEndU: flipZ ? p110 : p111, uvEndV: flipZ ? p011 : p010 },
    { verts: [p110, p100, p101, p111], kind: 'right', faceId: 'wall_pu', uvOrigin: flipZ ? p110 : p111, uvEndU: flipZ ? p100 : p101, uvEndV: flipZ ? p111 : p110 },
    { verts: [p100, p000, p001, p101], kind: 'slope', faceId: 'wall_nv', uvOrigin: flipZ ? p100 : p101, uvEndU: flipZ ? p000 : p001, uvEndV: flipZ ? p101 : p100 },
    { verts: [p000, p010, p011, p001], kind: 'slope', faceId: 'wall_nu', uvOrigin: flipZ ? p000 : p001, uvEndU: flipZ ? p010 : p011, uvEndV: flipZ ? p001 : p000 },
  ];
  if (includeBottom) {
    faces.push({
      verts: [p000, p100, p110, p010],
      kind: 'slope',
      faceId: 'bottom',
      uvOrigin: p010,
      uvEndU: p110,
      uvEndV: p000,
    });
  }
  return faces;
}

export function buildRightTriPrismFaces(
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  ori: ViewRotation,
  cut: TriPrismCut = 'vertical',
  flipZ = false,
  includeBottom = false,
): MeshFace[] {
  if (cut === 'slope') {
    return buildWedgeFaces(u0, v0, su, sv, z0, z1, ori, 'ramp', flipZ, includeBottom);
  }
  const P = (lu: number, lv: number, z: number) => transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);
  // Vertical half-box right triangular prism: right angle at local (0, 0), hypotenuse (0, 1)-(1, 0)
  const B0 = P(0, 0, z0);
  const B1 = P(0, 1, z0);
  const B2 = P(1, 0, z0);
  const T0 = P(0, 0, z1);
  const T1 = P(0, 1, z1);
  const T2 = P(1, 0, z1);

  const faces: MeshFace[] = [
    { verts: [T0, T1, T2], kind: 'top', faceId: 'top', uvOrigin: T0, uvEndU: T2, uvEndV: T1 },
    { verts: [B1, B2, T2, T1], kind: 'slope', faceId: 'wall_hyp', uvOrigin: flipZ ? B1 : T1, uvEndU: flipZ ? B2 : T2, uvEndV: flipZ ? T1 : B1 },
    { verts: [B0, B1, T1, T0], kind: 'left', faceId: 'wall_nu', uvOrigin: flipZ ? B0 : T0, uvEndU: flipZ ? B1 : T1, uvEndV: flipZ ? T0 : B0 },
    { verts: [B2, B0, T0, T2], kind: 'right', faceId: 'wall_nv', uvOrigin: flipZ ? B2 : T2, uvEndU: flipZ ? B0 : T0, uvEndV: flipZ ? T2 : B2 },
  ];
  if (includeBottom) {
    faces.push({
      verts: [B0, B2, B1],
      kind: 'slope',
      faceId: 'bottom',
      uvOrigin: B0,
      uvEndU: B2,
      uvEndV: B1,
    });
  }
  return faces;
}

export function buildPrismFaces(
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  sides: number,
  ori: ViewRotation,
  flipZ = false,
  includeBottom = false,
): MeshFace[] {
  const n = Math.max(3, Math.min(12, Math.round(sides)));
  const P = (lu: number, lv: number, z: number) => transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);
  const startAngle = Math.PI / n;
  const bot: Vec3[] = [];
  const top: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    // Wind clockwise in (lu, lv) so viewed from +Z it is CCW on screen
    const ang = startAngle - (i * Math.PI * 2) / n;
    const lu = 0.5 + Math.cos(ang) * 0.5;
    const lv = 0.5 + Math.sin(ang) * 0.5;
    bot.push(P(lu, lv, z0));
    top.push(P(lu, lv, z1));
  }
  const faces: MeshFace[] = [
    {
      verts: [...top],
      kind: 'top',
      faceId: 'top',
      uvOrigin: P(0, 0, z1),
      uvEndU: P(1, 0, z1),
      uvEndV: P(0, 1, z1),
    },
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({
      verts: [bot[i], bot[j], top[j], top[i]],
      kind: 'slope',
      faceId: `side_${i}`,
      uvOrigin: flipZ ? bot[i] : top[i],
      uvEndU: flipZ ? bot[j] : top[j],
      uvEndV: flipZ ? top[i] : bot[i],
    });
  }
  if (includeBottom) {
    faces.push({
      verts: [...bot].reverse(),
      kind: 'slope',
      faceId: 'bottom',
      uvOrigin: P(0, 1, z0),
      uvEndU: P(1, 1, z0),
      uvEndV: P(0, 0, z0),
    });
  }
  return faces;
}

export function buildWedgeFaces(
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  ori: ViewRotation,
  mode: 'ramp' | 'gable',
  flipZ = false,
  includeBottom = false,
): MeshFace[] {
  const P = (lu: number, lv: number, z: number) => transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);
  const topCap: MeshFace = {
    verts: [P(0, 0, z1), P(0, 1, z1), P(1, 1, z1), P(1, 0, z1)],
    kind: 'top',
    faceId: 'top',
    uvOrigin: P(0, 0, z1),
    uvEndU: P(1, 0, z1),
    uvEndV: P(0, 1, z1),
  };
  if (mode === 'ramp') {
    // Low edge at lu=0 (z0), high edge at lu=1 (z1)
    const A = P(0, 0, z0);
    const B = P(0, 1, z0);
    const C = P(1, 1, z0);
    const D = P(1, 0, z0);
    const E = P(1, 1, z1);
    const F = P(1, 0, z1);
    const faces: MeshFace[] = [
      { verts: [A, B, E, F], kind: 'slope', faceId: 'slope_main', uvOrigin: F, uvEndU: E, uvEndV: A },
      { verts: [C, D, F, E], kind: 'right', faceId: 'wall_back', uvOrigin: E, uvEndU: F, uvEndV: C },
      { verts: [B, C, E], kind: 'left', faceId: 'tri_pv', uvOrigin: P(0, 1, z1), uvEndU: E, uvEndV: B },
      { verts: [D, A, F], kind: 'slope', faceId: 'tri_nv', uvOrigin: F, uvEndU: P(0, 0, z1), uvEndV: D },
    ];
    if (flipZ) return flipMeshFacesZ(faces, z0, z1, topCap);
    if (includeBottom) {
      faces.push({ verts: [A, D, C, B], kind: 'slope', faceId: 'bottom', uvOrigin: B, uvEndU: C, uvEndV: A });
    }
    return faces;
  } else {
    // Gable roof: ridge along lu = 0..1 at lv = 0.5, height z1
    const A = P(0, 0, z0);
    const B = P(0, 1, z0);
    const C = P(1, 1, z0);
    const D = P(1, 0, z0);
    const R0 = P(0, 0.5, z1);
    const R1 = P(1, 0.5, z1);
    const faces: MeshFace[] = [
      { verts: [B, C, R1, R0], kind: 'slope', faceId: 'slope_pv', uvOrigin: R0, uvEndU: R1, uvEndV: B },
      { verts: [D, A, R0, R1], kind: 'slope', faceId: 'slope_nv', uvOrigin: R1, uvEndU: R0, uvEndV: D },
      { verts: [A, B, R0], kind: 'slope', faceId: 'gable_nu', uvOrigin: P(0, 0, z1), uvEndU: P(0, 1, z1), uvEndV: A },
      { verts: [C, D, R1], kind: 'slope', faceId: 'gable_pu', uvOrigin: P(1, 1, z1), uvEndU: P(1, 0, z1), uvEndV: C },
    ];
    if (flipZ) return flipMeshFacesZ(faces, z0, z1, topCap);
    if (includeBottom) {
      faces.push({ verts: [A, D, C, B], kind: 'slope', faceId: 'bottom', uvOrigin: B, uvEndU: C, uvEndV: A });
    }
    return faces;
  }
}

export function buildPyramidFaces(
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  ori: ViewRotation,
  flipZ = false,
  includeBottom = false,
): MeshFace[] {
  const P = (lu: number, lv: number, z: number) => transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);
  const A = P(0, 0, z0);
  const B = P(0, 1, z0);
  const C = P(1, 1, z0);
  const D = P(1, 0, z0);
  const apex = P(0.5, 0.5, z1);
  const makeTriUv = (bl: Vec3, br: Vec3): { uvOrigin: Vec3; uvEndU: Vec3; uvEndV: Vec3 } => {
    const dux = br.x - bl.x, duy = br.y - bl.y, duz = br.z - bl.z;
    const uvOrigin: Vec3 = { x: apex.x - dux * 0.5, y: apex.y - duy * 0.5, z: apex.z - duz * 0.5 };
    const uvEndU: Vec3 = { x: uvOrigin.x + dux, y: uvOrigin.y + duy, z: uvOrigin.z + duz };
    const uvEndV: Vec3 = {
      x: uvOrigin.x + ((bl.x + br.x) * 0.5 - apex.x),
      y: uvOrigin.y + ((bl.y + br.y) * 0.5 - apex.y),
      z: uvOrigin.z + ((bl.z + br.z) * 0.5 - apex.z),
    };
    return { uvOrigin, uvEndU, uvEndV };
  };
  const faces: MeshFace[] = [
    { verts: [B, C, apex], kind: 'left', faceId: 'pyr_pv', ...makeTriUv(B, C) },
    { verts: [C, D, apex], kind: 'right', faceId: 'pyr_pu', ...makeTriUv(C, D) },
    { verts: [D, A, apex], kind: 'slope', faceId: 'pyr_nv', ...makeTriUv(D, A) },
    { verts: [A, B, apex], kind: 'slope', faceId: 'pyr_nu', ...makeTriUv(A, B) },
  ];
  if (!flipZ) {
    if (includeBottom) {
      faces.push({ verts: [A, D, C, B], kind: 'slope', faceId: 'bottom', uvOrigin: B, uvEndU: C, uvEndV: A });
    }
    return faces;
  }
  const topCap: MeshFace = {
    verts: [P(0, 0, z1), P(0, 1, z1), P(1, 1, z1), P(1, 0, z1)],
    kind: 'top',
    faceId: 'top',
    uvOrigin: P(0, 0, z1),
    uvEndU: P(1, 0, z1),
    uvEndV: P(0, 1, z1),
  };
  return flipMeshFacesZ(faces, z0, z1, topCap);
}

function renderCylinder(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const cu = u0 + su * 0.5;
  const cv = v0 + sv * 0.5;
  const ru = Math.max(1e-4, su * 0.5);
  const rv = Math.max(1e-4, sv * 0.5);
  const [cx, cyBase] = isoToScreenPx(cu, cv, 0, originX, originY);
  const cylR = Math.hypot(ru, rv);

  const rawMinPx = Math.floor(cx - 16 * cylR - 1);
  const rawMaxPx = Math.ceil(cx + 16 * cylR + 1);
  const minPx = Math.max(0, rawMinPx);
  const maxPx = Math.min(w - 1, rawMaxPx);
  if (maxPx < minPx) return;
  const spanW = maxPx - minPx + 1;

  const invRu2 = 1 / (ru * ru);
  const invRv2 = 1 / (rv * rv);
  const aQ = invRu2 + invRv2;
  const invAq = 1 / aQ;
  const diffInv = invRu2 - invRv2;
  const prod4 = 4 * invRu2 * invRv2;

  // Analytically evaluate exact top-ellipse [yMin, yMax] & bottom-ellipse yMax at pixel center (px + 0.5)
  const colTopMin = new Float64Array(spanW).fill(Infinity);
  const colTopMax = new Float64Array(spanW).fill(-Infinity);
  const colBotMax = new Float64Array(spanW).fill(-Infinity);
  const colNx = new Float64Array(spanW);
  const colNy = new Float64Array(spanW);

  let rawMinPy = Infinity;
  let rawMaxPy = -Infinity;

  for (let px = minPx; px <= maxPx; px++) {
    const cxIdx = px - minPx;
    const A = (px + 0.5 - cx) / 32;
    const disc = aQ - prod4 * A * A;
    if (disc < -1e-9) continue;
    const bMid = -(A * diffInv) * invAq;
    const bHalf = Math.sqrt(Math.max(0, disc)) * invAq;
    const bTop = bMid - bHalf;
    const bBot = bMid + bHalf;
    const topYMin = cyBase - z1 + 16 * bTop;
    const topYMax = cyBase - z1 + 16 * bBot;
    const botYMax = cyBase - z0 + 16 * bBot;
    colTopMin[cxIdx] = topYMin;
    colTopMax[cxIdx] = topYMax;
    colBotMax[cxIdx] = botYMax;

    // Exact outward front-ellipse normal at (du = A + bBot, dv = bBot - A)
    const du = A + bBot;
    const dv = bBot - A;
    const rnx = du * invRu2;
    const rny = dv * invRv2;
    const nLen = Math.hypot(rnx, rny) || 1;
    colNx[cxIdx] = rnx / nLen;
    colNy[cxIdx] = rny / nLen;

    const yt0 = Math.ceil(topYMin - 0.5);
    const yb1 = Math.floor(botYMax - 0.5);
    if (yt0 <= yb1) {
      if (yt0 < rawMinPy) rawMinPy = yt0;
      if (yb1 > rawMaxPy) rawMaxPy = yb1;
    }
  }

  const minPy = Math.max(0, rawMinPy);
  const maxPy = Math.min(h - 1, rawMaxPy);
  if (maxPy < minPy) return;
  const spanH = maxPy - minPy + 1;
  const wallH = Math.max(1, Math.round(z1 - z0));
  const localMask = new Uint8Array(spanW * spanH);

  // Fill body and top cap
  for (let px = minPx; px <= maxPx; px++) {
    const cxIdx = px - minPx;
    if (!Number.isFinite(colBotMax[cxIdx])) continue;
    const yt0 = Math.ceil(colTopMin[cxIdx] - 0.5);
    const yt1 = Math.floor(colTopMax[cxIdx] - 0.5);
    const yb1 = Math.floor(colBotMax[cxIdx] - 0.5);

    const nx = colNx[cxIdx];
    const ny = colNy[cxIdx];
    const bodyCol = shape.autoShade
      ? shadeByNormal(shape.baseColor, nx, ny, 0.15, true, shape.shadeContrast)
      : shape.baseColor;
    const sideSunBit = classifySunFacingMetricNormal(nx, ny, 0);
    const topRimSy = colTopMax[cxIdx];

    // Cylinder side body
    for (let py = Math.max(minPy, yt1 + 1); py <= Math.min(maxPy, yb1); py++) {
      const rawWy = py - (yt1 + 1);
      const wy = shape.flipZ ? Math.max(0, wallH - 1 - rawWy) : rawWy;
      const col = shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid'
        ? sampleWallPattern(cxIdx, wy, spanW, wallH, shape.pattern, bodyCol, 'curve')
        : bodyCol;
      setPixel(dst, w, h, px, py, col);
      localMask[(py - minPy) * spanW + cxIdx] = 1;
      if (activeRenderAux) {
        const pIdx = py * w + px;
        activeRenderAux.zData[pIdx] = clamp(z1 - (py + 0.5 - topRimSy), z0, z1);
        activeRenderAux.sunFacing[pIdx] = sideSunBit;
      }
    }

    // Top ellipse cap
    for (let py = Math.max(minPy, yt0); py <= Math.min(maxPy, yt1); py++) {
      let col = triad.top;
      if (shape.pattern.type === 'roof_grid' || shape.pattern.applyTop) {
        const dx = px + 0.5 - originX;
        const dy = (py + 0.5 + z1) - originY;
        const pu = dx / 32 + dy / 16;
        const pv = dy / 16 - dx / 32;
        const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
        const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
        const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
        col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, triad.top, shape.pattern);
      }
      setPixel(dst, w, h, px, py, col);
      localMask[(py - minPy) * spanW + cxIdx] = 1;
      if (activeRenderAux) {
        const pIdx = py * w + px;
        activeRenderAux.zData[pIdx] = z1;
        activeRenderAux.sunFacing[pIdx] = 2;
      }
    }

    // Front rim highlight on top ellipse
    if (shape.edgeHighlight && yt0 <= yt1 && yt1 >= minPy && yt1 <= maxPy) {
      setPixel(dst, w, h, px, yt1, triad.highlight);
    }
  }

  // Optional 1px inner perimeter outline
  if (shape.outlineMode !== 'none') {
    for (let ly = 0; ly < spanH; ly++) {
      const py = minPy + ly;
      for (let lx = 0; lx < spanW; lx++) {
        const idx = ly * spanW + lx;
        if (!localMask[idx]) continue;
        const px = minPx + lx;
        const border =
          (lx === 0 && rawMinPx >= 0) ||
          (ly === 0 && rawMinPy >= 0) ||
          (lx === spanW - 1 && rawMaxPx <= w - 1) ||
          (ly === spanH - 1 && rawMaxPy <= h - 1) ||
          (lx > 0 && !localMask[idx - 1]) ||
          (lx < spanW - 1 && !localMask[idx + 1]) ||
          (ly > 0 && !localMask[idx - spanW]) ||
          (ly < spanH - 1 && !localMask[idx + spanW]);
        if (border) setPixel(dst, w, h, px, py, triad.outline);
      }
    }
  }
}

function renderCone(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const cu = u0 + su * 0.5;
  const cv = v0 + sv * 0.5;
  const ru = Math.max(1e-4, su * 0.5);
  const rv = Math.max(1e-4, sv * 0.5);
  const coneH = Math.max(1, z1 - z0);
  const flipZ = Boolean(shape.flipZ);
  const [apexSx, apexSy] = isoToScreenPx(cu, cv, flipZ ? z0 : z1, originX, originY);
  const [baseCx, baseCy] = isoToScreenPx(cu, cv, flipZ ? z1 : z0, originX, originY);

  const rxScreen = 16 * Math.hypot(ru, rv);
  const ryScreen = 8 * Math.hypot(ru, rv);
  const minX = clamp(Math.floor(Math.min(apexSx, baseCx - rxScreen)) - 2, -1, w);
  const maxX = clamp(Math.ceil(Math.max(apexSx, baseCx + rxScreen)) + 2, -1, w);
  const minY = clamp(Math.floor(Math.min(apexSy, baseCy - ryScreen)) - 2, -1, h);
  const maxY = clamp(Math.ceil(Math.max(apexSy, baseCy + ryScreen)) + 2, -1, h);
  if (maxX < 0 || minX >= w || maxY < 0 || minY >= h || minX > maxX || minY > maxY) return;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const tmpBuf = new Uint8ClampedArray(bw * bh * 4);
  const capTag = flipZ ? new Uint8Array(bw * bh) : null; // 1 = body, 2 = flat top cap
  const tmpZ = activeRenderAux ? new Float32Array(bw * bh) : null;
  const tmpSun = activeRenderAux ? new Uint8Array(bw * bh) : null;

  const inv4Ru2 = 1 / (4 * ru * ru);
  const inv4Rv2 = 1 / (4 * rv * rv);
  const invH2 = 1 / (coneH * coneH);
  const A = inv4Ru2 + inv4Rv2 - 64 * invH2;
  const invRu2 = 1 / (ru * ru);
  const invRv2 = 1 / (rv * rv);
  const useTopPattern = shape.pattern.type === 'roof_grid' || shape.pattern.applyTop;
  const useWallPattern = shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid';
  const wallH = Math.max(1, Math.round(coneH));

  for (let ly = 0; ly < bh; ly++) {
    const dy = (minY + ly + 0.5) - apexSy;
    let rowWritten = false;
    for (let lx = 0; lx < bw; lx++) {
      const dx = (minX + lx + 0.5) - apexSx;
      const d = dx / 16;

      if (flipZ) {
        // Test flat top ellipse cap at z = z1 first (strictly in front of any cone flank at z <= z1)
        const sTop = (dy + coneH) / 8;
        const uTop = 0.5 * (sTop + d);
        const vTop = 0.5 * (sTop - d);
        if (uTop * uTop * invRu2 + vTop * vTop * invRv2 <= 1 + 1e-6) {
          let col = triad.top;
          if (useTopPattern) {
            const uFrac = clamp((uTop + ru) / Math.max(1e-4, su), 0, 1);
            const vFrac = clamp((vTop + rv) / Math.max(1e-4, sv), 0, 1);
            const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
            col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, triad.top, shape.pattern);
          }
          setPixel(tmpBuf, bw, bh, lx, ly, col);
          const li = ly * bw + lx;
          if (capTag) capTag[li] = 2;
          if (tmpZ && tmpSun) {
            tmpZ[li] = z1;
            tmpSun[li] = 2;
          }
          rowWritten = true;
          continue;
        }
      }

      const B = 2 * d * (inv4Ru2 - inv4Rv2) + 16 * dy * invH2;
      const C = d * d * (inv4Ru2 + inv4Rv2) - dy * dy * invH2;

      let bestS = -Infinity;
      let bestW = 0;
      if (Math.abs(A) < 1e-9) {
        if (Math.abs(B) > 1e-9) {
          const s = -C / B;
          const wVal = flipZ ? 8 * s - dy : dy - 8 * s;
          if (wVal >= -1e-4 && wVal <= coneH + 1e-4) {
            bestS = s;
            bestW = wVal;
          }
        }
      } else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          const inv2A = 1 / (2 * A);
          const s1 = (-B - sq) * inv2A;
          const w1 = flipZ ? 8 * s1 - dy : dy - 8 * s1;
          if (w1 >= -1e-4 && w1 <= coneH + 1e-4 && s1 > bestS) {
            bestS = s1;
            bestW = w1;
          }
          const s2 = (-B + sq) * inv2A;
          const w2 = flipZ ? 8 * s2 - dy : dy - 8 * s2;
          if (w2 >= -1e-4 && w2 <= coneH + 1e-4 && s2 > bestS) {
            bestS = s2;
            bestW = w2;
          }
        }
      }
      if (bestS === -Infinity) continue;

      const wClamped = clamp(bestW, 0, coneH);
      const uTilde = 0.5 * (bestS + d);
      const vTilde = 0.5 * (bestS - d);
      let nx = uTilde * invRu2;
      let ny = vTilde * invRv2;
      let nz = (flipZ ? -18 : 18) * wClamped * invH2;
      if (Math.hypot(nx, ny, nz) < 1e-7) {
        nx = -0.35;
        ny = 0.85;
        nz = ((flipZ ? -18 : 18) * Math.hypot(ru, rv)) / coneH;
      }

      let col = shadeByNormal(
        shape.baseColor,
        nx,
        ny,
        nz,
        shape.autoShade,
        shape.shadeContrast,
        flipZ ? null : shape.roofColor,
      );
      if (!flipZ && useTopPattern) {
        const nLen = Math.hypot(nx, ny, nz) || 1;
        if (nz / nLen > 0.35) {
          const uFrac = clamp((uTilde + ru) / Math.max(1e-4, su), 0, 1);
          const vFrac = clamp((vTilde + rv) / Math.max(1e-4, sv), 0, 1);
          const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
          col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, col, shape.pattern);
        }
      } else if (useWallPattern) {
        const wy = flipZ ? Math.floor(coneH - wClamped) : Math.floor(wClamped);
        col = sampleWallPattern(lx, wy, bw, wallH, shape.pattern, col, 'curve');
      }
      setPixel(tmpBuf, bw, bh, lx, ly, col);
      const li = ly * bw + lx;
      if (capTag) capTag[li] = 1;
      if (tmpZ && tmpSun) {
        tmpZ[li] = clamp(flipZ ? z0 + wClamped : z1 - wClamped, z0, z1);
        tmpSun[li] = classifySunFacingMetricNormal(nx, ny, nz);
      }
      rowWritten = true;
    }

    // Thin-tip watertight guard for steep needle cones near apex
    const pyAbs = minY + ly;
    const inTipSpan = flipZ
      ? pyAbs >= Math.round(baseCy) && pyAbs <= Math.round(apexSy)
      : pyAbs >= Math.round(apexSy) && pyAbs <= Math.round(baseCy);
    if (!rowWritten && inTipSpan) {
      const lxApex = clamp(Math.round(apexSx) - minX, 0, bw - 1);
      const wFallback = clamp(flipZ ? apexSy - (pyAbs + 0.5) : pyAbs + 0.5 - apexSy, 0, coneH);
      const tipNz = (flipZ ? -18 : 18) * wFallback * invH2;
      const tipCol = shadeByNormal(
        shape.baseColor,
        1 / ru,
        1 / rv,
        tipNz,
        shape.autoShade,
        shape.shadeContrast,
        flipZ ? null : shape.roofColor,
      );
      setPixel(tmpBuf, bw, bh, lxApex, ly, tipCol);
      const li = ly * bw + lxApex;
      if (capTag) capTag[li] = 1;
      if (tmpZ && tmpSun) {
        tmpZ[li] = clamp(flipZ ? z0 + wFallback : z1 - wFallback, z0, z1);
        tmpSun[li] = flipZ ? classifySunFacingMetricNormal(1 / ru, 1 / rv, tipNz) : 2;
      }
    }
  }

  if (shape.edgeHighlight) {
    if (flipZ && capTag) {
      for (let ly = 0; ly < bh - 1; ly++) {
        for (let lx = 0; lx < bw; lx++) {
          const idx = ly * bw + lx;
          if (capTag[idx] === 2 && capTag[idx + bw] === 1) {
            setPixel(tmpBuf, bw, bh, lx, ly, triad.highlight);
          }
        }
      }
    } else {
      const [hlX, hlY] = isoToScreenPx(cu - ru * 0.35, cv + rv * 0.85, z0, originX, originY);
      const hlMask = new Uint8Array(bw * bh);
      for (let i = 0; i < bw * bh; i++) {
        if (tmpBuf[i * 4 + 3] > 0) hlMask[i] = 1;
      }
      let ix0 = Math.round(apexSx - minX);
      let iy0 = Math.round(apexSy - minY);
      const ix1 = Math.round(hlX - minX);
      const iy1 = Math.round(hlY - minY);
      const sx0 = ix0;
      const sy0 = iy0;
      const dxLine = Math.abs(ix1 - ix0);
      const dyLine = Math.abs(iy1 - iy0);
      const stepX = ix0 < ix1 ? 1 : -1;
      const stepY = iy0 < iy1 ? 1 : -1;
      let err = dxLine - dyLine;
      for (let guard = 0; guard < 16384; guard++) {
        const isEnd = (ix0 === sx0 && iy0 === sy0) || (ix0 === ix1 && iy0 === iy1);
        if (
          !isEnd &&
          ix0 > 0 &&
          iy0 > 0 &&
          ix0 < bw - 1 &&
          iy0 < bh - 1
        ) {
          const mi = iy0 * bw + ix0;
          if (hlMask[mi] && hlMask[mi - 1] && hlMask[mi + 1] && hlMask[mi - bw] && hlMask[mi + bw]) {
            setPixel(tmpBuf, bw, bh, ix0, iy0, triad.highlight);
          }
        }
        if (ix0 === ix1 && iy0 === iy1) break;
        const e2 = err * 2;
        if (e2 > -dyLine) { err -= dyLine; ix0 += stepX; }
        if (e2 < dxLine) { err += dxLine; iy0 += stepY; }
      }
    }
  }
  if (shape.outlineMode !== 'none') {
    applyInnerSilhouetteOutline(tmpBuf, bw, bh, triad.outline);
  }

  const pyStart = Math.max(0, minY);
  const pyEnd = Math.min(h - 1, maxY);
  const pxStart = Math.max(0, minX);
  const pxEnd = Math.min(w - 1, maxX);
  for (let py = pyStart; py <= pyEnd; py++) {
    const ly = py - minY;
    for (let px = pxStart; px <= pxEnd; px++) {
      const li = ly * bw + (px - minX);
      const si = li * 4;
      if (tmpBuf[si + 3] > 0) {
        const di = (py * w + px) * 4;
        dst[di] = tmpBuf[si];
        dst[di + 1] = tmpBuf[si + 1];
        dst[di + 2] = tmpBuf[si + 2];
        dst[di + 3] = 255;
        if (activeRenderAux && tmpZ && tmpSun) {
          const pIdx = py * w + px;
          activeRenderAux.zData[pIdx] = tmpZ[li];
          activeRenderAux.sunFacing[pIdx] = tmpSun[li];
        }
      }
    }
  }
}

function renderDomeOrSphere(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const cu = u0 + su * 0.5;
  const cv = v0 + sv * 0.5;
  const ru = Math.max(1e-4, su * 0.5);
  const rv = Math.max(1e-4, sv * 0.5);
  const totalH = Math.max(1, z1 - z0);
  const isSphere = shape.shapeType === 'sphere' || shape.domeMode === 'sphere';
  const isFlippedDome = !isSphere && Boolean(shape.flipZ);
  const zCenter = isSphere ? z0 + totalH * 0.5 : isFlippedDome ? z1 : z0;
  const rz = Math.max(0.5, isSphere ? totalH * 0.5 : totalH);

  // Analytical orthographic-isometric ellipsoid raycaster at half-pixel centers (watertight at any scale)
  const rxScreen = 16 * Math.hypot(ru, rv);
  const ryScreenIso = 8 * Math.hypot(ru, rv);
  const ryMax = Math.hypot(ryScreenIso, rz);
  const [centerSx, centerSy] = isoToScreenPx(cu, cv, zCenter, originX, originY);

  const minX = clamp(Math.floor(centerSx - rxScreen) - 1, -1, w);
  const maxX = clamp(Math.ceil(centerSx + rxScreen) + 1, -1, w);
  const minY = clamp(Math.floor(centerSy - (isFlippedDome ? ryScreenIso : ryMax)) - 1, -1, h);
  const maxY = clamp(Math.ceil(centerSy + (isSphere || isFlippedDome ? ryMax : ryScreenIso)) + 1, -1, h);
  if (maxX < 0 || minX >= w || maxY < 0 || minY >= h || minX > maxX || minY > maxY) return;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const tmpBuf = new Uint8ClampedArray(bw * bh * 4);
  const capTag = isFlippedDome ? new Uint8Array(bw * bh) : null;
  const tmpZ = activeRenderAux ? new Float32Array(bw * bh) : null;
  const tmpSun = activeRenderAux ? new Uint8Array(bw * bh) : null;

  const inv4Ru2 = 1 / (4 * ru * ru);
  const inv4Rv2 = 1 / (4 * rv * rv);
  const invRz2 = 1 / (rz * rz);
  const A = inv4Ru2 + inv4Rv2 + 64 * invRz2;
  const inv2A = 1 / (2 * A);
  const invRu2 = 1 / (ru * ru);
  const invRv2 = 1 / (rv * rv);
  const useRoofGrid = shape.pattern.type === 'roof_grid' || shape.pattern.applyTop;

  for (let ly = 0; ly < bh; ly++) {
    const dy = (minY + ly + 0.5) - centerSy;
    for (let lx = 0; lx < bw; lx++) {
      const dx = (minX + lx + 0.5) - centerSx;
      const d = dx / 16;

      if (isFlippedDome) {
        // Test flat top ellipse cap at z = z1 (zTilde = 0) first
        const sCap = dy / 8;
        const uCap = 0.5 * (sCap + d);
        const vCap = 0.5 * (sCap - d);
        if (uCap * uCap * invRu2 + vCap * vCap * invRv2 <= 1 + 1e-6) {
          let col = triad.top;
          if (useRoofGrid) {
            const uFrac = clamp((uCap + ru) / Math.max(1e-4, su), 0, 1);
            const vFrac = clamp((vCap + rv) / Math.max(1e-4, sv), 0, 1);
            const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
            col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, triad.top, shape.pattern);
          }
          setPixel(tmpBuf, bw, bh, lx, ly, col);
          const li = ly * bw + lx;
          if (capTag) capTag[li] = 2;
          if (tmpZ && tmpSun) {
            tmpZ[li] = z1;
            tmpSun[li] = 2;
          }
          continue;
        }
      }

      const B = 2 * d * (inv4Ru2 - inv4Rv2) - 16 * dy * invRz2;
      const C = d * d * (inv4Ru2 + inv4Rv2) + dy * dy * invRz2 - 1;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;

      const sPlus = (-B + Math.sqrt(disc)) * inv2A;
      const zTilde = 8 * sPlus - dy;
      if (!isSphere) {
        if (!isFlippedDome && zTilde < 0) continue;
        if (isFlippedDome && zTilde > 0) continue;
      }

      const uTilde = 0.5 * (sPlus + d);
      const vTilde = 0.5 * (sPlus - d);
      const nx = uTilde * invRu2;
      const ny = vTilde * invRv2;
      const nz = 18 * zTilde * invRz2;
      let col = shadeByNormal(
        shape.baseColor,
        nx,
        ny,
        nz,
        shape.autoShade,
        shape.shadeContrast,
        isFlippedDome ? null : shape.roofColor,
      );
      if (useRoofGrid && !isFlippedDome) {
        const nLen = Math.hypot(nx, ny, nz) || 1;
        if (nz / nLen > 0.45) {
          const uFrac = clamp((uTilde + ru) / Math.max(1e-4, su), 0, 1);
          const vFrac = clamp((vTilde + rv) / Math.max(1e-4, sv), 0, 1);
          const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
          col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, col, shape.pattern);
        }
      }
      setPixel(tmpBuf, bw, bh, lx, ly, col);
      const li = ly * bw + lx;
      if (capTag) capTag[li] = 1;
      if (tmpZ && tmpSun) {
        tmpZ[li] = clamp(zCenter + zTilde, z0, z1);
        tmpSun[li] = classifySunFacingMetricNormal(nx, ny, nz);
      }
    }
  }

  if (isFlippedDome && shape.edgeHighlight && capTag) {
    for (let ly = 0; ly < bh - 1; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        if (capTag[idx] === 2 && capTag[idx + bw] === 1) {
          setPixel(tmpBuf, bw, bh, lx, ly, triad.highlight);
        }
      }
    }
  }

  if (shape.outlineMode !== 'none') {
    applyInnerSilhouetteOutline(tmpBuf, bw, bh, triad.outline);
  }

  const pyStart = Math.max(0, minY);
  const pyEnd = Math.min(h - 1, maxY);
  const pxStart = Math.max(0, minX);
  const pxEnd = Math.min(w - 1, maxX);
  for (let py = pyStart; py <= pyEnd; py++) {
    const ly = py - minY;
    for (let px = pxStart; px <= pxEnd; px++) {
      const li = ly * bw + (px - minX);
      const si = li * 4;
      if (tmpBuf[si + 3] > 0) {
        const di = (py * w + px) * 4;
        dst[di] = tmpBuf[si];
        dst[di + 1] = tmpBuf[si + 1];
        dst[di + 2] = tmpBuf[si + 2];
        dst[di + 3] = 255;
        if (activeRenderAux && tmpZ && tmpSun) {
          const pIdx = py * w + px;
          activeRenderAux.zData[pIdx] = tmpZ[li];
          activeRenderAux.sunFacing[pIdx] = tmpSun[li];
        }
      }
    }
  }
}

function renderTiltedAnalyticalPrimitive(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  kind: 'cylinder' | 'cone' | 'dome' | 'sphere',
  tilt: TiltTransform,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
) {
  const rx = Math.max(0.5, tilt.lsu * METRIC_PX_PER_CELL * 0.5);
  const ry = Math.max(0.5, tilt.lsv * METRIC_PX_PER_CELL * 0.5);
  const totalH = Math.max(1, tilt.z1 - tilt.z0);
  const zBotLoc = tilt.z0 - tilt.czView;
  const zTopLoc = tilt.z1 - tilt.czView;
  const flipZ = Boolean(shape.flipZ);

  let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
  for (const zc of [tilt.z0, tilt.z1]) {
    for (const [lu, lv] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const pt = transformLocalPointWithTilt(lu, lv, zc, tilt);
      const [sx, sy] = isoToScreenPx(pt.x, pt.y, pt.z, originX, originY);
      if (sx < rawMinX) rawMinX = sx;
      if (sy < rawMinY) rawMinY = sy;
      if (sx > rawMaxX) rawMaxX = sx;
      if (sy > rawMaxY) rawMaxY = sy;
    }
  }

  const minX = clamp(Math.floor(rawMinX) - 2, -1, w);
  const maxX = clamp(Math.ceil(rawMaxX) + 2, -1, w);
  const minY = clamp(Math.floor(rawMinY) - 2, -1, h);
  const maxY = clamp(Math.ceil(rawMaxY) + 2, -1, h);
  if (maxX < 0 || minX >= w || maxY < 0 || minY >= h || minX > maxX || minY > maxY) return;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const tmpBuf = new Uint8ClampedArray(bw * bh * 4);
  const capTag = new Uint8Array(bw * bh); // 0 = empty, 1 = curved body, 2 = top/base cap, 3 = second cap
  const tmpZ = activeRenderAux ? new Float32Array(bw * bh) : null;
  const tmpSun = activeRenderAux ? new Uint8Array(bw * bh) : null;

  // Constant orthographic isometric camera direction toward viewer in local metric space: D_loc = M^T * (18, 18, 16)
  const dxL = tilt.m00 * 18 + tilt.m10 * 18 + tilt.m20 * 16;
  const dyL = tilt.m01 * 18 + tilt.m11 * 18 + tilt.m21 * 16;
  const dzL = tilt.m02 * 18 + tilt.m12 * 18 + tilt.m22 * 16;

  const invRx2 = 1 / (rx * rx);
  const invRy2 = 1 / (ry * ry);
  const invH2 = 1 / (totalH * totalH);
  const rzSphere = Math.max(0.5, kind === 'sphere' ? totalH * 0.5 : totalH);
  const invRz2 = 1 / (rzSphere * rzSphere);
  const zSphereCenterLoc = kind === 'sphere'
    ? (zBotLoc + zTopLoc) * 0.5
    : flipZ
      ? zTopLoc
      : zBotLoc;
  const zApexLoc = flipZ ? zBotLoc : zTopLoc;
  const zBaseLoc = flipZ ? zTopLoc : zBotLoc;

  const aCyl = dxL * dxL * invRx2 + dyL * dyL * invRy2;
  const aEllip = aCyl + dzL * dzL * invRz2;
  const aCone = aCyl - dzL * dzL * invH2;

  const useTopPattern = shape.pattern.type === 'roof_grid' || shape.pattern.applyTop;
  const useWallPattern = shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid';
  const wallH = Math.max(1, Math.round(totalH));
  const panelW = Math.max(6, Math.round(Math.PI * ((tilt.lsu + tilt.lsv) * 0.5) * 32 * 0.25));

  const shadeFlatOrNormal = (nxV: number, nyV: number, nzV: number, allowRoofColor: boolean): RGBA => {
    const isTopFlat = Math.abs(nxV) < 1e-4 && Math.abs(nyV) < 1e-4 && nzV > 0;
    const isLeftPure = Math.abs(nxV) < 1e-4 && nyV > 0 && Math.abs(nzV) < 1e-4;
    const isRightPure = nxV > 0 && Math.abs(nyV) < 1e-4 && Math.abs(nzV) < 1e-4;
    if (isTopFlat && allowRoofColor) return triad.top;
    if (isLeftPure) return triad.left;
    if (isRightPure) return triad.right;
    return shadeByNormal(
      shape.baseColor,
      nxV,
      nyV,
      nzV,
      shape.autoShade,
      shape.shadeContrast,
      allowRoofColor ? shape.roofColor : null,
    );
  };

  for (let ly = 0; ly < bh; ly++) {
    const scy = minY + ly + 0.5;
    const dyS = scy + tilt.czOut - originY;
    const dy16 = dyS / 16;
    for (let lx = 0; lx < bw; lx++) {
      const scx = minX + lx + 0.5;
      const dx32 = (scx - originX) / 32;
      const vu0 = dx32 + dy16;
      const vv0 = dy16 - dx32;
      const pxV = (vu0 - tilt.cuView) * METRIC_PX_PER_CELL;
      const pyV = (vv0 - tilt.cvView) * METRIC_PX_PER_CELL;

      const ox = tilt.m00 * pxV + tilt.m10 * pyV;
      const oy = tilt.m01 * pxV + tilt.m11 * pyV;
      const oz = tilt.m02 * pxV + tilt.m12 * pyV;

      let bestT = -Infinity;
      let hitTag = 0;
      let hitNxL = 0, hitNyL = 0, hitNzL = 0;
      let hitQx = 0, hitQy = 0, hitQz = 0;

      if (kind === 'sphere') {
        const ozc = oz - zSphereCenterLoc;
        const B = 2 * (ox * dxL * invRx2 + oy * dyL * invRy2 + ozc * dzL * invRz2);
        const C = ox * ox * invRx2 + oy * oy * invRy2 + ozc * ozc * invRz2 - 1;
        const disc = B * B - 4 * aEllip * C;
        if (disc >= 0) {
          const t = (-B + Math.sqrt(disc)) / (2 * aEllip);
          const qx = ox + t * dxL;
          const qy = oy + t * dyL;
          const qz = oz + t * dzL;
          bestT = t;
          hitTag = 1;
          hitQx = qx; hitQy = qy; hitQz = qz;
          hitNxL = qx * invRx2;
          hitNyL = qy * invRy2;
          hitNzL = (qz - zSphereCenterLoc) * invRz2;
        }
      } else if (kind === 'dome') {
        const ozc = oz - zSphereCenterLoc;
        const B = 2 * (ox * dxL * invRx2 + oy * dyL * invRy2 + ozc * dzL * invRz2);
        const C = ox * ox * invRx2 + oy * oy * invRy2 + ozc * ozc * invRz2 - 1;
        const disc = B * B - 4 * aEllip * C;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          const t2 = (-B + sq) / (2 * aEllip);
          const qz2 = oz + t2 * dzL;
          const valid2 = flipZ ? qz2 <= zSphereCenterLoc + 1e-4 : qz2 >= zSphereCenterLoc - 1e-4;
          if (valid2) {
            bestT = t2;
            hitTag = 1;
            hitQx = ox + t2 * dxL;
            hitQy = oy + t2 * dyL;
            hitQz = qz2;
            hitNxL = hitQx * invRx2;
            hitNyL = hitQy * invRy2;
            hitNzL = (qz2 - zSphereCenterLoc) * invRz2;
          }
        }
        // Flat base/top disk at qz = zSphereCenterLoc
        const diskNzL = flipZ ? 1 : -1;
        if (diskNzL * dzL > 1e-6) {
          const tDisk = (zSphereCenterLoc - oz) / dzL;
          if (tDisk > bestT) {
            const qx = ox + tDisk * dxL;
            const qy = oy + tDisk * dyL;
            if (qx * qx * invRx2 + qy * qy * invRy2 <= 1 + 1e-6) {
              bestT = tDisk;
              hitTag = 2;
              hitQx = qx; hitQy = qy; hitQz = zSphereCenterLoc;
              hitNxL = 0; hitNyL = 0; hitNzL = diskNzL;
            }
          }
        }
      } else if (kind === 'cylinder') {
        if (aCyl > 1e-9) {
          const B = 2 * (ox * dxL * invRx2 + oy * dyL * invRy2);
          const C = ox * ox * invRx2 + oy * oy * invRy2 - 1;
          const disc = B * B - 4 * aCyl * C;
          if (disc >= 0) {
            const t2 = (-B + Math.sqrt(disc)) / (2 * aCyl);
            const qz2 = oz + t2 * dzL;
            if (qz2 >= zBotLoc - 1e-4 && qz2 <= zTopLoc + 1e-4) {
              bestT = t2;
              hitTag = 1;
              hitQx = ox + t2 * dxL;
              hitQy = oy + t2 * dyL;
              hitQz = qz2;
              hitNxL = hitQx * invRx2;
              hitNyL = hitQy * invRy2;
              hitNzL = 0;
            }
          }
        }
        if (dzL > 1e-6) {
          const tTop = (zTopLoc - oz) / dzL;
          if (tTop > bestT) {
            const qx = ox + tTop * dxL;
            const qy = oy + tTop * dyL;
            if (qx * qx * invRx2 + qy * qy * invRy2 <= 1 + 1e-6) {
              bestT = tTop;
              hitTag = 2;
              hitQx = qx; hitQy = qy; hitQz = zTopLoc;
              hitNxL = 0; hitNyL = 0; hitNzL = 1;
            }
          }
        } else if (dzL < -1e-6) {
          const tBot = (zBotLoc - oz) / dzL;
          if (tBot > bestT) {
            const qx = ox + tBot * dxL;
            const qy = oy + tBot * dyL;
            if (qx * qx * invRx2 + qy * qy * invRy2 <= 1 + 1e-6) {
              bestT = tBot;
              hitTag = 3;
              hitQx = qx; hitQy = qy; hitQz = zBotLoc;
              hitNxL = 0; hitNyL = 0; hitNzL = -1;
            }
          }
        }
      } else {
        // cone
        const ozA = oz - zApexLoc;
        const B = 2 * (ox * dxL * invRx2 + oy * dyL * invRy2 - ozA * dzL * invH2);
        const C = ox * ox * invRx2 + oy * oy * invRy2 - ozA * ozA * invH2;
        const testConeRoot = (t: number) => {
          if (t <= bestT) return;
          const qz = oz + t * dzL;
          if (qz < zBotLoc - 1e-4 || qz > zTopLoc + 1e-4) return;
          const qx = ox + t * dxL;
          const qy = oy + t * dyL;
          let nlx = qx * invRx2;
          let nly = qy * invRy2;
          let nlz = -(qz - zApexLoc) * invH2;
          if (Math.hypot(nlx, nly, nlz) < 1e-7) {
            nlx = 1 / rx;
            nly = 1 / ry;
            nlz = (flipZ ? -1 : 1) / totalH;
          }
          if (nlx * dxL + nly * dyL + nlz * dzL < -1e-4) return;
          bestT = t;
          hitTag = 1;
          hitQx = qx; hitQy = qy; hitQz = qz;
          hitNxL = nlx; hitNyL = nly; hitNzL = nlz;
        };
        if (Math.abs(aCone) < 1e-9) {
          if (Math.abs(B) > 1e-9) testConeRoot(-C / B);
        } else {
          const disc = B * B - 4 * aCone * C;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            const inv2A = 1 / (2 * aCone);
            testConeRoot((-B - sq) * inv2A);
            testConeRoot((-B + sq) * inv2A);
          }
        }
        const diskNzL = flipZ ? 1 : -1;
        if (diskNzL * dzL > 1e-6) {
          const tDisk = (zBaseLoc - oz) / dzL;
          if (tDisk > bestT) {
            const qx = ox + tDisk * dxL;
            const qy = oy + tDisk * dyL;
            if (qx * qx * invRx2 + qy * qy * invRy2 <= 1 + 1e-6) {
              bestT = tDisk;
              hitTag = 2;
              hitQx = qx; hitQy = qy; hitQz = zBaseLoc;
              hitNxL = 0; hitNyL = 0; hitNzL = diskNzL;
            }
          }
        }
      }

      if (hitTag === 0) continue;

      const nxV = tilt.m00 * hitNxL + tilt.m01 * hitNyL + tilt.m02 * hitNzL;
      const nyV = tilt.m10 * hitNxL + tilt.m11 * hitNyL + tilt.m12 * hitNzL;
      const nzV = tilt.m20 * hitNxL + tilt.m21 * hitNyL + tilt.m22 * hitNzL;
      const nLen = Math.hypot(nxV, nyV, nzV) || 1;

      const allowRoofColor =
        hitTag >= 2 ||
        kind === 'sphere' ||
        (kind === 'dome' && !flipZ) ||
        (kind === 'cone' && !flipZ) ||
        nzV / nLen > 0.7;

      let col = hitTag >= 2
        ? shadeFlatOrNormal(nxV, nyV, nzV, allowRoofColor)
        : shadeByNormal(
            shape.baseColor,
            nxV,
            nyV,
            nzV,
            shape.autoShade,
            shape.shadeContrast,
            allowRoofColor ? shape.roofColor : null,
          );

      if (useTopPattern && (hitTag >= 2 || ((kind === 'sphere' || kind === 'dome' || kind === 'cone') && nzV / nLen > 0.45))) {
        const luFrac = clamp(hitQx / (2 * rx) + 0.5, 0, 1);
        const lvFrac = clamp(hitQy / (2 * ry) + 0.5, 0, 1);
        col = sampleTopGridColor(luFrac, lvFrac, tilt.lsu, tilt.lsv, col, shape.pattern);
      } else if (useWallPattern && hitTag === 1 && (kind === 'cylinder' || kind === 'cone')) {
        const ang = Math.atan2(hitQy / ry, hitQx / rx);
        const uWrap = (ang / (Math.PI * 2) + 1) % 1;
        const uPanel = uWrap * 4 - Math.floor(uWrap * 4);
        const wx = Math.floor(uPanel * panelW);
        const vNorm = clamp((hitQz - zBotLoc) / totalH, 0, 1);
        const wy = Math.floor((flipZ ? vNorm : 1 - vNorm) * wallH);
        col = sampleWallPattern(wx, wy, panelW, wallH, shape.pattern, col, 'curve');
      }

      const li = ly * bw + lx;
      const di = li * 4;
      tmpBuf[di] = col.r;
      tmpBuf[di + 1] = col.g;
      tmpBuf[di + 2] = col.b;
      tmpBuf[di + 3] = 255;
      capTag[li] = hitTag;
      if (tmpZ && tmpSun) {
        tmpZ[li] = tilt.czOut + 16 * bestT;
        tmpSun[li] = classifySunFacingMetricNormal(nxV, nyV, nzV);
      }
    }
  }

  // Rim highlight between flat cap disk and curved flank
  if (shape.edgeHighlight && kind !== 'sphere') {
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        if (capTag[idx] < 2) continue;
        const nearCurved =
          (ly + 1 < bh && capTag[idx + bw] === 1) ||
          (ly > 0 && capTag[idx - bw] === 1) ||
          (lx + 1 < bw && capTag[idx + 1] === 1) ||
          (lx > 0 && capTag[idx - 1] === 1);
        if (nearCurved) {
          setPixel(tmpBuf, bw, bh, lx, ly, triad.highlight);
        }
      }
    }
  }

  if (shape.outlineMode !== 'none') {
    if (shape.outlineMode === 'all_edges' && kind !== 'sphere') {
      for (let ly = 0; ly < bh; ly++) {
        for (let lx = 0; lx < bw; lx++) {
          const idx = ly * bw + lx;
          if (capTag[idx] < 2) continue;
          const nearCurved =
            (ly + 1 < bh && capTag[idx + bw] === 1) ||
            (ly > 0 && capTag[idx - bw] === 1) ||
            (lx + 1 < bw && capTag[idx + 1] === 1) ||
            (lx > 0 && capTag[idx - 1] === 1);
          if (nearCurved) {
            setPixel(tmpBuf, bw, bh, lx, ly, triad.outline);
          }
        }
      }
    }
    applyInnerSilhouetteOutline(tmpBuf, bw, bh, triad.outline);
  }

  const pyStart = Math.max(0, minY);
  const pyEnd = Math.min(h - 1, maxY);
  const pxStart = Math.max(0, minX);
  const pxEnd = Math.min(w - 1, maxX);
  for (let py = pyStart; py <= pyEnd; py++) {
    const ly = py - minY;
    for (let px = pxStart; px <= pxEnd; px++) {
      const li = ly * bw + (px - minX);
      const si = li * 4;
      if (tmpBuf[si + 3] > 0) {
        const di = (py * w + px) * 4;
        dst[di] = tmpBuf[si];
        dst[di + 1] = tmpBuf[si + 1];
        dst[di + 2] = tmpBuf[si + 2];
        dst[di + 3] = 255;
        if (activeRenderAux && tmpZ && tmpSun) {
          const pIdx = py * w + px;
          activeRenderAux.zData[pIdx] = tmpZ[li];
          activeRenderAux.sunFacing[pIdx] = tmpSun[li];
        }
      }
    }
  }
}

const CREASE_COS = 0.80; // ~37deg crease angle threshold preserves hard polygonal edges

type Norm3 = [number, number, number];

function normalizeVec3(nx: number, ny: number, nz: number): Norm3 {
  const len = Math.hypot(nx, ny, nz);
  return len > 1e-8 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
}

function triNormalMetric(A: Vec3, B: Vec3, C: Vec3, negate: boolean): Norm3 {
  const e1x = (B.x - A.x) * 18, e1y = (B.y - A.y) * 18, e1z = B.z - A.z;
  const e2x = (C.x - A.x) * 18, e2y = (C.y - A.y) * 18, e2z = C.z - A.z;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  return negate ? [-nx, -ny, -nz] : [nx, ny, nz];
}

function computeRingGridCornerNormals(
  ringsV: Vec3[][],
  negateCross: boolean,
  inward: boolean,
  blendHoriz: boolean,
  blendVert: boolean,
): Float32Array {
  const quadRows = ringsV.length - 1;
  const vertCount = ringsV[0]?.length ?? 0;
  const quadCount = quadRows * vertCount;
  // Flat per-quad normals [nx, ny, nz]; degenerate quads remain (0, 0, 0) so they never pollute blends
  const qNorms = new Float32Array(quadCount * 3);
  const sign = negateCross ? -1 : 1;

  for (let r = 0; r < quadRows; r++) {
    const vBot = ringsV[r];
    const vTop = ringsV[r + 1];
    const rowBase = r * vertCount;
    for (let j = 0; j < vertCount; j++) {
      const jn = j + 1 < vertCount ? j + 1 : 0;
      const p00 = inward ? vBot[jn] : vBot[j];
      const p10 = inward ? vBot[j] : vBot[jn];
      const p11 = inward ? vTop[j] : vTop[jn];
      const p01 = inward ? vTop[jn] : vTop[j];
      const e1x = (p10.x - p00.x) * 18, e1y = (p10.y - p00.y) * 18, e1z = p10.z - p00.z;
      const e2x = (p11.x - p00.x) * 18, e2y = (p11.y - p00.y) * 18, e2z = p11.z - p00.z;
      const e3x = (p01.x - p00.x) * 18, e3y = (p01.y - p00.y) * 18, e3z = p01.z - p00.z;
      const nx = sign * ((e1y * e2z - e1z * e2y) + (e2y * e3z - e2z * e3y));
      const ny = sign * ((e1z * e2x - e1x * e2z) + (e2z * e3x - e2x * e3z));
      const nz = sign * ((e1x * e2y - e1y * e2x) + (e2x * e3y - e2y * e3x));
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-8) {
        const inv = 1 / len;
        const off = (rowBase + j) * 3;
        qNorms[off] = nx * inv;
        qNorms[off + 1] = ny * inv;
        qNorms[off + 2] = nz * inv;
      }
    }
  }

  // Flat corner normals per quad: 4 corners ([bot-j, bot-jn, top-jn, top-j]) * 3 floats = 12 floats/quad
  const out = new Float32Array(quadCount * 12);
  for (let r = 0; r < quadRows; r++) {
    const rowBase = r * vertCount;
    for (let j = 0; j < vertCount; j++) {
      const qOff = (rowBase + j) * 3;
      const qx = qNorms[qOff];
      const qy = qNorms[qOff + 1];
      const qz = qNorms[qOff + 2];
      const outBase = (rowBase + j) * 12;

      if ((!blendHoriz && !blendVert) || (qx === 0 && qy === 0 && qz === 0)) {
        for (let c = 0; c < 4; c++) {
          const co = outBase + c * 3;
          out[co] = qx;
          out[co + 1] = qy;
          out[co + 2] = qz;
        }
        continue;
      }

      // Compute 4 corners without any per-corner heap allocations
      for (let c = 0; c < 4; c++) {
        const dr = c >= 2 ? 1 : 0;
        const dj = c === 1 || c === 2 ? 1 : 0;
        const rv = r + dr;
        const jv = j + dj < vertCount ? j + dj : 0;

        let r0 = r, r1 = -1;
        if (blendVert) {
          if (rv > 0 && rv < quadRows) { r0 = rv - 1; r1 = rv; }
          else { r0 = rv === 0 ? 0 : quadRows - 1; }
        }
        let j0 = j, j1 = -1;
        if (blendHoriz) {
          j0 = jv > 0 ? jv - 1 : vertCount - 1;
          j1 = jv;
        }

        let sx = 0, sy = 0, sz = 0;
        // Unrolled up to 2x2 neighbor quads
        for (let ri = 0; ri < 2; ri++) {
          const nr = ri === 0 ? r0 : r1;
          if (nr < 0) continue;
          const nrBase = nr * vertCount;
          for (let ji = 0; ji < 2; ji++) {
            const nj = ji === 0 ? j0 : j1;
            if (nj < 0) continue;
            const co = (nrBase + nj) * 3;
            const cx = qNorms[co], cy = qNorms[co + 1], cz = qNorms[co + 2];
            if (cx === 0 && cy === 0 && cz === 0) continue;
            if (cx * qx + cy * qy + cz * qz >= CREASE_COS) {
              sx += cx;
              sy += cy;
              sz += cz;
            }
          }
        }
        const sl = Math.hypot(sx, sy, sz);
        const dstOff = outBase + c * 3;
        if (sl > 1e-8) {
          const inv = 1 / sl;
          out[dstOff] = sx * inv;
          out[dstOff + 1] = sy * inv;
          out[dstOff + 2] = sz * inv;
        } else {
          out[dstOff] = qx;
          out[dstOff + 1] = qy;
          out[dstOff + 2] = qz;
        }
      }
    }
  }
  return out;
}

function normalsDifferFlat(buf: Float32Array, oA: number, oB: number, oC: number): boolean {
  const ax = buf[oA], ay = buf[oA + 1], az = buf[oA + 2];
  return (
    Math.abs(ax - buf[oB]) + Math.abs(ay - buf[oB + 1]) + Math.abs(az - buf[oB + 2]) > 1e-4 ||
    Math.abs(ax - buf[oC]) + Math.abs(ay - buf[oC + 1]) + Math.abs(az - buf[oC + 2]) > 1e-4
  );
}

function normalsDiffer(a: Norm3, b: Norm3, c: Norm3): boolean {
  return (
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 1e-4 ||
    Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) > 1e-4
  );
}

function renderLoftColumn(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const secs = normalizeLoftSections(shape.loftSections);
  const sampleCount = clamp(Math.round((su + sv) * 36), 80, 256);
  const ringBudget = clamp(Math.ceil((z1 - z0) * 1.0), 24, 320);
  const oddOri = viewOri % 2 === 1;
  const lsu = oddOri ? sv : su;
  const lsv = oddOri ? su : sv;
  const isHollow = Boolean(shape.loftHollow);
  const flipZ = Boolean(shape.flipZ);
  const rawLoft = buildAlignedLoftRings(
    secs,
    sampleCount,
    ringBudget,
    shape.loftInterp ?? 'smooth',
    isHollow,
    lsu,
    lsv,
    shape.loftFloorT ?? 0,
  );
  const rings = flipZ
    ? [...rawLoft.rings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
    : rawLoft.rings;
  const innerRings = rawLoft.innerRings
    ? flipZ
      ? [...rawLoft.innerRings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
      : rawLoft.innerRings
    : undefined;
  const innerFloorRing = flipZ ? undefined : rawLoft.innerFloorRing;
  const hasFlippedSolidTop = flipZ && Boolean(rawLoft.innerFloorRing);
  const tMin = flipZ ? 1 - rawLoft.tMax : rawLoft.tMin;
  const tMax = flipZ ? 1 - rawLoft.tMin : rawLoft.tMax;
  const avgPerimLocal = rawLoft.avgPerimLocal;
  const avgInnerPerimLocal = rawLoft.avgInnerPerimLocal;
  if (rings.length < 2) return;

  const numRings = rings.length;
  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(u0, v0, su, sv, z0, z1, viewOri, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;
  const toViewPt = (lu: number, lv: number, z: number): Vec3 =>
    tilt
      ? transformLocalPointWithTilt(lu, lv, z, tilt)
      : transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, viewOri);

  const ringsView: Vec3[][] = new Array(numRings);
  const ringsScreen: [number, number][][] = new Array(numRings);
  let meshMinX = Infinity, meshMinY = Infinity, meshMaxX = -Infinity, meshMaxY = -Infinity;

  for (let r = 0; r < numRings; r++) {
    const zRing = z0 + rings[r].t * (z1 - z0);
    const pts = rings[r].pts;
    const vArr: Vec3[] = new Array(sampleCount);
    const sArr: [number, number][] = new Array(sampleCount);
    for (let j = 0; j < sampleCount; j++) {
      const pt3 = toViewPt(pts[j][0], pts[j][1], zRing);
      const sc = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
      vArr[j] = pt3;
      sArr[j] = sc;
      if (sc[0] < meshMinX) meshMinX = sc[0];
      if (sc[1] < meshMinY) meshMinY = sc[1];
      if (sc[0] > meshMaxX) meshMaxX = sc[0];
      if (sc[1] > meshMaxY) meshMaxY = sc[1];
    }
    ringsView[r] = vArr;
    ringsScreen[r] = sArr;
  }

  let inRingsView: Vec3[][] | null = null;
  let inRingsScreen: [number, number][][] | null = null;
  if (isHollow && innerRings && innerRings.length >= 2) {
    const nIn = innerRings.length;
    inRingsView = new Array(nIn);
    inRingsScreen = new Array(nIn);
    for (let r = 0; r < nIn; r++) {
      const zRing = z0 + innerRings[r].t * (z1 - z0);
      const pts = innerRings[r].pts;
      const vArr: Vec3[] = new Array(sampleCount);
      const sArr: [number, number][] = new Array(sampleCount);
      for (let j = 0; j < sampleCount; j++) {
        const pt3 = toViewPt(pts[j][0], pts[j][1], zRing);
        const sc = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
        vArr[j] = pt3;
        sArr[j] = sc;
        if (sc[0] < meshMinX) meshMinX = sc[0];
        if (sc[1] < meshMinY) meshMinY = sc[1];
        if (sc[0] > meshMaxX) meshMaxX = sc[0];
        if (sc[1] > meshMaxY) meshMaxY = sc[1];
      }
      inRingsView[r] = vArr;
      inRingsScreen[r] = sArr;
    }
  }

  const bMinX = clamp(Math.floor(meshMinX) - 1, -1, w);
  const bMaxX = clamp(Math.ceil(meshMaxX) + 1, -1, w);
  const bMinY = clamp(Math.floor(meshMinY) - 1, -1, h);
  const bMaxY = clamp(Math.ceil(meshMaxY) + 1, -1, h);
  if (bMaxX < 0 || bMinX >= w || bMaxY < 0 || bMinY >= h || bMinX > bMaxX || bMinY > bMaxY) return;

  const bw = bMaxX - bMinX + 1;
  const bh = bMaxY - bMinY + 1;
  const tmpBuf = new Uint8ClampedArray(bw * bh * 4);
  const zDepth = new Float32Array(bw * bh);
  zDepth.fill(-Infinity);
  const faceTag = new Uint8Array(bw * bh); // 0 = empty, 1 = wall, 2 = top/terrace/floor
  const tmpSun = activeRenderAux ? new Uint8Array(bw * bh) : null;

  const zBotCap = z0 + tMin * (z1 - z0);
  const zTopCap = z0 + tMax * (z1 - z0);
  const wallH = Math.max(1, Math.round(zTopCap - zBotCap));
  const panelW = Math.max(6, Math.round(avgPerimLocal * ((su + sv) * 0.5) * 32 * 0.25));
  const innerPanelW = Math.max(6, Math.round(avgInnerPerimLocal * ((su + sv) * 0.5) * 32 * 0.25));
  const useTopPattern = shape.pattern.type === 'roof_grid' || shape.pattern.applyTop;
  const useWallPattern = shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid';

  const rasterTri = (
    A: Vec3, sA: [number, number], uA: number, vA: number,
    B: Vec3, sB: [number, number], uB: number, vB: number,
    C: Vec3, sC: [number, number], uC: number, vC: number,
    curPanelW: number,
    nBuf: Float32Array | null,
    nOffA: number,
    nOffB: number,
    nOffC: number,
  ) => {
    const [ax, ay] = sA;
    const [bx, by] = sB;
    const [cx, cy] = sC;
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area2 >= -1e-4) return; // Back-facing or degenerate

    const e1x = (B.x - A.x) * 18, e1y = (B.y - A.y) * 18, e1z = B.z - A.z;
    const e2x = (C.x - A.x) * 18, e2y = (C.y - A.y) * 18, e2z = C.z - A.z;
    const nx = -(e1y * e2z - e1z * e2y);
    const ny = -(e1z * e2x - e1x * e2z);
    const nz = -(e1x * e2y - e1y * e2x);
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const useSmooth = Boolean(shape.autoShade && nBuf && normalsDifferFlat(nBuf, nOffA, nOffB, nOffC));
    const isFlatUp = !tilt && nz / nLen > 0.96 && !useSmooth;

    const flatCol = useSmooth
      ? shape.baseColor
      : isFlatUp
        ? triad.top
        : shadeByNormal(shape.baseColor, nx, ny, nz, shape.autoShade, shape.shadeContrast, shape.roofColor);

    const triMinX = Math.max(bMinX, Math.floor(Math.min(ax, bx, cx)));
    const triMaxX = Math.min(bMaxX, Math.ceil(Math.max(ax, bx, cx)));
    const triMinY = Math.max(bMinY, Math.floor(Math.min(ay, by, cy)));
    const triMaxY = Math.min(bMaxY, Math.ceil(Math.max(ay, by, cy)));
    if (triMinX > triMaxX || triMinY > triMaxY) return;

    const invArea = 1 / area2;
    const nAx = useSmooth ? nBuf![nOffA] : 0, nAy = useSmooth ? nBuf![nOffA + 1] : 0, nAz = useSmooth ? nBuf![nOffA + 2] : 0;
    const nBx = useSmooth ? nBuf![nOffB] : 0, nBy = useSmooth ? nBuf![nOffB + 1] : 0, nBz = useSmooth ? nBuf![nOffB + 2] : 0;
    const nCx = useSmooth ? nBuf![nOffC] : 0, nCy = useSmooth ? nBuf![nOffC + 1] : 0, nCz = useSmooth ? nBuf![nOffC + 2] : 0;
    for (let py = triMinY; py <= triMaxY; py++) {
      const scy = py + 0.5;
      const ly = py - bMinY;
      for (let px = triMinX; px <= triMaxX; px++) {
        const scx = px + 0.5;
        const w0 = ((cx - bx) * (scy - by) - (cy - by) * (scx - bx)) * invArea;
        if (w0 < -1e-5) continue;
        const w1 = ((ax - cx) * (scy - cy) - (ay - cy) * (scx - cx)) * invArea;
        if (w1 < -1e-5) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -1e-5) continue;

        const vz = w0 * A.z + w1 * B.z + w2 * C.z;
        const idx = ly * bw + (px - bMinX);
        if (vz < zDepth[idx] - 1e-4) continue;

        let col = flatCol;
        let sunNx = nx;
        let sunNy = ny;
        let sunNz = nz;
        if (!isFlatUp && useSmooth) {
          const pnx = w0 * nAx + w1 * nBx + w2 * nCx;
          const pny = w0 * nAy + w1 * nBy + w2 * nCy;
          const pnz = w0 * nAz + w1 * nBz + w2 * nCz;
          sunNx = pnx;
          sunNy = pny;
          sunNz = pnz;
          col = shadeByNormal(shape.baseColor, pnx, pny, pnz, true, shape.shadeContrast, shape.roofColor);
        }
        if (!isFlatUp && useWallPattern) {
          const sVal = w0 * uA + w1 * uB + w2 * uC;
          const tVal = w0 * vA + w1 * vB + w2 * vC;
          const uPanel = sVal * 4 - Math.floor(sVal * 4);
          const wx = Math.floor(uPanel * curPanelW);
          const tNorm = clamp((tVal - tMin) / Math.max(1e-4, tMax - tMin), 0, 1);
          const wy = Math.floor((1 - tNorm) * wallH);
          col = sampleWallPattern(wx, wy, curPanelW, wallH, shape.pattern, col, 'curve');
        } else if (isFlatUp && useTopPattern) {
          const dx = scx - originX;
          const dy = (scy + vz) - originY;
          const pu = dx / 32 + dy / 16;
          const pv = dy / 16 - dx / 32;
          const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
          const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
          const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
          col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, triad.top, shape.pattern);
        }

        const di = idx * 4;
        tmpBuf[di] = col.r;
        tmpBuf[di + 1] = col.g;
        tmpBuf[di + 2] = col.b;
        tmpBuf[di + 3] = 255;
        zDepth[idx] = vz;
        faceTag[idx] = isFlatUp ? 2 : 1;
        if (tmpSun) tmpSun[idx] = isFlatUp ? 2 : classifySunFacingMetricNormal(sunNx, sunNy, sunNz);
      }
    }
  };

  // 1. Outer lofted wall
  const outerCornerNormals = shape.autoShade
    ? computeRingGridCornerNormals(ringsView, true, false, true, true)
    : null;
  for (let r = 0; r < numRings - 1; r++) {
    const t0 = rings[r].t;
    const t1 = rings[r + 1].t;
    const vBot = ringsView[r];
    const vTop = ringsView[r + 1];
    const sBot = ringsScreen[r];
    const sTop = ringsScreen[r + 1];
    const rowOff = r * sampleCount;
    for (let j = 0; j < sampleCount; j++) {
      const jn = (j + 1) % sampleCount;
      const s0 = j / sampleCount;
      const s1 = (j + 1) / sampleCount; // Keep unwrapped across closing edge
      const cnOff = (rowOff + j) * 12;
      rasterTri(
        vBot[j], sBot[j], s0, t0,
        vBot[jn], sBot[jn], s1, t0,
        vTop[jn], sTop[jn], s1, t1,
        panelW,
        outerCornerNormals,
        cnOff, cnOff + 3, cnOff + 6,
      );
      rasterTri(
        vBot[j], sBot[j], s0, t0,
        vTop[jn], sTop[jn], s1, t1,
        vTop[j], sTop[j], s0, t1,
        panelW,
        outerCornerNormals,
        cnOff, cnOff + 6, cnOff + 9,
      );
    }
  }

  // 2. Inner hollow shaft wall (wound opposite so inward-facing shaft walls face camera)
  if (inRingsView && inRingsScreen && innerRings) {
    const innerCornerNormals = shape.autoShade
      ? computeRingGridCornerNormals(inRingsView, true, true, true, true)
      : null;
    const nIn = innerRings.length;
    for (let r = 0; r < nIn - 1; r++) {
      const t0 = innerRings[r].t;
      const t1 = innerRings[r + 1].t;
      const vBot = inRingsView[r];
      const vTop = inRingsView[r + 1];
      const sBot = inRingsScreen[r];
      const sTop = inRingsScreen[r + 1];
      const rowOff = r * sampleCount;
      for (let j = 0; j < sampleCount; j++) {
        const jn = (j + 1) % sampleCount;
        const s0 = j / sampleCount;
        const s1 = (j + 1) / sampleCount;
        const cnOff = (rowOff + j) * 12;
        rasterTri(
          vBot[jn], sBot[jn], s1, t0,
          vBot[j], sBot[j], s0, t0,
          vTop[j], sTop[j], s0, t1,
          innerPanelW,
          innerCornerNormals,
          cnOff + 3, cnOff, cnOff + 9,
        );
        rasterTri(
          vBot[jn], sBot[jn], s1, t0,
          vTop[j], sTop[j], s0, t1,
          vTop[jn], sTop[jn], s1, t1,
          innerPanelW,
          innerCornerNormals,
          cnOff + 3, cnOff + 9, cnOff + 6,
        );
      }
    }
  }

  // Helper: scanline fill a planar cap (horizontal or tilted, with optional inner cutout hole)
  const rasterPlanarCap = (
    outerCapPoly: [number, number][],
    innerHolePoly: [number, number][] | null,
    zLocalPlane: number,
    nLocalZ: 1 | -1,
    uprightCol: RGBA,
    isFloorCap = false,
  ) => {
    let capCol = uprightCol;
    let capSunBit: 0 | 1 | 2 = 2;
    let p0z = zLocalPlane, dz1 = 0, dz2 = 0;
    let s0x = 0, s0y = 0, dux = 1, duy = 0, dvx = 0, dvy = 1, invDet = 0;
    let useTiltedPlane = false;

    if (tilt) {
      const [nxV, nyV, nzV] = tiltNormalToView(0, 0, nLocalZ, tilt);
      if (nxV * 18 + nyV * 18 + nzV * 16 <= 1e-3) return; // Back-facing cap
      const P0 = transformLocalPointWithTilt(0, 0, zLocalPlane, tilt);
      const P1 = transformLocalPointWithTilt(1, 0, zLocalPlane, tilt);
      const P2 = transformLocalPointWithTilt(0, 1, zLocalPlane, tilt);
      const S0 = isoToScreenPx(P0.x, P0.y, P0.z, originX, originY);
      const S1 = isoToScreenPx(P1.x, P1.y, P1.z, originX, originY);
      const S2 = isoToScreenPx(P2.x, P2.y, P2.z, originX, originY);
      s0x = S0[0]; s0y = S0[1];
      dux = S1[0] - s0x; duy = S1[1] - s0y;
      dvx = S2[0] - s0x; dvy = S2[1] - s0y;
      const det = dux * dvy - duy * dvx;
      if (Math.abs(det) < 1e-5) return;
      invDet = 1 / det;
      p0z = P0.z;
      dz1 = P1.z - P0.z;
      dz2 = P2.z - P0.z;
      useTiltedPlane = true;

      const isTopFlat = Math.abs(nxV) < 1e-4 && Math.abs(nyV) < 1e-4 && nzV > 0;
      const isLeftPure = Math.abs(nxV) < 1e-4 && nyV > 0 && Math.abs(nzV) < 1e-4;
      const isRightPure = nxV > 0 && Math.abs(nyV) < 1e-4 && Math.abs(nzV) < 1e-4;
      if (isTopFlat) capCol = triad.top;
      else if (isLeftPure) capCol = triad.left;
      else if (isRightPure) capCol = triad.right;
      else {
        capCol = shadeByNormal(
          shape.baseColor,
          nxV,
          nyV,
          nzV,
          shape.autoShade,
          shape.shadeContrast,
          nLocalZ > 0 ? shape.roofColor : null,
        );
      }
      if (isFloorCap && shape.autoShade) {
        capCol = shadeColorHsv(capCol, 1.04, 0.86);
      }
      capSunBit = classifySunFacingMetricNormal(nxV, nyV, nzV);
    }

    let capMinY = Infinity, capMaxY = -Infinity;
    for (const [, sy] of outerCapPoly) {
      if (sy < capMinY) capMinY = sy;
      if (sy > capMaxY) capMaxY = sy;
    }
    const scanStartY = Math.max(bMinY, Math.floor(capMinY));
    const scanEndY = Math.min(bMaxY, Math.ceil(capMaxY));
    const crossings: { x: number; dir: number }[] = [];

    for (let py = scanStartY; py <= scanEndY; py++) {
      const scy = py + 0.5;
      crossings.length = 0;
      const nOut = outerCapPoly.length;
      for (let j = 0; j < nOut; j++) {
        const [ax, ay] = outerCapPoly[j];
        const [bx, by] = outerCapPoly[(j + 1) % nOut];
        if (ay <= scy && by > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
        } else if (by <= scy && ay > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
        }
      }
      if (innerHolePoly && innerHolePoly.length >= 3) {
        const nHole = innerHolePoly.length;
        for (let j = 0; j < nHole; j++) {
          const [ax, ay] = innerHolePoly[j];
          const [bx, by] = innerHolePoly[(j + 1) % nHole];
          // Opposite winding (-dir) carves out the interior hole cleanly
          if (ay <= scy && by > scy) {
            crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
          } else if (by <= scy && ay > scy) {
            crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
          }
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((p, q) => p.x - q.x);

      const ly = py - bMinY;
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k].dir;
        if (winding === 0) continue;
        const xStart = Math.max(bMinX, Math.ceil(crossings[k].x - 0.5));
        const xEnd = Math.min(bMaxX, Math.floor(crossings[k + 1].x - 0.5));
        for (let px = xStart; px <= xEnd; px++) {
          const idx = ly * bw + (px - bMinX);
          let zCap = zLocalPlane;
          let luFrac = 0, lvFrac = 0;
          if (useTiltedPlane) {
            const rx = px + 0.5 - s0x;
            const ry = scy - s0y;
            luFrac = (rx * dvy - ry * dvx) * invDet;
            lvFrac = (dux * ry - duy * rx) * invDet;
            zCap = p0z + luFrac * dz1 + lvFrac * dz2;
          }
          if (zCap < zDepth[idx] - 1e-3) continue;

          let col = capCol;
          if (useTopPattern) {
            if (useTiltedPlane) {
              col = sampleTopGridColor(clamp(luFrac, 0, 1), clamp(lvFrac, 0, 1), lsu, lsv, capCol, shape.pattern);
            } else {
              const dx = px + 0.5 - originX;
              const dy = (scy + zCap) - originY;
              const pu = dx / 32 + dy / 16;
              const pv = dy / 16 - dx / 32;
              const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
              const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
              const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
              col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, capCol, shape.pattern);
            }
          }

          const di = idx * 4;
          tmpBuf[di] = col.r;
          tmpBuf[di + 1] = col.g;
          tmpBuf[di + 2] = col.b;
          tmpBuf[di + 3] = 255;
          zDepth[idx] = zCap;
          faceTag[idx] = 2;
          if (tmpSun) tmpSun[idx] = capSunBit;
        }
      }
    }
  };

  // 3. Optional recessed solid floor inside hollow cavity (e.g. courtyard / fountain / stadium bowl)
  if (isHollow && innerFloorRing && inRingsScreen && inRingsScreen.length >= 2) {
    const zFloor = z0 + innerFloorRing.t * (z1 - z0);
    const floorCol = shape.autoShade
      ? shadeColorHsv(triad.top, 1.04, 0.86)
      : triad.top;
    rasterPlanarCap(inRingsScreen[0], null, zFloor, 1, floorCol, true);
  } else if (tilt && isHollow && flipZ && rawLoft.innerFloorRing && inRingsScreen && inRingsScreen.length >= 2) {
    const zFloor = z0 + (1 - rawLoft.innerFloorRing.t) * (z1 - z0);
    const floorCol = shape.autoShade
      ? shadeColorHsv(triad.top, 1.04, 0.86)
      : triad.top;
    rasterPlanarCap(inRingsScreen[inRingsScreen.length - 1], null, zFloor, -1, floorCol, true);
  }

  // 4. Top cap (solid or annular ring when hollow; solid when flipped cup with recessed floor)
  const topPoly = ringsScreen[numRings - 1];
  const topInnerPoly = inRingsScreen && !hasFlippedSolidTop ? inRingsScreen[inRingsScreen.length - 1] : null;
  rasterPlanarCap(topPoly, topInnerPoly, zTopCap, 1, triad.top, false);

  // 5. Bottom cap when tilted (solid or annular ring if hollow through-hole / flipped cup)
  if (tilt) {
    const botPoly = ringsScreen[0];
    const botInnerPoly =
      inRingsScreen && (flipZ || !rawLoft.innerFloorRing) ? inRingsScreen[0] : null;
    rasterPlanarCap(botPoly, botInnerPoly, zBotCap, -1, triad.top, false);
  }

  // Front top-rim highlight
  if (shape.edgeHighlight) {
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        if (faceTag[idx] !== 2) continue;
        const nearWall = tilt
          ? (ly + 1 < bh && faceTag[idx + bw] === 1) ||
            (ly > 0 && faceTag[idx - bw] === 1) ||
            (lx + 1 < bw && faceTag[idx + 1] === 1) ||
            (lx > 0 && faceTag[idx - 1] === 1)
          : ly + 1 < bh && faceTag[idx + bw] === 1;
        if (nearWall) {
          const di = idx * 4;
          tmpBuf[di] = triad.highlight.r;
          tmpBuf[di + 1] = triad.highlight.g;
          tmpBuf[di + 2] = triad.highlight.b;
          tmpBuf[di + 3] = 255;
        }
      }
    }
  }

  // Optional 1px inner perimeter / crease outline
  if (shape.outlineMode !== 'none') {
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        if (!faceTag[idx]) continue;
        const isOuter =
          lx === 0 || ly === 0 || lx === bw - 1 || ly === bh - 1 ||
          !faceTag[idx - 1] || !faceTag[idx + 1] || !faceTag[idx - bw] || !faceTag[idx + bw];
        const isCrease =
          shape.outlineMode === 'all_edges' &&
          faceTag[idx] === 2 &&
          ((ly + 1 < bh && faceTag[idx + bw] === 1) ||
            (isHollow &&
              ((ly > 0 && faceTag[idx - bw] === 1) ||
                (lx > 0 && faceTag[idx - 1] === 1) ||
                (lx + 1 < bw && faceTag[idx + 1] === 1))));
        if (isOuter || isCrease) {
          const di = idx * 4;
          tmpBuf[di] = triad.outline.r;
          tmpBuf[di + 1] = triad.outline.g;
          tmpBuf[di + 2] = triad.outline.b;
          tmpBuf[di + 3] = 255;
        }
      }
    }
  }

  const pyStart = Math.max(0, bMinY);
  const pyEnd = Math.min(h - 1, bMaxY);
  const pxStart = Math.max(0, bMinX);
  const pxEnd = Math.min(w - 1, bMaxX);
  for (let py = pyStart; py <= pyEnd; py++) {
    const ly = py - bMinY;
    for (let px = pxStart; px <= pxEnd; px++) {
      const li = ly * bw + (px - bMinX);
      const si = li * 4;
      if (tmpBuf[si + 3] > 0) {
        const di = (py * w + px) * 4;
        dst[di] = tmpBuf[si];
        dst[di + 1] = tmpBuf[si + 1];
        dst[di + 2] = tmpBuf[si + 2];
        dst[di + 3] = 255;
        if (activeRenderAux && tmpSun) {
          const pIdx = py * w + px;
          activeRenderAux.zData[pIdx] = zDepth[li];
          activeRenderAux.sunFacing[pIdx] = tmpSun[li];
        }
      }
    }
  }
}

function renderArch(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const heightPx = z1 - z0;
  if (heightPx <= 0) return;

  const spanCells = viewOri % 2 === 1 ? sv : su;
  const spanMetric = Math.max(4, spanCells * 18);
  const heightMetric = Math.max(4, heightPx);
  const sampleCount = getArchSampleCount(spanMetric, heightMetric);
  const cs = buildArchCrossSection({
    outerNodes: shape.archNodes,
    hollow: shape.archHollow ?? false,
    hollowStyle: shape.archHollowStyle ?? 'shell',
    innerMode: shape.archInnerMode ?? 'parallel',
    thickness: shape.archThickness ?? 0.28,
    innerNodes: shape.archInnerNodes,
    spanMetric,
    heightMetric,
    sampleCount,
  });
  if (cs.edges.length < 3 || cs.poly.length < 3) return;

  let meshMinX = Infinity, meshMinY = Infinity, meshMaxX = -Infinity, meshMaxY = -Infinity;
  const expandPt = (sc: [number, number]) => {
    if (sc[0] < meshMinX) meshMinX = sc[0];
    if (sc[1] < meshMinY) meshMinY = sc[1];
    if (sc[0] > meshMaxX) meshMaxX = sc[0];
    if (sc[1] > meshMaxY) meshMaxY = sc[1];
  };

  interface ExtrudedQuad {
    A0: Vec3; sA0: [number, number];
    B0: Vec3; sB0: [number, number];
    B1: Vec3; sB1: [number, number];
    A1: Vec3; sA1: [number, number];
    h0: number;
    h1: number;
    tag: 'outer' | 'inner' | 'bottom' | 'top_flat' | 'side_wall';
  }

  const flipZ = Boolean(shape.flipZ);
  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(u0, v0, su, sv, z0, z1, viewOri, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;
  const toArchPt = (s: number, lv: number, z: number): Vec3 =>
    tilt
      ? transformLocalPointWithTilt(s, lv, z, tilt)
      : transformLocalToViewPoint(s, lv, z, u0, v0, su, sv, viewOri);

  const quads: ExtrudedQuad[] = [];
  for (const e of cs.edges) {
    const sA = flipZ ? e.s1 : e.s0;
    const sB = flipZ ? e.s0 : e.s1;
    const hA = flipZ ? 1 - e.h1 : e.h0;
    const hB = flipZ ? 1 - e.h0 : e.h1;
    const zA = z0 + hA * heightPx;
    const zB = z0 + hB * heightPx;
    const A0 = toArchPt(sA, 0, zA);
    const B0 = toArchPt(sB, 0, zB);
    const B1 = toArchPt(sB, 1, zB);
    const A1 = toArchPt(sA, 1, zA);
    const sA0 = isoToScreenPx(A0.x, A0.y, A0.z, originX, originY);
    const sB0 = isoToScreenPx(B0.x, B0.y, B0.z, originX, originY);
    const sB1 = isoToScreenPx(B1.x, B1.y, B1.z, originX, originY);
    const sA1 = isoToScreenPx(A1.x, A1.y, A1.z, originX, originY);
    expandPt(sA0);
    expandPt(sB0);
    expandPt(sB1);
    expandPt(sA1);
    const mappedTag: ExtrudedQuad['tag'] = flipZ
      ? e.tag === 'bottom'
        ? 'top_flat'
        : e.tag === 'top_flat'
          ? 'bottom'
          : e.tag
      : e.tag;
    if (tilt || mappedTag !== 'bottom') {
      quads.push({ A0, sA0, B0, sB0, B1, sB1, A1, sA1, h0: hA, h1: hB, tag: mappedTag });
    }
  }

  const bMinX = clamp(Math.floor(meshMinX) - 1, -1, w);
  const bMaxX = clamp(Math.ceil(meshMaxX) + 1, -1, w);
  const bMinY = clamp(Math.floor(meshMinY) - 1, -1, h);
  const bMaxY = clamp(Math.ceil(meshMaxY) + 1, -1, h);
  if (bMaxX < 0 || bMinX >= w || bMaxY < 0 || bMinY >= h || bMinX > bMaxX || bMinY > bMaxY) return;

  const bw = bMaxX - bMinX + 1;
  const bh = bMaxY - bMinY + 1;
  const tmpBuf = new Uint8ClampedArray(bw * bh * 4);
  const zDepth = new Float32Array(bw * bh);
  zDepth.fill(-Infinity);
  // 0 = empty, 1 = front arch cap, 2 = outer barrel/side, 3 = inner tunnel, 4 = flat top
  const faceTag = new Uint8Array(bw * bh);
  const tmpZ = activeRenderAux ? new Float32Array(bw * bh) : null;
  const tmpSun = activeRenderAux ? new Uint8Array(bw * bh) : null;

  const odd = viewOri % 2 === 1;
  const barrelCells = odd ? su : sv;
  const barrelSpanW = Math.max(4, Math.round(barrelCells * 16));
  const wallH = Math.max(1, heightPx);
  const useTopPattern = shape.pattern.type === 'roof_grid' || shape.pattern.applyTop;
  const useWallPattern = shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid';

  const rasterBarrelTri = (
    A: Vec3, sA: [number, number], lvA: number, hA: number,
    B: Vec3, sB: [number, number], lvB: number, hB: number,
    C: Vec3, sC: [number, number], lvC: number, hC: number,
    tag: 'outer' | 'inner' | 'bottom' | 'top_flat' | 'side_wall',
    nA?: Norm3,
    nB?: Norm3,
    nC?: Norm3,
  ) => {
    const [ax, ay] = sA;
    const [bx, by] = sB;
    const [cx, cy] = sC;
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area2 >= -1e-4) return;

    const e1x = (B.x - A.x) * 18, e1y = (B.y - A.y) * 18, e1z = B.z - A.z;
    const e2x = (C.x - A.x) * 18, e2y = (C.y - A.y) * 18, e2z = C.z - A.z;
    const nx = -(e1y * e2z - e1z * e2y);
    const ny = -(e1z * e2x - e1x * e2z);
    const nz = -(e1x * e2y - e1y * e2x);
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const uz = nz / nLen;
    const useSmooth = Boolean(shape.autoShade && nA && nB && nC && normalsDiffer(nA, nB, nC));
    const isFlatUp = !tilt && (tag === 'top_flat' || (tag !== 'inner' && uz > 0.96 && !useSmooth));
    const isLeftPure = tag !== 'inner' && !useSmooth && Math.abs(nx) < 1e-4 && ny > 0 && Math.abs(nz) < 1e-4;
    const isRightPure = tag !== 'inner' && !useSmooth && nx > 0 && Math.abs(ny) < 1e-4 && Math.abs(nz) < 1e-4;

    let flatCol: RGBA;
    if (isFlatUp) {
      flatCol = triad.top;
    } else if (isLeftPure) {
      flatCol = triad.left;
    } else if (isRightPure) {
      flatCol = triad.right;
    } else {
      flatCol = shadeByNormal(
        shape.baseColor,
        nx,
        ny,
        nz,
        shape.autoShade,
        shape.shadeContrast,
        tag === 'inner' ? null : shape.roofColor,
      );
      if (tag === 'inner' && shape.autoShade) {
        flatCol = shadeColorHsv(flatCol, 1.06, 0.84);
      }
    }

    const triMinX = Math.max(bMinX, Math.floor(Math.min(ax, bx, cx)));
    const triMaxX = Math.min(bMaxX, Math.ceil(Math.max(ax, bx, cx)));
    const triMinY = Math.max(bMinY, Math.floor(Math.min(ay, by, cy)));
    const triMaxY = Math.min(bMaxY, Math.ceil(Math.max(ay, by, cy)));
    if (triMinX > triMaxX || triMinY > triMaxY) return;

    const dA = A.x + A.y + A.z;
    const dB = B.x + B.y + B.z;
    const dC = C.x + C.y + C.z;
    const outTag = tag === 'top_flat' || isFlatUp ? 4 : tag === 'inner' ? 3 : 2;
    const faceShade: 'left' | 'right' | 'curve' = isRightPure ? 'right' : isLeftPure ? 'left' : 'curve';

    const invArea = 1 / area2;
    for (let py = triMinY; py <= triMaxY; py++) {
      const scy = py + 0.5;
      const ly = py - bMinY;
      for (let px = triMinX; px <= triMaxX; px++) {
        const scx = px + 0.5;
        const w0 = ((cx - bx) * (scy - by) - (cy - by) * (scx - bx)) * invArea;
        if (w0 < -1e-5) continue;
        const w1 = ((ax - cx) * (scy - cy) - (ay - cy) * (scx - cx)) * invArea;
        if (w1 < -1e-5) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -1e-5) continue;

        const depth = w0 * dA + w1 * dB + w2 * dC;
        const idx = ly * bw + (px - bMinX);
        if (depth < zDepth[idx] - 1e-4) continue;

        let basePixCol = flatCol;
        let pixUz = uz;
        let sunNx = nx;
        let sunNy = ny;
        let sunNz = nz;
        if (!isFlatUp && !isLeftPure && !isRightPure && useSmooth) {
          const pnx = w0 * nA![0] + w1 * nB![0] + w2 * nC![0];
          const pny = w0 * nA![1] + w1 * nB![1] + w2 * nC![1];
          const pnz = w0 * nA![2] + w1 * nB![2] + w2 * nC![2];
          sunNx = pnx;
          sunNy = pny;
          sunNz = pnz;
          const pLen = Math.hypot(pnx, pny, pnz) || 1;
          pixUz = pnz / pLen;
          basePixCol = shadeByNormal(
            shape.baseColor,
            pnx,
            pny,
            pnz,
            true,
            shape.shadeContrast,
            tag === 'inner' ? null : shape.roofColor,
          );
          if (tag === 'inner') {
            basePixCol = shadeColorHsv(basePixCol, 1.06, 0.84);
          }
        }

        const vz = w0 * A.z + w1 * B.z + w2 * C.z;
        let col = basePixCol;
        if ((isFlatUp || (tag === 'outer' && pixUz > 0.45)) && useTopPattern) {
          const dx = scx - originX;
          const dy = (scy + vz) - originY;
          const pu = dx / 32 + dy / 16;
          const pv = dy / 16 - dx / 32;
          const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
          const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
          const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
          col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, basePixCol, shape.pattern);
        } else if (
          !isFlatUp &&
          useWallPattern &&
          (shape.pattern.type === 'brick' || (Math.abs(pixUz) < 0.72 && (tag !== 'inner' || pixUz > -0.25)))
        ) {
          const lvVal = w0 * lvA + w1 * lvB + w2 * lvC;
          const hVal = w0 * hA + w1 * hB + w2 * hC;
          const lvScreen = viewOri === 0 || viewOri === 1 ? 1 - lvVal : lvVal;
          const wx = Math.floor(clamp(lvScreen, 0, 0.9999) * barrelSpanW);
          const wy = Math.max(0, Math.floor((1 - clamp(hVal, 0, 1)) * wallH));
          col = sampleWallPattern(wx, wy, barrelSpanW, wallH, shape.pattern, basePixCol, faceShade);
        }

        const di = idx * 4;
        tmpBuf[di] = col.r;
        tmpBuf[di + 1] = col.g;
        tmpBuf[di + 2] = col.b;
        tmpBuf[di + 3] = 255;
        zDepth[idx] = depth;
        faceTag[idx] = outTag;
        if (tmpZ && tmpSun) {
          tmpZ[idx] = tilt ? vz : clamp(vz, z0, z1);
          tmpSun[idx] = isFlatUp ? 2 : classifySunFacingMetricNormal(sunNx, sunNy, sunNz);
        }
      }
    }
  };

  let archQuadNormals: Norm3[] | null = null;
  let archStartMap: Map<string, number> | null = null;
  let archEndMap: Map<string, number> | null = null;
  const edgePtKey = (tag: string, p0: Vec3, p1: Vec3) =>
    `${tag}|${Math.round(p0.x * 1e4)},${Math.round(p0.y * 1e4)},${Math.round(p0.z * 1e2)}|${Math.round(p1.x * 1e4)},${Math.round(p1.y * 1e4)},${Math.round(p1.z * 1e2)}`;
  if (shape.autoShade && quads.length > 0) {
    archQuadNormals = quads.map((q) => {
      const n1 = triNormalMetric(q.A0, q.B0, q.B1, true);
      const n2 = triNormalMetric(q.A0, q.B1, q.A1, true);
      return normalizeVec3(n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]);
    });
    archStartMap = new Map<string, number>();
    archEndMap = new Map<string, number>();
    for (let k = 0; k < quads.length; k++) {
      const q = quads[k];
      if (q.tag === 'outer' || q.tag === 'inner') {
        archStartMap.set(edgePtKey(q.tag, q.A0, q.A1), k);
        archEndMap.set(edgePtKey(q.tag, q.B0, q.B1), k);
      }
    }
  }

  for (let k = 0; k < quads.length; k++) {
    const q = quads[k];
    let nStart: Norm3 | undefined;
    let nEnd: Norm3 | undefined;
    if (archQuadNormals && archStartMap && archEndMap && (q.tag === 'outer' || q.tag === 'inner')) {
      const qn = archQuadNormals[k];
      const prevIdx = archEndMap.get(edgePtKey(q.tag, q.A0, q.A1));
      if (prevIdx !== undefined && prevIdx !== k) {
        const pn = archQuadNormals[prevIdx];
        nStart =
          pn[0] * qn[0] + pn[1] * qn[1] + pn[2] * qn[2] >= CREASE_COS
            ? normalizeVec3(pn[0] + qn[0], pn[1] + qn[1], pn[2] + qn[2])
            : qn;
      } else {
        nStart = qn;
      }
      const nextIdx = archStartMap.get(edgePtKey(q.tag, q.B0, q.B1));
      if (nextIdx !== undefined && nextIdx !== k) {
        const nn = archQuadNormals[nextIdx];
        nEnd =
          nn[0] * qn[0] + nn[1] * qn[1] + nn[2] * qn[2] >= CREASE_COS
            ? normalizeVec3(nn[0] + qn[0], nn[1] + qn[1], nn[2] + qn[2])
            : qn;
      } else {
        nEnd = qn;
      }
    }
    rasterBarrelTri(
      q.A0, q.sA0, 0, q.h0,
      q.B0, q.sB0, 0, q.h1,
      q.B1, q.sB1, 1, q.h1,
      q.tag,
      nStart, nEnd, nEnd,
    );
    rasterBarrelTri(
      q.A0, q.sA0, 0, q.h0,
      q.B1, q.sB1, 1, q.h1,
      q.A1, q.sA1, 1, q.h0,
      q.tag,
      nStart, nEnd, nStart,
    );
  }

  // Scanline-rasterize camera-facing arch end-cap(s)
  if (!tilt) {
    const lvCap = viewOri === 0 || viewOri === 3 ? 1 : 0;
    const isLeftCap = viewOri === 0 || viewOri === 2; // +V front-left wall vs +U front-right wall
    const capBaseCol = isLeftCap ? triad.left : triad.right;
    const capFaceShade: 'left' | 'right' = isLeftCap ? 'left' : 'right';

    const capCorner0 = transformLocalToViewPoint(0, lvCap, z0, u0, v0, su, sv, viewOri);
    const capCorner1 = transformLocalToViewPoint(1, lvCap, z0, u0, v0, su, sv, viewOri);
    const [capX0] = isoToScreenPx(capCorner0.x, capCorner0.y, capCorner0.z, originX, originY);
    const [capX1] = isoToScreenPx(capCorner1.x, capCorner1.y, capCorner1.z, originX, originY);
    const capMinSx = Math.min(capX0, capX1);
    const capSpanW = Math.max(1, Math.round(Math.abs(capX1 - capX0)));

    const capPoly: [number, number][] = cs.poly.map(([s, hFrac]) => {
      const hUse = flipZ ? 1 - hFrac : hFrac;
      const pt = transformLocalToViewPoint(s, lvCap, z0 + hUse * heightPx, u0, v0, su, sv, viewOri);
      return isoToScreenPx(pt.x, pt.y, pt.z, originX, originY);
    });

    let capMinY = Infinity, capMaxY = -Infinity;
    for (const [, sy] of capPoly) {
      if (sy < capMinY) capMinY = sy;
      if (sy > capMaxY) capMaxY = sy;
    }
    const scanStartY = Math.max(bMinY, Math.floor(capMinY));
    const scanEndY = Math.min(bMaxY, Math.ceil(capMaxY));
    const crossings: { x: number; dir: number }[] = [];
    const capCount = capPoly.length;

    for (let py = scanStartY; py <= scanEndY; py++) {
      const scy = py + 0.5;
      crossings.length = 0;
      for (let j = 0; j < capCount; j++) {
        const [ax, ay] = capPoly[j];
        const [bx, by] = capPoly[(j + 1) % capCount];
        if (ay <= scy && by > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
        } else if (by <= scy && ay > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((p, q) => p.x - q.x);

      const ly = py - bMinY;
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k].dir;
        if (winding === 0) continue;
        const xStart = Math.max(bMinX, Math.ceil(crossings[k].x - 0.5));
        const xEnd = Math.min(bMaxX, Math.floor(crossings[k + 1].x - 0.5));
        for (let px = xStart; px <= xEnd; px++) {
          const scx = px + 0.5;
          let x: number, y: number;
          if (isLeftCap) {
            y = v0 + sv;
            x = y + (scx - originX) / 16;
          } else {
            x = u0 + su;
            y = x - (scx - originX) / 16;
          }
          const z = originY - scy + (x + y) * 8;
          const idx = ly * bw + (px - bMinX);

          let col = capBaseCol;
          if (useWallPattern) {
            const wx = px - Math.floor(capMinSx);
            const wy = Math.max(0, Math.floor(z1 - z));
            col = sampleWallPattern(wx, wy, capSpanW, wallH, shape.pattern, capBaseCol, capFaceShade);
          }

          const di = idx * 4;
          tmpBuf[di] = col.r;
          tmpBuf[di + 1] = col.g;
          tmpBuf[di + 2] = col.b;
          tmpBuf[di + 3] = 255;
          zDepth[idx] = x + y + z;
          faceTag[idx] = 1;
          if (tmpZ && tmpSun) {
            tmpZ[idx] = clamp(z, z0, z1);
            tmpSun[idx] = isLeftCap ? 2 : 0;
          }
        }
      }
    }
  } else {
    const capSpanW = Math.max(4, Math.round(spanCells * 16));
    const crossings: { x: number; dir: number }[] = [];
    for (const lvCap of [0, 1] as const) {
      const [nxV, nyV, nzV] = tiltNormalToView(0, lvCap === 1 ? 1 : -1, 0, tilt);
      if (nxV * 18 + nyV * 18 + nzV * 16 <= 1e-3) continue; // Back-facing cap

      const P0 = transformLocalPointWithTilt(0, lvCap, z0, tilt);
      const P1 = transformLocalPointWithTilt(1, lvCap, z0, tilt);
      const P2 = transformLocalPointWithTilt(0, lvCap, z1, tilt);
      const S0 = isoToScreenPx(P0.x, P0.y, P0.z, originX, originY);
      const S1 = isoToScreenPx(P1.x, P1.y, P1.z, originX, originY);
      const S2 = isoToScreenPx(P2.x, P2.y, P2.z, originX, originY);
      const dux = S1[0] - S0[0], duy = S1[1] - S0[1];
      const dvx = S2[0] - S0[0], dvy = S2[1] - S0[1];
      const det = dux * dvy - duy * dvx;
      if (Math.abs(det) < 1e-5) continue;
      const invDet = 1 / det;

      const isTopFlat = Math.abs(nxV) < 1e-4 && Math.abs(nyV) < 1e-4 && nzV > 0;
      const isLeftPure = Math.abs(nxV) < 1e-4 && nyV > 0 && Math.abs(nzV) < 1e-4;
      const isRightPure = nxV > 0 && Math.abs(nyV) < 1e-4 && Math.abs(nzV) < 1e-4;
      const capBaseCol = isTopFlat
        ? triad.top
        : isLeftPure
          ? triad.left
          : isRightPure
            ? triad.right
            : shadeByNormal(shape.baseColor, nxV, nyV, nzV, shape.autoShade, shape.shadeContrast, shape.roofColor);
      const capFaceShade: 'left' | 'right' | 'curve' = isRightPure ? 'right' : isLeftPure ? 'left' : 'curve';
      const capSunBit = classifySunFacingMetricNormal(nxV, nyV, nzV);

      const capPoly: [number, number][] = cs.poly.map(([s, hFrac]) => {
        const hUse = flipZ ? 1 - hFrac : hFrac;
        const pt = transformLocalPointWithTilt(s, lvCap, z0 + hUse * heightPx, tilt);
        return isoToScreenPx(pt.x, pt.y, pt.z, originX, originY);
      });
      let capMinY = Infinity, capMaxY = -Infinity;
      for (const [, sy] of capPoly) {
        if (sy < capMinY) capMinY = sy;
        if (sy > capMaxY) capMaxY = sy;
      }
      const scanStartY = Math.max(bMinY, Math.floor(capMinY));
      const scanEndY = Math.min(bMaxY, Math.ceil(capMaxY));
      const capCount = capPoly.length;
      const d0 = P0.x + P0.y + P0.z;
      const dd1 = (P1.x + P1.y + P1.z) - d0;
      const dd2 = (P2.x + P2.y + P2.z) - d0;
      const dz1 = P1.z - P0.z;
      const dz2 = P2.z - P0.z;

      for (let py = scanStartY; py <= scanEndY; py++) {
        const scy = py + 0.5;
        crossings.length = 0;
        for (let j = 0; j < capCount; j++) {
          const [ax, ay] = capPoly[j];
          const [bx, by] = capPoly[(j + 1) % capCount];
          if (ay <= scy && by > scy) {
            crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
          } else if (by <= scy && ay > scy) {
            crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
          }
        }
        if (crossings.length < 2) continue;
        crossings.sort((p, q) => p.x - q.x);

        const ly = py - bMinY;
        let winding = 0;
        for (let k = 0; k < crossings.length - 1; k++) {
          winding += crossings[k].dir;
          if (winding === 0) continue;
          const xStart = Math.max(bMinX, Math.ceil(crossings[k].x - 0.5));
          const xEnd = Math.min(bMaxX, Math.floor(crossings[k + 1].x - 0.5));
          for (let px = xStart; px <= xEnd; px++) {
            const rx = px + 0.5 - S0[0];
            const ry = scy - S0[1];
            const sFrac = (rx * dvy - ry * dvx) * invDet;
            const hFrac = (dux * ry - duy * rx) * invDet;
            const depth = d0 + sFrac * dd1 + hFrac * dd2;
            const idx = ly * bw + (px - bMinX);
            if (depth < zDepth[idx] - 1e-4) continue;

            let col = capBaseCol;
            if (useWallPattern) {
              const wx = Math.floor(clamp(sFrac, 0, 0.9999) * capSpanW);
              const wy = Math.floor((1 - clamp(hFrac, 0, 1)) * wallH);
              col = sampleWallPattern(wx, wy, capSpanW, wallH, shape.pattern, capBaseCol, capFaceShade);
            }

            const di = idx * 4;
            tmpBuf[di] = col.r;
            tmpBuf[di + 1] = col.g;
            tmpBuf[di + 2] = col.b;
            tmpBuf[di + 3] = 255;
            zDepth[idx] = depth;
            faceTag[idx] = 1;
            if (tmpZ && tmpSun) {
              tmpZ[idx] = P0.z + sFrac * dz1 + hFrac * dz2;
              tmpSun[idx] = capSunBit;
            }
          }
        }
      }
    }
  }

  // Front arch rim highlights (upper barrel/deck meeting front cap, and hollow arch intrados rim)
  if (shape.edgeHighlight) {
    for (let ly = 0; ly < bh - 1; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        const t = faceTag[idx];
        const tBelow = faceTag[idx + bw];
        const isExtradosRim = (t === 2 || t === 4) && tBelow === 1;
        const isPortalDeckRim =
          (!tilt || Boolean(shape.archHollow && shape.archHollowStyle === 'portal')) &&
          t === 4 &&
          tBelow === 2;
        const isHollowIntradosRim = t === 1 && tBelow === 3;
        if (isExtradosRim || isPortalDeckRim || isHollowIntradosRim) {
          const di = idx * 4;
          tmpBuf[di] = triad.highlight.r;
          tmpBuf[di + 1] = triad.highlight.g;
          tmpBuf[di + 2] = triad.highlight.b;
          tmpBuf[di + 3] = 255;
        }
      }
    }
  }

  // Optional 1px inner perimeter & crease outlines
  if (shape.outlineMode !== 'none') {
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        const t = faceTag[idx];
        if (!t) continue;
        const isOuter =
          lx === 0 ||
          ly === 0 ||
          lx === bw - 1 ||
          ly === bh - 1 ||
          !faceTag[idx - 1] ||
          !faceTag[idx + 1] ||
          !faceTag[idx - bw] ||
          !faceTag[idx + bw];
        let isCrease = false;
        if (shape.outlineMode === 'all_edges' && !isOuter) {
          const hasCapNeighbor =
            (t === 2 || t === 4) &&
            ((ly + 1 < bh && faceTag[idx + bw] === 1) ||
              (lx + 1 < bw && faceTag[idx + 1] === 1) ||
              (lx > 0 && faceTag[idx - 1] === 1));
          const hasTunnelNeighbor =
            t === 1 &&
            ((ly + 1 < bh && faceTag[idx + bw] === 3) ||
              (lx + 1 < bw && faceTag[idx + 1] === 3) ||
              (lx > 0 && faceTag[idx - 1] === 3) ||
              (ly > 0 && faceTag[idx - bw] === 3));
          const hasDeckCrease = t === 4 && ly + 1 < bh && faceTag[idx + bw] === 2;
          isCrease = hasCapNeighbor || hasTunnelNeighbor || hasDeckCrease;
        }
        if (isOuter || isCrease) {
          const di = idx * 4;
          tmpBuf[di] = triad.outline.r;
          tmpBuf[di + 1] = triad.outline.g;
          tmpBuf[di + 2] = triad.outline.b;
          tmpBuf[di + 3] = 255;
        }
      }
    }
  }

  const pyStart = Math.max(0, bMinY);
  const pyEnd = Math.min(h - 1, bMaxY);
  const pxStart = Math.max(0, bMinX);
  const pxEnd = Math.min(w - 1, bMaxX);
  for (let py = pyStart; py <= pyEnd; py++) {
    const ly = py - bMinY;
    for (let px = pxStart; px <= pxEnd; px++) {
      const li = ly * bw + (px - bMinX);
      const si = li * 4;
      if (tmpBuf[si + 3] > 0) {
        const di = (py * w + px) * 4;
        dst[di] = tmpBuf[si];
        dst[di + 1] = tmpBuf[si + 1];
        dst[di + 2] = tmpBuf[si + 2];
        dst[di + 3] = 255;
        if (activeRenderAux && tmpZ && tmpSun) {
          const pIdx = py * w + px;
          activeRenderAux.zData[pIdx] = tmpZ[li];
          activeRenderAux.sunFacing[pIdx] = tmpSun[li];
        }
      }
    }
  }
}

// ---------------- Main Entry ----------------

function renderMultiSectionColumn(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  triad: PaletteTriad,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const isPoly = isPolygonalColumnShape(shape);
  const flipZ = Boolean(shape.flipZ);
  const cylSamples = clamp(Math.round((su + sv) * 32), 48, 160);
  const zSteps = clamp(Math.ceil((z1 - z0) * 0.85), 20, 288);
  const rawRings = buildColumnRings(shape, zSteps, cylSamples);
  const rings = flipZ
    ? [...rawRings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
    : rawRings;
  if (rings.length < 2) return;

  const numRings = rings.length;
  const vertCount = rings[0].pts.length;
  if (vertCount < 3) return;

  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(u0, v0, su, sv, z0, z1, viewOri, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;
  const toColPt = (lu: number, lv: number, z: number): Vec3 =>
    tilt
      ? transformLocalPointWithTilt(lu, lv, z, tilt)
      : transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, viewOri);

  const ringsView: Vec3[][] = new Array(numRings);
  const ringsScreen: [number, number][][] = new Array(numRings);
  let meshMinX = Infinity, meshMinY = Infinity, meshMaxX = -Infinity, meshMaxY = -Infinity;

  for (let r = 0; r < numRings; r++) {
    const zRing = z0 + rings[r].t * (z1 - z0);
    const pts = rings[r].pts;
    const vArr: Vec3[] = new Array(vertCount);
    const sArr: [number, number][] = new Array(vertCount);
    for (let j = 0; j < vertCount; j++) {
      const pt3 = toColPt(pts[j][0], pts[j][1], zRing);
      const sc = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
      vArr[j] = pt3;
      sArr[j] = sc;
      if (sc[0] < meshMinX) meshMinX = sc[0];
      if (sc[1] < meshMinY) meshMinY = sc[1];
      if (sc[0] > meshMaxX) meshMaxX = sc[0];
      if (sc[1] > meshMaxY) meshMaxY = sc[1];
    }
    ringsView[r] = vArr;
    ringsScreen[r] = sArr;
  }

  const bMinX = clamp(Math.floor(meshMinX) - 1, -1, w);
  const bMaxX = clamp(Math.ceil(meshMaxX) + 1, -1, w);
  const bMinY = clamp(Math.floor(meshMinY) - 1, -1, h);
  const bMaxY = clamp(Math.ceil(meshMaxY) + 1, -1, h);
  if (bMaxX < 0 || bMinX >= w || bMaxY < 0 || bMinY >= h || bMinX > bMaxX || bMinY > bMaxY) return;

  const bw = bMaxX - bMinX + 1;
  const bh = bMaxY - bMinY + 1;
  const tmpBuf = new Uint8ClampedArray(bw * bh * 4);
  const zDepth = new Float32Array(bw * bh);
  zDepth.fill(-Infinity);
  const faceTag = new Uint8Array(bw * bh); // 0 = empty, 1 = wall, 2 = top/terrace
  const edgeTag = new Uint16Array(bw * bh); // wall edge index + 1 for polygonal columns
  const tmpSun = activeRenderAux ? new Uint8Array(bw * bh) : null;

  const wallH = Math.max(1, Math.round(z1 - z0));
  const useTopPattern = shape.pattern.type === 'roof_grid' || shape.pattern.applyTop;
  const useWallPattern = shape.pattern.type !== 'none' && shape.pattern.type !== 'roof_grid';
  const cylPanelW = Math.max(6, Math.round(((su + sv) * 0.5) * Math.PI * 32 * 0.25));
  const { lsu: localSu, lsv: localSv } = getLocalDimsFromShape(shape);
  const faceSpecMap = isPoly && shape.faceTextures
    ? new Map<string, PlanarFaceSpec>(getPlanarFacesForShape(shape).map((fs) => [fs.id, fs]))
    : null;
  const topTexSlot = faceSpecMap ? shape.faceTextures?.top : undefined;
  const topFaceSpec = faceSpecMap?.get('top');
  const polyEdgeTexSlots: ({ slot: FaceTextureSlot; faceW: number; faceH: number } | null)[] | null = (() => {
    if (!faceSpecMap || !shape.faceTextures) return null;
    const candidates: { id: string; nx: number; ny: number }[] = [];
    if (shape.shapeType === 'box') {
      candidates.push(
        { id: 'wall_nv', nx: 0, ny: -1 },
        { id: 'wall_pu', nx: 1, ny: 0 },
        { id: 'wall_pv', nx: 0, ny: 1 },
        { id: 'wall_nu', nx: -1, ny: 0 },
      );
    } else if (shape.shapeType === 'right_tri_prism') {
      const s2 = Math.SQRT1_2;
      candidates.push(
        { id: 'wall_nv', nx: 0, ny: -1 },
        { id: 'wall_hyp', nx: s2, ny: s2 },
        { id: 'wall_nu', nx: -1, ny: 0 },
      );
    } else if (shape.shapeType === 'prism') {
      const nSides = clamp(Math.round(Number.isFinite(shape.prismSides) ? shape.prismSides : 6), 3, 12);
      const startA = Math.PI / nSides;
      const stepA = (Math.PI * 2) / nSides;
      for (let i = 0; i < nSides; i++) {
        const a = startA - (i + 0.5) * stepA;
        candidates.push({ id: `side_${i}`, nx: Math.cos(a), ny: Math.sin(a) });
      }
    }
    if (candidates.length === 0) return null;
    const refPts = rings[0].pts;
    return refPts.map((pt, j) => {
      const nextPt = refPts[(j + 1) % refPts.length];
      const dux = nextPt[0] - pt[0];
      const dvy = nextPt[1] - pt[1];
      const onx = dvy;
      const ony = -dux;
      let bestId = candidates[0].id;
      let bestDot = -Infinity;
      for (const c of candidates) {
        const dot = onx * c.nx + ony * c.ny;
        if (dot > bestDot) {
          bestDot = dot;
          bestId = c.id;
        }
      }
      const slot = shape.faceTextures?.[bestId];
      if (!slot || slot.mode === 'none') return null;
      const spec = faceSpecMap.get(bestId);
      return {
        slot,
        faceW: spec?.faceW ?? Math.max(4, Math.round(Math.hypot(dux * localSu, dvy * localSv) * 16)),
        faceH: spec?.faceH ?? wallH,
      };
    });
  })();

  const rasterTri = (
    A: Vec3, sA: [number, number], uA: number, vA: number,
    B: Vec3, sB: [number, number], uB: number, vB: number,
    C: Vec3, sC: [number, number], uC: number, vC: number,
    curPanelW: number,
    wallEdgeId: number,
    overrideNormal?: [number, number, number],
    spanBotW?: number,
    spanTopW?: number,
    spanT0 = 0,
    spanT1 = 1,
    nBuf: Float32Array | null = null,
    nOffA = 0,
    nOffB = 0,
    nOffC = 0,
  ) => {
    const [ax, ay] = sA;
    const [bx, by] = sB;
    const [cx, cy] = sC;
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area2 <= 1e-4) return; // Back-facing or degenerate for CW local ring

    let nx: number, ny: number, nz: number;
    if (overrideNormal) {
      nx = overrideNormal[0];
      ny = overrideNormal[1];
      nz = overrideNormal[2];
    } else {
      const e1x = (B.x - A.x) * 18, e1y = (B.y - A.y) * 18, e1z = B.z - A.z;
      const e2x = (C.x - A.x) * 18, e2y = (C.y - A.y) * 18, e2z = C.z - A.z;
      nx = e1y * e2z - e1z * e2y;
      ny = e1z * e2x - e1x * e2z;
      nz = e1x * e2y - e1y * e2x;
    }
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const useSmooth = Boolean(shape.autoShade && nBuf && normalsDifferFlat(nBuf, nOffA, nOffB, nOffC));
    const isFlatUp = !tilt && nz / nLen > 0.96 && !useSmooth;

    const flatCol = useSmooth
      ? shape.baseColor
      : isFlatUp
        ? triad.top
        : shadeByNormal(shape.baseColor, nx, ny, nz, shape.autoShade, shape.shadeContrast, shape.roofColor);
    const polyFaceTex = !isFlatUp && polyEdgeTexSlots && wallEdgeId > 0 ? polyEdgeTexSlots[wallEdgeId - 1] : null;
    const activeTexSlot = isFlatUp && topTexSlot && topTexSlot.mode !== 'none' ? topTexSlot : polyFaceTex?.slot;
    const texNeedsShade = Boolean(activeTexSlot && activeTexSlot.shadeWithFace !== false);
    const shadeFactor = activeTexSlot
      ? texNeedsShade && !useSmooth
        ? computeFaceTextureShadeFactor(nx, ny, nz, shape.autoShade, shape.shadeContrast)
        : 1
      : 1;
    const spanDt = spanT1 - spanT0;

    const triMinX = Math.max(bMinX, Math.floor(Math.min(ax, bx, cx)));
    const triMaxX = Math.min(bMaxX, Math.ceil(Math.max(ax, bx, cx)));
    const triMinY = Math.max(bMinY, Math.floor(Math.min(ay, by, cy)));
    const triMaxY = Math.min(bMaxY, Math.ceil(Math.max(ay, by, cy)));
    if (triMinX > triMaxX || triMinY > triMaxY) return;

    const invArea = 1 / area2;
    const nAx = useSmooth ? nBuf![nOffA] : 0, nAy = useSmooth ? nBuf![nOffA + 1] : 0, nAz = useSmooth ? nBuf![nOffA + 2] : 0;
    const nBx = useSmooth ? nBuf![nOffB] : 0, nBy = useSmooth ? nBuf![nOffB + 1] : 0, nBz = useSmooth ? nBuf![nOffB + 2] : 0;
    const nCx = useSmooth ? nBuf![nOffC] : 0, nCy = useSmooth ? nBuf![nOffC + 1] : 0, nCz = useSmooth ? nBuf![nOffC + 2] : 0;
    for (let py = triMinY; py <= triMaxY; py++) {
      const scy = py + 0.5;
      const ly = py - bMinY;
      for (let px = triMinX; px <= triMaxX; px++) {
        const scx = px + 0.5;
        const w0 = ((cx - bx) * (scy - by) - (cy - by) * (scx - bx)) * invArea;
        if (w0 < -1e-5) continue;
        const w1 = ((ax - cx) * (scy - cy) - (ay - cy) * (scx - cx)) * invArea;
        if (w1 < -1e-5) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -1e-5) continue;

        const vz = w0 * A.z + w1 * B.z + w2 * C.z;
        const idx = ly * bw + (px - bMinX);
        if (vz < zDepth[idx] - 1e-4) continue;

        let basePixCol = flatCol;
        let pixShadeFactor = shadeFactor;
        let sunNx = nx;
        let sunNy = ny;
        let sunNz = nz;
        if (!isFlatUp && useSmooth) {
          const pnx = w0 * nAx + w1 * nBx + w2 * nCx;
          const pny = w0 * nAy + w1 * nBy + w2 * nCy;
          const pnz = w0 * nAz + w1 * nBz + w2 * nCz;
          sunNx = pnx;
          sunNy = pny;
          sunNz = pnz;
          basePixCol = shadeByNormal(shape.baseColor, pnx, pny, pnz, true, shape.shadeContrast, shape.roofColor);
          if (texNeedsShade) {
            pixShadeFactor = computeFaceTextureShadeFactor(pnx, pny, pnz, true, shape.shadeContrast);
          }
        }

        let col = basePixCol;
        if (!isFlatUp && useWallPattern) {
          const sVal = w0 * uA + w1 * uB + w2 * uC;
          const tVal = w0 * vA + w1 * vB + w2 * vC;
          const uPanel = isPoly ? sVal : sVal * 4 - Math.floor(sVal * 4);
          const wx = Math.floor(clamp(uPanel, 0, 0.9999) * curPanelW);
          const wy = Math.floor((1 - clamp(tVal, 0, 1)) * wallH);
          col = sampleWallPattern(wx, wy, curPanelW, wallH, shape.pattern, basePixCol, isPoly ? 'left' : 'curve');
        } else if (isFlatUp && useTopPattern) {
          const dx = scx - originX;
          const dy = scy + vz - originY;
          const pu = dx / 32 + dy / 16;
          const pv = dy / 16 - dx / 32;
          const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
          const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
          const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
          col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, triad.top, shape.pattern);
        }

        if (activeTexSlot) {
          if (!isFlatUp && polyFaceTex) {
            const sVal = w0 * uA + w1 * uB + w2 * uC;
            const tVal = w0 * vA + w1 * vB + w2 * vC;
            let effFaceW = polyFaceTex.faceW;
            if (activeTexSlot.mode === 'tile' && spanBotW !== undefined && spanTopW !== undefined) {
              const fSpan = spanDt > 1e-5 ? clamp((tVal - spanT0) / spanDt, 0, 1) : 0;
              effFaceW = Math.max(1, Math.round(spanBotW + (spanTopW - spanBotW) * fSpan));
            }
            const texCol = sampleFaceTextureRGBA(
              activeTexSlot,
              1 - sVal,
              flipZ ? tVal : 1 - tVal,
              effFaceW,
              polyFaceTex.faceH,
            );
            if (texCol) col = compositeFaceTexelOverBase(col, texCol, pixShadeFactor);
          } else if (isFlatUp && topFaceSpec) {
            const dx = scx - originX;
            const dy = scy + vz - originY;
            const pu = dx / 32 + dy / 16;
            const pv = dy / 16 - dx / 32;
            const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
            const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
            const loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
            const texCol = sampleFaceTextureRGBA(activeTexSlot, loc.luFrac, loc.lvFrac, topFaceSpec.faceW, topFaceSpec.faceH);
            if (texCol) col = compositeFaceTexelOverBase(col, texCol, pixShadeFactor);
          }
        }

        const di = idx * 4;
        tmpBuf[di] = col.r;
        tmpBuf[di + 1] = col.g;
        tmpBuf[di + 2] = col.b;
        tmpBuf[di + 3] = 255;
        zDepth[idx] = vz;
        faceTag[idx] = isFlatUp ? 2 : 1;
        edgeTag[idx] = isFlatUp ? 0 : wallEdgeId;
        if (tmpSun) tmpSun[idx] = isFlatUp ? 2 : classifySunFacingMetricNormal(sunNx, sunNy, sunNz);
      }
    }
  };

  const colCornerNormals = shape.autoShade
    ? computeRingGridCornerNormals(ringsView, false, false, !isPoly, true)
    : null;

  for (let r = 0; r < numRings - 1; r++) {
    const t0 = rings[r].t;
    const t1 = rings[r + 1].t;
    const lBot = rings[r].pts;
    const lTop = rings[r + 1].pts;
    const vBot = ringsView[r];
    const vTop = ringsView[r + 1];
    const sBot = ringsScreen[r];
    const sTop = ringsScreen[r + 1];
    const rowOff = r * vertCount;
    for (let j = 0; j < vertCount; j++) {
      const jn = (j + 1) % vertCount;
      const s0 = isPoly ? 0 : j / vertCount;
      const s1 = isPoly ? 1 : (j + 1) / vertCount;
      const spanBotW = isPoly
        ? Math.max(1, Math.round(Math.hypot((lBot[jn][0] - lBot[j][0]) * localSu * 16, (lBot[jn][1] - lBot[j][1]) * localSv * 16)))
        : cylPanelW;
      const spanTopW = isPoly
        ? Math.max(1, Math.round(Math.hypot((lTop[jn][0] - lTop[j][0]) * localSu * 16, (lTop[jn][1] - lTop[j][1]) * localSv * 16)))
        : cylPanelW;
      const curPanelW = isPoly
        ? Math.max(
            4,
            Math.round(
              Math.hypot((vBot[jn].x - vBot[j].x) * 32, (vBot[jn].y - vBot[j].y) * 32),
            ),
          )
        : cylPanelW;

      let sharedNormal: [number, number, number] | undefined;
      if (isPoly) {
        // Compute averaged quad normal so skewed flat walls never show a diagonal shade split
        const ax = (vBot[jn].x - vBot[j].x) * 18;
        const ay = (vBot[jn].y - vBot[j].y) * 18;
        const az = vBot[jn].z - vBot[j].z;
        const bx = (vTop[j].x - vBot[j].x) * 18;
        const by = (vTop[j].y - vBot[j].y) * 18;
        const bz = vTop[j].z - vBot[j].z;
        const cx = (vTop[jn].x - vBot[j].x) * 18;
        const cy = (vTop[jn].y - vBot[j].y) * 18;
        const cz = vTop[jn].z - vBot[j].z;
        const n1x = ay * cz - az * cy;
        const n1y = az * cx - ax * cz;
        const n1z = ax * cy - ay * cx;
        const n2x = cy * bz - cz * by;
        const n2y = cz * bx - cx * bz;
        const n2z = cx * by - cy * bx;
        sharedNormal = [n1x + n2x, n1y + n2y, n1z + n2z];
      }

      const wallEdgeId = isPoly ? j + 1 : 0;
      const cnOff = (rowOff + j) * 12;
      rasterTri(
        vBot[j], sBot[j], s0, t0,
        vBot[jn], sBot[jn], s1, t0,
        vTop[jn], sTop[jn], s1, t1,
        curPanelW,
        wallEdgeId,
        sharedNormal,
        spanBotW,
        spanTopW,
        t0,
        t1,
        colCornerNormals,
        cnOff, cnOff + 3, cnOff + 6,
      );
      rasterTri(
        vBot[j], sBot[j], s0, t0,
        vTop[jn], sTop[jn], s1, t1,
        vTop[j], sTop[j], s0, t1,
        curPanelW,
        wallEdgeId,
        sharedNormal,
        spanBotW,
        spanTopW,
        t0,
        t1,
        colCornerNormals,
        cnOff, cnOff + 6, cnOff + 9,
      );
    }
  }

  // Planar cap scanline fill helper (handles top cap and, when tilted, bottom cap too)
  const rasterColCap = (
    capPoly: [number, number][],
    zLocalPlane: number,
    nLocalZ: 1 | -1,
    capTexSlot: FaceTextureSlot | undefined,
    capFaceSpec: PlanarFaceSpec | undefined,
  ) => {
    let capCol = triad.top;
    let capSunBit: 0 | 1 | 2 = 2;
    let capShadeFactor = capTexSlot && capTexSlot.mode !== 'none'
      ? (capTexSlot.shadeWithFace !== false
          ? computeFaceTextureShadeFactor(0, 0, nLocalZ, shape.autoShade, shape.shadeContrast)
          : 1)
      : 1;
    let p0z = zLocalPlane, dz1 = 0, dz2 = 0;
    let s0x = 0, s0y = 0, dux = 1, duy = 0, dvx = 0, dvy = 1, invDet = 0;
    let useTiltedPlane = false;

    if (tilt) {
      const [nxV, nyV, nzV] = tiltNormalToView(0, 0, nLocalZ, tilt);
      if (nxV * 18 + nyV * 18 + nzV * 16 <= 1e-3) return;
      const P0 = transformLocalPointWithTilt(0, 0, zLocalPlane, tilt);
      const P1 = transformLocalPointWithTilt(1, 0, zLocalPlane, tilt);
      const P2 = transformLocalPointWithTilt(0, 1, zLocalPlane, tilt);
      const S0 = isoToScreenPx(P0.x, P0.y, P0.z, originX, originY);
      const S1 = isoToScreenPx(P1.x, P1.y, P1.z, originX, originY);
      const S2 = isoToScreenPx(P2.x, P2.y, P2.z, originX, originY);
      s0x = S0[0]; s0y = S0[1];
      dux = S1[0] - s0x; duy = S1[1] - s0y;
      dvx = S2[0] - s0x; dvy = S2[1] - s0y;
      const det = dux * dvy - duy * dvx;
      if (Math.abs(det) < 1e-5) return;
      invDet = 1 / det;
      p0z = P0.z;
      dz1 = P1.z - P0.z;
      dz2 = P2.z - P0.z;
      useTiltedPlane = true;

      const isTopFlat = Math.abs(nxV) < 1e-4 && Math.abs(nyV) < 1e-4 && nzV > 0;
      const isLeftPure = Math.abs(nxV) < 1e-4 && nyV > 0 && Math.abs(nzV) < 1e-4;
      const isRightPure = nxV > 0 && Math.abs(nyV) < 1e-4 && Math.abs(nzV) < 1e-4;
      if (isTopFlat) capCol = triad.top;
      else if (isLeftPure) capCol = triad.left;
      else if (isRightPure) capCol = triad.right;
      else {
        capCol = shadeByNormal(
          shape.baseColor,
          nxV,
          nyV,
          nzV,
          shape.autoShade,
          shape.shadeContrast,
          nLocalZ > 0 ? shape.roofColor : null,
        );
      }
      capSunBit = classifySunFacingMetricNormal(nxV, nyV, nzV);
      capShadeFactor = capTexSlot && capTexSlot.mode !== 'none'
        ? (capTexSlot.shadeWithFace !== false
            ? computeFaceTextureShadeFactor(nxV, nyV, nzV, shape.autoShade, shape.shadeContrast)
            : 1)
        : 1;
    }

    let capMinY = Infinity, capMaxY = -Infinity;
    for (const [, sy] of capPoly) {
      if (sy < capMinY) capMinY = sy;
      if (sy > capMaxY) capMaxY = sy;
    }
    const scanStartY = Math.max(bMinY, Math.floor(capMinY));
    const scanEndY = Math.min(bMaxY, Math.ceil(capMaxY));
    const crossings: { x: number; dir: number }[] = [];
    for (let py = scanStartY; py <= scanEndY; py++) {
      const scy = py + 0.5;
      crossings.length = 0;
      for (let j = 0; j < vertCount; j++) {
        const [ax, ay] = capPoly[j];
        const [bx, by] = capPoly[(j + 1) % vertCount];
        if (ay <= scy && by > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
        } else if (by <= scy && ay > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((p, q) => p.x - q.x);
      const ly = py - bMinY;
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k].dir;
        if (winding === 0) continue;
        const xStart = Math.max(bMinX, Math.ceil(crossings[k].x - 0.5));
        const xEnd = Math.min(bMaxX, Math.floor(crossings[k + 1].x - 0.5));
        for (let px = xStart; px <= xEnd; px++) {
          const idx = ly * bw + (px - bMinX);
          let zCap = zLocalPlane;
          let locLu = 0, locLv = 0;
          if (useTiltedPlane) {
            const rx = px + 0.5 - s0x;
            const ry = scy - s0y;
            locLu = (rx * dvy - ry * dvx) * invDet;
            locLv = (dux * ry - duy * rx) * invDet;
            zCap = p0z + locLu * dz1 + locLv * dz2;
          }
          if (zCap < zDepth[idx] - 1e-3) continue;

          let col = capCol;
          let loc: { luFrac: number; lvFrac: number; lsu: number; lsv: number } | null = null;
          if (useTopPattern || (capTexSlot && capTexSlot.mode !== 'none' && capFaceSpec)) {
            if (useTiltedPlane) {
              loc = { luFrac: clamp(locLu, 0, 1), lvFrac: clamp(locLv, 0, 1), lsu: localSu, lsv: localSv };
            } else {
              const dx = px + 0.5 - originX;
              const dy = scy + zCap - originY;
              const pu = dx / 32 + dy / 16;
              const pv = dy / 16 - dx / 32;
              const uFrac = clamp((pu - u0) / Math.max(1e-4, su), 0, 1);
              const vFrac = clamp((pv - v0) / Math.max(1e-4, sv), 0, 1);
              loc = viewFracToLocal(uFrac, vFrac, viewOri, su, sv);
            }
            if (useTopPattern) {
              col = sampleTopGridColor(loc.luFrac, loc.lvFrac, loc.lsu, loc.lsv, capCol, shape.pattern);
            }
          }
          if (loc && capTexSlot && capTexSlot.mode !== 'none' && capFaceSpec) {
            const texCol = sampleFaceTextureRGBA(capTexSlot, loc.luFrac, loc.lvFrac, capFaceSpec.faceW, capFaceSpec.faceH);
            if (texCol) col = compositeFaceTexelOverBase(col, texCol, capShadeFactor);
          }
          const di = idx * 4;
          tmpBuf[di] = col.r;
          tmpBuf[di + 1] = col.g;
          tmpBuf[di + 2] = col.b;
          tmpBuf[di + 3] = 255;
          zDepth[idx] = zCap;
          faceTag[idx] = 2;
          edgeTag[idx] = 0;
          if (tmpSun) tmpSun[idx] = capSunBit;
        }
      }
    }
  };

  const zTopCap = z0 + rings[numRings - 1].t * (z1 - z0);
  rasterColCap(ringsScreen[numRings - 1], zTopCap, 1, topTexSlot, topFaceSpec);
  if (tilt) {
    const zBotCap = z0 + rings[0].t * (z1 - z0);
    const botTexSlot = faceSpecMap ? shape.faceTextures?.bottom : undefined;
    const botFaceSpec = faceSpecMap?.get('bottom');
    rasterColCap(ringsScreen[0], zBotCap, -1, botTexSlot, botFaceSpec);
  }

  // Front top-rim highlight
  if (shape.edgeHighlight) {
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        if (faceTag[idx] !== 2) continue;
        const nearWall = tilt
          ? (ly + 1 < bh && faceTag[idx + bw] === 1) ||
            (ly > 0 && faceTag[idx - bw] === 1) ||
            (lx + 1 < bw && faceTag[idx + 1] === 1) ||
            (lx > 0 && faceTag[idx - 1] === 1)
          : ly + 1 < bh && faceTag[idx + bw] === 1;
        if (nearWall) {
          const di = idx * 4;
          tmpBuf[di] = triad.highlight.r;
          tmpBuf[di + 1] = triad.highlight.g;
          tmpBuf[di + 2] = triad.highlight.b;
          tmpBuf[di + 3] = 255;
        }
      }
    }
  }

  // Optional 1px outline & polygonal crease edges
  if (shape.outlineMode !== 'none') {
    const luma = (idx: number) => {
      const di = idx * 4;
      return tmpBuf[di] * 299 + tmpBuf[di + 1] * 587 + tmpBuf[di + 2] * 114;
    };
    const isCreaseArr = shape.outlineMode === 'all_edges' ? new Uint8Array(bw * bh) : null;
    if (isCreaseArr) {
      for (let ly = 0; ly < bh; ly++) {
        for (let lx = 0; lx < bw; lx++) {
          const idx = ly * bw + lx;
          if (!faceTag[idx]) continue;
          if (faceTag[idx] === 2 && ly + 1 < bh && faceTag[idx + bw] === 1) {
            isCreaseArr[idx] = 1;
            continue;
          }
          if (isPoly && faceTag[idx] === 1 && edgeTag[idx] > 0) {
            const myLuma = luma(idx);
            const rightDiff =
              lx + 1 < bw &&
              faceTag[idx + 1] === 1 &&
              edgeTag[idx + 1] > 0 &&
              edgeTag[idx + 1] !== edgeTag[idx] &&
              myLuma > luma(idx + 1);
            const leftDiff =
              lx > 0 &&
              faceTag[idx - 1] === 1 &&
              edgeTag[idx - 1] > 0 &&
              edgeTag[idx - 1] !== edgeTag[idx] &&
              myLuma >= luma(idx - 1);
            if (rightDiff || leftDiff) {
              isCreaseArr[idx] = 1;
            }
          }
        }
      }
    }
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const idx = ly * bw + lx;
        if (!faceTag[idx]) continue;
        const isOuter =
          lx === 0 ||
          ly === 0 ||
          lx === bw - 1 ||
          ly === bh - 1 ||
          !faceTag[idx - 1] ||
          !faceTag[idx + 1] ||
          !faceTag[idx - bw] ||
          !faceTag[idx + bw];
        if (isOuter || (isCreaseArr && isCreaseArr[idx])) {
          const di = idx * 4;
          tmpBuf[di] = triad.outline.r;
          tmpBuf[di + 1] = triad.outline.g;
          tmpBuf[di + 2] = triad.outline.b;
          tmpBuf[di + 3] = 255;
        }
      }
    }
  }

  const pyStart = Math.max(0, bMinY);
  const pyEnd = Math.min(h - 1, bMaxY);
  const pxStart = Math.max(0, bMinX);
  const pxEnd = Math.min(w - 1, bMaxX);
  for (let py = pyStart; py <= pyEnd; py++) {
    const ly = py - bMinY;
    for (let px = pxStart; px <= pxEnd; px++) {
      const li = ly * bw + (px - bMinX);
      const si = li * 4;
      if (tmpBuf[si + 3] > 0) {
        const di = (py * w + px) * 4;
        dst[di] = tmpBuf[si];
        dst[di + 1] = tmpBuf[si + 1];
        dst[di + 2] = tmpBuf[si + 2];
        dst[di + 3] = 255;
        if (activeRenderAux && tmpSun) {
          const pIdx = py * w + px;
          activeRenderAux.zData[pIdx] = zDepth[li];
          activeRenderAux.sunFacing[pIdx] = tmpSun[li];
        }
      }
    }
  }
}

export function renderShapeToBuffer(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  shape: ParametricShape,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
  originX: number,
  originY: number,
  shadeSteps = 0,
  aux: ShapeRenderAuxBuffers | null = null,
) {
  const prevShadeSteps = activeShadeSteps;
  const prevRenderAux = activeRenderAux;
  activeShadeSteps = normalizeShadeSteps(shadeSteps);
  activeRenderAux = aux;
  try {
    renderShapeToBufferInner(dst, w, h, shape, plotU, plotV, rot, originX, originY);
  } finally {
    activeShadeSteps = prevShadeSteps;
    activeRenderAux = prevRenderAux;
  }
}

function renderShapeToBufferInner(
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  shape: ParametricShape,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
  originX: number,
  originY: number,
) {
  const vb = worldBoxToView(
    shape.u,
    shape.v,
    Math.max(0.0625, shape.sizeU),
    Math.max(0.0625, shape.sizeV),
    normalizeRotation(shape.ori),
    plotU,
    plotV,
    rot,
  );
  const u0 = vb.u;
  const v0 = vb.v;
  const su = vb.sizeU;
  const sv = vb.sizeV;
  const z0 = Math.round(shape.zPx);
  const heightPx = Math.max(0, Math.round(shape.heightPx));
  const z1 = z0 + heightPx;

  if (shape.shapeType === 'theotown_base') {
    const bsu = Math.max(1, Math.round(su));
    const bsv = Math.max(1, Math.round(sv));
    const [topX, topY] = isoToScreenPx(u0, v0, z0, originX, originY);
    stampIsoBaseToBuffer(dst, w, h, Math.round(topX) - 16, Math.round(topY), bsu, bsv);
    return;
  }

  if (heightPx <= 0) return;

  const triad = buildShadingTriad(shape);
  const flipZ = Boolean(shape.flipZ);
  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(u0, v0, su, sv, z0, z1, vb.ori, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;

  switch (shape.shapeType) {
    case 'box': {
      if (hasActiveColumnSections(shape)) {
        renderMultiSectionColumn(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
        break;
      }
      const rawFaces = buildBoxFaces(u0, v0, su, sv, z0, z1, vb.ori, flipZ, Boolean(tilt));
      const faces = tilt ? tiltMeshFaces(rawFaces, tilt) : rawFaces;
      renderConvexMesh(dst, w, h, faces, shape, triad, originX, originY, u0, v0, su, sv, vb.ori);
      break;
    }
    case 'right_tri_prism': {
      if (hasActiveColumnSections(shape)) {
        renderMultiSectionColumn(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
        break;
      }
      const rawFaces = buildRightTriPrismFaces(u0, v0, su, sv, z0, z1, vb.ori, shape.triPrismCut ?? 'vertical', flipZ, Boolean(tilt));
      const faces = tilt ? tiltMeshFaces(rawFaces, tilt) : rawFaces;
      renderConvexMesh(dst, w, h, faces, shape, triad, originX, originY, u0, v0, su, sv, vb.ori);
      break;
    }
    case 'arch': {
      renderArch(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
      break;
    }
    case 'prism': {
      if (hasActiveColumnSections(shape)) {
        renderMultiSectionColumn(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
        break;
      }
      const rawFaces = buildPrismFaces(u0, v0, su, sv, z0, z1, shape.prismSides, vb.ori, flipZ, Boolean(tilt));
      const faces = tilt ? tiltMeshFaces(rawFaces, tilt) : rawFaces;
      renderConvexMesh(dst, w, h, faces, shape, triad, originX, originY, u0, v0, su, sv, vb.ori);
      break;
    }
    case 'wedge': {
      const rawFaces = buildWedgeFaces(u0, v0, su, sv, z0, z1, vb.ori, shape.wedgeMode, flipZ, Boolean(tilt));
      const faces = tilt ? tiltMeshFaces(rawFaces, tilt) : rawFaces;
      renderConvexMesh(dst, w, h, faces, shape, triad, originX, originY, u0, v0, su, sv, vb.ori);
      break;
    }
    case 'pyramid': {
      const rawFaces = buildPyramidFaces(u0, v0, su, sv, z0, z1, vb.ori, flipZ, Boolean(tilt));
      const faces = tilt ? tiltMeshFaces(rawFaces, tilt) : rawFaces;
      renderConvexMesh(dst, w, h, faces, shape, triad, originX, originY, u0, v0, su, sv, vb.ori);
      break;
    }
    case 'cylinder': {
      if (hasActiveColumnSections(shape)) {
        renderMultiSectionColumn(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
        break;
      }
      if (tilt) {
        renderTiltedAnalyticalPrimitive(dst, w, h, 'cylinder', tilt, shape, triad, originX, originY);
      } else {
        renderCylinder(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
      }
      break;
    }
    case 'loft': {
      renderLoftColumn(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
      break;
    }
    case 'cone': {
      if (tilt) {
        renderTiltedAnalyticalPrimitive(dst, w, h, 'cone', tilt, shape, triad, originX, originY);
      } else {
        renderCone(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
      }
      break;
    }
    case 'dome':
    case 'sphere': {
      if (tilt) {
        const isSphere = shape.shapeType === 'sphere' || shape.domeMode === 'sphere';
        renderTiltedAnalyticalPrimitive(dst, w, h, isSphere ? 'sphere' : 'dome', tilt, shape, triad, originX, originY);
      } else {
        renderDomeOrSphere(dst, w, h, u0, v0, su, sv, z0, z1, shape, triad, originX, originY, vb.ori);
      }
      break;
    }
  }
}

export interface TiltedViewBounds3D {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  minZ: number;
  maxZ: number;
  /** Tight 3D vertices representing the shape's rotated envelope (for ground projection hull & depth sorting) */
  points3D: Vec3[];
}

export function getShapeTiltedViewBounds(
  shape: ParametricShape,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
): TiltedViewBounds3D {
  const vb = worldBoxToView(
    shape.u,
    shape.v,
    shape.shapeType === 'theotown_base' ? Math.max(1, Math.round(shape.sizeU)) : Math.max(0.0625, shape.sizeU),
    shape.shapeType === 'theotown_base' ? Math.max(1, Math.round(shape.sizeV)) : Math.max(0.0625, shape.sizeV),
    normalizeRotation(shape.ori),
    plotU,
    plotV,
    rot,
  );
  const su = vb.sizeU;
  const sv = vb.sizeV;
  const z0 = Math.round(shape.zPx);
  const z1 = z0 + Math.max(0, Math.round(shape.heightPx));

  let lu0 = 0, lu1 = 1, lv0 = 0, lv1 = 1;
  if (shape.shapeType === 'loft') {
    const lb = getLoftLocalBounds(shape.loftSections, shape.loftInterp ?? 'smooth');
    lu0 = Math.min(0, lb.minU);
    lu1 = Math.max(1, lb.maxU);
    lv0 = Math.min(0, lb.minV);
    lv1 = Math.max(1, lb.maxV);
  } else if (hasActiveColumnSections(shape)) {
    const lb = getColumnLocalBounds(shape);
    lu0 = Math.min(0, lb.minU);
    lu1 = Math.max(1, lb.maxU);
    lv0 = Math.min(0, lb.minV);
    lv1 = Math.max(1, lb.maxV);
  }

  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(vb.u, vb.v, su, sv, z0, z1, vb.ori, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;

  const toPt = (lu: number, lv: number, z: number): Vec3 =>
    tilt
      ? transformLocalPointWithTilt(lu, lv, z, tilt)
      : transformLocalToViewPoint(lu, lv, z, vb.u, vb.v, su, sv, vb.ori);

  const points3D: Vec3[] = [];
  const flipZ = Boolean(shape.flipZ);

  if (!tilt || shape.shapeType === 'theotown_base') {
    for (const zc of [z0, z1]) {
      points3D.push(toPt(lu0, lv0, zc), toPt(lu1, lv0, zc), toPt(lu1, lv1, zc), toPt(lu0, lv1, zc));
    }
  } else if (shape.shapeType === 'box' && !hasActiveColumnSections(shape)) {
    for (const zc of [z0, z1]) {
      points3D.push(toPt(0, 0, zc), toPt(1, 0, zc), toPt(1, 1, zc), toPt(0, 1, zc));
    }
  } else if (shape.shapeType === 'right_tri_prism' && !hasActiveColumnSections(shape)) {
    const faces = tiltMeshFaces(
      buildRightTriPrismFaces(vb.u, vb.v, su, sv, z0, z1, vb.ori, shape.triPrismCut ?? 'vertical', flipZ, true),
      tilt,
    );
    for (const f of faces) for (const pt of f.verts) points3D.push(pt);
  } else if (shape.shapeType === 'prism' && !hasActiveColumnSections(shape)) {
    const faces = tiltMeshFaces(buildPrismFaces(vb.u, vb.v, su, sv, z0, z1, shape.prismSides, vb.ori, flipZ, true), tilt);
    for (const f of faces) for (const pt of f.verts) points3D.push(pt);
  } else if (shape.shapeType === 'wedge') {
    const faces = tiltMeshFaces(buildWedgeFaces(vb.u, vb.v, su, sv, z0, z1, vb.ori, shape.wedgeMode, flipZ, true), tilt);
    for (const f of faces) for (const pt of f.verts) points3D.push(pt);
  } else if (shape.shapeType === 'pyramid') {
    const faces = tiltMeshFaces(buildPyramidFaces(vb.u, vb.v, su, sv, z0, z1, vb.ori, flipZ, true), tilt);
    for (const f of faces) for (const pt of f.verts) points3D.push(pt);
  } else if (shape.shapeType === 'cylinder' && !hasActiveColumnSections(shape)) {
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI * 2) / 24;
      const lu = 0.5 + Math.cos(a) * 0.5;
      const lv = 0.5 + Math.sin(a) * 0.5;
      points3D.push(toPt(lu, lv, z0), toPt(lu, lv, z1));
    }
  } else if (shape.shapeType === 'cone') {
    const zBase = flipZ ? z1 : z0;
    const zApex = flipZ ? z0 : z1;
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI * 2) / 24;
      points3D.push(toPt(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, zBase));
    }
    points3D.push(toPt(0.5, 0.5, zApex));
  } else if (shape.shapeType === 'sphere' || (shape.shapeType === 'dome' && shape.domeMode === 'sphere')) {
    const totalH = Math.max(1, z1 - z0);
    const zMid = z0 + totalH * 0.5;
    const rz = totalH * 0.5;
    for (let j = 0; j <= 8; j++) {
      const phi = -Math.PI * 0.5 + (j / 8) * Math.PI;
      const cPhi = Math.cos(phi);
      const zc = zMid + Math.sin(phi) * rz;
      const nAz = j === 0 || j === 8 ? 1 : 16;
      for (let i = 0; i < nAz; i++) {
        const a = (i * Math.PI * 2) / nAz;
        points3D.push(toPt(0.5 + Math.cos(a) * 0.5 * cPhi, 0.5 + Math.sin(a) * 0.5 * cPhi, zc));
      }
    }
  } else if (shape.shapeType === 'dome') {
    const totalH = Math.max(1, z1 - z0);
    const zPlane = flipZ ? z1 : z0;
    const signZ = flipZ ? -1 : 1;
    for (let j = 0; j <= 6; j++) {
      const phi = (j / 6) * Math.PI * 0.5;
      const cPhi = Math.cos(phi);
      const zc = zPlane + signZ * Math.sin(phi) * totalH;
      const nAz = j === 6 ? 1 : 16;
      for (let i = 0; i < nAz; i++) {
        const a = (i * Math.PI * 2) / nAz;
        points3D.push(toPt(0.5 + Math.cos(a) * 0.5 * cPhi, 0.5 + Math.sin(a) * 0.5 * cPhi, zc));
      }
    }
  } else if (shape.shapeType === 'arch') {
    const spanCells = vb.ori % 2 === 1 ? sv : su;
    const cs = buildArchCrossSection({
      outerNodes: shape.archNodes,
      hollow: shape.archHollow ?? false,
      hollowStyle: shape.archHollowStyle ?? 'shell',
      innerMode: shape.archInnerMode ?? 'parallel',
      thickness: shape.archThickness ?? 0.28,
      innerNodes: shape.archInnerNodes,
      spanMetric: Math.max(4, spanCells * 18),
      heightMetric: Math.max(4, z1 - z0),
      sampleCount: 18,
    });
    for (const [s, hFrac] of cs.poly) {
      const zc = z0 + (flipZ ? 1 - hFrac : hFrac) * (z1 - z0);
      points3D.push(toPt(s, 0, zc), toPt(s, 1, zc));
    }
  } else if (shape.shapeType === 'loft') {
    const rawLoft = buildAlignedLoftRings(
      normalizeLoftSections(shape.loftSections),
      24,
      16,
      shape.loftInterp ?? 'smooth',
      false,
      tilt.lsu,
      tilt.lsv,
      0,
    );
    for (const ring of rawLoft.rings) {
      const zc = z0 + (flipZ ? 1 - ring.t : ring.t) * (z1 - z0);
      for (const [lu, lv] of ring.pts) points3D.push(toPt(lu, lv, zc));
    }
  } else if (hasActiveColumnSections(shape)) {
    const rawRings = buildColumnRings(shape, 16, 24);
    for (const ring of rawRings) {
      const zc = z0 + (flipZ ? 1 - ring.t : ring.t) * (z1 - z0);
      for (const [lu, lv] of ring.pts) points3D.push(toPt(lu, lv, zc));
    }
  } else {
    for (const zc of [z0, z1]) {
      points3D.push(toPt(lu0, lv0, zc), toPt(lu1, lv0, zc), toPt(lu1, lv1, zc), toPt(lu0, lv1, zc));
    }
  }

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const pt of points3D) {
    if (pt.x < minU) minU = pt.x;
    if (pt.x > maxU) maxU = pt.x;
    if (pt.y < minV) minV = pt.y;
    if (pt.y > maxV) maxV = pt.y;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }
  if (!Number.isFinite(minZ)) {
    minU = vb.u; maxU = vb.u + su;
    minV = vb.v; maxV = vb.v + sv;
    minZ = z0; maxZ = z1;
  }
  // Exact analytical Z bounds for tilted analytical primitives so grounding & stacking are sub-pixel exact
  if (tilt && (shape.shapeType === 'sphere' || (shape.shapeType === 'dome' && shape.domeMode === 'sphere'))) {
    const rx = Math.max(0.5, tilt.lsu * METRIC_PX_PER_CELL * 0.5);
    const ry = Math.max(0.5, tilt.lsv * METRIC_PX_PER_CELL * 0.5);
    const rz = Math.max(0.5, (z1 - z0) * 0.5);
    const zMidLoc = (z0 + z1) * 0.5 - tilt.czView;
    const zCent = tilt.czOut + tilt.m22 * zMidLoc;
    const zHalf = Math.hypot(tilt.m20 * rx, tilt.m21 * ry, tilt.m22 * rz);
    minZ = zCent - zHalf;
    maxZ = zCent + zHalf;
  } else if (tilt && shape.shapeType === 'cylinder' && !hasActiveColumnSections(shape)) {
    const rx = Math.max(0.5, tilt.lsu * METRIC_PX_PER_CELL * 0.5);
    const ry = Math.max(0.5, tilt.lsv * METRIC_PX_PER_CELL * 0.5);
    const zBotV = tilt.czOut + tilt.m22 * (z0 - tilt.czView);
    const zTopV = tilt.czOut + tilt.m22 * (z1 - tilt.czView);
    const capHalf = Math.hypot(tilt.m20 * rx, tilt.m21 * ry);
    minZ = Math.min(zBotV, zTopV) - capHalf;
    maxZ = Math.max(zBotV, zTopV) + capHalf;
  } else if (tilt && shape.shapeType === 'cone') {
    const rx = Math.max(0.5, tilt.lsu * METRIC_PX_PER_CELL * 0.5);
    const ry = Math.max(0.5, tilt.lsv * METRIC_PX_PER_CELL * 0.5);
    const zBaseV = tilt.czOut + tilt.m22 * ((flipZ ? z1 : z0) - tilt.czView);
    const zApexV = tilt.czOut + tilt.m22 * ((flipZ ? z0 : z1) - tilt.czView);
    const capHalf = Math.hypot(tilt.m20 * rx, tilt.m21 * ry);
    minZ = Math.min(zBaseV - capHalf, zApexV);
    maxZ = Math.max(zBaseV + capHalf, zApexV);
  } else if (tilt && shape.shapeType === 'dome') {
    const rx = Math.max(0.5, tilt.lsu * METRIC_PX_PER_CELL * 0.5);
    const ry = Math.max(0.5, tilt.lsv * METRIC_PX_PER_CELL * 0.5);
    const rz = Math.max(0.5, z1 - z0);
    const zPlaneLoc = (flipZ ? z1 : z0) - tilt.czView;
    const signZ = flipZ ? -1 : 1;
    const zPlaneV = tilt.czOut + tilt.m22 * zPlaneLoc;
    const a = tilt.m20 * rx;
    const b = tilt.m21 * ry;
    const c = tilt.m22 * signZ * rz;
    minZ = zPlaneV - (c < 0 ? Math.hypot(a, b, c) : Math.hypot(a, b));
    maxZ = zPlaneV + (c > 0 ? Math.hypot(a, b, c) : Math.hypot(a, b));
  }
  return { minU, maxU, minV, maxV, minZ, maxZ, points3D };
}

export function getShapeTiltedZRange(shape: ParametricShape): { minZ: number; maxZ: number } {
  const b = getShapeTiltedViewBounds(shape, 4, 4, 0);
  return { minZ: b.minZ, maxZ: b.maxZ };
}

/**
 * Computes the shape.zPx required so that the shape's actual rendered lowest point (`minZ`)
 * sits cleanly at (or within <1px above, never below) `targetMinZ`.
 */
export function computeZPxForTargetMinZ(shape: ParametricShape, targetMinZ: number): number {
  if (!hasActiveTilt(shape)) {
    return clamp(Math.round(targetMinZ), 0, 1024);
  }
  const { minZ } = getShapeTiltedZRange(shape);
  const nextZ = Math.ceil(shape.zPx + (targetMinZ - minZ) - 1e-4);
  return clamp(nextZ, -512, 1024);
}

export function getShapeScreenBounds(
  shape: ParametricShape,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
  originX: number,
  originY: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const vb = worldBoxToView(shape.u, shape.v, shape.sizeU, shape.sizeV, shape.ori, plotU, plotV, rot);
  const su = shape.shapeType === 'theotown_base' ? Math.max(1, Math.round(vb.sizeU)) : Math.max(0.0625, vb.sizeU);
  const sv = shape.shapeType === 'theotown_base' ? Math.max(1, Math.round(vb.sizeV)) : Math.max(0.0625, vb.sizeV);
  const z0 = Math.round(shape.zPx);
  const z1 = z0 + Math.max(0, Math.round(shape.heightPx));
  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(vb.u, vb.v, su, sv, z0, z1, vb.ori, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (sx: number, sy: number) => {
    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
  };
  const toPt = (lu: number, lv: number, z: number): Vec3 =>
    tilt
      ? transformLocalPointWithTilt(lu, lv, z, tilt)
      : transformLocalToViewPoint(lu, lv, z, vb.u, vb.v, su, sv, vb.ori);

  for (const zc of [z0, z1]) {
    for (const [lu, lv] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const pt = toPt(lu, lv, zc);
      const [sx, sy] = isoToScreenPx(pt.x, pt.y, pt.z, originX, originY);
      expand(sx, sy);
    }
  }
  if (
    !tilt &&
    (shape.shapeType === 'cylinder' ||
      shape.shapeType === 'cone' ||
      shape.shapeType === 'dome' ||
      shape.shapeType === 'sphere')
  ) {
    const ru = su * 0.5;
    const rv = sv * 0.5;
    const [cx, cyBot] = isoToScreenPx(vb.u + ru, vb.v + rv, z0, originX, originY);
    const [, cyTop] = isoToScreenPx(vb.u + ru, vb.v + rv, z1, originX, originY);
    const rxScreen = 16 * Math.hypot(ru, rv) + 3;
    const ryScreen = 8 * Math.hypot(ru, rv) + 3;
    minX = Math.min(minX, cx - rxScreen);
    maxX = Math.max(maxX, cx + rxScreen);
    minY = Math.min(minY, cyTop - ryScreen);
    maxY = Math.max(maxY, cyBot + ryScreen);
  }
  if (shape.shapeType === 'loft') {
    const localBounds = getLoftLocalBounds(shape.loftSections, shape.loftInterp ?? 'smooth');
    const lu0 = Math.min(0, localBounds.minU) - 0.06;
    const lu1 = Math.max(1, localBounds.maxU) + 0.06;
    const lv0 = Math.min(0, localBounds.minV) - 0.06;
    const lv1 = Math.max(1, localBounds.maxV) + 0.06;
    for (const zc of [z0, z1]) {
      for (const [lu, lv] of [
        [lu0, lv0],
        [lu1, lv0],
        [lu1, lv1],
        [lu0, lv1],
      ]) {
        const pt3 = toPt(lu, lv, zc);
        const [sx, sy] = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
        expand(sx, sy);
      }
    }
  } else if (hasActiveColumnSections(shape)) {
    const localBounds = getColumnLocalBounds(shape);
    const lu0 = Math.min(0, localBounds.minU) - 0.06;
    const lu1 = Math.max(1, localBounds.maxU) + 0.06;
    const lv0 = Math.min(0, localBounds.minV) - 0.06;
    const lv1 = Math.max(1, localBounds.maxV) + 0.06;
    for (const zc of [z0, z1]) {
      for (const [lu, lv] of [
        [lu0, lv0],
        [lu1, lv0],
        [lu1, lv1],
        [lu0, lv1],
      ]) {
        const pt3 = toPt(lu, lv, zc);
        const [sx, sy] = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
        expand(sx, sy);
      }
    }
  }
  if (tilt) {
    minX -= 2;
    minY -= 2;
    maxX += 2;
    maxY += 2;
  }
  return { minX, minY, maxX, maxY };
}

export interface PlanarFaceOverlayInfo {
  screenVerts: [number, number][];
  visible: boolean;
  uvOriginPx?: [number, number];
  uvEndUPx?: [number, number];
  uvEndVPx?: [number, number];
}

export function getPlanarFaceScreenOverlay(
  shape: ParametricShape,
  faceId: string,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
  originX: number,
  originY: number,
): PlanarFaceOverlayInfo | null {
  if (!isPlanarTextureShape(shape)) return null;
  const vb = worldBoxToView(
    shape.u,
    shape.v,
    Math.max(0.0625, shape.sizeU),
    Math.max(0.0625, shape.sizeV),
    normalizeRotation(shape.ori),
    plotU,
    plotV,
    rot,
  );
  const z0 = Math.round(shape.zPx);
  const z1 = z0 + Math.max(0, Math.round(shape.heightPx));
  const flipZ = Boolean(shape.flipZ);
  const tilt = hasActiveTilt(shape)
    ? buildTiltTransform(vb.u, vb.v, vb.sizeU, vb.sizeV, z0, z1, vb.ori, shape.tiltUDeg, shape.tiltVDeg, shape.tiltPivot, shape)
    : null;
  const includeBottom = Boolean(tilt);
  let faces: MeshFace[] = [];
  switch (shape.shapeType) {
    case 'box':
      faces = buildBoxFaces(vb.u, vb.v, vb.sizeU, vb.sizeV, z0, z1, vb.ori, flipZ, includeBottom);
      break;
    case 'right_tri_prism':
      faces = buildRightTriPrismFaces(vb.u, vb.v, vb.sizeU, vb.sizeV, z0, z1, vb.ori, shape.triPrismCut ?? 'vertical', flipZ, includeBottom);
      break;
    case 'prism':
      faces = buildPrismFaces(vb.u, vb.v, vb.sizeU, vb.sizeV, z0, z1, shape.prismSides, vb.ori, flipZ, includeBottom);
      break;
    case 'wedge':
      faces = buildWedgeFaces(vb.u, vb.v, vb.sizeU, vb.sizeV, z0, z1, vb.ori, shape.wedgeMode, flipZ, includeBottom);
      break;
    case 'pyramid':
      faces = buildPyramidFaces(vb.u, vb.v, vb.sizeU, vb.sizeV, z0, z1, vb.ori, flipZ, includeBottom);
      break;
  }
  if (tilt) faces = tiltMeshFaces(faces, tilt);
  const match = faces.find((f) => f.faceId === faceId);
  if (!match) return null;
  const screenVerts = match.verts.map((pt) => isoToScreenPx(pt.x, pt.y, pt.z, originX, originY));
  let area2 = 0;
  for (let i = 0; i < screenVerts.length; i++) {
    const [ax, ay] = screenVerts[i];
    const [bx, by] = screenVerts[(i + 1) % screenVerts.length];
    area2 += ax * by - bx * ay;
  }
  return {
    screenVerts,
    visible: area2 < -1e-2,
    uvOriginPx: match.uvOrigin ? isoToScreenPx(match.uvOrigin.x, match.uvOrigin.y, match.uvOrigin.z, originX, originY) : undefined,
    uvEndUPx: match.uvEndU ? isoToScreenPx(match.uvEndU.x, match.uvEndU.y, match.uvEndU.z, originX, originY) : undefined,
    uvEndVPx: match.uvEndV ? isoToScreenPx(match.uvEndV.x, match.uvEndV.y, match.uvEndV.z, originX, originY) : undefined,
  };
}
