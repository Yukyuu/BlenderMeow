// Structured AI 3D Studio Operations Engine for Blender Meow MCP Bridge & Antigravity Sidecar
// Node-safe at import time (browser canvas calls guarded with `typeof document !== 'undefined'`).

import type { App } from '../app';
import {
  applyArchNodeSlideAtArcS,
  buildArchNodeSlideRail,
  createArchPresetNodes,
  createScaledInnerPresetNodes,
  normalizeArchNodes,
  type ArchHollowStyle,
  type ArchInnerMode,
  type ArchNode,
  type ArchPresetId,
} from './arch';
import { clamp, parseColorCode, parseHex, toHex, toHex8, type RGBA } from './color';
import {
  applyColumnEdgeEdit,
  applyColumnSectionTransform,
  convertColumnSectionToTransition,
  ensureColumnSections,
  insertColumnSectionAtT,
  insertColumnTransitionSection,
  isColumnSectionShape,
  syncColumnSectionsEdgeCount,
  syncColumnTransitionSections,
  type ColumnInterpMode,
} from './columnSections';
import { BuilderLayer, type BlendMode } from './document';
import {
  deserializeBmeowProject,
  renderDocumentToPngCanvas,
  renderFourViewStripCanvas,
  serializeBmeowProject,
} from './exporter';
import {
  STEP_X,
  STEP_Y,
  cellsToMeters,
  metersToCells,
  metersToZPx,
  normalizeRotation,
  worldPointToView,
  zPxToMeters,
  type ViewRotation,
} from './isoMath';
import {
  SHAPE_LABELS,
  clampShadeContrast,
  cloneShape,
  createDefaultShape,
  getPlanarFaceScreenOverlay,
  type FacadePatternType,
  type OutlineMode,
  type ParametricShape,
  type ShapeKind,
  type TriPrismCut,
} from './isoRenderer';
import {
  convertLoftSectionToTransition,
  createLoftPresetNodes,
  createScaledLoftInnerPresetNodes,
  nextLoftSectionId,
  normalizeLoftSections,
  syncLoftTransitionSections,
  type LoftInnerMode,
  type LoftInterpMode,
  type LoftPresetId,
  type LoftSection,
} from './loft';
import {
  exportBuilderPsd,
  exportFourViewLayersPsd,
  getDocumentContentBounds,
  importPsdAsRasterLayers,
  type ContentBounds,
} from './psd';
import {
  BUILTIN_PRESET_GROUP_ID,
  DEFAULT_USER_GROUP_ID,
  applyEditedFaceBufferToShape,
  createTextureGroup,
  deleteTextureGroup,
  extractFaceTextureLayerBuffer,
  getPlanarFacesForShape,
  getTextureAsset,
  getTextureGroups,
  getTextureLibrary,
  isPlanarTextureShape,
  makeTextureAssetFromRgba,
  normalizeCropRect,
  pngDataUrlToRgba,
  renameTextureGroup,
  resolveAssetGroupId,
  sanitizeFaceTexturesForShape,
  setTextureAssetGroup,
  shearPixels,
  upsertTextureAsset,
  type FaceDecalItem,
  type FaceTextureMode,
  type FaceTextureSlot,
  type ShearDirection,
  type TextureAsset,
  type TextureCropRect,
} from './textures';
import { plotPixelPerfectStroke } from '../ui/pixelCanvasEditor';

export interface AiStudioContext {
  app: App;
  refreshAll: () => void;
  fitView: () => void;
  requestRender: () => void;
}

export type SnapshotBackdrop = 'transparent' | 'checker' | 'gray' | 'white' | 'dark';

const VALID_BLENDS: ReadonlySet<string> = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

const VALID_SHAPES: ReadonlySet<string> = new Set([
  'box', 'right_tri_prism', 'arch', 'cylinder', 'loft',
  'prism', 'wedge', 'pyramid', 'cone', 'dome', 'theotown_base',
]);

const VALID_OUTLINES: ReadonlySet<string> = new Set(['none', 'outer', 'all_edges']);
const VALID_PATTERNS: ReadonlySet<string> = new Set([
  'none', 'windows', 'curtain_v', 'curtain_h', 'brick', 'roof_grid',
]);

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let bin = '';
  const sliceSize = 0x8000;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + sliceSize)));
  }
  return btoa(bin);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseColorSpec(spec: unknown): RGBA | null {
  if (spec === null || spec === undefined) return null;
  if (typeof spec === 'string') {
    const s = spec.trim();
    if (!s || s === '.' || s === 'skip' || s.toLowerCase() === 'none') return null;
    if (s.toLowerCase() === 'transparent' || s.toLowerCase() === 'erase') {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const parsed = parseHex(s);
    if (!parsed) throw new Error(`Invalid color format "${spec}" (expected #RGB, #RRGGBB, or #RRGGBBAA)`);
    return parsed;
  }
  if (typeof spec === 'object') {
    const o = spec as Record<string, unknown>;
    if (typeof o.r === 'number' && typeof o.g === 'number' && typeof o.b === 'number') {
      return {
        r: clamp(Math.round(o.r), 0, 255),
        g: clamp(Math.round(o.g), 0, 255),
        b: clamp(Math.round(o.b), 0, 255),
        a: clamp(Math.round(typeof o.a === 'number' ? o.a : 255), 0, 255),
      };
    }
  }
  return null;
}

function measureLayerPixels(layer: BuilderLayer): {
  nonEmptyPixels: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
} {
  const { width: w, height: h, data } = layer;
  let count = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] > 0) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return {
    nonEmptyPixels: count,
    bbox: x1 >= x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

function measureBufferPixels(buf: Uint8ClampedArray, w: number, h: number): {
  nonEmptyPixels: number;
  semiTransparentPixels: number;
  bbox: ContentBounds | null;
} {
  let count = 0;
  let semi = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = buf[(row + x) * 4 + 3];
      if (a > 0) {
        count++;
        if (a !== 255) semi++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return {
    nonEmptyPixels: count,
    semiTransparentPixels: semi,
    bbox: x1 >= x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

export function getStudioState(app: App) {
  const doc = app.doc;
  const groups = getTextureGroups();
  const assets = getTextureLibrary(true);
  return {
    docId: app.docId,
    docName: app.docName,
    width: doc.width,
    height: doc.height,
    plotU: doc.plotU,
    plotV: doc.plotV,
    plotWidthMeters: Math.round(cellsToMeters(doc.plotU) * 100) / 100,
    plotDepthMeters: Math.round(cellsToMeters(doc.plotV) * 100) / 100,
    bottomMarginPx: doc.bottomMarginPx,
    viewRotation: doc.viewRotation,
    viewAngleDeg: doc.viewRotation * 90,
    autoSortOnRotate: doc.autoSortOnRotate,
    plotFrame: { ...doc.plotFrame },
    groundShadow: {
      enabled: doc.groundShadow.enabled,
      interBlockEnabled: Boolean(doc.groundShadow.interBlockEnabled),
      colorHex8: toHex8(doc.groundShadow.color),
      opacityPct: Math.round((doc.groundShadow.color.a / 255) * 1000) / 10,
      opacity: Math.round((doc.groundShadow.color.a / 255) * 1000) / 1000,
    },
    shadeSteps: doc.shadeSteps,
    activeLayerIndex: doc.active,
    activeLayerId: doc.layer?.id ?? null,
    canUndo: app.history.canUndo,
    canRedo: app.history.canRedo,
    layers: doc.layers.map((l, index) => {
      const m = measureLayerPixels(l);
      let shapeInfo: Record<string, unknown> | undefined;
      if (l.shape) {
        const s = l.shape;
        const wf = doc.getShapeWorldFootprint(s);
        const faces = getPlanarFacesForShape(s);
        shapeInfo = {
          shapeType: s.shapeType,
          u: s.u,
          v: s.v,
          sizeU: s.sizeU,
          sizeV: s.sizeV,
          zPx: s.zPx,
          heightPx: s.heightPx,
          uMeters: Math.round(cellsToMeters(s.u) * 100) / 100,
          vMeters: Math.round(cellsToMeters(s.v) * 100) / 100,
          sizeUMeters: Math.round(cellsToMeters(s.sizeU) * 100) / 100,
          sizeVMeters: Math.round(cellsToMeters(s.sizeV) * 100) / 100,
          zMeters: Math.round(zPxToMeters(s.zPx) * 100) / 100,
          heightMeters: Math.round(zPxToMeters(s.heightPx) * 100) / 100,
          worldFootprint: wf,
          ori: s.ori,
          prismSides: s.prismSides,
          triPrismCut: s.triPrismCut,
          wedgeMode: s.wedgeMode,
          domeMode: s.domeMode,
          archHollow: Boolean(s.archHollow),
          archHollowStyle: s.archHollowStyle,
          archInnerMode: s.archInnerMode,
          archThickness: s.archThickness,
          archNodeCount: s.archNodes?.length ?? 0,
          loftHollow: Boolean(s.loftHollow),
          loftInterp: s.loftInterp,
          loftFloorT: s.loftFloorT,
          loftSectionCount: s.loftSections?.length ?? 0,
          colSectionCount: s.colSections?.length ?? 0,
          baseColorHex: toHex(s.baseColor),
          roofColorHex: s.roofColor ? toHex(s.roofColor) : null,
          outlineColorHex: s.outlineColor ? toHex(s.outlineColor) : null,
          autoShade: s.autoShade,
          shadeContrast: s.shadeContrast,
          outlineMode: s.outlineMode,
          edgeHighlight: s.edgeHighlight,
          pattern: {
            ...s.pattern,
            primaryColorHex: toHex(s.pattern.primaryColor),
          },
          activeFaceId: app.getActiveFaceId(l.id, s),
          planarFaces: faces,
          faceTextures: s.faceTextures ?? null,
        };
      }
      return {
        index,
        id: l.id,
        name: l.name,
        kind: l.kind,
        rasterRole: l.rasterRole,
        visible: l.visible,
        opacity: l.opacity,
        blend: l.blend,
        locked: l.locked,
        active: index === doc.active,
        nonEmptyPixels: m.nonEmptyPixels,
        bbox: m.bbox,
        shape: shapeInfo,
      };
    }),
    textureGroups: groups,
    textureAssets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      width: a.width,
      height: a.height,
      builtIn: Boolean(a.builtIn),
      projectScoped: Boolean(a.projectScoped),
      groupId: resolveAssetGroupId(a),
      displayForm: a.displayForm,
      faceBakedTag: a.faceBakedTag,
    })),
  };
}

function findLayerByRef(app: App, cmd: Record<string, unknown>, fallbackToActive = true): { layer: BuilderLayer; index: number } {
  const doc = app.doc;
  if (typeof cmd.layerId === 'number') {
    const idx = doc.layers.findIndex((l) => l.id === cmd.layerId);
    if (idx < 0) throw new Error(`Layer id ${cmd.layerId} not found`);
    return { layer: doc.layers[idx], index: idx };
  }
  if (typeof cmd.layerName === 'string' && cmd.layerName.trim()) {
    const name = cmd.layerName.trim();
    const idx = doc.layers.findIndex((l) => l.name === name);
    if (idx < 0) throw new Error(`Layer named "${name}" not found`);
    return { layer: doc.layers[idx], index: idx };
  }
  if (typeof cmd.layerIndex === 'number') {
    const idx = Math.round(cmd.layerIndex);
    if (idx < 0 || idx >= doc.layers.length) throw new Error(`Layer index ${idx} out of range`);
    return { layer: doc.layers[idx], index: idx };
  }
  if (!fallbackToActive || !doc.layer) {
    throw new Error('No matching target layer found');
  }
  return { layer: doc.layer, index: doc.active };
}

function resolveNumberParam(valCellsOrPx: unknown, valMeters: unknown, kind: 'cells' | 'zpx'): number | undefined {
  if (typeof valCellsOrPx === 'number' && Number.isFinite(valCellsOrPx)) return valCellsOrPx;
  if (typeof valMeters === 'number' && Number.isFinite(valMeters)) {
    return kind === 'cells' ? metersToCells(valMeters) : metersToZPx(valMeters);
  }
  return undefined;
}

function buildSpriteMatrixBuffer(opts: {
  rows: string[];
  paletteSpec?: string;
  palette?: Record<string, string | null>;
  scale?: number;
}): { data: Uint8ClampedArray; width: number; height: number } {
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  if (rows.length === 0) throw new Error('spriteMatrix.rows must be a non-empty string array');
  const scale = clamp(Math.round(Number(opts.scale) || 1), 1, 8);
  const rawW = Math.max(...rows.map((r) => String(r).length));
  const rawH = rows.length;
  if (rawW <= 0 || rawH <= 0) throw new Error('spriteMatrix dimensions must be positive');

  const colorMap = new Map<string, RGBA | null>();
  if (typeof opts.paletteSpec === 'string' && opts.paletteSpec.trim()) {
    for (const part of opts.paletteSpec.split(/[,;\n]+/)) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      if (!key) continue;
      colorMap.set(key, parseColorSpec(val));
    }
  }
  if (opts.palette && typeof opts.palette === 'object') {
    for (const [k, v] of Object.entries(opts.palette)) {
      colorMap.set(k, v === null ? null : parseColorSpec(v));
    }
  }

  const outW = rawW * scale;
  const outH = rawH * scale;
  const data = new Uint8ClampedArray(outW * outH * 4);
  for (let sy = 0; sy < rawH; sy++) {
    const rowStr = String(rows[sy]);
    for (let sx = 0; sx < rowStr.length; sx++) {
      const ch = rowStr[sx];
      if (ch === '.' || ch === ' ') continue;
      const rgba = colorMap.get(ch);
      if (!rgba || rgba.a === 0) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((sy * scale + dy) * outW + (sx * scale + dx)) * 4;
          data[i] = rgba.r;
          data[i + 1] = rgba.g;
          data[i + 2] = rgba.b;
          data[i + 3] = rgba.a;
        }
      }
    }
  }
  return { data, width: outW, height: outH };
}

function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL('image/png');
  const idx = url.indexOf(',');
  return idx >= 0 ? url.slice(idx + 1) : url;
}

function loadImgFromBase64(b64: string): Promise<HTMLImageElement> {
  if (typeof Image === 'undefined') {
    return Promise.reject(new Error('HTML Image API unavailable outside browser'));
  }
  const url = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Failed to decode PNG image'));
    img.src = url;
  });
}

function computeBackdropRgba(backdrop: SnapshotBackdrop): { r: number; g: number; b: number; a: number; checker?: boolean } {
  switch (backdrop) {
    case 'transparent': return { r: 0, g: 0, b: 0, a: 0 };
    case 'dark': return { r: 22, g: 24, b: 30, a: 255 };
    case 'white': return { r: 255, g: 255, b: 255, a: 255 };
    case 'checker': return { r: 255, g: 255, b: 255, a: 255, checker: true };
    case 'gray':
    default:
      return { r: 70, g: 74, b: 84, a: 255 };
  }
}

function withTemporaryLayerFilter<T>(
  app: App,
  opts: {
    hideTheoTownBase?: boolean;
    excludeTheoTownBase?: boolean;
    layerIds?: number[];
    layerNames?: string[];
    activeOnly?: boolean;
  },
  fn: () => T,
): T {
  const doc = app.doc;
  const origLayers = [...doc.layers];
  const origActive = doc.active;
  const origVis = origLayers.map((l) => l.visible);

  try {
    let subset = origLayers;
    if (opts.activeOnly && doc.layer) {
      subset = [doc.layer];
    } else if (Array.isArray(opts.layerIds) && opts.layerIds.length > 0) {
      const idSet = new Set(opts.layerIds);
      subset = origLayers.filter((l) => idSet.has(l.id));
    } else if (Array.isArray(opts.layerNames) && opts.layerNames.length > 0) {
      const nameSet = new Set(opts.layerNames);
      subset = origLayers.filter((l) => nameSet.has(l.name));
    }

    if (opts.excludeTheoTownBase) {
      subset = subset.filter((l) => l.shape?.shapeType !== 'theotown_base');
    }
    if (opts.hideTheoTownBase) {
      for (const l of origLayers) {
        if (l.shape?.shapeType === 'theotown_base') {
          l.visible = false;
        }
      }
    }

    if (subset.length !== origLayers.length) {
      const activeId = doc.layer?.id;
      doc.layers = subset;
      const newActive = activeId !== undefined ? subset.findIndex((l) => l.id === activeId) : -1;
      doc.active = newActive >= 0 ? newActive : Math.max(0, subset.length - 1);
    }

    return fn();
  } finally {
    doc.layers = origLayers;
    doc.active = origActive;
    origLayers.forEach((l, i) => {
      l.visible = origVis[i];
    });
  }
}

function renderIsoGridOverlayOnCtx(
  ctx: CanvasRenderingContext2D,
  app: App,
  offX: number,
  offY: number,
  scale: number,
  rulerPadLeft: number,
  rulerPadTop: number,
) {
  const doc = app.doc;
  const { originX, originY, viewPlotU, viewPlotV } = doc.getViewOrigin();
  const toOut = (sx: number, sy: number): [number, number] => [
    rulerPadLeft + (sx - offX) * scale,
    rulerPadTop + (sy - offY) * scale,
  ];

  // Plot isometric diamond lines (step = 1 cell = 32x16 px)
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let u = 0; u <= viewPlotU; u++) {
    const [ax, ay] = toOut(originX + u * STEP_X, originY + u * STEP_Y);
    const [bx, by] = toOut(originX + (u - viewPlotV) * STEP_X, originY + (u + viewPlotV) * STEP_Y);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  for (let v = 0; v <= viewPlotV; v++) {
    const [ax, ay] = toOut(originX - v * STEP_X, originY + v * STEP_Y);
    const [bx, by] = toOut(originX + (viewPlotU - v) * STEP_X, originY + (viewPlotU + v) * STEP_Y);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  // Plot frame + compass labels (N / E / S / W rotated with viewRotation)
  const pf = doc.plotFrame;
  if (pf.visible) {
    const corners: [number, number][] = [
      worldPointToView(pf.u, pf.v, doc.plotU, doc.plotV, doc.viewRotation),
      worldPointToView(pf.u + pf.sizeU, pf.v, doc.plotU, doc.plotV, doc.viewRotation),
      worldPointToView(pf.u + pf.sizeU, pf.v + pf.sizeV, doc.plotU, doc.plotV, doc.viewRotation),
      worldPointToView(pf.u, pf.v + pf.sizeV, doc.plotU, doc.plotV, doc.viewRotation),
    ];
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.78)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach(([vu, vv], i) => {
      const [px, py] = toOut(originX + (vu - vv) * STEP_X, originY + (vu + vv) * STEP_Y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function buildSnapshotImage(app: App, cmd: Record<string, unknown>) {
  const doc = app.doc;
  const savedRot = doc.viewRotation;
  const targetRot =
    typeof cmd.viewRotation === 'number'
      ? normalizeRotation(cmd.viewRotation)
      : savedRot;
  const grid = Boolean(cmd.grid);
  const hideTheoTownBase = Boolean(cmd.hideTheoTownBase);
  const fourViews = Boolean(cmd.fourViews);
  const cropToContent = Boolean(cmd.cropToContent);
  const padding = clamp(Math.round(Number(cmd.padding) || 4), 0, 32);
  const backdrop = (typeof cmd.backdrop === 'string' ? cmd.backdrop : 'gray') as SnapshotBackdrop;

  let restoredNeeded = false;
  const savedSnap = targetRot !== savedRot ? doc.snapshot() : null;
  const prevShadowEnabled = doc.groundShadow.enabled;
  const prevInterBlockEnabled = doc.groundShadow.interBlockEnabled;
  if (typeof cmd.includeGroundShadow === 'boolean') {
    doc.groundShadow.enabled = cmd.includeGroundShadow;
  }
  if (typeof cmd.includeInterBlockShadow === 'boolean') {
    doc.groundShadow.interBlockEnabled = cmd.includeInterBlockShadow;
  }
  if (targetRot !== savedRot) {
    doc.viewRotation = targetRot;
    if (doc.autoSortOnRotate) doc.sortLayersByIsoDepth();
    doc.rerenderAllShapes();
    restoredNeeded = true;
  }

  try {
    if (fourViews && typeof document !== 'undefined') {
      const strip = withTemporaryLayerFilter(app, {
        hideTheoTownBase,
        layerIds: Array.isArray(cmd.layerIds) ? (cmd.layerIds as number[]) : undefined,
        layerNames: Array.isArray(cmd.layerNames) ? (cmd.layerNames as string[]) : undefined,
      }, () => renderFourViewStripCanvas(doc, {
        scale: clamp(Math.round(Number(cmd.scale) || 2), 1, 8),
        trim: cmd.trim !== false,
        includeRasters: cmd.includeRasters !== false,
      }));
      const outC = document.createElement('canvas');
      outC.width = strip.width;
      outC.height = strip.height;
      const octx = outC.getContext('2d')!;
      const bg = computeBackdropRgba(backdrop);
      if (bg.a > 0) {
        octx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
        octx.fillRect(0, 0, outC.width, outC.height);
      }
      octx.imageSmoothingEnabled = false;
      octx.drawImage(strip, 0, 0);
      return {
        pngBase64: canvasToPngBase64(outC),
        outWidth: outC.width,
        outHeight: outC.height,
        sourceWidth: strip.width,
        sourceHeight: strip.height,
        scale: Number(cmd.scale) || 2,
        nonEmptyPixels: -1,
        semiTransparentPixels: 0,
      };
    }

    const layerNames: string[] = [];
    if (typeof cmd.layerName === 'string' && cmd.layerName.trim()) layerNames.push(cmd.layerName.trim());
    if (Array.isArray(cmd.layerNames)) {
      for (const n of cmd.layerNames) if (typeof n === 'string' && n.trim()) layerNames.push(n.trim());
    }
    const layerIds: number[] = [];
    if (typeof cmd.layerId === 'number') layerIds.push(cmd.layerId);
    if (Array.isArray(cmd.layerIds)) {
      for (const id of cmd.layerIds) if (typeof id === 'number') layerIds.push(id);
    }

    const buf = withTemporaryLayerFilter(
      app,
      { hideTheoTownBase, layerIds, layerNames },
      () => doc.renderToBuffer(cmd.includeRasters !== false),
    );
    const metrics = measureBufferPixels(buf, doc.width, doc.height);

    let sx = 0;
    let sy = 0;
    let sw = doc.width;
    let sh = doc.height;
    if (typeof cmd.x === 'number' && typeof cmd.y === 'number' && typeof cmd.w === 'number' && typeof cmd.h === 'number') {
      sx = clamp(Math.floor(cmd.x), 0, doc.width - 1);
      sy = clamp(Math.floor(cmd.y), 0, doc.height - 1);
      sw = clamp(Math.ceil(cmd.w), 1, doc.width - sx);
      sh = clamp(Math.ceil(cmd.h), 1, doc.height - sy);
    } else if (cropToContent && metrics.bbox) {
      sx = Math.max(0, metrics.bbox.x - padding);
      sy = Math.max(0, metrics.bbox.y - padding);
      const ex = Math.min(doc.width, metrics.bbox.x + metrics.bbox.w + padding);
      const ey = Math.min(doc.height, metrics.bbox.y + metrics.bbox.h + padding);
      sw = Math.max(1, ex - sx);
      sh = Math.max(1, ey - sy);
    }

    const reqScale = typeof cmd.scale === 'number' && Number.isFinite(cmd.scale) ? cmd.scale : 0;
    const scale = reqScale >= 1
      ? clamp(Math.round(reqScale), 1, 16)
      : clamp(Math.floor(640 / Math.max(sw, sh)), 1, 8);

    const rulerPadLeft = grid ? 28 : 0;
    const rulerPadTop = grid ? 18 : 0;
    const outW = rulerPadLeft + sw * scale;
    const outH = rulerPadTop + sh * scale;

    if (typeof document === 'undefined') {
      return {
        pngBase64: '',
        outWidth: outW,
        outHeight: outH,
        sourceWidth: sw,
        sourceHeight: sh,
        scale,
        cropBox: { x: sx, y: sy, w: sw, h: sh },
        nonEmptyPixels: metrics.nonEmptyPixels,
        semiTransparentPixels: metrics.semiTransparentPixels,
        bbox: metrics.bbox,
      };
    }

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const srcCtx = srcCanvas.getContext('2d')!;
    const cropped = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      const sOff = ((sy + y) * doc.width + sx) * 4;
      cropped.set(buf.subarray(sOff, sOff + sw * 4), y * sw * 4);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    srcCtx.putImageData(new ImageData(cropped as any, sw, sh), 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d')!;

    // Backdrop inside viewport area
    const bg = computeBackdropRgba(backdrop);
    if (bg.checker) {
      for (let y = 0; y < sh * scale; y += 16) {
        for (let x = 0; x < sw * scale; x += 16) {
          ctx.fillStyle = ((x / 16 + y / 16) & 1) === 0 ? '#d8dce6' : '#b8becd';
          ctx.fillRect(rulerPadLeft + x, rulerPadTop + y, 16, 16);
        }
      }
    } else if (bg.a > 0) {
      ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
      ctx.fillRect(rulerPadLeft, rulerPadTop, sw * scale, sh * scale);
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, 0, 0, sw, sh, rulerPadLeft, rulerPadTop, sw * scale, sh * scale);

    if (grid) {
      // Optional planar face outline highlight
      if (typeof cmd.highlightFaceId === 'string' && cmd.highlightFaceId.trim()) {
        const target = doc.layer;
        if (target?.shape) {
          const { originX, originY } = doc.getViewOrigin();
          const ov = getPlanarFaceScreenOverlay(
            target.shape,
            cmd.highlightFaceId.trim(),
            doc.plotU,
            doc.plotV,
            doc.viewRotation,
            originX,
            originY,
          );
          if (ov && ov.visible && ov.screenVerts.length >= 3) {
            ctx.save();
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ov.screenVerts.forEach(([vx, vy], i) => {
              const ox = rulerPadLeft + (vx - sx) * scale;
              const oy = rulerPadTop + (vy - sy) * scale;
              if (i === 0) ctx.moveTo(ox, oy);
              else ctx.lineTo(ox, oy);
            });
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      renderIsoGridOverlayOnCtx(ctx, app, sx, sy, scale, rulerPadLeft, rulerPadTop);

      // Pixel grid (coarse step when zoomed out, 1px when zoomed >= 5)
      const step = scale >= 5 && Math.max(sw, sh) <= 64 ? 1 : 16;
      ctx.save();
      ctx.strokeStyle = step === 1 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = sx - (sx % step); x <= sx + sw; x += step) {
        if (x < sx) continue;
        const px = Math.round(rulerPadLeft + (x - sx) * scale) + 0.5;
        ctx.moveTo(px, rulerPadTop);
        ctx.lineTo(px, outH);
      }
      for (let y = sy - (sy % step); y <= sy + sh; y += step) {
        if (y < sy) continue;
        const py = Math.round(rulerPadTop + (y - sy) * scale) + 0.5;
        ctx.moveTo(rulerPadLeft, py);
        ctx.lineTo(outW, py);
      }
      ctx.stroke();

      // Ruler margins
      ctx.fillStyle = '#181a20';
      ctx.fillRect(0, 0, outW, rulerPadTop);
      ctx.fillRect(0, 0, rulerPadLeft, outH);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px monospace';
      ctx.textBaseline = 'middle';
      const labelStep = Math.max(16, Math.ceil(40 / scale / 8) * 8);
      for (let x = sx - (sx % labelStep); x <= sx + sw; x += labelStep) {
        if (x < sx) continue;
        ctx.fillText(String(x), rulerPadLeft + (x - sx) * scale + 2, rulerPadTop / 2);
      }
      for (let y = sy - (sy % labelStep); y <= sy + sh; y += labelStep) {
        if (y < sy) continue;
        ctx.fillText(String(y), 3, rulerPadTop + (y - sy) * scale + 5);
      }
      ctx.restore();
    }

    return {
      pngBase64: canvasToPngBase64(outCanvas),
      outWidth: outW,
      outHeight: outH,
      sourceWidth: sw,
      sourceHeight: sh,
      scale,
      cropBox: { x: sx, y: sy, w: sw, h: sh },
      nonEmptyPixels: metrics.nonEmptyPixels,
      semiTransparentPixels: metrics.semiTransparentPixels,
      bbox: metrics.bbox,
    };
  } finally {
    if (restoredNeeded && savedSnap) {
      doc.restore(savedSnap);
    } else {
      doc.groundShadow.enabled = prevShadowEnabled;
      doc.groundShadow.interBlockEnabled = prevInterBlockEnabled;
    }
  }
}

export async function executeAiStudioCommand(ctx: AiStudioContext, cmd: Record<string, unknown>): Promise<unknown> {
  const { app } = ctx;
  const kind = String(cmd.kind || '');

  switch (kind) {
    case 'get_state': {
      return getStudioState(app);
    }

    case 'get_snapshot': {
      const snap = buildSnapshotImage(app, cmd);
      return {
        ...snap,
        state: getStudioState(app),
      };
    }

    case 'doc_action': {
      const action = String(cmd.action || '');
      if (action === 'new_doc') {
        const w = clamp(Math.round(Number(cmd.width) || 256), 32, 2048);
        const h = clamp(Math.round(Number(cmd.height) || 256), 32, 2048);
        const plotU = clamp(Math.round(Number(cmd.plotU) || 4), 1, 24);
        const plotV = clamp(Math.round(Number(cmd.plotV) || 4), 1, 24);
        const name = typeof cmd.name === 'string' && cmd.name.trim() ? cmd.name.trim() : 'AI 等距建筑';
        const withBase = cmd.withBase !== false;
        const withGroundShadow = cmd.withGroundShadow !== false;
        app.newDocument(w, h, plotU, plotV, name, withBase, withGroundShadow);
        ctx.fitView();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'set_ground_shadow') {
        const cur = app.doc.groundShadow;
        const enabled = typeof cmd.enabled === 'boolean' ? cmd.enabled : undefined;
        const interBlockEnabled =
          typeof cmd.interBlockEnabled === 'boolean' ? cmd.interBlockEnabled : undefined;
        let nextColor: RGBA | undefined;
        if (typeof cmd.color === 'string' && cmd.color.trim()) {
          const parsed = parseColorCode(cmd.color.trim());
          if (!parsed) throw new Error(`Invalid ground shadow color "${cmd.color}"`);
          nextColor = parsed.hasAlpha
            ? parsed.rgba
            : { ...parsed.rgba, a: cur.color.a };
        }
        if (cmd.opacityPct !== undefined) {
          if (typeof cmd.opacityPct !== 'number' || !Number.isFinite(cmd.opacityPct) || cmd.opacityPct < 0 || cmd.opacityPct > 100) {
            throw new Error(`Invalid opacityPct "${String(cmd.opacityPct)}": expected number in 0..100`);
          }
          const baseCol = nextColor ?? { ...cur.color };
          nextColor = { ...baseCol, a: clamp(Math.round((cmd.opacityPct / 100) * 255), 0, 255) };
        } else if (cmd.opacity !== undefined) {
          if (typeof cmd.opacity !== 'number' || !Number.isFinite(cmd.opacity) || cmd.opacity < 0 || cmd.opacity > 1) {
            throw new Error(`Invalid opacity "${String(cmd.opacity)}": expected 0..1 alpha (use opacityPct for 0..100%)`);
          }
          const baseCol = nextColor ?? { ...cur.color };
          nextColor = { ...baseCol, a: clamp(Math.round(cmd.opacity * 255), 0, 255) };
        }
        const changed =
          (enabled !== undefined && enabled !== cur.enabled) ||
          (interBlockEnabled !== undefined && interBlockEnabled !== Boolean(cur.interBlockEnabled)) ||
          (nextColor !== undefined &&
            (nextColor.r !== cur.color.r ||
              nextColor.g !== cur.color.g ||
              nextColor.b !== cur.color.b ||
              nextColor.a !== cur.color.a));
        if (changed) {
          app.setGroundShadow(
            { enabled, interBlockEnabled, color: nextColor },
            { pushHistory: 'AI 调整阴影设置' },
          );
          ctx.refreshAll();
        }
        return getStudioState(app);
      }

      if (action === 'set_shade_steps') {
        const raw = cmd.shadeSteps ?? 0;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 64 || (raw > 0 && raw < 3)) {
          throw new Error(`Invalid shadeSteps "${String(raw)}": expected 0 (continuous smooth) or integer 3..64`);
        }
        app.setShadeSteps(raw, { pushHistory: 'AI 调整光影精细度', persistDefault: false });
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'resize_canvas') {
        const newW = clamp(Math.round(Number(cmd.width) || app.doc.width), 32, 2048);
        const newH = clamp(Math.round(Number(cmd.height) || app.doc.height), 32, 2048);
        const dx = typeof cmd.dx === 'number' ? Math.round(cmd.dx) : Math.floor((newW - app.doc.width) / 2);
        const dy = typeof cmd.dy === 'number' ? Math.round(cmd.dy) : newH - app.doc.height;
        app.pushHistory(`AI 调整画布为 ${newW}×${newH}`);
        app.doc.resize(newW, newH, dx, dy);
        app.doc.rerenderAllShapes();
        ctx.fitView();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'set_plot') {
        app.pushHistory('AI 调整场地网格与边框');
        if (typeof cmd.plotU === 'number') app.doc.plotU = clamp(Math.round(cmd.plotU), 1, 24);
        if (typeof cmd.plotV === 'number') app.doc.plotV = clamp(Math.round(cmd.plotV), 1, 24);
        if (typeof cmd.bottomMarginPx === 'number') {
          app.doc.bottomMarginPx = clamp(Math.round(cmd.bottomMarginPx), 0, 256);
        }
        if (cmd.plotFrame && typeof cmd.plotFrame === 'object') {
          const pf = cmd.plotFrame as Record<string, unknown>;
          if (typeof pf.visible === 'boolean') app.doc.plotFrame.visible = pf.visible;
          if (typeof pf.u === 'number') app.doc.plotFrame.u = pf.u;
          if (typeof pf.v === 'number') app.doc.plotFrame.v = pf.v;
          if (typeof pf.sizeU === 'number') app.doc.plotFrame.sizeU = Math.max(0.25, pf.sizeU);
          if (typeof pf.sizeV === 'number') app.doc.plotFrame.sizeV = Math.max(0.25, pf.sizeV);
        }
        app.doc.rerenderAllShapes();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'rotate_view') {
        if (typeof cmd.angleDeg === 'number' || typeof cmd.viewRotation === 'number') {
          const target = typeof cmd.viewRotation === 'number'
            ? normalizeRotation(cmd.viewRotation)
            : normalizeRotation(Math.round(Number(cmd.angleDeg) / 90));
          const delta = normalizeRotation(target - app.doc.viewRotation);
          if (delta !== 0) {
            app.pushHistory(`旋转视角至 ${target * 90}°`);
            app.doc.rotateView(delta);
          }
        } else {
          const steps = Math.trunc(Number(cmd.steps) || 1);
          app.rotateView(steps >= 0 ? 1 : -1);
          for (let i = 1; i < Math.abs(steps); i++) {
            app.doc.rotateView(steps >= 0 ? 1 : -1);
          }
        }
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'sort_depth') {
        app.sortByDepth();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'undo') {
        const steps = clamp(Math.round(Number(cmd.steps) || 1), 1, 50);
        const labels: string[] = [];
        for (let i = 0; i < steps; i++) {
          const l = app.undo();
          if (!l) break;
          labels.push(l);
        }
        ctx.refreshAll();
        return { undone: labels, state: getStudioState(app) };
      }

      if (action === 'redo') {
        const steps = clamp(Math.round(Number(cmd.steps) || 1), 1, 50);
        const labels: string[] = [];
        for (let i = 0; i < steps; i++) {
          const l = app.redo();
          if (!l) break;
          labels.push(l);
        }
        ctx.refreshAll();
        return { redone: labels, state: getStudioState(app) };
      }

      if (action === 'export_bmeow_json') {
        return {
          docName: app.docName,
          json: serializeBmeowProject(app.doc, app.docName),
        };
      }

      if (action === 'import_bmeow_json') {
        const raw = String(cmd.json || '');
        if (!raw.trim()) throw new Error('import_bmeow_json requires json');
        const { doc, name } = await deserializeBmeowProject(raw);
        app.setDocument(doc, typeof cmd.name === 'string' && cmd.name.trim() ? cmd.name.trim() : name);
        ctx.fitView();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'export_psd_base64') {
        const scale = clamp(Math.round(Number(cmd.scale) || 1), 1, 8);
        const trim = cmd.trim !== false;
        const includeRasters = cmd.includeRasters !== false;
        const includeGroundShadow =
          typeof cmd.includeGroundShadow === 'boolean' ? cmd.includeGroundShadow : undefined;
        const includeInterBlockShadow =
          typeof cmd.includeInterBlockShadow === 'boolean' ? cmd.includeInterBlockShadow : undefined;
        const fourViews = Boolean(cmd.fourViews);
        const hideTheoTownBase = Boolean(cmd.hideTheoTownBase);
        const excludeTheoTownBase = Boolean(cmd.excludeTheoTownBase);
        const activeOnly = Boolean(cmd.activeOnly);
        const layerIds = Array.isArray(cmd.layerIds) ? (cmd.layerIds as number[]) : undefined;
        const layerNames = Array.isArray(cmd.layerNames) ? (cmd.layerNames as string[]) : undefined;

        const out = withTemporaryLayerFilter(
          app,
          { hideTheoTownBase, excludeTheoTownBase, activeOnly, layerIds, layerNames },
          () => {
            const withShadow =
              (includeGroundShadow ?? app.doc.groundShadow.enabled) && app.doc.groundShadow.color.a > 0;
            const withInterBlock =
              (includeInterBlockShadow ?? Boolean(app.doc.groundShadow.interBlockEnabled)) &&
              app.doc.groundShadow.color.a > 0;
            const ab = fourViews
              ? exportFourViewLayersPsd(app.doc, {
                  scale,
                  trim,
                  includeRasters,
                  includeGroundShadow,
                  includeInterBlockShadow,
                })
              : exportBuilderPsd(app.doc, {
                  scale,
                  trim,
                  includeRasters,
                  includeGroundShadow,
                  includeInterBlockShadow,
                });
            const b64 = bytesToBase64(new Uint8Array(ab));
            const dv = new DataView(ab);
            const psdH = ab.byteLength >= 22 ? dv.getUint32(14, false) : app.doc.height * scale;
            const psdW = ab.byteLength >= 22 ? dv.getUint32(18, false) : app.doc.width * scale;
            const exportedBaseLayers = app.doc.layers.filter((l) => includeRasters || l.kind !== 'raster').length;
            return {
              psdBase64: b64,
              bytes: ab.byteLength,
              docName: app.docName,
              width: psdW,
              height: psdH,
              scale,
              fourViews,
              layerCount: fourViews ? 4 : exportedBaseLayers + (withShadow ? 1 : 0) + (withInterBlock ? 1 : 0),
            };
          },
        );
        return out;
      }

      if (action === 'export_png_base64') {
        if (typeof document === 'undefined') {
          throw new Error('export_png_base64 requires a browser/Sidecar canvas environment');
        }
        const scale = clamp(Math.round(Number(cmd.scale) || 1), 1, 8);
        const trim = cmd.trim !== false;
        const includeRasters = cmd.includeRasters !== false;
        const includeGroundShadow =
          typeof cmd.includeGroundShadow === 'boolean' ? cmd.includeGroundShadow : undefined;
        const includeInterBlockShadow =
          typeof cmd.includeInterBlockShadow === 'boolean' ? cmd.includeInterBlockShadow : undefined;
        const fourViews = Boolean(cmd.fourViews);
        const hideTheoTownBase = cmd.hideTheoTownBase !== false && !cmd.activeOnly;
        const excludeTheoTownBase = Boolean(cmd.excludeTheoTownBase);
        const activeOnly = Boolean(cmd.activeOnly);
        const layerIds = Array.isArray(cmd.layerIds) ? (cmd.layerIds as number[]) : undefined;
        const layerNames = Array.isArray(cmd.layerNames) ? (cmd.layerNames as string[]) : undefined;

        return withTemporaryLayerFilter(
          app,
          { hideTheoTownBase, excludeTheoTownBase, activeOnly, layerIds, layerNames },
          () => {
            if (fourViews) {
              const c = renderFourViewStripCanvas(app.doc, {
                scale,
                trim,
                includeRasters,
                includeGroundShadow,
                includeInterBlockShadow,
              });
              return {
                pngBase64: canvasToPngBase64(c),
                width: c.width,
                height: c.height,
                docName: app.docName,
                fourViews: true,
              };
            }
            const c = renderDocumentToPngCanvas(app.doc, {
              scale,
              trim,
              includeRasters,
              includeGroundShadow,
              includeInterBlockShadow,
            });
            return {
              pngBase64: canvasToPngBase64(c),
              width: c.width,
              height: c.height,
              docName: app.docName,
              fourViews: false,
            };
          },
        );
      }

      if (action === 'import_psd_base64') {
        const b64 = String(cmd.psdBase64 || '').trim();
        if (!b64) throw new Error('import_psd_base64 requires psdBase64');
        const u8 = base64ToUint8Array(b64);
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const layers = importPsdAsRasterLayers(ab as ArrayBuffer, app.doc);
        app.pushHistory('AI 导入 PSD 参考图层');
        for (const l of layers) app.doc.layers.unshift(l);
        app.doc.active = 0;
        ctx.refreshAll();
        return { importedLayers: layers.length, state: getStudioState(app) };
      }

      throw new Error(`Unsupported doc_action: "${action}"`);
    }

    case 'layer_action': {
      const action = String(cmd.action || '');
      if (action === 'add_raster_png_base64') {
        const b64 = String(cmd.pngBase64 || '').trim();
        if (!b64) throw new Error('add_raster_png_base64 requires pngBase64');
        const img = await loadImgFromBase64(b64);
        const name = typeof cmd.name === 'string' && cmd.name.trim() ? cmd.name.trim() : 'AI 参考图';
        const role = cmd.rasterRole === 'overlay' ? 'overlay' : 'underlay';
        const layer = app.addRasterLayer(img, name, role);
        ctx.refreshAll();
        return { layerId: layer.id, state: getStudioState(app) };
      }

      if (action === 'clear_all') {
        app.pushHistory('清空重建空白场景');
        app.doc.layers = [];
        app.doc.active = 0;
        if (cmd.withBase) {
          const base = new BuilderLayer(
            app.doc.width,
            app.doc.height,
            `TheoTown ${app.doc.plotU}×${app.doc.plotV} 底座`,
            'shape',
            createDefaultShape('theotown_base', { u: 0, v: 0, zPx: 0, sizeU: app.doc.plotU, sizeV: app.doc.plotV, heightPx: 0 }),
          );
          app.doc.rerenderShapeLayer(base);
          app.doc.layers.push(base);
        }
        ctx.refreshAll();
        return getStudioState(app);
      }

      const { layer, index } = findLayerByRef(app, cmd);

      if (action === 'select') {
        app.doc.active = index;
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'update') {
        app.pushHistory(`修改图层属性「${layer.name}」`);
        if (typeof cmd.name === 'string' && cmd.name.trim()) layer.name = cmd.name.trim();
        if (typeof cmd.visible === 'boolean') layer.visible = cmd.visible;
        if (typeof cmd.opacity === 'number') layer.opacity = clamp(cmd.opacity, 0, 1);
        if (typeof cmd.locked === 'boolean') layer.locked = cmd.locked;
        if (typeof cmd.blend === 'string' && VALID_BLENDS.has(cmd.blend)) layer.blend = cmd.blend as BlendMode;
        if (cmd.rasterRole === 'underlay' || cmd.rasterRole === 'overlay') layer.rasterRole = cmd.rasterRole;
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'duplicate') {
        app.doc.active = index;
        app.duplicateActiveLayer();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'delete') {
        app.doc.active = index;
        app.deleteActiveLayer();
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'move') {
        app.doc.active = index;
        if (typeof cmd.toIndex === 'number') {
          app.reorderLayer(index, clamp(Math.round(cmd.toIndex), 0, app.doc.layers.length - 1));
        } else {
          const delta = Number(cmd.delta) >= 0 ? 1 : -1;
          app.moveLayer(delta);
        }
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'stack_on_below') {
        if (!layer.shape || layer.shape.shapeType === 'theotown_base') {
          throw new Error('stack_on_below requires a 3D shape layer (not theotown_base)');
        }
        const wf = app.doc.getShapeWorldFootprint(layer.shape);
        const tz = app.doc.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0, layer.id);
        app.pushHistory(`叠放「${layer.name}」到下方顶面`);
        layer.shape.zPx = tz;
        app.doc.rerenderShapeLayer(layer);
        if (app.settings.autoSortOnEdit) app.doc.sortLayersByIsoDepth();
        ctx.refreshAll();
        return getStudioState(app);
      }

      throw new Error(`Unsupported layer_action: "${action}"`);
    }

    case 'upsert_shape': {
      const requestedMode = String(cmd.mode || 'auto');
      let targetLayer: BuilderLayer | null = null;
      if (requestedMode === 'update' || typeof cmd.layerId === 'number' || typeof cmd.layerIndex === 'number') {
        targetLayer = findLayerByRef(app, cmd).layer;
      } else if (requestedMode === 'auto' && typeof cmd.name === 'string' && cmd.name.trim()) {
        targetLayer = app.doc.layers.find((l) => l.name === String(cmd.name).trim() && l.kind === 'shape') ?? null;
      }

      if (targetLayer && (!targetLayer.shape || targetLayer.kind !== 'shape')) {
        throw new Error(`Target layer "${targetLayer.name}" is not a parametric 3D shape layer`);
      }

      const rawType = typeof cmd.shapeType === 'string' ? cmd.shapeType : targetLayer?.shape?.shapeType ?? 'box';
      if (!VALID_SHAPES.has(rawType)) throw new Error(`Invalid shapeType "${rawType}"`);
      const nextType = rawType as ShapeKind;

      const shape: ParametricShape = targetLayer?.shape
        ? targetLayer.shape.shapeType === nextType
          ? cloneShape(targetLayer.shape)
          : createDefaultShape(nextType, {
              u: targetLayer.shape.u,
              v: targetLayer.shape.v,
              zPx: targetLayer.shape.zPx,
              sizeU: targetLayer.shape.sizeU,
              sizeV: targetLayer.shape.sizeV,
              heightPx: nextType === 'theotown_base' ? 0 : Math.max(4, targetLayer.shape.heightPx || 24),
              ori: targetLayer.shape.ori,
              baseColor: { ...targetLayer.shape.baseColor },
              roofColor: targetLayer.shape.roofColor ? { ...targetLayer.shape.roofColor } : null,
              autoShade: targetLayer.shape.autoShade,
              shadeContrast: targetLayer.shape.shadeContrast,
              outlineMode: targetLayer.shape.outlineMode,
              outlineColor: targetLayer.shape.outlineColor ? { ...targetLayer.shape.outlineColor } : null,
              edgeHighlight: targetLayer.shape.edgeHighlight,
              pattern: { ...targetLayer.shape.pattern, primaryColor: { ...targetLayer.shape.pattern.primaryColor } },
            })
        : createDefaultShape(nextType);

      const uVal = resolveNumberParam(cmd.u, cmd.uMeters, 'cells');
      const vVal = resolveNumberParam(cmd.v, cmd.vMeters, 'cells');
      const suVal = resolveNumberParam(cmd.sizeU, cmd.sizeUMeters, 'cells');
      const svVal = resolveNumberParam(cmd.sizeV, cmd.sizeVMeters, 'cells');
      const zVal = resolveNumberParam(cmd.zPx, cmd.zMeters, 'zpx');
      const hVal = resolveNumberParam(cmd.heightPx, cmd.heightMeters, 'zpx');

      if (uVal !== undefined) shape.u = clamp(uVal, -16, 48);
      if (vVal !== undefined) shape.v = clamp(vVal, -16, 48);
      if (suVal !== undefined) shape.sizeU = clamp(suVal, 0.0625, 24);
      if (svVal !== undefined) shape.sizeV = clamp(svVal, 0.0625, 24);
      if (hVal !== undefined) shape.heightPx = nextType === 'theotown_base' ? 0 : clamp(Math.round(hVal), 1, 480);
      if (zVal !== undefined) shape.zPx = clamp(Math.round(zVal), -128, 480);

      if (typeof cmd.ori === 'number') shape.ori = normalizeRotation(cmd.ori);
      if (typeof cmd.prismSides === 'number') shape.prismSides = clamp(Math.round(cmd.prismSides), 3, 16);
      if (cmd.triPrismCut === 'vertical' || cmd.triPrismCut === 'slope') shape.triPrismCut = cmd.triPrismCut as TriPrismCut;
      if (cmd.wedgeMode === 'ramp' || cmd.wedgeMode === 'gable') shape.wedgeMode = cmd.wedgeMode;
      if (cmd.domeMode === 'dome' || cmd.domeMode === 'sphere') shape.domeMode = cmd.domeMode;

      // Arch options
      if (shape.shapeType === 'arch') {
        if (typeof cmd.archHollow === 'boolean') shape.archHollow = cmd.archHollow;
        if (cmd.archHollowStyle === 'shell' || cmd.archHollowStyle === 'portal') shape.archHollowStyle = cmd.archHollowStyle;
        if (cmd.archInnerMode === 'parallel' || cmd.archInnerMode === 'proportional' || cmd.archInnerMode === 'equal_vertical' || cmd.archInnerMode === 'custom') {
          shape.archInnerMode = cmd.archInnerMode;
        }
        if (typeof cmd.archThickness === 'number') shape.archThickness = clamp(cmd.archThickness, 0.06, 0.72);
        if (typeof cmd.archPreset === 'string') {
          const presetId = cmd.archPreset as ArchPresetId;
          shape.archNodes = createArchPresetNodes(presetId);
          if (shape.archHollow && shape.archInnerMode !== 'custom') {
            shape.archInnerNodes = createScaledInnerPresetNodes(
              presetId,
              shape.archThickness ?? 0.28,
              shape.sizeU * 32,
              shape.heightPx,
            );
          }
        }
        if (Array.isArray(cmd.archNodes)) {
          shape.archNodes = normalizeArchNodes(cmd.archNodes as ArchNode[], false);
        }
        if (Array.isArray(cmd.archInnerNodes)) {
          shape.archInnerNodes = normalizeArchNodes(cmd.archInnerNodes as ArchNode[], true);
        }
      }

      // Loft options
      if (shape.shapeType === 'loft') {
        if (cmd.loftInterp === 'smooth' || cmd.loftInterp === 'linear') shape.loftInterp = cmd.loftInterp;
        if (typeof cmd.loftHollow === 'boolean') shape.loftHollow = cmd.loftHollow;
        if (typeof cmd.loftFloorT === 'number') {
          if (cmd.loftFloorT > 0) shape.loftFloorT = clamp(cmd.loftFloorT, 0, 0.9);
          else delete shape.loftFloorT;
        }
        if (Array.isArray(cmd.loftSections)) {
          shape.loftSections = normalizeLoftSections(cmd.loftSections as LoftSection[]);
        } else if (typeof cmd.loftPreset === 'string') {
          const presetId = cmd.loftPreset as LoftPresetId;
          const presetNodes = createLoftPresetNodes(presetId);
          const curSecs = normalizeLoftSections(shape.loftSections);
          const topScale = typeof cmd.topScale === 'number' ? clamp(cmd.topScale, 0.15, 1.5) : 1;
          shape.loftSections = curSecs.map((sec, idx) => ({
            ...sec,
            scale: idx === curSecs.length - 1 && typeof cmd.topScale === 'number' ? topScale : sec.scale,
            nodes: presetNodes.map((n) => ({ ...n })),
            innerNodes: shape.loftHollow
              ? createScaledLoftInnerPresetNodes(presetId, sec.innerThickness ?? 0.25, sec, shape.sizeU, shape.sizeV)
              : sec.innerNodes,
          }));
        }
        if (shape.loftSections && shape.loftSections.length > 0) {
          syncLoftTransitionSections(shape.loftSections, shape.sizeU, shape.sizeV);
        }
      }

      if (isColumnSectionShape(shape)) {
        syncColumnSectionsEdgeCount(shape);
      }

      // Material & shading
      const baseCol = parseColorSpec(cmd.baseColor);
      if (baseCol) shape.baseColor = { ...baseCol, a: 255 };
      if (cmd.roofColor === null || cmd.roofColor === 'none') {
        shape.roofColor = null;
      } else {
        const rc = parseColorSpec(cmd.roofColor);
        if (rc) shape.roofColor = { ...rc, a: 255 };
      }
      if (typeof cmd.autoShade === 'boolean') shape.autoShade = cmd.autoShade;
      if (typeof cmd.shadeContrast === 'number') shape.shadeContrast = clampShadeContrast(cmd.shadeContrast);
      if (typeof cmd.outlineMode === 'string' && VALID_OUTLINES.has(cmd.outlineMode)) {
        shape.outlineMode = cmd.outlineMode as OutlineMode;
      }
      if (cmd.outlineColor === null || cmd.outlineColor === 'none') {
        shape.outlineColor = null;
      } else {
        const oc = parseColorSpec(cmd.outlineColor);
        if (oc) shape.outlineColor = { ...oc, a: 255 };
      }
      if (typeof cmd.edgeHighlight === 'boolean') shape.edgeHighlight = cmd.edgeHighlight;

      if (cmd.pattern && typeof cmd.pattern === 'object') {
        const p = cmd.pattern as Record<string, unknown>;
        if (typeof p.type === 'string' && VALID_PATTERNS.has(p.type)) {
          shape.pattern.type = p.type as FacadePatternType;
        }
        const pc = parseColorSpec(p.primaryColor);
        if (pc) shape.pattern.primaryColor = { ...pc, a: 255 };
        if (typeof p.rows === 'number') shape.pattern.rows = clamp(Math.round(p.rows), 1, 24);
        if (typeof p.cols === 'number') shape.pattern.cols = clamp(Math.round(p.cols), 1, 24);
        if (typeof p.spacingPx === 'number') shape.pattern.spacingPx = clamp(Math.round(p.spacingPx), 1, 12);
        if (typeof p.marginPx === 'number') shape.pattern.marginPx = clamp(Math.round(p.marginPx), 0, 12);
        if (typeof p.applyTop === 'boolean') shape.pattern.applyTop = p.applyTop;
      }

      sanitizeFaceTexturesForShape(shape);

      if (targetLayer) {
        if (cmd.stackOnBelow) {
          const wf = app.doc.getShapeWorldFootprint(shape);
          shape.zPx = app.doc.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0, targetLayer.id);
        }
        app.pushHistory(`AI 更新 3D 图层「${targetLayer.name}」`);
        targetLayer.shape = cloneShape(shape);
        if (typeof cmd.name === 'string' && cmd.name.trim()) targetLayer.name = cmd.name.trim();
        if (typeof cmd.visible === 'boolean') targetLayer.visible = cmd.visible;
        if (typeof cmd.opacity === 'number') targetLayer.opacity = clamp(cmd.opacity, 0, 1);
        if (typeof cmd.blend === 'string' && VALID_BLENDS.has(cmd.blend)) targetLayer.blend = cmd.blend as BlendMode;
        app.doc.rerenderShapeLayer(targetLayer);
        if (app.settings.autoSortOnEdit) app.doc.sortLayersByIsoDepth();
        ctx.refreshAll();
        return { action: 'updated', layerId: targetLayer.id, state: getStudioState(app) };
      }

      if (cmd.stackOnBelow) {
        const wf = app.doc.getShapeWorldFootprint(shape);
        shape.zPx = app.doc.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0);
      }
      const label = typeof cmd.name === 'string' && cmd.name.trim()
        ? cmd.name.trim()
        : `${SHAPE_LABELS[shape.shapeType]} ${app.doc.layers.length + 1}`;
      const created = app.addShapeLayer(shape, label);
      if (typeof cmd.visible === 'boolean') created.visible = cmd.visible;
      if (typeof cmd.opacity === 'number') created.opacity = clamp(cmd.opacity, 0, 1);
      if (typeof cmd.blend === 'string' && VALID_BLENDS.has(cmd.blend)) created.blend = cmd.blend as BlendMode;
      ctx.refreshAll();
      return { action: 'created', layerId: created.id, state: getStudioState(app) };
    }

    case 'edit_structure': {
      const { layer } = findLayerByRef(app, cmd);
      if (!layer.shape) throw new Error(`Layer "${layer.name}" has no 3D shape`);
      const subAction = String(cmd.subAction || '');
      const s = layer.shape;

      if (subAction === 'arch_preset') {
        if (s.shapeType !== 'arch') throw new Error('arch_preset requires an arch shape');
        app.pushHistory(`AI 应用拱形预设「${cmd.preset}」`);
        const nodes = createArchPresetNodes(cmd.preset as ArchPresetId);
        if (cmd.target === 'inner') {
          s.archHollow = true;
          s.archInnerMode = 'custom';
          s.archInnerNodes = nodes;
        } else {
          s.archNodes = nodes;
        }
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (subAction === 'arch_nodes') {
        if (s.shapeType !== 'arch') throw new Error('arch_nodes requires an arch shape');
        app.pushHistory('AI 修改拱形控制点');
        if (typeof cmd.archHollow === 'boolean') s.archHollow = cmd.archHollow;
        if (cmd.archHollowStyle === 'shell' || cmd.archHollowStyle === 'portal') s.archHollowStyle = cmd.archHollowStyle;
        if (cmd.archInnerMode === 'parallel' || cmd.archInnerMode === 'proportional' || cmd.archInnerMode === 'equal_vertical' || cmd.archInnerMode === 'custom') {
          s.archInnerMode = cmd.archInnerMode;
        }
        if (typeof cmd.archThickness === 'number') s.archThickness = clamp(cmd.archThickness, 0.06, 0.72);
        if (Array.isArray(cmd.nodes)) s.archNodes = normalizeArchNodes(cmd.nodes as ArchNode[], false);
        if (Array.isArray(cmd.innerNodes)) s.archInnerNodes = normalizeArchNodes(cmd.innerNodes as ArchNode[], true);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (subAction === 'arch_slide_node') {
        if (s.shapeType !== 'arch') throw new Error('arch_slide_node requires an arch shape');
        const idx = Math.round(Number(cmd.nodeIndex) || 0);
        const arcS = clamp(Number(cmd.arcS) || 0.5, 0, 1);
        const isInner = Boolean(cmd.isInner);
        const targetList = isInner ? s.archInnerNodes : s.archNodes;
        if (!targetList || idx < 0 || idx >= targetList.length) {
          throw new Error(`Invalid arch nodeIndex ${idx}`);
        }
        app.pushHistory('AI 沿轨微调拱形节点');
        const origClone = targetList.map((nd) => ({ ...nd }));
        const rail = buildArchNodeSlideRail(origClone, idx);
        applyArchNodeSlideAtArcS(targetList, origClone, idx, rail, arcS, isInner);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (subAction === 'loft_add_section') {
        if (s.shapeType !== 'loft') throw new Error('loft_add_section requires a loft shape');
        app.pushHistory('AI 新增曲面柱控制面');
        const secs = normalizeLoftSections(s.loftSections);
        const t = clamp(Number(cmd.t) || 0.5, 0, 1);
        const preset = (typeof cmd.preset === 'string' ? cmd.preset : 'rounded_rect') as LoftPresetId;
        const nodes = createLoftPresetNodes(preset);
        const created: LoftSection = {
          id: nextLoftSectionId(),
          name: typeof cmd.name === 'string' && cmd.name.trim() ? cmd.name.trim() : `控制面 #${secs.length + 1}`,
          t,
          scale: clamp(Number(cmd.scale ?? 1), 0.1, 1.8),
          twistDeg: clamp(Number(cmd.twistDeg ?? 0), -180, 180),
          offsetU: clamp(Number(cmd.offsetU ?? 0), -0.5, 0.5),
          offsetV: clamp(Number(cmd.offsetV ?? 0), -0.5, 0.5),
          nodes,
          isTransition: Boolean(cmd.isTransition),
          innerMode: (typeof cmd.innerMode === 'string' ? cmd.innerMode : 'parallel') as LoftInnerMode,
          innerThickness: clamp(Number(cmd.innerThickness ?? 0.25), 0.06, 0.78),
        };
        secs.push(created);
        secs.sort((a, b) => a.t - b.t);
        s.loftSections = secs;
        s.activeLoftSectionId = created.id;
        syncLoftTransitionSections(s.loftSections, s.sizeU, s.sizeV);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (subAction === 'loft_update_section') {
        if (s.shapeType !== 'loft') throw new Error('loft_update_section requires a loft shape');
        const secs = normalizeLoftSections(s.loftSections);
        const idx = typeof cmd.sectionId === 'string'
          ? secs.findIndex((x) => x.id === cmd.sectionId)
          : clamp(Math.round(Number(cmd.sectionIndex) || 0), 0, secs.length - 1);
        const sec = secs[idx];
        if (!sec) throw new Error('Target loft section not found');
        app.pushHistory(`AI 更新曲面控制面「${sec.name}」`);
        if (typeof cmd.name === 'string' && cmd.name.trim()) sec.name = cmd.name.trim();
        if (typeof cmd.t === 'number') sec.t = clamp(cmd.t, 0, 1);
        if (typeof cmd.scale === 'number') sec.scale = clamp(cmd.scale, 0.1, 1.8);
        if (typeof cmd.twistDeg === 'number') sec.twistDeg = clamp(cmd.twistDeg, -180, 180);
        if (typeof cmd.offsetU === 'number') sec.offsetU = clamp(cmd.offsetU, -0.5, 0.5);
        if (typeof cmd.offsetV === 'number') sec.offsetV = clamp(cmd.offsetV, -0.5, 0.5);
        if (typeof cmd.preset === 'string') sec.nodes = createLoftPresetNodes(cmd.preset as LoftPresetId);
        if (typeof cmd.innerMode === 'string') sec.innerMode = cmd.innerMode as LoftInnerMode;
        if (typeof cmd.innerThickness === 'number') sec.innerThickness = clamp(cmd.innerThickness, 0.06, 0.78);
        if (cmd.isTransition === true) {
          convertLoftSectionToTransition(secs, sec.id, s.sizeU, s.sizeV, true);
        } else if (cmd.isTransition === false) {
          delete sec.isTransition;
        }
        secs.sort((a, b) => a.t - b.t);
        s.loftSections = secs;
        syncLoftTransitionSections(s.loftSections, s.sizeU, s.sizeV);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (subAction === 'loft_delete_section') {
        if (s.shapeType !== 'loft') throw new Error('loft_delete_section requires a loft shape');
        const secs = normalizeLoftSections(s.loftSections);
        if (secs.length <= 2) throw new Error('Loft requires at least 2 control sections');
        const idx = typeof cmd.sectionId === 'string'
          ? secs.findIndex((x) => x.id === cmd.sectionId)
          : clamp(Math.round(Number(cmd.sectionIndex) || 0), 0, secs.length - 1);
        if (!secs[idx]) throw new Error('Target loft section not found');
        app.pushHistory('AI 删除曲面控制面');
        secs.splice(idx, 1);
        s.loftSections = secs;
        syncLoftTransitionSections(s.loftSections, s.sizeU, s.sizeV);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (subAction === 'col_enable' || subAction === 'col_add_section' || subAction === 'col_update_section' || subAction === 'col_update_edge') {
        if (!isColumnSectionShape(s)) throw new Error(`${subAction} requires box, prism, cylinder, or vertical right_tri_prism`);
        app.pushHistory(`AI 柱体截面编辑 (${subAction})`);
        const secs = ensureColumnSections(s);
        if (cmd.colInterp === 'smooth' || cmd.colInterp === 'linear') s.colInterp = cmd.colInterp as ColumnInterpMode;
        if (subAction === 'col_add_section') {
          const t = clamp(Number(cmd.t ?? 0.5), 0, 1);
          const created = cmd.isTransition
            ? insertColumnTransitionSection(s, t)
            : insertColumnSectionAtT(s, t, typeof cmd.name === 'string' ? cmd.name : undefined);
          if (created) s.activeColSectionId = created.id;
        } else if (subAction === 'col_update_section') {
          const idx = typeof cmd.sectionId === 'string'
            ? secs.findIndex((x) => x.id === cmd.sectionId)
            : clamp(Math.round(Number(cmd.sectionIndex) || 0), 0, secs.length - 1);
          const sec = secs[idx];
          if (!sec) throw new Error('Target column section not found');
          if (typeof cmd.t === 'number') sec.t = clamp(cmd.t, 0, 1);
          if (typeof cmd.name === 'string' && cmd.name.trim()) sec.name = cmd.name.trim();
          applyColumnSectionTransform(sec, {
            scale: typeof cmd.scale === 'number' ? cmd.scale : undefined,
            twistDeg: typeof cmd.twistDeg === 'number' ? cmd.twistDeg : undefined,
            offsetU: typeof cmd.offsetU === 'number' ? cmd.offsetU : undefined,
            offsetV: typeof cmd.offsetV === 'number' ? cmd.offsetV : undefined,
          });
          if (cmd.isTransition === true) convertColumnSectionToTransition(s, sec.id);
          else if (cmd.isTransition === false) delete sec.isTransition;
          secs.sort((a, b) => a.t - b.t);
          syncColumnTransitionSections(s);
        } else if (subAction === 'col_update_edge') {
          const secIdx = clamp(Math.round(Number(cmd.sectionIndex) || 0), 0, secs.length - 1);
          const sec = secs[secIdx];
          const edgeIdx = clamp(Math.round(Number(cmd.edgeIndex) || 0), 0, Math.max(0, sec.edges.length - 1));
          const curEdge = sec.edges[edgeIdx];
          if (!curEdge) throw new Error('Target column edge not found');
          if (typeof cmd.locked === 'boolean') curEdge.locked = cmd.locked;
          const targetOffset = typeof cmd.offset === 'number' ? cmd.offset : curEdge.offset;
          const targetAngle = typeof cmd.angleDeg === 'number' ? cmd.angleDeg : curEdge.angleDeg;
          applyColumnEdgeEdit(sec, edgeIdx, targetOffset, targetAngle, { pivotMidpoint: Boolean(cmd.pivotMidpoint) });
          syncColumnTransitionSections(s);
        }
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      throw new Error(`Unsupported edit_structure subAction: "${subAction}"`);
    }

    case 'texture_action': {
      const action = String(cmd.action || '');

      if (action === 'list_faces') {
        const { layer } = findLayerByRef(app, cmd);
        if (!layer.shape || !isPlanarTextureShape(layer.shape)) {
          throw new Error(`Layer "${layer.name}" does not support planar face textures`);
        }
        return {
          layerId: layer.id,
          layerName: layer.name,
          faces: getPlanarFacesForShape(layer.shape),
          faceTextures: layer.shape.faceTextures ?? {},
        };
      }

      if (action === 'manage_group') {
        const sub = String(cmd.op || '');
        if (sub === 'create') {
          const g = createTextureGroup(String(cmd.name || '新分组'));
          ctx.refreshAll();
          return { group: g, textureGroups: getTextureGroups() };
        }
        if (sub === 'rename') {
          const ok = renameTextureGroup(String(cmd.groupId || ''), String(cmd.name || ''));
          ctx.refreshAll();
          return { ok, textureGroups: getTextureGroups() };
        }
        if (sub === 'delete') {
          const ok = deleteTextureGroup(String(cmd.groupId || ''));
          ctx.refreshAll();
          return { ok, textureGroups: getTextureGroups() };
        }
        if (sub === 'move_asset') {
          const ok = setTextureAssetGroup(String(cmd.assetId || ''), String(cmd.groupId || DEFAULT_USER_GROUP_ID));
          ctx.refreshAll();
          return { ok };
        }
        throw new Error(`Unsupported manage_group op: "${sub}"`);
      }

      if (action === 'import_asset') {
        let data: Uint8ClampedArray;
        let width: number;
        let height: number;
        if (cmd.spriteMatrix && typeof cmd.spriteMatrix === 'object') {
          const sm = cmd.spriteMatrix as {
            rows: string[];
            paletteSpec?: string;
            palette?: Record<string, string | null>;
            scale?: number;
          };
          const built = buildSpriteMatrixBuffer(sm);
          data = built.data;
          width = built.width;
          height = built.height;
        } else if (typeof cmd.rgbaBase64 === 'string' && typeof cmd.width === 'number' && typeof cmd.height === 'number') {
          width = Math.max(1, Math.round(cmd.width));
          height = Math.max(1, Math.round(cmd.height));
          const raw = base64ToUint8Array(cmd.rgbaBase64);
          data = new Uint8ClampedArray(width * height * 4);
          data.set(raw.subarray(0, data.length));
        } else if (typeof cmd.pngBase64 === 'string') {
          const url = cmd.pngBase64.startsWith('data:') ? cmd.pngBase64 : `data:image/png;base64,${cmd.pngBase64}`;
          const dec = await pngDataUrlToRgba(url);
          if (!dec) throw new Error('Failed to decode pngBase64 into RGBA buffer');
          data = dec.data;
          width = dec.width;
          height = dec.height;
        } else {
          throw new Error('import_asset requires spriteMatrix, rgbaBase64+width+height, or pngBase64');
        }

        let targetGroupId = typeof cmd.groupId === 'string' && cmd.groupId.trim() ? cmd.groupId.trim() : '';
        if (!targetGroupId && typeof cmd.groupName === 'string' && cmd.groupName.trim()) {
          const gName = cmd.groupName.trim();
          const existing = getTextureGroups().find((g) => g.name === gName);
          targetGroupId = existing && existing.id !== BUILTIN_PRESET_GROUP_ID
            ? existing.id
            : createTextureGroup(gName).id;
        }

        let paraConfig;
        if (cmd.shear && typeof cmd.shear === 'object') {
          const sh = cmd.shear as { direction?: ShearDirection; step?: number };
          const dir: ShearDirection = sh.direction === 'up_right' ? 'up_right' : 'down_right';
          const step = clamp(Math.round(sh.step ?? 2), 1, 8);
          const shPreview = shearPixels(data, width, height, dir, step);
          paraConfig = {
            mode: 'sawtooth' as const,
            direction: dir,
            step,
            uVec: [shPreview.width - step * Math.max(0, height - 1), dir === 'down_right' ? (height - 1) : -(height - 1)] as [number, number],
            vVec: [0, height] as [number, number],
          };
        }

        const asset = makeTextureAssetFromRgba({
          id: typeof cmd.id === 'string' && cmd.id.trim() ? cmd.id.trim() : undefined,
          name: typeof cmd.name === 'string' && cmd.name.trim() ? cmd.name.trim() : 'AI 自定义纹理',
          width,
          height,
          rectData: data,
          displayForm: cmd.displayForm === 'parallelogram' ? 'parallelogram' : 'rect',
          paraConfig,
          groupId: targetGroupId || DEFAULT_USER_GROUP_ID,
        });
        upsertTextureAsset(asset);
        ctx.refreshAll();
        return {
          asset: {
            id: asset.id,
            name: asset.name,
            width: asset.width,
            height: asset.height,
            groupId: resolveAssetGroupId(asset),
            displayForm: asset.displayForm,
          },
        };
      }

      const { layer } = findLayerByRef(app, cmd);
      const shape = layer.shape;
      if (!shape || !isPlanarTextureShape(shape)) {
        throw new Error(`Layer "${layer.name}" does not support planar face textures`);
      }
      const faces = getPlanarFacesForShape(shape);
      const targetFaceId =
        (typeof cmd.faceId === 'string' && faces.some((f) => f.id === cmd.faceId) ? cmd.faceId : undefined)
        ?? app.getActiveFaceId(layer.id, shape)
        ?? faces[0]?.id;
      const faceSpec = faces.find((f) => f.id === targetFaceId);
      if (!faceSpec) throw new Error('No planar face available on target shape');

      if (action === 'set_face_texture') {
        app.pushHistory(`AI 设置平面「${faceSpec.shortLabel}」纹理`);
        const mode = (typeof cmd.mode === 'string' ? cmd.mode : 'stretch') as FaceTextureMode;
        if (!shape.faceTextures) shape.faceTextures = {};
        if (mode === 'none') {
          delete shape.faceTextures[faceSpec.id];
          if (Object.keys(shape.faceTextures).length === 0) delete shape.faceTextures;
        } else {
          const assetId = typeof cmd.assetId === 'string' ? cmd.assetId : undefined;
          const asset = assetId ? getTextureAsset(assetId) : undefined;
          if ((mode === 'stretch' || mode === 'tile') && !asset) {
            throw new Error(`Texture asset "${assetId ?? ''}" not found`);
          }
          const crop = asset && cmd.crop
            ? normalizeCropRect(cmd.crop as TextureCropRect, asset.width, asset.height)
            : undefined;
          const slot: FaceTextureSlot = {
            mode,
            assetId: asset?.id,
            crop,
            tileScale: typeof cmd.tileScale === 'number' ? clamp(cmd.tileScale, 0.25, 8) : undefined,
            offsetX: typeof cmd.offsetX === 'number' ? Math.round(cmd.offsetX) : undefined,
            offsetY: typeof cmd.offsetY === 'number' ? Math.round(cmd.offsetY) : undefined,
            flipX: typeof cmd.flipX === 'boolean' ? cmd.flipX : undefined,
            flipY: typeof cmd.flipY === 'boolean' ? cmd.flipY : undefined,
            rot90: typeof cmd.rot90 === 'number' ? normalizeRotation(cmd.rot90) : undefined,
            opacity: typeof cmd.opacity === 'number' ? clamp(cmd.opacity, 0.05, 1) : 1,
            shadeWithFace: cmd.shadeWithFace !== false,
          };
          const targets = cmd.applyToAllSides
            ? faces.filter((f) => !f.isTop)
            : [faceSpec];
          for (const tf of targets) {
            shape.faceTextures[tf.id] = { ...slot, crop: slot.crop ? { ...slot.crop } : undefined };
          }
        }
        app.setActiveFaceId(layer.id, faceSpec.id, shape);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'compose_face_decals') {
        const items = Array.isArray(cmd.items) ? (cmd.items as FaceDecalItem[]) : [];
        app.pushHistory(`AI 拼贴组合「${faceSpec.shortLabel}」`);
        if (!shape.faceTextures) shape.faceTextures = {};
        const prev = shape.faceTextures[faceSpec.id];
        const baseItems = cmd.append && prev?.mode === 'custom' && Array.isArray(prev.items) ? [...prev.items] : [];
        const cleanItems: FaceDecalItem[] = items.map((it, i) => ({
          id: it.id || `d_${Date.now().toString(36)}_${i}`,
          assetId: it.assetId,
          crop: it.crop,
          x: Math.round(it.x ?? 0),
          y: Math.round(it.y ?? 0),
          w: Math.max(1, Math.round(it.w ?? 8)),
          h: Math.max(1, Math.round(it.h ?? 8)),
          tileFill: Boolean(it.tileFill),
          flipX: Boolean(it.flipX),
          flipY: Boolean(it.flipY),
          rot90: typeof it.rot90 === 'number' ? normalizeRotation(it.rot90) : 0,
          opacity: typeof it.opacity === 'number' ? clamp(it.opacity, 0.05, 1) : 1,
          visible: it.visible !== false,
        }));
        shape.faceTextures[faceSpec.id] = {
          mode: 'custom',
          shadeWithFace: cmd.shadeWithFace !== undefined ? Boolean(cmd.shadeWithFace) : (prev?.shadeWithFace ?? true),
          items: [...baseItems, ...cleanItems],
        };
        app.setActiveFaceId(layer.id, faceSpec.id, shape);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return getStudioState(app);
      }

      if (action === 'paint_face_pixels') {
        const curSlot = shape.faceTextures?.[faceSpec.id];
        const extracted = extractFaceTextureLayerBuffer(faceSpec, curSlot);
        let work = new Uint8ClampedArray(extracted.data);
        const w = extracted.width;
        const h = extracted.height;
        const ops = Array.isArray(cmd.ops) ? (cmd.ops as Record<string, unknown>[]) : [];

        for (const op of ops) {
          const opType = String(op.type || '');
          if (opType === 'sprite_matrix') {
            const ox = Math.round(Number(op.x) || 0);
            const oy = Math.round(Number(op.y) || 0);
            const sm = buildSpriteMatrixBuffer({
              rows: (op.rows as string[]) || [],
              paletteSpec: typeof op.paletteSpec === 'string' ? op.paletteSpec : undefined,
              palette: typeof op.palette === 'object' ? (op.palette as Record<string, string | null>) : undefined,
              scale: typeof op.scale === 'number' ? op.scale : 1,
            });
            for (let sy = 0; sy < sm.height; sy++) {
              const ty = oy + sy;
              if (ty < 0 || ty >= h) continue;
              for (let sx = 0; sx < sm.width; sx++) {
                const tx = ox + sx;
                if (tx < 0 || tx >= w) continue;
                const si = (sy * sm.width + sx) * 4;
                if (sm.data[si + 3] === 0 && op.blend !== 'replace') continue;
                const di = (ty * w + tx) * 4;
                work[di] = sm.data[si];
                work[di + 1] = sm.data[si + 1];
                work[di + 2] = sm.data[si + 2];
                work[di + 3] = sm.data[si + 3];
              }
            }
          } else if (opType === 'rect') {
            const col = parseColorSpec(op.color) ?? { r: 255, g: 255, b: 255, a: 255 };
            const rx0 = clamp(Math.round(Number(op.x) || 0), 0, w);
            const ry0 = clamp(Math.round(Number(op.y) || 0), 0, h);
            const rx1 = clamp(rx0 + Math.round(Number(op.w) || 1), 0, w);
            const ry1 = clamp(ry0 + Math.round(Number(op.h) || 1), 0, h);
            for (let y = ry0; y < ry1; y++) {
              for (let x = rx0; x < rx1; x++) {
                const di = (y * w + x) * 4;
                work[di] = col.r;
                work[di + 1] = col.g;
                work[di + 2] = col.b;
                work[di + 3] = col.a;
              }
            }
          } else if (opType === 'pixels' || opType === 'stroke') {
            const col = parseColorSpec(op.color) ?? { r: 255, g: 255, b: 255, a: 255 };
            const pts = Array.isArray(op.points) ? (op.points as [number, number][]) : [];
            const mode = op.mode === 'erase' ? 'erase' : 'paint';
            const stroked = plotPixelPerfectStroke(work, w, h, pts, col, mode, null);
            work.set(stroked);
          }
        }

        app.pushHistory(`AI 像素精修「${faceSpec.shortLabel}」`);
        const baked = applyEditedFaceBufferToShape({
          shape,
          layerId: layer.id,
          faceSpec,
          rgbaData: work,
          width: w,
          height: h,
          assetName: typeof cmd.assetName === 'string' ? cmd.assetName : undefined,
        });
        app.setActiveFaceId(layer.id, faceSpec.id, shape);
        app.doc.rerenderShapeLayer(layer);
        ctx.refreshAll();
        return {
          bakedAssetId: baked.id,
          width: w,
          height: h,
          state: getStudioState(app),
        };
      }

      throw new Error(`Unsupported texture_action: "${action}"`);
    }

    default:
      throw new Error(`Unknown AI Studio command kind: "${kind}"`);
  }
}
