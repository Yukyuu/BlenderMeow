// Pure 2D closed cross-section curve math (solid & hollow inner loops), preset templates,
// exact metric parallel inward offset + clamping, seam alignment, and multi-section loft interpolation
import { clamp } from './color';

export type LoftNodeMode = 'smooth' | 'corner' | 'bezier';

export type LoftInnerMode = 'parallel' | 'proportional' | 'custom';

export const LOFT_INNER_MODES: { id: LoftInnerMode; label: string; title: string }[] = [
  {
    id: 'parallel',
    label: '📏 平行等厚',
    title: '按真实水平物理尺度向内等距偏置，保持四周壁厚均匀一致（支持凹多边形无自交）',
  },
  {
    id: 'proportional',
    label: '🎯 等比同心',
    title: '向截面极点/中心同心等比收缩外圈轮廓',
  },
  {
    id: 'custom',
    label: '✒️ 自由内圈',
    title: '解锁当前控制面的内圈控制点，可独立编辑任意内孔曲线形状（如外方内圆）',
  },
];

export interface LoftNode {
  u: number;
  v: number;
  mode: LoftNodeMode;
  inDu?: number;
  inDv?: number;
  outDu?: number;
  outDv?: number;
}

export interface LoftSection {
  id: string;
  name: string;
  /** Normalized vertical elevation along heightPx in [0, 1] */
  t: number;
  scale: number;
  twistDeg: number;
  offsetU: number;
  offsetV: number;
  nodes: LoftNode[];
  /** When true, section curve morphology dynamically tracks the height-weighted blend of adjacent lower & upper non-transition sections */
  isTransition?: boolean;
  /** Hollow inner-loop relationship mode for this control section (active when shape.loftHollow === true) */
  innerMode?: LoftInnerMode;
  /** Wall thickness ratio in [0.06, 0.78] for 'parallel' and 'proportional' modes */
  innerThickness?: number;
  /** Independent closed inner-loop nodes in section-local [0..1]x[0..1] space when innerMode === 'custom' */
  innerNodes?: LoftNode[];
}

export type LoftInterpMode = 'smooth' | 'linear';

export type LoftPresetId =
  | 'circle'
  | 'rounded_rect'
  | 'square'
  | 'octagon'
  | 'flat_arch_d'
  | 'c_arch'
  | 'u_arch'
  | 'kidney'
  | 'clover'
  | 'heart'
  | 'star'
  | 'teardrop'
  | 'l_shape'
  | 'poly_3'
  | 'poly_4'
  | 'poly_5'
  | 'poly_6'
  | 'poly_7'
  | 'poly_8'
  | 'poly_9'
  | 'poly_10'
  | 'poly_11'
  | 'poly_12';

export const LOFT_PRESETS: { id: LoftPresetId; label: string }[] = [
  { id: 'circle', label: '圆形' },
  { id: 'rounded_rect', label: '圆角方' },
  { id: 'square', label: '方形' },
  { id: 'octagon', label: '八角形' },
  { id: 'flat_arch_d', label: '平放半圆拱' },
  { id: 'c_arch', label: '平放圆弧拱' },
  { id: 'u_arch', label: '马蹄U形拱' },
  { id: 'kidney', label: '肾形曲面' },
  { id: 'clover', label: '四叶草' },
  { id: 'heart', label: '心形' },
  { id: 'star', label: '五角星' },
  { id: 'teardrop', label: '水滴' },
  { id: 'l_shape', label: 'L形' },
];

export const LOFT_POLYGON_PRESETS: { id: LoftPresetId; label: string; sides: number }[] = [
  { id: 'poly_3', label: '正三角形', sides: 3 },
  { id: 'poly_4', label: '正方形', sides: 4 },
  { id: 'poly_5', label: '正五边形', sides: 5 },
  { id: 'poly_6', label: '正六边形', sides: 6 },
  { id: 'poly_7', label: '正七边形', sides: 7 },
  { id: 'poly_8', label: '正八边形', sides: 8 },
  { id: 'poly_9', label: '正九边形', sides: 9 },
  { id: 'poly_10', label: '正十边形', sides: 10 },
  { id: 'poly_11', label: '正十一边形', sides: 11 },
  { id: 'poly_12', label: '正十二边形', sides: 12 },
];

export function createRegularPolygonLoftNodes(sides: number): LoftNode[] {
  const n = Math.max(3, Math.min(24, Math.round(sides)));
  const r = 0.44;
  // Flat top/bottom for even-sided polygons; apex pointing up (-v) for odd-sided polygons.
  const startAngle = -Math.PI / 2 - (n % 2 === 0 ? Math.PI / n : 0);
  const step = (Math.PI * 2) / n;
  const nodes: LoftNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * step;
    const u = Math.round((0.5 + r * Math.cos(a)) * 10000) / 10000;
    const v = Math.round((0.5 + r * Math.sin(a)) * 10000) / 10000;
    nodes.push({ u, v, mode: 'corner' });
  }
  return nodes;
}

export interface BezierSegment {
  p0: [number, number];
  c1: [number, number];
  c2: [number, number];
  p1: [number, number];
}

export interface LoftRing {
  t: number;
  pts: [number, number][];
}

export interface AlignedLoftResult {
  rings: LoftRing[];
  innerRings?: LoftRing[];
  innerFloorRing?: { t: number; pts: [number, number][] };
  tMin: number;
  tMax: number;
  localBounds: { minU: number; maxU: number; minV: number; maxV: number };
  avgPerimLocal: number;
  avgInnerPerimLocal: number;
}

let secCounter = 1;
export function nextLoftSectionId(): string {
  return `sec-${Date.now().toString(36)}-${secCounter++}`;
}

export function cloneLoftNode(n: LoftNode): LoftNode {
  const copy: LoftNode = {
    u: n.u,
    v: n.v,
    mode: n.mode,
  };
  if (Number.isFinite(n.inDu)) copy.inDu = n.inDu;
  if (Number.isFinite(n.inDv)) copy.inDv = n.inDv;
  if (Number.isFinite(n.outDu)) copy.outDu = n.outDu;
  if (Number.isFinite(n.outDv)) copy.outDv = n.outDv;
  return copy;
}

export function cloneLoftSections(secs: LoftSection[]): LoftSection[] {
  return secs.map((s) => {
    const out: LoftSection = {
      id: s.id,
      name: s.name,
      t: s.t,
      scale: s.scale,
      twistDeg: s.twistDeg,
      offsetU: s.offsetU,
      offsetV: s.offsetV,
      nodes: s.nodes.map(cloneLoftNode),
    };
    if (s.isTransition) out.isTransition = true;
    if (s.innerMode) out.innerMode = s.innerMode;
    if (Number.isFinite(s.innerThickness)) out.innerThickness = s.innerThickness;
    if (Array.isArray(s.innerNodes) && s.innerNodes.length >= 3) {
      out.innerNodes = s.innerNodes.map(cloneLoftNode);
    }
    return out;
  });
}

export function createLoftPresetNodes(id: LoftPresetId): LoftNode[] {
  switch (id) {
    case 'circle': {
      const r = 0.44;
      const k = 0.55228475 * r;
      // Wound with negative shoelace area: (0.5, 0.06) -> (0.06, 0.5) -> (0.5, 0.94) -> (0.94, 0.5)
      return [
        { u: 0.5, v: 0.5 - r, mode: 'bezier', inDu: k, inDv: 0, outDu: -k, outDv: 0 },
        { u: 0.5 - r, v: 0.5, mode: 'bezier', inDu: 0, inDv: -k, outDu: 0, outDv: k },
        { u: 0.5, v: 0.5 + r, mode: 'bezier', inDu: -k, inDv: 0, outDu: k, outDv: 0 },
        { u: 0.5 + r, v: 0.5, mode: 'bezier', inDu: 0, inDv: k, outDu: 0, outDv: -k },
      ];
    }
    case 'rounded_rect': {
      const a = 0.08;
      const b = 0.92;
      const c = 0.24;
      const d = 0.76;
      const h = 0.11;
      return [
        { u: c, v: a, mode: 'bezier', inDu: h, inDv: 0, outDu: -h, outDv: 0 },
        { u: a, v: c, mode: 'bezier', inDu: 0, inDv: -h, outDu: 0, outDv: h },
        { u: a, v: d, mode: 'bezier', inDu: 0, inDv: -h, outDu: 0, outDv: h },
        { u: c, v: b, mode: 'bezier', inDu: -h, inDv: 0, outDu: h, outDv: 0 },
        { u: d, v: b, mode: 'bezier', inDu: -h, inDv: 0, outDu: h, outDv: 0 },
        { u: b, v: d, mode: 'bezier', inDu: 0, inDv: h, outDu: 0, outDv: -h },
        { u: b, v: c, mode: 'bezier', inDu: 0, inDv: h, outDu: 0, outDv: -h },
        { u: d, v: a, mode: 'bezier', inDu: h, inDv: 0, outDu: -h, outDv: 0 },
      ];
    }
    case 'square':
      return [
        { u: 0.08, v: 0.08, mode: 'corner' },
        { u: 0.08, v: 0.92, mode: 'corner' },
        { u: 0.92, v: 0.92, mode: 'corner' },
        { u: 0.92, v: 0.08, mode: 'corner' },
      ];
    case 'octagon': {
      const nodes: LoftNode[] = [];
      const r = 0.46;
      for (let i = 0; i < 8; i++) {
        const ang = -Math.PI / 8 - (i * Math.PI * 2) / 8;
        nodes.push({
          u: Math.round((0.5 + Math.cos(ang) * r) * 1000) / 1000,
          v: Math.round((0.5 + Math.sin(ang) * r) * 1000) / 1000,
          mode: 'corner',
        });
      }
      return nodes;
    }
    case 'flat_arch_d': {
      // Horizontal D-shaped solid arch: straight chord at v = 0.90, semicircular crown up to v = 0.08
      const rU = 0.44;
      const rV = 0.82;
      const kU = 0.55228475 * rU;
      const kV = 0.55228475 * rV;
      return [
        { u: 0.5, v: 0.08, mode: 'bezier', inDu: kU, inDv: 0, outDu: -kU, outDv: 0 },
        { u: 0.06, v: 0.90, mode: 'bezier', inDu: 0, inDv: -kV, outDu: 0, outDv: 0 },
        { u: 0.94, v: 0.90, mode: 'bezier', inDu: 0, inDv: 0, outDu: 0, outDv: -kV },
      ];
    }
    case 'c_arch': {
      // Open-front horizontal C-shaped arch ring wall: outer arch + flat pier ends + inner arch recess
      const rOutU = 0.45;
      const rOutV = 0.82;
      const rInU = 0.27;
      const rInV = 0.56;
      const k = 0.55228475;
      return [
        { u: 0.5, v: 0.08, mode: 'bezier', inDu: k * rOutU, inDv: 0, outDu: -k * rOutU, outDv: 0 },
        { u: 0.5 - rOutU, v: 0.90, mode: 'bezier', inDu: 0, inDv: -k * rOutV, outDu: 0, outDv: 0 },
        { u: 0.5 - rInU, v: 0.90, mode: 'bezier', inDu: 0, inDv: 0, outDu: 0, outDv: -k * rInV },
        { u: 0.5, v: 0.90 - rInV, mode: 'bezier', inDu: -k * rInU, inDv: 0, outDu: k * rInU, outDv: 0 },
        { u: 0.5 + rInU, v: 0.90, mode: 'bezier', inDu: 0, inDv: -k * rInV, outDu: 0, outDv: 0 },
        { u: 0.5 + rOutU, v: 0.90, mode: 'bezier', inDu: 0, inDv: 0, outDu: 0, outDv: -k * rOutV },
      ];
    }
    case 'u_arch': {
      // Horizontal U-shaped horseshoe / courtyard arch with straight side wings + semicircular apse
      const rOut = 0.44;
      const rIn = 0.25;
      const k = 0.55228475;
      return [
        { u: 0.5, v: 0.06, mode: 'bezier', inDu: k * rOut, inDv: 0, outDu: -k * rOut, outDv: 0 },
        { u: 0.5 - rOut, v: 0.50, mode: 'bezier', inDu: 0, inDv: -k * rOut, outDu: 0, outDv: 0 },
        { u: 0.5 - rOut, v: 0.92, mode: 'corner' },
        { u: 0.5 - rIn, v: 0.92, mode: 'corner' },
        { u: 0.5 - rIn, v: 0.50, mode: 'bezier', inDu: 0, inDv: 0, outDu: 0, outDv: -k * rIn },
        { u: 0.5, v: 0.50 - rIn, mode: 'bezier', inDu: -k * rIn, inDv: 0, outDu: k * rIn, outDv: 0 },
        { u: 0.5 + rIn, v: 0.50, mode: 'bezier', inDu: 0, inDv: -k * rIn, outDu: 0, outDv: 0 },
        { u: 0.5 + rIn, v: 0.92, mode: 'corner' },
        { u: 0.5 + rOut, v: 0.92, mode: 'corner' },
        { u: 0.5 + rOut, v: 0.50, mode: 'bezier', inDu: 0, inDv: 0, outDu: 0, outDv: -k * rOut },
      ];
    }
    case 'kidney':
      return [
        { u: 0.50, v: 0.08, mode: 'smooth' },
        { u: 0.14, v: 0.20, mode: 'smooth' },
        { u: 0.10, v: 0.62, mode: 'smooth' },
        { u: 0.34, v: 0.90, mode: 'smooth' },
        { u: 0.80, v: 0.78, mode: 'smooth' },
        { u: 0.72, v: 0.44, mode: 'smooth' }, // concave waist
        { u: 0.88, v: 0.22, mode: 'smooth' },
      ];
    case 'clover': {
      const nodes: LoftNode[] = [];
      for (let i = 0; i < 8; i++) {
        const ang = -(i * Math.PI * 2) / 8;
        const r = i % 2 === 0 ? 0.44 : 0.22;
        nodes.push({
          u: 0.5 + Math.cos(ang) * r,
          v: 0.5 + Math.sin(ang) * r,
          mode: 'smooth',
        });
      }
      return nodes;
    }
    case 'heart':
      return [
        { u: 0.50, v: 0.28, mode: 'corner' }, // top cleft
        { u: 0.24, v: 0.12, mode: 'smooth' },
        { u: 0.08, v: 0.38, mode: 'smooth' },
        { u: 0.50, v: 0.92, mode: 'corner' }, // pointed apex
        { u: 0.92, v: 0.38, mode: 'smooth' },
        { u: 0.76, v: 0.12, mode: 'smooth' },
      ];
    case 'star': {
      const nodes: LoftNode[] = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 - (i * Math.PI * 2) / 10;
        const r = i % 2 === 0 ? 0.45 : 0.20;
        nodes.push({
          u: 0.5 + Math.cos(ang) * r,
          v: 0.5 + Math.sin(ang) * r,
          mode: 'corner',
        });
      }
      return nodes;
    }
    case 'teardrop':
      return [
        { u: 0.50, v: 0.06, mode: 'corner' },
        { u: 0.14, v: 0.54, mode: 'smooth' },
        { u: 0.50, v: 0.92, mode: 'smooth' },
        { u: 0.86, v: 0.54, mode: 'smooth' },
      ];
    case 'l_shape':
      return [
        { u: 0.08, v: 0.08, mode: 'corner' },
        { u: 0.08, v: 0.92, mode: 'corner' },
        { u: 0.92, v: 0.92, mode: 'corner' },
        { u: 0.92, v: 0.54, mode: 'corner' },
        { u: 0.48, v: 0.54, mode: 'corner' },
        { u: 0.48, v: 0.08, mode: 'corner' },
      ];
    case 'poly_3':
      return createRegularPolygonLoftNodes(3);
    case 'poly_4':
      return createRegularPolygonLoftNodes(4);
    case 'poly_5':
      return createRegularPolygonLoftNodes(5);
    case 'poly_6':
      return createRegularPolygonLoftNodes(6);
    case 'poly_7':
      return createRegularPolygonLoftNodes(7);
    case 'poly_8':
      return createRegularPolygonLoftNodes(8);
    case 'poly_9':
      return createRegularPolygonLoftNodes(9);
    case 'poly_10':
      return createRegularPolygonLoftNodes(10);
    case 'poly_11':
      return createRegularPolygonLoftNodes(11);
    case 'poly_12':
      return createRegularPolygonLoftNodes(12);
  }
}

/**
 * Scales a preset closed curve around the section's interior pole (or `[0.5, 0.5]`)
 * so it fits cleanly inside star and non-star outer polygons alike as an inner cutout loop.
 */
export function createScaledLoftInnerPresetNodes(
  id: LoftPresetId,
  thickness = 0.25,
  secOrCenter?: LoftSection | [number, number],
  lsu = 1,
  lsv = 1,
): LoftNode[] {
  const base = createLoftPresetNodes(id);
  const thick = clamp(Number.isFinite(thickness) ? thickness : 0.25, 0.06, 0.78);
  let cu = 0.5;
  let cv = 0.5;
  let safeScale = 1;
  if (Array.isArray(secOrCenter)) {
    cu = secOrCenter[0];
    cv = secOrCenter[1];
  } else if (secOrCenter && typeof secOrCenter === 'object') {
    const info = getSectionInteriorCenterLocal(secOrCenter, lsu, lsv);
    cu = info.center[0];
    cv = info.center[1];
    safeScale = info.safeScale;
  }
  const scale = clamp((1 - thick) * safeScale, 0.16, 0.90);
  return base.map((n) => {
    const out: LoftNode = {
      u: Math.round((cu + (n.u - 0.5) * scale) * 1000) / 1000,
      v: Math.round((cv + (n.v - 0.5) * scale) * 1000) / 1000,
      mode: n.mode,
    };
    if (n.mode === 'bezier') {
      out.inDu = (n.inDu ?? 0) * scale;
      out.inDv = (n.inDv ?? 0) * scale;
      out.outDu = (n.outDu ?? 0) * scale;
      out.outDv = (n.outDv ?? 0) * scale;
    }
    return out;
  });
}

export function createScaledNodesFromOuter(
  outerNodes: LoftNode[],
  thickness = 0.25,
): LoftNode[] {
  let sumU = 0;
  let sumV = 0;
  const n = outerNodes.length || 1;
  for (const nd of outerNodes) {
    sumU += nd.u;
    sumV += nd.v;
  }
  const cu = sumU / n;
  const cv = sumV / n;
  const scale = clamp(1 - clamp(thickness, 0.06, 0.78), 0.2, 0.92);
  return outerNodes.map((nd) => {
    const out: LoftNode = {
      u: Math.round((cu + (nd.u - cu) * scale) * 1000) / 1000,
      v: Math.round((cv + (nd.v - cv) * scale) * 1000) / 1000,
      mode: nd.mode,
    };
    if (nd.mode === 'bezier') {
      out.inDu = (nd.inDu ?? 0) * scale;
      out.inDv = (nd.inDv ?? 0) * scale;
      out.outDu = (nd.outDu ?? 0) * scale;
      out.outDv = (nd.outDv ?? 0) * scale;
    }
    return out;
  });
}

export function createDefaultLoftSections(): LoftSection[] {
  return [
    {
      id: 'sec-1',
      name: '底层控制面',
      t: 0,
      scale: 1.0,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes('rounded_rect'),
    },
    {
      id: 'sec-2',
      name: '中腰控制面',
      t: 0.5,
      scale: 0.74,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes('circle'),
    },
    {
      id: 'sec-3',
      name: '顶层控制面',
      t: 1.0,
      scale: 0.92,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes('rounded_rect'),
    },
  ];
}

function sanitizeNodeList(rawNodes: LoftNode[]): LoftNode[] {
  const validNodes: LoftNode[] = [];
  for (const rn of rawNodes) {
    if (!rn || !Number.isFinite(rn.u) || !Number.isFinite(rn.v)) continue;
    const mode: LoftNodeMode = rn.mode === 'corner' || rn.mode === 'bezier' ? rn.mode : 'smooth';
    const node: LoftNode = {
      u: clamp(rn.u, -0.5, 1.5),
      v: clamp(rn.v, -0.5, 1.5),
      mode,
    };
    if (mode === 'bezier') {
      node.inDu = Number.isFinite(rn.inDu) ? clamp(rn.inDu!, -1, 1) : 0;
      node.inDv = Number.isFinite(rn.inDv) ? clamp(rn.inDv!, -1, 1) : 0;
      node.outDu = Number.isFinite(rn.outDu) ? clamp(rn.outDu!, -1, 1) : 0;
      node.outDv = Number.isFinite(rn.outDv) ? clamp(rn.outDv!, -1, 1) : 0;
    }
    validNodes.push(node);
  }
  return validNodes;
}

function sanitizeNodeListInPlace(nodes: LoftNode[]): number {
  let nWrite = 0;
  for (let j = 0; j < nodes.length; j++) {
    const rn = nodes[j];
    if (!rn || !Number.isFinite(rn.u) || !Number.isFinite(rn.v)) continue;
    rn.u = clamp(rn.u, -0.5, 1.5);
    rn.v = clamp(rn.v, -0.5, 1.5);
    const mode: LoftNodeMode = rn.mode === 'corner' || rn.mode === 'bezier' ? rn.mode : 'smooth';
    rn.mode = mode;
    if (mode === 'bezier') {
      rn.inDu = Number.isFinite(rn.inDu) ? clamp(rn.inDu!, -1, 1) : 0;
      rn.inDv = Number.isFinite(rn.inDv) ? clamp(rn.inDv!, -1, 1) : 0;
      rn.outDu = Number.isFinite(rn.outDu) ? clamp(rn.outDu!, -1, 1) : 0;
      rn.outDv = Number.isFinite(rn.outDv) ? clamp(rn.outDv!, -1, 1) : 0;
    } else {
      delete rn.inDu;
      delete rn.inDv;
      delete rn.outDu;
      delete rn.outDv;
    }
    nodes[nWrite++] = rn;
  }
  nodes.length = nWrite;
  return nWrite;
}

export function normalizeLoftSections(secs?: LoftSection[] | null): LoftSection[] {
  if (!Array.isArray(secs) || secs.length === 0) {
    return createDefaultLoftSections();
  }
  const seenIds = new Set<string>();
  const out: LoftSection[] = [];
  for (let i = 0; i < secs.length; i++) {
    const raw = secs[i];
    if (!raw || !Array.isArray(raw.nodes)) continue;
    const validNodes = sanitizeNodeList(raw.nodes);
    if (validNodes.length < 3) continue;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : nextLoftSectionId();
    while (seenIds.has(id)) {
      id = nextLoftSectionId();
    }
    seenIds.add(id);
    const sec: LoftSection = {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `控制面 #${out.length + 1}`,
      t: clamp(Number.isFinite(raw.t) ? raw.t : 0, 0, 1),
      scale: clamp(Number.isFinite(raw.scale) ? raw.scale : 1, 0.15, 1.6),
      twistDeg: clamp(Number.isFinite(raw.twistDeg) ? raw.twistDeg : 0, -180, 180),
      offsetU: clamp(Number.isFinite(raw.offsetU) ? raw.offsetU : 0, -0.5, 0.5),
      offsetV: clamp(Number.isFinite(raw.offsetV) ? raw.offsetV : 0, -0.5, 0.5),
      nodes: validNodes,
    };
    if (raw.isTransition) sec.isTransition = true;
    if (raw.innerMode === 'parallel' || raw.innerMode === 'proportional' || raw.innerMode === 'custom') {
      sec.innerMode = raw.innerMode;
    }
    if (Number.isFinite(raw.innerThickness)) {
      sec.innerThickness = clamp(raw.innerThickness!, 0.06, 0.78);
    }
    if (Array.isArray(raw.innerNodes)) {
      const validInner = sanitizeNodeList(raw.innerNodes);
      if (validInner.length >= 3) {
        sec.innerNodes = validInner;
      }
    }
    if (sec.innerMode === 'custom' && (!sec.innerNodes || sec.innerNodes.length < 3)) {
      sec.innerMode = 'parallel';
      delete sec.innerNodes;
    }
    out.push(sec);
  }
  return out.length > 0 ? out : createDefaultLoftSections();
}

/**
 * Sanitizes a section array IN-PLACE, preserving both array identity and live object references
 * for valid sections so Inspector/Canvas edits remain synchronized with rendering.
 */
export function sanitizeLoftSectionsInPlace(secs: LoftSection[]): void {
  const seenIds = new Set<string>();
  let writeIdx = 0;
  for (let i = 0; i < secs.length; i++) {
    const raw = secs[i];
    if (!raw || !Array.isArray(raw.nodes)) continue;

    const nWrite = sanitizeNodeListInPlace(raw.nodes);
    if (nWrite < 3) continue;

    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : nextLoftSectionId();
    while (seenIds.has(id)) {
      id = nextLoftSectionId();
    }
    seenIds.add(id);
    raw.id = id;
    raw.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `控制面 #${writeIdx + 1}`;
    raw.t = clamp(Number.isFinite(raw.t) ? raw.t : 0, 0, 1);
    raw.scale = clamp(Number.isFinite(raw.scale) ? raw.scale : 1, 0.15, 1.6);
    raw.twistDeg = clamp(Number.isFinite(raw.twistDeg) ? raw.twistDeg : 0, -180, 180);
    raw.offsetU = clamp(Number.isFinite(raw.offsetU) ? raw.offsetU : 0, -0.5, 0.5);
    raw.offsetV = clamp(Number.isFinite(raw.offsetV) ? raw.offsetV : 0, -0.5, 0.5);
    if (raw.isTransition) raw.isTransition = true;
    else delete raw.isTransition;

    if (raw.innerMode !== undefined) {
      if (raw.innerMode !== 'parallel' && raw.innerMode !== 'proportional' && raw.innerMode !== 'custom') {
        raw.innerMode = 'parallel';
      }
    }
    if (raw.innerThickness !== undefined) {
      raw.innerThickness = Number.isFinite(raw.innerThickness) ? clamp(raw.innerThickness, 0.06, 0.78) : 0.25;
    }
    if (Array.isArray(raw.innerNodes)) {
      const nIn = sanitizeNodeListInPlace(raw.innerNodes);
      if (nIn < 3) {
        delete raw.innerNodes;
        if (raw.innerMode === 'custom') raw.innerMode = 'parallel';
      }
    } else if (raw.innerMode === 'custom') {
      raw.innerMode = 'parallel';
    }

    secs[writeIdx++] = raw;
  }
  secs.length = writeIdx;
  if (secs.length === 0) {
    secs.push(...createDefaultLoftSections());
  }
}

/**
 * Ensures `shape.loftSections` exists and is sanitized IN-PLACE, returning the live active LoftSection
 * WITHOUT cloning or replacing an already valid section object.
 */
export function ensureActiveLoftSection(shape: {
  loftSections?: LoftSection[] | null;
  activeLoftSectionId?: string;
}): LoftSection {
  if (!Array.isArray(shape.loftSections) || shape.loftSections.length === 0) {
    shape.loftSections = createDefaultLoftSections();
  } else {
    sanitizeLoftSectionsInPlace(shape.loftSections);
  }
  const found = shape.loftSections.find((s) => s.id === shape.activeLoftSectionId);
  if (found) return found;
  const fallback = shape.loftSections[shape.loftSections.length - 1];
  shape.activeLoftSectionId = fallback.id;
  return fallback;
}

export function ensureLoftSections(shape: {
  loftSections?: LoftSection[] | null;
  activeLoftSectionId?: string;
}): LoftSection[] {
  ensureActiveLoftSection(shape);
  return shape.loftSections!;
}

export function computeNodeSmoothTangents(
  nodes: LoftNode[],
  idx: number,
): { inDu: number; inDv: number; outDu: number; outDv: number } {
  const n = nodes.length;
  const cur = nodes[idx];
  const prev = nodes[(idx - 1 + n) % n];
  const next = nodes[(idx + 1) % n];
  if (cur.mode === 'corner') {
    return { inDu: 0, inDv: 0, outDu: 0, outDv: 0 };
  }
  if (cur.mode === 'bezier') {
    return {
      inDu: cur.inDu ?? 0,
      inDv: cur.inDv ?? 0,
      outDu: cur.outDu ?? 0,
      outDv: cur.outDv ?? 0,
    };
  }
  const tu = (next.u - prev.u) / 6;
  const tv = (next.v - prev.v) / 6;
  const tLen = Math.hypot(tu, tv);
  if (tLen < 1e-8) {
    return { inDu: 0, inDv: 0, outDu: 0, outDv: 0 };
  }
  const dIn = Math.hypot(cur.u - prev.u, cur.v - prev.v);
  const dOut = Math.hypot(next.u - cur.u, next.v - cur.v);
  const maxIn = dIn * 0.45;
  const maxOut = dOut * 0.45;
  const sIn = tLen > maxIn ? maxIn / tLen : 1;
  const sOut = tLen > maxOut ? maxOut / tLen : 1;
  return {
    inDu: -tu * sIn,
    inDv: -tv * sIn,
    outDu: tu * sOut,
    outDv: tv * sOut,
  };
}

export function evaluateSectionBezierSegments(nodes: LoftNode[]): BezierSegment[] {
  const n = nodes.length;
  if (n < 2) return [];
  const tangents = nodes.map((_, i) => computeNodeSmoothTangents(nodes, i));
  const segs: BezierSegment[] = [];
  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    const a = nodes[i];
    const b = nodes[ni];
    const ta = tangents[i];
    const tb = tangents[ni];
    segs.push({
      p0: [a.u, a.v],
      c1: [a.u + ta.outDu, a.v + ta.outDv],
      c2: [b.u + tb.inDu, b.v + tb.inDv],
      p1: [b.u, b.v],
    });
  }
  return segs;
}

export function applySectionTransform(pt: [number, number], sec: LoftSection): [number, number] {
  const du = (pt[0] - 0.5) * sec.scale;
  const dv = (pt[1] - 0.5) * sec.scale;
  const rad = (sec.twistDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    0.5 + sec.offsetU + du * c - dv * s,
    0.5 + sec.offsetV + du * s + dv * c,
  ];
}

export function applySectionTransformInverse(pt: [number, number], sec: LoftSection): [number, number] {
  const s = Math.max(0.05, sec.scale);
  const tx = pt[0] - 0.5 - sec.offsetU;
  const ty = pt[1] - 0.5 - sec.offsetV;
  const rad = (sec.twistDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  const du = (tx * c + ty * sn) / s;
  const dv = (-tx * sn + ty * c) / s;
  return [0.5 + du, 0.5 + dv];
}

function evalCubic(
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  [x3, y3]: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = 3 * mt2 * t;
  const c = 3 * mt * t2;
  const d = t2 * t;
  return [
    a * x0 + b * x1 + c * x2 + d * x3,
    a * y0 + b * y1 + c * y2 + d * y3,
  ];
}

function shoelaceTwiceArea(poly: [number, number][]): number {
  let sum = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [au, av] = poly[i];
    const [bu, bv] = poly[(i + 1) % n];
    sum += au * bv - bu * av;
  }
  return sum;
}

function polylinePerimeter(poly: [number, number][]): number {
  let total = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [au, av] = poly[i];
    const [bu, bv] = poly[(i + 1) % n];
    total += Math.hypot(bu - au, bv - av);
  }
  return total;
}

export function pointInClosedPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function resampleClosedLoopUniform(
  rawPoly: [number, number][],
  sampleCount: number,
): [number, number][] {
  if (rawPoly.length === 0 || sampleCount <= 0) return [];
  const dense = rawPoly.map(([u, v]) => [u, v] as [number, number]);
  if (shoelaceTwiceArea(dense) > 0) {
    dense.reverse();
  }
  const m = dense.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const [au, av] = dense[i];
    const [bu, bv] = dense[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(bu - au, bv - av);
  }
  const totalLen = cum[m];
  if (totalLen < 1e-8) {
    return Array.from({ length: sampleCount }, () => [dense[0][0], dense[0][1]] as [number, number]);
  }

  const res: [number, number][] = [];
  let cursor = 0;
  for (let j = 0; j < sampleCount; j++) {
    const target = (j / sampleCount) * totalLen;
    while (cursor < m - 1 && cum[cursor + 1] < target) {
      cursor++;
    }
    const segLen = cum[cursor + 1] - cum[cursor];
    const alpha = segLen > 1e-10 ? (target - cum[cursor]) / segLen : 0;
    const a = dense[cursor];
    const b = dense[(cursor + 1) % m];
    res.push([
      a[0] + (b[0] - a[0]) * alpha,
      a[1] + (b[1] - a[1]) * alpha,
    ]);
  }
  return res;
}

export function sampleClosedNodesUniform(
  nodes: LoftNode[],
  sampleCount: number,
): [number, number][] {
  const segs = evaluateSectionBezierSegments(nodes);
  if (segs.length === 0 || sampleCount <= 0) return [];
  const stepsPerSeg = 24;
  const dense: [number, number][] = [];
  for (const seg of segs) {
    for (let k = 0; k < stepsPerSeg; k++) {
      dense.push(evalCubic(seg.p0, seg.c1, seg.c2, seg.p1, k / stepsPerSeg));
    }
  }
  return resampleClosedLoopUniform(dense, sampleCount);
}

/**
 * Samples a closed LoftSection outer loop uniformly by arc length.
 * Enforces negative shoelace area (< 0) in (lu, lv) space to match outward normals in isoRenderer.
 */
export function sampleClosedSectionUniform(
  sec: LoftSection,
  sampleCount: number,
  applyTransform = true,
): [number, number][] {
  const raw = sampleClosedNodesUniform(sec.nodes, sampleCount);
  if (!applyTransform) return raw;
  return raw.map((pt) => applySectionTransform(pt, sec));
}

// ---------------- Exact Metric Signed Distance + Marching Squares Inset & Clamping ----------------

class BoundedLru<T> {
  private map = new Map<string, T>();
  constructor(private readonly capacity: number) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, val: T): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, val);
  }
}

interface MetricSdfField {
  x0: number;
  y0: number;
  cell: number;
  gxCount: number;
  gyCount: number;
  phi: Float64Array;
  maxDist: number;
  poleX: number;
  poleY: number;
}

const sdfCache = new BoundedLru<MetricSdfField>(256);

function serializeLoopSig(poly: [number, number][], stride = 1): string {
  let sig = `${poly.length}:`;
  for (let i = 0; i < poly.length; i += stride) {
    sig += `${Math.round(poly[i][0] * 2000)},${Math.round(poly[i][1] * 2000)};`;
  }
  return sig;
}

function downsampleClosedLoop(poly: [number, number][], maxPts = 72): [number, number][] {
  if (poly.length <= maxPts) return poly;
  const out: [number, number][] = [];
  const step = poly.length / maxPts;
  for (let i = 0; i < maxPts; i++) {
    out.push(poly[Math.floor(i * step)]);
  }
  return out;
}

function buildClosedPolygonSdf(rawPoly: [number, number][], targetRes = 68): MetricSdfField | null {
  if (rawPoly.length < 3) return null;
  const poly = downsampleClosedLoop(rawPoly, 72);
  const n = poly.length;
  const cacheKey = `${targetRes}|${serializeLoopSig(poly, 1)}`;
  const cached = sdfCache.get(cacheKey);
  if (cached) return cached;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 1e-6)) return null;

  const cell = span / targetRes;
  const pad = cell * 2;
  const x0 = minX - pad;
  const y0 = minY - pad;
  const gxCount = Math.max(8, Math.ceil((maxX - minX + pad * 2) / cell) + 1);
  const gyCount = Math.max(8, Math.ceil((maxY - minY + pad * 2) / cell) + 1);
  const phi = new Float64Array(gxCount * gyCount);

  // Precompute segment deltas & squared lengths
  const axArr = new Float64Array(n);
  const ayArr = new Float64Array(n);
  const dxArr = new Float64Array(n);
  const dyArr = new Float64Array(n);
  const invL2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    axArr[i] = ax;
    ayArr[i] = ay;
    dxArr[i] = dx;
    dyArr[i] = dy;
    invL2[i] = l2 > 1e-14 ? 1 / l2 : 0;
  }

  let maxDist = -Infinity;
  let poleX = 0.5 * (minX + maxX);
  let poleY = 0.5 * (minY + maxY);
  const crossings: number[] = [];

  for (let gy = 0; gy < gyCount; gy++) {
    const py = y0 + gy * cell + 1e-9; // tiny y-nudge avoids exact vertex-degeneracy in scanline parity
    crossings.length = 0;
    for (let i = 0; i < n; i++) {
      const ay = ayArr[i];
      const by = ay + dyArr[i];
      if ((ay <= py && by > py) || (by <= py && ay > py)) {
        crossings.push(axArr[i] + ((py - ay) / (by - ay)) * dxArr[i]);
      }
    }
    crossings.sort((a, b) => a - b);

    let cIdx = 0;
    let inside = false;
    const rowOff = gy * gxCount;

    for (let gx = 0; gx < gxCount; gx++) {
      const px = x0 + gx * cell;
      while (cIdx < crossings.length && crossings[cIdx] <= px) {
        inside = !inside;
        cIdx++;
      }

      let bestD2 = Infinity;
      for (let i = 0; i < n; i++) {
        const vx = px - axArr[i];
        const vy = py - ayArr[i];
        const il2 = invL2[i];
        let t = il2 > 0 ? (vx * dxArr[i] + vy * dyArr[i]) * il2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ex = vx - t * dxArr[i];
        const ey = vy - t * dyArr[i];
        const d2 = ex * ex + ey * ey;
        if (d2 < bestD2) bestD2 = d2;
      }

      const d = Math.sqrt(bestD2);
      const sd = inside ? d : -d;
      phi[rowOff + gx] = sd;
      if (sd > maxDist) {
        maxDist = sd;
        poleX = px;
        poleY = py;
      }
    }
  }

  if (!(maxDist > 1e-6)) return null;
  const field: MetricSdfField = { x0, y0, cell, gxCount, gyCount, phi, maxDist, poleX, poleY };
  sdfCache.set(cacheKey, field);
  return field;
}

function evalSdfBilinear(sdf: MetricSdfField, x: number, y: number): number {
  const fx = (x - sdf.x0) / sdf.cell;
  const fy = (y - sdf.y0) / sdf.cell;
  if (fx < 0 || fy < 0 || fx >= sdf.gxCount - 1 || fy >= sdf.gyCount - 1) {
    return -sdf.cell;
  }
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const i00 = iy * sdf.gxCount + ix;
  const v00 = sdf.phi[i00];
  const v10 = sdf.phi[i00 + 1];
  const v01 = sdf.phi[i00 + sdf.gxCount];
  const v11 = sdf.phi[i00 + sdf.gxCount + 1];
  return (1 - ty) * ((1 - tx) * v00 + tx * v10) + ty * ((1 - tx) * v01 + tx * v11);
}

/**
 * Extracts a simple closed contour `{ phi = level }` using Marching Squares.
 * Prefers the largest loop; when multiple lobes have similar area (>= 82% of max),
 * tie-breaks toward `preferredPt` so adjacent sections stay on the same lobe.
 */
function extractSdfIsoLoop(
  sdf: MetricSdfField,
  level: number,
  preferredPt?: [number, number],
): [number, number][] | null {
  const { x0, y0, cell, gxCount, gyCount, phi } = sdf;

  // Unique integer vertex keys on grid edges:
  // Horizontal edge (gx, gy)-(gx+1, gy): key = gy * gxCount + gx
  // Vertical edge (gx, gy)-(gx, gy+1):   key = horizCount + gy * gxCount + gx
  const horizOffset = 0;
  const vertOffset = gxCount * gyCount;
  const ptCoords = new Map<number, [number, number]>();
  const adj = new Map<number, number[]>();

  const getHorizKey = (gx: number, gy: number, va: number, vb: number): number => {
    const k = horizOffset + gy * gxCount + gx;
    if (!ptCoords.has(k)) {
      const denom = vb - va;
      const t = Math.abs(denom) > 1e-12 ? clamp((level - va) / denom, 0, 1) : 0.5;
      ptCoords.set(k, [x0 + (gx + t) * cell, y0 + gy * cell]);
    }
    return k;
  };

  const getVertKey = (gx: number, gy: number, va: number, vb: number): number => {
    const k = vertOffset + gy * gxCount + gx;
    if (!ptCoords.has(k)) {
      const denom = vb - va;
      const t = Math.abs(denom) > 1e-12 ? clamp((level - va) / denom, 0, 1) : 0.5;
      ptCoords.set(k, [x0 + gx * cell, y0 + (gy + t) * cell]);
    }
    return k;
  };

  const addSeg = (ka: number, kb: number) => {
    if (ka === kb) return;
    let la = adj.get(ka);
    if (!la) { la = []; adj.set(ka, la); }
    la.push(kb);
    let lb = adj.get(kb);
    if (!lb) { lb = []; adj.set(kb, lb); }
    lb.push(ka);
  };

  for (let gy = 0; gy < gyCount - 1; gy++) {
    const r0 = gy * gxCount;
    const r1 = r0 + gxCount;
    for (let gx = 0; gx < gxCount - 1; gx++) {
      const v00 = phi[r0 + gx];
      const v10 = phi[r0 + gx + 1];
      const v11 = phi[r1 + gx + 1];
      const v01 = phi[r1 + gx];

      const b0 = v00 >= level ? 1 : 0;
      const b1 = v10 >= level ? 2 : 0;
      const b2 = v11 >= level ? 4 : 0;
      const b3 = v01 >= level ? 8 : 0;
      const mask = b0 | b1 | b2 | b3;
      if (mask === 0 || mask === 15) continue;

      const eTop = () => getHorizKey(gx, gy, v00, v10);
      const eRight = () => getVertKey(gx + 1, gy, v10, v11);
      const eBot = () => getHorizKey(gx, gy + 1, v01, v11);
      const eLeft = () => getVertKey(gx, gy, v00, v01);

      switch (mask) {
        case 1:
        case 14:
          addSeg(eLeft(), eTop());
          break;
        case 2:
        case 13:
          addSeg(eTop(), eRight());
          break;
        case 3:
        case 12:
          addSeg(eLeft(), eRight());
          break;
        case 4:
        case 11:
          addSeg(eRight(), eBot());
          break;
        case 6:
        case 9:
          addSeg(eTop(), eBot());
          break;
        case 7:
        case 8:
          addSeg(eLeft(), eBot());
          break;
        case 5: {
          const center = 0.25 * (v00 + v10 + v11 + v01);
          if (center >= level) {
            addSeg(eLeft(), eBot());
            addSeg(eTop(), eRight());
          } else {
            addSeg(eLeft(), eTop());
            addSeg(eRight(), eBot());
          }
          break;
        }
        case 10: {
          const center = 0.25 * (v00 + v10 + v11 + v01);
          if (center >= level) {
            addSeg(eLeft(), eTop());
            addSeg(eRight(), eBot());
          } else {
            addSeg(eLeft(), eBot());
            addSeg(eTop(), eRight());
          }
          break;
        }
      }
    }
  }

  if (adj.size < 3) return null;

  const visitedEdges = new Set<string>();
  const edgeId = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  const candidates: { pts: [number, number][]; area: number }[] = [];
  let maxArea = 0;

  for (const startKey of adj.keys()) {
    const nbs = adj.get(startKey)!;
    for (const firstNext of nbs) {
      if (visitedEdges.has(edgeId(startKey, firstNext))) continue;
      const loopKeys: number[] = [startKey];
      let prev = startKey;
      let cur = firstNext;
      visitedEdges.add(edgeId(prev, cur));

      let closed = false;
      for (let guard = 0; guard < 8192; guard++) {
        if (cur === startKey) {
          closed = true;
          break;
        }
        loopKeys.push(cur);
        const curNbs = adj.get(cur);
        if (!curNbs || curNbs.length === 0) break;
        let chosen = -1;
        for (const cand of curNbs) {
          if (cand !== prev && !visitedEdges.has(edgeId(cur, cand))) {
            chosen = cand;
            break;
          }
        }
        if (chosen < 0 && curNbs.includes(startKey) && !visitedEdges.has(edgeId(cur, startKey))) {
          chosen = startKey;
        }
        if (chosen < 0) break;
        visitedEdges.add(edgeId(cur, chosen));
        prev = cur;
        cur = chosen;
      }

      if (closed && loopKeys.length >= 3) {
        const pts = loopKeys.map((k) => ptCoords.get(k)!);
        const area = Math.abs(shoelaceTwiceArea(pts));
        if (area > maxArea) maxArea = area;
        candidates.push({ pts, area });
      }
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !preferredPt) {
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].area > best.area) best = candidates[i];
    }
    return best.pts;
  }

  const nearBest = candidates.filter((c) => c.area >= maxArea * 0.82);
  let containingLoop: { pts: [number, number][]; area: number } | null = null;
  for (const c of nearBest) {
    if (pointInClosedPolygon(preferredPt[0], preferredPt[1], c.pts)) {
      if (!containingLoop || c.area > containingLoop.area) {
        containingLoop = c;
      }
    }
  }
  if (containingLoop) return containingLoop.pts;

  let closest = nearBest[0];
  let bestDist2 = Infinity;
  for (const c of nearBest) {
    let sxSum = 0;
    let sySum = 0;
    for (const [px, py] of c.pts) {
      sxSum += px;
      sySum += py;
    }
    const cx = sxSum / c.pts.length;
    const cy = sySum / c.pts.length;
    const d2 = (cx - preferredPt[0]) ** 2 + (cy - preferredPt[1]) ** 2;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      closest = c;
    }
  }
  return closest.pts;
}

function clampInnerMetricLoopWithSdf(
  innerMetric: [number, number][],
  sdf: MetricSdfField,
  minMargin: number,
  preferredPt?: [number, number],
): [number, number][] {
  const safeD = Math.min(minMargin, sdf.maxDist * 0.65);
  let needsClamp = false;
  for (const [x, y] of innerMetric) {
    if (evalSdfBilinear(sdf, x, y) < safeD) {
      needsClamp = true;
      break;
    }
  }
  if (!needsClamp) return innerMetric;

  const safeBoundary = extractSdfIsoLoop(sdf, safeD, preferredPt);
  if (!safeBoundary || safeBoundary.length < 3) {
    const r = Math.max(1e-4, sdf.maxDist * 0.25);
    return innerMetric.map((_, i) => {
      const ang = -(i * Math.PI * 2) / innerMetric.length;
      return [sdf.poleX + Math.cos(ang) * r, sdf.poleY + Math.sin(ang) * r];
    });
  }

  const m = safeBoundary.length;
  return innerMetric.map(([px, py]) => {
    if (evalSdfBilinear(sdf, px, py) >= safeD) {
      return [px, py];
    }
    let bestX = safeBoundary[0][0];
    let bestY = safeBoundary[0][1];
    let bestD2 = Infinity;
    for (let i = 0; i < m; i++) {
      const [ax, ay] = safeBoundary[i];
      const [bx, by] = safeBoundary[(i + 1) % m];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 1e-14 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = qx;
        bestY = qy;
      }
    }
    return [bestX, bestY];
  });
}

function serializeLoftNodesKey(nodes: LoftNode[] | undefined): string {
  if (!Array.isArray(nodes) || nodes.length === 0) return '-';
  let s = `${nodes.length}:`;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    s += `${Math.round(n.u * 1e4)},${Math.round(n.v * 1e4)},${n.mode}`;
    if (n.mode === 'bezier') {
      s += `,${Math.round((n.inDu ?? 0) * 1e4)},${Math.round((n.inDv ?? 0) * 1e4)},${Math.round((n.outDu ?? 0) * 1e4)},${Math.round((n.outDv ?? 0) * 1e4)}`;
    }
    s += ';';
  }
  return s;
}

function getSectionMetricSdf(sec: LoftSection, sx: number, sy: number): MetricSdfField | null {
  const outerUntransformed = sampleClosedNodesUniform(sec.nodes, 72);
  const outerMetric: [number, number][] = outerUntransformed.map((pt) => {
    const [lu, lv] = applySectionTransform(pt, sec);
    return [lu * sx, lv * sy];
  });
  return buildClosedPolygonSdf(outerMetric, 68);
}

/**
 * Computes a column-wide reference inscribed radius in metric `(lsu, lsv)` units across all sections
 * so `'parallel'` mode maintains a consistent physical wall thickness from base to top even on tapered columns.
 */
export function computeColumnRefRadiusMetric(
  rawSections: LoftSection[],
  lsu = 1,
  lsv = 1,
): number | undefined {
  const sx = Math.max(0.125, lsu);
  const sy = Math.max(0.125, lsv);
  let maxR = 0;
  for (const sec of rawSections) {
    if (!sec || !Array.isArray(sec.nodes) || sec.nodes.length < 3) continue;
    const sdf = getSectionMetricSdf(sec, sx, sy);
    if (sdf && sdf.maxDist > maxR) {
      maxR = sdf.maxDist;
    }
  }
  return maxR > 1e-5 ? maxR : undefined;
}

/**
 * Finds the safest interior anchor (Pole of Inaccessibility when `(0.5, 0.5)` falls near/outside
 * a concave indentation such as C/U-arch or L-shape) and safe relative radius scale in section-local space.
 */
export function getSectionInteriorCenterLocal(
  sec: LoftSection,
  lsu = 1,
  lsv = 1,
): { center: [number, number]; safeScale: number } {
  const sx = Math.max(0.125, lsu);
  const sy = Math.max(0.125, lsv);
  const sdf = getSectionMetricSdf(sec, sx, sy);
  if (!sdf) return { center: [0.5, 0.5], safeScale: 1 };

  const [cxL, cyL] = applySectionTransform([0.5, 0.5], sec);
  const centerDist = evalSdfBilinear(sdf, cxL * sx, cyL * sy);
  if (centerDist >= sdf.maxDist * 0.45) {
    return { center: [0.5, 0.5], safeScale: 1 };
  }

  const poleLocal = applySectionTransformInverse([sdf.poleX / sx, sdf.poleY / sy], sec);
  const nominalR = 0.44 * Math.min(sx, sy) * Math.max(0.25, sec.scale);
  const safeScale = clamp(sdf.maxDist / Math.max(1e-5, nominalR), 0.18, 1);
  return {
    center: [clamp(poleLocal[0], 0.05, 0.95), clamp(poleLocal[1], 0.05, 0.95)],
    safeScale,
  };
}

const sectionInnerCache = new BoundedLru<[number, number][]>(256);

/**
 * Samples the inner cutout loop of a LoftSection (either in transformed shape-local space
 * when `applyTransform = true` or in untransformed section-local [0..1]x[0..1] space when `applyTransform = false`).
 * Enforces canonical winding (`shoelaceTwiceArea < 0`) and guarantees the inner loop stays strictly inside the outer wall.
 */
export function sampleSectionInnerUniform(
  sec: LoftSection,
  sampleCount: number,
  applyTransform = true,
  lsu = 1,
  lsv = 1,
  columnRefRadiusMetric?: number,
  preferredMetricPt?: [number, number],
): [number, number][] {
  const sx = Math.max(0.125, lsu);
  const sy = Math.max(0.125, lsv);
  const mode: LoftInnerMode = sec.innerMode ?? 'parallel';
  const thick = clamp(Number.isFinite(sec.innerThickness) ? sec.innerThickness! : 0.25, 0.06, 0.78);
  const prefKey = preferredMetricPt
    ? `${Math.round(preferredMetricPt[0] * 200)},${Math.round(preferredMetricPt[1] * 200)}`
    : '-';
  const refKey = columnRefRadiusMetric !== undefined ? Math.round(columnRefRadiusMetric * 1e4) : -1;
  const cacheKey = `${serializeLoftNodesKey(sec.nodes)}|${Math.round(sec.scale * 1e4)},${Math.round(sec.twistDeg * 100)},${Math.round(sec.offsetU * 1e4)},${Math.round(sec.offsetV * 1e4)}|${mode}|${Math.round(thick * 1e4)}|${mode === 'custom' ? serializeLoftNodesKey(sec.innerNodes) : '-'}|${applyTransform ? 1 : 0}|${Math.round(sx * 1000)}|${Math.round(sy * 1000)}|${sampleCount}|${refKey}|${prefKey}`;

  const cached = sectionInnerCache.get(cacheKey);
  if (cached) {
    return cached.map(([u, v]) => [u, v] as [number, number]);
  }

  const outerUntransformed = sampleClosedNodesUniform(sec.nodes, Math.max(72, Math.min(96, sampleCount)));
  const outerMetric: [number, number][] = outerUntransformed.map((pt) => {
    const [lu, lv] = applySectionTransform(pt, sec);
    return [lu * sx, lv * sy];
  });

  const sdf = buildClosedPolygonSdf(outerMetric, 68);

  const fromMetricToTarget = (metricPts: [number, number][]): [number, number][] => {
    const mapped = metricPts.map(([mx, my]) => {
      const lu = mx / sx;
      const lv = my / sy;
      return applyTransform ? ([lu, lv] as [number, number]) : applySectionTransformInverse([lu, lv], sec);
    });
    return resampleClosedLoopUniform(mapped, sampleCount);
  };

  let result: [number, number][];

  if (!sdf) {
    const fallback = sampleClosedNodesUniform(createScaledLoftInnerPresetNodes('circle', thick), sampleCount);
    result = applyTransform ? fallback.map((pt) => applySectionTransform(pt, sec)) : fallback;
  } else {
    const minWallMetric = Math.min(sdf.maxDist * 0.5, Math.max(0.015 * Math.min(sx, sy), sdf.maxDist * 0.08));

    if (mode === 'custom' && Array.isArray(sec.innerNodes) && sec.innerNodes.length >= 3) {
      const rawCustom = sampleClosedNodesUniform(sec.innerNodes, sampleCount);
      const customMetric: [number, number][] = rawCustom.map((pt) => {
        const [lu, lv] = applySectionTransform(pt, sec);
        return [lu * sx, lv * sy];
      });
      const clampedMetric = clampInnerMetricLoopWithSdf(customMetric, sdf, minWallMetric, preferredMetricPt);
      result = fromMetricToTarget(clampedMetric);
    } else if (mode === 'parallel') {
      const refR =
        columnRefRadiusMetric !== undefined && columnRefRadiusMetric > 1e-5
          ? columnRefRadiusMetric
          : sdf.maxDist / clamp(sec.scale, 0.35, 1.6);
      const D = clamp(thick * refR * 1.05, minWallMetric, sdf.maxDist * 0.78);
      const pref = preferredMetricPt ?? [sdf.poleX, sdf.poleY];
      const isoLoop =
        extractSdfIsoLoop(sdf, D, pref) ??
        extractSdfIsoLoop(sdf, Math.min(D, sdf.maxDist * 0.52), pref);
      if (isoLoop && isoLoop.length >= 3) {
        result = fromMetricToTarget(isoLoop);
      } else {
        // Pole ellipse fallback stays smoothly inside narrow slivers instead of teleporting via proportional
        const r = Math.max(1e-4, sdf.maxDist * 0.25);
        const poleRing: [number, number][] = [];
        const steps = 16;
        for (let i = 0; i < steps; i++) {
          const ang = -(i * Math.PI * 2) / steps;
          poleRing.push([sdf.poleX + Math.cos(ang) * r, sdf.poleY + Math.sin(ang) * r]);
        }
        result = fromMetricToTarget(clampInnerMetricLoopWithSdf(poleRing, sdf, minWallMetric, pref));
      }
    } else {
      // 'proportional' mode: contract toward centroid when strictly inside;
      // on deeply concave non-star shapes (c_arch, u_arch, l_shape, kidney), cleanly switch to SDF iso-contour
      // instead of folding the contracted boundary onto the outer wall.
      let cx = 0;
      let cy = 0;
      for (const [mx, my] of outerMetric) {
        cx += mx;
        cy += my;
      }
      cx /= outerMetric.length;
      cy /= outerMetric.length;
      if (evalSdfBilinear(sdf, cx, cy) < sdf.maxDist * 0.35) {
        cx = sdf.poleX;
        cy = sdf.poleY;
      }
      const scale = clamp(1 - thick, 0.16, 0.94);
      const propMetric: [number, number][] = outerMetric.map(([mx, my]) => [
        cx + (mx - cx) * scale,
        cy + (my - cy) * scale,
      ]);
      const safeD = Math.min(minWallMetric, sdf.maxDist * 0.65);
      let violations = 0;
      for (const [mx, my] of propMetric) {
        if (evalSdfBilinear(sdf, mx, my) < safeD) violations++;
      }
      if (violations > propMetric.length * 0.18) {
        const pref = preferredMetricPt ?? [sdf.poleX, sdf.poleY];
        const isoProp =
          extractSdfIsoLoop(sdf, clamp(thick * sdf.maxDist * 0.95, minWallMetric, sdf.maxDist * 0.78), pref) ??
          clampInnerMetricLoopWithSdf(propMetric, sdf, minWallMetric, pref);
        result = fromMetricToTarget(isoProp);
      } else {
        const clampedProp = clampInnerMetricLoopWithSdf(propMetric, sdf, minWallMetric, preferredMetricPt);
        result = fromMetricToTarget(clampedProp);
      }
    }
  }

  sectionInnerCache.set(cacheKey, result);
  return result.map(([u, v]) => [u, v] as [number, number]);
}

function fitClosedEditableNodesFromLoop(rawPts: [number, number][], maxNodes = 14): LoftNode[] {
  const dedup: [number, number][] = [];
  for (const p of rawPts) {
    const cl: [number, number] = [clamp(p[0], -0.25, 1.25), clamp(p[1], -0.25, 1.25)];
    if (dedup.length === 0 || Math.hypot(cl[0] - dedup[dedup.length - 1][0], cl[1] - dedup[dedup.length - 1][1]) >= 0.006) {
      dedup.push(cl);
    }
  }
  if (dedup.length >= 2 && Math.hypot(dedup[0][0] - dedup[dedup.length - 1][0], dedup[0][1] - dedup[dedup.length - 1][1]) < 0.012) {
    dedup.pop();
  }
  if (dedup.length < 3) {
    return createLoftPresetNodes('circle');
  }

  let splitIdx = Math.floor(dedup.length / 2);
  let bestD2 = -1;
  for (let i = 1; i < dedup.length; i++) {
    const du = dedup[i][0] - dedup[0][0];
    const dv = dedup[i][1] - dedup[0][1];
    const d2 = du * du + dv * dv;
    if (d2 > bestD2) {
      bestD2 = d2;
      splitIdx = i;
    }
  }

  let eps = 0.008;
  let simplified: [number, number][] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const halfA = rdpOpen(dedup.slice(0, splitIdx + 1), eps);
    const halfB = rdpOpen([...dedup.slice(splitIdx), dedup[0]], eps);
    simplified = [...halfA.slice(0, -1), ...halfB.slice(0, -1)];
    if (simplified.length <= maxNodes) break;
    eps *= 1.3;
  }

  if (simplified.length < 3) {
    return createLoftPresetNodes('circle');
  }
  if (simplified.length > maxNodes) {
    const stride = simplified.length / maxNodes;
    simplified = Array.from({ length: maxNodes }, (_, i) => simplified[Math.floor(i * stride)]);
  }

  const n = simplified.length;
  return simplified.map((pt, i) => {
    const prev = simplified[(i - 1 + n) % n];
    const next = simplified[(i + 1) % n];
    const v1u = prev[0] - pt[0], v1v = prev[1] - pt[1];
    const v2u = next[0] - pt[0], v2v = next[1] - pt[1];
    const l1 = Math.hypot(v1u, v1v) || 1;
    const l2 = Math.hypot(v2u, v2v) || 1;
    const cosAng = clamp((v1u * v2u + v1v * v2v) / (l1 * l2), -1, 1);
    const deg = (Math.acos(cosAng) * 180) / Math.PI;
    return {
      u: Math.round(pt[0] * 1000) / 1000,
      v: Math.round(pt[1] * 1000) / 1000,
      mode: deg < 125 ? 'corner' : 'smooth',
    };
  });
}

/**
 * Unlocks a section's automatic inner curve ('parallel' or 'proportional') into clean editable LoftNode[]
 * in section-local [0..1]x[0..1] coordinates, matching the displayed inner loop without visual jump.
 */
export function fitEditableNodesFromSectionInner(
  sec: LoftSection,
  lsu = 1,
  lsv = 1,
  columnRefRadiusMetric?: number,
): LoftNode[] {
  const innerUntransformed = sampleSectionInnerUniform(sec, 72, false, lsu, lsv, columnRefRadiusMetric);
  if ((sec.innerMode ?? 'parallel') === 'proportional') {
    const scaledCandidate = createScaledNodesFromOuter(sec.nodes, sec.innerThickness ?? 0.25);
    const scaledSample = sampleClosedNodesUniform(scaledCandidate, 72);
    if (scaledSample.length === innerUntransformed.length) {
      let maxErr2 = 0;
      for (let i = 0; i < scaledSample.length; i += 2) {
        const [su, sv] = scaledSample[i];
        let minD2 = Infinity;
        for (let j = 0; j < innerUntransformed.length; j += 2) {
          const du = su - innerUntransformed[j][0];
          const dv = sv - innerUntransformed[j][1];
          const d2 = du * du + dv * dv;
          if (d2 < minD2) minD2 = d2;
        }
        if (minD2 > maxErr2) maxErr2 = minD2;
      }
      if (maxErr2 < 0.012 * 0.012) {
        return scaledCandidate;
      }
    }
  }
  return fitClosedEditableNodesFromLoop(innerUntransformed, 14);
}

function catmullRomClamped(p0: number, p1: number, p2: number, p3: number, alpha: number): number {
  const m1Raw = 0.5 * (p2 - p0);
  const m2Raw = 0.5 * (p3 - p1);
  const chord = Math.abs(p2 - p1);
  const limit = Math.max(0.02, chord * 1.25);
  const m1 = clamp(m1Raw, -limit, limit);
  const m2 = clamp(m2Raw, -limit, limit);
  const a2 = alpha * alpha;
  const a3 = a2 * alpha;
  const h00 = 2 * a3 - 3 * a2 + 1;
  const h10 = a3 - 2 * a2 + alpha;
  const h01 = -2 * a3 + 3 * a2;
  const h11 = a3 - a2;
  return h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
}

const lastSeamShiftFrac = new BoundedLru<number>(256);

function ringGeomSig(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return '0';
  const i1 = Math.floor(n * 0.25);
  const i2 = Math.floor(n * 0.5);
  const i3 = Math.floor(n * 0.75);
  return `${n}:${Math.round(pts[0][0] * 200)},${Math.round(pts[0][1] * 200)}:${Math.round(pts[i1][0] * 200)},${Math.round(pts[i1][1] * 200)}:${Math.round(pts[i2][0] * 200)},${Math.round(pts[i2][1] * 200)}:${Math.round(pts[i3][0] * 200)},${Math.round(pts[i3][1] * 200)}`;
}

function findAlignedShift(
  prev: [number, number][],
  cur: [number, number][],
  pairIdKey?: string,
): number {
  const sampleCount = Math.min(prev.length, cur.length);
  if (sampleCount <= 1) return 0;

  const pairKey = pairIdKey ? `${pairIdKey}|${ringGeomSig(prev)}->${ringGeomSig(cur)}` : undefined;
  const cachedFrac = pairKey ? lastSeamShiftFrac.get(pairKey) : undefined;

  const evalCost = (shift: number): number => {
    let cost = 0;
    for (let j = 0; j < sampleCount; j++) {
      const a = prev[j];
      const b = cur[(j + shift) % sampleCount];
      const du = b[0] - a[0];
      const dv = b[1] - a[1];
      cost += du * du + dv * dv;
    }
    return cost;
  };

  let bestShift = 0;
  let bestCost = evalCost(0);

  if (sampleCount <= 64) {
    for (let shift = 1; shift < sampleCount; shift++) {
      const cost = evalCost(shift);
      if (bestShift === 0) {
        if (cost < bestCost * 0.97 - 1e-9) {
          bestCost = cost;
          bestShift = shift;
        }
      } else if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestShift = shift;
      }
    }
  } else {
    const coarseN = 64;
    const coarseList: { shift: number; cost: number }[] = [];
    for (let c = 0; c < coarseN; c++) {
      const s = Math.round((c / coarseN) * sampleCount) % sampleCount;
      coarseList.push({ shift: s, cost: evalCost(s) });
    }
    coarseList.sort((a, b) => a.cost - b.cost);

    const visited = new Set<number>([0]);
    const evalCandidate = (s: number) => {
      const shift = ((s % sampleCount) + sampleCount) % sampleCount;
      if (visited.has(shift)) return;
      visited.add(shift);
      const cost = evalCost(shift);
      if (bestShift === 0) {
        if (cost < bestCost * 0.97 - 1e-9) {
          bestCost = cost;
          bestShift = shift;
        }
      } else if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestShift = shift;
      }
    };

    const topK = Math.min(3, coarseList.length);
    for (let k = 0; k < topK; k++) {
      const center = coarseList[k].shift;
      for (let d = -4; d <= 4; d++) {
        evalCandidate(center + d);
      }
    }

    if (cachedFrac !== undefined) {
      const cached = Math.round(cachedFrac * sampleCount);
      for (let d = -2; d <= 2; d++) {
        evalCandidate(cached + d);
      }
    }
  }

  // Hysteresis against the previous cached seam fraction so small edits never cause sudden twist flips
  if (cachedFrac !== undefined) {
    const cachedShift = ((Math.round(cachedFrac * sampleCount) % sampleCount) + sampleCount) % sampleCount;
    const cachedCost = evalCost(cachedShift);
    if (bestShift !== cachedShift && bestCost >= cachedCost * 0.92 - 1e-9) {
      bestShift = cachedShift;
    }
  }

  if (pairKey) {
    lastSeamShiftFrac.set(pairKey, bestShift / sampleCount);
  }

  return bestShift;
}

export function getLoftLocalBounds(
  rawSections?: LoftSection[] | null,
  interp: LoftInterpMode = 'smooth',
): { minU: number; maxU: number; minV: number; maxV: number } {
  const rawList = Array.isArray(rawSections) && rawSections.length > 0 ? rawSections : createDefaultLoftSections();
  const secs = rawList.some((s) => s?.isTransition)
    ? (() => {
        const cloned = cloneLoftSections(normalizeLoftSections(rawList));
        syncLoftTransitionSections(cloned, 1, 1);
        return cloned;
      })()
    : rawList;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const stepsPerSeg = 8;

  for (const sec of secs) {
    if (!sec || !Array.isArray(sec.nodes) || sec.nodes.length < 3) continue;
    const segs = evaluateSectionBezierSegments(sec.nodes);
    for (const seg of segs) {
      for (let k = 0; k < stepsPerSeg; k++) {
        const raw = evalCubic(seg.p0, seg.c1, seg.c2, seg.p1, k / stepsPerSeg);
        const [tu, tv] = applySectionTransform(raw, sec);
        if (tu < minU) minU = tu;
        if (tu > maxU) maxU = tu;
        if (tv < minV) minV = tv;
        if (tv > maxV) maxV = tv;
      }
    }
  }

  if (!Number.isFinite(minU)) {
    return { minU: 0, maxU: 1, minV: 0, maxV: 1 };
  }
  // Account for slight vertical Catmull-Rom overshoot when >= 3 sections exist
  if (interp === 'smooth' && secs.length >= 3) {
    minU -= 0.04;
    maxU += 0.04;
    minV -= 0.04;
    maxV += 0.04;
  }
  return { minU, maxU, minV, maxV };
}

function reverseClosedLoftNodes(nodes: LoftNode[]): LoftNode[] {
  const n = nodes.length;
  const out: LoftNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = nodes[n - 1 - i];
    const cp: LoftNode = { u: src.u, v: src.v, mode: src.mode };
    if (src.mode === 'bezier') {
      cp.inDu = src.outDu ?? 0;
      cp.inDv = src.outDv ?? 0;
      cp.outDu = src.inDu ?? 0;
      cp.outDv = src.inDv ?? 0;
    }
    out[i] = cp;
  }
  return out;
}

function interpolateNodePair(
  aNodes: LoftNode[],
  bNodes: LoftNode[],
  alpha = 0.5,
): LoftNode[] {
  if (aNodes.length < 3) return bNodes.map(cloneLoftNode);
  if (bNodes.length < 3) return aNodes.map(cloneLoftNode);
  if (alpha <= 1e-4) return aNodes.map(cloneLoftNode);
  if (alpha >= 1 - 1e-4) return bNodes.map(cloneLoftNode);

  if (aNodes.length === bNodes.length) {
    const n = aNodes.length;
    const areaA = shoelaceTwiceArea(aNodes.map((nd) => [nd.u, nd.v]));
    const areaB = shoelaceTwiceArea(bNodes.map((nd) => [nd.u, nd.v]));
    const bOriented = areaA * areaB < 0 ? reverseClosedLoftNodes(bNodes) : bNodes;

    let bestShift = -1;
    let bestDist2 = Infinity;
    for (let shift = 0; shift < n; shift++) {
      let modesMatch = true;
      let dist2 = 0;
      for (let i = 0; i < n; i++) {
        const na = aNodes[i];
        const nb = bOriented[(i + shift) % n];
        if (na.mode !== nb.mode) {
          modesMatch = false;
          break;
        }
        const du = na.u - nb.u;
        const dv = na.v - nb.v;
        dist2 += du * du + dv * dv;
      }
      if (modesMatch && dist2 < bestDist2) {
        bestDist2 = dist2;
        bestShift = shift;
      }
    }

    if (bestShift >= 0) {
      const out: LoftNode[] = [];
      for (let i = 0; i < n; i++) {
        const na = aNodes[i];
        const nb = bOriented[(i + bestShift) % n];
        const nd: LoftNode = {
          u: Math.round(((1 - alpha) * na.u + alpha * nb.u) * 1000) / 1000,
          v: Math.round(((1 - alpha) * na.v + alpha * nb.v) * 1000) / 1000,
          mode: na.mode,
        };
        if (na.mode === 'bezier') {
          nd.inDu = Math.round(((1 - alpha) * (na.inDu ?? 0) + alpha * (nb.inDu ?? 0)) * 10000) / 10000;
          nd.inDv = Math.round(((1 - alpha) * (na.inDv ?? 0) + alpha * (nb.inDv ?? 0)) * 10000) / 10000;
          nd.outDu = Math.round(((1 - alpha) * (na.outDu ?? 0) + alpha * (nb.outDu ?? 0)) * 10000) / 10000;
          nd.outDv = Math.round(((1 - alpha) * (na.outDv ?? 0) + alpha * (nb.outDv ?? 0)) * 10000) / 10000;
        }
        out.push(nd);
      }
      return out;
    }
  }

  // Dense curvature-aware landmark fitting for dissimilar node counts / modes
  const M = 72;
  const ptsA = sampleClosedNodesUniform(aNodes, M);
  const ptsB = sampleClosedNodesUniform(bNodes, M);
  if (ptsA.length < 3 || ptsB.length < 3) {
    return aNodes.map(cloneLoftNode);
  }
  const shift = findAlignedShift(ptsA, ptsB);
  const blendPts: [number, number][] = ptsA.map((pa, j) => {
    const pb = ptsB[(j + shift) % M];
    return [(1 - alpha) * pa[0] + alpha * pb[0], (1 - alpha) * pa[1] + alpha * pb[1]];
  });

  // Compute local turning angle (deg) on the dense loop so sharp corners/star tips stay sharp
  const turnDeg = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    const prev = blendPts[(j - 1 + M) % M];
    const cur = blendPts[j];
    const next = blendPts[(j + 1) % M];
    const ax = cur[0] - prev[0];
    const ay = cur[1] - prev[1];
    const bx = next[0] - cur[0];
    const by = next[1] - cur[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la > 1e-6 && lb > 1e-6) {
      const cosA = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
      turnDeg[j] = (Math.acos(cosA) * 180) / Math.PI;
    }
  }

  const maxRaw = Math.max(aNodes.length, bNodes.length);
  const K = maxRaw <= 8 ? 12 : clamp(maxRaw * 2, 16, 24);
  const picked: number[] = [];
  for (let k = 0; k < K; k++) {
    const base = Math.round((k * M) / K) % M;
    let bestIdx = base;
    let bestScore = turnDeg[base];
    for (const off of [-1, 1]) {
      const cand = (base + off + M) % M;
      if (turnDeg[cand] > 22 && turnDeg[cand] > bestScore + 4) {
        bestScore = turnDeg[cand];
        bestIdx = cand;
      }
    }
    if (picked.length > 0 && bestIdx <= picked[picked.length - 1]) {
      bestIdx = (picked[picked.length - 1] + 2) % M;
      if (bestIdx <= picked[picked.length - 1]) continue;
    }
    picked.push(bestIdx);
  }
  while (picked.length > K) picked.pop();
  if (picked.length < 3) {
    return blendPts
      .filter((_, idx) => idx % 6 === 0)
      .map(([u, v]) => ({ u: Math.round(u * 1000) / 1000, v: Math.round(v * 1000) / 1000, mode: 'smooth' as const }));
  }

  const out: LoftNode[] = [];
  const pn = picked.length;
  for (let mIdx = 0; mIdx < pn; mIdx++) {
    const idx = picked[mIdx];
    const p = blendPts[idx];
    const pPrev = blendPts[picked[(mIdx - 1 + pn) % pn]];
    const pNext = blendPts[picked[(mIdx + 1) % pn]];
    const dIn = Math.hypot(p[0] - pPrev[0], p[1] - pPrev[1]);
    const dOut = Math.hypot(pNext[0] - p[0], pNext[1] - p[1]);
    if (turnDeg[idx] > 42) {
      out.push({
        u: Math.round(p[0] * 1000) / 1000,
        v: Math.round(p[1] * 1000) / 1000,
        mode: 'corner',
      });
    } else {
      const nbPrev = blendPts[(idx - 1 + M) % M];
      const nbNext = blendPts[(idx + 1) % M];
      let tx = nbNext[0] - nbPrev[0];
      let ty = nbNext[1] - nbPrev[1];
      let tLen = Math.hypot(tx, ty);
      if (tLen < 1e-6) {
        tx = pNext[0] - pPrev[0];
        ty = pNext[1] - pPrev[1];
        tLen = Math.hypot(tx, ty) || 1;
      }
      const ux = tx / tLen;
      const uy = ty / tLen;
      const hIn = Math.min(dIn * 0.34, 0.35);
      const hOut = Math.min(dOut * 0.34, 0.35);
      out.push({
        u: Math.round(p[0] * 1000) / 1000,
        v: Math.round(p[1] * 1000) / 1000,
        mode: 'bezier',
        inDu: Math.round(-ux * hIn * 10000) / 10000,
        inDv: Math.round(-uy * hIn * 10000) / 10000,
        outDu: Math.round(ux * hOut * 10000) / 10000,
        outDv: Math.round(uy * hOut * 10000) / 10000,
      });
    }
  }
  return out;
}

export function interpolateLoftSectionNodes(
  secA: LoftSection,
  secB: LoftSection,
  alpha = 0.5,
): LoftNode[] {
  return interpolateNodePair(secA.nodes, secB.nodes, alpha);
}

export function interpolateLoftSectionInner(
  secA: LoftSection,
  secB: LoftSection,
  alpha = 0.5,
  lsu = 1,
  lsv = 1,
  columnRefRadiusMetric?: number,
): { innerMode: LoftInnerMode; innerThickness: number; innerNodes?: LoftNode[] } {
  const modeA = secA.innerMode ?? 'parallel';
  const modeB = secB.innerMode ?? 'parallel';
  const thickA = secA.innerThickness ?? 0.25;
  const thickB = secB.innerThickness ?? 0.25;
  const innerThickness = Math.round(((1 - alpha) * thickA + alpha * thickB) * 100) / 100;

  if (modeA === 'custom' || modeB === 'custom') {
    const nodesA =
      modeA === 'custom' && secA.innerNodes && secA.innerNodes.length >= 3
        ? secA.innerNodes
        : fitEditableNodesFromSectionInner(secA, lsu, lsv, columnRefRadiusMetric);
    const nodesB =
      modeB === 'custom' && secB.innerNodes && secB.innerNodes.length >= 3
        ? secB.innerNodes
        : fitEditableNodesFromSectionInner(secB, lsu, lsv, columnRefRadiusMetric);
    return {
      innerMode: 'custom',
      innerThickness,
      innerNodes: interpolateNodePair(nodesA, nodesB, alpha),
    };
  }

  return {
    innerMode: modeA === modeB ? modeA : 'parallel',
    innerThickness,
  };
}

/**
 * Finds the nearest lower and upper non-transition control sections bracketing `sectionId`,
 * along with its height interpolation fraction `alpha ∈ [0, 1]`. Returns null for top/bottom endpoints.
 */
export function getLoftTransitionNeighbors(
  secs: LoftSection[],
  sectionId: string,
): { prev: LoftSection; next: LoftSection; alpha: number } | null {
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

export function canLoftSectionBeTransition(secs: LoftSection[], sectionId: string): boolean {
  return getLoftTransitionNeighbors(secs, sectionId) !== null;
}

/**
 * Recomputes curves (outer + inner) for every section flagged `isTransition === true`
 * based on its nearest lower and upper non-transition sections. Automatically clears `isTransition`
 * if a section sits at the top or bottom endpoint where no bracketing pair exists.
 */
export function syncLoftTransitionSections(
  secs: LoftSection[],
  lsu = 1,
  lsv = 1,
): void {
  if (!Array.isArray(secs) || secs.length === 0) return;
  const sorted = secs
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

  const anchors = sorted.filter((s) => !s.isTransition);
  const sx = Math.max(0.125, lsu);
  const sy = Math.max(0.125, lsv);
  const colRefR = computeColumnRefRadiusMetric(anchors.length > 0 ? anchors : sorted, sx, sy);

  for (let k = 1; k < sorted.length - 1; k++) {
    const sec = sorted[k];
    if (!sec.isTransition) continue;
    const nb = getLoftTransitionNeighbors(sorted, sec.id);
    if (!nb) {
      delete sec.isTransition;
      continue;
    }
    sec.nodes = interpolateLoftSectionNodes(nb.prev, nb.next, nb.alpha);
    if (
      nb.prev.innerMode !== undefined ||
      nb.next.innerMode !== undefined ||
      sec.innerMode !== undefined
    ) {
      const inner = interpolateLoftSectionInner(nb.prev, nb.next, nb.alpha, sx, sy, colRefR);
      sec.innerMode = inner.innerMode;
      sec.innerThickness = inner.innerThickness;
      if (inner.innerNodes) {
        sec.innerNodes = inner.innerNodes;
      } else {
        delete sec.innerNodes;
      }
    }
  }
}

export function convertLoftSectionToTransition(
  secs: LoftSection[],
  sectionId: string,
  lsu = 1,
  lsv = 1,
  syncTransform = false,
): boolean {
  const nb = getLoftTransitionNeighbors(secs, sectionId);
  const target = secs.find((s) => s.id === sectionId);
  if (!nb || !target) return false;
  target.isTransition = true;
  if (syncTransform) {
    target.scale = Math.round(((1 - nb.alpha) * nb.prev.scale + nb.alpha * nb.next.scale) * 100) / 100;
    target.twistDeg = Math.round((1 - nb.alpha) * nb.prev.twistDeg + nb.alpha * nb.next.twistDeg);
    target.offsetU = Math.round(((1 - nb.alpha) * nb.prev.offsetU + nb.alpha * nb.next.offsetU) * 100) / 100;
    target.offsetV = Math.round(((1 - nb.alpha) * nb.prev.offsetV + nb.alpha * nb.next.offsetV) * 100) / 100;
  }
  syncLoftTransitionSections(secs, lsu, lsv);
  return true;
}

function interpolateLoopSequence(
  secs: LoftSection[],
  loops: [number, number][][],
  sampleCount: number,
  totalRingBudget: number,
  interp: LoftInterpMode,
): LoftRing[] {
  const m = secs.length;
  const rings: LoftRing[] = [];
  if (m === 1) {
    const steps = clamp(Math.round(totalRingBudget * 0.25), 4, 24);
    for (let st = 0; st <= steps; st++) {
      rings.push({ t: st / steps, pts: loops[0] });
    }
    return rings;
  }

  rings.push({ t: secs[0].t, pts: loops[0] });
  for (let k = 0; k < m - 1; k++) {
    const dt = secs[k + 1].t - secs[k].t;
    const steps = dt < 1e-4 ? 1 : clamp(Math.ceil(dt * totalRingBudget), 2, 96);
    const qPrev = loops[Math.max(0, k - 1)];
    const q0 = loops[k];
    const q1 = loops[k + 1];
    const qNext = loops[Math.min(m - 1, k + 2)];

    for (let st = 1; st <= steps; st++) {
      const alpha = st / steps;
      const t = secs[k].t + alpha * dt;
      if (st === steps) {
        rings.push({ t: secs[k + 1].t, pts: q1 });
        continue;
      }
      const pts: [number, number][] = new Array(sampleCount);
      if (interp === 'linear' || m === 2 || dt < 1e-4) {
        for (let j = 0; j < sampleCount; j++) {
          pts[j] = [
            q0[j][0] + (q1[j][0] - q0[j][0]) * alpha,
            q0[j][1] + (q1[j][1] - q0[j][1]) * alpha,
          ];
        }
      } else {
        for (let j = 0; j < sampleCount; j++) {
          pts[j] = [
            catmullRomClamped(qPrev[j][0], q0[j][0], q1[j][0], qNext[j][0], alpha),
            catmullRomClamped(qPrev[j][1], q0[j][1], q1[j][1], qNext[j][1], alpha),
          ];
        }
      }
      rings.push({ t, pts });
    }
  }
  return rings;
}

const alignedRingsCache = new BoundedLru<AlignedLoftResult>(64);

function buildColumnSignature(secs: LoftSection[]): string {
  let s = `${secs.length}|`;
  for (let k = 0; k < secs.length; k++) {
    const sec = secs[k];
    s += `${sec.id}@${Math.round(sec.t * 1e4)}#${Math.round(sec.scale * 1e3)}${sec.isTransition ? 'T' : ''}:${serializeLoftNodesKey(sec.nodes)}|`;
  }
  return s;
}

export function buildAlignedLoftRings(
  rawSections: LoftSection[],
  sampleCount: number,
  totalRingBudget: number,
  interp: LoftInterpMode,
  hollow = false,
  lsu = 1,
  lsv = 1,
  floorT = 0,
): AlignedLoftResult {
  const secs = normalizeLoftSections(rawSections)
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => (a.s.t !== b.s.t ? a.s.t - b.s.t : a.idx - b.idx))
    .map((x) => x.s);

  const m = secs.length;
  const clampedFloorT = clamp(Number.isFinite(floorT) ? floorT : 0, 0, 0.90);
  const sx = Math.max(0.125, lsu);
  const sy = Math.max(0.125, lsv);
  syncLoftTransitionSections(secs, sx, sy);

  let cacheKey = `${sampleCount}|${totalRingBudget}|${interp}|${hollow ? 1 : 0}|${Math.round(sx * 1000)}|${Math.round(sy * 1000)}|${hollow ? Math.round(clampedFloorT * 1e4) : 0}|${m}:`;
  for (let k = 0; k < m; k++) {
    const sec = secs[k];
    cacheKey += `${sec.id},${sec.isTransition ? 1 : 0},${Math.round(sec.t * 1e4)},${Math.round(sec.scale * 1e4)},${Math.round(sec.twistDeg * 100)},${Math.round(sec.offsetU * 1e4)},${Math.round(sec.offsetV * 1e4)},${serializeLoftNodesKey(sec.nodes)}`;
    if (hollow) {
      const im = sec.innerMode ?? 'parallel';
      const it = clamp(Number.isFinite(sec.innerThickness) ? sec.innerThickness! : 0.25, 0.06, 0.78);
      cacheKey += `,${im},${Math.round(it * 1e4)},${im === 'custom' ? serializeLoftNodesKey(sec.innerNodes) : '-'}`;
    }
    cacheKey += ';';
  }

  const cached = alignedRingsCache.get(cacheKey);
  if (cached) return cached;

  const colSig = buildColumnSignature(secs);

  // 1. Sample untransformed outer sections & align cyclic seams with hysteresis scoped to this column signature
  const unAligned = secs.map((sec) => sampleClosedSectionUniform(sec, sampleCount, false));
  const alignedUnTransformed: [number, number][][] = [unAligned[0]];

  for (let k = 1; k < m; k++) {
    const prev = alignedUnTransformed[k - 1];
    const cur = unAligned[k];
    const pairKey = `${colSig}|${secs[k - 1].id}->${secs[k].id}`;
    const bestShift = findAlignedShift(prev, cur, pairKey);
    const shifted: [number, number][] = [];
    for (let j = 0; j < sampleCount; j++) {
      shifted.push(cur[(j + bestShift) % sampleCount]);
    }
    alignedUnTransformed.push(shifted);
  }

  // 2. Apply each section's scale, intentional twistDeg, and offsetU/V around (0.5, 0.5)
  const loops: [number, number][][] = alignedUnTransformed.map((pts, k) =>
    pts.map((pt) => applySectionTransform(pt, secs[k])),
  );

  let perimSum = 0;
  for (const loop of loops) {
    perimSum += polylinePerimeter(loop);
  }
  const avgPerimLocal = Math.max(0.25, perimSum / m);

  const rings = interpolateLoopSequence(secs, loops, sampleCount, totalRingBudget, interp);
  const tMin = m === 1 ? 0 : secs[0].t;
  const tMax = m === 1 ? 1 : secs[m - 1].t;

  let innerRings: LoftRing[] | undefined;
  let innerFloorRing: { t: number; pts: [number, number][] } | undefined;
  let avgInnerPerimLocal = avgPerimLocal * 0.6;

  if (hollow) {
    // Column-wide physical reference radius ensures uniform wall thickness across tapered sections (L-M1)
    const colRefR = computeColumnRefRadiusMetric(secs, sx, sy);

    // Sample inner sections sequentially and chain the previous section's centroid for multi-lobe continuity (L-M3)
    const unAlignedInner: [number, number][][] = [];
    let prevInnerMetricCentroid: [number, number] | undefined;
    for (let k = 0; k < m; k++) {
      const sec = secs[k];
      const inPts = sampleSectionInnerUniform(
        sec,
        sampleCount,
        false,
        sx,
        sy,
        colRefR,
        prevInnerMetricCentroid,
      );
      unAlignedInner.push(inPts);
      if (inPts.length > 0) {
        let cx = 0;
        let cy = 0;
        for (let j = 0; j < inPts.length; j++) {
          const [lu, lv] = applySectionTransform(inPts[j], sec);
          cx += lu * sx;
          cy += lv * sy;
        }
        prevInnerMetricCentroid = [cx / inPts.length, cy / inPts.length];
      }
    }

    // Align first inner section to first outer section so j=0 shares azimuth, then chain section-to-section
    const shift0 = findAlignedShift(alignedUnTransformed[0], unAlignedInner[0], `${colSig}|${secs[0].id}:in0`);
    const firstInner: [number, number][] = [];
    for (let j = 0; j < sampleCount; j++) {
      firstInner.push(unAlignedInner[0][(j + shift0) % sampleCount]);
    }
    const alignedInnerUntransformed: [number, number][][] = [firstInner];

    for (let k = 1; k < m; k++) {
      const prev = alignedInnerUntransformed[k - 1];
      const cur = unAlignedInner[k];
      const pairKey = `${colSig}|${secs[k - 1].id}->${secs[k].id}:inner`;
      const bestShift = findAlignedShift(prev, cur, pairKey);
      const shifted: [number, number][] = [];
      for (let j = 0; j < sampleCount; j++) {
        shifted.push(cur[(j + bestShift) % sampleCount]);
      }
      alignedInnerUntransformed.push(shifted);
    }

    const innerLoops: [number, number][][] = alignedInnerUntransformed.map((pts, k) =>
      pts.map((pt) => applySectionTransform(pt, secs[k])),
    );

    let inPerimSum = 0;
    for (const loop of innerLoops) {
      inPerimSum += polylinePerimeter(loop);
    }
    avgInnerPerimLocal = Math.max(0.15, inPerimSum / m);

    const rawInnerRings = interpolateLoopSequence(secs, innerLoops, sampleCount, totalRingBudget, interp);

    // Ensure EVERY interpolated inner ring vertex stays strictly inside its paired outer ring (Loft-L1)
    for (let r = 0; r < rawInnerRings.length; r++) {
      const outPts = rings[r].pts;
      const inPts = rawInnerRings[r].pts;
      let anyOutside = false;
      for (let j = 0; j < sampleCount; j++) {
        if (!pointInClosedPolygon(inPts[j][0], inPts[j][1], outPts)) {
          anyOutside = true;
          break;
        }
      }
      if (anyOutside) {
        const outM: [number, number][] = outPts.map(([u, v]) => [u * sx, v * sy]);
        const sdf = buildClosedPolygonSdf(outM, 52);
        if (sdf) {
          const inM: [number, number][] = inPts.map(([u, v]) => [u * sx, v * sy]);
          const clamped = clampInnerMetricLoopWithSdf(inM, sdf, Math.min(sdf.maxDist * 0.4, 0.015 * Math.min(sx, sy)));
          rawInnerRings[r].pts = clamped.map(([mx, my]) => [mx / sx, my / sy]);
        }
      }
    }

    // Optional solid floor inside hollow cavity at clampedFloorT in (0, 0.90] relative to [tMin, tMax] (H1 fix)
    if (clampedFloorT > 1e-3 && tMax - tMin > 1e-3) {
      const targetT = tMin + clampedFloorT * (tMax - tMin);
      const sliced: LoftRing[] = [];
      for (let r = 0; r < rawInnerRings.length; r++) {
        const cur = rawInnerRings[r];
        if (cur.t >= targetT - 1e-5) {
          if (sliced.length === 0 && r > 0 && cur.t > targetT + 1e-5) {
            const prev = rawInnerRings[r - 1];
            const f = clamp((targetT - prev.t) / Math.max(1e-6, cur.t - prev.t), 0, 1);
            const floorPts: [number, number][] = new Array(sampleCount);
            for (let j = 0; j < sampleCount; j++) {
              floorPts[j] = [
                prev.pts[j][0] + (cur.pts[j][0] - prev.pts[j][0]) * f,
                prev.pts[j][1] + (cur.pts[j][1] - prev.pts[j][1]) * f,
              ];
            }
            sliced.push({ t: targetT, pts: floorPts });
          }
          sliced.push(cur);
        }
      }
      if (sliced.length >= 2) {
        innerRings = sliced;
        innerFloorRing = { t: sliced[0].t, pts: sliced[0].pts };
      } else {
        innerRings = rawInnerRings;
      }
    } else {
      innerRings = rawInnerRings;
    }
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

  const res: AlignedLoftResult = {
    rings,
    innerRings,
    innerFloorRing,
    tMin,
    tMax,
    localBounds: { minU, maxU, minV, maxV },
    avgPerimLocal,
    avgInnerPerimLocal,
  };
  alignedRingsCache.set(cacheKey, res);
  return res;
}

function segmentIntersectsAabb(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x0 - minX) &&
    clip(dx, maxX - x0) &&
    clip(-dy, y0 - minY) &&
    clip(dy, maxY - y0) &&
    t0 <= t1
  );
}

/**
 * Evaluates stacking elevation on a loft column using the exact same aligned/clamped inner rings
 * and floor slice as `renderLoft`, checking EVERY interpolated inner ring so overhanging/hourglass
 * waists block objects instead of letting them fall through the wall (H2 fix).
 */
export function evaluateHollowLoftStackElevation(
  rawSections: LoftSection[] | undefined | null,
  interp: LoftInterpMode,
  hollow: boolean,
  floorT: number,
  lsu: number,
  lsv: number,
  zPx: number,
  heightPx: number,
  testLocalPts: [number, number][],
): { isInsideShaft: boolean; shaftFloorElevation: number | null; topElevation: number } {
  const res = buildAlignedLoftRings(rawSections ?? [], 48, 24, interp, hollow, lsu, lsv, floorT);
  const topElevation = zPx + res.tMax * heightPx;
  if (!hollow || !res.innerRings || res.innerRings.length < 2 || testLocalPts.length === 0) {
    return { isInsideShaft: false, shaftFloorElevation: null, topElevation };
  }

  let lMinU = Infinity;
  let lMaxU = -Infinity;
  let lMinV = Infinity;
  let lMaxV = -Infinity;
  for (const [lu, lv] of testLocalPts) {
    if (lu < lMinU) lMinU = lu;
    if (lu > lMaxU) lMaxU = lu;
    if (lv < lMinV) lMinV = lv;
    if (lv > lMaxV) lMaxV = lv;
  }

  for (let r = 0; r < res.innerRings.length; r++) {
    const poly = res.innerRings[r].pts;
    if (poly.length < 3) {
      return { isInsideShaft: false, shaftFloorElevation: null, topElevation };
    }
    for (let k = 0; k < testLocalPts.length; k++) {
      if (!pointInClosedPolygon(testLocalPts[k][0], testLocalPts[k][1], poly)) {
        return { isInsideShaft: false, shaftFloorElevation: null, topElevation };
      }
    }
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if (segmentIntersectsAabb(a[0], a[1], b[0], b[1], lMinU, lMaxU, lMinV, lMaxV)) {
        return { isInsideShaft: false, shaftFloorElevation: null, topElevation };
      }
    }
  }

  const shaftFloorElevation = res.innerFloorRing ? zPx + res.innerFloorRing.t * heightPx : null;
  return { isInsideShaft: true, shaftFloorElevation, topElevation };
}

function pointToSegmentDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdpOpen(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts;
  let maxD = -1;
  let idx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegmentDist(pts[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = rdpOpen(pts.slice(0, idx + 1), eps);
    const right = rdpOpen(pts.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

export function fitClosedFreehandNodesWithMeta(
  rawPts: [number, number][],
  maxNodes = 16,
): { nodes: LoftNode[]; usedFallback: boolean } {
  const dedup: [number, number][] = [];
  for (const p of rawPts) {
    const cl: [number, number] = [clamp(p[0], -0.2, 1.2), clamp(p[1], -0.2, 1.2)];
    if (dedup.length === 0 || Math.hypot(cl[0] - dedup[dedup.length - 1][0], cl[1] - dedup[dedup.length - 1][1]) >= 0.015) {
      dedup.push(cl);
    }
  }
  if (dedup.length >= 2 && Math.hypot(dedup[0][0] - dedup[dedup.length - 1][0], dedup[0][1] - dedup[dedup.length - 1][1]) < 0.025) {
    dedup.pop();
  }
  if (dedup.length < 3) {
    return { nodes: createLoftPresetNodes('circle'), usedFallback: true };
  }

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of dedup) {
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (maxU - minU < 0.06 || maxV - minV < 0.06) {
    return { nodes: createLoftPresetNodes('circle'), usedFallback: true };
  }

  // Split along farthest pair on closed loop so RDP preserves both ends
  let splitIdx = Math.floor(dedup.length / 2);
  let bestD2 = -1;
  for (let i = 1; i < dedup.length; i++) {
    const du = dedup[i][0] - dedup[0][0];
    const dv = dedup[i][1] - dedup[0][1];
    const d2 = du * du + dv * dv;
    if (d2 > bestD2) {
      bestD2 = d2;
      splitIdx = i;
    }
  }

  let eps = 0.022;
  let simplified: [number, number][] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const halfA = rdpOpen(dedup.slice(0, splitIdx + 1), eps);
    const halfB = rdpOpen([...dedup.slice(splitIdx), dedup[0]], eps);
    simplified = [...halfA.slice(0, -1), ...halfB.slice(0, -1)];
    if (simplified.length <= maxNodes) break;
    eps *= 1.35;
  }

  if (simplified.length < 3) {
    return { nodes: createLoftPresetNodes('circle'), usedFallback: true };
  }
  if (simplified.length > maxNodes) {
    const stride = simplified.length / maxNodes;
    simplified = Array.from({ length: maxNodes }, (_, i) => simplified[Math.floor(i * stride)]);
  }

  // Detect sharp corners vs smooth nodes
  const n = simplified.length;
  const nodes: LoftNode[] = simplified.map((pt, i) => {
    const prev = simplified[(i - 1 + n) % n];
    const next = simplified[(i + 1) % n];
    const v1u = prev[0] - pt[0], v1v = prev[1] - pt[1];
    const v2u = next[0] - pt[0], v2v = next[1] - pt[1];
    const l1 = Math.hypot(v1u, v1v) || 1;
    const l2 = Math.hypot(v2u, v2v) || 1;
    const cosAng = clamp((v1u * v2u + v1v * v2v) / (l1 * l2), -1, 1);
    const deg = (Math.acos(cosAng) * 180) / Math.PI;
    return {
      u: Math.round(pt[0] * 1000) / 1000,
      v: Math.round(pt[1] * 1000) / 1000,
      mode: deg < 115 ? 'corner' : 'smooth',
    };
  });
  return { nodes, usedFallback: false };
}

export function fitClosedFreehandNodes(rawPts: [number, number][], maxNodes = 16): LoftNode[] {
  return fitClosedFreehandNodesWithMeta(rawPts, maxNodes).nodes;
}

// ---------------- Control-Point Trajectory Slide Rail & Handle Scaling ----------------

export interface LoftSlideRailSample {
  u: number;
  v: number;
  arcS: number;
  tanU: number;
  tanV: number;
  side: -1 | 0 | 1;
}

export interface LoftSlideRail {
  samples: LoftSlideRailSample[];
  minArcS: number;
  maxArcS: number;
  origU: number;
  origV: number;
  origTanU: number;
  origTanV: number;
  isFilletInStraight: boolean;
  isFilletOutStraight: boolean;
  chordInOrig: number;
  chordOutOrig: number;
  filletVirtualCorner?: [number, number];
}

function evalCubicDerivative(
  p0: [number, number],
  c1: [number, number],
  c2: [number, number],
  p1: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t;
  const dx =
    3 * mt * mt * (c1[0] - p0[0]) +
    6 * mt * t * (c2[0] - c1[0]) +
    3 * t * t * (p1[0] - c2[0]);
  const dy =
    3 * mt * mt * (c1[1] - p0[1]) +
    6 * mt * t * (c2[1] - c1[1]) +
    3 * t * t * (p1[1] - c2[1]);
  return [dx, dy];
}

function unitVec2(dx: number, dy: number, fallbackX = 1, fallbackY = 0): [number, number] {
  const len = Math.hypot(dx, dy);
  if (len > 1e-7) return [dx / len, dy / len];
  const fl = Math.hypot(fallbackX, fallbackY);
  return fl > 1e-7 ? [fallbackX / fl, fallbackY / fl] : [1, 0];
}

function isCubicSegmentStraight(seg: BezierSegment): boolean {
  const dx = seg.p1[0] - seg.p0[0];
  const dy = seg.p1[1] - seg.p0[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-4) return false;
  const ux = dx / L;
  const uy = dy / L;
  const d1x = seg.c1[0] - seg.p0[0];
  const d1y = seg.c1[1] - seg.p0[1];
  const d2x = seg.p1[0] - seg.c2[0];
  const d2y = seg.p1[1] - seg.c2[1];
  const perp1 = Math.abs(d1x * -uy + d1y * ux);
  const perp2 = Math.abs(d2x * -uy + d2y * ux);
  const proj1 = d1x * ux + d1y * uy;
  const proj2 = d2x * ux + d2y * uy;
  const tol = 1.5e-3 * Math.max(1, L);
  return perp1 < tol && perp2 < tol && proj1 >= -1e-4 && proj2 >= -1e-4 && proj1 + proj2 <= L + 2e-3;
}

function intersectRayWithLine2D(
  p: [number, number],
  d1: [number, number],
  q: [number, number],
  d2: [number, number],
): number | null {
  // Solve p + s * d1 = q + w * d2  =>  [d1, -d2] [s, w]^T = q - p
  const det = d1[1] * d2[0] - d1[0] * d2[1];
  if (Math.abs(det) <= 0.15) return null;
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const s = (-rx * d2[1] + ry * d2[0]) / det;
  return Number.isFinite(s) ? s : null;
}

/**
 * Builds the 1D trajectory rail for sliding `origNodes[nodeIdx]` along its adjacent curve
 * segments, with straight-to-curve fillet corner ray extension so corners like `rounded_rect`
 * can both enlarge AND shrink cleanly along straight walls.
 */
export function buildLoftNodeSlideRail(origNodes: LoftNode[], nodeIdx: number): LoftSlideRail {
  const n = origNodes.length;
  if (n < 2) {
    const p = origNodes[0] ?? { u: 0.5, v: 0.5, mode: 'corner' as const };
    return {
      samples: [{ u: p.u, v: p.v, arcS: 0, tanU: 1, tanV: 0, side: 0 }],
      minArcS: 0,
      maxArcS: 0,
      origU: p.u,
      origV: p.v,
      origTanU: 1,
      origTanV: 0,
      isFilletInStraight: false,
      isFilletOutStraight: false,
      chordInOrig: 0.1,
      chordOutOrig: 0.1,
    };
  }

  const i = ((nodeIdx % n) + n) % n;
  const prevIdx = (i - 1 + n) % n;
  const nextIdx = (i + 1) % n;
  const segs = evaluateSectionBezierSegments(origNodes);
  const segIn = segs[prevIdx];
  const segOut = segs[i];
  const orig = origNodes[i];
  const prev = origNodes[prevIdx];
  const next = origNodes[nextIdx];

  const chordInOrig = Math.hypot(orig.u - prev.u, orig.v - prev.v);
  const chordOutOrig = Math.hypot(next.u - orig.u, next.v - orig.v);
  const inStraight = isCubicSegmentStraight(segIn);
  const outStraight = isCubicSegmentStraight(segOut);

  let isFilletInStraight = false;
  let isFilletOutStraight = false;
  let filletVirtualCorner: [number, number] | undefined;

  const backPts: { u: number; v: number; tanU: number; tanV: number }[] = [];
  const fwdPts: { u: number; v: number; tanU: number; tanV: number }[] = [];

  if (inStraight && !outStraight) {
    isFilletInStraight = true;
    const dir = unitVec2(orig.u - prev.u, orig.v - prev.v);
    const maxBack = Math.max(0.005, chordInOrig - Math.max(0.02, 0.06 * chordInOrig));
    const stepsB = 24;
    for (let st = 1; st <= stepsB; st++) {
      const f = st / stepsB;
      backPts.push({
        u: orig.u - dir[0] * maxBack * f,
        v: orig.v - dir[1] * maxBack * f,
        tanU: dir[0],
        tanV: dir[1],
      });
    }

    const endDeriv = evalCubicDerivative(segOut.p0, segOut.c1, segOut.c2, segOut.p1, 0.99);
    const tanNext = unitVec2(endDeriv[0], endDeriv[1], next.u - orig.u, next.v - orig.v);
    const sCorner = intersectRayWithLine2D([orig.u, orig.v], dir, segOut.p1, tanNext);
    if (sCorner !== null && sCorner > 0.005 && sCorner < 0.85) {
      filletVirtualCorner = [orig.u + sCorner * dir[0], orig.v + sCorner * dir[1]];
      const maxFwd = sCorner * 0.92;
      const stepsF = 24;
      for (let st = 1; st <= stepsF; st++) {
        const f = st / stepsF;
        fwdPts.push({
          u: orig.u + dir[0] * maxFwd * f,
          v: orig.v + dir[1] * maxFwd * f,
          tanU: dir[0],
          tanV: dir[1],
        });
      }
    } else {
      const stepsF = 44;
      for (let st = 1; st <= stepsF; st++) {
        const t = (st / stepsF) * 0.94;
        const pt = evalCubic(segOut.p0, segOut.c1, segOut.c2, segOut.p1, t);
        const dv = evalCubicDerivative(segOut.p0, segOut.c1, segOut.c2, segOut.p1, t);
        const ut = unitVec2(dv[0], dv[1], next.u - orig.u, next.v - orig.v);
        fwdPts.push({ u: pt[0], v: pt[1], tanU: ut[0], tanV: ut[1] });
      }
    }
  } else if (outStraight && !inStraight) {
    isFilletOutStraight = true;
    const dir = unitVec2(next.u - orig.u, next.v - orig.v);
    const maxFwd = Math.max(0.005, chordOutOrig - Math.max(0.02, 0.06 * chordOutOrig));
    const stepsF = 24;
    for (let st = 1; st <= stepsF; st++) {
      const f = st / stepsF;
      fwdPts.push({
        u: orig.u + dir[0] * maxFwd * f,
        v: orig.v + dir[1] * maxFwd * f,
        tanU: dir[0],
        tanV: dir[1],
      });
    }

    const startDeriv = evalCubicDerivative(segIn.p0, segIn.c1, segIn.c2, segIn.p1, 0.01);
    const tanPrev = unitVec2(startDeriv[0], startDeriv[1], orig.u - prev.u, orig.v - prev.v);
    const backDir: [number, number] = [-dir[0], -dir[1]];
    const sCorner = intersectRayWithLine2D([orig.u, orig.v], backDir, segIn.p0, tanPrev);
    if (sCorner !== null && sCorner > 0.005 && sCorner < 0.85) {
      filletVirtualCorner = [orig.u + sCorner * backDir[0], orig.v + sCorner * backDir[1]];
      const maxBack = sCorner * 0.92;
      const stepsB = 24;
      for (let st = 1; st <= stepsB; st++) {
        const f = st / stepsB;
        backPts.push({
          u: orig.u + backDir[0] * maxBack * f,
          v: orig.v + backDir[1] * maxBack * f,
          tanU: dir[0],
          tanV: dir[1],
        });
      }
    } else {
      const stepsB = 44;
      for (let st = 1; st <= stepsB; st++) {
        const t = 1 - (st / stepsB) * 0.94;
        const pt = evalCubic(segIn.p0, segIn.c1, segIn.c2, segIn.p1, t);
        const dv = evalCubicDerivative(segIn.p0, segIn.c1, segIn.c2, segIn.p1, t);
        const ut = unitVec2(dv[0], dv[1], orig.u - prev.u, orig.v - prev.v);
        backPts.push({ u: pt[0], v: pt[1], tanU: ut[0], tanV: ut[1] });
      }
    }
  } else {
    const stepsB = 44;
    for (let st = 1; st <= stepsB; st++) {
      const t = 1 - (st / stepsB) * 0.94;
      const pt = evalCubic(segIn.p0, segIn.c1, segIn.c2, segIn.p1, t);
      const dv = evalCubicDerivative(segIn.p0, segIn.c1, segIn.c2, segIn.p1, t);
      const ut = unitVec2(dv[0], dv[1], orig.u - prev.u, orig.v - prev.v);
      backPts.push({ u: pt[0], v: pt[1], tanU: ut[0], tanV: ut[1] });
    }
    const stepsF = 44;
    for (let st = 1; st <= stepsF; st++) {
      const t = (st / stepsF) * 0.94;
      const pt = evalCubic(segOut.p0, segOut.c1, segOut.c2, segOut.p1, t);
      const dv = evalCubicDerivative(segOut.p0, segOut.c1, segOut.c2, segOut.p1, t);
      const ut = unitVec2(dv[0], dv[1], next.u - orig.u, next.v - orig.v);
      fwdPts.push({ u: pt[0], v: pt[1], tanU: ut[0], tanV: ut[1] });
    }
  }

  let origTan: [number, number];
  if (isFilletInStraight) {
    origTan = unitVec2(orig.u - prev.u, orig.v - prev.v);
  } else if (isFilletOutStraight) {
    origTan = unitVec2(next.u - orig.u, next.v - orig.v);
  } else if (orig.mode === 'bezier' && Math.hypot(orig.outDu ?? 0, orig.outDv ?? 0) > 1e-5) {
    origTan = unitVec2(orig.outDu!, orig.outDv!);
  } else if (orig.mode === 'bezier' && Math.hypot(orig.inDu ?? 0, orig.inDv ?? 0) > 1e-5) {
    origTan = unitVec2(-(orig.inDu!), -(orig.inDv!));
  } else {
    const dIn = evalCubicDerivative(segIn.p0, segIn.c1, segIn.c2, segIn.p1, 0.99);
    const dOut = evalCubicDerivative(segOut.p0, segOut.c1, segOut.c2, segOut.p1, 0.01);
    const u1 = unitVec2(dIn[0], dIn[1], orig.u - prev.u, orig.v - prev.v);
    const u2 = unitVec2(dOut[0], dOut[1], next.u - orig.u, next.v - orig.v);
    origTan = unitVec2(u1[0] + u2[0], u1[1] + u2[1], next.u - prev.u, next.v - prev.v);
  }

  // Assemble samples strictly sorted from minArcS (< 0) -> 0 -> maxArcS (> 0)
  const samplesBack: LoftSlideRailSample[] = [];
  let accBack = 0;
  let prevU = orig.u;
  let prevV = orig.v;
  for (const p of backPts) {
    accBack -= Math.hypot(p.u - prevU, p.v - prevV);
    samplesBack.push({ u: p.u, v: p.v, arcS: accBack, tanU: p.tanU, tanV: p.tanV, side: -1 });
    prevU = p.u;
    prevV = p.v;
  }
  samplesBack.reverse();

  const samplesFwd: LoftSlideRailSample[] = [];
  let accFwd = 0;
  prevU = orig.u;
  prevV = orig.v;
  for (const p of fwdPts) {
    accFwd += Math.hypot(p.u - prevU, p.v - prevV);
    samplesFwd.push({ u: p.u, v: p.v, arcS: accFwd, tanU: p.tanU, tanV: p.tanV, side: 1 });
    prevU = p.u;
    prevV = p.v;
  }

  const samples: LoftSlideRailSample[] = [
    ...samplesBack,
    { u: orig.u, v: orig.v, arcS: 0, tanU: origTan[0], tanV: origTan[1], side: 0 },
    ...samplesFwd,
  ];

  return {
    samples,
    minArcS: samples[0].arcS,
    maxArcS: samples[samples.length - 1].arcS,
    origU: orig.u,
    origV: orig.v,
    origTanU: origTan[0],
    origTanV: origTan[1],
    isFilletInStraight,
    isFilletOutStraight,
    chordInOrig,
    chordOutOrig,
    filletVirtualCorner,
  };
}

export function sampleLoftSlideRailAtArcS(
  rail: LoftSlideRail,
  targetArcS: number,
): LoftSlideRailSample {
  const s = rail.samples;
  if (s.length === 0) {
    return { u: rail.origU, v: rail.origV, arcS: 0, tanU: rail.origTanU, tanV: rail.origTanV, side: 0 };
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
  const ut = unitVec2(a.tanU + (b.tanU - a.tanU) * f, a.tanV + (b.tanV - a.tanV) * f, rail.origTanU, rail.origTanV);
  return {
    u: a.u + (b.u - a.u) * f,
    v: a.v + (b.v - a.v) * f,
    arcS: clamped,
    tanU: ut[0],
    tanV: ut[1],
    side: clamped < -1e-6 ? -1 : clamped > 1e-6 ? 1 : 0,
  };
}

export function projectOntoLoftSlideRail(
  rail: LoftSlideRail,
  u: number,
  v: number,
): LoftSlideRailSample {
  const s = rail.samples;
  if (s.length === 0) {
    return { u: rail.origU, v: rail.origV, arcS: 0, tanU: rail.origTanU, tanV: rail.origTanV, side: 0 };
  }
  if (s.length === 1) return { ...s[0] };

  let bestD2 = Infinity;
  let bestArcS = 0;
  for (let k = 0; k < s.length - 1; k++) {
    const a = s[k];
    const b = s[k + 1];
    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 1e-12 ? clamp(((u - a.u) * dx + (v - a.v) * dy) / l2, 0, 1) : 0;
    const pu = a.u + dx * t;
    const pv = a.v + dy * t;
    const d2 = (u - pu) * (u - pu) + (v - pv) * (v - pv);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestArcS = a.arcS + (b.arcS - a.arcS) * t;
    }
  }
  return sampleLoftSlideRailAtArcS(rail, bestArcS);
}

function rotateAndScaleBezierHandle(
  du: number,
  dv: number,
  dTheta: number,
  scale: number,
): [number, number] {
  if (Math.hypot(du, dv) < 1e-7) return [0, 0];
  const c = Math.cos(dTheta);
  const s = Math.sin(dTheta);
  const ru = (du * c - dv * s) * scale;
  const rv = (du * s + dv * c) * scale;
  return [clamp(Math.round(ru * 10000) / 10000, -1, 1), clamp(Math.round(rv * 10000) / 10000, -1, 1)];
}

function applySingleNodeRailHandles(
  nodes: LoftNode[],
  origNodes: LoftNode[],
  idx: number,
  rail: LoftSlideRail,
  pt: LoftSlideRailSample,
): void {
  const n = nodes.length;
  const prevIdx = (idx - 1 + n) % n;
  const nextIdx = (idx + 1) % n;
  const origNd = origNodes[idx];
  const nd = nodes[idx];
  const prevCur = nodes[prevIdx];
  const nextCur = nodes[nextIdx];
  if (!origNd || !nd || !prevCur || !nextCur) return;

  const newChordIn = Math.hypot(nd.u - prevCur.u, nd.v - prevCur.v);
  const newChordOut = Math.hypot(nextCur.u - nd.u, nextCur.v - nd.v);

  if (nd.mode === 'bezier') {
    const thetaOrig = Math.atan2(rail.origTanV, rail.origTanU);
    const thetaNew = Math.atan2(pt.tanV, pt.tanU);
    const isStraightFillet = rail.isFilletInStraight || rail.isFilletOutStraight;
    const dTheta = isStraightFillet ? 0 : thetaNew - thetaOrig;

    let scaleIn = rail.chordInOrig > 1e-4 ? clamp(newChordIn / rail.chordInOrig, 0.08, 3.0) : 1;
    let scaleOut = rail.chordOutOrig > 1e-4 ? clamp(newChordOut / rail.chordOutOrig, 0.08, 3.0) : 1;

    if (rail.filletVirtualCorner) {
      const [cu, cv] = rail.filletVirtualCorner;
      const distOrig = Math.hypot(rail.origU - cu, rail.origV - cv);
      const distNew = Math.hypot(nd.u - cu, nd.v - cv);
      const filletScale = distOrig > 1e-4 ? clamp(distNew / distOrig, 0.08, 3.5) : 1;
      if (rail.isFilletInStraight && !rail.isFilletOutStraight) {
        scaleOut = filletScale;
      } else if (rail.isFilletOutStraight && !rail.isFilletInStraight) {
        scaleIn = filletScale;
      }
    }

    const [inDu, inDv] = rotateAndScaleBezierHandle(origNd.inDu ?? 0, origNd.inDv ?? 0, dTheta, scaleIn);
    const [outDu, outDv] = rotateAndScaleBezierHandle(origNd.outDu ?? 0, origNd.outDv ?? 0, dTheta, scaleOut);
    nd.inDu = inDu;
    nd.inDv = inDv;
    nd.outDu = outDu;
    nd.outDv = outDv;

    if (rail.isFilletInStraight) {
      const len = Math.hypot(nd.inDu, nd.inDv);
      const maxLen = Math.max(0, newChordIn * 0.45);
      if (len > maxLen && len > 1e-6) {
        nd.inDu = Math.round((nd.inDu * (maxLen / len)) * 10000) / 10000;
        nd.inDv = Math.round((nd.inDv * (maxLen / len)) * 10000) / 10000;
      }
    }
    if (rail.isFilletOutStraight) {
      const len = Math.hypot(nd.outDu, nd.outDv);
      const maxLen = Math.max(0, newChordOut * 0.45);
      if (len > maxLen && len > 1e-6) {
        nd.outDu = Math.round((nd.outDu * (maxLen / len)) * 10000) / 10000;
        nd.outDv = Math.round((nd.outDv * (maxLen / len)) * 10000) / 10000;
      }
    }
  }

  // Clamp collinear facing handles on straight neighbor segments so shrinking a straight edge never self-loops
  if (rail.isFilletInStraight && prevCur.mode === 'bezier') {
    const oPrev = origNodes[prevIdx];
    const baseDu = oPrev.outDu ?? 0;
    const baseDv = oPrev.outDv ?? 0;
    const baseLen = Math.hypot(baseDu, baseDv);
    const maxLen = Math.max(0, newChordIn * 0.45);
    const scale = rail.chordInOrig > 1e-4 ? clamp(newChordIn / rail.chordInOrig, 0.08, 1.5) : 1;
    const targetLen = Math.min(maxLen, baseLen * scale);
    if (baseLen > 1e-6) {
      prevCur.outDu = Math.round((baseDu * (targetLen / baseLen)) * 10000) / 10000;
      prevCur.outDv = Math.round((baseDv * (targetLen / baseLen)) * 10000) / 10000;
    }
  }
  if (rail.isFilletOutStraight && nextCur.mode === 'bezier') {
    const oNext = origNodes[nextIdx];
    const baseDu = oNext.inDu ?? 0;
    const baseDv = oNext.inDv ?? 0;
    const baseLen = Math.hypot(baseDu, baseDv);
    const maxLen = Math.max(0, newChordOut * 0.45);
    const scale = rail.chordOutOrig > 1e-4 ? clamp(newChordOut / rail.chordOutOrig, 0.08, 1.5) : 1;
    const targetLen = Math.min(maxLen, baseLen * scale);
    if (baseLen > 1e-6) {
      nextCur.inDu = Math.round((baseDu * (targetLen / baseLen)) * 10000) / 10000;
      nextCur.inDv = Math.round((baseDv * (targetLen / baseLen)) * 10000) / 10000;
    }
  }
}

/**
 * Slides `nodes[idx]` to `targetArcS` along its precomputed `rail` starting cleanly from `origNodes`
 * (zero cumulative drag drift), proportionally scaling & rotating Bezier handles and updating
 * `mirrorPartner` symmetrically when active.
 */
export function applyLoftNodeSlideAtArcS(
  nodes: LoftNode[],
  origNodes: LoftNode[],
  idx: number,
  rail: LoftSlideRail,
  targetArcS: number,
  mirrorPartner?: {
    idx: number;
    rail: LoftSlideRail;
    mirrorPoint: (u: number, v: number) => [number, number];
  },
): LoftSlideRailSample {
  const n = nodes.length;
  if (n < 2 || origNodes.length !== n) {
    return { u: 0.5, v: 0.5, arcS: 0, tanU: 1, tanV: 0, side: 0 };
  }

  // Restore touched entries from origNodes so repeated drag updates have zero cumulative drift
  const restore = (k: number) => {
    const o = origNodes[k];
    const d = nodes[k];
    if (!o || !d) return;
    d.u = o.u;
    d.v = o.v;
    if (o.mode === 'bezier') {
      d.inDu = o.inDu;
      d.inDv = o.inDv;
      d.outDu = o.outDu;
      d.outDv = o.outDv;
    }
  };
  const prevIdx = (idx - 1 + n) % n;
  const nextIdx = (idx + 1) % n;
  restore(idx);
  restore(prevIdx);
  restore(nextIdx);
  if (mirrorPartner && mirrorPartner.idx >= 0 && mirrorPartner.idx < n) {
    restore(mirrorPartner.idx);
    restore((mirrorPartner.idx - 1 + n) % n);
    restore((mirrorPartner.idx + 1) % n);
  }

  let effectiveArcS = clamp(targetArcS, rail.minArcS, rail.maxArcS);
  let pt = sampleLoftSlideRailAtArcS(rail, effectiveArcS);
  let mirrorPt: LoftSlideRailSample | null = null;

  if (mirrorPartner && mirrorPartner.idx >= 0 && mirrorPartner.idx !== idx && mirrorPartner.idx < n) {
    const mIdx = mirrorPartner.idx;
    const isAdjacentMirror = mIdx === prevIdx || mIdx === nextIdx;
    const evalMirror = (arcSVal: number): { p: LoftSlideRailSample; mp: LoftSlideRailSample } => {
      const p = sampleLoftSlideRailAtArcS(rail, arcSVal);
      const [mu, mv] = mirrorPartner.mirrorPoint(p.u, p.v);
      const mp = projectOntoLoftSlideRail(mirrorPartner.rail, mu, mv);
      return { p, mp };
    };
    const initPair = evalMirror(effectiveArcS);
    pt = initPair.p;
    mirrorPt = initPair.mp;

    // Prevent adjacent mirrored nodes on the same straight edge from crossing or colliding (< 0.02 gap)
    if (isAdjacentMirror) {
      const oA = origNodes[idx];
      const oB = origNodes[mIdx];
      const oDx = oB.u - oA.u;
      const oDy = oB.v - oA.v;
      const oLen = Math.hypot(oDx, oDy);
      const sepOk = (pA: LoftSlideRailSample, pB: LoftSlideRailSample): boolean => {
        if (oLen < 1e-4) return Math.hypot(pB.u - pA.u, pB.v - pA.v) >= 0.02;
        const proj = ((pB.u - pA.u) * oDx + (pB.v - pA.v) * oDy) / oLen;
        return proj >= 0.02;
      };
      if (!sepOk(pt, mirrorPt)) {
        let lo = 0;
        let hi = effectiveArcS;
        for (let iter = 0; iter < 14; iter++) {
          const mid = (lo + hi) * 0.5;
          const res = evalMirror(mid);
          if (sepOk(res.p, res.mp)) lo = mid;
          else hi = mid;
        }
        effectiveArcS = lo;
        const clampedPair = evalMirror(effectiveArcS);
        pt = clampedPair.p;
        mirrorPt = clampedPair.mp;
      }
    }
  }

  nodes[idx].u = Math.round(pt.u * 10000) / 10000;
  nodes[idx].v = Math.round(pt.v * 10000) / 10000;
  if (mirrorPt && mirrorPartner) {
    nodes[mirrorPartner.idx].u = Math.round(mirrorPt.u * 10000) / 10000;
    nodes[mirrorPartner.idx].v = Math.round(mirrorPt.v * 10000) / 10000;
  }

  applySingleNodeRailHandles(nodes, origNodes, idx, rail, pt);
  if (mirrorPt && mirrorPartner) {
    applySingleNodeRailHandles(nodes, origNodes, mirrorPartner.idx, mirrorPartner.rail, mirrorPt);
  }

  return pt;
}
