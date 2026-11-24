// PSD export / import via ag-psd (browser canvas compatible)
import { readPsd, writePsd, type Psd, type Layer as PsdLayer, type BlendMode as PsdBlend } from 'ag-psd';
import { BuilderDocument, BuilderLayer, type BlendMode } from './document';
import { GROUND_SHADOW_LAYER_NAME, INTER_BLOCK_SHADOW_LAYER_NAME } from './groundShadow';
import type { ViewRotation } from './isoMath';

const TO_PSD: Record<BlendMode, PsdBlend> = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', 'color-dodge': 'color dodge', 'color-burn': 'color burn',
  'hard-light': 'hard light', 'soft-light': 'soft light', difference: 'difference', exclusion: 'exclusion',
  hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};
const FROM_PSD: Record<string, BlendMode> = Object.fromEntries(
  Object.entries(TO_PSD).map(([k, v]) => [v, k as BlendMode]),
);

export interface ContentBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function getDocumentContentBounds(
  doc: BuilderDocument,
  includeRasters = true,
  includeHidden = false,
  includeGroundShadow = true,
): ContentBounds | null {
  let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1;
  for (const l of doc.layers) {
    if ((!includeHidden && !l.visible) || (!includeRasters && l.kind === 'raster')) continue;
    const d = l.data;
    for (let y = 0; y < doc.height; y++) {
      const row = y * doc.width;
      for (let x = 0; x < doc.width; x++) {
        if (d[(row + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (includeGroundShadow && doc.groundShadow.enabled && doc.groundShadow.color.a > 0) {
    const sb = doc.ensureGroundShadowBuffer();
    for (let y = 0; y < doc.height; y++) {
      const row = y * doc.width;
      for (let x = 0; x < doc.width; x++) {
        if (sb[(row + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function getBufferOpaqueBounds(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  clip: ContentBounds = { x: 0, y: 0, w, h },
): ContentBounds | null {
  const xStart = Math.max(0, clip.x);
  const yStart = Math.max(0, clip.y);
  const xEnd = Math.min(w, clip.x + clip.w);
  const yEnd = Math.min(h, clip.y + clip.h);
  let minX = xEnd, minY = yEnd, maxX = -1, maxY = -1;
  for (let y = yStart; y < yEnd; y++) {
    const row = y * w;
    for (let x = xStart; x < xEnd; x++) {
      if (d[(row + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function getLayerOpaqueBounds(layer: BuilderLayer, clip: ContentBounds): ContentBounds | null {
  return getBufferOpaqueBounds(layer.data, layer.width, layer.height, clip);
}

export interface PsdExportOptions {
  scale?: number;
  trim?: boolean;
  includeRasters?: boolean;
  includeGroundShadow?: boolean;
  includeInterBlockShadow?: boolean;
}

function cropAndScaleBuffer(
  src: Uint8ClampedArray,
  srcW: number,
  rect: ContentBounds,
  scale: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const outW = rect.w * scale;
  const outH = rect.h * scale;
  const out = new Uint8ClampedArray(outW * outH * 4);
  if (scale === 1) {
    for (let y = 0; y < rect.h; y++) {
      const sOff = ((rect.y + y) * srcW + rect.x) * 4;
      const dOff = y * outW * 4;
      out.set(src.subarray(sOff, sOff + rect.w * 4), dOff);
    }
    return { width: outW, height: outH, data: out };
  }
  for (let sy = 0; sy < rect.h; sy++) {
    const sRow = (rect.y + sy) * srcW + rect.x;
    for (let sx = 0; sx < rect.w; sx++) {
      const si = (sRow + sx) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const r = src[si], g = src[si + 1], b = src[si + 2];
      for (let dy = 0; dy < scale; dy++) {
        const dRow = (sy * scale + dy) * outW + sx * scale;
        for (let dx = 0; dx < scale; dx++) {
          const di = (dRow + dx) * 4;
          out[di] = r;
          out[di + 1] = g;
          out[di + 2] = b;
          out[di + 3] = a;
        }
      }
    }
  }
  return { width: outW, height: outH, data: out };
}

export function exportBuilderPsd(doc: BuilderDocument, opts: PsdExportOptions = {}): ArrayBuffer {
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
    const shadowBuf = withShadow ? doc.ensureGroundShadowBuffer() : null;
    const interBlockBuf = withInterBlock ? doc.ensureInterBlockShadowBuffer() : null;
    const bounds = opts.trim
      ? getDocumentContentBounds(doc, includeRasters, true, withShadow) ?? { x: 0, y: 0, w: doc.width, h: doc.height }
      : { x: 0, y: 0, w: doc.width, h: doc.height };

    const W = bounds.w * scale;
    const H = bounds.h * scale;

    const targetLayers = doc.layers.filter((l) => includeRasters || l.kind !== 'raster');
    const children: PsdLayer[] = targetLayers.map((l) => {
      const lb = getLayerOpaqueBounds(l, bounds);
      if (!lb) {
        return {
          name: l.name,
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          opacity: l.opacity,
          hidden: !l.visible,
          blendMode: TO_PSD[l.blend],
          protected: l.locked ? { composite: true, position: true } : undefined,
        };
      }
      const left = (lb.x - bounds.x) * scale;
      const top = (lb.y - bounds.y) * scale;
      return {
        name: l.name,
        top,
        left,
        bottom: top + lb.h * scale,
        right: left + lb.w * scale,
        opacity: l.opacity,
        hidden: !l.visible,
        blendMode: TO_PSD[l.blend],
        protected: l.locked ? { composite: true, position: true } : undefined,
        imageData: cropAndScaleBuffer(l.data, l.width, lb, scale),
      };
    });

    const buildShadowPsdLayer = (name: string, buf: Uint8ClampedArray): PsdLayer => {
      const slb = getBufferOpaqueBounds(buf, doc.width, doc.height, bounds);
      return slb
        ? (() => {
            const left = (slb.x - bounds.x) * scale;
            const top = (slb.y - bounds.y) * scale;
            return {
              name,
              top,
              left,
              bottom: top + slb.h * scale,
              right: left + slb.w * scale,
              opacity: 1,
              hidden: false,
              blendMode: 'normal',
              imageData: cropAndScaleBuffer(buf, doc.width, slb, scale),
            };
          })()
        : {
            name,
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            opacity: 1,
            hidden: false,
            blendMode: 'normal',
          };
    };

    const groundInsertAt = doc.getGroundShadowInsertIndex(targetLayers);
    let insertedGround = false;
    if (withShadow && shadowBuf) {
      children.splice(groundInsertAt, 0, buildShadowPsdLayer(GROUND_SHADOW_LAYER_NAME, shadowBuf));
      insertedGround = true;
    }
    if (withInterBlock && interBlockBuf) {
      const interInsertAt = doc.getInterBlockShadowInsertIndex(targetLayers) + (insertedGround ? 1 : 0);
      children.splice(interInsertAt, 0, buildShadowPsdLayer(INTER_BLOCK_SHADOW_LAYER_NAME, interBlockBuf));
    }

    const compositeBuf = doc.renderToBuffer(includeRasters);
    const psd: Psd = {
      width: W,
      height: H,
      channels: 4,
      bitsPerChannel: 8,
      colorMode: 3,
      children,
      imageData: cropAndScaleBuffer(compositeBuf, doc.width, bounds, scale),
    };
    return writePsd(psd, { generateThumbnail: false, trimImageData: false });
  } finally {
    doc.groundShadow.enabled = prevShadowEnabled;
    doc.groundShadow.interBlockEnabled = prevInterBlockEnabled;
  }
}

export function exportFourViewLayersPsd(doc: BuilderDocument, opts: PsdExportOptions = {}): ArrayBuffer {
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const includeRasters = opts.includeRasters ?? true;
  const withShadow = (opts.includeGroundShadow ?? doc.groundShadow.enabled) && doc.groundShadow.color.a > 0;
  const withInterBlock =
    (opts.includeInterBlockShadow ?? Boolean(doc.groundShadow.interBlockEnabled)) && doc.groundShadow.color.a > 0;
  const hasSeparateShadows = withShadow || withInterBlock;

  const origRot = doc.viewRotation;
  const origOrder = [...doc.layers];
  const origActiveLayer = doc.layer;
  const prevShadowEnabled = doc.groundShadow.enabled;
  const prevInterBlockEnabled = doc.groundShadow.interBlockEnabled;

  interface CapturedView {
    rot: ViewRotation;
    composite: Uint8ClampedArray;
    baseBuf: Uint8ClampedArray | null;
    groundShadowBuf: Uint8ClampedArray | null;
    bodyBuf: Uint8ClampedArray | null;
    interBlockBuf: Uint8ClampedArray | null;
    overlayBuf: Uint8ClampedArray | null;
  }
  const views: CapturedView[] = [];

  try {
    doc.groundShadow.enabled = withShadow;
    doc.groundShadow.interBlockEnabled = withInterBlock;
    for (let r = 0; r < 4; r++) {
      const rot = ((origRot + r) % 4) as ViewRotation;
      doc.viewRotation = rot;
      if (doc.autoSortOnRotate) doc.sortLayersByIsoDepth();
      doc.rerenderAllShapes();
      const composite = doc.renderToBuffer(includeRasters);
      if (hasSeparateShadows) {
        const shadowIdx = doc.getGroundShadowInsertIndex(doc.layers);
        const interIdx = doc.getInterBlockShadowInsertIndex(doc.layers);
        const splitLow = withShadow ? shadowIdx : 0;
        const splitHigh = withInterBlock ? Math.max(splitLow, interIdx) : doc.layers.length;
        views.push({
          rot,
          composite,
          baseBuf: splitLow > 0 ? doc.renderLayerRangeToBuffer(0, splitLow, includeRasters) : null,
          groundShadowBuf: withShadow ? new Uint8ClampedArray(doc.ensureGroundShadowBuffer()) : null,
          bodyBuf: doc.renderLayerRangeToBuffer(splitLow, splitHigh, includeRasters),
          interBlockBuf: withInterBlock ? new Uint8ClampedArray(doc.ensureInterBlockShadowBuffer()) : null,
          overlayBuf: splitHigh < doc.layers.length ? doc.renderLayerRangeToBuffer(splitHigh, doc.layers.length, includeRasters) : null,
        });
      } else {
        views.push({
          rot,
          composite,
          baseBuf: null,
          groundShadowBuf: null,
          bodyBuf: null,
          interBlockBuf: null,
          overlayBuf: null,
        });
      }
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

  let bounds: ContentBounds = { x: 0, y: 0, w: doc.width, h: doc.height };
  if (opts.trim) {
    let minX = doc.width;
    let minY = doc.height;
    let maxX = -1;
    let maxY = -1;
    for (const v of views) {
      const b = getBufferOpaqueBounds(v.composite, doc.width, doc.height);
      if (!b) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w - 1 > maxX) maxX = b.x + b.w - 1;
      if (b.y + b.h - 1 > maxY) maxY = b.y + b.h - 1;
    }
    if (maxX >= minX && maxY >= minY) {
      bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }
  }

  const W = bounds.w * scale;
  const H = bounds.h * scale;

  const makeLeafLayer = (name: string, buf: Uint8ClampedArray): PsdLayer => {
    const lb = getBufferOpaqueBounds(buf, doc.width, doc.height, bounds);
    if (!lb) {
      return {
        name,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        opacity: 1,
        hidden: false,
        blendMode: 'normal',
      };
    }
    const left = (lb.x - bounds.x) * scale;
    const top = (lb.y - bounds.y) * scale;
    return {
      name,
      top,
      left,
      bottom: top + lb.h * scale,
      right: left + lb.w * scale,
      opacity: 1,
      hidden: false,
      blendMode: 'normal',
      imageData: cropAndScaleBuffer(buf, doc.width, lb, scale),
    };
  };

  // Put first/current viewpoint on top (last in ag-psd children), followed underneath by 90°, 180°, 270°
  const children: PsdLayer[] = [...views].reverse().map((v) => {
    const name = `视角 ${v.rot * 90}°`;
    if (!hasSeparateShadows) {
      return makeLeafLayer(name, v.composite);
    }
    const groupChildren: PsdLayer[] = [];
    if (v.baseBuf && getBufferOpaqueBounds(v.baseBuf, doc.width, doc.height, bounds)) {
      groupChildren.push(makeLeafLayer(`${name} 底座`, v.baseBuf));
    }
    if (v.groundShadowBuf) {
      groupChildren.push(makeLeafLayer(GROUND_SHADOW_LAYER_NAME, v.groundShadowBuf));
    }
    groupChildren.push(makeLeafLayer(`${name} 主体`, v.bodyBuf ?? v.composite));
    if (v.interBlockBuf) {
      groupChildren.push(makeLeafLayer(INTER_BLOCK_SHADOW_LAYER_NAME, v.interBlockBuf));
    }
    if (v.overlayBuf && getBufferOpaqueBounds(v.overlayBuf, doc.width, doc.height, bounds)) {
      groupChildren.push(makeLeafLayer(`${name} 前景`, v.overlayBuf));
    }
    return {
      name,
      opened: true,
      hidden: false,
      opacity: 1,
      blendMode: 'normal',
      children: groupChildren,
    };
  });

  const psd: Psd = {
    width: W,
    height: H,
    channels: 4,
    bitsPerChannel: 8,
    colorMode: 3,
    children,
    imageData: cropAndScaleBuffer(views[0].composite, doc.width, bounds, scale),
  };
  return writePsd(psd, { generateThumbnail: false, trimImageData: false });
}

export function importPsdAsRasterLayers(buf: ArrayBuffer, targetDoc: BuilderDocument): BuilderLayer[] {
  const psd = readPsd(buf, { skipThumbnail: true });
  const flat: PsdLayer[] = [];
  const walk = (ls: PsdLayer[] | undefined, hiddenParent: boolean) => {
    for (const l of ls ?? []) {
      if (l.children) walk(l.children, hiddenParent || !!l.hidden);
      else flat.push({ ...l, hidden: hiddenParent || l.hidden });
    }
  };
  walk(psd.children, false);
  const out: BuilderLayer[] = [];
  if (flat.length === 0 && psd.canvas) {
    const layer = new BuilderLayer(targetDoc.width, targetDoc.height, 'PSD 参考层', 'raster');
    layer.rasterRole = 'underlay';
    layer.drawImage(psd.canvas, Math.floor((targetDoc.width - psd.width) / 2), targetDoc.height - psd.height);
    out.push(layer);
    return out;
  }
  const dx = Math.floor((targetDoc.width - psd.width) / 2);
  const dy = targetDoc.height - psd.height;
  for (const pl of flat) {
    const layer = new BuilderLayer(targetDoc.width, targetDoc.height, pl.name || 'PSD 图层', 'raster');
    layer.rasterRole = 'underlay';
    if (pl.canvas) layer.drawImage(pl.canvas, dx + (pl.left ?? 0), dy + (pl.top ?? 0));
    layer.opacity = pl.opacity ?? 1;
    layer.visible = !pl.hidden;
    layer.blend = FROM_PSD[pl.blendMode ?? 'normal'] ?? 'normal';
    out.push(layer);
  }
  return out;
}
