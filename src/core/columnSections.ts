import { clamp } from './color';
import { tr } from './i18n';
import type { ParametricShape, ShapeKind } from './isoRenderer';

export type ColumnInterpMode = 'smooth' | 'linear';

export interface ColumnEdgeDef {
  id: string;
  label?: string;
  baseAngleDeg: number;
  baseDist: number;
  angleDeg: number;
  offset: number;
  locked?: boolean;
}

export interface ColumnSection {
  id: string;
  name: string;
  t: number;
  scale: number;
  twistDeg: number;
  offsetU: number;
  offsetV: number;
  edges: ColumnEdgeDef[];
  /** When true, section cross-section morphology dynamically tracks adjacent lower & upper non-transition sections */
  isTransition?: boolean;
}

export interface EvaluatedEdgeSegment {
  edgeIndex: number;
  start: [number, number];
  end: [number, number];
  midpoint: [number, number];
  normal: [number, number];
  dist: number;
  angleDeg: number;
  locked: boolean;
}

export interface ColumnRingEntry {
  t: number;
  pts: [number, number][];
  sectionIndex?: number;
}

export const COLUMN_SECTION_SHAPES: readonly ShapeKind[] = [
  'box',
  'cylinder',
  'prism',
  'right_tri_prism',
];

let colSecSeq = 100;
export function nextColSectionId(): string {
  colSecSeq += 1;
  return `colsec-${Date.now().toString(36)}-${colSecSeq}`;
}

export function normalizeAngleDeg(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  if (Object.is(a, -0)) a = 0;
  return Math.round(a * 100) / 100;
}

export function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

export function isColumnSectionShape(s?: Partial<ParametricShape> | null): boolean {
  if (!s || !s.shapeType) return false;
  if (s.shapeType === 'box' || s.shapeType === 'cylinder' || s.shapeType === 'prism') {
    return true;
  }
  if (s.shapeType === 'right_tri_prism') {
    return (s.triPrismCut ?? 'vertical') === 'vertical';
  }
  return false;
}

export function isPolygonalColumnShape(s?: Partial<ParametricShape> | null): boolean {
  return isColumnSectionShape(s) && s?.shapeType !== 'cylinder';
}

export function getExpectedEdgeCount(
  s: Pick<ParametricShape, 'shapeType' | 'prismSides' | 'triPrismCut'>,
): number {
  if (!isPolygonalColumnShape(s)) return 0;
  if (s.shapeType === 'box') return 4;
  if (s.shapeType === 'right_tri_prism') return 3;
  if (s.shapeType === 'prism') {
    return clamp(Math.round(Number.isFinite(s.prismSides) ? s.prismSides : 6), 3, 12);
  }
  return 0;
}

export function hasActiveColumnSections(s?: Partial<ParametricShape> | null): boolean {
  if (!isColumnSectionShape(s)) return false;
  return Array.isArray(s?.colSections) && s!.colSections.length >= 1;
}

export function createDefaultColumnEdges(shapeType: ShapeKind, prismSides = 6): ColumnEdgeDef[] {
  if (shapeType === 'cylinder' || !isColumnSectionShape({ shapeType, triPrismCut: 'vertical' })) {
    return [];
  }
  if (shapeType === 'box') {
    return [
      { id: 'e-0', label: '顶边 (-V)', baseAngleDeg: -90, baseDist: 0.5, angleDeg: -90, offset: 0, locked: false },
      { id: 'e-1', label: '右边 (+U)', baseAngleDeg: 0, baseDist: 0.5, angleDeg: 0, offset: 0, locked: false },
      { id: 'e-2', label: '底边 (+V)', baseAngleDeg: 90, baseDist: 0.5, angleDeg: 90, offset: 0, locked: false },
      { id: 'e-3', label: '左边 (-U)', baseAngleDeg: 180, baseDist: 0.5, angleDeg: 180, offset: 0, locked: false },
    ];
  }
  if (shapeType === 'right_tri_prism') {
    return [
      { id: 'e-0', label: '顶边 (-V)', baseAngleDeg: -90, baseDist: 0.5, angleDeg: -90, offset: 0, locked: false },
      { id: 'e-1', label: '斜边', baseAngleDeg: 45, baseDist: 0, angleDeg: 45, offset: 0, locked: false },
      { id: 'e-2', label: '左边 (-U)', baseAngleDeg: 180, baseDist: 0.5, angleDeg: 180, offset: 0, locked: false },
    ];
  }
  const n = clamp(Math.round(Number.isFinite(prismSides) ? prismSides : 6), 3, 12);
  const startAngle = -Math.PI / 2 - (n % 2 === 0 ? Math.PI / n : 0);
  const step = (Math.PI * 2) / n;
  const inradius = Math.round(0.5 * Math.cos(Math.PI / n) * 100000) / 100000;
  const edges: ColumnEdgeDef[] = [];
  for (let i = 0; i < n; i++) {
    const midAngleRad = startAngle + (i + 0.5) * step;
    const deg = normalizeAngleDeg((midAngleRad * 180) / Math.PI);
    edges.push({
      id: `e-${i}`,
      label: `边 #${i + 1}`,
      baseAngleDeg: deg,
      baseDist: inradius,
      angleDeg: deg,
      offset: 0,
      locked: false,
    });
  }
  return edges;
}

export function cloneColumnEdge(e: ColumnEdgeDef): ColumnEdgeDef {
  return {
    id: e.id,
    label: e.label,
    baseAngleDeg: e.baseAngleDeg,
    baseDist: e.baseDist,
    angleDeg: e.angleDeg,
    offset: e.offset,
    locked: Boolean(e.locked),
  };
}

export function cloneColumnSection(sec: ColumnSection): ColumnSection {
  const out: ColumnSection = {
    id: sec.id,
    name: sec.name,
    t: sec.t,
    scale: sec.scale,
    twistDeg: sec.twistDeg,
    offsetU: sec.offsetU,
    offsetV: sec.offsetV,
    edges: sec.edges.map(cloneColumnEdge),
  };
  if (sec.isTransition) out.isTransition = true;
  return out;
}

export function cloneColumnSections(secs: ColumnSection[]): ColumnSection[] {
  return secs.map(cloneColumnSection);
}

export function createDefaultColumnSections(shapeType: ShapeKind, prismSides = 6): ColumnSection[] {
  const baseEdges = createDefaultColumnEdges(shapeType, prismSides);
  return [
    {
      id: 'colsec-1',
      name: tr('底层控制面'),
      t: 0,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      edges: baseEdges.map(cloneColumnEdge),
    },
    {
      id: 'colsec-2',
      name: tr('顶层控制面'),
      t: 1,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      edges: baseEdges.map(cloneColumnEdge),
    },
  ];
}

function sanitizeEdgeList(
  rawEdges: ColumnEdgeDef[] | undefined,
  template: ColumnEdgeDef[],
): ColumnEdgeDef[] {
  if (template.length === 0) return [];
  if (!Array.isArray(rawEdges) || rawEdges.length !== template.length) {
    return template.map(cloneColumnEdge);
  }
  return template.map((tmpl, idx) => {
    const raw = rawEdges[idx];
    if (!raw) return cloneColumnEdge(tmpl);
    const angleDeg = Number.isFinite(raw.angleDeg)
      ? normalizeAngleDeg(raw.angleDeg)
      : tmpl.baseAngleDeg;
    const offset = Number.isFinite(raw.offset) ? clamp(raw.offset, -0.75, 0.75) : 0;
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : tmpl.id,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : tmpl.label,
      baseAngleDeg: tmpl.baseAngleDeg,
      baseDist: tmpl.baseDist,
      angleDeg,
      offset,
      locked: Boolean(raw.locked),
    };
  });
}

export function normalizeColumnSections(
  secs: ColumnSection[] | undefined | null,
  shapeType: ShapeKind,
  prismSides = 6,
): ColumnSection[] {
  const templateEdges = createDefaultColumnEdges(shapeType, prismSides);
  if (!Array.isArray(secs) || secs.length === 0) {
    return createDefaultColumnSections(shapeType, prismSides);
  }
  const seenIds = new Set<string>();
  const out: ColumnSection[] = [];
  for (let i = 0; i < secs.length; i++) {
    const raw = secs[i];
    if (!raw) continue;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : nextColSectionId();
    while (seenIds.has(id)) {
      id = nextColSectionId();
    }
    seenIds.add(id);
    const item: ColumnSection = {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : tr(`控制面 #${out.length + 1}`),
      t: clamp(Number.isFinite(raw.t) ? raw.t : 0, 0, 1),
      scale: clamp(Number.isFinite(raw.scale) ? raw.scale : 1, 0.15, 1.6),
      twistDeg: clamp(Number.isFinite(raw.twistDeg) ? raw.twistDeg : 0, -180, 180),
      offsetU: clamp(Number.isFinite(raw.offsetU) ? raw.offsetU : 0, -0.5, 0.5),
      offsetV: clamp(Number.isFinite(raw.offsetV) ? raw.offsetV : 0, -0.5, 0.5),
      edges: sanitizeEdgeList(raw.edges, templateEdges),
    };
    if (raw.isTransition) item.isTransition = true;
    out.push(item);
  }
  if (out.length === 0) {
    return createDefaultColumnSections(shapeType, prismSides);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function getColumnSectionsReadOnly(
  s: Pick<ParametricShape, 'shapeType' | 'prismSides' | 'triPrismCut' | 'colSections'>,
): ColumnSection[] {
  if (!isColumnSectionShape(s)) return [];
  return normalizeColumnSections(s.colSections, s.shapeType, s.prismSides);
}

export function ensureColumnSections(shape: ParametricShape): ColumnSection[] {
  if (!isColumnSectionShape(shape)) return [];
  const templateEdges = createDefaultColumnEdges(shape.shapeType, shape.prismSides);
  if (!Array.isArray(shape.colSections) || shape.colSections.length === 0) {
    shape.colSections = createDefaultColumnSections(shape.shapeType, shape.prismSides);
  } else {
    const seenIds = new Set<string>();
    const rawList = shape.colSections;
    let writeIdx = 0;
    for (let i = 0; i < rawList.length; i++) {
      const sec = rawList[i];
      if (!sec) continue;
      let id = typeof sec.id === 'string' && sec.id.trim() ? sec.id.trim() : nextColSectionId();
      while (seenIds.has(id)) {
        id = nextColSectionId();
      }
      seenIds.add(id);
      sec.id = id;
      sec.name = typeof sec.name === 'string' && sec.name.trim() ? sec.name.trim() : tr(`控制面 #${writeIdx + 1}`);
      sec.t = clamp(Number.isFinite(sec.t) ? sec.t : 0, 0, 1);
      sec.scale = clamp(Number.isFinite(sec.scale) ? sec.scale : 1, 0.15, 1.6);
      sec.twistDeg = clamp(Number.isFinite(sec.twistDeg) ? sec.twistDeg : 0, -180, 180);
      sec.offsetU = clamp(Number.isFinite(sec.offsetU) ? sec.offsetU : 0, -0.5, 0.5);
      sec.offsetV = clamp(Number.isFinite(sec.offsetV) ? sec.offsetV : 0, -0.5, 0.5);
      sec.edges = sanitizeEdgeList(sec.edges, templateEdges);
      if (!sec.isTransition) delete sec.isTransition;
      rawList[writeIdx++] = sec;
    }
    rawList.length = writeIdx;
    if (rawList.length === 0) {
      rawList.push(...createDefaultColumnSections(shape.shapeType, shape.prismSides));
    } else {
      rawList.sort((a, b) => a.t - b.t);
    }
  }
  if (!shape.colInterp) shape.colInterp = 'smooth';
  ensureActiveColumnSection(shape);
  return shape.colSections;
}

export function ensureActiveColumnSection(shape: ParametricShape): ColumnSection | null {
  if (!hasActiveColumnSections(shape)) return null;
  const secs = shape.colSections!;
  const found = secs.find((s) => s.id === shape.activeColSectionId);
  if (found) return found;
  const fallback = secs[secs.length - 1] ?? secs[0] ?? null;
  shape.activeColSectionId = fallback?.id;
  return fallback;
}

export function syncColumnSectionsEdgeCount(shape: ParametricShape): void {
  if (!isColumnSectionShape(shape) || !Array.isArray(shape.colSections) || shape.colSections.length === 0) {
    return;
  }
  shape.colSections = normalizeColumnSections(shape.colSections, shape.shapeType, shape.prismSides);
  ensureActiveColumnSection(shape);
}

export function insertColumnSectionAtT(
  shape: ParametricShape,
  t: number,
  name?: string,
): ColumnSection | null {
  if (!isColumnSectionShape(shape)) return null;
  const secs = ensureColumnSections(shape);
  const clampedT = clamp(Math.round(t * 1000) / 1000, 0, 1);

  // Interpolate parameters from surrounding sorted sections
  let scale = 1;
  let twistDeg = 0;
  let offsetU = 0;
  let offsetV = 0;
  let edges: ColumnEdgeDef[] = createDefaultColumnEdges(shape.shapeType, shape.prismSides);

  if (secs.length >= 1) {
    let i0 = 0;
    let i1 = secs.length - 1;
    for (let i = 0; i < secs.length - 1; i++) {
      if (clampedT >= secs[i].t && clampedT <= secs[i + 1].t) {
        i0 = i;
        i1 = i + 1;
        break;
      }
    }
    if (clampedT <= secs[0].t) {
      i0 = 0;
      i1 = 0;
    } else if (clampedT >= secs[secs.length - 1].t) {
      i0 = secs.length - 1;
      i1 = secs.length - 1;
    }
    const s0 = secs[i0];
    const s1 = secs[i1];
    const span = s1.t - s0.t;
    const f = span > 1e-5 ? clamp((clampedT - s0.t) / span, 0, 1) : 0;
    scale = s0.scale + (s1.scale - s0.scale) * f;
    twistDeg = s0.twistDeg + (s1.twistDeg - s0.twistDeg) * f;
    offsetU = s0.offsetU + (s1.offsetU - s0.offsetU) * f;
    offsetV = s0.offsetV + (s1.offsetV - s0.offsetV) * f;
    edges = s0.edges.map((e0, idx) => {
      const e1 = s1.edges[idx] ?? e0;
      const dAng = shortestAngleDeltaDeg(e0.angleDeg, e1.angleDeg);
      return {
        ...cloneColumnEdge(e0),
        angleDeg: normalizeAngleDeg(e0.angleDeg + dAng * f),
        offset: e0.offset + (e1.offset - e0.offset) * f,
        locked: Boolean(f < 0.5 ? e0.locked : e1.locked),
      };
    });
  }

  const created: ColumnSection = {
    id: nextColSectionId(),
    name: name ?? tr(`控制面 #${secs.length + 1}`),
    t: clampedT,
    scale: Math.round(scale * 1000) / 1000,
    twistDeg: Math.round(twistDeg * 100) / 100,
    offsetU: Math.round(offsetU * 1000) / 1000,
    offsetV: Math.round(offsetV * 1000) / 1000,
    edges,
  };
  secs.push(created);
  secs.sort((a, b) => a.t - b.t);
  shape.activeColSectionId = created.id;
  return created;
}

export function getColumnTransitionNeighbors(
  secs: ColumnSection[],
  sectionId: string,
): { prev: ColumnSection; next: ColumnSection; alpha: number } | null {
  if (!Array.isArray(secs) || secs.length < 3) return null;
  const sorted = secs
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => (a.s.t !== b.s.t ? a.s.t - b.s.t : a.idx - b.idx))
    .map((x) => x.s);
  const k = sorted.findIndex((s) => s.id === sectionId);
  if (k <= 0 || k >= sorted.length - 1) return null;

  let prevIdx = k - 1;
  while (prevIdx > 0 && sorted[prevIdx].isTransition) prevIdx--;
  let nextIdx = k + 1;
  while (nextIdx < sorted.length - 1 && sorted[nextIdx].isTransition) nextIdx++;

  const prev = sorted[prevIdx];
  const next = sorted[nextIdx];
  const cur = sorted[k];
  const dt = next.t - prev.t;
  const alpha =
    dt > 1e-4 ? clamp((cur.t - prev.t) / dt, 0, 1) : (k - prevIdx) / Math.max(1, nextIdx - prevIdx);
  return { prev, next, alpha };
}

export function canColumnSectionBeTransition(secs: ColumnSection[], sectionId: string): boolean {
  return getColumnTransitionNeighbors(secs, sectionId) !== null;
}

function applyColumnTransitionBlend(
  sec: ColumnSection,
  prev: ColumnSection,
  next: ColumnSection,
  alpha: number,
  isCylinder: boolean,
): void {
  const planesA = !isCylinder && sec.edges.length > 0 ? getSectionHalfPlanes(prev) : [];
  const planesB = !isCylinder && sec.edges.length > 0 ? getSectionHalfPlanes(next) : [];

  sec.scale = Math.round(((1 - alpha) * prev.scale + alpha * next.scale) * 1000) / 1000;
  sec.twistDeg = normalizeAngleDeg(prev.twistDeg + alpha * shortestAngleDeltaDeg(prev.twistDeg, next.twistDeg));
  sec.offsetU = Math.round(((1 - alpha) * prev.offsetU + alpha * next.offsetU) * 1000) / 1000;
  sec.offsetV = Math.round(((1 - alpha) * prev.offsetV + alpha * next.offsetV) * 1000) / 1000;

  if (isCylinder || sec.edges.length === 0) return;

  const safeScale = Math.max(0.15, sec.scale);
  for (let i = 0; i < sec.edges.length; i++) {
    const eA = prev.edges[i];
    const eB = next.edges[i];
    const pA = planesA[i];
    const pB = planesB[i];
    const dst = sec.edges[i];
    if (!eA || !eB || !pA || !pB || !dst) continue;
    const targetLocalDeg = normalizeAngleDeg(
      pA.angleDeg + alpha * shortestAngleDeltaDeg(pA.angleDeg, pB.angleDeg),
    );
    const targetDist = (1 - alpha) * pA.dist + alpha * pB.dist;
    dst.locked = Boolean(eA.locked && eB.locked);
    if (dst.locked) {
      dst.angleDeg = targetLocalDeg;
      dst.offset = Math.round(clamp(targetDist - dst.baseDist, -0.75, 0.75) * 10000) / 10000;
    } else {
      dst.angleDeg = normalizeAngleDeg(targetLocalDeg - sec.twistDeg);
      const rad = (targetLocalDeg * Math.PI) / 180;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);
      dst.offset =
        Math.round(
          clamp((targetDist - nx * sec.offsetU - ny * sec.offsetV) / safeScale - dst.baseDist, -0.75, 0.75) *
            10000,
        ) / 10000;
    }
  }
}

export function syncColumnTransitionSections(
  shape: Pick<ParametricShape, 'shapeType' | 'colSections'>,
): void {
  if (!Array.isArray(shape.colSections) || shape.colSections.length === 0) return;
  const sorted = shape.colSections
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => (a.s.t !== b.s.t ? a.s.t - b.s.t : a.idx - b.idx))
    .map((x) => x.s);

  if (sorted.length < 3) {
    for (const s of sorted) delete s.isTransition;
    return;
  }
  delete sorted[0].isTransition;
  delete sorted[sorted.length - 1].isTransition;

  if (!sorted.some((s) => s.isTransition)) return;
  const isCyl = shape.shapeType === 'cylinder';
  for (let k = 1; k < sorted.length - 1; k++) {
    const sec = sorted[k];
    if (!sec.isTransition) continue;
    const nb = getColumnTransitionNeighbors(sorted, sec.id);
    if (!nb) {
      delete sec.isTransition;
      continue;
    }
    applyColumnTransitionBlend(sec, nb.prev, nb.next, nb.alpha, isCyl);
  }
}

export function insertColumnTransitionSection(
  shape: ParametricShape,
  targetT: number,
): ColumnSection | null {
  if (!isColumnSectionShape(shape)) return null;
  const secs = ensureColumnSections(shape);
  let sorted = [...secs].sort((a, b) => a.t - b.t);
  if (sorted.length < 2) {
    const only = sorted[0];
    const edgeT = only.t < 0.5 ? 1.0 : 0.0;
    insertColumnSectionAtT(shape, edgeT, tr(edgeT >= 0.5 ? '顶层控制面' : '底层控制面'));
    sorted = [...secs].sort((a, b) => a.t - b.t);
  }
  const minT = sorted[0].t;
  const maxT = sorted[sorted.length - 1].t;
  const eps = Math.min(0.01, (maxT - minT) * 0.1);
  const clampedT =
    maxT - minT > 1e-4 ? clamp(targetT, minT + eps, maxT - eps) : clamp(targetT, 0.01, 0.99);
  const created = insertColumnSectionAtT(shape, clampedT, tr('过渡控制面'));
  if (!created) return null;
  created.isTransition = true;
  syncColumnTransitionSections(shape);
  return created;
}

export function convertColumnSectionToTransition(
  shape: ParametricShape,
  sectionId: string,
): boolean {
  if (!Array.isArray(shape.colSections)) return false;
  const nb = getColumnTransitionNeighbors(shape.colSections, sectionId);
  const sec = shape.colSections.find((s) => s.id === sectionId);
  if (!nb || !sec) return false;
  sec.isTransition = true;
  syncColumnTransitionSections(shape);
  return true;
}

interface EvaluatedHalfPlane {
  nx: number;
  ny: number;
  dist: number;
  angleDeg: number;
  locked: boolean;
}

function getSectionHalfPlanes(sec: ColumnSection): EvaluatedHalfPlane[] {
  const twistRad = (sec.twistDeg * Math.PI) / 180;
  return sec.edges.map((e) => {
    if (e.locked) {
      const rad = (e.angleDeg * Math.PI) / 180;
      return {
        nx: Math.cos(rad),
        ny: Math.sin(rad),
        dist: e.baseDist + e.offset,
        angleDeg: normalizeAngleDeg(e.angleDeg),
        locked: true,
      };
    }
    const localDeg = e.angleDeg + sec.twistDeg;
    const rad = (e.angleDeg * Math.PI) / 180 + twistRad;
    const nx = Math.cos(rad);
    const ny = Math.sin(rad);
    const dist = sec.scale * (e.baseDist + e.offset) + nx * sec.offsetU + ny * sec.offsetV;
    return {
      nx,
      ny,
      dist,
      angleDeg: normalizeAngleDeg(localDeg),
      locked: false,
    };
  });
}

function solveHalfPlanesPolygon(
  planes: EvaluatedHalfPlane[],
): { verts: [number, number][]; valid: boolean } {
  const n = planes.length;
  if (n < 3) return { verts: [], valid: false };

  // Corners V[i] = intersect(plane[i], plane[(i+1)%n])
  // Note: edge i connects V[(i-1+n)%n] -> V[i].
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = planes[i];
    const p1 = planes[(i + 1) % n];
    const det = p0.nx * p1.ny - p0.ny * p1.nx;
    if (det <= 0.08) {
      return { verts: [], valid: false };
    }
    const qx = (p0.dist * p1.ny - p0.ny * p1.dist) / det;
    const qy = (p0.nx * p1.dist - p0.dist * p1.nx) / det;
    const u = 0.5 + qx;
    const v = 0.5 + qy;
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < -0.65 || u > 1.65 || v < -0.65 || v > 1.65) {
      return { verts: [], valid: false };
    }
    verts.push([u, v]);
  }

  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const start = verts[(i - 1 + n) % n];
    const end = verts[i];
    const p = planes[i];
    // Oriented tangent T_i = (-ny, nx)
    const tx = -p.ny;
    const ty = p.nx;
    const edgeLen = (end[0] - start[0]) * tx + (end[1] - start[1]) * ty;
    if (!Number.isFinite(edgeLen) || edgeLen < 0.04) {
      return { verts: [], valid: false };
    }
    area2 += start[0] * end[1] - end[0] * start[1];
  }
  if (Math.abs(area2) * 0.5 < 0.015) {
    return { verts: [], valid: false };
  }
  return { verts, valid: true };
}

export function evaluateColumnSectionEdges(sec: ColumnSection): EvaluatedEdgeSegment[] {
  if (!sec.edges || sec.edges.length < 3) return [];
  const planes = getSectionHalfPlanes(sec);
  let solved = solveHalfPlanesPolygon(planes);
  if (!solved.valid) {
    // Graceful fallback if deserialized or combined with locked edges out of range:
    // keep locked planes untouched if non-zero area, else fall back to unlocked scaled shape.
    const relaxedPlanes: EvaluatedHalfPlane[] = sec.edges.map((e) => {
      const twistRad = (sec.twistDeg * Math.PI) / 180;
      const rad = e.locked ? (e.baseAngleDeg * Math.PI) / 180 : (e.baseAngleDeg * Math.PI) / 180 + twistRad;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);
      const dist = e.locked
        ? e.baseDist + e.offset
        : sec.scale * e.baseDist + nx * sec.offsetU + ny * sec.offsetV;
      return {
        nx,
        ny,
        dist,
        angleDeg: normalizeAngleDeg(e.locked ? e.baseAngleDeg : e.baseAngleDeg + sec.twistDeg),
        locked: Boolean(e.locked),
      };
    });
    solved = solveHalfPlanesPolygon(relaxedPlanes);
    if (!solved.valid) {
      const fallbackPlanes = sec.edges.map((e) => {
        const rad = (e.baseAngleDeg * Math.PI) / 180;
        return {
          nx: Math.cos(rad),
          ny: Math.sin(rad),
          dist: e.baseDist,
          angleDeg: e.baseAngleDeg,
          locked: Boolean(e.locked),
        };
      });
      solved = solveHalfPlanesPolygon(fallbackPlanes);
    }
  }

  const n = sec.edges.length;
  const segments: EvaluatedEdgeSegment[] = [];
  for (let i = 0; i < n; i++) {
    const start = solved.verts[(i - 1 + n) % n];
    const end = solved.verts[i];
    const p = planes[i];
    segments.push({
      edgeIndex: i,
      start: [start[0], start[1]],
      end: [end[0], end[1]],
      midpoint: [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5],
      normal: [p.nx, p.ny],
      dist: p.dist,
      angleDeg: p.angleDeg,
      locked: p.locked,
    });
  }
  return segments;
}

export function isColumnSectionPolygonValid(sec: ColumnSection): boolean {
  if (!sec.edges || sec.edges.length < 3) return true;
  return solveHalfPlanesPolygon(getSectionHalfPlanes(sec)).valid;
}

/**
 * Sets edge position/angle with binary-search clamping so adjacent edges never cross or vanish.
 * Locked edges cannot be modified.
 */
export function applyColumnEdgeEdit(
  sec: ColumnSection,
  edgeIndex: number,
  targetOffset: number,
  targetAngleDeg: number,
  options: { pivotMidpoint?: boolean; midpoint?: [number, number] } = {},
): boolean {
  const edge = sec.edges[edgeIndex];
  if (!edge || edge.locked) return false;

  const oldOffset = edge.offset;
  const oldAngleDeg = edge.angleDeg;
  const segsBefore = evaluateColumnSectionEdges(sec);
  const segBefore = segsBefore[edgeIndex];
  const pivotMid = options.midpoint ?? segBefore?.midpoint ?? [0.5, 0.5];

  const computeOffsetForAngle = (angDeg: number, rawOffset: number): number => {
    if (!options.pivotMidpoint) return clamp(rawOffset, -0.75, 0.75);
    const rad = ((angDeg + sec.twistDeg) * Math.PI) / 180;
    const nx = Math.cos(rad);
    const ny = Math.sin(rad);
    const dLocal = nx * (pivotMid[0] - 0.5) + ny * (pivotMid[1] - 0.5);
    const dSec = (dLocal - nx * sec.offsetU - ny * sec.offsetV) / Math.max(0.15, sec.scale);
    return clamp(dSec - edge.baseDist, -0.75, 0.75);
  };

  const candAngle = normalizeAngleDeg(targetAngleDeg);
  const candOffset = computeOffsetForAngle(candAngle, targetOffset);

  edge.angleDeg = candAngle;
  edge.offset = candOffset;
  if (isColumnSectionPolygonValid(sec)) {
    return edge.angleDeg !== oldAngleDeg || edge.offset !== oldOffset;
  }

  // Binary search towards last valid state
  const deltaAngle = shortestAngleDeltaDeg(oldAngleDeg, candAngle);
  let lo = 0;
  let hi = 1;
  let bestF = 0;
  for (let iter = 0; iter < 14; iter++) {
    const mid = (lo + hi) * 0.5;
    const testAngle = normalizeAngleDeg(oldAngleDeg + deltaAngle * mid);
    const testOffset = options.pivotMidpoint
      ? computeOffsetForAngle(testAngle, oldOffset)
      : clamp(oldOffset + (candOffset - oldOffset) * mid, -0.75, 0.75);
    edge.angleDeg = testAngle;
    edge.offset = testOffset;
    if (isColumnSectionPolygonValid(sec)) {
      bestF = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (bestF <= 1e-4) {
    edge.angleDeg = oldAngleDeg;
    edge.offset = oldOffset;
    return false;
  }
  const finalAngle = normalizeAngleDeg(oldAngleDeg + deltaAngle * bestF);
  edge.angleDeg = finalAngle;
  edge.offset = options.pivotMidpoint
    ? computeOffsetForAngle(finalAngle, oldOffset)
    : clamp(oldOffset + (candOffset - oldOffset) * bestF, -0.75, 0.75);
  return true;
}

/**
 * Applies section-wide transform (scale/twist/offsetU/offsetV) with binary-search clamping
 * if locked edges constrain the unlocked geometry.
 */
export function applyColumnSectionTransform(
  sec: ColumnSection,
  next: Partial<Pick<ColumnSection, 'scale' | 'twistDeg' | 'offsetU' | 'offsetV'>>,
): boolean {
  const prev = {
    scale: sec.scale,
    twistDeg: sec.twistDeg,
    offsetU: sec.offsetU,
    offsetV: sec.offsetV,
  };
  const target = {
    scale: clamp(next.scale ?? sec.scale, 0.15, 1.6),
    twistDeg: clamp(next.twistDeg ?? sec.twistDeg, -180, 180),
    offsetU: clamp(next.offsetU ?? sec.offsetU, -0.5, 0.5),
    offsetV: clamp(next.offsetV ?? sec.offsetV, -0.5, 0.5),
  };
  sec.scale = target.scale;
  sec.twistDeg = target.twistDeg;
  sec.offsetU = target.offsetU;
  sec.offsetV = target.offsetV;
  if (!sec.edges || sec.edges.length < 3 || isColumnSectionPolygonValid(sec)) {
    return true;
  }

  let lo = 0;
  let hi = 1;
  let best = 0;
  for (let iter = 0; iter < 14; iter++) {
    const mid = (lo + hi) * 0.5;
    sec.scale = prev.scale + (target.scale - prev.scale) * mid;
    sec.twistDeg = prev.twistDeg + (target.twistDeg - prev.twistDeg) * mid;
    sec.offsetU = prev.offsetU + (target.offsetU - prev.offsetU) * mid;
    sec.offsetV = prev.offsetV + (target.offsetV - prev.offsetV) * mid;
    if (isColumnSectionPolygonValid(sec)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  sec.scale = prev.scale + (target.scale - prev.scale) * best;
  sec.twistDeg = prev.twistDeg + (target.twistDeg - prev.twistDeg) * best;
  sec.offsetU = prev.offsetU + (target.offsetU - prev.offsetU) * best;
  sec.offsetV = prev.offsetV + (target.offsetV - prev.offsetV) * best;
  return best > 1e-4;
}

/**
 * Evaluates a single column section into an ordered vertex loop in local `[0, 1]^2` space.
 * For polygonal columns, vertices follow the polygon edges around the perimeter.
 * For cylinder columns, samples `cylinderSamples` points uniformly around the circle.
 */
export function evaluateColumnSectionRing(
  sec: ColumnSection,
  cylinderSamples = 32,
): [number, number][] {
  if (sec.edges && sec.edges.length >= 3) {
    const segs = evaluateColumnSectionEdges(sec);
    // Use segment start points in order so ring order matches edge order cleanly
    return segs.map((s) => s.start);
  }
  const n = Math.max(8, cylinderSamples);
  const r = 0.5 * sec.scale;
  const cu = 0.5 + sec.offsetU;
  const cv = 0.5 + sec.offsetV;
  const twistRad = (sec.twistDeg * Math.PI) / 180;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = twistRad + (i / n) * Math.PI * 2;
    pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]);
  }
  return pts;
}

function catmullRomValue(p0: number, p1: number, p2: number, p3: number, f: number): number {
  const f2 = f * f;
  const f3 = f2 * f;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f3)
  );
}

/**
 * Builds ordered cross-section rings along `t ∈ [0, 1]` across all control sections,
 * including duplicate-t horizontal terrace pairs for crisp setback steps.
 */
export function buildColumnRings(
  s: Pick<ParametricShape, 'shapeType' | 'prismSides' | 'triPrismCut' | 'colSections' | 'colInterp'>,
  zSteps: number,
  cylinderSamples = 32,
): ColumnRingEntry[] {
  const secs = getColumnSectionsReadOnly(s);
  if (secs.length === 0) return [];
  syncColumnTransitionSections({ shapeType: s.shapeType, colSections: secs });
  const interp: ColumnInterpMode = s.colInterp ?? 'smooth';
  const baseRings = secs.map((sec) => evaluateColumnSectionRing(sec, cylinderSamples));
  const vertCount = baseRings[0]?.length ?? 0;
  if (vertCount < 3) return [];

  if (secs.length === 1) {
    return [
      { t: 0, pts: baseRings[0].map(([u, v]) => [u, v]), sectionIndex: 0 },
      { t: 1, pts: baseRings[0].map(([u, v]) => [u, v]), sectionIndex: 0 },
    ];
  }

  // Group into continuous spans between unequal t values (supporting duplicate t step ledges)
  const rings: ColumnRingEntry[] = [];
  const totalSteps = Math.max(2, zSteps);

  // If min t > 0, prepend flat vertical extension from 0 to secs[0].t
  if (secs[0].t > 1e-4) {
    rings.push({ t: 0, pts: baseRings[0].map(([u, v]) => [u, v]), sectionIndex: 0 });
  }

  for (let i = 0; i < secs.length - 1; i++) {
    const t0 = secs[i].t;
    const t1 = secs[i + 1].t;
    const dt = t1 - t0;
    if (dt <= 1e-4) {
      // Exact duplicate t: horizontal terrace jump between section i and i+1
      if (rings.length === 0 || Math.abs(rings[rings.length - 1].t - t0) > 1e-4) {
        rings.push({ t: t0, pts: baseRings[i].map(([u, v]) => [u, v]), sectionIndex: i });
      }
      rings.push({ t: t1, pts: baseRings[i + 1].map(([u, v]) => [u, v]), sectionIndex: i + 1 });
      continue;
    }

    const spanSteps =
      interp === 'linear' ? 1 : clamp(Math.ceil(dt * totalSteps), 2, totalSteps);
    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(secs.length - 1, i + 2);
    // Avoid Catmull-Rom overshoot across step discontinuities
    const hasStepBefore = i > 0 && Math.abs(secs[i].t - secs[i - 1].t) <= 1e-4;
    const hasStepAfter = i + 2 < secs.length && Math.abs(secs[i + 2].t - secs[i + 1].t) <= 1e-4;

    const rPrev = hasStepBefore ? baseRings[i] : baseRings[prevIdx];
    const r0 = baseRings[i];
    const r1 = baseRings[i + 1];
    const rNext = hasStepAfter ? baseRings[i + 1] : baseRings[nextIdx];

    const startStep = rings.length === 0 ? 0 : 1;
    for (let st = startStep; st <= spanSteps; st++) {
      const f = st / spanSteps;
      const t = t0 + dt * f;
      const pts: [number, number][] = [];
      for (let k = 0; k < vertCount; k++) {
        if (interp === 'linear' || st === spanSteps || st === 0) {
          pts.push([
            r0[k][0] + (r1[k][0] - r0[k][0]) * f,
            r0[k][1] + (r1[k][1] - r0[k][1]) * f,
          ]);
        } else {
          // Clamped Catmull-Rom keeps intermediate curve responsive without huge overshoot
          const cu = catmullRomValue(rPrev[k][0], r0[k][0], r1[k][0], rNext[k][0], f);
          const cv = catmullRomValue(rPrev[k][1], r0[k][1], r1[k][1], rNext[k][1], f);
          const minU = Math.min(r0[k][0], r1[k][0]) - 0.15;
          const maxU = Math.max(r0[k][0], r1[k][0]) + 0.15;
          const minV = Math.min(r0[k][1], r1[k][1]) - 0.15;
          const maxV = Math.max(r0[k][1], r1[k][1]) + 0.15;
          pts.push([clamp(cu, minU, maxU), clamp(cv, minV, maxV)]);
        }
      }
      rings.push({
        t,
        pts,
        sectionIndex: st === 0 ? i : st === spanSteps ? i + 1 : undefined,
      });
    }
  }

  // If max t < 1, extend top cap vertically to t = 1
  if (secs[secs.length - 1].t < 1 - 1e-4) {
    rings.push({
      t: 1,
      pts: baseRings[secs.length - 1].map(([u, v]) => [u, v]),
      sectionIndex: secs.length - 1,
    });
  }

  return rings;
}

export function getColumnLocalBounds(
  s: Pick<ParametricShape, 'shapeType' | 'prismSides' | 'triPrismCut' | 'colSections' | 'colInterp'>,
): { minU: number; maxU: number; minV: number; maxV: number } {
  const rings = buildColumnRings(s, 20, 24);
  if (rings.length === 0) {
    return { minU: 0, maxU: 1, minV: 0, maxV: 1 };
  }
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const r of rings) {
    for (const [u, v] of r.pts) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (!Number.isFinite(minU)) return { minU: 0, maxU: 1, minV: 0, maxV: 1 };
  return { minU, maxU, minV, maxV };
}
