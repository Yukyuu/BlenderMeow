// Isometric projection math, 32x16 diamond grid, 90° four-way view rotation, and TheoTown dual scale ruler formulas

export const TILE_W = 32;
export const TILE_H = 16;
export const STEP_X = 16; // px per cell along X per unit U/V step
export const STEP_Y = 8;  // px per cell along Y per unit U/V step

// TheoTown Scale Constants:
// Horizontal plane: 1 diamond cell (32×16 px) edge length = 9.6 meters
export const METERS_PER_CELL = 9.6;
// Vertical Z-axis: 3 pixels = 1.6 meters -> 1 px = 0.533333... m (18 px = 9.6 m)
export const METERS_PER_Z_PX = 1.6 / 3;

export type ViewRotation = 0 | 1 | 2 | 3; // 0°, 90°, 180°, 270° clockwise

export type GridSnapStep = 1 | 0.5 | 0.25 | 0.125 | 0.0625;

export function cellsToMeters(cells: number): number {
  return cells * METERS_PER_CELL;
}

export function metersToCells(meters: number): number {
  return meters / METERS_PER_CELL;
}

export function zPxToMeters(zPx: number): number {
  return zPx * METERS_PER_Z_PX;
}

export function metersToZPx(meters: number): number {
  return meters / METERS_PER_Z_PX;
}

export function snapGridValue(val: number, step: GridSnapStep | number): number {
  const s = step > 0 ? step : 0.0625;
  const snapped = Math.round(val / s) * s;
  return Math.round(snapped * 10000) / 10000;
}

export function normalizeRotation(rot: number): ViewRotation {
  return (((Math.round(rot) % 4) + 4) % 4) as ViewRotation;
}

export function getViewPlotDims(plotU: number, plotV: number, rot: ViewRotation): { viewPlotU: number; viewPlotV: number } {
  return rot % 2 === 0
    ? { viewPlotU: plotU, viewPlotV: plotV }
    : { viewPlotU: plotV, viewPlotV: plotU };
}

export function worldPointToView(
  u: number,
  v: number,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
): [number, number] {
  switch (rot) {
    case 0: return [u, v];
    case 1: return [plotV - v, u];
    case 2: return [plotU - u, plotV - v];
    case 3: return [v, plotU - u];
  }
}

export function viewPointToWorld(
  vu: number,
  vv: number,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
): [number, number] {
  switch (rot) {
    case 0: return [vu, vv];
    case 1: return [vv, plotV - vu];
    case 2: return [plotU - vu, plotV - vv];
    case 3: return [plotU - vv, vu];
  }
}

export interface ViewBox {
  u: number;
  v: number;
  sizeU: number;
  sizeV: number;
  ori: ViewRotation;
  viewPlotU: number;
  viewPlotV: number;
}

export function worldBoxToView(
  u: number,
  v: number,
  sizeU: number,
  sizeV: number,
  ori: ViewRotation,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
): ViewBox {
  const { viewPlotU, viewPlotV } = getViewPlotDims(plotU, plotV, rot);
  const nextOri = normalizeRotation(ori + rot);
  switch (rot) {
    case 0:
      return { u, v, sizeU, sizeV, ori: nextOri, viewPlotU, viewPlotV };
    case 1:
      return { u: plotV - (v + sizeV), v: u, sizeU: sizeV, sizeV: sizeU, ori: nextOri, viewPlotU, viewPlotV };
    case 2:
      return { u: plotU - (u + sizeU), v: plotV - (v + sizeV), sizeU, sizeV, ori: nextOri, viewPlotU, viewPlotV };
    case 3:
      return { u: v, v: plotU - (u + sizeU), sizeU: sizeV, sizeV: sizeU, ori: nextOri, viewPlotU, viewPlotV };
  }
}

export function viewBoxToWorld(
  vu: number,
  vv: number,
  vSizeU: number,
  vSizeV: number,
  vOri: ViewRotation,
  plotU: number,
  plotV: number,
  rot: ViewRotation,
): { u: number; v: number; sizeU: number; sizeV: number; ori: ViewRotation } {
  const ori = normalizeRotation(vOri - rot);
  switch (rot) {
    case 0:
      return { u: vu, v: vv, sizeU: vSizeU, sizeV: vSizeV, ori };
    case 1:
      return { u: vv, v: plotV - (vu + vSizeU), sizeU: vSizeV, sizeV: vSizeU, ori };
    case 2:
      return { u: plotU - (vu + vSizeU), v: plotV - (vv + vSizeV), sizeU: vSizeU, sizeV: vSizeV, ori };
    case 3:
      return { u: plotU - (vv + vSizeV), v: vu, sizeU: vSizeV, sizeV: vSizeU, ori };
  }
}

export function getPlotOrigin(
  canvasW: number,
  canvasH: number,
  viewPlotU: number,
  viewPlotV: number,
  bottomMarginPx = 16,
): { originX: number; originY: number } {
  const originX = Math.floor((canvasW - (viewPlotU + viewPlotV) * STEP_X) / 2) + viewPlotV * STEP_X;
  const originY = canvasH - bottomMarginPx - (viewPlotU + viewPlotV) * STEP_Y;
  return { originX, originY };
}

export function isoToScreenPx(
  vu: number,
  vv: number,
  zPx: number,
  originX: number,
  originY: number,
): [number, number] {
  return [
    originX + (vu - vv) * STEP_X,
    originY + (vu + vv) * STEP_Y - zPx,
  ];
}

export function screenPxToIsoAtZ(
  x: number,
  y: number,
  zPx: number,
  originX: number,
  originY: number,
): [number, number] {
  const dx = x - originX;
  const dy = (y + zPx) - originY;
  return [
    dx / TILE_W + dy / TILE_H,
    dy / TILE_H - dx / TILE_W,
  ];
}

// -------- TheoTown Dual-Scale Ruler Calculations --------

export interface VerticalMeasureResult {
  deltaPx: number;
  meters: number;
}

export function measureVerticalMeters(y1: number, y2: number): VerticalMeasureResult {
  const deltaPx = Math.abs(y2 - y1);
  return {
    deltaPx,
    meters: deltaPx * METERS_PER_Z_PX,
  };
}

export interface HorizontalMeasureResult {
  deltaU: number;
  deltaV: number;
  luMeters: number;
  lvMeters: number;
  totalMeters: number;
}

export function measureHorizontalPlane(x1: number, y1: number, x2: number, y2: number): HorizontalMeasureResult {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const deltaU = dx / TILE_W + dy / TILE_H;
  const deltaV = dy / TILE_H - dx / TILE_W;
  const luMeters = Math.abs(deltaU) * METERS_PER_CELL;
  const lvMeters = Math.abs(deltaV) * METERS_PER_CELL;
  const totalMeters = METERS_PER_CELL * Math.hypot(deltaU, deltaV);
  return {
    deltaU,
    deltaV,
    luMeters,
    lvMeters,
    totalMeters,
  };
}

export type MixedMeasureOrder = 'flat_then_vert' | 'vert_then_flat';

export interface MixedMeasureResult {
  flat: HorizontalMeasureResult;
  vert: VerticalMeasureResult;
  totalMeters: number;
  slopeDeg: number;
}

export function measureMixedPythagorean(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  order: MixedMeasureOrder = 'flat_then_vert',
): MixedMeasureResult {
  const flat = order === 'flat_then_vert'
    ? measureHorizontalPlane(ax, ay, bx, by)
    : measureHorizontalPlane(bx, by, cx, cy);
  const vert = order === 'flat_then_vert'
    ? measureVerticalMeters(by, cy)
    : measureVerticalMeters(ay, by);
  const totalMeters = Math.hypot(flat.totalMeters, vert.meters);
  const slopeDeg = (flat.totalMeters === 0 && vert.meters === 0)
    ? 0
    : (Math.atan2(vert.meters, flat.totalMeters) * 180) / Math.PI;
  return {
    flat,
    vert,
    totalMeters,
    slopeDeg,
  };
}
