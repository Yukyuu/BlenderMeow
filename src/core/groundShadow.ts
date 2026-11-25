// Automatic TheoTown 1:1 Direct-Right Ground Shadow Engine
// Rule: sunlight from left, shadows cast strictly to the direct right (+X screen) with 1:1 pixel length to Z elevation above ground (Z = 0).
// Ground shadow renders beneath all 3D shapes (above ground/underlays) and never casts onto other 3D shapes.

import { buildArchCrossSection, getArchSampleCount } from './arch';
import { clamp, type RGBA } from './color';
import { buildColumnRings, getColumnLocalBounds, hasActiveColumnSections } from './columnSections';
import { isoToScreenPx, normalizeRotation, worldBoxToView, type ViewRotation } from './isoMath';
import {
  buildBoxFaces,
  buildPrismFaces,
  buildPyramidFaces,
  buildRightTriPrismFaces,
  buildWedgeFaces,
  transformLocalToViewPoint,
  type MeshFace,
  type ParametricShape,
  type Vec3,
} from './isoRenderer';
import { buildAlignedLoftRings, getLoftLocalBounds, normalizeLoftSections } from './loft';

export const DEFAULT_GROUND_SHADOW_HEX = '#00071C5A';
export const DEFAULT_GROUND_SHADOW_COLOR: RGBA = { r: 0, g: 7, b: 28, a: 90 };
export const GROUND_SHADOW_LAYER_NAME = '地面阴影';
export const INTER_BLOCK_SHADOW_LAYER_NAME = '结构阴影';

export interface GroundShadowConfig {
  enabled: boolean;
  interBlockEnabled?: boolean;
  color: RGBA;
}

export function cloneGroundShadowConfig(cfg?: Partial<GroundShadowConfig>): GroundShadowConfig {
  const srcCol = cfg?.color ?? DEFAULT_GROUND_SHADOW_COLOR;
  return {
    enabled: cfg?.enabled ?? false,
    interBlockEnabled: Boolean(cfg?.interBlockEnabled),
    color: {
      r: clamp(Math.round(srcCol.r), 0, 255),
      g: clamp(Math.round(srcCol.g), 0, 255),
      b: clamp(Math.round(srcCol.b), 0, 255),
      a: clamp(Math.round(srcCol.a), 0, 255),
    },
  };
}

/**
 * Projects a 3D view-space point (vu, vv, zPx) onto the Z=0 ground plane
 * shifted +zPx directly to the right (1:1 shadow length rule).
 */
export function projectPointToGroundShadow(
  pt: Vec3,
  originX: number,
  originY: number,
): [number, number] {
  const [gx, gy] = isoToScreenPx(pt.x, pt.y, 0, originX, originY);
  return [gx + pt.z, gy];
}

/** Clips a 3D polygon against Z >= 0 so underground parts never cast ground shadows. */
export function clipPoly3DZMin0(verts: Vec3[]): Vec3[] {
  const n = verts.length;
  if (n < 3) return [];
  let allAbove = true;
  let allBelow = true;
  for (let i = 0; i < n; i++) {
    if (verts[i].z < -1e-6) allAbove = false;
    if (verts[i].z > 1e-6) allBelow = false;
  }
  if (allBelow) return [];
  if (allAbove) return verts;

  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const cur = verts[i];
    const nxt = verts[(i + 1) % n];
    const curIn = cur.z >= 0;
    const nxtIn = nxt.z >= 0;
    if (curIn) {
      out.push(cur);
      if (!nxtIn) {
        const dz = nxt.z - cur.z;
        const t = Math.abs(dz) > 1e-9 ? -cur.z / dz : 0;
        out.push({
          x: cur.x + (nxt.x - cur.x) * t,
          y: cur.y + (nxt.y - cur.y) * t,
          z: 0,
        });
      }
    } else if (nxtIn) {
      const dz = nxt.z - cur.z;
      const t = Math.abs(dz) > 1e-9 ? -cur.z / dz : 0;
      out.push({
        x: cur.x + (nxt.x - cur.x) * t,
        y: cur.y + (nxt.y - cur.y) * t,
        z: 0,
      });
    }
  }
  return out.length >= 3 ? out : [];
}

function isTopLeftEdge(x0: number, y0: number, x1: number, y1: number): boolean {
  const dy = y1 - y0;
  const dx = x1 - x0;
  return dy < 0 || (dy === 0 && dx > 0);
}

function fillConvexPolyMask(
  mask: Uint8Array,
  w: number,
  h: number,
  rawPts: [number, number][],
) {
  const n = rawPts.length;
  if (n < 3) return;
  let signedArea2 = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = rawPts[i];
    const [x1, y1] = rawPts[(i + 1) % n];
    signedArea2 += x0 * y1 - x1 * y0;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x0 > maxX) maxX = x0;
    if (y0 > maxY) maxY = y0;
  }
  if (Math.abs(signedArea2) < 1e-5) return;

  // Normalize winding to CCW-on-screen (signedArea2 < 0) so isTopLeftEdge matches renderConvexMesh
  const pts = signedArea2 > 0 ? [...rawPts].reverse() : rawPts;
  const sign = -1;

  const xStart = Math.max(0, Math.floor(minX));
  const yStart = Math.max(0, Math.floor(minY));
  const xEnd = Math.min(w - 1, Math.ceil(maxX));
  const yEnd = Math.min(h - 1, Math.ceil(maxY));
  if (xStart > xEnd || yStart > yEnd) return;

  for (let py = yStart; py <= yEnd; py++) {
    const cy = py + 0.5;
    const rowOff = py * w;
    for (let px = xStart; px <= xEnd; px++) {
      const cx = px + 0.5;
      let inside = true;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        const c = sign * ((x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0));
        if (c < -1e-6) {
          inside = false;
          break;
        }
        if (c <= 1e-6 && !isTopLeftEdge(x0, y0, x1, y1)) {
          inside = false;
          break;
        }
      }
      if (inside) {
        mask[rowOff + px] = 1;
      }
    }
  }
}

function rasterScanlinePolyMask(
  mask: Uint8Array,
  w: number,
  h: number,
  outerPoly: [number, number][],
  innerHolePoly: [number, number][] | null = null,
) {
  if (outerPoly.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, sy] of outerPoly) {
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(h - 1, Math.ceil(maxY));
  if (yStart > yEnd) return;

  // Ensure outerPoly and innerHolePoly have opposite orientation if hole provided
  const polyArea2 = (poly: [number, number][]) => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      a += ax * by - bx * ay;
    }
    return a;
  };
  const outerArea = polyArea2(outerPoly);
  if (Math.abs(outerArea) < 1e-5) return;
  const outerNorm = outerArea < 0 ? [...outerPoly].reverse() : outerPoly;

  let holeNorm: [number, number][] | null = null;
  if (innerHolePoly && innerHolePoly.length >= 3) {
    const holeArea = polyArea2(innerHolePoly);
    if (Math.abs(holeArea) >= 1e-5) {
      // Opposite winding from outerNorm (holeArea < 0)
      holeNorm = holeArea > 0 ? [...innerHolePoly].reverse() : innerHolePoly;
    }
  }

  const crossings: { x: number; dir: number }[] = [];
  for (let py = yStart; py <= yEnd; py++) {
    const scy = py + 0.5;
    crossings.length = 0;
    for (let j = 0; j < outerNorm.length; j++) {
      const [ax, ay] = outerNorm[j];
      const [bx, by] = outerNorm[(j + 1) % outerNorm.length];
      if (ay <= scy && by > scy) {
        crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
      } else if (by <= scy && ay > scy) {
        crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
      }
    }
    if (holeNorm) {
      for (let j = 0; j < holeNorm.length; j++) {
        const [ax, ay] = holeNorm[j];
        const [bx, by] = holeNorm[(j + 1) % holeNorm.length];
        if (ay <= scy && by > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
        } else if (by <= scy && ay > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
        }
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    const rowOff = py * w;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding += crossings[k].dir;
      if (winding === 0) continue;
      const xStart = Math.max(0, Math.ceil(crossings[k].x - 0.5));
      const xEnd = Math.min(w - 1, Math.floor(crossings[k + 1].x - 0.5));
      for (let px = xStart; px <= xEnd; px++) {
        mask[rowOff + px] = 1;
      }
    }
  }
}

function projectFaceListToMask(
  mask: Uint8Array,
  w: number,
  h: number,
  faces: MeshFace[],
  originX: number,
  originY: number,
) {
  for (const f of faces) {
    const clipped = clipPoly3DZMin0(f.verts);
    if (clipped.length < 3) continue;
    const pts = clipped.map((pt) => projectPointToGroundShadow(pt, originX, originY));
    fillConvexPolyMask(mask, w, h, pts);
  }
}

function rasterPoly3DToMask(
  mask: Uint8Array,
  w: number,
  h: number,
  verts: Vec3[],
  originX: number,
  originY: number,
) {
  const clipped = clipPoly3DZMin0(verts);
  if (clipped.length < 3) return;
  const pts = clipped.map((pt) => projectPointToGroundShadow(pt, originX, originY));
  fillConvexPolyMask(mask, w, h, pts);
}

function renderCylinderShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  originX: number,
  originY: number,
) {
  if (z1 <= 0) return;
  const zBot = Math.max(0, z0);
  const cu = u0 + su * 0.5;
  const cv = v0 + sv * 0.5;
  const ru = Math.max(1e-4, su * 0.5);
  const rv = Math.max(1e-4, sv * 0.5);
  const [cx0, cy0] = isoToScreenPx(cu, cv, 0, originX, originY);
  const ryGround = 8 * Math.hypot(ru, rv);
  const yStart = Math.max(0, Math.floor(cy0 - ryGround) - 1);
  const yEnd = Math.min(h - 1, Math.ceil(cy0 + ryGround) + 1);
  if (yStart > yEnd) return;

  const iu = 1 / (ru * ru);
  const iv = 1 / (rv * rv);
  const A = 0.25 * (iu + iv);

  for (let py = yStart; py <= yEnd; py++) {
    const dy = py + 0.5 - cy0;
    const s = dy / 8;
    const B = 0.5 * s * (iu - iv);
    const C = 0.25 * s * s * (iu + iv) - 1;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const dMin = (-B - sq) / (2 * A);
    const dMax = (-B + sq) / (2 * A);
    const xLeft = cx0 + 16 * dMin + zBot;
    const xRight = cx0 + 16 * dMax + z1;
    const xStart = Math.max(0, Math.ceil(xLeft - 0.5));
    const xEnd = Math.min(w - 1, Math.floor(xRight - 0.5));
    const rowOff = py * w;
    for (let px = xStart; px <= xEnd; px++) {
      mask[rowOff + px] = 1;
    }
  }
}

function renderConeShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  flipZ: boolean,
  originX: number,
  originY: number,
) {
  const zMin = Math.max(0, z0);
  const zMax = z1;
  const coneH = Math.max(1, z1 - z0);
  if (zMax <= 0 || zMin > zMax) return;
  const zApex = flipZ ? z0 : z1;

  const cu = u0 + su * 0.5;
  const cv = v0 + sv * 0.5;
  const ru = Math.max(1e-4, su * 0.5);
  const rv = Math.max(1e-4, sv * 0.5);
  const [cx0, cy0] = isoToScreenPx(cu, cv, 0, originX, originY);

  const rxGround = 16 * Math.hypot(ru, rv);
  const ryGround = 8 * Math.hypot(ru, rv);
  const xStart = Math.max(0, Math.floor(cx0 - rxGround + zMin) - 2);
  const xEnd = Math.min(w - 1, Math.ceil(cx0 + rxGround + zMax) + 2);
  const yStart = Math.max(0, Math.floor(cy0 - ryGround) - 2);
  const yEnd = Math.min(h - 1, Math.ceil(cy0 + ryGround) + 2);
  if (xStart > xEnd || yStart > yEnd) return;

  const iu = 1 / (ru * ru);
  const iv = 1 / (rv * rv);
  const iH = 1 / (coneH * coneH);
  const Az = (iu + iv) / 1024 - iH;

  for (let py = yStart; py <= yEnd; py++) {
    const dy = py + 0.5 - cy0;
    const halfS = 0.5 * (dy / 8);
    const rowOff = py * w;
    for (let px = xStart; px <= xEnd; px++) {
      const dx = px + 0.5 - cx0;
      const dx32 = dx / 32;
      const u0p = halfS + dx32;
      const v0p = halfS - dx32;
      const Bz = (-u0p * iu + v0p * iv) / 16 + 2 * zApex * iH;
      const Cz = u0p * u0p * iu + v0p * v0p * iv - zApex * zApex * iH;
      const fMin = (Az * zMin + Bz) * zMin + Cz;
      const fMax = (Az * zMax + Bz) * zMax + Cz;
      let hit = fMin <= 1e-6 || fMax <= 1e-6;
      if (!hit && Az > 1e-9) {
        const zVert = -Bz / (2 * Az);
        if (zVert > zMin && zVert < zMax) {
          const fVert = (Az * zVert + Bz) * zVert + Cz;
          if (fVert <= 1e-6) hit = true;
        }
      }
      if (hit) {
        mask[rowOff + px] = 1;
      }
    }
  }
}

function renderDomeShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  isSphere: boolean,
  flipZ: boolean,
  originX: number,
  originY: number,
) {
  const zMin = Math.max(0, z0);
  const zMax = z1;
  if (zMax <= 0 || zMin > zMax) return;

  const cu = u0 + su * 0.5;
  const cv = v0 + sv * 0.5;
  const ru = Math.max(1e-4, su * 0.5);
  const rv = Math.max(1e-4, sv * 0.5);
  const totalH = Math.max(1, z1 - z0);
  const zCenter = isSphere ? z0 + totalH * 0.5 : flipZ ? z1 : z0;
  const rz = Math.max(0.5, isSphere ? totalH * 0.5 : totalH);
  const [cx0, cy0] = isoToScreenPx(cu, cv, 0, originX, originY);

  const rxGround = 16 * Math.hypot(ru, rv);
  const ryGround = 8 * Math.hypot(ru, rv);
  const xStart = Math.max(0, Math.floor(cx0 - rxGround + zMin) - 2);
  const xEnd = Math.min(w - 1, Math.ceil(cx0 + rxGround + zMax) + 2);
  const yStart = Math.max(0, Math.floor(cy0 - ryGround) - 2);
  const yEnd = Math.min(h - 1, Math.ceil(cy0 + ryGround) + 2);
  if (xStart > xEnd || yStart > yEnd) return;

  const iu = 1 / (ru * ru);
  const iv = 1 / (rv * rv);
  const iz = 1 / (rz * rz);
  const Az = (iu + iv) / 1024 + iz;

  for (let py = yStart; py <= yEnd; py++) {
    const dy = py + 0.5 - cy0;
    const halfS = 0.5 * (dy / 8);
    const rowOff = py * w;
    for (let px = xStart; px <= xEnd; px++) {
      const dx = px + 0.5 - cx0;
      const dx32 = dx / 32;
      const u0p = halfS + dx32;
      const v0p = halfS - dx32;
      const Bz = (-u0p * iu + v0p * iv) / 16 - 2 * zCenter * iz;
      const Cz = u0p * u0p * iu + v0p * v0p * iv + zCenter * zCenter * iz - 1;
      const disc = Bz * Bz - 4 * Az * Cz;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const zLo = (-Bz - sq) / (2 * Az);
      const zHi = (-Bz + sq) / (2 * Az);
      if (Math.max(zLo, zMin) <= Math.min(zHi, zMax)) {
        mask[rowOff + px] = 1;
      }
    }
  }
}

function renderArchShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
) {
  const heightPx = z1 - z0;
  if (heightPx <= 0 || z1 <= 0) return;

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

  const flipZ = Boolean(shape.flipZ);
  for (const e of cs.edges) {
    const zA = z0 + (flipZ ? 1 - e.h0 : e.h0) * heightPx;
    const zB = z0 + (flipZ ? 1 - e.h1 : e.h1) * heightPx;
    const A0 = transformLocalToViewPoint(e.s0, 0, zA, u0, v0, su, sv, viewOri);
    const B0 = transformLocalToViewPoint(e.s1, 0, zB, u0, v0, su, sv, viewOri);
    const B1 = transformLocalToViewPoint(e.s1, 1, zB, u0, v0, su, sv, viewOri);
    const A1 = transformLocalToViewPoint(e.s0, 1, zA, u0, v0, su, sv, viewOri);
    rasterPoly3DToMask(mask, w, h, [A0, B0, B1], originX, originY);
    rasterPoly3DToMask(mask, w, h, [A0, B1, A1], originX, originY);
  }

  for (const lvCap of [0, 1]) {
    const poly3 = cs.poly.map(([s, hFrac]) =>
      transformLocalToViewPoint(s, lvCap, z0 + (flipZ ? 1 - hFrac : hFrac) * heightPx, u0, v0, su, sv, viewOri),
    );
    const clipped = clipPoly3DZMin0(poly3);
    if (clipped.length >= 3) {
      rasterScanlinePolyMask(
        mask,
        w,
        h,
        clipped.map((pt) => projectPointToGroundShadow(pt, originX, originY)),
      );
    }
  }
}

function renderLoftOrColumnShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  u0: number,
  v0: number,
  su: number,
  sv: number,
  z0: number,
  z1: number,
  shape: ParametricShape,
  originX: number,
  originY: number,
  viewOri: ViewRotation,
  isLoft: boolean,
) {
  if (z1 <= 0) return;

  const flipZ = Boolean(shape.flipZ);
  let rings: { t: number; pts: [number, number][] }[];
  let innerRings: { t: number; pts: [number, number][] }[] | null = null;
  let innerFloorRing: { t: number; pts: [number, number][] } | null = null;
  let flippedSolidTop = false;

  if (isLoft) {
    const secs = normalizeLoftSections(shape.loftSections);
    const sampleCount = clamp(Math.round((su + sv) * 36), 80, 256);
    const ringBudget = clamp(Math.ceil((z1 - z0) * 1.0), 24, 320);
    const oddOri = viewOri % 2 === 1;
    const lsu = oddOri ? sv : su;
    const lsv = oddOri ? su : sv;
    const res = buildAlignedLoftRings(
      secs,
      sampleCount,
      ringBudget,
      shape.loftInterp ?? 'smooth',
      Boolean(shape.loftHollow),
      lsu,
      lsv,
      shape.loftFloorT ?? 0,
    );
    rings = flipZ
      ? [...res.rings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
      : res.rings;
    innerRings = res.innerRings
      ? flipZ
        ? [...res.innerRings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
        : res.innerRings
      : null;
    flippedSolidTop = flipZ && Boolean(res.innerFloorRing);
    innerFloorRing = flipZ
      ? res.innerFloorRing
        ? { t: 1 - res.innerFloorRing.t, pts: res.innerFloorRing.pts }
        : null
      : res.innerFloorRing ?? null;
  } else {
    const cylSamples = clamp(Math.round((su + sv) * 32), 48, 160);
    const zSteps = clamp(Math.ceil((z1 - z0) * 0.85), 20, 288);
    const rawRings = buildColumnRings(shape, zSteps, cylSamples);
    rings = flipZ
      ? [...rawRings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
      : rawRings;
  }

  if (rings.length < 2) return;
  const vertCount = rings[0].pts.length;
  if (vertCount < 3) return;

  const toViewRing = (r: { t: number; pts: [number, number][] }): Vec3[] => {
    const zRing = z0 + r.t * (z1 - z0);
    return r.pts.map(([lu, lv]) => transformLocalToViewPoint(lu, lv, zRing, u0, v0, su, sv, viewOri));
  };

  const outerViewRings = rings.map(toViewRing);
  for (let r = 0; r < outerViewRings.length - 1; r++) {
    const bot = outerViewRings[r];
    const top = outerViewRings[r + 1];
    for (let j = 0; j < vertCount; j++) {
      const jn = (j + 1) % vertCount;
      rasterPoly3DToMask(mask, w, h, [bot[j], bot[jn], top[jn]], originX, originY);
      rasterPoly3DToMask(mask, w, h, [bot[j], top[jn], top[j]], originX, originY);
    }
  }

  let inViewRings: Vec3[][] | null = null;
  if (innerRings && innerRings.length >= 2) {
    inViewRings = innerRings.map(toViewRing);
    const inCount = inViewRings[0].length;
    for (let r = 0; r < inViewRings.length - 1; r++) {
      const bot = inViewRings[r];
      const top = inViewRings[r + 1];
      for (let j = 0; j < inCount; j++) {
        const jn = (j + 1) % inCount;
        rasterPoly3DToMask(mask, w, h, [bot[jn], bot[j], top[j]], originX, originY);
        rasterPoly3DToMask(mask, w, h, [bot[jn], top[j], top[jn]], originX, originY);
      }
    }
  }

  const projectRingShadow = (ring: Vec3[]) =>
    ring.map((pt) => projectPointToGroundShadow(pt, originX, originY));

  const topZ = z0 + rings[rings.length - 1].t * (z1 - z0);
  if (topZ >= 0) {
    const outerTop = projectRingShadow(outerViewRings[outerViewRings.length - 1]);
    const innerTop = inViewRings && !flippedSolidTop ? projectRingShadow(inViewRings[inViewRings.length - 1]) : null;
    rasterScanlinePolyMask(mask, w, h, outerTop, innerTop);
  }

  const botZ = z0 + rings[0].t * (z1 - z0);
  if (botZ >= 0) {
    const outerBot = projectRingShadow(outerViewRings[0]);
    const innerBot = inViewRings ? projectRingShadow(inViewRings[0]) : null;
    rasterScanlinePolyMask(mask, w, h, outerBot, innerBot);
  }

  if (innerFloorRing && inViewRings && inViewRings.length >= 2) {
    const zFloor = z0 + innerFloorRing.t * (z1 - z0);
    if (zFloor >= 0) {
      const floorView = toViewRing(innerFloorRing);
      rasterScanlinePolyMask(mask, w, h, projectRingShadow(floorView), null);
    }
  }
}

export function renderShapeGroundShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  shape: ParametricShape,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
  originX: number,
  originY: number,
) {
  if (shape.shapeType === 'theotown_base') return;
  const heightPx = Math.max(0, Math.round(shape.heightPx));
  const z0 = Math.round(shape.zPx);
  const z1 = z0 + heightPx;
  if (heightPx <= 0 || z1 <= 0) return;

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
  const ori = vb.ori;

  const P = (lu: number, lv: number, z: number) =>
    transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);
  const flipZ = Boolean(shape.flipZ);

  switch (shape.shapeType) {
    case 'box': {
      if (hasActiveColumnSections(shape)) {
        renderLoftOrColumnShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, shape, originX, originY, ori, false);
        break;
      }
      const faces = buildBoxFaces(u0, v0, su, sv, z0, z1, ori, flipZ);
      if (z0 >= 0) {
        faces.push({
          verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)],
          kind: 'top',
        });
      }
      projectFaceListToMask(mask, w, h, faces, originX, originY);
      break;
    }
    case 'right_tri_prism': {
      if (hasActiveColumnSections(shape)) {
        renderLoftOrColumnShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, shape, originX, originY, ori, false);
        break;
      }
      const cut = shape.triPrismCut ?? 'vertical';
      const faces = buildRightTriPrismFaces(u0, v0, su, sv, z0, z1, ori, cut, flipZ);
      if (z0 >= 0) {
        if (cut === 'slope') {
          if (!flipZ) {
            faces.push({
              verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)],
              kind: 'top',
            });
          }
        } else {
          faces.push({
            verts: [P(0, 0, z0), P(1, 0, z0), P(0, 1, z0)],
            kind: 'top',
          });
        }
      }
      projectFaceListToMask(mask, w, h, faces, originX, originY);
      break;
    }
    case 'prism': {
      if (hasActiveColumnSections(shape)) {
        renderLoftOrColumnShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, shape, originX, originY, ori, false);
        break;
      }
      const faces = buildPrismFaces(u0, v0, su, sv, z0, z1, shape.prismSides, ori, flipZ);
      if (z0 >= 0) {
        const n = Math.max(3, Math.min(12, Math.round(shape.prismSides)));
        const startAngle = Math.PI / n;
        const bot: Vec3[] = [];
        for (let i = 0; i < n; i++) {
          const ang = startAngle - (i * Math.PI * 2) / n;
          bot.push(P(0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5, z0));
        }
        faces.push({ verts: bot.reverse(), kind: 'top' });
      }
      projectFaceListToMask(mask, w, h, faces, originX, originY);
      break;
    }
    case 'wedge': {
      const faces = buildWedgeFaces(u0, v0, su, sv, z0, z1, ori, shape.wedgeMode, flipZ);
      if (z0 >= 0 && !flipZ) {
        faces.push({
          verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)],
          kind: 'top',
        });
      }
      projectFaceListToMask(mask, w, h, faces, originX, originY);
      break;
    }
    case 'pyramid': {
      const faces = buildPyramidFaces(u0, v0, su, sv, z0, z1, ori, flipZ);
      if (z0 >= 0 && !flipZ) {
        faces.push({
          verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)],
          kind: 'top',
        });
      }
      projectFaceListToMask(mask, w, h, faces, originX, originY);
      break;
    }
    case 'cylinder': {
      if (hasActiveColumnSections(shape)) {
        renderLoftOrColumnShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, shape, originX, originY, ori, false);
        break;
      }
      renderCylinderShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, originX, originY);
      break;
    }
    case 'cone': {
      renderConeShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, flipZ, originX, originY);
      break;
    }
    case 'dome':
    case 'sphere': {
      renderDomeShadowMask(
        mask,
        w,
        h,
        u0,
        v0,
        su,
        sv,
        z0,
        z1,
        shape.shapeType === 'sphere' || shape.domeMode === 'sphere',
        flipZ,
        originX,
        originY,
      );
      break;
    }
    case 'arch': {
      renderArchShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, shape, originX, originY, ori);
      break;
    }
    case 'loft': {
      renderLoftOrColumnShadowMask(mask, w, h, u0, v0, su, sv, z0, z1, shape, originX, originY, ori, true);
      break;
    }
  }
}

export function colorizeGroundShadowMask(
  mask: Uint8Array,
  dst: Uint8ClampedArray,
  color: RGBA,
  w = 0,
): { hasPixels: boolean; bounds: { x0: number; y0: number; x1: number; y1: number } | null } {
  const a = clamp(Math.round(color.a), 0, 255);
  if (a <= 0) {
    dst.fill(0);
    return { hasPixels: false, bounds: null };
  }
  const r = clamp(Math.round(color.r), 0, 255);
  const g = clamp(Math.round(color.g), 0, 255);
  const b = clamp(Math.round(color.b), 0, 255);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  let hasPixels = false;

  for (let i = 0; i < mask.length; i++) {
    const di = i * 4;
    if (mask[i]) {
      dst[di] = r;
      dst[di + 1] = g;
      dst[di + 2] = b;
      dst[di + 3] = a;
      hasPixels = true;
      if (w > 0) {
        const y = Math.floor(i / w);
        const x = i - y * w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    } else {
      dst[di] = 0;
      dst[di + 1] = 0;
      dst[di + 2] = 0;
      dst[di + 3] = 0;
    }
  }

  return {
    hasPixels,
    bounds: hasPixels && w > 0 ? { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 } : null,
  };
}

// ---------------- Experimental 3D Inter-Block Sun-Ray Shadow Field ----------------

export interface ShapeSunShadowField {
  minSx: number;
  minSy: number;
  sw: number;
  sh: number;
  shapeMinZ: number;
  shapeMaxZ: number;
  canSelfShadow: boolean;
  zLo: Float32Array;
  zHi: Float32Array;
}

export interface InterBlockShadowEntry {
  layerId: number;
  rgba: Uint8ClampedArray;
  zData: Float32Array;
  sunFacing: Uint8Array;
  field: ShapeSunShadowField | null;
}

export function buildShapeSunShadowField(
  shape: ParametricShape,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
  originX: number,
  originY: number,
): ShapeSunShadowField | null {
  if (shape.shapeType === 'theotown_base') return null;
  const heightPx = Math.max(0, Math.round(shape.heightPx));
  if (heightPx <= 0) return null;
  const z0 = Math.round(shape.zPx);
  const z1 = z0 + heightPx;

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
  const ori = vb.ori;

  let lu0 = 0, lu1 = 1, lv0 = 0, lv1 = 1;
  if (shape.shapeType === 'loft') {
    const lb = getLoftLocalBounds(shape.loftSections, shape.loftInterp ?? 'smooth');
    lu0 = Math.min(0, lb.minU) - 0.08;
    lu1 = Math.max(1, lb.maxU) + 0.08;
    lv0 = Math.min(0, lb.minV) - 0.08;
    lv1 = Math.max(1, lb.maxV) + 0.08;
  } else if (hasActiveColumnSections(shape)) {
    const lb = getColumnLocalBounds(shape);
    lu0 = Math.min(0, lb.minU) - 0.08;
    lu1 = Math.max(1, lb.maxU) + 0.08;
    lv0 = Math.min(0, lb.minV) - 0.08;
    lv1 = Math.max(1, lb.maxV) + 0.08;
  }

  let rawMinSx = Infinity;
  let rawMinSy = Infinity;
  let rawMaxSx = -Infinity;
  let rawMaxSy = -Infinity;
  const expandSunPt = (sx: number, sy: number) => {
    if (sx < rawMinSx) rawMinSx = sx;
    if (sy < rawMinSy) rawMinSy = sy;
    if (sx > rawMaxSx) rawMaxSx = sx;
    if (sy > rawMaxSy) rawMaxSy = sy;
  };
  const P = (lu: number, lv: number, z: number) =>
    transformLocalToViewPoint(lu, lv, z, u0, v0, su, sv, ori);

  for (const zc of [z0, z1]) {
    for (const [lu, lv] of [
      [lu0, lv0],
      [lu1, lv0],
      [lu1, lv1],
      [lu0, lv1],
    ]) {
      const pt = P(lu, lv, zc);
      const [sx, sy] = projectPointToGroundShadow(pt, originX, originY);
      expandSunPt(sx, sy);
    }
  }
  if (
    shape.shapeType === 'cylinder' ||
    shape.shapeType === 'cone' ||
    shape.shapeType === 'dome' ||
    shape.shapeType === 'sphere'
  ) {
    const ru = su * 0.5;
    const rv = sv * 0.5;
    const [cx0, cy0] = isoToScreenPx(u0 + ru, v0 + rv, 0, originX, originY);
    const rx = 16 * Math.hypot(ru, rv) + 2;
    const ry = 8 * Math.hypot(ru, rv) + 2;
    expandSunPt(cx0 - rx + Math.min(z0, z1), cy0 - ry);
    expandSunPt(cx0 + rx + Math.max(z0, z1), cy0 + ry);
  }

  const minSx = Math.floor(rawMinSx) - 3;
  const minSy = Math.floor(rawMinSy) - 3;
  const maxSx = Math.ceil(rawMaxSx) + 3;
  const maxSy = Math.ceil(rawMaxSy) + 3;
  const sw = maxSx - minSx + 1;
  const sh = maxSy - minSy + 1;
  if (sw <= 0 || sh <= 0 || sw > 4096 || sh > 4096) return null;

  const zLo = new Float32Array(sw * sh);
  zLo.fill(Infinity);
  const zHi = new Float32Array(sw * sh);
  zHi.fill(-Infinity);

  const recordZ = (lx: number, ly: number, lo: number, hi: number) => {
    const idx = ly * sw + lx;
    if (lo < zLo[idx]) zLo[idx] = lo;
    if (hi > zHi[idx]) zHi[idx] = hi;
  };

  const rasterTri3DSunField = (A: Vec3, B: Vec3, C: Vec3) => {
    const [ax0, ay0] = projectPointToGroundShadow(A, originX, originY);
    const [bx0, by0] = projectPointToGroundShadow(B, originX, originY);
    const [cx0, cy0] = projectPointToGroundShadow(C, originX, originY);
    let ax = ax0 - minSx, ay = ay0 - minSy;
    let bx = bx0 - minSx, by = by0 - minSy;
    let cx = cx0 - minSx, cy = cy0 - minSy;
    let zA = A.z, zB = B.z, zC = C.z;

    let area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area2) < 1e-4) return;
    if (area2 > 0) {
      // Ensure CCW-on-screen (area2 < 0)
      [bx, cx] = [cx, bx];
      [by, cy] = [cy, by];
      [zB, zC] = [zC, zB];
      area2 = -area2;
    }

    const triMinX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const triMaxX = Math.min(sw - 1, Math.ceil(Math.max(ax, bx, cx)));
    const triMinY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const triMaxY = Math.min(sh - 1, Math.ceil(Math.max(ay, by, cy)));
    if (triMinX > triMaxX || triMinY > triMaxY) return;

    const invArea = 1 / area2;
    const tlBC = isTopLeftEdge(bx, by, cx, cy);
    const tlCA = isTopLeftEdge(cx, cy, ax, ay);
    const tlAB = isTopLeftEdge(ax, ay, bx, by);

    for (let ly = triMinY; ly <= triMaxY; ly++) {
      const scy = ly + 0.5;
      for (let lx = triMinX; lx <= triMaxX; lx++) {
        const scx = lx + 0.5;
        const w0 = ((cx - bx) * (scy - by) - (cy - by) * (scx - bx)) * invArea;
        if (w0 < -1e-6 || (w0 <= 1e-6 && !tlBC)) continue;
        const w1 = ((ax - cx) * (scy - cy) - (ay - cy) * (scx - cx)) * invArea;
        if (w1 < -1e-6 || (w1 <= 1e-6 && !tlCA)) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -1e-6 || (w2 <= 1e-6 && !tlAB)) continue;
        const z = clamp(w0 * zA + w1 * zB + w2 * zC, z0, z1);
        recordZ(lx, ly, z, z);
      }
    }
  };

  const rasterPolyFacesSunField = (faces: MeshFace[]) => {
    for (const f of faces) {
      if (f.verts.length < 3) continue;
      for (let i = 1; i + 1 < f.verts.length; i++) {
        rasterTri3DSunField(f.verts[0], f.verts[i], f.verts[i + 1]);
      }
    }
  };

  const rasterScanlinePolyZ = (
    outerPoly: [number, number][],
    innerHolePoly: [number, number][] | null,
    zAtLocalSunPx: (lx: number, ly: number) => number,
  ) => {
    if (outerPoly.length < 3) return;
    const polyArea2 = (poly: [number, number][]) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        a += ax * by - bx * ay;
      }
      return a;
    };
    const outerArea = polyArea2(outerPoly);
    if (Math.abs(outerArea) < 1e-5) return;
    const outerNorm = outerArea < 0 ? [...outerPoly].reverse() : outerPoly;
    let holeNorm: [number, number][] | null = null;
    if (innerHolePoly && innerHolePoly.length >= 3) {
      const hArea = polyArea2(innerHolePoly);
      if (Math.abs(hArea) >= 1e-5) {
        holeNorm = hArea > 0 ? [...innerHolePoly].reverse() : innerHolePoly;
      }
    }

    let polyMinY = Infinity;
    let polyMaxY = -Infinity;
    for (const [, sy] of outerNorm) {
      if (sy < polyMinY) polyMinY = sy;
      if (sy > polyMaxY) polyMaxY = sy;
    }
    const lyStart = Math.max(0, Math.floor(polyMinY - minSy));
    const lyEnd = Math.min(sh - 1, Math.ceil(polyMaxY - minSy));
    const crossings: { x: number; dir: number }[] = [];

    for (let ly = lyStart; ly <= lyEnd; ly++) {
      const scy = minSy + ly + 0.5;
      crossings.length = 0;
      for (let j = 0; j < outerNorm.length; j++) {
        const [ax, ay] = outerNorm[j];
        const [bx, by] = outerNorm[(j + 1) % outerNorm.length];
        if (ay <= scy && by > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
        } else if (by <= scy && ay > scy) {
          crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
        }
      }
      if (holeNorm) {
        for (let j = 0; j < holeNorm.length; j++) {
          const [ax, ay] = holeNorm[j];
          const [bx, by] = holeNorm[(j + 1) % holeNorm.length];
          if (ay <= scy && by > scy) {
            crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: 1 });
          } else if (by <= scy && ay > scy) {
            crossings.push({ x: ax + ((scy - ay) / (by - ay)) * (bx - ax), dir: -1 });
          }
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k].dir;
        if (winding === 0) continue;
        const lxStart = Math.max(0, Math.ceil(crossings[k].x - minSx - 0.5));
        const lxEnd = Math.min(sw - 1, Math.floor(crossings[k + 1].x - minSx - 0.5));
        for (let lx = lxStart; lx <= lxEnd; lx++) {
          const z = clamp(zAtLocalSunPx(lx, ly), z0, z1);
          recordZ(lx, ly, z, z);
        }
      }
    }
  };

  const flipZ = Boolean(shape.flipZ);
  const rasterLoftOrColumnField = (isLoft: boolean) => {
    let rings: { t: number; pts: [number, number][] }[];
    let innerRings: { t: number; pts: [number, number][] }[] | null = null;
    let innerFloorRing: { t: number; pts: [number, number][] } | null = null;
    let flippedSolidTop = false;
    if (isLoft) {
      const secs = normalizeLoftSections(shape.loftSections);
      const sampleCount = clamp(Math.round((su + sv) * 36), 80, 256);
      const ringBudget = clamp(Math.ceil((z1 - z0) * 1.0), 24, 320);
      const oddOri = ori % 2 === 1;
      const res = buildAlignedLoftRings(
        secs,
        sampleCount,
        ringBudget,
        shape.loftInterp ?? 'smooth',
        Boolean(shape.loftHollow),
        oddOri ? sv : su,
        oddOri ? su : sv,
        shape.loftFloorT ?? 0,
      );
      rings = flipZ
        ? [...res.rings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
        : res.rings;
      innerRings = res.innerRings
        ? flipZ
          ? [...res.innerRings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
          : res.innerRings
        : null;
      flippedSolidTop = flipZ && Boolean(res.innerFloorRing);
      innerFloorRing = flipZ
        ? res.innerFloorRing
          ? { t: 1 - res.innerFloorRing.t, pts: res.innerFloorRing.pts }
          : null
        : res.innerFloorRing ?? null;
    } else {
      const cylSamples = clamp(Math.round((su + sv) * 32), 48, 160);
      const zSteps = clamp(Math.ceil((z1 - z0) * 0.85), 20, 288);
      const rawRings = buildColumnRings(shape, zSteps, cylSamples);
      rings = flipZ
        ? [...rawRings].reverse().map((r) => ({ t: 1 - r.t, pts: r.pts }))
        : rawRings;
    }
    if (rings.length < 2 || rings[0].pts.length < 3) return;
    const vertCount = rings[0].pts.length;
    const toViewRing = (r: { t: number; pts: [number, number][] }): Vec3[] => {
      const zRing = z0 + r.t * (z1 - z0);
      return r.pts.map(([lu, lv]) => P(lu, lv, zRing));
    };
    const outerV = rings.map(toViewRing);
    for (let r = 0; r < outerV.length - 1; r++) {
      const bot = outerV[r];
      const top = outerV[r + 1];
      for (let j = 0; j < vertCount; j++) {
        const jn = (j + 1) % vertCount;
        rasterTri3DSunField(bot[j], bot[jn], top[jn]);
        rasterTri3DSunField(bot[j], top[jn], top[j]);
      }
    }
    let inV: Vec3[][] | null = null;
    if (innerRings && innerRings.length >= 2) {
      inV = innerRings.map(toViewRing);
      const inCount = inV[0].length;
      for (let r = 0; r < inV.length - 1; r++) {
        const bot = inV[r];
        const top = inV[r + 1];
        for (let j = 0; j < inCount; j++) {
          const jn = (j + 1) % inCount;
          rasterTri3DSunField(bot[jn], bot[j], top[j]);
          rasterTri3DSunField(bot[jn], top[j], top[jn]);
        }
      }
    }
    const proj = (ring: Vec3[]) => ring.map((pt) => projectPointToGroundShadow(pt, originX, originY));
    const topZ = z0 + rings[rings.length - 1].t * (z1 - z0);
    rasterScanlinePolyZ(
      proj(outerV[outerV.length - 1]),
      inV && !flippedSolidTop ? proj(inV[inV.length - 1]) : null,
      () => topZ,
    );
    const botZ = z0 + rings[0].t * (z1 - z0);
    rasterScanlinePolyZ(
      proj(outerV[0]),
      inV ? proj(inV[0]) : null,
      () => botZ,
    );
    if (innerFloorRing && inV && inV.length >= 2) {
      const zFloor = z0 + innerFloorRing.t * (z1 - z0);
      rasterScanlinePolyZ(proj(toViewRing(innerFloorRing)), null, () => zFloor);
    }
  };

  switch (shape.shapeType) {
    case 'box': {
      if (hasActiveColumnSections(shape)) {
        rasterLoftOrColumnField(false);
        break;
      }
      const faces = buildBoxFaces(u0, v0, su, sv, z0, z1, ori, flipZ);
      faces.push({ verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)], kind: 'top' });
      rasterPolyFacesSunField(faces);
      break;
    }
    case 'right_tri_prism': {
      if (hasActiveColumnSections(shape)) {
        rasterLoftOrColumnField(false);
        break;
      }
      const cut = shape.triPrismCut ?? 'vertical';
      const faces = buildRightTriPrismFaces(u0, v0, su, sv, z0, z1, ori, cut, flipZ);
      if (cut !== 'slope' || !flipZ) {
        faces.push({
          verts: cut === 'slope'
            ? [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)]
            : [P(0, 0, z0), P(1, 0, z0), P(0, 1, z0)],
          kind: 'top',
        });
      }
      rasterPolyFacesSunField(faces);
      break;
    }
    case 'prism': {
      if (hasActiveColumnSections(shape)) {
        rasterLoftOrColumnField(false);
        break;
      }
      const faces = buildPrismFaces(u0, v0, su, sv, z0, z1, shape.prismSides, ori, flipZ);
      const n = Math.max(3, Math.min(12, Math.round(shape.prismSides)));
      const startAngle = Math.PI / n;
      const bot: Vec3[] = [];
      for (let i = 0; i < n; i++) {
        const ang = startAngle - (i * Math.PI * 2) / n;
        bot.push(P(0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5, z0));
      }
      faces.push({ verts: bot.reverse(), kind: 'top' });
      rasterPolyFacesSunField(faces);
      break;
    }
    case 'wedge': {
      const faces = buildWedgeFaces(u0, v0, su, sv, z0, z1, ori, shape.wedgeMode, flipZ);
      if (!flipZ) {
        faces.push({ verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)], kind: 'top' });
      }
      rasterPolyFacesSunField(faces);
      break;
    }
    case 'pyramid': {
      const faces = buildPyramidFaces(u0, v0, su, sv, z0, z1, ori, flipZ);
      if (!flipZ) {
        faces.push({ verts: [P(0, 0, z0), P(1, 0, z0), P(1, 1, z0), P(0, 1, z0)], kind: 'top' });
      }
      rasterPolyFacesSunField(faces);
      break;
    }
    case 'cylinder': {
      if (hasActiveColumnSections(shape)) {
        rasterLoftOrColumnField(false);
        break;
      }
      const cu = u0 + su * 0.5;
      const cv = v0 + sv * 0.5;
      const ru = Math.max(1e-4, su * 0.5);
      const rv = Math.max(1e-4, sv * 0.5);
      const [cx0, cy0] = isoToScreenPx(cu, cv, 0, originX, originY);
      const ryGround = 8 * Math.hypot(ru, rv);
      const lyStart = Math.max(0, Math.floor(cy0 - ryGround - minSy) - 1);
      const lyEnd = Math.min(sh - 1, Math.ceil(cy0 + ryGround - minSy) + 1);
      const iu = 1 / (ru * ru);
      const iv = 1 / (rv * rv);
      const A = 0.25 * (iu + iv);
      for (let ly = lyStart; ly <= lyEnd; ly++) {
        const dy = minSy + ly + 0.5 - cy0;
        const s = dy / 8;
        const B = 0.5 * s * (iu - iv);
        const C = 0.25 * s * s * (iu + iv) - 1;
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const dMin = (-B - sq) / (2 * A);
        const dMax = (-B + sq) / (2 * A);
        const xLeft = cx0 + 16 * dMin + z0;
        const xRight = cx0 + 16 * dMax + z1;
        const lxStart = Math.max(0, Math.ceil(xLeft - minSx - 0.5));
        const lxEnd = Math.min(sw - 1, Math.floor(xRight - minSx - 0.5));
        for (let lx = lxStart; lx <= lxEnd; lx++) {
          const sx = minSx + lx + 0.5;
          const lo = clamp(sx - cx0 - 16 * dMax, z0, z1);
          const hi = clamp(sx - cx0 - 16 * dMin, z0, z1);
          if (lo <= hi + 1e-4) {
            recordZ(lx, ly, Math.min(lo, hi), Math.max(lo, hi));
          }
        }
      }
      break;
    }
    case 'cone': {
      const coneH = Math.max(1, z1 - z0);
      const zApex = flipZ ? z0 : z1;
      const cu = u0 + su * 0.5;
      const cv = v0 + sv * 0.5;
      const ru = Math.max(1e-4, su * 0.5);
      const rv = Math.max(1e-4, sv * 0.5);
      const [cx0, cy0] = isoToScreenPx(cu, cv, 0, originX, originY);
      const iu = 1 / (ru * ru);
      const iv = 1 / (rv * rv);
      const iH = 1 / (coneH * coneH);
      const Az = (iu + iv) / 1024 - iH;
      for (let ly = 0; ly < sh; ly++) {
        const dy = minSy + ly + 0.5 - cy0;
        const halfS = 0.5 * (dy / 8);
        for (let lx = 0; lx < sw; lx++) {
          const dx = minSx + lx + 0.5 - cx0;
          const dx32 = dx / 32;
          const u0p = halfS + dx32;
          const v0p = halfS - dx32;
          const Bz = (-u0p * iu + v0p * iv) / 16 + 2 * zApex * iH;
          const Cz = u0p * u0p * iu + v0p * v0p * iv - zApex * zApex * iH;
          if (Math.abs(Az) < 1e-9) {
            if (Math.abs(Bz) <= 1e-9) {
              if (Cz <= 1e-6) recordZ(lx, ly, z0, z1);
            } else {
              const r0 = -Cz / Bz;
              const lo = Bz > 0 ? z0 : Math.max(z0, r0);
              const hi = Bz > 0 ? Math.min(z1, r0) : z1;
              if (lo <= hi + 1e-4) recordZ(lx, ly, clamp(lo, z0, z1), clamp(hi, z0, z1));
            }
            continue;
          }
          const disc = Bz * Bz - 4 * Az * Cz;
          if (Az > 0) {
            if (disc < 0) continue;
            const sq = Math.sqrt(disc);
            const r1 = (-Bz - sq) / (2 * Az);
            const r2 = (-Bz + sq) / (2 * Az);
            const lo = Math.max(z0, r1);
            const hi = Math.min(z1, r2);
            if (lo <= hi + 1e-4) recordZ(lx, ly, clamp(lo, z0, z1), clamp(hi, z0, z1));
          } else {
            if (disc < 0) {
              recordZ(lx, ly, z0, z1);
            } else {
              const sq = Math.sqrt(disc);
              const rMin = (-Bz + sq) / (2 * Az);
              const rMax = (-Bz - sq) / (2 * Az);
              const fBot = (Az * z0 + Bz) * z0 + Cz <= 1e-6;
              const fTop = (Az * z1 + Bz) * z1 + Cz <= 1e-6;
              if (fBot && fTop) {
                recordZ(lx, ly, z0, z1);
              } else if (fBot) {
                recordZ(lx, ly, z0, clamp(rMin, z0, z1));
              } else if (fTop) {
                recordZ(lx, ly, clamp(rMax, z0, z1), z1);
              }
            }
          }
        }
      }
      break;
    }
    case 'dome':
    case 'sphere': {
      const isSphere = shape.shapeType === 'sphere' || shape.domeMode === 'sphere';
      const totalH = Math.max(1, z1 - z0);
      const zCenter = isSphere ? z0 + totalH * 0.5 : flipZ ? z1 : z0;
      const rz = Math.max(0.5, isSphere ? totalH * 0.5 : totalH);
      const cu = u0 + su * 0.5;
      const cv = v0 + sv * 0.5;
      const ru = Math.max(1e-4, su * 0.5);
      const rv = Math.max(1e-4, sv * 0.5);
      const [cx0, cy0] = isoToScreenPx(cu, cv, 0, originX, originY);
      const iu = 1 / (ru * ru);
      const iv = 1 / (rv * rv);
      const iz = 1 / (rz * rz);
      const Az = (iu + iv) / 1024 + iz;
      for (let ly = 0; ly < sh; ly++) {
        const dy = minSy + ly + 0.5 - cy0;
        const halfS = 0.5 * (dy / 8);
        for (let lx = 0; lx < sw; lx++) {
          const dx = minSx + lx + 0.5 - cx0;
          const dx32 = dx / 32;
          const u0p = halfS + dx32;
          const v0p = halfS - dx32;
          const Bz = (-u0p * iu + v0p * iv) / 16 - 2 * zCenter * iz;
          const Cz = u0p * u0p * iu + v0p * v0p * iv + zCenter * zCenter * iz - 1;
          const disc = Bz * Bz - 4 * Az * Cz;
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          const zLoHit = Math.max(z0, (-Bz - sq) / (2 * Az));
          const zHiHit = Math.min(z1, (-Bz + sq) / (2 * Az));
          if (zLoHit <= zHiHit + 1e-4) {
            recordZ(lx, ly, clamp(zLoHit, z0, z1), clamp(zHiHit, z0, z1));
          }
        }
      }
      break;
    }
    case 'arch': {
      const spanCells = ori % 2 === 1 ? sv : su;
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
      if (cs.edges.length < 3 || cs.poly.length < 3) break;
      for (const e of cs.edges) {
        const zA = z0 + (flipZ ? 1 - e.h0 : e.h0) * heightPx;
        const zB = z0 + (flipZ ? 1 - e.h1 : e.h1) * heightPx;
        const A0 = P(e.s0, 0, zA);
        const B0 = P(e.s1, 0, zB);
        const B1 = P(e.s1, 1, zB);
        const A1 = P(e.s0, 1, zA);
        rasterTri3DSunField(A0, B0, B1);
        rasterTri3DSunField(A0, B1, A1);
      }
      for (const lvCap of [0, 1]) {
        const polySun = cs.poly.map(([s, hFrac]) =>
          projectPointToGroundShadow(P(s, lvCap, z0 + (flipZ ? 1 - hFrac : hFrac) * heightPx), originX, originY),
        );
        if (ori % 2 === 0) {
          const fv = ori === 0 ? lvCap : 1 - lvCap;
          const yPlane = v0 + fv * sv;
          rasterScanlinePolyZ(polySun, null, (lx, ly) => {
            const sx = minSx + lx + 0.5;
            const sy = minSy + ly + 0.5;
            const x = (sy - originY) / 8 - yPlane;
            return sx - originX - 16 * (x - yPlane);
          });
        } else {
          const fu = ori === 1 ? 1 - lvCap : lvCap;
          const xPlane = u0 + fu * su;
          rasterScanlinePolyZ(polySun, null, (lx, ly) => {
            const sx = minSx + lx + 0.5;
            const sy = minSy + ly + 0.5;
            const y = (sy - originY) / 8 - xPlane;
            return sx - originX - 16 * (xPlane - y);
          });
        }
      }
      break;
    }
    case 'loft': {
      rasterLoftOrColumnField(true);
      break;
    }
  }

  const canSelfShadow =
    shape.shapeType === 'arch' || shape.shapeType === 'loft' || hasActiveColumnSections(shape);

  return {
    minSx,
    minSy,
    sw,
    sh,
    shapeMinZ: z0,
    shapeMaxZ: z1,
    canSelfShadow,
    zLo,
    zHi,
  };
}

export function evaluateInterBlockShadowMask(
  mask: Uint8Array,
  w: number,
  h: number,
  entries: InterBlockShadowEntry[],
  bounds?: { x0: number; y0: number; x1: number; y1: number } | null,
) {
  mask.fill(0);
  const count = entries.length;
  if (count === 0) return;
  if (count === 1 && !entries[0].field?.canSelfShadow) return;

  const Z_EPS = 0.75;
  const SELF_Z_EPS = 2.5;
  const x0 = bounds ? Math.max(0, bounds.x0) : 0;
  const y0 = bounds ? Math.max(0, bounds.y0) : 0;
  const x1 = bounds ? Math.min(w, bounds.x1) : w;
  const y1 = bounds ? Math.min(h, bounds.y1) : h;

  for (let py = y0; py < y1; py++) {
    const rowBase = py * w;
    for (let px = x0; px < x1; px++) {
      const pIdx = rowBase + px;
      let rIdx = -1;
      const rgbaOff = pIdx * 4 + 3;
      for (let i = count - 1; i >= 0; i--) {
        if (entries[i].rgba[rgbaOff] > 0) {
          rIdx = i;
          break;
        }
      }
      if (rIdx < 0) continue;

      const recv = entries[rIdx];
      // Strictly skip back-facing surfaces (sunBit === 0) to prevent double-darkening & flush-stack seams
      const sunBit = recv.sunFacing[pIdx];
      if (sunBit === 0) continue;

      const zRecv = recv.zData[pIdx];
      if (!Number.isFinite(zRecv)) continue;

      const sx = px + 0.5 + zRecv;
      const sy = py + 0.5 + zRecv;

      for (let cIdx = 0; cIdx < count; cIdx++) {
        const cf = entries[cIdx].field;
        if (!cf) continue;
        const isSelf = cIdx === rIdx;
        if (isSelf) {
          // Only clearly sun-facing pixels on potentially concave shapes (arch/loft/multi-section) can self-shadow
          if (sunBit < 2 || !cf.canSelfShadow) continue;
        }
        const eps = isSelf ? SELF_Z_EPS : Z_EPS;
        if (cf.shapeMaxZ <= zRecv + eps) continue;
        const clx = Math.floor(sx - cf.minSx + 1e-5);
        const cly = Math.floor(sy - cf.minSy + 1e-5);
        if (clx < 0 || clx >= cf.sw || cly < 0 || cly >= cf.sh) continue;
        const cHi = cf.zHi[cly * cf.sw + clx];
        if (cHi > zRecv + eps) {
          mask[pIdx] = 1;
          break;
        }
      }
    }
  }
}
