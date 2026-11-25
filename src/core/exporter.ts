// PNG export, 4-direction sprite strip export, and .bmeow native parametric project serialization
import { normalizeArchNodes } from './arch';
import {
  ensureActiveColumnSection,
  isColumnSectionShape,
  normalizeColumnSections,
} from './columnSections';
import { parseColorCode, toHex8 } from './color';
import { tr } from './i18n';
import {
  DEFAULT_GROUND_SHADOW_COLOR,
  cloneGroundShadowConfig,
} from './groundShadow';
import { BuilderDocument, BuilderLayer, type BlendMode, type PlotFrameConfig } from './document';
import { getDocumentContentBounds } from './psd';
import { clampShadeContrast, cloneShape, normalizeShadeSteps, type ParametricShape } from './isoRenderer';
import type { ViewRotation } from './isoMath';
import { ensureActiveLoftSection, normalizeLoftSections } from './loft';
import {
  BUILTIN_PRESET_GROUP_ID,
  DEFAULT_USER_GROUP_ID,
  collectReferencedTextureAssetIds,
  getPersistableTextureGroups,
  getTextureAsset,
  registerSerializedTextureAssets,
  registerSerializedTextureGroups,
  resolveAssetGroupId,
  sanitizeFaceTexturesForShape,
  serializeTextureAsset,
  type SerializedTextureAsset,
  type TextureGroup,
} from './textures';

export interface PngExportOptions {
  scale?: number;
  trim?: boolean;
  includeRasters?: boolean;
  includeGroundShadow?: boolean;
  includeInterBlockShadow?: boolean;
}

export function renderDocumentToPngCanvas(doc: BuilderDocument, opts: PngExportOptions = {}): HTMLCanvasElement {
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const includeRasters = opts.includeRasters ?? true;
  const withShadow = (opts.includeGroundShadow ?? doc.groundShadow.enabled) && doc.groundShadow.color.a > 0;
  const withInterBlock =
    (opts.includeInterBlockShadow ?? Boolean(doc.groundShadow.interBlockEnabled)) && doc.groundShadow.color.a > 0;
  const prevShadowEnabled = doc.groundShadow.enabled;
  const prevInterBlockEnabled = doc.groundShadow.interBlockEnabled;
  doc.groundShadow.enabled = withShadow;
  doc.groundShadow.interBlockEnabled = withInterBlock;
  try {
    const rendered = doc.render(includeRasters);
    const bounds = opts.trim
      ? getDocumentContentBounds(doc, includeRasters, false, withShadow) ?? { x: 0, y: 0, w: doc.width, h: doc.height }
      : { x: 0, y: 0, w: doc.width, h: doc.height };

    const out = document.createElement('canvas');
    out.width = bounds.w * scale;
    out.height = bounds.h * scale;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (rendered) {
      ctx.drawImage(rendered, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, out.width, out.height);
    }
    return out;
  } finally {
    doc.groundShadow.enabled = prevShadowEnabled;
    doc.groundShadow.interBlockEnabled = prevInterBlockEnabled;
  }
}

export function canvasToPngBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => {
    c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 编码失败'))), 'image/png');
  });
}

/**
 * Exports all 4 isometric 90° viewpoints (0°, 90°, 180°, 270°) into a single horizontal sprite strip PNG.
 */
export function renderFourViewStripCanvas(doc: BuilderDocument, opts: PngExportOptions = {}): HTMLCanvasElement {
  const origRot = doc.viewRotation;
  const origOrder = [...doc.layers];
  const origActiveLayer = doc.layer;
  const prevShadowEnabled = doc.groundShadow.enabled;
  const prevInterBlockEnabled = doc.groundShadow.interBlockEnabled;
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const includeRasters = opts.includeRasters ?? false;
  const withShadow = (opts.includeGroundShadow ?? doc.groundShadow.enabled) && doc.groundShadow.color.a > 0;
  const withInterBlock =
    (opts.includeInterBlockShadow ?? Boolean(doc.groundShadow.interBlockEnabled)) && doc.groundShadow.color.a > 0;
  const panels: HTMLCanvasElement[] = [];

  try {
    doc.groundShadow.enabled = withShadow;
    doc.groundShadow.interBlockEnabled = withInterBlock;
    for (let r = 0; r < 4; r++) {
      doc.viewRotation = ((origRot + r) % 4) as ViewRotation;
      if (doc.autoSortOnRotate) doc.sortLayersByIsoDepth();
      doc.rerenderAllShapes();
      panels.push(
        renderDocumentToPngCanvas(doc, {
          scale,
          trim: opts.trim,
          includeRasters,
          includeGroundShadow: withShadow,
          includeInterBlockShadow: withInterBlock,
        }),
      );
    }
  } finally {
    doc.viewRotation = origRot;
    doc.layers = origOrder;
    doc.active = origActiveLayer
      ? Math.max(0, origOrder.indexOf(origActiveLayer))
      : Math.max(0, Math.min(doc.active, origOrder.length - 1));
    doc.groundShadow.enabled = prevShadowEnabled;
    doc.groundShadow.interBlockEnabled = prevInterBlockEnabled;
    doc.rerenderAllShapes();
  }

  const maxH = Math.max(...panels.map((p) => p.height));
  const totalW = panels.reduce((acc, p) => acc + p.width, 0);
  const strip = document.createElement('canvas');
  strip.width = Math.max(1, totalW);
  strip.height = Math.max(1, maxH);
  const ctx = strip.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  let x = 0;
  for (const p of panels) {
    ctx.drawImage(p, x, maxH - p.height);
    x += p.width;
  }
  return strip;
}

// -------- Native .bmeow Parametric Project JSON Format --------

export interface SerializedBmeowLayer {
  name: string;
  kind: 'shape' | 'raster';
  rasterRole: 'underlay' | 'overlay';
  shape?: ParametricShape;
  pngDataUrl?: string;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blend: BlendMode;
}

export interface SerializedBmeowProject {
  format: 'bmeow-v1';
  name: string;
  width: number;
  height: number;
  plotU: number;
  plotV: number;
  bottomMarginPx: number;
  viewRotation: ViewRotation;
  autoSortOnRotate: boolean;
  plotFrame?: PlotFrameConfig;
  groundShadow?: { enabled: boolean; interBlockEnabled?: boolean; colorHex8: string };
  shadeSteps?: number;
  active: number;
  layers: SerializedBmeowLayer[];
  textureAssets?: SerializedTextureAsset[];
  textureGroups?: TextureGroup[];
}

export function serializeBmeowProject(doc: BuilderDocument, name: string): string {
  const refAssetIds = collectReferencedTextureAssetIds(doc.layers.map((l) => l.shape));
  const serializedAssets: SerializedTextureAsset[] = [];
  const refGroupIds = new Set<string>();
  for (const id of refAssetIds) {
    const asset = getTextureAsset(id);
    if (asset && !asset.builtIn) {
      serializedAssets.push(serializeTextureAsset(asset));
      const gid = resolveAssetGroupId(asset);
      if (gid !== BUILTIN_PRESET_GROUP_ID && gid !== DEFAULT_USER_GROUP_ID) {
        refGroupIds.add(gid);
      }
    }
  }
  const serializedGroups = refGroupIds.size > 0
    ? getPersistableTextureGroups().filter((g) => refGroupIds.has(g.id))
    : [];
  const payload: SerializedBmeowProject = {
    format: 'bmeow-v1',
    name,
    width: doc.width,
    height: doc.height,
    plotU: doc.plotU,
    plotV: doc.plotV,
    bottomMarginPx: doc.bottomMarginPx,
    viewRotation: doc.viewRotation,
    autoSortOnRotate: doc.autoSortOnRotate,
    plotFrame: { ...doc.plotFrame },
    groundShadow: {
      enabled: doc.groundShadow.enabled,
      ...(doc.groundShadow.interBlockEnabled ? { interBlockEnabled: true } : {}),
      colorHex8: toHex8(doc.groundShadow.color),
    },
    shadeSteps: doc.shadeSteps,
    active: doc.active,
    layers: doc.layers.map((l) => ({
      name: l.name,
      kind: l.kind,
      rasterRole: l.rasterRole,
      shape: l.shape ? cloneShape(l.shape) : undefined,
      pngDataUrl: l.kind === 'raster' && l.canvas ? l.canvas.toDataURL('image/png') : undefined,
      opacity: l.opacity,
      visible: l.visible,
      locked: l.locked,
      blend: l.blend,
    })),
    ...(serializedAssets.length > 0 ? { textureAssets: serializedAssets } : {}),
    ...(serializedGroups.length > 0 ? { textureGroups: serializedGroups } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

function loadImgFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('无法读取图层图像'));
    img.src = url;
  });
}

export async function deserializeBmeowProject(jsonText: string): Promise<{ doc: BuilderDocument; name: string }> {
  const parsed = JSON.parse(jsonText) as SerializedBmeowProject;
  if (parsed.format !== 'bmeow-v1') {
    throw new Error('不支持的 .bmeow 工程版本');
  }
  if (Array.isArray(parsed.textureGroups) && parsed.textureGroups.length > 0) {
    registerSerializedTextureGroups(parsed.textureGroups);
  }
  const assetRemap = Array.isArray(parsed.textureAssets) && parsed.textureAssets.length > 0
    ? await registerSerializedTextureAssets(parsed.textureAssets)
    : new Map<string, string>();
  const doc = new BuilderDocument(
    parsed.width,
    parsed.height,
    parsed.plotU,
    parsed.plotV,
    parsed.bottomMarginPx ?? 16,
  );
  doc.viewRotation = parsed.viewRotation ?? 0;
  doc.autoSortOnRotate = parsed.autoSortOnRotate ?? true;
  if (parsed.plotFrame && typeof parsed.plotFrame === 'object') {
    doc.plotFrame = {
      visible: parsed.plotFrame.visible ?? true,
      u: Number.isFinite(parsed.plotFrame.u) ? parsed.plotFrame.u : 0,
      v: Number.isFinite(parsed.plotFrame.v) ? parsed.plotFrame.v : 0,
      sizeU: Math.max(0.25, Number.isFinite(parsed.plotFrame.sizeU) ? parsed.plotFrame.sizeU : doc.plotU),
      sizeV: Math.max(0.25, Number.isFinite(parsed.plotFrame.sizeV) ? parsed.plotFrame.sizeV : doc.plotV),
    };
  }
  if (parsed.groundShadow && typeof parsed.groundShadow === 'object') {
    const parsedCol = typeof parsed.groundShadow.colorHex8 === 'string'
      ? parseColorCode(parsed.groundShadow.colorHex8)
      : null;
    const resolvedCol = parsedCol
      ? parsedCol.hasAlpha
        ? parsedCol.rgba
        : { ...parsedCol.rgba, a: DEFAULT_GROUND_SHADOW_COLOR.a }
      : DEFAULT_GROUND_SHADOW_COLOR;
    doc.groundShadow = cloneGroundShadowConfig({
      enabled: Boolean(parsed.groundShadow.enabled),
      interBlockEnabled: Boolean(parsed.groundShadow.interBlockEnabled),
      color: resolvedCol,
    });
  } else {
    doc.groundShadow = cloneGroundShadowConfig({ enabled: false });
  }
  doc.shadeSteps = normalizeShadeSteps(parsed.shadeSteps ?? 0);

  for (const sl of parsed.layers) {
    if (sl.shape) {
      if (!sl.shape.triPrismCut) sl.shape.triPrismCut = 'vertical';
      if (sl.shape.flipZ && sl.shape.shapeType !== 'theotown_base') {
        sl.shape.flipZ = true;
      } else {
        delete sl.shape.flipZ;
      }
      sl.shape.shadeContrast = clampShadeContrast(sl.shape.shadeContrast);
      if (sl.shape.shapeType === 'loft') {
        sl.shape.loftSections = normalizeLoftSections(sl.shape.loftSections);
        if (!sl.shape.loftInterp) sl.shape.loftInterp = 'smooth';
        sl.shape.loftHollow = Boolean(sl.shape.loftHollow);
        if (sl.shape.loftFloorT && Number.isFinite(sl.shape.loftFloorT) && sl.shape.loftFloorT > 0) {
          sl.shape.loftFloorT = Math.max(0, Math.min(0.90, sl.shape.loftFloorT));
        } else {
          delete sl.shape.loftFloorT;
        }
        ensureActiveLoftSection(sl.shape);
      } else {
        delete sl.shape.loftSections;
        delete sl.shape.loftInterp;
        delete sl.shape.loftHollow;
        delete sl.shape.loftFloorT;
        delete sl.shape.activeLoftSectionId;
      }
      if (sl.shape.shapeType === 'arch') {
        sl.shape.archNodes = normalizeArchNodes(sl.shape.archNodes, false);
        sl.shape.archHollow = Boolean(sl.shape.archHollow);
        sl.shape.archHollowStyle = sl.shape.archHollowStyle === 'portal' ? 'portal' : 'shell';
        const im = sl.shape.archInnerMode;
        sl.shape.archInnerMode =
          im === 'proportional' || im === 'equal_vertical' || im === 'custom' ? im : 'parallel';
        sl.shape.archThickness = Number.isFinite(sl.shape.archThickness)
          ? Math.max(0.06, Math.min(0.78, sl.shape.archThickness!))
          : 0.28;
        if (sl.shape.archInnerNodes && Array.isArray(sl.shape.archInnerNodes) && sl.shape.archInnerNodes.length >= 2) {
          sl.shape.archInnerNodes = normalizeArchNodes(sl.shape.archInnerNodes, true);
        } else {
          delete sl.shape.archInnerNodes;
        }
      } else {
        delete sl.shape.archNodes;
        delete sl.shape.archInnerNodes;
        delete sl.shape.archHollow;
        delete sl.shape.archHollowStyle;
        delete sl.shape.archInnerMode;
        delete sl.shape.archThickness;
      }
      if (isColumnSectionShape(sl.shape) && Array.isArray(sl.shape.colSections) && sl.shape.colSections.length >= 1) {
        sl.shape.colSections = normalizeColumnSections(
          sl.shape.colSections,
          sl.shape.shapeType,
          sl.shape.prismSides,
        );
        sl.shape.colInterp = sl.shape.colInterp === 'linear' ? 'linear' : 'smooth';
        ensureActiveColumnSection(sl.shape);
      } else {
        delete sl.shape.colSections;
        delete sl.shape.colInterp;
        delete sl.shape.activeColSectionId;
      }
      if (assetRemap.size > 0 && sl.shape.faceTextures) {
        for (const slot of Object.values(sl.shape.faceTextures)) {
          if (!slot) continue;
          if (slot.assetId && assetRemap.has(slot.assetId)) {
            slot.assetId = assetRemap.get(slot.assetId);
          }
          if (Array.isArray(slot.items)) {
            for (const it of slot.items) {
              if (it.assetId && assetRemap.has(it.assetId)) {
                it.assetId = assetRemap.get(it.assetId)!;
              }
            }
          }
        }
      }
      sanitizeFaceTexturesForShape(sl.shape);
    }
    const layer = new BuilderLayer(doc.width, doc.height, sl.name, sl.kind, sl.shape);
    layer.opacity = sl.opacity ?? 1;
    layer.visible = sl.visible ?? true;
    layer.locked = sl.locked ?? false;
    layer.blend = sl.blend ?? 'normal';
    layer.rasterRole = sl.rasterRole ?? 'underlay';
    if (sl.kind === 'shape') {
      doc.rerenderShapeLayer(layer);
    } else if (sl.pngDataUrl) {
      const img = await loadImgFromUrl(sl.pngDataUrl);
      layer.drawImage(img, 0, 0);
    }
    doc.layers.push(layer);
  }
  doc.active = Math.max(0, Math.min(parsed.active ?? 0, Math.max(0, doc.layers.length - 1)));
  return { doc, name: parsed.name || tr('未命名工程') };
}
