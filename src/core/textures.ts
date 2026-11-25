// Custom planar texture assets, Pixel Meow lossless sawtooth shear <-> rect conversion,
// arbitrary parallelogram unwrapping, built-in TheoTown pixel textures, and planar UV sampling.

import { clamp, type RGBA } from './color';
import { tr } from './i18n';
import { normalizeRotation } from './isoMath';
import type { ParametricShape, ShapeKind } from './isoRenderer';

export type ShearDirection = 'up_right' | 'down_right';
export type TextureDisplayForm = 'rect' | 'parallelogram';
export type ParallelogramMode = 'sawtooth' | 'diamond' | 'custom_vectors';
export type LibraryChangeReason = 'pixels' | 'display' | 'list' | 'groups' | 'project_hydrate';

export const BUILTIN_PRESET_GROUP_ID = 'group_builtin_presets';
export const DEFAULT_USER_GROUP_ID = 'group_user_default';

export interface TextureGroup {
  id: string;
  name: string;
  builtIn?: boolean;
  order: number;
}

export interface ParallelogramConfig {
  mode: ParallelogramMode;
  direction: ShearDirection;
  step: number;
  /** Top edge vector (dx, dy) in pixels for custom/diamond parallelogram form */
  uVec: [number, number];
  /** Left edge vector (dx, dy) in pixels for custom/diamond parallelogram form */
  vVec: [number, number];
}

export interface TextureAsset {
  id: string;
  name: string;
  builtIn?: boolean;
  /** True when registered transiently by opening a `.bmeow` project (not persisted to global library) */
  projectScoped?: boolean;
  /** Logical group ID (`BUILTIN_PRESET_GROUP_ID`, `DEFAULT_USER_GROUP_ID`, or custom group ID) */
  groupId?: string;
  /** Tag identifying baked face origin `${layerId ?? 'shape'}:${faceId}` when created from whole-face editing */
  faceBakedTag?: string;
  /** Canonical orthogonal rectangle dimensions in pixels */
  width: number;
  height: number;
  /** Canonical RGBA pixels (width * height * 4) in rectangular form */
  rectData: Uint8ClampedArray;
  /** Cached data URL for PNG thumbnail/serialization */
  pngDataUrl?: string;
  /** Current form shown in texture library (`rect` or `parallelogram`) */
  displayForm: TextureDisplayForm;
  paraConfig: ParallelogramConfig;
  createdAt: number;
}

export interface SerializedTextureAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  pngDataUrl?: string;
  rgbaBase64?: string;
  displayForm: TextureDisplayForm;
  paraConfig: ParallelogramConfig;
  groupId?: string;
  faceBakedTag?: string;
  createdAt?: number;
}

export type FaceTextureMode = 'none' | 'stretch' | 'tile' | 'custom';

export interface TextureCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceDecalItem {
  id: string;
  assetId: string;
  /** Optional non-destructive pixel crop rect within asset's orthogonal `[0..w) x [0..h)` grid */
  crop?: TextureCropRect;
  /** Pixel X in face coordinate space `[0, faceW]` */
  x: number;
  /** Pixel Y in face coordinate space `[0, faceH]` */
  y: number;
  w: number;
  h: number;
  /** If true, tiles asset repeatedly inside `[x, x+w) x [y, y+h)` without stretching */
  tileFill?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  rot90?: 0 | 1 | 2 | 3;
  /** 0..1 */
  opacity?: number;
  visible?: boolean;
}

export interface FaceTextureSlot {
  mode: FaceTextureMode;
  assetId?: string;
  /** Optional non-destructive pixel crop rect within asset's orthogonal `[0..w) x [0..h)` grid */
  crop?: TextureCropRect;
  tileScale?: number;
  offsetX?: number;
  offsetY?: number;
  flipX?: boolean;
  flipY?: boolean;
  rot90?: 0 | 1 | 2 | 3;
  opacity?: number;
  /** When true (default), multiplies texture brightness by face shading intensity */
  shadeWithFace?: boolean;
  items?: FaceDecalItem[];
}

export interface PlanarFaceSpec {
  id: string;
  label: string;
  shortLabel: string;
  faceW: number;
  faceH: number;
  isTop: boolean;
  defaultIsoMode: 'wall_down_right' | 'wall_up_right' | 'iso_diamond';
  /** Normalized `[0..1]^2` polygon outline inside `[0, faceW] x [0, faceH]` for triangles/polygons */
  clipPolyUV?: [number, number][];
}

export const PLANAR_TEXTURE_SHAPES: readonly ShapeKind[] = [
  'box',
  'prism',
  'right_tri_prism',
  'wedge',
  'pyramid',
];

export function isPlanarTextureShape(s?: Pick<ParametricShape, 'shapeType'> | null): boolean {
  if (!s) return false;
  return PLANAR_TEXTURE_SHAPES.includes(s.shapeType);
}

// ---------------- Base64 helpers (browser + Node safe) ----------------

function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let bin = '';
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + slice)));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8ClampedArray {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8ClampedArray(buf);
  }
  const bin = atob(b64);
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function rgbaToPngDataUrl(data: Uint8ClampedArray, w: number, h: number): string | undefined {
  if (typeof document === 'undefined' || w <= 0 || h <= 0) return undefined;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(new ImageData(data as any, w, h), 0, 0);
  return c.toDataURL('image/png');
}

export async function pngDataUrlToRgba(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  if (typeof document === 'undefined' || !url) return null;
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, img.naturalWidth || img.width);
      const h = Math.max(1, img.naturalHeight || img.height);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) {
        res(null);
        return;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      res({ data: new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data), width: w, height: h });
    };
    img.onerror = () => res(null);
    img.src = url;
  });
}

export function extractImageRgbaNearest(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  targetW = srcW,
  targetH = srcH,
): { data: Uint8ClampedArray; width: number; height: number } {
  const tw = Math.max(1, Math.min(512, Math.round(targetW)));
  const th = Math.max(1, Math.min(512, Math.round(targetH)));
  if (typeof document === 'undefined') {
    return { data: new Uint8ClampedArray(tw * th * 4), width: tw, height: th };
  }
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, tw, th);
  const raw = ctx.getImageData(0, 0, tw, th).data;
  const data = new Uint8ClampedArray(raw.length);
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] < 16) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    } else {
      data[i] = raw[i];
      data[i + 1] = raw[i + 1];
      data[i + 2] = raw[i + 2];
      data[i + 3] = raw[i + 3] >= 128 ? 255 : raw[i + 3];
    }
  }
  return { data, width: tw, height: th };
}

// ---------------- Pixel Meow Lossless Sawtooth Shear & Arbitrary Parallelogram Conversion ----------------

/**
 * Ported directly from Pixel Meow (`PixelPad/src/core/shear.ts`).
 * Applies a lossless integer sawtooth vertical shift per column `x`.
 */
export function shearPixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  direction: ShearDirection,
  step = 2,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (w <= 0 || h <= 0) {
    return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  }
  const s = Math.max(1, Math.min(64, Math.floor(step) || 2));
  const maxStep = Math.floor((w - 1) / s);
  const outH = h + maxStep;
  const out = new Uint8ClampedArray(w * outH * 4);

  for (let x = 0; x < w; x++) {
    const shift = direction === 'up_right'
      ? maxStep - Math.floor(x / s)
      : Math.floor(x / s);
    for (let y = 0; y < h; y++) {
      const si = (y * w + x) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const ny = y + shift;
      if (ny < 0 || ny >= outH) continue;
      const di = (ny * w + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = a;
    }
  }
  return { data: out, width: w, height: outH };
}

/**
 * Exact lossless inverse of Pixel Meow `shearPixels`.
 * Unwraps a sawtooth-sheared `w x h` parallelogram buffer back into an orthogonal `w x outH` rectangle.
 */
export function deshearPixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  direction: ShearDirection,
  step = 2,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (w <= 0 || h <= 0) {
    return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  }
  const s = Math.max(1, Math.min(64, Math.floor(step) || 2));
  const maxStep = Math.floor((w - 1) / s);
  const outH = Math.max(1, h - maxStep);
  const out = new Uint8ClampedArray(w * outH * 4);

  for (let x = 0; x < w; x++) {
    const shift = direction === 'up_right'
      ? maxStep - Math.floor(x / s)
      : Math.floor(x / s);
    for (let y = 0; y < outH; y++) {
      const sy = y + shift;
      if (sy < 0 || sy >= h) continue;
      const si = (sy * w + x) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const di = (y * w + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = a;
    }
  }
  return { data: out, width: w, height: outH };
}

/**
 * Nearest-neighbor transform of a rectangular pixel buffer `w x h` into an arbitrary parallelogram
 * spanned by edge vectors `uVec = (ux, uy)` and `vVec = (vx, vy)`. Strictly 0-AA.
 */
export function warpRectToParallelogramPixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  uVec: [number, number],
  vVec: [number, number],
): { data: Uint8ClampedArray; width: number; height: number; originX: number; originY: number } {
  if (w <= 0 || h <= 0) {
    return { data: new Uint8ClampedArray(0), width: 1, height: 1, originX: 0, originY: 0 };
  }
  const [ux, uy] = uVec;
  const [vx, vy] = vVec;
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-3) {
    return { data: new Uint8ClampedArray(src), width: w, height: h, originX: 0, originY: 0 };
  }

  const c00: [number, number] = [0, 0];
  const c10: [number, number] = [ux, uy];
  const c01: [number, number] = [vx, vy];
  const c11: [number, number] = [ux + vx, uy + vy];
  const xs = [c00[0], c10[0], c01[0], c11[0]];
  const ys = [c00[1], c10[1], c01[1], c11[1]];
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));

  const outW = clamp(maxX - minX, 1, 512);
  const outH = clamp(maxY - minY, 1, 512);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const invDet = 1 / det;

  for (let py = 0; py < outH; py++) {
    const ry = minY + py + 0.5;
    for (let px = 0; px < outW; px++) {
      const rx = minX + px + 0.5;
      const u = (rx * vy - ry * vx) * invDet;
      const v = (ux * ry - uy * rx) * invDet;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const sx = clamp(Math.floor(u * w), 0, w - 1);
      const sy = clamp(Math.floor(v * h), 0, h - 1);
      const si = (sy * w + sx) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const di = (py * outW + px) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = a;
    }
  }
  return { data: out, width: outW, height: outH, originX: -minX, originY: -minY };
}

/**
 * Unwraps an arbitrary parallelogram defined by corners `(p00, p10, p01)` (where `p11 = p10 + p01 - p00`)
 * from a source image into an orthogonal rectangle of dimensions `outW x outH` using nearest-neighbor sampling.
 */
export function unwrapParallelogramPixels(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  p00: [number, number],
  p10: [number, number],
  p01: [number, number],
  outW?: number,
  outH?: number,
): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  uVec: [number, number];
  vVec: [number, number];
} {
  const ux = p10[0] - p00[0];
  const uy = p10[1] - p00[1];
  const vx = p01[0] - p00[0];
  const vy = p01[1] - p00[1];
  const w = clamp(Math.round(outW ?? Math.hypot(ux, uy)), 1, 256);
  const h = clamp(Math.round(outH ?? Math.hypot(vx, vy)), 1, 256);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let oy = 0; oy < h; oy++) {
    const v = (oy + 0.5) / h;
    for (let ox = 0; ox < w; ox++) {
      const u = (ox + 0.5) / w;
      const sx = Math.floor(p00[0] + u * ux + v * vx);
      const sy = Math.floor(p00[1] + u * uy + v * vy);
      if (sx < 0 || sx >= srcW || sy < 0 || sy >= srcH) continue;
      const si = (sy * srcW + sx) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const di = (oy * w + ox) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = a;
    }
  }
  return {
    data: out,
    width: w,
    height: h,
    uVec: [Math.round(ux * 100) / 100, Math.round(uy * 100) / 100],
    vVec: [Math.round(vx * 100) / 100, Math.round(vy * 100) / 100],
  };
}

/**
 * Heuristic detector for non-transparent parallelogram corners (`p00, p10, p01`) inside a texture bitmap.
 */
export function autoDetectParallelogramCorners(
  src: Uint8ClampedArray,
  w: number,
  h: number,
): { p00: [number, number]; p10: [number, number]; p01: [number, number] } {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] >= 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { p00: [0, 0], p10: [Math.max(1, w), 0], p01: [0, Math.max(1, h)] };
  }

  const colRange = (x: number): [number, number] => {
    let top = h, bot = -1;
    for (let y = minY; y <= maxY; y++) {
      if (src[(y * w + x) * 4 + 3] >= 16) {
        if (y < top) top = y;
        if (y > bot) bot = y;
      }
    }
    return [top, bot];
  };
  const rowRange = (y: number): [number, number] => {
    let left = w, right = -1;
    for (let x = minX; x <= maxX; x++) {
      if (src[(y * w + x) * 4 + 3] >= 16) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    return [left, right];
  };

  const [topL, botL] = colRange(minX);
  const [topR, botR] = colRange(maxX);
  const [leftT, rightT] = rowRange(minY);
  const spanL = botL - topL + 1;
  const spanR = botR - topR + 1;
  const spanY = maxY - minY + 1;

  // Isometric sheared vertical wall (column-aligned left and right vertical edges)
  if (spanL >= 2 && spanR >= 2 && Math.abs(spanL - spanR) <= Math.max(2, Math.floor(spanY * 0.2)) && Math.abs(topR - topL) >= 2) {
    return {
      p00: [minX, topL],
      p10: [maxX + 1, topR],
      p01: [minX, botL + 1],
    };
  }
  // Top isometric diamond (narrow top/left/right tips)
  if (rightT - leftT <= Math.max(3, Math.floor((maxX - minX + 1) * 0.25)) && spanL <= Math.max(3, Math.floor(spanY * 0.25))) {
    return {
      p00: [(leftT + rightT + 1) * 0.5, minY],
      p10: [maxX + 1, (topR + botR + 1) * 0.5],
      p01: [minX, (topL + botL + 1) * 0.5],
    };
  }
  return {
    p00: [minX, minY],
    p10: [maxX + 1, minY],
    p01: [minX, maxY + 1],
  };
}

export function createDefaultParallelogramConfig(
  w: number,
  h: number,
  direction: ShearDirection = 'down_right',
  step = 2,
): ParallelogramConfig {
  return {
    mode: 'sawtooth',
    direction,
    step,
    uVec: [w, direction === 'up_right' ? -Math.floor((w - 1) / step) : Math.floor((w - 1) / step)],
    vVec: [0, h],
  };
}

export function getAssetDisplayPixels(asset: TextureAsset): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  if (asset.displayForm !== 'parallelogram') {
    return { data: asset.rectData, width: asset.width, height: asset.height };
  }
  const pc = asset.paraConfig;
  if (pc.mode === 'sawtooth') {
    return shearPixels(asset.rectData, asset.width, asset.height, pc.direction, pc.step);
  }
  if (pc.mode === 'diamond') {
    const hw = Math.max(2, asset.width);
    const hh = Math.max(2, asset.height);
    return warpRectToParallelogramPixels(
      asset.rectData,
      asset.width,
      asset.height,
      [hw, hw * 0.5],
      [-hh, hh * 0.5],
    );
  }
  return warpRectToParallelogramPixels(
    asset.rectData,
    asset.width,
    asset.height,
    pc.uVec,
    pc.vVec,
  );
}

// ---------------- Built-in TheoTown Pixel Texture Library ----------------

function makeBuf(w: number, h: number, fill?: RGBA): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  if (fill) {
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = fill.r;
      buf[i + 1] = fill.g;
      buf[i + 2] = fill.b;
      buf[i + 3] = fill.a;
    }
  }
  return buf;
}

function putPx(buf: Uint8ClampedArray, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

function fillRectPx(buf: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, rw: number, rh: number, r: number, g: number, b: number, a = 255) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      putPx(buf, w, h, x, y, r, g, b, a);
    }
  }
}

function createBuiltinAssets(): TextureAsset[] {
  const list: TextureAsset[] = [];

  // 1. Red brick masonry tile (16x16)
  {
    const w = 16, h = 16;
    const d = makeBuf(w, h, { r: 158, g: 76, b: 62, a: 255 });
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / 4);
      const isMortarY = y % 4 === 0;
      for (let x = 0; x < w; x++) {
        const shift = row % 2 === 1 ? 4 : 0;
        const isMortarX = (x + shift) % 8 === 0;
        if (isMortarY || isMortarX) {
          putPx(d, w, h, x, y, 118, 58, 52, 255);
        } else if (y % 4 === 1 && (x + shift) % 8 === 2) {
          putPx(d, w, h, x, y, 182, 95, 78, 255);
        } else if ((x * 5 + y * 3) % 11 === 0) {
          putPx(d, w, h, x, y, 140, 66, 54, 255);
        }
      }
    }
    list.push({
      id: 'builtin_brick_red',
      name: '红砖砌体',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 1,
    });
  }

  // 2. Ashlar gray stone blocks (16x16)
  {
    const w = 16, h = 16;
    const d = makeBuf(w, h, { r: 146, g: 154, b: 168, a: 255 });
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / 8);
      for (let x = 0; x < w; x++) {
        const shift = row % 2 === 1 ? 4 : 0;
        if (y % 8 === 0 || (x + shift) % 8 === 0) {
          putPx(d, w, h, x, y, 98, 106, 120, 255);
        } else if (y % 8 === 1 || (x + shift) % 8 === 1) {
          putPx(d, w, h, x, y, 174, 182, 196, 255);
        }
      }
    }
    list.push({
      id: 'builtin_stone_gray',
      name: '青灰条石',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 2,
    });
  }

  // 3. Double pixel window with reflection & sill (8x10, transparent margin)
  {
    const w = 8, h = 10;
    const d = makeBuf(w, h);
    fillRectPx(d, w, h, 0, 0, 8, 9, 54, 65, 86, 255); // outer frame
    fillRectPx(d, w, h, 1, 1, 2, 7, 102, 192, 246, 255); // left pane
    fillRectPx(d, w, h, 5, 1, 2, 7, 102, 192, 246, 255); // right pane
    putPx(d, w, h, 1, 2, 192, 238, 255);
    putPx(d, w, h, 2, 1, 192, 238, 255);
    putPx(d, w, h, 5, 2, 192, 238, 255);
    putPx(d, w, h, 6, 1, 192, 238, 255);
    fillRectPx(d, w, h, 0, 9, 8, 1, 214, 220, 230, 255); // bottom sill
    list.push({
      id: 'builtin_win_double',
      name: '双扇玻璃窗',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 3,
    });
  }

  // 4. Timber entrance door (8x14)
  {
    const w = 8, h = 14;
    const d = makeBuf(w, h);
    fillRectPx(d, w, h, 0, 0, 8, 14, 72, 46, 30, 255);
    fillRectPx(d, w, h, 1, 1, 6, 12, 126, 82, 50, 255);
    fillRectPx(d, w, h, 2, 2, 4, 4, 152, 214, 244, 255);
    fillRectPx(d, w, h, 2, 8, 4, 4, 104, 66, 38, 255);
    putPx(d, w, h, 5, 7, 244, 206, 98, 255); // doorknob
    list.push({
      id: 'builtin_door_wood',
      name: '商铺木大门',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 4,
    });
  }

  // 5. Glass curtain grid module (16x12)
  {
    const w = 16, h = 12;
    const d = makeBuf(w, h, { r: 78, g: 158, b: 224, a: 255 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y === 0 || y === 11 || x === 0 || x === 8) {
          putPx(d, w, h, x, y, 42, 56, 78, 255);
        } else if (y <= 3 && (x + y) % 5 === 0) {
          putPx(d, w, h, x, y, 168, 224, 255, 255);
        } else if (y >= 8) {
          putPx(d, w, h, x, y, 56, 118, 178, 255);
        }
      }
    }
    list.push({
      id: 'builtin_curtain_glass',
      name: '幕墙玻璃格',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 5,
    });
  }

  // 6. Neon pixel signboard (14x6)
  {
    const w = 14, h = 6;
    const d = makeBuf(w, h, { r: 28, g: 24, b: 48, a: 255 });
    for (let x = 0; x < w; x++) {
      putPx(d, w, h, x, 0, 192, 132, 252);
      putPx(d, w, h, x, h - 1, 56, 189, 248);
    }
    fillRectPx(d, w, h, 2, 2, 2, 2, 251, 191, 36, 255);
    fillRectPx(d, w, h, 5, 2, 3, 2, 56, 189, 248, 255);
    fillRectPx(d, w, h, 9, 2, 3, 2, 244, 114, 182, 255);
    list.push({
      id: 'builtin_sign_neon',
      name: '霓虹像素招牌',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 6,
    });
  }

  // 7. Terracotta roof tile pattern (16x16)
  {
    const w = 16, h = 16;
    const d = makeBuf(w, h, { r: 190, g: 92, b: 70, a: 255 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y % 4 === 3) {
          putPx(d, w, h, x, y, 138, 60, 44, 255);
        } else if ((x + (Math.floor(y / 4) % 2) * 2) % 4 === 0) {
          putPx(d, w, h, x, y, 162, 74, 54, 255);
        } else if (y % 4 === 0) {
          putPx(d, w, h, x, y, 214, 116, 88, 255);
        }
      }
    }
    list.push({
      id: 'builtin_roof_tile',
      name: '红陶屋面瓦',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 7,
    });
  }

  // 8. HVAC / Louver vent panel (8x8)
  {
    const w = 8, h = 8;
    const d = makeBuf(w, h);
    fillRectPx(d, w, h, 0, 0, 8, 8, 128, 138, 152, 255);
    for (let y = 1; y < 7; y++) {
      fillRectPx(d, w, h, 1, y, 6, 1, y % 2 === 1 ? 66 : 162, y % 2 === 1 ? 74 : 172, y % 2 === 1 ? 86 : 186, 255);
    }
    list.push({
      id: 'builtin_vent_louver',
      name: '金属百叶风口',
      builtIn: true,
      width: w,
      height: h,
      rectData: d,
      displayForm: 'rect',
      paraConfig: createDefaultParallelogramConfig(w, h, 'down_right', 2),
      createdAt: 8,
    });
  }

  return list;
}

const BUILTIN_GROUPS: readonly TextureGroup[] = [
  { id: BUILTIN_PRESET_GROUP_ID, name: '预设纹理', builtIn: true, order: 0 },
  { id: DEFAULT_USER_GROUP_ID, name: '我的贴图', builtIn: true, order: 1 },
];

const textureRegistry = new Map<string, TextureAsset>();
const customGroups = new Map<string, TextureGroup>();
const libraryListeners = new Set<(reason: LibraryChangeReason) => void>();
let seqGroupId = 0;

function ensureBuiltinLoaded() {
  if (textureRegistry.size > 0) return;
  for (const a of createBuiltinAssets()) {
    a.groupId = BUILTIN_PRESET_GROUP_ID;
    textureRegistry.set(a.id, a);
  }
}
ensureBuiltinLoaded();

function notifyLibraryListeners(reason: LibraryChangeReason) {
  for (const cb of libraryListeners) cb(reason);
}

export function onTextureLibraryChange(cb: (reason: LibraryChangeReason) => void): () => void {
  libraryListeners.add(cb);
  return () => libraryListeners.delete(cb);
}

function getSortedCustomGroups(): TextureGroup[] {
  return [...customGroups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ ...g }));
}

export function getTextureGroups(): TextureGroup[] {
  return [...BUILTIN_GROUPS.map((g) => ({ ...g })), ...getSortedCustomGroups()];
}

export function getPersistableTextureGroups(): TextureGroup[] {
  return getSortedCustomGroups().filter((g) => !g.builtIn);
}

function nextCustomGroupOrder(): number {
  let maxOrder = 1;
  for (const g of customGroups.values()) {
    if (Number.isFinite(g.order) && g.order > maxOrder) maxOrder = g.order;
  }
  return maxOrder + 1;
}

export function hydratePersistedTextureGroups(groups: TextureGroup[]): void {
  if (!Array.isArray(groups) || groups.length === 0) return;
  let changed = false;
  for (const raw of groups) {
    if (!raw || typeof raw.id !== 'string') continue;
    const id = raw.id.trim();
    if (!id || raw.builtIn || id === BUILTIN_PRESET_GROUP_ID || id === DEFAULT_USER_GROUP_ID) continue;
    const order = Number.isFinite(raw.order) ? Math.max(2, raw.order) : nextCustomGroupOrder();
    const clean: TextureGroup = {
      id,
      name: (typeof raw.name === 'string' ? raw.name.trim() : '') || tr('新建分组'),
      order,
    };
    customGroups.set(id, clean);
    changed = true;
  }
  if (changed) {
    notifyLibraryListeners('project_hydrate');
  }
}

export function registerSerializedTextureGroups(groups: TextureGroup[] | undefined): number {
  if (!Array.isArray(groups) || groups.length === 0) return 0;
  let added = 0;
  for (const raw of groups) {
    if (!raw || typeof raw.id !== 'string') continue;
    const id = raw.id.trim();
    if (!id || raw.builtIn || id === BUILTIN_PRESET_GROUP_ID || id === DEFAULT_USER_GROUP_ID) continue;
    if (customGroups.has(id)) continue;
    const order = Number.isFinite(raw.order) ? Math.max(2, raw.order) : nextCustomGroupOrder();
    customGroups.set(id, {
      id,
      name: (typeof raw.name === 'string' ? raw.name.trim() : '') || tr('新建分组'),
      order,
    });
    added++;
  }
  if (added > 0) {
    notifyLibraryListeners('project_hydrate');
  }
  return added;
}

export function createTextureGroup(name: string): TextureGroup {
  let id = '';
  do {
    seqGroupId += 1;
    id = `grp_${Date.now().toString(36)}_${seqGroupId}`;
  } while (customGroups.has(id));
  const group: TextureGroup = {
    id,
    name: (name ?? '').trim() || tr('新建分组'),
    order: nextCustomGroupOrder(),
  };
  customGroups.set(id, group);
  notifyLibraryListeners('groups');
  return { ...group };
}

export function renameTextureGroup(groupId: string, newName: string): boolean {
  if (groupId === BUILTIN_PRESET_GROUP_ID || groupId === DEFAULT_USER_GROUP_ID) return false;
  const g = customGroups.get(groupId);
  if (!g || g.builtIn) return false;
  const trimmed = (newName ?? '').trim();
  if (!trimmed) return false;
  g.name = trimmed;
  notifyLibraryListeners('groups');
  return true;
}

export function deleteTextureGroup(groupId: string): boolean {
  if (groupId === BUILTIN_PRESET_GROUP_ID || groupId === DEFAULT_USER_GROUP_ID) return false;
  const g = customGroups.get(groupId);
  if (!g || g.builtIn) return false;
  for (const a of textureRegistry.values()) {
    if (!a.builtIn && a.groupId === groupId) {
      a.groupId = DEFAULT_USER_GROUP_ID;
    }
  }
  customGroups.delete(groupId);
  notifyLibraryListeners('groups');
  return true;
}

export function resolveAssetGroupId(asset: Pick<TextureAsset, 'builtIn' | 'groupId'>): string {
  if (asset.builtIn) return BUILTIN_PRESET_GROUP_ID;
  if (asset.groupId && customGroups.has(asset.groupId)) {
    return asset.groupId;
  }
  return DEFAULT_USER_GROUP_ID;
}

export function setTextureAssetGroup(assetId: string, groupId: string): boolean {
  ensureBuiltinLoaded();
  const asset = textureRegistry.get(assetId);
  if (!asset || asset.builtIn) return false;
  if (groupId === BUILTIN_PRESET_GROUP_ID) return false;
  if (groupId !== DEFAULT_USER_GROUP_ID && !customGroups.has(groupId)) return false;
  asset.groupId = groupId;
  notifyLibraryListeners('groups');
  return true;
}

export function getTextureLibrary(includeProjectScoped = false): TextureAsset[] {
  ensureBuiltinLoaded();
  const builtins: TextureAsset[] = [];
  const custom: TextureAsset[] = [];
  for (const a of textureRegistry.values()) {
    if (a.builtIn) builtins.push(a);
    else if (includeProjectScoped || !a.projectScoped) custom.push(a);
  }
  builtins.sort((a, b) => a.createdAt - b.createdAt);
  custom.sort((a, b) => b.createdAt - a.createdAt);
  return [...custom, ...builtins];
}

export function getTextureLibraryByGroup(groupFilter: string, includeProjectScoped = true): TextureAsset[] {
  const all = getTextureLibrary(includeProjectScoped);
  if (!groupFilter || groupFilter === 'all') return all;
  return all.filter((a) => resolveAssetGroupId(a) === groupFilter);
}

export function getPersistableUserTextureAssets(): TextureAsset[] {
  ensureBuiltinLoaded();
  const out: TextureAsset[] = [];
  for (const a of textureRegistry.values()) {
    if (!a.builtIn && !a.projectScoped) out.push(a);
  }
  return out;
}

export function getTextureAsset(id?: string): TextureAsset | undefined {
  ensureBuiltinLoaded();
  if (!id) return undefined;
  return textureRegistry.get(id);
}

let seqAssetId = 100;
export function nextTextureAssetId(): string {
  seqAssetId += 1;
  return `tex_${Date.now().toString(36)}_${seqAssetId}`;
}

export function makeTextureAssetFromRgba(opts: {
  id?: string;
  name: string;
  width: number;
  height: number;
  rectData: Uint8ClampedArray;
  displayForm?: TextureDisplayForm;
  paraConfig?: ParallelogramConfig;
  builtIn?: boolean;
  projectScoped?: boolean;
  groupId?: string;
  faceBakedTag?: string;
  createdAt?: number;
}): TextureAsset {
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const data = new Uint8ClampedArray(opts.rectData);
  const rawGroupId = opts.groupId?.trim();
  const groupId = opts.builtIn
    ? BUILTIN_PRESET_GROUP_ID
    : rawGroupId && rawGroupId !== BUILTIN_PRESET_GROUP_ID
      ? rawGroupId
      : undefined;
  const faceBakedTag = opts.faceBakedTag?.trim() || undefined;
  return {
    id: opts.id?.trim() || nextTextureAssetId(),
    name: opts.name.trim() || tr('自定义贴图'),
    builtIn: opts.builtIn,
    projectScoped: opts.projectScoped,
    ...(groupId ? { groupId } : {}),
    ...(faceBakedTag ? { faceBakedTag } : {}),
    width: w,
    height: h,
    rectData: data,
    pngDataUrl: rgbaToPngDataUrl(data, w, h),
    displayForm: opts.displayForm ?? 'rect',
    paraConfig: opts.paraConfig
      ? {
          ...opts.paraConfig,
          uVec: [...opts.paraConfig.uVec] as [number, number],
          vVec: [...opts.paraConfig.vVec] as [number, number],
        }
      : createDefaultParallelogramConfig(w, h, 'down_right', 2),
    createdAt: opts.createdAt ?? Date.now(),
  };
}

export function serializeTextureAsset(asset: TextureAsset): SerializedTextureAsset {
  const pngDataUrl = asset.pngDataUrl || rgbaToPngDataUrl(asset.rectData, asset.width, asset.height);
  const groupId = asset.builtIn ? BUILTIN_PRESET_GROUP_ID : asset.groupId?.trim() || undefined;
  const faceBakedTag = asset.faceBakedTag?.trim() || undefined;
  return {
    id: asset.id,
    name: asset.name,
    width: asset.width,
    height: asset.height,
    pngDataUrl,
    // Always preserve exact raw RGBA bytes so alpha in 16..254 never loses precision across Canvas roundtrips
    rgbaBase64: bytesToBase64(asset.rectData),
    displayForm: asset.displayForm,
    paraConfig: {
      ...asset.paraConfig,
      uVec: [...asset.paraConfig.uVec] as [number, number],
      vVec: [...asset.paraConfig.vVec] as [number, number],
    },
    ...(groupId ? { groupId } : {}),
    ...(faceBakedTag ? { faceBakedTag } : {}),
    createdAt: asset.createdAt,
  };
}

export async function deserializeTextureAsset(raw: SerializedTextureAsset): Promise<TextureAsset | null> {
  if (!raw || !raw.id || !raw.width || !raw.height) return null;
  let rectData: Uint8ClampedArray | null = null;
  let w = Math.max(1, Math.round(raw.width));
  let h = Math.max(1, Math.round(raw.height));

  if (raw.rgbaBase64) {
    const decoded = base64ToBytes(raw.rgbaBase64);
    if (decoded.length === w * h * 4) rectData = decoded;
  }
  if (!rectData && raw.pngDataUrl) {
    const imgData = await pngDataUrlToRgba(raw.pngDataUrl);
    if (imgData) {
      rectData = imgData.data;
      w = imgData.width;
      h = imgData.height;
    }
  }
  if (!rectData) return null;

  const rawGroupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : '';
  const groupId = rawGroupId && rawGroupId !== BUILTIN_PRESET_GROUP_ID ? rawGroupId : undefined;
  const faceBakedTag = typeof raw.faceBakedTag === 'string' ? raw.faceBakedTag.trim() || undefined : undefined;

  return {
    id: raw.id,
    name: raw.name || tr('导入贴图'),
    ...(groupId ? { groupId } : {}),
    ...(faceBakedTag ? { faceBakedTag } : {}),
    width: w,
    height: h,
    rectData,
    pngDataUrl: raw.pngDataUrl || rgbaToPngDataUrl(rectData, w, h),
    displayForm: raw.displayForm === 'parallelogram' ? 'parallelogram' : 'rect',
    paraConfig: raw.paraConfig
      ? {
          mode: raw.paraConfig.mode ?? 'sawtooth',
          direction: raw.paraConfig.direction === 'up_right' ? 'up_right' : 'down_right',
          step: clamp(Math.round(raw.paraConfig.step || 2), 1, 16),
          uVec: Array.isArray(raw.paraConfig.uVec) && raw.paraConfig.uVec.length === 2
            ? [raw.paraConfig.uVec[0], raw.paraConfig.uVec[1]]
            : [w, Math.floor((w - 1) / 2)],
          vVec: Array.isArray(raw.paraConfig.vVec) && raw.paraConfig.vVec.length === 2
            ? [raw.paraConfig.vVec[0], raw.paraConfig.vVec[1]]
            : [0, h],
        }
      : createDefaultParallelogramConfig(w, h, 'down_right', 2),
    createdAt: raw.createdAt ?? Date.now(),
  };
}

export function hydratePersistedTextureAssets(assets: TextureAsset[]): number {
  ensureBuiltinLoaded();
  let count = 0;
  for (const a of assets) {
    if (!a?.id || textureRegistry.get(a.id)?.builtIn) continue;
    delete a.projectScoped;
    textureRegistry.set(a.id, a);
    count++;
  }
  if (count > 0) notifyLibraryListeners('list');
  return count;
}

export function upsertTextureAsset(asset: TextureAsset): TextureAsset {
  ensureBuiltinLoaded();
  delete asset.projectScoped;
  textureRegistry.set(asset.id, asset);
  notifyLibraryListeners('list');
  return asset;
}

export function commitTextureAssetEdit(asset: TextureAsset, pixelsChanged: boolean): TextureAsset {
  ensureBuiltinLoaded();
  if (!asset.builtIn) delete asset.projectScoped;
  textureRegistry.set(asset.id, asset);
  notifyLibraryListeners(pixelsChanged ? 'pixels' : 'display');
  return asset;
}

export function removeTextureAsset(id: string): boolean {
  const existing = textureRegistry.get(id);
  if (!existing || existing.builtIn) return false;
  textureRegistry.delete(id);
  notifyLibraryListeners('list');
  return true;
}

export function toggleTextureAssetForm(id: string): TextureAsset | null {
  const a = textureRegistry.get(id);
  if (!a) return null;
  a.displayForm = a.displayForm === 'rect' ? 'parallelogram' : 'rect';
  notifyLibraryListeners('display');
  return a;
}

function assetPixelsEqual(a: TextureAsset, b: TextureAsset): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.rectData.length !== b.rectData.length) return false;
  for (let i = 0; i < a.rectData.length; i++) {
    if (a.rectData[i] !== b.rectData[i]) return false;
  }
  return true;
}

/**
 * Registers custom texture assets bundled inside a `.bmeow` project safely:
 * - Marks newly registered project assets as `projectScoped: true` so opening someone else's project does not pollute the global library.
 * - Never overwrites existing user assets with the same ID; if pixels differ, allocates a fresh remapped ID and returns `oldId -> newId`.
 */
export async function registerSerializedTextureAssets(
  list: SerializedTextureAsset[] | undefined,
): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  if (!Array.isArray(list) || list.length === 0) return remap;
  ensureBuiltinLoaded();
  let added = false;

  for (const raw of list) {
    if (!raw?.id) continue;
    if (textureRegistry.get(raw.id)?.builtIn) continue;
    const asset = await deserializeTextureAsset(raw);
    if (!asset) continue;

    const existing = textureRegistry.get(asset.id);
    if (!existing) {
      asset.projectScoped = true;
      textureRegistry.set(asset.id, asset);
      added = true;
      continue;
    }

    if (assetPixelsEqual(existing, asset)) {
      // Exact pixel match already in library — reuse it without overwriting user's displayForm/paraConfig
      continue;
    }

    // Same ID but different pixel payload -> allocate a safe project-scoped alias ID
    let aliasId = nextTextureAssetId();
    while (textureRegistry.has(aliasId)) aliasId = nextTextureAssetId();
    asset.id = aliasId;
    asset.projectScoped = true;
    textureRegistry.set(aliasId, asset);
    remap.set(raw.id, aliasId);
    added = true;
  }

  if (added) {
    notifyLibraryListeners('project_hydrate');
  }
  return remap;
}

// ---------------- Non-Destructive Texture Crop Helpers ----------------

export function normalizeCropRect(
  crop: TextureCropRect | undefined | null,
  assetW: number,
  assetH: number,
): TextureCropRect | undefined {
  if (!crop || assetW <= 0 || assetH <= 0) return undefined;
  const maxW = Math.max(1, Math.round(assetW));
  const maxH = Math.max(1, Math.round(assetH));
  const x = clamp(Math.round(crop.x), 0, maxW - 1);
  const y = clamp(Math.round(crop.y), 0, maxH - 1);
  const w = clamp(Math.round(crop.w), 1, maxW - x);
  const h = clamp(Math.round(crop.h), 1, maxH - y);
  if (x === 0 && y === 0 && w === maxW && h === maxH) return undefined;
  return { x, y, w, h };
}

export function getEffectiveAssetDims(
  asset: Pick<TextureAsset, 'width' | 'height'>,
  crop?: TextureCropRect | null,
): { x: number; y: number; w: number; h: number } {
  const norm = normalizeCropRect(crop, asset.width, asset.height);
  if (norm) return norm;
  return { x: 0, y: 0, w: Math.max(1, asset.width), h: Math.max(1, asset.height) };
}

export function cropRgbaBuffer(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  crop: TextureCropRect,
): { data: Uint8ClampedArray; width: number; height: number } {
  const norm = normalizeCropRect(crop, srcW, srcH) ?? { x: 0, y: 0, w: srcW, h: srcH };
  const out = new Uint8ClampedArray(norm.w * norm.h * 4);
  for (let row = 0; row < norm.h; row++) {
    const srcStart = ((norm.y + row) * srcW + norm.x) * 4;
    const dstStart = row * norm.w * 4;
    out.set(src.subarray(srcStart, srcStart + norm.w * 4), dstStart);
  }
  return { data: out, width: norm.w, height: norm.h };
}

export function autoTrimTransparentCrop(
  src: Uint8ClampedArray,
  w: number,
  h: number,
): TextureCropRect {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] >= 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: Math.max(1, w), h: Math.max(1, h) };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ---------------- Planar Face Enumeration & Shape Slot Helpers ----------------

export function cloneFaceTextureSlot(slot: FaceTextureSlot): FaceTextureSlot {
  return {
    mode: slot.mode,
    assetId: slot.assetId,
    crop: slot.crop ? { ...slot.crop } : undefined,
    tileScale: slot.tileScale,
    offsetX: slot.offsetX,
    offsetY: slot.offsetY,
    flipX: Boolean(slot.flipX),
    flipY: Boolean(slot.flipY),
    rot90: slot.rot90 ?? 0,
    opacity: slot.opacity ?? 1,
    shadeWithFace: slot.shadeWithFace ?? true,
    items: slot.items
      ? slot.items.map((it) => ({
          ...it,
          crop: it.crop ? { ...it.crop } : undefined,
        }))
      : undefined,
  };
}

export function cloneFaceTextures(
  src?: Record<string, FaceTextureSlot>,
): Record<string, FaceTextureSlot> | undefined {
  if (!src) return undefined;
  const out: Record<string, FaceTextureSlot> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue;
    out[k] = cloneFaceTextureSlot(v);
    hasAny = true;
  }
  return hasAny ? out : undefined;
}

export function getLocalDimsFromShape(
  s: Pick<ParametricShape, 'sizeU' | 'sizeV' | 'ori'>,
): { lsu: number; lsv: number } {
  const odd = normalizeRotation(s.ori) % 2 === 1;
  return {
    lsu: Math.max(0.0625, odd ? s.sizeV : s.sizeU),
    lsv: Math.max(0.0625, odd ? s.sizeU : s.sizeV),
  };
}

export function getPlanarFacesForShape(
  s: Pick<ParametricShape, 'shapeType' | 'sizeU' | 'sizeV' | 'heightPx' | 'ori' | 'flipZ' | 'prismSides' | 'triPrismCut' | 'wedgeMode'>,
): PlanarFaceSpec[] {
  const { lsu, lsv } = getLocalDimsFromShape(s);
  const wU = Math.max(4, Math.round(lsu * 16));
  const wV = Math.max(4, Math.round(lsv * 16));
  const wallH = Math.max(4, Math.round(s.heightPx));

  switch (s.shapeType) {
    case 'box':
      return [
        { id: 'wall_pv', label: '前左墙 (+V)', shortLabel: '前左 (+V)', faceW: wU, faceH: wallH, isTop: false, defaultIsoMode: 'wall_down_right' },
        { id: 'wall_pu', label: '前右墙 (+U)', shortLabel: '前右 (+U)', faceW: wV, faceH: wallH, isTop: false, defaultIsoMode: 'wall_up_right' },
        { id: 'top', label: '顶面 (+Z)', shortLabel: '顶面 (+Z)', faceW: wU, faceH: wV, isTop: true, defaultIsoMode: 'iso_diamond' },
        { id: 'wall_nv', label: '后右墙 (-V)', shortLabel: '后右 (-V)', faceW: wU, faceH: wallH, isTop: false, defaultIsoMode: 'wall_down_right' },
        { id: 'wall_nu', label: '后左墙 (-U)', shortLabel: '后左 (-U)', faceW: wV, faceH: wallH, isTop: false, defaultIsoMode: 'wall_up_right' },
      ];

    case 'prism': {
      const n = clamp(Math.round(Number.isFinite(s.prismSides) ? s.prismSides : 6), 3, 12);
      const stepAng = (Math.PI * 2) / n;
      const startAng = Math.PI / n;
      const topPolyUV: [number, number][] = [];
      const ringLocal: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = startAng - i * stepAng;
        const lu = 0.5 + 0.5 * Math.cos(a);
        const lv = 0.5 + 0.5 * Math.sin(a);
        ringLocal.push([lu, lv]);
        topPolyUV.push([lu, lv]);
      }
      const faces: PlanarFaceSpec[] = [
        {
          id: 'top',
          label: `顶面 (${n}边形)`,
          shortLabel: '顶面 (+Z)',
          faceW: wU,
          faceH: wV,
          isTop: true,
          defaultIsoMode: 'iso_diamond',
          clipPolyUV: topPolyUV,
        },
      ];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const du = (ringLocal[j][0] - ringLocal[i][0]) * lsu;
        const dv = (ringLocal[j][1] - ringLocal[i][1]) * lsv;
        const sideW = Math.max(4, Math.round(Math.hypot(du, dv) * 16));
        const midAngle = startAng - (i + 0.5) * stepAng;
        const isUpRight = Math.cos(midAngle) > Math.sin(midAngle);
        faces.push({
          id: `side_${i}`,
          label: `侧面 #${i + 1}`,
          shortLabel: `侧面 #${i + 1}`,
          faceW: sideW,
          faceH: wallH,
          isTop: false,
          defaultIsoMode: isUpRight ? 'wall_up_right' : 'wall_down_right',
        });
      }
      return faces;
    }

    case 'right_tri_prism': {
      if ((s.triPrismCut ?? 'vertical') === 'slope') {
        return getPlanarFacesForShape({ ...s, shapeType: 'wedge', wedgeMode: 'ramp' });
      }
      const hypW = Math.max(4, Math.round(Math.hypot(lsu, lsv) * 16));
      return [
        { id: 'wall_hyp', label: '竖直斜切面', shortLabel: '斜切面', faceW: hypW, faceH: wallH, isTop: false, defaultIsoMode: 'wall_down_right' },
        { id: 'wall_nu', label: '直角左墙 (-U)', shortLabel: '左墙 (-U)', faceW: wV, faceH: wallH, isTop: false, defaultIsoMode: 'wall_up_right' },
        { id: 'wall_nv', label: '直角右墙 (-V)', shortLabel: '右墙 (-V)', faceW: wU, faceH: wallH, isTop: false, defaultIsoMode: 'wall_down_right' },
        {
          id: 'top',
          label: '三角顶面 (+Z)',
          shortLabel: '顶面 (+Z)',
          faceW: wU,
          faceH: wV,
          isTop: true,
          defaultIsoMode: 'iso_diamond',
          clipPolyUV: [[0, 0], [0, 1], [1, 0]],
        },
      ];
    }

    case 'wedge': {
      const flippedTopFace: PlanarFaceSpec[] = s.flipZ
        ? [{ id: 'top', label: '顶面 (+Z)', shortLabel: '顶面 (+Z)', faceW: wU, faceH: wV, isTop: true, defaultIsoMode: 'iso_diamond' }]
        : [];
      if (s.wedgeMode === 'gable') {
        const slopeLenPx = Math.max(4, Math.round(Math.hypot(lsv * 8, s.heightPx)));
        return [
          ...flippedTopFace,
          { id: 'slope_pv', label: '前左屋坡 (+V)', shortLabel: '前坡 (+V)', faceW: wU, faceH: slopeLenPx, isTop: false, defaultIsoMode: 'wall_down_right' },
          { id: 'slope_nv', label: '后右屋坡 (-V)', shortLabel: '后坡 (-V)', faceW: wU, faceH: slopeLenPx, isTop: false, defaultIsoMode: 'wall_down_right' },
          {
            id: 'gable_pu',
            label: '前右山墙 (+U)',
            shortLabel: '右山墙',
            faceW: wV,
            faceH: wallH,
            isTop: false,
            defaultIsoMode: 'wall_up_right',
            clipPolyUV: [[0, 1], [1, 1], [0.5, 0]],
          },
          {
            id: 'gable_nu',
            label: '后左山墙 (-U)',
            shortLabel: '左山墙',
            faceW: wV,
            faceH: wallH,
            isTop: false,
            defaultIsoMode: 'wall_up_right',
            clipPolyUV: [[0, 1], [1, 1], [0.5, 0]],
          },
        ];
      }
      const slopeLenPx = Math.max(4, Math.round(Math.hypot(lsu * 16, s.heightPx)));
      return [
        ...flippedTopFace,
        { id: 'slope_main', label: '单坡屋面', shortLabel: '单坡斜面', faceW: wV, faceH: slopeLenPx, isTop: false, defaultIsoMode: 'wall_up_right' },
        { id: 'wall_back', label: '直立高墙 (+U)', shortLabel: '高墙 (+U)', faceW: wV, faceH: wallH, isTop: false, defaultIsoMode: 'wall_up_right' },
        {
          id: 'tri_pv',
          label: '前左三角墙 (+V)',
          shortLabel: '前三角',
          faceW: wU,
          faceH: wallH,
          isTop: false,
          defaultIsoMode: 'wall_down_right',
          clipPolyUV: [[0, 1], [1, 1], [1, 0]],
        },
        {
          id: 'tri_nv',
          label: '后右三角墙 (-V)',
          shortLabel: '后三角',
          faceW: wU,
          faceH: wallH,
          isTop: false,
          defaultIsoMode: 'wall_down_right',
          clipPolyUV: [[0, 1], [1, 1], [0, 0]],
        },
      ];
    }

    case 'pyramid': {
      const slantU = Math.max(4, Math.round(Math.hypot(lsu * 8, s.heightPx)));
      const slantV = Math.max(4, Math.round(Math.hypot(lsv * 8, s.heightPx)));
      const flippedTopFace: PlanarFaceSpec[] = s.flipZ
        ? [{ id: 'top', label: '顶面 (+Z)', shortLabel: '顶面 (+Z)', faceW: wU, faceH: wV, isTop: true, defaultIsoMode: 'iso_diamond' }]
        : [];
      return [
        ...flippedTopFace,
        { id: 'pyr_pv', label: '前左斜面 (+V)', shortLabel: '前左面', faceW: wU, faceH: slantV, isTop: false, defaultIsoMode: 'wall_down_right', clipPolyUV: [[0, 1], [1, 1], [0.5, 0]] },
        { id: 'pyr_pu', label: '前右斜面 (+U)', shortLabel: '前右面', faceW: wV, faceH: slantU, isTop: false, defaultIsoMode: 'wall_up_right', clipPolyUV: [[0, 1], [1, 1], [0.5, 0]] },
        { id: 'pyr_nv', label: '后右斜面 (-V)', shortLabel: '后右面', faceW: wU, faceH: slantV, isTop: false, defaultIsoMode: 'wall_down_right', clipPolyUV: [[0, 1], [1, 1], [0.5, 0]] },
        { id: 'pyr_nu', label: '后左斜面 (-U)', shortLabel: '后左面', faceW: wV, faceH: slantU, isTop: false, defaultIsoMode: 'wall_up_right', clipPolyUV: [[0, 1], [1, 1], [0.5, 0]] },
      ];
    }

    default:
      return [];
  }
}

export function getActiveFaceIdReadOnly(shape: ParametricShape): string | undefined {
  const faces = getPlanarFacesForShape(shape);
  if (faces.length === 0) return undefined;
  if (shape.activeFaceId && faces.some((f) => f.id === shape.activeFaceId)) {
    return shape.activeFaceId;
  }
  return faces[0].id;
}

export function ensureActiveFaceId(shape: ParametricShape): string | undefined {
  const faces = getPlanarFacesForShape(shape);
  if (faces.length === 0) {
    delete shape.activeFaceId;
    return undefined;
  }
  if (shape.activeFaceId && faces.some((f) => f.id === shape.activeFaceId)) {
    return shape.activeFaceId;
  }
  shape.activeFaceId = faces[0].id;
  return shape.activeFaceId;
}

function sanitizeRawCrop(raw: TextureCropRect | undefined | null, assetId?: string): TextureCropRect | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.w) || !Number.isFinite(raw.h)) {
    return undefined;
  }
  const asset = getTextureAsset(assetId);
  if (asset) {
    return normalizeCropRect(raw, asset.width, asset.height);
  }
  const x = Math.max(0, Math.round(raw.x));
  const y = Math.max(0, Math.round(raw.y));
  const w = Math.max(1, Math.round(raw.w));
  const h = Math.max(1, Math.round(raw.h));
  return { x, y, w, h };
}

export function sanitizeFaceTexturesForShape(shape: ParametricShape): void {
  if (!isPlanarTextureShape(shape)) {
    delete shape.faceTextures;
    delete shape.activeFaceId;
    return;
  }
  if (!shape.faceTextures || typeof shape.faceTextures !== 'object') {
    delete shape.faceTextures;
    return;
  }
  const validFaceIds = new Set(getPlanarFacesForShape(shape).map((f) => f.id));
  const clean: Record<string, FaceTextureSlot> = {};
  let count = 0;
  for (const [k, raw] of Object.entries(shape.faceTextures)) {
    if (!validFaceIds.has(k) || !raw || typeof raw !== 'object') continue;
    const mode: FaceTextureMode =
      raw.mode === 'stretch' || raw.mode === 'tile' || raw.mode === 'custom'
        ? raw.mode
        : 'none';
    if (mode === 'none') continue;
    const assetId = typeof raw.assetId === 'string' ? raw.assetId : undefined;
    const slot: FaceTextureSlot = {
      mode,
      assetId,
      crop: sanitizeRawCrop(raw.crop, assetId),
      tileScale: Number.isFinite(raw.tileScale) ? clamp(raw.tileScale!, 0.25, 8) : 1,
      offsetX: Number.isFinite(raw.offsetX) ? Math.round(raw.offsetX!) : 0,
      offsetY: Number.isFinite(raw.offsetY) ? Math.round(raw.offsetY!) : 0,
      flipX: Boolean(raw.flipX),
      flipY: Boolean(raw.flipY),
      rot90: (Number.isFinite(raw.rot90) ? ((Math.round(raw.rot90!) % 4 + 4) % 4) : 0) as 0 | 1 | 2 | 3,
      opacity: Number.isFinite(raw.opacity) ? clamp(raw.opacity!, 0, 1) : 1,
      shadeWithFace: raw.shadeWithFace !== false,
    };
    if (Array.isArray(raw.items)) {
      slot.items = raw.items
        .filter((it) => it && typeof it.assetId === 'string')
        .map((it, idx) => ({
          id: typeof it.id === 'string' && it.id ? it.id : `decal_${idx}_${Date.now()}`,
          assetId: it.assetId,
          crop: sanitizeRawCrop(it.crop, it.assetId),
          x: Number.isFinite(it.x) ? it.x : 0,
          y: Number.isFinite(it.y) ? it.y : 0,
          w: Math.max(1, Number.isFinite(it.w) ? it.w : 8),
          h: Math.max(1, Number.isFinite(it.h) ? it.h : 8),
          tileFill: Boolean(it.tileFill),
          flipX: Boolean(it.flipX),
          flipY: Boolean(it.flipY),
          rot90: (Number.isFinite(it.rot90) ? ((Math.round(it.rot90!) % 4 + 4) % 4) : 0) as 0 | 1 | 2 | 3,
          opacity: Number.isFinite(it.opacity) ? clamp(it.opacity!, 0, 1) : 1,
          visible: it.visible !== false,
        }));
    }
    clean[k] = slot;
    count++;
  }
  if (count > 0) shape.faceTextures = clean;
  else delete shape.faceTextures;
}

export function collectReferencedTextureAssetIds(shapes: (ParametricShape | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const s of shapes) {
    if (!s?.faceTextures) continue;
    for (const slot of Object.values(s.faceTextures)) {
      if (!slot) continue;
      if (slot.assetId) ids.add(slot.assetId);
      if (Array.isArray(slot.items)) {
        for (const it of slot.items) {
          if (it.assetId) ids.add(it.assetId);
        }
      }
    }
  }
  return [...ids];
}

export function countTextureAssetUsage(shapes: (ParametricShape | undefined)[], assetId: string): number {
  let count = 0;
  for (const s of shapes) {
    if (!s?.faceTextures) continue;
    for (const slot of Object.values(s.faceTextures)) {
      if (!slot || slot.mode === 'none') continue;
      if ((slot.mode === 'stretch' || slot.mode === 'tile') && slot.assetId === assetId) {
        count++;
      } else if (slot.mode === 'custom' && Array.isArray(slot.items)) {
        for (const it of slot.items) {
          if (it.assetId === assetId) count++;
        }
      }
    }
  }
  return count;
}

// ---------------- Face Texture Sampling (Stretch / Tile / Custom Puzzle + Non-Destructive Crop) ----------------

function sampleAssetNearest(
  asset: TextureAsset,
  u: number,
  v: number,
  flipX: boolean,
  flipY: boolean,
  rot90: 0 | 1 | 2 | 3,
  crop?: TextureCropRect,
): RGBA | null {
  let lu = clamp(u, 0, 0.999999);
  let lv = clamp(v, 0, 0.999999);
  if (flipX) lu = 1 - lu - 1e-6;
  if (flipY) lv = 1 - lv - 1e-6;

  let su = lu;
  let sv = lv;
  if (rot90 === 1) {
    su = lv;
    sv = 1 - lu - 1e-6;
  } else if (rot90 === 2) {
    su = 1 - lu - 1e-6;
    sv = 1 - lv - 1e-6;
  } else if (rot90 === 3) {
    su = 1 - lv - 1e-6;
    sv = lu;
  }

  const eff = getEffectiveAssetDims(asset, crop);
  const tx = eff.x + clamp(Math.floor(su * eff.w), 0, eff.w - 1);
  const ty = eff.y + clamp(Math.floor(sv * eff.h), 0, eff.h - 1);
  const idx = (ty * asset.width + tx) * 4;
  const a = asset.rectData[idx + 3];
  if (a < 16) return null;
  return {
    r: asset.rectData[idx],
    g: asset.rectData[idx + 1],
    b: asset.rectData[idx + 2],
    a,
  };
}

function posMod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/**
 * Evaluates a planar face's texture RGBA at normalized face coordinates `(uTex, vTex) in [0, 1]^2`.
 * Always samples in canonical orthogonal pixel space without anti-aliasing blur.
 */
export function sampleFaceTextureRGBA(
  slot: FaceTextureSlot | undefined,
  uTex: number,
  vTex: number,
  faceW: number,
  faceH: number,
): RGBA | null {
  if (!slot || slot.mode === 'none') return null;
  const u = clamp(uTex, 0, 0.999999);
  const v = clamp(vTex, 0, 0.999999);

  if (slot.mode === 'stretch') {
    const asset = getTextureAsset(slot.assetId);
    if (!asset) return null;
    const c = sampleAssetNearest(asset, u, v, Boolean(slot.flipX), Boolean(slot.flipY), slot.rot90 ?? 0, slot.crop);
    if (!c) return null;
    const op = clamp(slot.opacity ?? 1, 0, 1);
    const a = Math.round(c.a * op);
    return a >= 16 ? { r: c.r, g: c.g, b: c.b, a } : null;
  }

  if (slot.mode === 'tile') {
    const asset = getTextureAsset(slot.assetId);
    if (!asset) return null;
    const rot = slot.rot90 ?? 0;
    const eff = getEffectiveAssetDims(asset, slot.crop);
    const scale = clamp(slot.tileScale ?? 1, 0.25, 8);
    const rotW = rot % 2 === 1 ? eff.h : eff.w;
    const rotH = rot % 2 === 1 ? eff.w : eff.h;
    const fx = u * Math.max(1, faceW) - (slot.offsetX ?? 0);
    const fy = v * Math.max(1, faceH) - (slot.offsetY ?? 0);
    const periodW = Math.max(1, rotW * scale);
    const periodH = Math.max(1, rotH * scale);
    const tu = posMod(fx, periodW) / periodW;
    const tv = posMod(fy, periodH) / periodH;
    const c = sampleAssetNearest(asset, tu, tv, Boolean(slot.flipX), Boolean(slot.flipY), rot, slot.crop);
    if (!c) return null;
    const op = clamp(slot.opacity ?? 1, 0, 1);
    const a = Math.round(c.a * op);
    return a >= 16 ? { r: c.r, g: c.g, b: c.b, a } : null;
  }

  // 'custom' mode: stack ordered decal items bottom-to-top on face [0, faceW) x [0, faceH)
  if (slot.mode === 'custom' && Array.isArray(slot.items) && slot.items.length > 0) {
    const fx = u * Math.max(1, faceW);
    const fy = v * Math.max(1, faceH);
    let outR = 0, outG = 0, outB = 0, outA = 0;

    for (let i = 0; i < slot.items.length; i++) {
      const it = slot.items[i];
      if (it.visible === false || it.w <= 0 || it.h <= 0) continue;
      if (fx < it.x || fx >= it.x + it.w || fy < it.y || fy >= it.y + it.h) continue;
      const asset = getTextureAsset(it.assetId);
      if (!asset) continue;
      const rot = it.rot90 ?? 0;
      const eff = getEffectiveAssetDims(asset, it.crop);
      const lx = fx - it.x;
      const ly = fy - it.y;
      let tu: number;
      let tv: number;
      if (it.tileFill) {
        const rotW = Math.max(1, rot % 2 === 1 ? eff.h : eff.w);
        const rotH = Math.max(1, rot % 2 === 1 ? eff.w : eff.h);
        tu = posMod(lx, rotW) / rotW;
        tv = posMod(ly, rotH) / rotH;
      } else {
        tu = lx / it.w;
        tv = ly / it.h;
      }
      const c = sampleAssetNearest(asset, tu, tv, Boolean(it.flipX), Boolean(it.flipY), rot, it.crop);
      if (!c) continue;
      const op = clamp(it.opacity ?? 1, 0, 1) * (c.a / 255);
      if (op <= 0.05) continue;
      if (op >= 0.99 || outA === 0) {
        outR = c.r;
        outG = c.g;
        outB = c.b;
        outA = Math.max(outA, Math.round(op * 255));
      } else {
        const inv = 1 - op;
        outR = Math.round(outR * inv + c.r * op);
        outG = Math.round(outG * inv + c.g * op);
        outB = Math.round(outB * inv + c.b * op);
        outA = Math.min(255, Math.round(outA + (255 - outA) * op));
      }
    }
    return outA >= 16 ? { r: outR, g: outG, b: outB, a: outA } : null;
  }

  return null;
}

function isPointInPolyUV(poly: [number, number][] | undefined, u: number, v: number): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > v) !== (yj > v)) && (u < ((xj - xi) * (v - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Extracts a flat orthogonal pixel buffer of size `faceSpec.faceW x faceSpec.faceH`
 * for whole-face pixel editing (or composited over `opts.bakeBaseColor` when provided).
 * Respects `faceSpec.clipPolyUV` (pixels outside remain transparent `[0, 0, 0, 0]`).
 */
export function extractFaceTextureLayerBuffer(
  faceSpec: PlanarFaceSpec,
  slot: FaceTextureSlot | undefined,
  opts?: { bakeBaseColor?: RGBA },
): { data: Uint8ClampedArray; width: number; height: number } {
  const w = Math.max(1, Math.round(faceSpec.faceW));
  const h = Math.max(1, Math.round(faceSpec.faceH));
  const out = new Uint8ClampedArray(w * h * 4);
  const poly = faceSpec.clipPolyUV;
  const bakeBase = opts?.bakeBaseColor;

  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) / h;
    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      if (!isPointInPolyUV(poly, u, v)) continue;
      const di = (py * w + px) * 4;
      const tex = sampleFaceTextureRGBA(slot, u, v, w, h);
      if (bakeBase) {
        let r = bakeBase.r;
        let g = bakeBase.g;
        let b = bakeBase.b;
        if (tex) {
          if (tex.a >= 250) {
            r = tex.r; g = tex.g; b = tex.b;
          } else {
            const a = tex.a / 255;
            r = Math.round(r * (1 - a) + tex.r * a);
            g = Math.round(g * (1 - a) + tex.g * a);
            b = Math.round(b * (1 - a) + tex.b * a);
          }
        }
        out[di] = r;
        out[di + 1] = g;
        out[di + 2] = b;
        out[di + 3] = 255;
      } else if (tex) {
        out[di] = tex.r;
        out[di + 1] = tex.g;
        out[di + 2] = tex.b;
        out[di + 3] = tex.a;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Generates a flat orthogonal pixel preview buffer of size `faceSpec.faceW x faceSpec.faceH`
 * for a face slot (respecting clipPolyUV outside transparency).
 */
export function renderFaceTextureFlatBuffer(
  faceSpec: PlanarFaceSpec,
  slot: FaceTextureSlot | undefined,
  baseColor: RGBA,
): { data: Uint8ClampedArray; width: number; height: number } {
  return extractFaceTextureLayerBuffer(faceSpec, slot, { bakeBaseColor: baseColor });
}

/**
 * Bakes an edited whole-face pixel buffer into a brand-new `TextureAsset` (never mutating any
 * existing asset in place so 3D History undo snapshots and shared library textures stay intact)
 * and assigns it to `shape.faceTextures[faceSpec.id]` in `stretch` mode.
 */
export function applyEditedFaceBufferToShape(opts: {
  shape: ParametricShape;
  layerId?: number;
  faceSpec: PlanarFaceSpec;
  rgbaData: Uint8ClampedArray;
  width: number;
  height: number;
  assetName?: string;
  groupId?: string;
}): TextureAsset {
  ensureBuiltinLoaded();
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const buf = new Uint8ClampedArray(w * h * 4);
  buf.set(opts.rgbaData.subarray(0, buf.length));
  const prevShade = opts.shape.faceTextures?.[opts.faceSpec.id]?.shadeWithFace ?? true;
  const rawGroupId = opts.groupId?.trim();
  const targetGroupId =
    rawGroupId && rawGroupId !== BUILTIN_PRESET_GROUP_ID && (rawGroupId === DEFAULT_USER_GROUP_ID || customGroups.has(rawGroupId))
      ? rawGroupId
      : DEFAULT_USER_GROUP_ID;

  const asset = makeTextureAssetFromRgba({
    name: opts.assetName?.trim() || tr(`${opts.faceSpec.shortLabel || opts.faceSpec.label} 贴图`),
    width: w,
    height: h,
    rectData: buf,
    displayForm: 'rect',
    groupId: targetGroupId,
    faceBakedTag: `${opts.layerId ?? 'shape'}:${opts.faceSpec.id}`,
  });
  upsertTextureAsset(asset);

  if (!opts.shape.faceTextures) opts.shape.faceTextures = {};
  opts.shape.faceTextures[opts.faceSpec.id] = {
    mode: 'stretch',
    assetId: asset.id,
    shadeWithFace: prevShade,
    opacity: 1,
  };
  return asset;
}
