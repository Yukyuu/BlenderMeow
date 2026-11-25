// Parametric + Raster layered document model for Builder Meow
import { getArchSampleCount, normalizeArchNodes, sampleArchOuterCurve } from './arch';
import { tr } from './i18n';
import {
  ensureActiveColumnSection,
  getColumnLocalBounds,
  hasActiveColumnSections,
} from './columnSections';
import {
  getPlotOrigin,
  getViewPlotDims,
  normalizeRotation,
  worldBoxToView,
  type ViewRotation,
} from './isoMath';
import {
  cloneShape,
  getShapeScreenBounds,
  normalizeShadeSteps,
  renderShapeToBuffer,
  transformLocalToViewPoint,
  type ParametricShape,
} from './isoRenderer';
import {
  buildShapeSunShadowField,
  cloneGroundShadowConfig,
  colorizeGroundShadowMask,
  evaluateInterBlockShadowMask,
  renderShapeGroundShadowMask,
  type GroundShadowConfig,
  type InterBlockShadowEntry,
  type ShapeSunShadowField,
} from './groundShadow';
import {
  ensureActiveLoftSection,
  evaluateHollowLoftStackElevation,
  getLoftLocalBounds,
} from './loft';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: '正常' },
  { id: 'multiply', label: '正片叠底' },
  { id: 'screen', label: '滤色' },
  { id: 'overlay', label: '叠加' },
  { id: 'darken', label: '变暗' },
  { id: 'lighten', label: '变亮' },
  { id: 'color-dodge', label: '颜色减淡' },
  { id: 'color-burn', label: '颜色加深' },
  { id: 'hard-light', label: '强光' },
  { id: 'soft-light', label: '柔光' },
  { id: 'difference', label: '差值' },
  { id: 'exclusion', label: '排除' },
  { id: 'hue', label: '色相' },
  { id: 'saturation', label: '饱和度' },
  { id: 'color', label: '颜色' },
  { id: 'luminosity', label: '明度' },
];

function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const d = l - n || 1e-6;
    r = l + ((r - l) * l) / d;
    g = l + ((g - l) * l) / d;
    b = l + ((b - l) * l) / d;
  }
  if (x > 1) {
    const d = x - l || 1e-6;
    r = l + ((r - l) * (1 - l)) / d;
    g = l + ((g - l) * (1 - l)) / d;
    b = l + ((b - l) * (1 - l)) / d;
  }
  return [r, g, b];
}

function setLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - lum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const c: [number, number, number] = [r, g, b];
  const idx = [0, 1, 2].sort((a, d) => c[a] - c[d]);
  const [iMin, iMid, iMax] = idx;
  if (c[iMax] > c[iMin]) {
    c[iMid] = ((c[iMid] - c[iMin]) * s) / (c[iMax] - c[iMin]);
    c[iMax] = s;
  } else {
    c[iMid] = 0;
    c[iMax] = 0;
  }
  c[iMin] = 0;
  return c;
}

function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'color-dodge': return b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s));
    case 'color-burn': return b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    case 'hard-light': return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'soft-light': {
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b);
    }
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
    default: return s;
  }
}

function blendRgb(
  mode: BlendMode,
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  switch (mode) {
    case 'hue': {
      const [tr, tg, tb] = setSat(sr, sg, sb, sat(br, bg, bb));
      return setLum(tr, tg, tb, lum(br, bg, bb));
    }
    case 'saturation': {
      const [tr, tg, tb] = setSat(br, bg, bb, sat(sr, sg, sb));
      return setLum(tr, tg, tb, lum(br, bg, bb));
    }
    case 'color':
      return setLum(sr, sg, sb, lum(br, bg, bb));
    case 'luminosity':
      return setLum(br, bg, bb, lum(sr, sg, sb));
    default:
      return [blendChannel(mode, br, sr), blendChannel(mode, bg, sg), blendChannel(mode, bb, sb)];
  }
}

let layerSeq = 1;
export function ensureLayerSeq(id: number) {
  if (id >= layerSeq) layerSeq = id + 1;
}

const hasDom = typeof document !== 'undefined';

export class BuilderLayer {
  id: number;
  name: string;
  kind: 'shape' | 'raster';
  shape?: ParametricShape;
  rasterRole: 'underlay' | 'overlay' = 'underlay';
  data: Uint8ClampedArray;
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  opacity = 1;
  visible = true;
  locked = false;
  blend: BlendMode = 'normal';
  renderRev = 0;
  geomRev = 0;
  dirtyRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  zData: Float32Array = new Float32Array(0);
  sunFacing: Uint8Array = new Uint8Array(0);
  hasAuxData = false;
  cachedSunField: ShapeSunShadowField | null = null;
  cachedSunFieldSig = '';
  cachedGroundMask: Uint8Array | null = null;
  cachedGroundMaskSig = '';
  private cachedImgData: ImageData | null = null;

  constructor(
    public width: number,
    public height: number,
    name?: string,
    kind: 'shape' | 'raster' = 'shape',
    shape?: ParametricShape,
    data?: Uint8ClampedArray,
  ) {
    this.id = layerSeq++;
    this.name = name ?? tr(`图层 ${this.id}`);
    this.kind = kind;
    this.shape = shape ? cloneShape(shape) : undefined;
    this.data = data ? new Uint8ClampedArray(data) : new Uint8ClampedArray(width * height * 4);
    if (hasDom) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (data !== undefined || kind === 'raster') {
        this.flush();
      }
    }
  }

  resizeBuffer(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.zData = new Float32Array(0);
    this.sunFacing = new Uint8Array(0);
    this.hasAuxData = false;
    this.cachedSunField = null;
    this.cachedSunFieldSig = '';
    this.cachedGroundMask = null;
    this.cachedGroundMaskSig = '';
    this.dirtyRect = null;
    this.cachedImgData = null;
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  flush(x0 = 0, y0 = 0, x1 = this.width, y1 = this.height) {
    if (!this.ctx) return;
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.width, Math.ceil(x1));
    y1 = Math.min(this.height, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    if (
      !this.cachedImgData ||
      this.cachedImgData.data !== this.data ||
      this.cachedImgData.width !== this.width ||
      this.cachedImgData.height !== this.height
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.cachedImgData = new ImageData(this.data as any, this.width, this.height);
    }
    this.ctx.putImageData(this.cachedImgData, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  drawImage(src: CanvasImageSource, dx = 0, dy = 0, dw?: number, dh?: number, smooth = false) {
    if (!hasDom) return;
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = smooth;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.putImageData(new ImageData(this.data as any, this.width, this.height), 0, 0);
    if (dw !== undefined && dh !== undefined) ctx.drawImage(src, dx, dy, dw, dh);
    else ctx.drawImage(src, dx, dy);
    this.data.set(ctx.getImageData(0, 0, this.width, this.height).data);
    this.flush();
  }

  clone(): BuilderLayer {
    const l = new BuilderLayer(
      this.width,
      this.height,
      tr(`${this.name} 副本`),
      this.kind,
      this.shape ? cloneShape(this.shape) : undefined,
      this.data,
    );
    l.opacity = this.opacity;
    l.visible = this.visible;
    l.locked = this.locked;
    l.blend = this.blend;
    l.rasterRole = this.rasterRole;
    if (this.hasAuxData && this.zData.length === this.width * this.height) {
      l.zData = new Float32Array(this.zData);
      l.sunFacing = new Uint8Array(this.sunFacing);
      l.hasAuxData = true;
    }
    return l;
  }
}

export interface BuilderLayerSnapshot {
  id: number;
  name: string;
  kind: 'shape' | 'raster';
  rasterRole: 'underlay' | 'overlay';
  shape?: ParametricShape;
  data?: Uint8ClampedArray;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blend: BlendMode;
}

export interface PlotFrameConfig {
  visible: boolean;
  u: number;
  v: number;
  sizeU: number;
  sizeV: number;
}

export interface DocumentSnapshot {
  w: number;
  h: number;
  plotU: number;
  plotV: number;
  bottomMarginPx: number;
  viewRotation: ViewRotation;
  autoSortOnRotate: boolean;
  plotFrame: PlotFrameConfig;
  groundShadow?: GroundShadowConfig;
  shadeSteps?: number;
  active: number;
  layers: BuilderLayerSnapshot[];
}

interface TriPrismFootprint {
  u0: number;
  v0: number;
  su: number;
  sv: number;
  ori: ViewRotation;
}

function computeEffectiveBox2D(
  s: ParametricShape,
  baseU: number,
  baseV: number,
  su: number,
  sv: number,
  ori: ViewRotation,
): { u0: number; u1: number; v0: number; v1: number } {
  let lb: { minU: number; maxU: number; minV: number; maxV: number } | null = null;
  if (s.shapeType === 'loft') {
    lb = getLoftLocalBounds(s.loftSections, s.loftInterp ?? 'smooth');
  } else if (hasActiveColumnSections(s)) {
    lb = getColumnLocalBounds(s);
  }
  if (!lb) {
    return { u0: baseU, u1: baseU + su, v0: baseV, v1: baseV + sv };
  }
  const lu0 = Math.min(0, lb.minU);
  const lu1 = Math.max(1, lb.maxU);
  const lv0 = Math.min(0, lb.minV);
  const lv1 = Math.max(1, lb.maxV);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [lu, lv] of [
    [lu0, lv0],
    [lu1, lv0],
    [lu1, lv1],
    [lu0, lv1],
  ]) {
    const pt = transformLocalToViewPoint(lu, lv, 0, baseU, baseV, su, sv, ori);
    if (pt.x < minU) minU = pt.x;
    if (pt.x > maxU) maxU = pt.x;
    if (pt.y < minV) minV = pt.y;
    if (pt.y > maxV) maxV = pt.y;
  }
  return { u0: minU, u1: maxU, v0: minV, v1: maxV };
}

function checkTriPrismEmptyHalfRelation(
  prism: TriPrismFootprint,
  other: { u0: number; u1: number; v0: number; v1: number },
  eps: number,
): 'none' | 'other_in_front' | 'other_behind' | 'disjoint_side' {
  const fu0 = (other.u0 - prism.u0) / prism.su;
  const fu1 = (other.u1 - prism.u0) / prism.su;
  const fv0 = (other.v0 - prism.v0) / prism.sv;
  const fv1 = (other.v1 - prism.v0) / prism.sv;
  switch (prism.ori) {
    case 0:
      // Solid: fu + fv <= 1; empty camera-facing half: fu + fv >= 1
      return fu0 + fv0 >= 1 - eps ? 'other_in_front' : 'none';
    case 2:
      // Solid: fu + fv >= 1; empty back half: fu + fv <= 1
      return fu1 + fv1 <= 1 + eps ? 'other_behind' : 'none';
    case 1: {
      // Solid: fv <= fu; empty half: fv >= fu
      if (fv0 - fu1 < -eps) return 'none';
      const ray = 1 / prism.sv - 1 / prism.su;
      return ray > 1e-6 ? 'other_in_front' : ray < -1e-6 ? 'other_behind' : 'disjoint_side';
    }
    case 3: {
      // Solid: fu <= fv; empty half: fu >= fv
      if (fu0 - fv1 < -eps) return 'none';
      const ray = 1 / prism.su - 1 / prism.sv;
      return ray > 1e-6 ? 'other_in_front' : ray < -1e-6 ? 'other_behind' : 'disjoint_side';
    }
  }
}

export class BuilderDocument {
  layers: BuilderLayer[] = [];
  active = 0;
  plotU: number;
  plotV: number;
  bottomMarginPx: number;
  viewRotation: ViewRotation = 0;
  autoSortOnRotate = true;
  shadeSteps = 0;
  plotFrame: PlotFrameConfig;
  groundShadow: GroundShadowConfig = cloneGroundShadowConfig({ enabled: false });
  composite: HTMLCanvasElement | null = null;
  private cctx: CanvasRenderingContext2D | null = null;
  private shadowMask: Uint8Array;
  private shadowData: Uint8ClampedArray;
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private cachedShadowImgData: ImageData | null = null;
  private lastShadowMaskSig = '';
  private lastShadowColorSig = '';
  private shadowHasPixels = false;
  private interBlockMask: Uint8Array;
  private interBlockData: Uint8ClampedArray;
  private interBlockCanvas: HTMLCanvasElement | null = null;
  private interBlockCtx: CanvasRenderingContext2D | null = null;
  private cachedInterBlockImgData: ImageData | null = null;
  private lastInterBlockMaskSig = '';
  private lastInterBlockColorSig = '';
  private interBlockHasPixels = false;

  constructor(
    public width = 256,
    public height = 256,
    plotU = 4,
    plotV = 4,
    bottomMarginPx = 16,
  ) {
    this.plotU = plotU;
    this.plotV = plotV;
    this.bottomMarginPx = bottomMarginPx;
    this.plotFrame = { visible: true, u: 0, v: 0, sizeU: plotU, sizeV: plotV };
    this.shadowMask = new Uint8Array(width * height);
    this.shadowData = new Uint8ClampedArray(width * height * 4);
    this.interBlockMask = new Uint8Array(width * height);
    this.interBlockData = new Uint8ClampedArray(width * height * 4);
    if (hasDom) {
      this.composite = document.createElement('canvas');
      this.composite.width = width;
      this.composite.height = height;
      this.cctx = this.composite.getContext('2d');
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = width;
      this.shadowCanvas.height = height;
      this.shadowCtx = this.shadowCanvas.getContext('2d', { willReadFrequently: true });
      this.interBlockCanvas = document.createElement('canvas');
      this.interBlockCanvas.width = width;
      this.interBlockCanvas.height = height;
      this.interBlockCtx = this.interBlockCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  get layer(): BuilderLayer | undefined {
    return this.layers[this.active];
  }

  getViewOrigin(): { originX: number; originY: number; viewPlotU: number; viewPlotV: number } {
    const { viewPlotU, viewPlotV } = getViewPlotDims(this.plotU, this.plotV, this.viewRotation);
    const { originX, originY } = getPlotOrigin(this.width, this.height, viewPlotU, viewPlotV, this.bottomMarginPx);
    return { originX, originY, viewPlotU, viewPlotV };
  }

  rerenderShapeLayer(l: BuilderLayer, opts?: { preserveGeometryCache?: boolean; forceAux?: boolean }) {
    if (l.kind !== 'shape') return;
    l.renderRev++;
    if (!opts?.preserveGeometryCache) {
      l.geomRev++;
      l.cachedSunField = null;
      l.cachedSunFieldSig = '';
      l.cachedGroundMaskSig = '';
    }
    const prev = l.dirtyRect;
    const pixelLen = this.width * this.height;
    const wantAux =
      Boolean(opts?.forceAux || this.groundShadow.interBlockEnabled) &&
      Boolean(l.shape && l.shape.shapeType !== 'theotown_base');

    if (l.width !== this.width || l.height !== this.height) {
      l.resizeBuffer(this.width, this.height);
    } else if (prev) {
      const rowStart = prev.x0 * 4;
      const rowEnd = prev.x1 * 4;
      for (let y = prev.y0; y < prev.y1; y++) {
        const base = y * this.width * 4;
        l.data.fill(0, base + rowStart, base + rowEnd);
      }
    } else {
      l.data.fill(0);
    }

    if (wantAux) {
      if (l.zData.length !== pixelLen || l.sunFacing.length !== pixelLen) {
        l.zData = new Float32Array(pixelLen);
        l.sunFacing = new Uint8Array(pixelLen);
      } else if (prev) {
        for (let y = prev.y0; y < prev.y1; y++) {
          const pxBase = y * this.width;
          l.zData.fill(0, pxBase + prev.x0, pxBase + prev.x1);
          l.sunFacing.fill(0, pxBase + prev.x0, pxBase + prev.x1);
        }
      } else {
        l.zData.fill(0);
        l.sunFacing.fill(0);
      }
    } else {
      l.hasAuxData = false;
      if (l.zData.length > 0) l.zData = new Float32Array(0);
      if (l.sunFacing.length > 0) l.sunFacing = new Uint8Array(0);
    }

    if (!l.shape) {
      l.hasAuxData = false;
      if (prev) l.flush(prev.x0, prev.y0, prev.x1, prev.y1);
      l.dirtyRect = null;
      return;
    }

    const { originX, originY } = this.getViewOrigin();
    const raw = getShapeScreenBounds(l.shape, this.plotU, this.plotV, this.viewRotation, originX, originY);
    const nb = {
      x0: Math.max(0, Math.floor(raw.minX) - 4),
      y0: Math.max(0, Math.floor(raw.minY) - 4),
      x1: Math.min(this.width, Math.ceil(raw.maxX) + 4),
      y1: Math.min(this.height, Math.ceil(raw.maxY) + 4),
    };

    renderShapeToBuffer(
      l.data,
      this.width,
      this.height,
      l.shape,
      this.plotU,
      this.plotV,
      this.viewRotation,
      originX,
      originY,
      this.shadeSteps,
      wantAux ? { zData: l.zData, sunFacing: l.sunFacing } : null,
    );
    l.hasAuxData = wantAux;

    const hasNew = nb.x1 > nb.x0 && nb.y1 > nb.y0;
    const ux0 = prev ? (hasNew ? Math.min(prev.x0, nb.x0) : prev.x0) : nb.x0;
    const uy0 = prev ? (hasNew ? Math.min(prev.y0, nb.y0) : prev.y0) : nb.y0;
    const ux1 = prev ? (hasNew ? Math.max(prev.x1, nb.x1) : prev.x1) : nb.x1;
    const uy1 = prev ? (hasNew ? Math.max(prev.y1, nb.y1) : prev.y1) : nb.y1;
    if (ux1 > ux0 && uy1 > uy0) {
      l.flush(ux0, uy0, ux1, uy1);
    }
    l.dirtyRect = hasNew ? nb : null;
  }

  rerenderAllShapes(opts?: { preserveGeometryCache?: boolean }) {
    for (const l of this.layers) {
      if (l.kind === 'shape') this.rerenderShapeLayer(l, opts);
    }
  }

  rotateView(deltaSteps: number) {
    this.viewRotation = normalizeRotation(this.viewRotation + deltaSteps);
    if (this.autoSortOnRotate) {
      this.sortLayersByIsoDepth();
    }
    this.rerenderAllShapes();
  }

  getShapeWorldFootprint(s: ParametricShape): { u0: number; u1: number; v0: number; v1: number } {
    return computeEffectiveBox2D(
      s,
      s.u,
      s.v,
      Math.max(0.0625, s.sizeU),
      Math.max(0.0625, s.sizeV),
      normalizeRotation(s.ori),
    );
  }

  /**
   * Topological isometric depth sort for current viewRotation.
   * Keeps underlay rasters and TheoTown base tiles beneath 3D shapes.
   */
  sortLayersByIsoDepth() {
    const activeId = this.layer?.id ?? -1;
    const underlays: BuilderLayer[] = [];
    const bases: BuilderLayer[] = [];
    const shapes: BuilderLayer[] = [];
    const overlays: BuilderLayer[] = [];

    for (const l of this.layers) {
      if (l.kind === 'raster') {
        if (l.rasterRole === 'overlay') overlays.push(l);
        else underlays.push(l);
      } else if (l.shape?.shapeType === 'theotown_base') {
        bases.push(l);
      } else {
        shapes.push(l);
      }
    }

    const sortByBox = (arr: BuilderLayer[]) => {
      const n = arr.length;
      if (n <= 1) return arr;
      const { originX, originY } = this.getViewOrigin();
      const boxes = arr.map((l) => {
        const s = l.shape!;
        const vb = worldBoxToView(s.u, s.v, s.sizeU, s.sizeV, s.ori, this.plotU, this.plotV, this.viewRotation);
        const su = Math.max(0.0625, vb.sizeU);
        const sv = Math.max(0.0625, vb.sizeV);
        const eff = computeEffectiveBox2D(s, vb.u, vb.v, su, sv, vb.ori);
        const z0 = s.zPx;
        const z1 = s.zPx + s.heightPx;
        const scr = getShapeScreenBounds(s, this.plotU, this.plotV, this.viewRotation, originX, originY);
        let cu = (eff.u0 + eff.u1) * 0.5;
        let cv = (eff.v0 + eff.v1) * 0.5;
        const isVertTriPrism = s.shapeType === 'right_tri_prism' && (s.triPrismCut ?? 'vertical') === 'vertical';
        if (isVertTriPrism) {
          switch (vb.ori) {
            case 0:
              cu = vb.u + vb.sizeU / 3;
              cv = vb.v + vb.sizeV / 3;
              break;
            case 1:
              cu = vb.u + (2 * vb.sizeU) / 3;
              cv = vb.v + vb.sizeV / 3;
              break;
            case 2:
              cu = vb.u + (2 * vb.sizeU) / 3;
              cv = vb.v + (2 * vb.sizeV) / 3;
              break;
            case 3:
              cu = vb.u + vb.sizeU / 3;
              cv = vb.v + (2 * vb.sizeV) / 3;
              break;
          }
        }
        const key = (cu + cv) * 1000 + (z0 + z1) * 0.5;
        return {
          u0: eff.u0,
          u1: eff.u1,
          v0: eff.v0,
          v1: eff.v1,
          z0,
          z1,
          scr,
          key,
          triPrism: isVertTriPrism ? ({ u0: vb.u, v0: vb.v, su, sv, ori: vb.ori } as TriPrismFootprint) : null,
        };
      });

      // Build DAG edges: B -> A if A occludes B
      const adj: number[][] = Array.from({ length: n }, () => []);
      const indeg = new Int32Array(n);
      const eps = 1e-3;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const A = boxes[i];
          const B = boxes[j];
          const scrOverlap =
            A.scr.minX < B.scr.maxX + 1 &&
            A.scr.maxX + 1 > B.scr.minX &&
            A.scr.minY < B.scr.maxY + 1 &&
            A.scr.maxY + 1 > B.scr.minY;
          if (!scrOverlap) continue;

          // B cannot be strictly in front of A
          if (B.u0 >= A.u1 - eps || B.v0 >= A.v1 - eps || B.z0 >= A.z1 - eps) continue;
          const relA = A.triPrism ? checkTriPrismEmptyHalfRelation(A.triPrism, B, eps) : 'none';
          if (relA === 'other_in_front' || relA === 'disjoint_side') continue;
          const relB = B.triPrism ? checkTriPrismEmptyHalfRelation(B.triPrism, A, eps) : 'none';
          if (relB === 'other_behind' || relB === 'disjoint_side') continue;

          if (
            A.u0 >= B.u1 - eps ||
            A.v0 >= B.v1 - eps ||
            A.z0 >= B.z1 - eps ||
            relA === 'other_behind' ||
            relB === 'other_in_front'
          ) {
            adj[j].push(i);
            indeg[i]++;
          }
        }
      }

      // Kahn topological sort with depth-key tie-breaker
      const placed = new Uint8Array(n);
      const out: BuilderLayer[] = [];
      for (let step = 0; step < n; step++) {
        let best = -1;
        for (let i = 0; i < n; i++) {
          if (placed[i] || indeg[i] !== 0) continue;
          if (best === -1 || boxes[i].key < boxes[best].key) best = i;
        }
        // Fallback if a cycle exists
        if (best === -1) {
          for (let i = 0; i < n; i++) {
            if (placed[i]) continue;
            if (best === -1 || boxes[i].key < boxes[best].key) best = i;
          }
        }
        placed[best] = 1;
        out.push(arr[best]);
        for (const nxt of adj[best]) indeg[nxt]--;
      }
      return out;
    };

    this.layers = [
      ...underlays,
      ...sortByBox(bases),
      ...sortByBox(shapes),
      ...overlays,
    ];
    if (activeId >= 0) {
      const idx = this.layers.findIndex((l) => l.id === activeId);
      if (idx >= 0) this.active = idx;
    }
    this.active = Math.max(0, Math.min(this.active, this.layers.length - 1));
  }

  /**
   * Computes highest top elevation (zPx + heightPx) among visible shapes overlapping (u, v, sizeU, sizeV).
   */
  getTopElevationAt(
    u: number,
    v: number,
    sizeU: number,
    sizeV: number,
    excludeLayerId?: number,
  ): number {
    let maxTop = 0;
    const eps = 1e-4;
    const queryBox = { u0: u, u1: u + sizeU, v0: v, v1: v + sizeV };
    for (const l of this.layers) {
      if (!l.visible || l.kind !== 'shape' || !l.shape) continue;
      if (l.id === excludeLayerId) continue;
      if (l.shape.shapeType === 'theotown_base') continue;
      const s = l.shape;
      const wf = this.getShapeWorldFootprint(s);
      const overlapU = u < wf.u1 - eps && u + sizeU > wf.u0 + eps;
      const overlapV = v < wf.v1 - eps && v + sizeV > wf.v0 + eps;
      if (overlapU && overlapV) {
        if (
          s.shapeType === 'right_tri_prism' &&
          (s.triPrismCut ?? 'vertical') === 'vertical' &&
          !hasActiveColumnSections(s)
        ) {
          const prism: TriPrismFootprint = {
            u0: s.u,
            v0: s.v,
            su: Math.max(0.0625, s.sizeU),
            sv: Math.max(0.0625, s.sizeV),
            ori: normalizeRotation(s.ori),
          };
          if (checkTriPrismEmptyHalfRelation(prism, queryBox, eps) !== 'none') {
            continue;
          }
        }
        if (s.shapeType === 'arch' && !(s.archHollow && s.archHollowStyle === 'portal') && !s.flipZ) {
          const su = Math.max(0.0625, s.sizeU);
          const sv = Math.max(0.0625, s.sizeV);
          const fu0 = Math.max(0, Math.min(1, (u - s.u) / su));
          const fu1 = Math.max(0, Math.min(1, (u + sizeU - s.u) / su));
          const fv0 = Math.max(0, Math.min(1, (v - s.v) / sv));
          const fv1 = Math.max(0, Math.min(1, (v + sizeV - s.v) / sv));
          const ori = normalizeRotation(s.ori);
          let lu0 = fu0, lu1 = fu1;
          if (ori === 1) { lu0 = fv0; lu1 = fv1; }
          else if (ori === 2) { lu0 = 1 - fu1; lu1 = 1 - fu0; }
          else if (ori === 3) { lu0 = 1 - fv1; lu1 = 1 - fv0; }
          const spanCells = ori % 2 === 1 ? sv : su;
          const spanMetric = Math.max(4, spanCells * 18);
          const heightMetric = Math.max(4, s.heightPx);
          const curve = sampleArchOuterCurve(s.archNodes, getArchSampleCount(spanMetric, heightMetric));
          let localMaxH = -1;
          for (let k = 0; k < curve.length; k++) {
            const [cs, ch] = curve[k];
            if (cs >= lu0 - eps && cs <= lu1 + eps && ch > localMaxH) {
              localMaxH = ch;
            }
            if (k + 1 < curve.length) {
              const [ns, nh] = curve[k + 1];
              const segMin = Math.min(cs, ns);
              const segMax = Math.max(cs, ns);
              if (segMax - segMin > 1e-6) {
                for (const q of [lu0, lu1]) {
                  if (q >= segMin && q <= segMax) {
                    const t = (q - cs) / (ns - cs);
                    const qh = ch + (nh - ch) * t;
                    if (qh > localMaxH) localMaxH = qh;
                  }
                }
              }
            }
          }
          if (localMaxH >= 0) {
            maxTop = Math.max(maxTop, s.zPx + localMaxH * s.heightPx);
          }
          continue;
        }
        if (s.shapeType === 'loft') {
          const su = Math.max(0.0625, s.sizeU);
          const sv = Math.max(0.0625, s.sizeV);
          const ori = normalizeRotation(s.ori);
          const lsu = ori % 2 === 1 ? sv : su;
          const lsv = ori % 2 === 1 ? su : sv;
          const worldToLocal = (wu: number, wv: number): [number, number] => {
            const fu = (wu - s.u) / su;
            const fv = (wv - s.v) / sv;
            switch (ori) {
              case 0: return [fu, fv];
              case 1: return [fv, 1 - fu];
              case 2: return [1 - fu, 1 - fv];
              case 3: return [1 - fv, fu];
            }
          };
          const testPts: [number, number][] = [
            worldToLocal(u + eps, v + eps),
            worldToLocal(u + sizeU - eps, v + eps),
            worldToLocal(u + sizeU - eps, v + sizeV - eps),
            worldToLocal(u + eps, v + sizeV - eps),
            worldToLocal(u + sizeU * 0.5, v + sizeV * 0.5),
          ];
          const loftFlip = Boolean(s.flipZ);
          const stackRes = evaluateHollowLoftStackElevation(
            s.loftSections,
            s.loftInterp ?? 'smooth',
            Boolean(s.loftHollow) && !(loftFlip && (s.loftFloorT ?? 0) > 0),
            loftFlip ? 0 : (s.loftFloorT ?? 0),
            lsu,
            lsv,
            s.zPx,
            s.heightPx,
            testPts,
          );
          if (stackRes.isInsideShaft) {
            if (stackRes.shaftFloorElevation !== null) {
              maxTop = Math.max(maxTop, stackRes.shaftFloorElevation);
            }
            continue;
          }
          maxTop = Math.max(maxTop, loftFlip ? s.zPx + s.heightPx : stackRes.topElevation);
          continue;
        }
        maxTop = Math.max(maxTop, s.zPx + s.heightPx);
      }
    }
    return Math.round(maxTop);
  }

  /**
   * Returns insertion index for automatic ground shadow:
   * directly above underlays and TheoTown base footprint, and strictly below all 3D building shapes
   * so other shapes located in a shadow region are not darkened.
   */
  getGroundShadowInsertIndex(layers: BuilderLayer[] = this.layers): number {
    let first3d = -1;
    let lastGroundBelow3d = -1;
    let lastGroundOverall = -1;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      const isGroundLike =
        (l.kind === 'raster' && l.rasterRole !== 'overlay') ||
        (l.kind === 'shape' && l.shape?.shapeType === 'theotown_base');
      if (isGroundLike) {
        lastGroundOverall = i;
        if (first3d < 0) lastGroundBelow3d = i;
      } else if (l.kind === 'shape' && l.shape) {
        if (first3d < 0) first3d = i;
      }
    }
    if (first3d >= 0) {
      return Math.max(lastGroundBelow3d + 1, first3d);
    }
    return lastGroundOverall + 1;
  }

  /** Insertion index for experimental inter-block shadow: right above all 3D shapes, below overlay rasters. */
  getInterBlockShadowInsertIndex(layers: BuilderLayer[] = this.layers): number {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.kind === 'shape' && l.shape && l.shape.shapeType !== 'theotown_base') {
        return i + 1;
      }
    }
    return this.getGroundShadowInsertIndex(layers);
  }

  private resizeShadowBuffers(w: number, h: number) {
    this.shadowMask = new Uint8Array(w * h);
    this.shadowData = new Uint8ClampedArray(w * h * 4);
    this.cachedShadowImgData = null;
    this.lastShadowMaskSig = '';
    this.lastShadowColorSig = '';
    this.shadowHasPixels = false;
    if (this.shadowCanvas) {
      this.shadowCanvas.width = w;
      this.shadowCanvas.height = h;
    }
    this.interBlockMask = new Uint8Array(w * h);
    this.interBlockData = new Uint8ClampedArray(w * h * 4);
    this.cachedInterBlockImgData = null;
    this.lastInterBlockMaskSig = '';
    this.lastInterBlockColorSig = '';
    this.interBlockHasPixels = false;
    if (this.interBlockCanvas) {
      this.interBlockCanvas.width = w;
      this.interBlockCanvas.height = h;
    }
  }

  private rebuildShadowIfNeeded(): boolean {
    const pixelLen = this.width * this.height;
    if (this.shadowMask.length !== pixelLen || this.shadowData.length !== pixelLen * 4) {
      this.resizeShadowBuffers(this.width, this.height);
    }

    let shapeParts = '';
    const activeShapes: BuilderLayer[] = [];
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0 || l.kind !== 'shape' || !l.shape) continue;
      if (l.shape.shapeType === 'theotown_base') continue;
      shapeParts += `${l.id}:${l.geomRev};`;
      activeShapes.push(l);
    }
    const envSig = `${this.width}x${this.height}|${this.plotU}x${this.plotV}|${this.bottomMarginPx}|${this.viewRotation}`;
    const maskSig = `${envSig}|${shapeParts}`;
    if (maskSig !== this.lastShadowMaskSig) {
      this.shadowMask.fill(0);
      if (activeShapes.length > 0) {
        const { originX, originY } = this.getViewOrigin();
        const dstMask = this.shadowMask;
        for (const l of activeShapes) {
          const layerSig = `${envSig}|${l.geomRev}`;
          if (l.cachedGroundMaskSig !== layerSig || !l.cachedGroundMask || l.cachedGroundMask.length !== pixelLen) {
            if (!l.cachedGroundMask || l.cachedGroundMask.length !== pixelLen) {
              l.cachedGroundMask = new Uint8Array(pixelLen);
            } else {
              l.cachedGroundMask.fill(0);
            }
            renderShapeGroundShadowMask(
              l.cachedGroundMask,
              this.width,
              this.height,
              l.shape!,
              this.plotU,
              this.plotV,
              this.viewRotation,
              originX,
              originY,
            );
            l.cachedGroundMaskSig = layerSig;
          }
          const lm = l.cachedGroundMask;
          for (let i = 0; i < pixelLen; i++) {
            if (lm[i]) dstMask[i] = 1;
          }
        }
      }
      this.lastShadowMaskSig = maskSig;
      this.lastShadowColorSig = '';
    }

    const col = this.groundShadow.color;
    const colorSig = `${maskSig}|${Math.round(col.r)},${Math.round(col.g)},${Math.round(col.b)},${Math.round(col.a)}`;
    if (colorSig !== this.lastShadowColorSig) {
      const res = colorizeGroundShadowMask(this.shadowMask, this.shadowData, col, this.width);
      this.shadowHasPixels = res.hasPixels;
      this.lastShadowColorSig = colorSig;
      if (this.shadowCtx) {
        if (!res.hasPixels) {
          this.shadowCtx.clearRect(0, 0, this.width, this.height);
        } else {
          if (
            !this.cachedShadowImgData ||
            this.cachedShadowImgData.data !== this.shadowData ||
            this.cachedShadowImgData.width !== this.width ||
            this.cachedShadowImgData.height !== this.height
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.cachedShadowImgData = new ImageData(this.shadowData as any, this.width, this.height);
          }
          this.shadowCtx.putImageData(this.cachedShadowImgData, 0, 0);
        }
      }
    }
    return this.shadowHasPixels;
  }

  ensureGroundShadowBuffer(): Uint8ClampedArray {
    this.rebuildShadowIfNeeded();
    return this.shadowData;
  }

  getGroundShadowCanvas(): HTMLCanvasElement | null {
    if (!this.groundShadow.enabled || this.groundShadow.color.a <= 0) {
      return null;
    }
    this.rebuildShadowIfNeeded();
    return this.shadowCanvas;
  }

  private rebuildInterBlockShadowIfNeeded(): boolean {
    const pixelLen = this.width * this.height;
    if (this.interBlockMask.length !== pixelLen || this.interBlockData.length !== pixelLen * 4) {
      this.resizeShadowBuffers(this.width, this.height);
    }

    let shapeParts = '';
    const activeShapes: BuilderLayer[] = [];
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0 || l.kind !== 'shape' || !l.shape) continue;
      if (l.shape.shapeType === 'theotown_base') continue;
      if (!l.hasAuxData || l.zData.length !== pixelLen || l.sunFacing.length !== pixelLen) {
        this.rerenderShapeLayer(l, { preserveGeometryCache: true, forceAux: true });
      }
      shapeParts += `${l.id}:${l.geomRev};`;
      activeShapes.push(l);
    }

    const maskSig = `${this.width}x${this.height}|${this.plotU}x${this.plotV}|${this.bottomMarginPx}|${this.viewRotation}|${shapeParts}`;
    if (maskSig !== this.lastInterBlockMaskSig) {
      if (activeShapes.length === 0) {
        this.interBlockMask.fill(0);
      } else {
        const { originX, originY } = this.getViewOrigin();
        const fieldEnvSig = `${this.plotU}x${this.plotV}|${this.viewRotation}|${originX},${originY}`;
        const entries: InterBlockShadowEntry[] = [];
        let uX0 = this.width;
        let uY0 = this.height;
        let uX1 = 0;
        let uY1 = 0;
        let allHaveRect = true;

        for (const l of activeShapes) {
          if (l.width !== this.width || l.height !== this.height) continue;
          const sig = `${fieldEnvSig}|${l.geomRev}`;
          if (l.cachedSunFieldSig !== sig) {
            l.cachedSunField = buildShapeSunShadowField(
              l.shape!,
              this.plotU,
              this.plotV,
              this.viewRotation,
              originX,
              originY,
            );
            l.cachedSunFieldSig = sig;
          }
          if (l.dirtyRect) {
            if (l.dirtyRect.x0 < uX0) uX0 = l.dirtyRect.x0;
            if (l.dirtyRect.y0 < uY0) uY0 = l.dirtyRect.y0;
            if (l.dirtyRect.x1 > uX1) uX1 = l.dirtyRect.x1;
            if (l.dirtyRect.y1 > uY1) uY1 = l.dirtyRect.y1;
          } else {
            allHaveRect = false;
          }
          entries.push({
            layerId: l.id,
            rgba: l.data,
            zData: l.zData,
            sunFacing: l.sunFacing,
            field: l.cachedSunField,
          });
        }
        const evalBounds = allHaveRect && uX1 > uX0 && uY1 > uY0 ? { x0: uX0, y0: uY0, x1: uX1, y1: uY1 } : null;
        evaluateInterBlockShadowMask(this.interBlockMask, this.width, this.height, entries, evalBounds);
      }
      this.lastInterBlockMaskSig = maskSig;
      this.lastInterBlockColorSig = '';
    }

    const col = this.groundShadow.color;
    const colorSig = `${maskSig}|${Math.round(col.r)},${Math.round(col.g)},${Math.round(col.b)},${Math.round(col.a)}`;
    if (colorSig !== this.lastInterBlockColorSig) {
      const res = colorizeGroundShadowMask(this.interBlockMask, this.interBlockData, col, this.width);
      this.interBlockHasPixels = res.hasPixels;
      this.lastInterBlockColorSig = colorSig;
      if (this.interBlockCtx) {
        if (!res.hasPixels) {
          this.interBlockCtx.clearRect(0, 0, this.width, this.height);
        } else {
          if (
            !this.cachedInterBlockImgData ||
            this.cachedInterBlockImgData.data !== this.interBlockData ||
            this.cachedInterBlockImgData.width !== this.width ||
            this.cachedInterBlockImgData.height !== this.height
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.cachedInterBlockImgData = new ImageData(this.interBlockData as any, this.width, this.height);
          }
          this.interBlockCtx.putImageData(this.cachedInterBlockImgData, 0, 0);
        }
      }
    }
    return this.interBlockHasPixels;
  }

  ensureInterBlockShadowBuffer(): Uint8ClampedArray {
    this.rebuildInterBlockShadowIfNeeded();
    return this.interBlockData;
  }

  getInterBlockShadowCanvas(): HTMLCanvasElement | null {
    if (!this.groundShadow.interBlockEnabled || this.groundShadow.color.a <= 0) {
      return null;
    }
    this.rebuildInterBlockShadowIfNeeded();
    return this.interBlockCanvas;
  }

  private static compositeBufferOver(
    out: Uint8ClampedArray,
    src: Uint8ClampedArray,
    op: number,
    mode: BlendMode,
  ) {
    if (op <= 0) return;
    for (let i = 0; i < out.length; i += 4) {
      const sa = (src[i + 3] / 255) * op;
      if (sa <= 0) continue;
      const da = out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;

      const sr = src[i] / 255;
      const sg = src[i + 1] / 255;
      const sb = src[i + 2] / 255;
      if (da <= 0) {
        out[i] = Math.round(src[i]);
        out[i + 1] = Math.round(src[i + 1]);
        out[i + 2] = Math.round(src[i + 2]);
        out[i + 3] = Math.round(oa * 255);
        continue;
      }
      const dr = out[i] / 255;
      const dg = out[i + 1] / 255;
      const db = out[i + 2] / 255;

      let br = sr;
      let bg = sg;
      let bb = sb;
      if (mode !== 'normal') {
        [br, bg, bb] = blendRgb(mode, dr, dg, db, sr, sg, sb);
      }

      // Standard Porter-Duff source-over composite with blended color for the intersection region
      const r = sa * (1 - da) * sr + sa * da * br + (1 - sa) * da * dr;
      const g = sa * (1 - da) * sg + sa * da * bg + (1 - sa) * da * dg;
      const b = sa * (1 - da) * sb + sa * da * bb + (1 - sa) * da * db;
      out[i] = Math.max(0, Math.min(255, Math.round((r / oa) * 255)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round((g / oa) * 255)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round((b / oa) * 255)));
      out[i + 3] = Math.max(0, Math.min(255, Math.round(oa * 255)));
    }
  }

  render(includeRasters = true): HTMLCanvasElement | null {
    if (!this.composite || !this.cctx) return null;
    const ctx = this.cctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.width, this.height);
    const showShadow = this.groundShadow.enabled && this.groundShadow.color.a > 0 && this.rebuildShadowIfNeeded();
    const shadowIdx = showShadow ? this.getGroundShadowInsertIndex(this.layers) : -1;
    const showInterBlock =
      Boolean(this.groundShadow.interBlockEnabled) &&
      this.groundShadow.color.a > 0 &&
      this.rebuildInterBlockShadowIfNeeded();
    const interBlockIdx = showInterBlock ? this.getInterBlockShadowInsertIndex(this.layers) : -1;
    for (let li = 0; li < this.layers.length; li++) {
      if (showShadow && li === shadowIdx && this.shadowCanvas) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.shadowCanvas, 0, 0);
      }
      if (showInterBlock && li === interBlockIdx && this.interBlockCanvas) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.interBlockCanvas, 0, 0);
      }
      const l = this.layers[li];
      if (!l.visible || l.opacity <= 0) continue;
      if (!includeRasters && l.kind === 'raster') continue;
      if (!l.canvas) continue;
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blend === 'normal' ? 'source-over' : l.blend;
      ctx.drawImage(l.canvas, 0, 0);
    }
    if (showShadow && shadowIdx >= this.layers.length && this.shadowCanvas) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.shadowCanvas, 0, 0);
    }
    if (showInterBlock && interBlockIdx >= this.layers.length && this.interBlockCanvas) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.interBlockCanvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return this.composite;
  }

  /** Pure buffer composite (works in both Node and browser, supporting all 16 BlendModes) */
  renderToBuffer(includeRasters = true): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const showShadow = this.groundShadow.enabled && this.groundShadow.color.a > 0 && this.rebuildShadowIfNeeded();
    const shadowIdx = showShadow ? this.getGroundShadowInsertIndex(this.layers) : -1;
    const showInterBlock =
      Boolean(this.groundShadow.interBlockEnabled) &&
      this.groundShadow.color.a > 0 &&
      this.rebuildInterBlockShadowIfNeeded();
    const interBlockIdx = showInterBlock ? this.getInterBlockShadowInsertIndex(this.layers) : -1;
    for (let li = 0; li < this.layers.length; li++) {
      if (showShadow && li === shadowIdx) {
        BuilderDocument.compositeBufferOver(out, this.shadowData, 1, 'normal');
      }
      if (showInterBlock && li === interBlockIdx) {
        BuilderDocument.compositeBufferOver(out, this.interBlockData, 1, 'normal');
      }
      const l = this.layers[li];
      if (!l.visible || l.opacity <= 0) continue;
      if (!includeRasters && l.kind === 'raster') continue;
      BuilderDocument.compositeBufferOver(out, l.data, l.opacity, l.blend);
    }
    if (showShadow && shadowIdx >= this.layers.length) {
      BuilderDocument.compositeBufferOver(out, this.shadowData, 1, 'normal');
    }
    if (showInterBlock && interBlockIdx >= this.layers.length) {
      BuilderDocument.compositeBufferOver(out, this.interBlockData, 1, 'normal');
    }
    return out;
  }

  /** Composites a slice of layers [startIdx, endIdx) into a fresh RGBA buffer without automatic shadow overlays. */
  renderLayerRangeToBuffer(startIdx: number, endIdx: number, includeRasters = true): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const s = Math.max(0, startIdx);
    const e = Math.min(this.layers.length, endIdx);
    for (let li = s; li < e; li++) {
      const l = this.layers[li];
      if (!l.visible || l.opacity <= 0) continue;
      if (!includeRasters && l.kind === 'raster') continue;
      BuilderDocument.compositeBufferOver(out, l.data, l.opacity, l.blend);
    }
    return out;
  }

  resize(w: number, h: number, plotU = this.plotU, plotV = this.plotV, bottomMarginPx = this.bottomMarginPx) {
    const prevOrigin = this.getViewOrigin();
    const prevPlotU = this.plotU;
    const prevPlotV = this.plotV;
    this.width = w;
    this.height = h;
    this.plotU = plotU;
    this.plotV = plotV;
    this.bottomMarginPx = bottomMarginPx;
    if (
      this.plotFrame.u === 0
      && this.plotFrame.v === 0
      && this.plotFrame.sizeU === prevPlotU
      && this.plotFrame.sizeV === prevPlotV
    ) {
      this.plotFrame.sizeU = plotU;
      this.plotFrame.sizeV = plotV;
    }
    const nextOrigin = this.getViewOrigin();
    if (this.composite) {
      this.composite.width = w;
      this.composite.height = h;
    }
    this.resizeShadowBuffers(w, h);
    const dx = Math.round(nextOrigin.originX - prevOrigin.originX);
    const dy = Math.round(nextOrigin.originY - prevOrigin.originY);
    for (const l of this.layers) {
      if (l.kind === 'shape') {
        this.rerenderShapeLayer(l);
      } else {
        const prev = new Uint8ClampedArray(l.data);
        const pw = l.width, ph = l.height;
        l.resizeBuffer(w, h);
        for (let y = 0; y < ph; y++) {
          const ty = y + dy;
          if (ty < 0 || ty >= h) continue;
          for (let x = 0; x < pw; x++) {
            const tx = x + dx;
            if (tx < 0 || tx >= w) continue;
            const si = (y * pw + x) * 4;
            const di = (ty * w + tx) * 4;
            l.data[di] = prev[si];
            l.data[di + 1] = prev[si + 1];
            l.data[di + 2] = prev[si + 2];
            l.data[di + 3] = prev[si + 3];
          }
        }
        l.flush();
      }
    }
  }

  snapshot(): DocumentSnapshot {
    return {
      w: this.width,
      h: this.height,
      plotU: this.plotU,
      plotV: this.plotV,
      bottomMarginPx: this.bottomMarginPx,
      viewRotation: this.viewRotation,
      autoSortOnRotate: this.autoSortOnRotate,
      plotFrame: { ...this.plotFrame },
      groundShadow: cloneGroundShadowConfig(this.groundShadow),
      shadeSteps: this.shadeSteps,
      active: this.active,
      layers: this.layers.map((l) => {
        let shapeCopy: ParametricShape | undefined;
        if (l.shape) {
          shapeCopy = cloneShape(l.shape);
          delete shapeCopy.activeLoftSectionId;
          delete shapeCopy.activeColSectionId;
        }
        return {
          id: l.id,
          name: l.name,
          kind: l.kind,
          rasterRole: l.rasterRole,
          shape: shapeCopy,
          data: l.kind === 'raster' ? new Uint8ClampedArray(l.data) : undefined,
          opacity: l.opacity,
          visible: l.visible,
          locked: l.locked,
          blend: l.blend,
        };
      }),
    };
  }

  restore(s: DocumentSnapshot) {
    const prevActiveSecByLayer = new Map<number, string>();
    const prevActiveColSecByLayer = new Map<number, string>();
    for (const l of this.layers) {
      if (l.shape?.activeLoftSectionId) {
        prevActiveSecByLayer.set(l.id, l.shape.activeLoftSectionId);
      }
      if (l.shape?.activeColSectionId) {
        prevActiveColSecByLayer.set(l.id, l.shape.activeColSectionId);
      }
    }
    this.width = s.w;
    this.height = s.h;
    this.plotU = s.plotU;
    this.plotV = s.plotV;
    this.bottomMarginPx = s.bottomMarginPx;
    this.viewRotation = s.viewRotation;
    this.autoSortOnRotate = s.autoSortOnRotate;
    this.plotFrame = s.plotFrame
      ? { ...s.plotFrame }
      : { visible: true, u: 0, v: 0, sizeU: s.plotU, sizeV: s.plotV };
    this.groundShadow = cloneGroundShadowConfig(s.groundShadow ?? { enabled: false });
    if (s.shadeSteps !== undefined) {
      this.shadeSteps = normalizeShadeSteps(s.shadeSteps);
    }
    this.resizeShadowBuffers(s.w, s.h);
    if (this.composite) {
      this.composite.width = s.w;
      this.composite.height = s.h;
    }
    this.layers = s.layers.map((st) => {
      const l = new BuilderLayer(s.w, s.h, st.name, st.kind, st.shape, st.data);
      l.id = st.id;
      ensureLayerSeq(st.id);
      l.opacity = st.opacity;
      l.visible = st.visible;
      l.locked = st.locked;
      l.blend = st.blend;
      l.rasterRole = st.rasterRole;
      if (l.shape?.shapeType === 'loft') {
        const prevSecId = prevActiveSecByLayer.get(st.id);
        if (prevSecId) l.shape.activeLoftSectionId = prevSecId;
        ensureActiveLoftSection(l.shape);
      } else if (l.shape?.shapeType === 'arch') {
        l.shape.archNodes = normalizeArchNodes(l.shape.archNodes, false);
        if (l.shape.archInnerNodes && l.shape.archInnerNodes.length >= 2) {
          l.shape.archInnerNodes = normalizeArchNodes(l.shape.archInnerNodes, true);
        }
      } else if (l.shape && hasActiveColumnSections(l.shape)) {
        const prevColSecId = prevActiveColSecByLayer.get(st.id);
        if (prevColSecId) l.shape.activeColSectionId = prevColSecId;
        ensureActiveColumnSection(l.shape);
      }
      if (l.kind === 'shape') this.rerenderShapeLayer(l);
      else l.flush();
      return l;
    });
    this.active = this.layers.length > 0 ? Math.max(0, Math.min(s.active, this.layers.length - 1)) : 0;
  }
}
