// Shared TheoTown isometric green base unit tile & built-in template asset registry
import { STEP_X, STEP_Y, TILE_H, TILE_W } from './isoMath';

// Authentic TheoTown 1×1 base tile palette (0-byte diff against official templates)
const COL_FILL: [number, number, number, number] = [82, 134, 40, 255];   // #528628 grass body
const COL_LIGHT: [number, number, number, number] = [121, 220, 40, 255]; // #79dc28 left highlight edge
const COL_DARK: [number, number, number, number] = [51, 91, 19, 255];    // #335b13 right shadow edge

let cachedUnitTile32: Uint8ClampedArray | null = null;

/**
 * Returns an RGBA buffer of size 32×16 representing a single 1×1 TheoTown green base tile.
 */
export function getTheoTownUnitTile(): Uint8ClampedArray {
  if (cachedUnitTile32) return cachedUnitTile32;
  const tileW = TILE_W;
  const tileH = TILE_H;
  const midY = tileH >> 1;
  const buf = new Uint8ClampedArray(tileW * tileH * 4);
  const edgePx = 2;

  for (let y = 1; y < tileH; y++) {
    const d = Math.abs(y - midY);
    const x0 = 2 * d;
    const x1 = tileW - 1 - 2 * d;
    if (x1 < x0) continue;
    const span = x1 - x0 + 1;
    const bw = span <= 4 ? 1 : edgePx;

    for (let x = x0; x <= x1; x++) {
      const col = x < x0 + bw ? COL_LIGHT : x > x1 - bw ? COL_DARK : COL_FILL;
      const idx = (y * tileW + x) * 4;
      buf[idx] = col[0];
      buf[idx + 1] = col[1];
      buf[idx + 2] = col[2];
      buf[idx + 3] = col[3];
    }
  }
  cachedUnitTile32 = buf;
  return buf;
}

/**
 * Stamps a `countU × countV` rectangular TheoTown isometric base into `dst` RGBA buffer.
 * `anchorX, anchorY` is the top-left of the (0,0) tile box:
 * specifically, tile (0,0)'s top tip is at `(anchorX + 16, anchorY + 1)`.
 * Matching isoToScreenPx(0, 0, zPx, originX, originY):
 *   anchorX = Math.round(originX) - 16
 *   anchorY = Math.round(originY - zPx)
 */
export function stampIsoBaseToBuffer(
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  anchorX: number,
  anchorY: number,
  countU: number,
  countV: number,
): boolean {
  const tile = getTheoTownUnitTile();
  const cu = Math.max(1, Math.round(countU));
  const cv = Math.max(1, Math.round(countV));
  let wroteAny = false;

  const maxSum = (cu - 1) + (cv - 1);
  for (let sum = 0; sum <= maxSum; sum++) {
    const uStart = Math.max(0, sum - (cv - 1));
    const uEnd = Math.min(cu - 1, sum);
    for (let u = uStart; u <= uEnd; u++) {
      const v = sum - u;
      const ox = anchorX + (u - v) * STEP_X;
      const oy = anchorY + (u + v) * STEP_Y;

      if (ox + TILE_W <= 0 || oy + TILE_H <= 0 || ox >= dstW || oy >= dstH) continue;

      const ty0 = Math.max(1, -oy);
      const ty1 = Math.min(TILE_H - 1, dstH - 1 - oy);
      const tx0 = Math.max(0, -ox);
      const tx1 = Math.min(TILE_W - 1, dstW - 1 - ox);

      for (let ty = ty0; ty <= ty1; ty++) {
        const dy = oy + ty;
        const rowOff = dy * dstW;
        const tRowOff = ty * TILE_W;
        for (let tx = tx0; tx <= tx1; tx++) {
          const si = (tRowOff + tx) * 4;
          if (tile[si + 3] === 0) continue;
          const di = (rowOff + ox + tx) * 4;
          dst[di] = tile[si];
          dst[di + 1] = tile[si + 1];
          dst[di + 2] = tile[si + 2];
          dst[di + 3] = 255;
          wroteAny = true;
        }
      }
    }
  }
  return wroteAny;
}

export interface TheoTownTemplateInfo {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  url: string;
}

export const THEOTOWN_TEMPLATES: TheoTownTemplateInfo[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  id: `template_${n}x${n}`,
  name: `TheoTown ${n}×${n} 底板模板`,
  size: n,
  width: n * TILE_W,
  height: n * TILE_H,
  url: `./theotown/template_${n}x${n}.png`,
}));

export function resolveAssetUrl(relUrl: string): string {
  const inlineMap = (globalThis as { __BMEOW_INLINE_ASSETS__?: Record<string, string> }).__BMEOW_INLINE_ASSETS__;
  return inlineMap?.[relUrl] ?? relUrl;
}

export function loadTemplateImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`无法加载贴图模板: ${url}`));
    img.src = resolveAssetUrl(url);
  });
}
