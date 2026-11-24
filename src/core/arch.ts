// Pure 2D arch profile curve math, architectural arch presets, parallel/proportional/custom inner curves, and freehand fitting
import { clamp } from './color';

export type ArchNodeMode = 'smooth' | 'corner' | 'bezier';

export interface ArchNode {
  /** Normalized horizontal span across the arch face in [0, 1] (0 = left, 1 = right) */
  s: number;
  /** Normalized vertical elevation in [0, 1] (0 = ground z0, 1 = top z0 + heightPx) */
  h: number;
  mode: ArchNodeMode;
  inDs?: number;
  inDh?: number;
  outDs?: number;
  outDh?: number;
}

export type ArchHollowStyle = 'shell' | 'portal';

export type ArchInnerMode = 'parallel' | 'proportional' | 'equal_vertical' | 'custom';

export const ARCH_INNER_MODES: { id: ArchInnerMode; label: string; short: string; desc: string }[] = [
  {
    id: 'parallel',
    label: '平行等厚 (内圈与外圈平行 · 壁厚恒定)',
    short: '📏 平行等厚',
    desc: '内圈沿法线方向平行偏移，拱脚与拱顶壁厚始终恒定一致',
  },
  {
    id: 'proportional',
    label: '等比同心 (按几何比例缩放)',
    short: '🎯 等比同心',
    desc: '内圈与外圈围绕底面中心保持几何相似比例缩放',
  },
  {
    id: 'equal_vertical',
    label: '竖向等厚 (拱券竖直拱深恒定)',
    short: '🌉 竖向等厚',
    desc: '保持拱圈各处竖直方向厚度一致，适合石拱桥与城门券洞',
  },
  {
    id: 'custom',
    label: '自由控制点 (独立调整内圈曲线)',
    short: '✒️ 自由内圈',
    desc: '独立编辑内圈控制点、手柄、手绘或为内圈单独套用形状预设',
  },
];

export type ArchPresetId =
  | 'semicircle'
  | 'segmental'
  | 'pointed'
  | 'parabolic'
  | 'horseshoe'
  | 'ogee'
  | 'stilted'
  | 'trapezoid'
  | 'rect_door';

export const ARCH_PRESETS: { id: ArchPresetId; label: string }[] = [
  { id: 'semicircle', label: '半圆拱' },
  { id: 'segmental', label: '扁弧桥拱' },
  { id: 'pointed', label: '哥特尖拱' },
  { id: 'parabolic', label: '抛物线拱' },
  { id: 'horseshoe', label: '马蹄拱' },
  { id: 'ogee', label: '葱头拱' },
  { id: 'stilted', label: '直壁高拱' },
  { id: 'trapezoid', label: '折线平拱' },
  { id: 'rect_door', label: '方门平顶' },
];

export interface ArchBezierSegment {
  p0: [number, number];
  c1: [number, number];
  c2: [number, number];
  p1: [number, number];
}

export type ArchSurfaceTag = 'outer' | 'inner' | 'bottom' | 'top_flat' | 'side_wall';

export interface ArchBoundaryEdge {
  s0: number;
  h0: number;
  s1: number;
  h1: number;
  /** Cumulative normalized arc fraction [0, 1] along its contour for facade texture mapping */
  arc0: number;
  arc1: number;
  tag: ArchSurfaceTag;
}

export interface ArchCrossSection {
  /** Counter-clockwise closed 2D polygon in (s, h) space */
  poly: [number, number][];
  /** Boundary edges corresponding to poly[i] -> poly[i+1] */
  edges: ArchBoundaryEdge[];
  /** Sampled outer arch profile from left foot to right foot */
  outerPts: [number, number][];
  /** Sampled inner hollow cutout profile from left inner foot to right inner foot (null when solid) */
  innerPts: [number, number][] | null;
}

export interface ArchCrossSectionParams {
  outerNodes?: ArchNode[];
  hollow?: boolean;
  hollowStyle?: ArchHollowStyle;
  innerMode?: ArchInnerMode;
  thickness?: number;
  innerNodes?: ArchNode[];
  /** Physical arch span in vertical-equivalent pixels (spanCells * 18) */
  spanMetric?: number;
  /** Physical arch height in vertical pixels (heightPx) */
  heightMetric?: number;
  sampleCount?: number;
}

export function cloneArchNode(n: ArchNode): ArchNode {
  const copy: ArchNode = {
    s: n.s,
    h: n.h,
    mode: n.mode,
  };
  if (Number.isFinite(n.inDs)) copy.inDs = n.inDs;
  if (Number.isFinite(n.inDh)) copy.inDh = n.inDh;
  if (Number.isFinite(n.outDs)) copy.outDs = n.outDs;
  if (Number.isFinite(n.outDh)) copy.outDh = n.outDh;
  return copy;
}

export function cloneArchNodes(nodes: (ArchNode | null | undefined)[]): ArchNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n): n is ArchNode => Boolean(n && typeof n === 'object'))
    .map(cloneArchNode);
}

/**
 * Computes consistent arch profile sample count from physical span and height metrics
 * (independent of barrel extrusion depth).
 */
export function getArchSampleCount(spanMetric: number, heightMetric: number): number {
  const w = Math.max(4, Number.isFinite(spanMetric) ? spanMetric : 36);
  const h = Math.max(4, Number.isFinite(heightMetric) ? heightMetric : 24);
  return clamp(Math.round(w * 1.5 + h * 1.2), 64, 240);
}

export function createArchPresetNodes(id: ArchPresetId): ArchNode[] {
  const k = 0.55228475; // Exact cubic Bezier quarter-circle constant
  switch (id) {
    case 'semicircle':
      return [
        { s: 0, h: 0, mode: 'bezier', inDs: 0, inDh: 0, outDs: 0, outDh: k },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -0.5 * k, inDh: 0, outDs: 0.5 * k, outDh: 0 },
        { s: 1, h: 0, mode: 'bezier', inDs: 0, inDh: k, outDs: 0, outDh: 0 },
      ];

    case 'segmental':
      return [
        { s: 0, h: 0, mode: 'bezier', inDs: 0, inDh: 0, outDs: 0.12, outDh: 0.56 },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -0.24, inDh: 0, outDs: 0.24, outDh: 0 },
        { s: 1, h: 0, mode: 'bezier', inDs: -0.12, inDh: 0.56, outDs: 0, outDh: 0 },
      ];

    case 'pointed':
      return [
        { s: 0, h: 0, mode: 'bezier', inDs: 0, inDh: 0, outDs: 0, outDh: 0.46 },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -0.26, inDh: -0.16, outDs: 0.26, outDh: -0.16 },
        { s: 1, h: 0, mode: 'bezier', inDs: 0, inDh: 0.46, outDs: 0, outDh: 0 },
      ];

    case 'parabolic':
      return [
        { s: 0, h: 0, mode: 'bezier', inDs: 0, inDh: 0, outDs: 1 / 6, outDh: 2 / 3 },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -1 / 6, inDh: 0, outDs: 1 / 6, outDh: 0 },
        { s: 1, h: 0, mode: 'bezier', inDs: -1 / 6, inDh: 2 / 3, outDs: 0, outDh: 0 },
      ];

    case 'horseshoe':
      return [
        { s: 0.14, h: 0, mode: 'bezier', inDs: 0, inDh: 0, outDs: -0.11, outDh: 0.16 },
        { s: 0.02, h: 0.46, mode: 'bezier', inDs: 0, inDh: -0.20, outDs: 0, outDh: 0.30 },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -0.26, inDh: 0, outDs: 0.26, outDh: 0 },
        { s: 0.98, h: 0.46, mode: 'bezier', inDs: 0, inDh: 0.30, outDs: 0, outDh: -0.20 },
        { s: 0.86, h: 0, mode: 'bezier', inDs: 0.11, inDh: 0.16, outDs: 0, outDh: 0 },
      ];

    case 'ogee':
      return [
        { s: 0, h: 0, mode: 'bezier', inDs: 0, inDh: 0, outDs: 0, outDh: 0.34 },
        { s: 0.18, h: 0.62, mode: 'bezier', inDs: -0.14, inDh: -0.16, outDs: 0.16, outDh: 0.18 },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -0.06, inDh: -0.16, outDs: 0.06, outDh: -0.16 },
        { s: 0.82, h: 0.62, mode: 'bezier', inDs: -0.16, inDh: 0.18, outDs: 0.14, outDh: -0.16 },
        { s: 1, h: 0, mode: 'bezier', inDs: 0, inDh: 0.34, outDs: 0, outDh: 0 },
      ];

    case 'stilted':
      return [
        { s: 0, h: 0, mode: 'corner' },
        { s: 0, h: 0.46, mode: 'bezier', inDs: 0, inDh: -0.15, outDs: 0, outDh: 0.54 * k },
        { s: 0.5, h: 1, mode: 'bezier', inDs: -0.5 * k, inDh: 0, outDs: 0.5 * k, outDh: 0 },
        { s: 1, h: 0.46, mode: 'bezier', inDs: 0, inDh: 0.54 * k, outDs: 0, outDh: -0.15 },
        { s: 1, h: 0, mode: 'corner' },
      ];

    case 'trapezoid':
      return [
        { s: 0, h: 0, mode: 'corner' },
        { s: 0, h: 0.46, mode: 'corner' },
        { s: 0.28, h: 1, mode: 'corner' },
        { s: 0.72, h: 1, mode: 'corner' },
        { s: 1, h: 0.46, mode: 'corner' },
        { s: 1, h: 0, mode: 'corner' },
      ];

    case 'rect_door':
      return [
        { s: 0, h: 0, mode: 'corner' },
        { s: 0, h: 1, mode: 'corner' },
        { s: 1, h: 1, mode: 'corner' },
        { s: 1, h: 0, mode: 'corner' },
      ];
  }
}

/**
 * Creates scaled preset nodes suitable for an inner cutout curve inside an outer arch.
 */
export function createScaledInnerPresetNodes(
  id: ArchPresetId,
  thickness = 0.28,
  spanMetric = 36,
  heightMetric = 24,
): ArchNode[] {
  const base = createArchPresetNodes(id);
  const W = Math.max(4, spanMetric);
  const H = Math.max(4, heightMetric);
  const thick = clamp(thickness, 0.06, 0.78);
  const D = thick * Math.min(0.5 * W, H);
  const marginS = clamp(D / W, 0.04, 0.42);
  const maxH = clamp(1 - D / H, 0.16, 0.94);
  const scaleS = 1 - 2 * marginS;

  return base.map((nd) => {
    const out: ArchNode = {
      s: Math.round((marginS + nd.s * scaleS) * 1000) / 1000,
      h: Math.round(nd.h * maxH * 1000) / 1000,
      mode: nd.mode,
    };
    if (nd.mode === 'bezier') {
      out.inDs = Math.round((nd.inDs ?? 0) * scaleS * 1000) / 1000;
      out.inDh = Math.round((nd.inDh ?? 0) * maxH * 1000) / 1000;
      out.outDs = Math.round((nd.outDs ?? 0) * scaleS * 1000) / 1000;
      out.outDh = Math.round((nd.outDh ?? 0) * maxH * 1000) / 1000;
    }
    return out;
  });
}

export function sanitizeArchNodesInPlace(nodes: ArchNode[], isInner = false): void {
  let writeIdx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const raw = nodes[i] as ArchNode | null | undefined;
    if (raw && typeof raw === 'object') {
      nodes[writeIdx++] = raw;
    }
  }
  nodes.length = writeIdx;

  if (nodes.length < 2) {
    const def = isInner ? createScaledInnerPresetNodes('semicircle', 0.28) : createArchPresetNodes('semicircle');
    nodes.splice(0, nodes.length, ...def);
    return;
  }
  const minS = isInner ? 0.02 : 0;
  const maxS = isInner ? 0.98 : 1;
  const maxH = isInner ? 0.97 : 1;
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const minNodeH = i === 0 || i === nodes.length - 1 ? 0 : 0.02;
    nd.s = clamp(Number.isFinite(nd.s) ? nd.s : i / Math.max(1, nodes.length - 1), minS, maxS);
    nd.h = clamp(Number.isFinite(nd.h) ? nd.h : minNodeH, minNodeH, maxH);
    if (nd.mode !== 'smooth' && nd.mode !== 'corner' && nd.mode !== 'bezier') {
      nd.mode = 'smooth';
    }
    if (nd.mode === 'bezier') {
      nd.inDs = clamp(Number.isFinite(nd.inDs) ? nd.inDs! : -0.1, -0.8, 0.8);
      nd.inDh = clamp(Number.isFinite(nd.inDh) ? nd.inDh! : 0, -0.8, 0.8);
      nd.outDs = clamp(Number.isFinite(nd.outDs) ? nd.outDs! : 0.1, -0.8, 0.8);
      nd.outDh = clamp(Number.isFinite(nd.outDh) ? nd.outDh! : 0, -0.8, 0.8);
    }
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  first.h = 0;
  last.h = 0;
  const minSpan = isInner ? 0.08 : 0.12;
  first.s = clamp(first.s, minS, 0.46);
  last.s = clamp(last.s, Math.max(first.s + minSpan, 0.54), maxS);
}

export function normalizeArchNodes(nodes: (ArchNode | null | undefined)[] | undefined, isInner = false): ArchNode[] {
  const cloned = cloneArchNodes(Array.isArray(nodes) ? nodes : []);
  if (cloned.length < 2) {
    return isInner ? createScaledInnerPresetNodes('semicircle', 0.28) : createArchPresetNodes('semicircle');
  }
  sanitizeArchNodesInPlace(cloned, isInner);
  return cloned;
}

export function evaluateArchBezierSegments(rawNodes: ArchNode[], isInner = false): ArchBezierSegment[] {
  const nodes = normalizeArchNodes(rawNodes, isInner);
  const n = nodes.length;
  if (n < 2) return [];

  const tangents: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tangents[i] = [nodes[1].s - nodes[0].s, nodes[1].h - nodes[0].h];
    } else if (i === n - 1) {
      tangents[i] = [nodes[n - 1].s - nodes[n - 2].s, nodes[n - 1].h - nodes[n - 2].h];
    } else {
      tangents[i] = [
        (nodes[i + 1].s - nodes[i - 1].s) * 0.5,
        (nodes[i + 1].h - nodes[i - 1].h) * 0.5,
      ];
    }
  }

  const segs: ArchBezierSegment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const p0: [number, number] = [a.s, a.h];
    const p1: [number, number] = [b.s, b.h];

    let c1: [number, number];
    if (a.mode === 'corner') {
      c1 = [a.s + (b.s - a.s) / 3, a.h + (b.h - a.h) / 3];
    } else if (a.mode === 'bezier') {
      c1 = [a.s + (a.outDs ?? 0), a.h + (a.outDh ?? 0)];
    } else {
      c1 = [a.s + tangents[i][0] / 3, a.h + tangents[i][1] / 3];
    }

    let c2: [number, number];
    if (b.mode === 'corner') {
      c2 = [b.s - (b.s - a.s) / 3, b.h - (b.h - a.h) / 3];
    } else if (b.mode === 'bezier') {
      c2 = [b.s + (b.inDs ?? 0), b.h + (b.inDh ?? 0)];
    } else {
      c2 = [b.s - tangents[i + 1][0] / 3, b.h - tangents[i + 1][1] / 3];
    }

    segs.push({ p0, c1, c2, p1 });
  }

  return segs;
}

function resampleSpanUniform(dense: [number, number][], segSteps: number): [number, number][] {
  if (dense.length === 0) return [];
  if (dense.length === 1) {
    return Array.from({ length: segSteps + 1 }, () => [dense[0][0], dense[0][1]] as [number, number]);
  }
  const cumLen = new Float64Array(dense.length);
  for (let i = 1; i < dense.length; i++) {
    cumLen[i] = cumLen[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
  }
  const totalLen = cumLen[dense.length - 1];
  const count = Math.max(1, Math.round(segSteps));
  if (totalLen < 1e-8) {
    const out: [number, number][] = new Array(count + 1);
    for (let k = 0; k <= count; k++) {
      out[k] = [dense[0][0], dense[0][1]];
    }
    return out;
  }

  const out: [number, number][] = new Array(count + 1);
  out[0] = [dense[0][0], dense[0][1]];
  out[count] = [dense[dense.length - 1][0], dense[dense.length - 1][1]];

  let ptr = 0;
  for (let k = 1; k < count; k++) {
    const target = (k / count) * totalLen;
    while (ptr + 1 < dense.length - 1 && cumLen[ptr + 1] < target) {
      ptr++;
    }
    const segLen = cumLen[ptr + 1] - cumLen[ptr];
    const f = segLen > 1e-8 ? clamp((target - cumLen[ptr]) / segLen, 0, 1) : 0;
    out[k] = [
      dense[ptr][0] + (dense[ptr + 1][0] - dense[ptr][0]) * f,
      dense[ptr][1] + (dense[ptr + 1][1] - dense[ptr][1]) * f,
    ];
  }
  return out;
}

function resamplePolylineUniform(dense: [number, number][], sampleCount: number): [number, number][] {
  if (dense.length < 2) {
    return [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ];
  }
  return resampleSpanUniform(dense, Math.max(8, sampleCount));
}

/**
 * Samples an open arch profile into `sampleCount + 1` points from left foot to right foot,
 * allocating samples per smooth span so corner nodes and sharp cusps are preserved exact.
 */
export function sampleArchOuterCurve(
  rawNodes: ArchNode[] | undefined,
  sampleCount = 64,
  isInner = false,
): [number, number][] {
  const nodes = normalizeArchNodes(rawNodes, isInner);
  const segs = evaluateArchBezierSegments(nodes, isInner);
  if (segs.length === 0) {
    return [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ];
  }

  // Partition Bezier segments into smooth spans separated at corner nodes or tangent discontinuities
  const breakNodes: number[] = [0];
  for (let i = 1; i < nodes.length - 1; i++) {
    if (nodes[i].mode === 'corner') {
      breakNodes.push(i);
      continue;
    }
    const prevSeg = segs[i - 1];
    const nextSeg = segs[i];
    let inTx = prevSeg.p1[0] - prevSeg.c2[0];
    let inTy = prevSeg.p1[1] - prevSeg.c2[1];
    let inLen = Math.hypot(inTx, inTy);
    if (inLen < 1e-5) {
      inTx = prevSeg.p1[0] - prevSeg.p0[0];
      inTy = prevSeg.p1[1] - prevSeg.p0[1];
      inLen = Math.hypot(inTx, inTy);
    }
    let outTx = nextSeg.c1[0] - nextSeg.p0[0];
    let outTy = nextSeg.c1[1] - nextSeg.p0[1];
    let outLen = Math.hypot(outTx, outTy);
    if (outLen < 1e-5) {
      outTx = nextSeg.p1[0] - nextSeg.p0[0];
      outTy = nextSeg.p1[1] - nextSeg.p0[1];
      outLen = Math.hypot(outTx, outTy);
    }
    if (inLen > 1e-5 && outLen > 1e-5) {
      const cosA = (inTx * outTx + inTy * outTy) / (inLen * outLen);
      if (cosA < 0.975) {
        breakNodes.push(i);
      }
    }
  }
  breakNodes.push(segs.length);

  const stepsPerSeg = 24;
  const spansDense: [number, number][][] = [];
  const spanLens: number[] = [];
  let totalLen = 0;

  for (let b = 0; b < breakNodes.length - 1; b++) {
    const sa = breakNodes[b];
    const sb = breakNodes[b + 1];
    const spanPts: [number, number][] = [];
    for (let si = sa; si < sb; si++) {
      const seg = segs[si];
      const startStep = si === sa ? 0 : 1;
      for (let st = startStep; st <= stepsPerSeg; st++) {
        const t = st / stepsPerSeg;
        const mt = 1 - t;
        const s = clamp(
          mt ** 3 * seg.p0[0] +
            3 * mt ** 2 * t * seg.c1[0] +
            3 * mt * t ** 2 * seg.c2[0] +
            t ** 3 * seg.p1[0],
          0,
          1,
        );
        const h = clamp(
          mt ** 3 * seg.p0[1] +
            3 * mt ** 2 * t * seg.c1[1] +
            3 * mt * t ** 2 * seg.c2[1] +
            t ** 3 * seg.p1[1],
          0,
          1,
        );
        spanPts.push([s, h]);
      }
    }
    if (b === 0 && spanPts.length > 0) spanPts[0][1] = 0;
    if (b === breakNodes.length - 2 && spanPts.length > 0) spanPts[spanPts.length - 1][1] = 0;

    let slen = 0;
    for (let j = 1; j < spanPts.length; j++) {
      slen += Math.hypot(spanPts[j][0] - spanPts[j - 1][0], spanPts[j][1] - spanPts[j - 1][1]);
    }
    spansDense.push(spanPts);
    spanLens.push(slen);
    totalLen += slen;
  }

  if (totalLen < 1e-6) {
    return [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ];
  }

  const count = Math.max(8, sampleCount, spansDense.length);
  const ideal = spanLens.map((l) => Math.max(1, (l / totalLen) * count));
  const counts = ideal.map((v) => Math.max(1, Math.floor(v)));
  let assigned = counts.reduce((acc, v) => acc + v, 0);

  while (assigned < count) {
    let bestB = 0;
    let bestRem = -Infinity;
    for (let b = 0; b < counts.length; b++) {
      const rem = ideal[b] - counts[b];
      if (rem > bestRem) {
        bestRem = rem;
        bestB = b;
      }
    }
    counts[bestB]++;
    assigned++;
  }
  while (assigned > count) {
    let bestB = -1;
    let worstRem = Infinity;
    for (let b = 0; b < counts.length; b++) {
      if (counts[b] <= 1) continue;
      const rem = ideal[b] - counts[b];
      if (rem < worstRem) {
        worstRem = rem;
        bestB = b;
      }
    }
    if (bestB < 0) break;
    counts[bestB]--;
    assigned--;
  }

  const out: [number, number][] = [];
  for (let b = 0; b < spansDense.length; b++) {
    const spanSampled = resampleSpanUniform(spansDense[b], counts[b]);
    const startIdx = b === 0 ? 0 : 1;
    for (let k = startIdx; k < spanSampled.length; k++) {
      out.push(spanSampled[k]);
    }
  }
  out[0][1] = 0;
  out[out.length - 1][1] = 0;
  return out;
}

function segSegIntersect(
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): [number, number] | null {
  const rX = a1[0] - a0[0];
  const rY = a1[1] - a0[1];
  const sX = b1[0] - b0[0];
  const sY = b1[1] - b0[1];
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null;
  const qpX = b0[0] - a0[0];
  const qpY = b0[1] - a0[1];
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return [a0[0] + clamp(t, 0, 1) * rX, a0[1] + clamp(t, 0, 1) * rY];
  }
  return null;
}

/**
 * True constant-wall-thickness parallel inward offset in physical metric space (W_m, H_m),
 * with arc joins on convex turns, swallowtail self-intersection loop removal on concave cusps,
 * and exact ground clipping at Y = 0.
 */
function offsetOpenArchParallelMetric(
  outerPts: [number, number][],
  W: number,
  H: number,
  D: number,
  sampleCount: number,
): [number, number][] | null {
  const m = outerPts.length - 1;
  if (m < 2) return null;

  // Deduplicate near-coincident metric points and extend vertical ground legs below Y = 0
  const yExt = -2.5 * D - 2;
  const extPts: [number, number][] = [[outerPts[0][0] * W, yExt]];
  for (let i = 0; i <= m; i++) {
    const px = outerPts[i][0] * W;
    const py = outerPts[i][1] * H;
    const last = extPts[extPts.length - 1];
    if (Math.hypot(px - last[0], py - last[1]) > 1e-4) {
      extPts.push([px, py]);
    }
  }
  extPts.push([outerPts[m][0] * W, yExt]);
  if (extPts.length < 4) return null;

  const segCount = extPts.length - 1;
  const tx = new Float64Array(segCount);
  const ty = new Float64Array(segCount);
  const nx = new Float64Array(segCount);
  const ny = new Float64Array(segCount);

  for (let i = 0; i < segCount; i++) {
    const dx = extPts[i + 1][0] - extPts[i][0];
    const dy = extPts[i + 1][1] - extPts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len;
    ty[i] = dy / len;
    // Inward right-hand normal for left-to-right arch
    nx[i] = ty[i];
    ny[i] = -tx[i];
  }

  const rawOffset: [number, number][] = [];
  const pushUnique = (x: number, y: number) => {
    const last = rawOffset[rawOffset.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-4) {
      rawOffset.push([x, y]);
    }
  };

  for (let i = 0; i < segCount; i++) {
    if (i > 0) {
      const vx = extPts[i][0];
      const vy = extPts[i][1];
      const cross = tx[i - 1] * ty[i] - ty[i - 1] * tx[i];
      if (cross > 1e-3) {
        // Convex inward turn (normals fan apart, e.g. horseshoe base): bridge with circular arc of radius D
        const a0 = Math.atan2(ny[i - 1], nx[i - 1]);
        let a1 = Math.atan2(ny[i], nx[i]);
        while (a1 < a0) a1 += Math.PI * 2;
        const sweep = Math.min(Math.PI, a1 - a0);
        const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 12)));
        for (let st = 1; st < steps; st++) {
          const ang = a0 + (sweep * st) / steps;
          pushUnique(vx + Math.cos(ang) * D, vy + Math.sin(ang) * D);
        }
      }
    }
    pushUnique(extPts[i][0] + nx[i] * D, extPts[i][1] + ny[i] * D);
    pushUnique(extPts[i + 1][0] + nx[i] * D, extPts[i + 1][1] + ny[i] * D);
  }

  // Remove swallowtail self-intersection loops (scanning from end backward so outermost crossing wins)
  for (let i = 0; i < rawOffset.length - 1; i++) {
    const a0 = rawOffset[i];
    const a1 = rawOffset[i + 1];
    const aMinX = Math.min(a0[0], a1[0]);
    const aMaxX = Math.max(a0[0], a1[0]);
    const aMinY = Math.min(a0[1], a1[1]);
    const aMaxY = Math.max(a0[1], a1[1]);
    for (let j = rawOffset.length - 2; j >= i + 2; j--) {
      const b0 = rawOffset[j];
      const b1 = rawOffset[j + 1];
      if (
        aMaxX < Math.min(b0[0], b1[0]) - 1e-6 ||
        Math.max(b0[0], b1[0]) < aMinX - 1e-6 ||
        aMaxY < Math.min(b0[1], b1[1]) - 1e-6 ||
        Math.max(b0[1], b1[1]) < aMinY - 1e-6
      ) {
        continue;
      }
      const hit = segSegIntersect(a0, a1, b0, b1);
      if (hit) {
        rawOffset.splice(i + 1, j - i, hit);
        break;
      }
    }
  }

  // Clip polyline against ground Y >= 0: find first upward crossing of Y = 0 and last downward crossing of Y = 0
  let enterIdx = -1;
  let enterPt: [number, number] | null = null;
  for (let i = 0; i < rawOffset.length - 1; i++) {
    const y0 = rawOffset[i][1];
    const y1 = rawOffset[i + 1][1];
    if (y0 <= 1e-5 && y1 > 1e-5) {
      const f = clamp((0 - y0) / (y1 - y0), 0, 1);
      enterIdx = i + 1;
      enterPt = [rawOffset[i][0] + (rawOffset[i + 1][0] - rawOffset[i][0]) * f, 0];
      break;
    }
  }

  let exitIdx = -1;
  let exitPt: [number, number] | null = null;
  for (let i = rawOffset.length - 2; i >= 0; i--) {
    const y0 = rawOffset[i][1];
    const y1 = rawOffset[i + 1][1];
    if (y0 > 1e-5 && y1 <= 1e-5) {
      const f = clamp((0 - y0) / (y1 - y0), 0, 1);
      exitIdx = i;
      exitPt = [rawOffset[i][0] + (rawOffset[i + 1][0] - rawOffset[i][0]) * f, 0];
      break;
    }
  }

  if (!enterPt || !exitPt || enterIdx < 0 || exitIdx < enterIdx - 1) return null;
  if (exitPt[0] - enterPt[0] < 0.03 * W) return null;

  const clippedNorm: [number, number][] = [[clamp(enterPt[0] / W, 0.01, 0.99), 0]];
  let peakH = 0;
  for (let i = enterIdx; i <= exitIdx; i++) {
    const ns = clamp(rawOffset[i][0] / W, 0.01, 0.99);
    const nh = clamp(Math.max(0, rawOffset[i][1]) / H, 0, 0.98);
    if (nh > peakH) peakH = nh;
    clippedNorm.push([ns, nh]);
  }
  clippedNorm.push([clamp(exitPt[0] / W, 0.01, 0.99), 0]);

  if (peakH < 0.03) return null;
  const resampled = resamplePolylineUniform(clippedNorm, sampleCount);
  resampled[0][1] = 0;
  resampled[resampled.length - 1][1] = 0;
  return resampled;
}

/**
 * Clamps an inner arch curve so it stays strictly inside `outerPts` (for 'shell' mode)
 * or strictly inside `[0..1]x[0..1]` (for 'portal' mode), preventing self-intersecting 3D walls.
 */
function clampInnerCurveInsideOuter(
  innerPts: [number, number][],
  outerPts: [number, number][],
  hollowStyle: ArchHollowStyle,
  spanMetric = 36,
  heightMetric = 24,
): [number, number][] {
  const m = innerPts.length - 1;
  if (m < 1) return innerPts;

  const minMetric = Math.max(4, Math.min(spanMetric, heightMetric));
  const minMargin = clamp(Math.max(0.02, 1.25 / minMetric), 0.02, 0.14);

  if (hollowStyle === 'portal') {
    const out: [number, number][] = innerPts.map(([s, h]) => [
      clamp(s, minMargin, 1 - minMargin),
      clamp(h, 0, Math.min(0.97, 1 - minMargin)),
    ]);
    out[0][1] = 0;
    out[m][1] = 0;
    if (out[m][0] < out[0][0] + 0.04) {
      const mid = clamp(0.5 * (out[0][0] + out[m][0]), 0.06, 0.94);
      out[0][0] = mid - 0.02;
      out[m][0] = mid + 0.02;
    }
    return out;
  }

  // Build angular radial envelope R_out(theta) around outer base midpoint (sMid, 0)
  // while tracking true full-contour min/max s bounds (preserving outward horseshoe bellies)
  const om = outerPts.length - 1;
  const sOutL = outerPts[0][0];
  const sOutR = outerPts[om][0];
  let outerMinS = sOutL;
  let outerMaxS = sOutR;
  for (let i = 0; i <= om; i++) {
    if (outerPts[i][0] < outerMinS) outerMinS = outerPts[i][0];
    if (outerPts[i][0] > outerMaxS) outerMaxS = outerPts[i][0];
  }
  const sMid = 0.5 * (sOutL + sOutR);
  const bins = 180;
  const rEnv = new Float64Array(bins + 1);
  rEnv.fill(Infinity);

  for (let i = 0; i < om; i++) {
    const x0 = outerPts[i][0] - sMid;
    const y0 = Math.max(0, outerPts[i][1]);
    const x1 = outerPts[i + 1][0] - sMid;
    const y1 = Math.max(0, outerPts[i + 1][1]);
    for (let st = 0; st <= 4; st++) {
      const f = st / 4;
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f;
      const r = Math.hypot(x, y);
      const ang = clamp(Math.atan2(y, x), 0, Math.PI);
      const bi = Math.round((ang / Math.PI) * bins);
      if (r < rEnv[bi]) rEnv[bi] = r;
    }
  }
  // Fill any empty angular bins from neighbors
  let lastValid = Math.max(0.05, sMid - outerMinS);
  for (let b = 0; b <= bins; b++) {
    if (Number.isFinite(rEnv[b])) lastValid = rEnv[b];
    else rEnv[b] = lastValid;
  }

  const maxHAllowed = Math.min(0.97, 1 - minMargin * 0.5);
  const sClampMin = Math.min(outerMinS + minMargin, sMid - 0.01);
  const sClampMax = Math.max(outerMaxS - minMargin, sMid + 0.01);

  const out: [number, number][] = innerPts.map(([s, h]) => {
    const dx = s - sMid;
    const dy = Math.max(0, h);
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return [sMid, 0];
    const ang = clamp(Math.atan2(dy, dx), 0, Math.PI);
    const bf = (ang / Math.PI) * bins;
    const b0 = Math.floor(bf);
    const b1 = Math.min(bins, b0 + 1);
    const maxR = Math.max(0.015, rEnv[b0] + (rEnv[b1] - rEnv[b0]) * (bf - b0) - minMargin);
    if (r > maxR) {
      return [
        clamp(sMid + (dx / r) * maxR, sClampMin, sClampMax),
        clamp((dy / r) * maxR, 0, maxHAllowed),
      ];
    }
    return [clamp(s, sClampMin, sClampMax), clamp(dy, 0, maxHAllowed)];
  });

  out[0][1] = 0;
  out[m][1] = 0;
  out[0][0] = clamp(out[0][0], sOutL + minMargin, Math.max(sOutL + minMargin, sOutR - minMargin * 2));
  out[m][0] = clamp(out[m][0], out[0][0] + minMargin, Math.max(out[0][0] + minMargin, sOutR - minMargin));
  return out;
}

/**
 * Computes the sampled inner arch curve according to `innerMode`:
 * - `'parallel'`: true constant normal thickness in physical metric space
 * - `'proportional'`: homothetic scaling toward base midpoint
 * - `'equal_vertical'`: uniform vertical arch ring depth
 * - `'custom'`: independent `innerNodes` Bezier spline clamped safely inside outer boundary
 */
export function sampleArchInnerCurve(
  outerPts: [number, number][],
  thickness: number,
  hollowStyle: ArchHollowStyle,
  innerMode: ArchInnerMode = 'parallel',
  innerNodes?: ArchNode[],
  spanMetric = 36,
  heightMetric = 24,
): [number, number][] {
  const m = outerPts.length - 1;
  if (m < 2) return outerPts.map(([s, h]) => [s, h]);

  const W = Math.max(4, spanMetric);
  const H = Math.max(4, heightMetric);
  const thick = clamp(Number.isFinite(thickness) ? thickness : 0.28, 0.06, 0.78);

  if (innerMode === 'custom' && innerNodes && innerNodes.length >= 2) {
    const rawCustom = sampleArchOuterCurve(innerNodes, m, true);
    return clampInnerCurveInsideOuter(rawCustom, outerPts, hollowStyle, W, H);
  }

  if (innerMode === 'parallel') {
    const sSpan = Math.max(0.15, outerPts[m][0] - outerPts[0][0]);
    let origMaxH = 0.1;
    for (const [, h] of outerPts) if (h > origMaxH) origMaxH = h;
    const D = thick * Math.min(0.5 * sSpan * W, origMaxH * H);
    const par = offsetOpenArchParallelMetric(outerPts, W, H, D, m);
    if (par) {
      if (hollowStyle === 'portal') {
        const minSide = clamp(D / W, 0.03, 0.44);
        const maxTop = clamp(1 - D / H, 0.12, 0.96);
        const portalClamped: [number, number][] = par.map(([s, h]) => [
          clamp(s, minSide, 1 - minSide),
          clamp(h, 0, maxTop),
        ]);
        portalClamped[0][1] = 0;
        portalClamped[portalClamped.length - 1][1] = 0;
        return portalClamped;
      }
      return clampInnerCurveInsideOuter(par, outerPts, hollowStyle, W, H);
    }
    // Fallback to proportional if D exceeds maximum possible offset
  }

  if (innerMode === 'equal_vertical') {
    const sOutL = hollowStyle === 'portal' ? 0 : outerPts[0][0];
    const sOutR = hollowStyle === 'portal' ? 1 : outerPts[m][0];
    const D = thick * Math.min(0.5 * W, H);
    const pierS = clamp(D / W, 0.03, 0.42);
    const vertDropH = clamp((D * 1.1) / H, 0.05, 0.82);
    const inL = sOutL + pierS;
    const inR = Math.max(inL + 0.06, sOutR - pierS);

    // Build height lookup h_out(s) along outerPts
    const evalOuterHAtS = (sQuery: number): number => {
      let bestH = 0;
      for (let i = 0; i < m; i++) {
        const [s0, h0] = outerPts[i];
        const [s1, h1] = outerPts[i + 1];
        const lo = s0 < s1 ? s0 : s1;
        const hi = s0 < s1 ? s1 : s0;
        if (hi < sQuery - 1e-5 || lo > sQuery + 1e-5) continue;
        if (hi - lo > 1e-6) {
          const t = clamp((sQuery - s0) / (s1 - s0), 0, 1);
          const hv = h0 + (h1 - h0) * t;
          if (hv > bestH) bestH = hv;
        }
      }
      return bestH;
    };

    const rawVert: [number, number][] = [];
    for (let i = 0; i <= m; i++) {
      const f = i / m;
      const s = inL + (inR - inL) * f;
      const hOut = evalOuterHAtS(s);
      const hIn = i === 0 || i === m ? 0 : Math.max(0, hOut - vertDropH);
      rawVert.push([s, hIn]);
    }
    const resampled = resamplePolylineUniform(rawVert, m);
    resampled[0] = [inL, 0];
    resampled[m] = [inR, 0];
    return clampInnerCurveInsideOuter(resampled, outerPts, hollowStyle, W, H);
  }

  // 'proportional' mode (homothetic contraction toward base midpoint)
  const scale = 1 - thick;
  if (hollowStyle === 'portal') {
    const sMid = 0.5;
    const minMarginS = Math.max(0.03, thick * 0.5);
    const maxOpenH = clamp(1 - thick * 0.85, 0.15, 0.94);
    let origMinS = Infinity;
    let origMaxS = -Infinity;
    let origMaxH = 1e-4;
    for (const [s, h] of outerPts) {
      if (s < origMinS) origMinS = s;
      if (s > origMaxS) origMaxS = s;
      if (h > origMaxH) origMaxH = h;
    }
    const halfSpan = Math.max(0.1, Math.max(sMid - origMinS, origMaxS - sMid));
    const targetHalfSpan = Math.max(0.06, 0.5 - minMarginS);
    const sScale = Math.min(scale, targetHalfSpan / halfSpan);
    const hScale = Math.min(scale, maxOpenH / origMaxH);

    const inner: [number, number][] = outerPts.map(([s, h]) => [
      clamp(sMid + (s - sMid) * sScale, minMarginS, 1 - minMarginS),
      clamp(h * hScale, 0, maxOpenH),
    ]);
    inner[0][1] = 0;
    inner[m][1] = 0;
    return inner;
  }

  const sMid = 0.5 * (outerPts[0][0] + outerPts[m][0]);
  const inner: [number, number][] = outerPts.map(([s, h]) => [
    clamp(sMid + (s - sMid) * scale, 0.01, 0.99),
    clamp(h * scale, 0, 0.98),
  ]);
  inner[0][1] = 0;
  inner[m][1] = 0;
  return clampInnerCurveInsideOuter(inner, outerPts, hollowStyle, W, H);
}

/**
 * Fits clean editable cubic Bezier `ArchNode[]` to a sampled inner curve (e.g. when unlocking
 * a parallel/proportional inner curve into `'custom'` mode) with exact corner & kappa recovery.
 */
export function fitEditableNodesFromInnerCurve(innerPts: [number, number][]): ArchNode[] {
  const m = innerPts.length - 1;
  if (m < 4) return createScaledInnerPresetNodes('semicircle', 0.28);

  // 1. Identify sharp interior corners
  const breaks: number[] = [0];
  for (let i = 3; i <= m - 3; i++) {
    const v1x = innerPts[i][0] - innerPts[i - 2][0];
    const v1y = innerPts[i][1] - innerPts[i - 2][1];
    const v2x = innerPts[i + 2][0] - innerPts[i][0];
    const v2y = innerPts[i + 2][1] - innerPts[i][1];
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const cosA = (v1x * v2x + v1y * v2y) / (l1 * l2);
    if (cosA < 0.88 && i - breaks[breaks.length - 1] >= 4) {
      breaks.push(i);
    }
  }
  breaks.push(m);

  // 2. Subdivide long smooth spans at crown / inflection stations so 3..5 nodes capture any arch cleanly
  const stations: { idx: number; isCorner: boolean }[] = [];
  for (let b = 0; b < breaks.length - 1; b++) {
    const ia = breaks[b];
    const ib = breaks[b + 1];
    stations.push({ idx: ia, isCorner: b > 0 });
    const span = ib - ia;
    if (span >= Math.round(m * 0.72)) {
      // Full-arch smooth span: check if s bulges outward near base (horseshoe/ogee) -> 4 segments, else 2 segments at crown
      const minS = Math.min(...innerPts.slice(ia, ib + 1).map((p) => p[0]));
      const hasBulge = minS < innerPts[ia][0] - 0.015;
      if (hasBulge) {
        stations.push({ idx: Math.round(ia + span * 0.25), isCorner: false });
        stations.push({ idx: Math.round(ia + span * 0.5), isCorner: false });
        stations.push({ idx: Math.round(ia + span * 0.75), isCorner: false });
      } else {
        let crownIdx = Math.round((ia + ib) * 0.5);
        let bestH = -1;
        for (let k = ia + 2; k <= ib - 2; k++) {
          if (innerPts[k][1] > bestH) {
            bestH = innerPts[k][1];
            crownIdx = k;
          }
        }
        stations.push({ idx: crownIdx, isCorner: false });
      }
    } else if (span >= Math.round(m * 0.45)) {
      stations.push({ idx: Math.round((ia + ib) * 0.5), isCorner: false });
    }
  }
  stations.push({ idx: m, isCorner: false });

  const nodes: ArchNode[] = stations.map((st) => ({
    s: Math.round(innerPts[st.idx][0] * 1000) / 1000,
    h: Math.round(innerPts[st.idx][1] * 1000) / 1000,
    mode: 'bezier' as ArchNodeMode,
    inDs: 0,
    inDh: 0,
    outDs: 0,
    outDh: 0,
  }));

  // 3. Fit exact midpoint-interpolating cubic Bezier handles on each span
  const spanStraight: boolean[] = new Array(Math.max(0, stations.length - 1)).fill(false);
  for (let k = 0; k < stations.length - 1; k++) {
    const ia = stations[k].idx;
    const ib = stations[k + 1].idx;
    const p0 = innerPts[ia];
    const p1 = innerPts[ib];
    const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (chord < 1e-5) continue;

    // Check straightness
    const midIdx = Math.round((ia + ib) * 0.5);
    const pMid = innerPts[midIdx];
    const lineMidS = 0.5 * (p0[0] + p1[0]);
    const lineMidH = 0.5 * (p0[1] + p1[1]);
    const dev = Math.hypot(pMid[0] - lineMidS, pMid[1] - lineMidH);

    if (dev < 0.003 * chord) {
      spanStraight[k] = true;
      nodes[k].outDs = Math.round(((p1[0] - p0[0]) / 3) * 1000) / 1000;
      nodes[k].outDh = Math.round(((p1[1] - p0[1]) / 3) * 1000) / 1000;
      nodes[k + 1].inDs = Math.round((-(p1[0] - p0[0]) / 3) * 1000) / 1000;
      nodes[k + 1].inDh = Math.round((-(p1[1] - p0[1]) / 3) * 1000) / 1000;
      continue;
    }

    const step = Math.max(1, Math.min(2, ib - ia));
    const d0x = innerPts[ia + step][0] - p0[0];
    const d0y = innerPts[ia + step][1] - p0[1];
    const l0 = Math.hypot(d0x, d0y) || 1;
    const t0x = d0x / l0;
    const t0y = d0y / l0;

    const d1x = p1[0] - innerPts[ib - step][0];
    const d1y = p1[1] - innerPts[ib - step][1];
    const l1 = Math.hypot(d1x, d1y) || 1;
    const t1x = d1x / l1;
    const t1y = d1y / l1;

    // Solve 0.375 * alpha * (T0 - T1) ≈ P_mid - 0.5*(P0 + P1)
    const vx = t0x - t1x;
    const vy = t0y - t1y;
    const vLen2 = vx * vx + vy * vy;
    let arcLen = 0;
    for (let j = ia; j < ib; j++) {
      arcLen += Math.hypot(innerPts[j + 1][0] - innerPts[j][0], innerPts[j + 1][1] - innerPts[j][1]);
    }
    let alpha = arcLen / 3;
    if (vLen2 > 1e-3) {
      const proj = ((pMid[0] - lineMidS) * vx + (pMid[1] - lineMidH) * vy) / (0.375 * vLen2);
      if (proj > 0.05 * chord && proj < 0.85 * arcLen) {
        alpha = proj;
      }
    }

    nodes[k].outDs = Math.round(t0x * alpha * 1000) / 1000;
    nodes[k].outDh = Math.round(t0y * alpha * 1000) / 1000;
    nodes[k + 1].inDs = Math.round(-t1x * alpha * 1000) / 1000;
    nodes[k + 1].inDh = Math.round(-t1y * alpha * 1000) / 1000;
  }

  // Respect sharp corner detection on straight-edge junctions
  for (let k = 0; k < nodes.length; k++) {
    const leftStraight = k === 0 ? true : spanStraight[k - 1];
    const rightStraight = k === nodes.length - 1 ? true : spanStraight[k];
    if (leftStraight && rightStraight && (stations[k].isCorner || k === 0 || k === nodes.length - 1)) {
      nodes[k].mode = 'corner';
      delete nodes[k].inDs;
      delete nodes[k].inDh;
      delete nodes[k].outDs;
      delete nodes[k].outDh;
    }
  }

  sanitizeArchNodesInPlace(nodes, true);
  return nodes;
}

const ARCH_CS_CACHE_LIMIT = 128;
const archCrossSectionCache = new Map<string, ArchCrossSection>();

function serializeArchNodesKey(nodes: ArchNode[] | undefined): string {
  if (!Array.isArray(nodes) || nodes.length === 0) return 'def';
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    if (!nd || typeof nd !== 'object') {
      out += 'x;';
      continue;
    }
    out += `${Math.round(nd.s * 1e5)},${Math.round(nd.h * 1e5)},${nd.mode}`;
    if (nd.mode === 'bezier') {
      out += `,${Math.round((nd.inDs ?? 0) * 1e5)},${Math.round((nd.inDh ?? 0) * 1e5)},${Math.round((nd.outDs ?? 0) * 1e5)},${Math.round((nd.outDh ?? 0) * 1e5)}`;
    }
    out += ';';
  }
  return out;
}

/**
 * Builds the watertight CCW 2D cross-section polygon and tagged boundary edges for 3D barrel extrusion.
 * Cached by quantized geometry + metric dimensions in a bounded LRU cache.
 */
export function buildArchCrossSection(params: ArchCrossSectionParams): ArchCrossSection {
  const {
    outerNodes,
    hollow = false,
    hollowStyle = 'shell',
    innerMode = 'parallel',
    thickness = 0.28,
    innerNodes,
    spanMetric = 36,
    heightMetric = 24,
    sampleCount = 64,
  } = params;

  const wM = Math.max(4, Number.isFinite(spanMetric) ? spanMetric : 36);
  const hM = Math.max(4, Number.isFinite(heightMetric) ? heightMetric : 24);
  const sCnt = Math.max(8, Math.round(sampleCount));
  const thick = clamp(Number.isFinite(thickness) ? thickness : 0.28, 0.06, 0.78);
  const cacheKey = `${serializeArchNodesKey(outerNodes)}|${hollow ? 1 : 0}|${hollow ? hollowStyle : '-'}|${hollow ? innerMode : '-'}|${hollow && innerMode !== 'custom' ? Math.round(thick * 1e4) : 0}|${hollow && innerMode === 'custom' ? serializeArchNodesKey(innerNodes) : '-'}|${Math.round(wM * 100)}|${Math.round(hM * 100)}|${sCnt}`;

  const cached = archCrossSectionCache.get(cacheKey);
  if (cached) {
    archCrossSectionCache.delete(cacheKey);
    archCrossSectionCache.set(cacheKey, cached);
    return cached;
  }

  const outerPts = sampleArchOuterCurve(outerNodes, sCnt, false);
  const m = outerPts.length - 1;

  const outerArc = new Float64Array(m + 1);
  for (let i = 1; i <= m; i++) {
    outerArc[i] = outerArc[i - 1] + Math.hypot(outerPts[i][0] - outerPts[i - 1][0], outerPts[i][1] - outerPts[i - 1][1]);
  }
  const outerTotal = Math.max(1e-6, outerArc[m]);

  const poly: [number, number][] = [];
  const edges: ArchBoundaryEdge[] = [];

  const pushEdge = (
    s0: number,
    h0: number,
    s1: number,
    h1: number,
    arc0: number,
    arc1: number,
    tag: ArchSurfaceTag,
  ) => {
    if (Math.hypot(s1 - s0, h1 - h0) < 1e-6) return;
    poly.push([s0, h0]);
    edges.push({ s0, h0, s1, h1, arc0, arc1, tag });
  };

  let result: ArchCrossSection;

  if (!hollow) {
    pushEdge(outerPts[0][0], 0, outerPts[m][0], 0, 0, 1, 'bottom');
    for (let i = m; i > 0; i--) {
      pushEdge(
        outerPts[i][0],
        outerPts[i][1],
        outerPts[i - 1][0],
        outerPts[i - 1][1],
        outerArc[i] / outerTotal,
        outerArc[i - 1] / outerTotal,
        'outer',
      );
    }
    result = { poly, edges, outerPts, innerPts: null };
  } else {
    const innerPts = sampleArchInnerCurve(
      outerPts,
      thick,
      hollowStyle,
      innerMode,
      innerNodes,
      wM,
      hM,
    );
    const im = innerPts.length - 1;
    const innerArc = new Float64Array(im + 1);
    for (let i = 1; i <= im; i++) {
      innerArc[i] = innerArc[i - 1] + Math.hypot(innerPts[i][0] - innerPts[i - 1][0], innerPts[i][1] - innerPts[i - 1][1]);
    }
    const innerTotal = Math.max(1e-6, innerArc[im]);

    if (hollowStyle === 'portal') {
      pushEdge(0, 0, innerPts[0][0], 0, 0, 1, 'bottom');
      for (let i = 0; i < im; i++) {
        pushEdge(
          innerPts[i][0],
          innerPts[i][1],
          innerPts[i + 1][0],
          innerPts[i + 1][1],
          innerArc[i] / innerTotal,
          innerArc[i + 1] / innerTotal,
          'inner',
        );
      }
      pushEdge(innerPts[im][0], 0, 1, 0, 0, 1, 'bottom');
      pushEdge(1, 0, 1, 1, 0, 1, 'side_wall');
      pushEdge(1, 1, 0, 1, 1, 0, 'top_flat');
      pushEdge(0, 1, 0, 0, 1, 0, 'side_wall');
      result = { poly, edges, outerPts, innerPts };
    } else {
      pushEdge(outerPts[0][0], 0, innerPts[0][0], 0, 0, 1, 'bottom');
      for (let i = 0; i < im; i++) {
        pushEdge(
          innerPts[i][0],
          innerPts[i][1],
          innerPts[i + 1][0],
          innerPts[i + 1][1],
          innerArc[i] / innerTotal,
          innerArc[i + 1] / innerTotal,
          'inner',
        );
      }
      pushEdge(innerPts[im][0], 0, outerPts[m][0], 0, 0, 1, 'bottom');
      for (let i = m; i > 0; i--) {
        pushEdge(
          outerPts[i][0],
          outerPts[i][1],
          outerPts[i - 1][0],
          outerPts[i - 1][1],
          outerArc[i] / outerTotal,
          outerArc[i - 1] / outerTotal,
          'outer',
        );
      }
      result = { poly, edges, outerPts, innerPts };
    }
  }

  if (archCrossSectionCache.size >= ARCH_CS_CACHE_LIMIT) {
    const oldest = archCrossSectionCache.keys().next().value;
    if (oldest !== undefined) archCrossSectionCache.delete(oldest);
  }
  archCrossSectionCache.set(cacheKey, result);
  return result;
}

function rdpSimplifyOpen(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;

  let maxDist = -1;
  let maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    let d: number;
    if (len2 < 1e-10) {
      d = Math.hypot(px - x1, py - y1);
    } else {
      const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
      d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > eps) {
    const left = rdpSimplifyOpen(pts.slice(0, maxIdx + 1), eps);
    const right = rdpSimplifyOpen(pts.slice(maxIdx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0], pts[pts.length - 1]];
}

/**
 * Fits an open arch control curve from a user's single-stroke freehand polyline in (s, h) space,
 * reporting whether the stroke was too degenerate and fell back to a default semicircle.
 */
export function fitFreehandArchNodesWithMeta(
  rawPts: [number, number][],
  maxNodes = 9,
  isInner = false,
): { nodes: ArchNode[]; usedFallback: boolean } {
  const mkFallback = (): { nodes: ArchNode[]; usedFallback: boolean } => ({
    nodes: isInner ? createScaledInnerPresetNodes('semicircle', 0.28) : createArchPresetNodes('semicircle'),
    usedFallback: true,
  });

  if (rawPts.length < 3) return mkFallback();

  const minS = isInner ? 0.03 : 0;
  const maxS = isInner ? 0.97 : 1;
  const maxH = isInner ? 0.95 : 1;
  const pts: [number, number][] = [];
  for (const [rs, rh] of rawPts) {
    const cs = clamp(rs, minS, maxS);
    const ch = clamp(rh, 0, maxH);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(cs - last[0], ch - last[1]) >= 0.01) {
      pts.push([cs, ch]);
    }
  }
  if (pts.length < 3) return mkFallback();
  if (pts[0][0] > pts[pts.length - 1][0]) {
    pts.reverse();
  }

  let spanLo = Infinity;
  let spanHi = -Infinity;
  let maxPeak = 0;
  for (const [ps, ph] of pts) {
    if (ps < spanLo) spanLo = ps;
    if (ps > spanHi) spanHi = ps;
    if (ph > maxPeak) maxPeak = ph;
  }
  if (spanHi - spanLo < 0.08 || maxPeak < 0.05) {
    return mkFallback();
  }

  let eps = 0.025;
  let simp = rdpSimplifyOpen(pts, eps);
  while (simp.length > maxNodes && eps < 0.16) {
    eps *= 1.35;
    simp = rdpSimplifyOpen(pts, eps);
  }
  if (simp.length < 3) {
    return mkFallback();
  }

  simp[0] = [clamp(simp[0][0], minS, 0.44), 0];
  simp[simp.length - 1] = [clamp(simp[simp.length - 1][0], Math.max(simp[0][0] + 0.12, 0.56), maxS), 0];

  const nodes: ArchNode[] = simp.map(([s, h], i) => {
    if (i === 0 || i === simp.length - 1) {
      return { s, h: 0, mode: 'smooth' };
    }
    const prev = simp[i - 1];
    const next = simp[i + 1];
    const v1x = s - prev[0];
    const v1y = h - prev[1];
    const v2x = next[0] - s;
    const v2y = next[1] - h;
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const cosA = (v1x * v2x + v1y * v2y) / (l1 * l2);
    return {
      s,
      h: Math.max(0.02, h),
      mode: cosA < 0.42 ? 'corner' : 'smooth',
    };
  });

  sanitizeArchNodesInPlace(nodes, isInner);
  return { nodes, usedFallback: false };
}

export function fitFreehandArchNodes(rawPts: [number, number][], maxNodes = 9, isInner = false): ArchNode[] {
  return fitFreehandArchNodesWithMeta(rawPts, maxNodes, isInner).nodes;
}

// ---------------- Control-Point Trajectory Slide Rail & Handle Scaling ----------------

export interface ArchSlideRailSample {
  s: number;
  h: number;
  arcS: number;
  tanS: number;
  tanH: number;
}

export interface ArchSlideRail {
  samples: ArchSlideRailSample[];
  minArcS: number;
  maxArcS: number;
  origS: number;
  origH: number;
  origTanS: number;
  origTanH: number;
  isFoot: 'first' | 'last' | null;
  chordInOrig: number;
  chordOutOrig: number;
  isStraightIn: boolean;
  isStraightOut: boolean;
  filletCorner?: [number, number];
}

function archUnitVec(ds: number, dh: number, fallbackS = 1, fallbackH = 0): [number, number] {
  const len = Math.hypot(ds, dh);
  if (len > 1e-7) return [ds / len, dh / len];
  const fl = Math.hypot(fallbackS, fallbackH);
  return fl > 1e-7 ? [fallbackS / fl, fallbackH / fl] : [1, 0];
}

function evalArchCubic(seg: ArchBezierSegment, t: number): [number, number] {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return [
    mt2 * mt * seg.p0[0] + 3 * mt2 * t * seg.c1[0] + 3 * mt * t2 * seg.c2[0] + t2 * t * seg.p1[0],
    mt2 * mt * seg.p0[1] + 3 * mt2 * t * seg.c1[1] + 3 * mt * t2 * seg.c2[1] + t2 * t * seg.p1[1],
  ];
}

function evalArchCubicDeriv(seg: ArchBezierSegment, t: number): [number, number] {
  const mt = 1 - t;
  return [
    3 * mt * mt * (seg.c1[0] - seg.p0[0]) +
      6 * mt * t * (seg.c2[0] - seg.c1[0]) +
      3 * t * t * (seg.p1[0] - seg.c2[0]),
    3 * mt * mt * (seg.c1[1] - seg.p0[1]) +
      6 * mt * t * (seg.c2[1] - seg.c1[1]) +
      3 * t * t * (seg.p1[1] - seg.c2[1]),
  ];
}

function isArchSegStraight(seg: ArchBezierSegment): boolean {
  const ds = seg.p1[0] - seg.p0[0];
  const dh = seg.p1[1] - seg.p0[1];
  const L = Math.hypot(ds, dh);
  if (L < 1e-4) return false;
  const us = ds / L;
  const uh = dh / L;
  const d1s = seg.c1[0] - seg.p0[0];
  const d1h = seg.c1[1] - seg.p0[1];
  const d2s = seg.p1[0] - seg.c2[0];
  const d2h = seg.p1[1] - seg.c2[1];
  const tol = 1.5e-3 * Math.max(1, L);
  return (
    Math.abs(d1s * -uh + d1h * us) < tol &&
    Math.abs(d2s * -uh + d2h * us) < tol &&
    d1s * us + d1h * uh >= -1e-4 &&
    d2s * us + d2h * uh >= -1e-4
  );
}

function intersectArchRayLine(
  p: [number, number],
  d1: [number, number],
  q: [number, number],
  d2: [number, number],
): number | null {
  const det = d1[1] * d2[0] - d1[0] * d2[1];
  if (Math.abs(det) <= 0.15) return null;
  const rs = q[0] - p[0];
  const rh = q[1] - p[1];
  const s = (-rs * d2[1] + rh * d2[0]) / det;
  return Number.isFinite(s) ? s : null;
}

export function buildArchNodeSlideRail(
  origNodes: ArchNode[],
  nodeIdx: number,
  isInner = false,
): ArchSlideRail {
  const n = origNodes.length;
  const i = clamp(nodeIdx, 0, Math.max(0, n - 1));
  const orig = origNodes[i] ?? { s: 0.5, h: 0.5, mode: 'smooth' as const };
  const minS = isInner ? 0.02 : 0;
  const maxS = isInner ? 0.98 : 1;
  const maxH = isInner ? 0.97 : 1;

  if (n < 2) {
    return {
      samples: [{ s: orig.s, h: orig.h, arcS: 0, tanS: 1, tanH: 0 }],
      minArcS: 0,
      maxArcS: 0,
      origS: orig.s,
      origH: orig.h,
      origTanS: 1,
      origTanH: 0,
      isFoot: null,
      chordInOrig: 0.1,
      chordOutOrig: 0.1,
      isStraightIn: false,
      isStraightOut: false,
    };
  }

  if (i === 0 || i === n - 1) {
    const isFirst = i === 0;
    const minFootSpan = isInner ? 0.08 : 0.12;
    const loS = isFirst ? minS : Math.max(origNodes[0].s + minFootSpan, 0.54);
    const hiS = isFirst ? Math.min(0.46, origNodes[n - 1].s - minFootSpan) : maxS;
    const clampedLo = Math.min(orig.s, loS);
    const clampedHi = Math.max(orig.s, hiS);
    const samples: ArchSlideRailSample[] = [];
    const stepsB = 16;
    for (let st = stepsB; st >= 1; st--) {
      const f = st / stepsB;
      const sv = orig.s - (orig.s - clampedLo) * f;
      samples.push({ s: sv, h: 0, arcS: sv - orig.s, tanS: 1, tanH: 0 });
    }
    samples.push({ s: orig.s, h: 0, arcS: 0, tanS: 1, tanH: 0 });
    const stepsF = 16;
    for (let st = 1; st <= stepsF; st++) {
      const f = st / stepsF;
      const sv = orig.s + (clampedHi - orig.s) * f;
      samples.push({ s: sv, h: 0, arcS: sv - orig.s, tanS: 1, tanH: 0 });
    }
    const nb = isFirst ? origNodes[1] : origNodes[n - 2];
    const chord = Math.hypot(orig.s - nb.s, orig.h - nb.h);
    return {
      samples,
      minArcS: samples[0].arcS,
      maxArcS: samples[samples.length - 1].arcS,
      origS: orig.s,
      origH: 0,
      origTanS: 1,
      origTanH: 0,
      isFoot: isFirst ? 'first' : 'last',
      chordInOrig: isFirst ? 0.1 : chord,
      chordOutOrig: isFirst ? chord : 0.1,
      isStraightIn: !isFirst,
      isStraightOut: isFirst,
    };
  }

  const segs = evaluateArchBezierSegments(origNodes, isInner);
  const segIn = segs[i - 1];
  const segOut = segs[i];
  const prev = origNodes[i - 1];
  const next = origNodes[i + 1];
  const chordInOrig = Math.hypot(orig.s - prev.s, orig.h - prev.h);
  const chordOutOrig = Math.hypot(next.s - orig.s, next.h - orig.h);
  const inStraight = isArchSegStraight(segIn);
  const outStraight = isArchSegStraight(segOut);

  let isStraightIn = false;
  let isStraightOut = false;
  let filletCorner: [number, number] | undefined;
  const backPts: { s: number; h: number; tanS: number; tanH: number }[] = [];
  const fwdPts: { s: number; h: number; tanS: number; tanH: number }[] = [];

  if (inStraight && !outStraight) {
    isStraightIn = true;
    const dir = archUnitVec(orig.s - prev.s, orig.h - prev.h);
    const maxBack = Math.max(0.005, chordInOrig - Math.max(0.02, 0.06 * chordInOrig));
    for (let st = 1; st <= 20; st++) {
      const f = st / 20;
      const ps = clamp(orig.s - dir[0] * maxBack * f, minS, maxS);
      const ph = clamp(orig.h - dir[1] * maxBack * f, 0.02, maxH);
      backPts.push({ s: ps, h: ph, tanS: dir[0], tanH: dir[1] });
    }
    const endD = evalArchCubicDeriv(segOut, 0.99);
    const tanNext = archUnitVec(endD[0], endD[1], next.s - orig.s, next.h - orig.h);
    const sCorner = intersectArchRayLine([orig.s, orig.h], dir, segOut.p1, tanNext);
    if (sCorner !== null && sCorner > 0.005 && sCorner < 0.85) {
      filletCorner = [orig.s + sCorner * dir[0], orig.h + sCorner * dir[1]];
      const maxFwd = sCorner * 0.92;
      for (let st = 1; st <= 20; st++) {
        const f = st / 20;
        const ps = clamp(orig.s + dir[0] * maxFwd * f, minS, maxS);
        const ph = clamp(orig.h + dir[1] * maxFwd * f, 0.02, maxH);
        fwdPts.push({ s: ps, h: ph, tanS: dir[0], tanH: dir[1] });
      }
    } else {
      for (let st = 1; st <= 32; st++) {
        const t = (st / 32) * 0.94;
        const pt = evalArchCubic(segOut, t);
        const dv = evalArchCubicDeriv(segOut, t);
        const ut = archUnitVec(dv[0], dv[1], next.s - orig.s, next.h - orig.h);
        fwdPts.push({
          s: clamp(pt[0], minS, maxS),
          h: clamp(pt[1], 0.02, maxH),
          tanS: ut[0],
          tanH: ut[1],
        });
      }
    }
  } else if (outStraight && !inStraight) {
    isStraightOut = true;
    const dir = archUnitVec(next.s - orig.s, next.h - orig.h);
    const maxFwd = Math.max(0.005, chordOutOrig - Math.max(0.02, 0.06 * chordOutOrig));
    for (let st = 1; st <= 20; st++) {
      const f = st / 20;
      fwdPts.push({
        s: clamp(orig.s + dir[0] * maxFwd * f, minS, maxS),
        h: clamp(orig.h + dir[1] * maxFwd * f, 0.02, maxH),
        tanS: dir[0],
        tanH: dir[1],
      });
    }
    const startD = evalArchCubicDeriv(segIn, 0.01);
    const tanPrev = archUnitVec(startD[0], startD[1], orig.s - prev.s, orig.h - prev.h);
    const backDir: [number, number] = [-dir[0], -dir[1]];
    const sCorner = intersectArchRayLine([orig.s, orig.h], backDir, segIn.p0, tanPrev);
    if (sCorner !== null && sCorner > 0.005 && sCorner < 0.85) {
      filletCorner = [orig.s + sCorner * backDir[0], orig.h + sCorner * backDir[1]];
      const maxBack = sCorner * 0.92;
      for (let st = 1; st <= 20; st++) {
        const f = st / 20;
        backPts.push({
          s: clamp(orig.s + backDir[0] * maxBack * f, minS, maxS),
          h: clamp(orig.h + backDir[1] * maxBack * f, 0.02, maxH),
          tanS: dir[0],
          tanH: dir[1],
        });
      }
    } else {
      for (let st = 1; st <= 32; st++) {
        const t = 1 - (st / 32) * 0.94;
        const pt = evalArchCubic(segIn, t);
        const dv = evalArchCubicDeriv(segIn, t);
        const ut = archUnitVec(dv[0], dv[1], orig.s - prev.s, orig.h - prev.h);
        backPts.push({
          s: clamp(pt[0], minS, maxS),
          h: clamp(pt[1], 0.02, maxH),
          tanS: ut[0],
          tanH: ut[1],
        });
      }
    }
  } else {
    for (let st = 1; st <= 32; st++) {
      const t = 1 - (st / 32) * 0.94;
      const pt = evalArchCubic(segIn, t);
      const dv = evalArchCubicDeriv(segIn, t);
      const ut = archUnitVec(dv[0], dv[1], orig.s - prev.s, orig.h - prev.h);
      backPts.push({
        s: clamp(pt[0], minS, maxS),
        h: clamp(pt[1], 0.02, maxH),
        tanS: ut[0],
        tanH: ut[1],
      });
    }
    for (let st = 1; st <= 32; st++) {
      const t = (st / 32) * 0.94;
      const pt = evalArchCubic(segOut, t);
      const dv = evalArchCubicDeriv(segOut, t);
      const ut = archUnitVec(dv[0], dv[1], next.s - orig.s, next.h - orig.h);
      fwdPts.push({
        s: clamp(pt[0], minS, maxS),
        h: clamp(pt[1], 0.02, maxH),
        tanS: ut[0],
        tanH: ut[1],
      });
    }
  }

  let origTan: [number, number];
  if (isStraightIn) origTan = archUnitVec(orig.s - prev.s, orig.h - prev.h);
  else if (isStraightOut) origTan = archUnitVec(next.s - orig.s, next.h - orig.h);
  else if (orig.mode === 'bezier' && Math.hypot(orig.outDs ?? 0, orig.outDh ?? 0) > 1e-5) {
    origTan = archUnitVec(orig.outDs!, orig.outDh!);
  } else {
    const d1 = evalArchCubicDeriv(segIn, 0.99);
    const d2 = evalArchCubicDeriv(segOut, 0.01);
    const u1 = archUnitVec(d1[0], d1[1], orig.s - prev.s, orig.h - prev.h);
    const u2 = archUnitVec(d2[0], d2[1], next.s - orig.s, next.h - orig.h);
    origTan = archUnitVec(u1[0] + u2[0], u1[1] + u2[1], next.s - prev.s, next.h - prev.h);
  }

  const samplesBack: ArchSlideRailSample[] = [];
  let accB = 0;
  let ps = orig.s;
  let ph = orig.h;
  for (const p of backPts) {
    accB -= Math.hypot(p.s - ps, p.h - ph);
    samplesBack.push({ s: p.s, h: p.h, arcS: accB, tanS: p.tanS, tanH: p.tanH });
    ps = p.s;
    ph = p.h;
  }
  samplesBack.reverse();

  const samplesFwd: ArchSlideRailSample[] = [];
  let accF = 0;
  ps = orig.s;
  ph = orig.h;
  for (const p of fwdPts) {
    accF += Math.hypot(p.s - ps, p.h - ph);
    samplesFwd.push({ s: p.s, h: p.h, arcS: accF, tanS: p.tanS, tanH: p.tanH });
    ps = p.s;
    ph = p.h;
  }

  const samples: ArchSlideRailSample[] = [
    ...samplesBack,
    { s: orig.s, h: orig.h, arcS: 0, tanS: origTan[0], tanH: origTan[1] },
    ...samplesFwd,
  ];
  return {
    samples,
    minArcS: samples[0].arcS,
    maxArcS: samples[samples.length - 1].arcS,
    origS: orig.s,
    origH: orig.h,
    origTanS: origTan[0],
    origTanH: origTan[1],
    isFoot: null,
    chordInOrig,
    chordOutOrig,
    isStraightIn,
    isStraightOut,
    filletCorner,
  };
}

export function sampleArchSlideRailAtArcS(
  rail: ArchSlideRail,
  targetArcS: number,
): ArchSlideRailSample {
  const s = rail.samples;
  if (s.length === 0) {
    return { s: rail.origS, h: rail.origH, arcS: 0, tanS: rail.origTanS, tanH: rail.origTanH };
  }
  const clamped = clamp(targetArcS, rail.minArcS, rail.maxArcS);
  if (clamped <= s[0].arcS + 1e-9) return { ...s[0] };
  if (clamped >= s[s.length - 1].arcS - 1e-9) return { ...s[s.length - 1] };

  let lo = 0;
  let hi = s.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].arcS <= clamped) lo = mid;
    else hi = mid;
  }
  const a = s[lo];
  const b = s[hi];
  const span = b.arcS - a.arcS;
  const f = span > 1e-9 ? clamp((clamped - a.arcS) / span, 0, 1) : 0;
  const ut = archUnitVec(a.tanS + (b.tanS - a.tanS) * f, a.tanH + (b.tanH - a.tanH) * f, rail.origTanS, rail.origTanH);
  return {
    s: a.s + (b.s - a.s) * f,
    h: a.h + (b.h - a.h) * f,
    arcS: clamped,
    tanS: ut[0],
    tanH: ut[1],
  };
}

export function projectOntoArchSlideRail(
  rail: ArchSlideRail,
  sVal: number,
  hVal: number,
): ArchSlideRailSample {
  const arr = rail.samples;
  if (arr.length === 0) {
    return { s: rail.origS, h: rail.origH, arcS: 0, tanS: rail.origTanS, tanH: rail.origTanH };
  }
  if (arr.length === 1) return { ...arr[0] };
  let bestD2 = Infinity;
  let bestArcS = 0;
  for (let k = 0; k < arr.length - 1; k++) {
    const a = arr[k];
    const b = arr[k + 1];
    const ds = b.s - a.s;
    const dh = b.h - a.h;
    const l2 = ds * ds + dh * dh;
    const t = l2 > 1e-12 ? clamp(((sVal - a.s) * ds + (hVal - a.h) * dh) / l2, 0, 1) : 0;
    const ps = a.s + ds * t;
    const ph = a.h + dh * t;
    const d2 = (sVal - ps) * (sVal - ps) + (hVal - ph) * (hVal - ph);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestArcS = a.arcS + (b.arcS - a.arcS) * t;
    }
  }
  return sampleArchSlideRailAtArcS(rail, bestArcS);
}

function rotateScaleArchHandle(
  ds: number,
  dh: number,
  dTheta: number,
  scale: number,
): [number, number] {
  if (Math.hypot(ds, dh) < 1e-7) return [0, 0];
  const c = Math.cos(dTheta);
  const sn = Math.sin(dTheta);
  return [
    clamp(Math.round(((ds * c - dh * sn) * scale) * 1000) / 1000, -0.8, 0.8),
    clamp(Math.round(((ds * sn + dh * c) * scale) * 1000) / 1000, -0.8, 0.8),
  ];
}

function applySingleArchRailHandles(
  nodes: ArchNode[],
  origNodes: ArchNode[],
  idx: number,
  rail: ArchSlideRail,
  pt: ArchSlideRailSample,
): void {
  const nd = nodes[idx];
  const origNd = origNodes[idx];
  if (!nd || !origNd || nd.mode !== 'bezier') return;
  const prev = idx > 0 ? nodes[idx - 1] : null;
  const next = idx < nodes.length - 1 ? nodes[idx + 1] : null;
  const newIn = prev ? Math.hypot(nd.s - prev.s, nd.h - prev.h) : rail.chordInOrig;
  const newOut = next ? Math.hypot(next.s - nd.s, next.h - nd.h) : rail.chordOutOrig;

  const isStraightFillet = rail.isFoot !== null || rail.isStraightIn || rail.isStraightOut;
  const dTheta = isStraightFillet
    ? 0
    : Math.atan2(pt.tanH, pt.tanS) - Math.atan2(rail.origTanH, rail.origTanS);

  let scaleIn = rail.chordInOrig > 1e-4 ? clamp(newIn / rail.chordInOrig, 0.15, 3.0) : 1;
  let scaleOut = rail.chordOutOrig > 1e-4 ? clamp(newOut / rail.chordOutOrig, 0.15, 3.0) : 1;
  if (rail.filletCorner) {
    const distOrig = Math.hypot(rail.origS - rail.filletCorner[0], rail.origH - rail.filletCorner[1]);
    const distNew = Math.hypot(nd.s - rail.filletCorner[0], nd.h - rail.filletCorner[1]);
    const fScale = distOrig > 1e-4 ? clamp(distNew / distOrig, 0.15, 3.5) : 1;
    if (rail.isStraightIn && !rail.isStraightOut) scaleOut = fScale;
    else if (rail.isStraightOut && !rail.isStraightIn) scaleIn = fScale;
  }

  const [inDs, inDh] = rotateScaleArchHandle(origNd.inDs ?? 0, origNd.inDh ?? 0, dTheta, scaleIn);
  const [outDs, outDh] = rotateScaleArchHandle(origNd.outDs ?? 0, origNd.outDh ?? 0, dTheta, scaleOut);
  nd.inDs = inDs;
  nd.inDh = inDh;
  nd.outDs = outDs;
  nd.outDh = outDh;
}

export function applyArchNodeSlideAtArcS(
  nodes: ArchNode[],
  origNodes: ArchNode[],
  idx: number,
  rail: ArchSlideRail,
  targetArcS: number,
  isInner: boolean,
  mirrorPartner?: { idx: number; rail: ArchSlideRail },
): ArchSlideRailSample {
  const n = nodes.length;
  if (n < 2 || origNodes.length !== n) {
    return { s: 0.5, h: 0.5, arcS: 0, tanS: 1, tanH: 0 };
  }
  const restore = (k: number) => {
    const o = origNodes[k];
    const d = nodes[k];
    if (!o || !d) return;
    d.s = o.s;
    d.h = o.h;
    if (o.mode === 'bezier') {
      d.inDs = o.inDs;
      d.inDh = o.inDh;
      d.outDs = o.outDs;
      d.outDh = o.outDh;
    }
  };
  restore(idx);
  if (idx > 0) restore(idx - 1);
  if (idx < n - 1) restore(idx + 1);
  if (mirrorPartner && mirrorPartner.idx >= 0 && mirrorPartner.idx < n) {
    restore(mirrorPartner.idx);
  }

  const pt = sampleArchSlideRailAtArcS(rail, targetArcS);
  nodes[idx].s = Math.round(pt.s * 1000) / 1000;
  nodes[idx].h = rail.isFoot ? 0 : Math.round(pt.h * 1000) / 1000;

  let mPt: ArchSlideRailSample | null = null;
  if (mirrorPartner && mirrorPartner.idx >= 0 && mirrorPartner.idx !== idx && mirrorPartner.idx < n) {
    const candidate = projectOntoArchSlideRail(mirrorPartner.rail, 1 - pt.s, pt.h);
    // Avoid center crossing on adjacent symmetry
    if (Math.abs(mirrorPartner.idx - idx) === 1 && Math.abs(candidate.s - pt.s) < 0.04) {
      mPt = null;
    } else {
      mPt = candidate;
      nodes[mirrorPartner.idx].s = Math.round(mPt.s * 1000) / 1000;
      nodes[mirrorPartner.idx].h = mirrorPartner.rail.isFoot ? 0 : Math.round(mPt.h * 1000) / 1000;
    }
  }

  applySingleArchRailHandles(nodes, origNodes, idx, rail, pt);
  if (mPt && mirrorPartner) {
    applySingleArchRailHandles(nodes, origNodes, mirrorPartner.idx, mirrorPartner.rail, mPt);
  }
  sanitizeArchNodesInPlace(nodes, isInner);
  return pt;
}
