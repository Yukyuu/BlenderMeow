// Interactive Lofted Column Control-Section Stack & Dual Closed Curve Editor
// Supports solid & hollow columns, per-section inner curves (parallel / proportional / custom), and flat-lying arch presets
import type { App } from '../app';
import { clamp } from '../core/color';
import { normalizeRotation, zPxToMeters } from '../core/isoMath';
import type { ParametricShape } from '../core/isoRenderer';
import {
  applyLoftNodeSlideAtArcS,
  buildLoftNodeSlideRail,
  canLoftSectionBeTransition,
  cloneLoftNode,
  computeColumnRefRadiusMetric,
  computeNodeSmoothTangents,
  convertLoftSectionToTransition,
  createLoftPresetNodes,
  createScaledLoftInnerPresetNodes,
  ensureActiveLoftSection,
  ensureLoftSections,
  evaluateSectionBezierSegments,
  fitClosedFreehandNodesWithMeta,
  fitEditableNodesFromSectionInner,
  interpolateLoftSectionInner,
  interpolateLoftSectionNodes,
  LOFT_INNER_MODES,
  LOFT_POLYGON_PRESETS,
  LOFT_PRESETS,
  nextLoftSectionId,
  projectOntoLoftSlideRail,
  sampleClosedSectionUniform,
  sampleSectionInnerUniform,
  syncLoftTransitionSections,
  type LoftInnerMode,
  type LoftInterpMode,
  type LoftNode,
  type LoftNodeMode,
  type LoftPresetId,
  type LoftSection,
  type LoftSlideRail,
} from '../core/loft';
import { h, openSheet, rangeRow, select, toast } from './dom';
import {
  BASE_ANCHORS,
  NUDGE_STEP_OPTIONS,
  SNAP_STEP_OPTIONS,
  bindSubCanvasNudgeScope,
  buildModalUndoRedoBar,
  createModalLiveBinding,
  makeRepeatableButton,
  snapUVToAnchors,
} from './fineEditShared';

export interface LoftMutateOpts {
  targetLayerId?: number;
  beforeMutate: (label: string) => void;
  afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => void;
}

export type LoftEditTarget = 'outer' | 'inner';

export interface LoftEditorInitState {
  isoAlign?: boolean;
  drawMode?: 'nodes' | 'freehand';
  mirrorEdit?: boolean;
  editTarget?: LoftEditTarget;
  selectedOuterIdx?: number;
  selectedInnerIdx?: number;
  anchorSnap?: boolean;
  snapStep?: number;
  nudgeStep?: number;
  slideAlongCurve?: boolean;
}

const SQRT1_2 = Math.SQRT1_2;

function localToViewUv(lu: number, lv: number, effOri: 0 | 1 | 2 | 3): [number, number] {
  switch (effOri) {
    case 0: return [lu, lv];
    case 1: return [1 - lv, lu];
    case 2: return [1 - lu, 1 - lv];
    case 3: return [lv, 1 - lu];
  }
}

function viewUvToLocal(fu: number, fv: number, effOri: 0 | 1 | 2 | 3): [number, number] {
  switch (effOri) {
    case 0: return [fu, fv];
    case 1: return [fv, 1 - fu];
    case 2: return [1 - fu, 1 - fv];
    case 3: return [1 - fv, fu];
  }
}

function getActiveSection(shape: ParametricShape): LoftSection {
  return ensureActiveLoftSection(shape);
}

function getLocalPlotDims(shape: ParametricShape): [number, number] {
  const ori = normalizeRotation(shape.ori);
  const su = Math.max(0.125, shape.sizeU);
  const sv = Math.max(0.125, shape.sizeV);
  return ori % 2 === 1 ? [sv, su] : [su, sv];
}

function getColumnRefRadius(shape: ParametricShape): number | undefined {
  if (!shape.loftHollow) return undefined;
  const [lsu, lsv] = getLocalPlotDims(shape);
  return computeColumnRefRadiusMetric(ensureLoftSections(shape), lsu, lsv);
}

function syncShapeTransitions(shape: ParametricShape): void {
  const [lsu, lsv] = getLocalPlotDims(shape);
  syncLoftTransitionSections(ensureLoftSections(shape), lsu, lsv);
}

function unlockTransitionOnManualEdit(sec: LoftSection): void {
  if (!sec.isTransition) return;
  delete sec.isTransition;
  toast('🔓 已手动编辑曲线，自动转为独立控制面');
}

function insertStandardSectionOnShape(shape: ParametricShape, mutOpts: LoftMutateOpts): LoftSection {
  mutOpts.beforeMutate('新增控制面');
  const secs = ensureLoftSections(shape);
  const sortedAsc = [...secs].sort((a, b) => a.t - b.t);
  const cur = getActiveSection(shape);
  const idx = sortedAsc.findIndex((s) => s.id === cur.id);
  let newT = 0.5;
  let baseNodes = cur.nodes.map(cloneLoftNode);
  let scale = cur.scale;
  let twistDeg = cur.twistDeg;
  let offsetU = cur.offsetU;
  let offsetV = cur.offsetV;
  let innerMode: LoftInnerMode | undefined = cur.innerMode;
  let innerThickness: number | undefined = cur.innerThickness;
  let innerNodes: LoftNode[] | undefined = cur.innerNodes?.map(cloneLoftNode);

  if (sortedAsc.length === 1) {
    newT = cur.t < 0.8 ? 1.0 : 0.0;
  } else {
    const [secA, secB] =
      idx < sortedAsc.length - 1
        ? [cur, sortedAsc[idx + 1]]
        : [sortedAsc[idx - 1], cur];
    newT = Math.round(((secA.t + secB.t) * 0.5) * 100) / 100;
    scale = Math.round(((secA.scale + secB.scale) * 0.5) * 100) / 100;
    twistDeg = Math.round((secA.twistDeg + secB.twistDeg) * 0.5);
    offsetU = Math.round(((secA.offsetU + secB.offsetU) * 0.5) * 100) / 100;
    offsetV = Math.round(((secA.offsetV + secB.offsetV) * 0.5) * 100) / 100;
    baseNodes = interpolateLoftSectionNodes(secA, secB, 0.5);
    const [lsu, lsv] = getLocalPlotDims(shape);
    const colRefR = getColumnRefRadius(shape);
    const interpInner = interpolateLoftSectionInner(secA, secB, 0.5, lsu, lsv, colRefR);
    innerMode = interpInner.innerMode;
    innerThickness = interpInner.innerThickness;
    innerNodes = interpInner.innerNodes;
  }
  const created: LoftSection = {
    id: nextLoftSectionId(),
    name: `控制面 #${secs.length + 1}`,
    t: clamp(newT, 0, 1),
    scale,
    twistDeg,
    offsetU,
    offsetV,
    nodes: baseNodes,
    innerMode,
    innerThickness,
    innerNodes,
  };
  secs.push(created);
  shape.activeLoftSectionId = created.id;
  syncShapeTransitions(shape);
  mutOpts.afterMutate({ live: false, needsResort: true });
  toast(`➕ 已新增「${created.name}」`);
  return created;
}

function insertTransitionSectionOnShape(shape: ParametricShape, mutOpts: LoftMutateOpts): LoftSection {
  mutOpts.beforeMutate('新建过渡控制面');
  const secs = ensureLoftSections(shape);
  let sortedAsc = [...secs].sort((a, b) => a.t - b.t);
  if (sortedAsc.length < 2) {
    const base = sortedAsc[0];
    const edgeT = base.t < 0.5 ? 1.0 : 0.0;
    secs.push({
      id: nextLoftSectionId(),
      name: edgeT >= 0.5 ? '顶层控制面' : '底层控制面',
      t: edgeT,
      scale: base.scale,
      twistDeg: base.twistDeg,
      offsetU: base.offsetU,
      offsetV: base.offsetV,
      nodes: base.nodes.map(cloneLoftNode),
      innerMode: base.innerMode,
      innerThickness: base.innerThickness,
      innerNodes: base.innerNodes?.map(cloneLoftNode),
    });
    sortedAsc = [...secs].sort((a, b) => a.t - b.t);
  }
  const cur = getActiveSection(shape);
  const idx = sortedAsc.findIndex((s) => s.id === cur.id);
  const [secA, secB] =
    idx >= 0 && idx < sortedAsc.length - 1
      ? [cur, sortedAsc[idx + 1]]
      : [sortedAsc[Math.max(0, sortedAsc.length - 2)], sortedAsc[sortedAsc.length - 1]];
  const rawMid = (secA.t + secB.t) * 0.5;
  const minT = sortedAsc[0].t;
  const maxT = sortedAsc[sortedAsc.length - 1].t;
  const eps = Math.min(0.01, Math.max(0, (maxT - minT) * 0.1));
  const clampedT =
    maxT - minT > 1e-4 ? clamp(rawMid, minT + eps, maxT - eps) : clamp(rawMid, 0.01, 0.99);
  const newT = Math.round(clampedT * 100) / 100;
  const created: LoftSection = {
    id: nextLoftSectionId(),
    name: '过渡控制面',
    t: newT,
    scale: Math.round(((secA.scale + secB.scale) * 0.5) * 100) / 100,
    twistDeg: Math.round((secA.twistDeg + secB.twistDeg) * 0.5),
    offsetU: Math.round(((secA.offsetU + secB.offsetU) * 0.5) * 100) / 100,
    offsetV: Math.round(((secA.offsetV + secB.offsetV) * 0.5) * 100) / 100,
    nodes: secA.nodes.map(cloneLoftNode),
    isTransition: true,
    innerMode: secA.innerMode,
    innerThickness: secA.innerThickness,
    innerNodes: secA.innerNodes?.map(cloneLoftNode),
  };
  secs.push(created);
  shape.activeLoftSectionId = created.id;
  syncShapeTransitions(shape);
  mutOpts.afterMutate({ live: false, needsResort: true });
  toast('✨ 已新建过渡控制面（曲线自动跟随上下控制面过渡）');
  return created;
}

function toggleSectionTransitionOnShape(shape: ParametricShape, mutOpts: LoftMutateOpts): boolean {
  const secs = ensureLoftSections(shape);
  const cur = getActiveSection(shape);
  if (cur.isTransition) {
    mutOpts.beforeMutate('解锁过渡面为普通控制面');
    delete cur.isTransition;
    mutOpts.afterMutate({ live: false, needsResort: true });
    toast('🔓 已解锁为可自由编辑的普通控制面');
    return true;
  }
  if (!canLoftSectionBeTransition(secs, cur.id)) {
    toast('顶层与底层端点控制面无法设为过渡面，请先选中中间层控制面');
    return false;
  }
  mutOpts.beforeMutate('转换为过渡控制面');
  const [lsu, lsv] = getLocalPlotDims(shape);
  convertLoftSectionToTransition(secs, cur.id, lsu, lsv, false);
  mutOpts.afterMutate({ live: false, needsResort: true });
  toast('✨ 已转换为上下控制面曲线的过渡形态');
  return true;
}

function drawSectionThumb(
  canvas: HTMLCanvasElement,
  sec: LoftSection,
  effOri: 0 | 1 | 2 | 3,
  isActive: boolean,
  isHollow: boolean,
  lsu: number,
  lsv: number,
  colRefRadius?: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const logicalW = Number(canvas.dataset.logicalW) || canvas.width || 30;
  const logicalH = Number(canvas.dataset.logicalH) || canvas.height || 30;
  canvas.dataset.logicalW = String(logicalW);
  canvas.dataset.logicalH = String(logicalH);
  const targetW = Math.max(1, Math.round(logicalW * dpr));
  const targetH = Math.max(1, Math.round(logicalH * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = logicalW;
  const hPx = logicalH;
  ctx.clearRect(0, 0, w, hPx);

  const pts = sampleClosedSectionUniform(sec, 44, true);
  if (pts.length < 3) return;

  const toThumb = (lu: number, lv: number): [number, number] => {
    const [fu, fv] = localToViewUv(lu, lv, effOri);
    const xv = (fu - 0.5 - (fv - 0.5)) * SQRT1_2;
    const yv = (fu - 0.5 + (fv - 0.5)) * SQRT1_2;
    return [w * 0.5 + xv * (w * 0.62), hPx * 0.5 + yv * (hPx * 0.62)];
  };

  const inPts = isHollow ? sampleSectionInnerUniform(sec, 36, true, lsu, lsv, colRefRadius) : null;

  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [sx, sy] = toThumb(pts[i][0], pts[i][1]);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();

  if (inPts && inPts.length >= 3) {
    for (let i = 0; i < inPts.length; i++) {
      const [sx, sy] = toThumb(inPts[i][0], inPts[i][1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
  }

  ctx.fillStyle = isActive ? 'rgba(52, 211, 153, 0.28)' : 'rgba(168, 85, 247, 0.22)';
  ctx.fill('evenodd');

  // Outer stroke
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [sx, sy] = toThumb(pts[i][0], pts[i][1]);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.strokeStyle = isActive ? '#34d399' : '#c084fc';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Inner stroke
  if (inPts && inPts.length >= 3) {
    ctx.beginPath();
    for (let i = 0; i < inPts.length; i++) {
      const [sx, sy] = toThumb(inPts[i][0], inPts[i][1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
}

function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-8) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function createCurveCanvasController(
  sizePx: number,
  shapeOrGetter: ParametricShape | (() => ParametricShape),
  app: App,
  opts: LoftMutateOpts,
  onSyncExternal: () => void,
  initState?: LoftEditorInitState,
) {
  const getShape = () => (typeof shapeOrGetter === 'function' ? shapeOrGetter() : shapeOrGetter);
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sizePx * dpr);
  canvas.height = Math.round(sizePx * dpr);
  canvas.className = 'loft-curve-canvas';
  canvas.tabIndex = 0;
  canvas.style.width = `${sizePx}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  canvas.style.aspectRatio = '1 / 1';

  let isoAlign = initState?.isoAlign ?? true;
  let drawMode: 'nodes' | 'freehand' = initState?.drawMode ?? 'nodes';
  let mirrorEdit = initState?.mirrorEdit ?? false;
  let anchorSnap = initState?.anchorSnap ?? false;
  let slideAlongCurve = initState?.slideAlongCurve ?? false;
  let snapStep = initState?.snapStep ?? 0.05;
  let nudgeStep = initState?.nudgeStep ?? 0.01;
  let activeGuideU: number | null = null;
  let activeGuideV: number | null = null;

  const initShape = getShape();
  const initSec = getActiveSection(initShape);
  let editTarget: LoftEditTarget =
    initState?.editTarget === 'inner' && initShape.loftHollow && (initSec.innerMode ?? 'parallel') === 'custom'
      ? 'inner'
      : 'outer';
  let selectedOuterIdx = initState?.selectedOuterIdx ?? 0;
  let selectedInnerIdx = initState?.selectedInnerIdx ?? 0;

  type DragState =
    | { kind: 'none' }
    | {
        kind: 'pending_insert';
        target: LoftEditTarget;
        insertIdx: number;
        startX: number;
        startY: number;
        isTouch: boolean;
      }
    | {
        kind: 'node';
        target: LoftEditTarget;
        idx: number;
        mirrorIdx: number;
        origSide: -1 | 0 | 1;
        origNodes: LoftNode[];
        slideRail: LoftSlideRail;
        mirrorRail: LoftSlideRail | null;
        historyPushed: boolean;
        startX: number;
        startY: number;
      }
    | {
        kind: 'handle';
        target: LoftEditTarget;
        idx: number;
        mirrorIdx: number;
        side: 'in' | 'out';
        historyPushed: boolean;
        startX: number;
        startY: number;
      }
    | {
        kind: 'thickness';
        centerX: number;
        centerY: number;
        startDist: number;
        origThickness: number;
        historyPushed: boolean;
      }
    | {
        kind: 'freehand';
        target: LoftEditTarget;
        ptsLocal: [number, number][];
        ptsCanvas: [number, number][];
      };

  let drag: DragState = { kind: 'none' };
  let activePointerId: number | null = null;
  let lastInsertedAt = 0;

  const getEffOri = (): 0 | 1 | 2 | 3 => normalizeRotation(getShape().ori + app.doc.viewRotation);

  const getActiveTarget = (): LoftEditTarget => {
    const curShape = getShape();
    if (!curShape.loftHollow) {
      editTarget = 'outer';
      return 'outer';
    }
    const sec = getActiveSection(curShape);
    if ((sec.innerMode ?? 'parallel') !== 'custom' && editTarget === 'inner') {
      editTarget = 'outer';
    }
    return editTarget;
  };

  const ensureInnerEditable = (sec: LoftSection): LoftNode[] => {
    if (!Array.isArray(sec.innerNodes) || sec.innerNodes.length < 3) {
      const curShape = getShape();
      const [lsu, lsv] = getLocalPlotDims(curShape);
      sec.innerNodes = fitEditableNodesFromSectionInner(sec, lsu, lsv, getColumnRefRadius(curShape));
    }
    return sec.innerNodes;
  };

  const getNodesForTarget = (sec: LoftSection, target: LoftEditTarget): LoftNode[] => {
    if (target === 'inner') {
      return ensureInnerEditable(sec);
    }
    return sec.nodes;
  };

  const getSelectedIdx = (sec: LoftSection, target: LoftEditTarget): number => {
    const arr = getNodesForTarget(sec, target);
    if (target === 'inner') {
      if (selectedInnerIdx >= arr.length) selectedInnerIdx = Math.max(0, arr.length - 1);
      return selectedInnerIdx;
    }
    if (selectedOuterIdx >= arr.length) selectedOuterIdx = Math.max(0, arr.length - 1);
    return selectedOuterIdx;
  };

  const setSelectedIdx = (target: LoftEditTarget, idx: number) => {
    if (target === 'inner') selectedInnerIdx = idx;
    else selectedOuterIdx = idx;
  };

  const unlockInnerToCustom = (label = '解锁当前控制面内圈自由编辑') => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    if ((sec.innerMode ?? 'parallel') === 'custom' && Array.isArray(sec.innerNodes) && sec.innerNodes.length >= 3) {
      editTarget = 'inner';
      return;
    }
    opts.beforeMutate(label);
    if (!Array.isArray(sec.innerNodes) || sec.innerNodes.length < 3) {
      const [lsu, lsv] = getLocalPlotDims(curShape);
      sec.innerNodes = fitEditableNodesFromSectionInner(sec, lsu, lsv, getColumnRefRadius(curShape));
      selectedInnerIdx = 0;
    } else {
      selectedInnerIdx = Math.min(selectedInnerIdx, sec.innerNodes.length - 1);
    }
    sec.innerMode = 'custom';
    editTarget = 'inner';
    unlockTransitionOnManualEdit(sec);
    syncShapeTransitions(curShape);
    opts.afterMutate({ live: false });
  };

  const computeRailSnapArcS = (
    sec: LoftSection,
    target: LoftEditTarget,
    rail: LoftSlideRail,
    projU: number,
    projV: number,
    projArcS: number,
    excludeIdx: number,
    mirrorIdx: number,
  ): number => {
    if (!anchorSnap) {
      activeGuideU = null;
      activeGuideV = null;
      return projArcS;
    }
    const nodes = getNodesForTarget(sec, target);
    const anchorsU = [...BASE_ANCHORS, rail.origU];
    const anchorsV = [...BASE_ANCHORS, rail.origV];
    for (let i = 0; i < nodes.length; i++) {
      if (i === excludeIdx || i === mirrorIdx) continue;
      anchorsU.push(nodes[i].u);
      anchorsV.push(nodes[i].v);
    }
    if (snapStep > 0) {
      anchorsU.push(Math.round(projU / snapStep) * snapStep);
      anchorsV.push(Math.round(projV / snapStep) * snapStep);
    }

    const tol = 0.026;
    let bestScore = Infinity;
    let bestArcS = projArcS;
    let bestGU: number | null = null;
    let bestGV: number | null = null;

    const samples = rail.samples;
    for (let k = 0; k < samples.length - 1; k++) {
      const a = samples[k];
      const b = samples[k + 1];
      const du = b.u - a.u;
      const dv = b.v - a.v;
      if (Math.abs(du) > 1e-6) {
        for (const au of anchorsU) {
          const t = (au - a.u) / du;
          if (t < -1e-4 || t > 1 + 1e-4) continue;
          const tc = clamp(t, 0, 1);
          const cu = a.u + du * tc;
          const cv = a.v + dv * tc;
          const dist = Math.hypot(cu - projU, cv - projV);
          if (dist <= tol && dist < bestScore) {
            bestScore = dist;
            bestArcS = a.arcS + (b.arcS - a.arcS) * tc;
            bestGU = au;
            bestGV = null;
          }
        }
      }
      if (Math.abs(dv) > 1e-6) {
        for (const av of anchorsV) {
          const t = (av - a.v) / dv;
          if (t < -1e-4 || t > 1 + 1e-4) continue;
          const tc = clamp(t, 0, 1);
          const cu = a.u + du * tc;
          const cv = a.v + dv * tc;
          const dist = Math.hypot(cu - projU, cv - projV);
          if (dist <= tol && dist < bestScore) {
            bestScore = dist;
            bestArcS = a.arcS + (b.arcS - a.arcS) * tc;
            bestGU = null;
            bestGV = av;
          }
        }
      }
    }
    activeGuideU = bestGU;
    activeGuideV = bestGV;
    return bestArcS;
  };

  const computeSnappedNodeUV = (
    sec: LoftSection,
    target: LoftEditTarget,
    lu: number,
    lv: number,
    excludeIdx: number,
    mirrorIdx: number,
    force = false,
  ): [number, number] => {
    if (!force && !anchorSnap) {
      activeGuideU = null;
      activeGuideV = null;
      return [lu, lv];
    }
    const nodes = getNodesForTarget(sec, target);
    const anchorsU = [...BASE_ANCHORS];
    const anchorsV = [...BASE_ANCHORS];
    for (let i = 0; i < nodes.length; i++) {
      if (i === excludeIdx || i === mirrorIdx) continue;
      anchorsU.push(nodes[i].u);
      anchorsV.push(nodes[i].v);
    }
    if (target === 'inner') {
      for (const nd of sec.nodes) {
        anchorsU.push(nd.u);
        anchorsV.push(nd.v);
      }
    }
    const snapped = snapUVToAnchors(lu, lv, anchorsU, anchorsV, snapStep, 0.026);
    activeGuideU = snapped.guideU;
    activeGuideV = snapped.guideV;
    return [clamp(snapped.u, -0.3, 1.3), clamp(snapped.v, -0.3, 1.3)];
  };

  // Maps raw curve-local (lu, lv) <-> canvas pixel (sx, sy)
  const toCanvas = (lu: number, lv: number): [number, number] => {
    const span = isoAlign ? sizePx * 0.56 : sizePx * 0.68;
    if (!isoAlign) {
      return [sizePx * 0.5 + (lu - 0.5) * span, sizePx * 0.5 + (lv - 0.5) * span];
    }
    const [fu, fv] = localToViewUv(lu, lv, getEffOri());
    const xv = (fu - 0.5 - (fv - 0.5)) * SQRT1_2;
    const yv = (fu - 0.5 + (fv - 0.5)) * SQRT1_2;
    return [sizePx * 0.5 + xv * span, sizePx * 0.5 + yv * span];
  };

  const toLocal = (sx: number, sy: number): [number, number] => {
    const span = isoAlign ? sizePx * 0.56 : sizePx * 0.68;
    const nx = (sx - sizePx * 0.5) / span;
    const ny = (sy - sizePx * 0.5) / span;
    if (!isoAlign) {
      return [clamp(0.5 + nx, -0.3, 1.3), clamp(0.5 + ny, -0.3, 1.3)];
    }
    const du = (nx + ny) * SQRT1_2;
    const dv = (ny - nx) * SQRT1_2;
    const [lu, lv] = viewUvToLocal(0.5 + du, 0.5 + dv, getEffOri());
    return [clamp(lu, -0.3, 1.3), clamp(lv, -0.3, 1.3)];
  };

  const mirrorLocal = (lu: number, lv: number): [number, number] => {
    if (!isoAlign) {
      return [1 - lu, lv];
    }
    const [cx, cy] = toCanvas(lu, lv);
    return toLocal(sizePx - cx, cy);
  };

  const computeAutoInnerUntransformed = (sec: LoftSection): [number, number][] => {
    const curShape = getShape();
    const [lsu, lsv] = getLocalPlotDims(curShape);
    return sampleSectionInnerUniform(sec, 64, false, lsu, lsv, getColumnRefRadius(curShape));
  };

  const getThicknessDiamondPos = (autoInner: [number, number][]): [number, number] => {
    let bestPt: [number, number] = toCanvas(0.5, 0.3);
    let bestSy = Infinity;
    for (const [u, v] of autoInner) {
      const [sx, sy] = toCanvas(u, v);
      if (sy < bestSy) {
        bestSy = sy;
        bestPt = [sx, sy];
      }
    }
    return bestPt;
  };

  const drawCanvas = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    const isHollow = Boolean(curShape.loftHollow);
    const isCustomInner = isHollow && (sec.innerMode ?? 'parallel') === 'custom';
    const activeTarget = getActiveTarget();
    const [lsu, lsv] = getLocalPlotDims(curShape);
    const colRefR = getColumnRefRadius(curShape);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sizePx, sizePx);

    // Background
    ctx.fillStyle = '#14111f';
    ctx.fillRect(0, 0, sizePx, sizePx);

    // Subtle lattice inside nominal [0..1]x[0..1]
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const f = k / 4;
      const [ax, ay] = toCanvas(f, 0);
      const [bx, by] = toCanvas(f, 1);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      const [cx, cy] = toCanvas(0, f);
      const [dx, dy] = toCanvas(1, f);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    }

    // Nominal [0, 1] cell border
    const c00 = toCanvas(0, 0);
    const c10 = toCanvas(1, 0);
    const c11 = toCanvas(1, 1);
    const c01 = toCanvas(0, 1);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(c00[0], c00[1]);
    ctx.lineTo(c10[0], c10[1]);
    ctx.lineTo(c11[0], c11[1]);
    ctx.lineTo(c01[0], c01[1]);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Center crosshair & mirror axis indicator
    const mid = toCanvas(0.5, 0.5);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.beginPath();
    ctx.moveTo(mid[0] - 6, mid[1]);
    ctx.lineTo(mid[0] + 6, mid[1]);
    ctx.moveTo(mid[0], mid[1] - 6);
    ctx.lineTo(mid[0], mid[1] + 6);
    ctx.stroke();

    if (mirrorEdit) {
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const [ma0, ma1] = isoAlign
        ? [[sizePx * 0.5, 10], [sizePx * 0.5, sizePx - 10]]
        : [toCanvas(0.5, -0.15), toCanvas(0.5, 1.15)];
      ctx.moveTo(ma0[0], ma0[1]);
      ctx.lineTo(ma1[0], ma1[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // View orientation labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isoAlign) {
      ctx.fillText('后 ↑', sizePx * 0.5, 11);
      ctx.fillText('前 ↓', sizePx * 0.5, sizePx - 11);
      ctx.fillText('左', 13, sizePx * 0.5);
      ctx.fillText('右', sizePx - 13, sizePx * 0.5);
    } else {
      const [uTipX, uTipY] = toCanvas(1.1, 0.5);
      const [vTipX, vTipY] = toCanvas(0.5, 1.1);
      ctx.fillText('+U', uTipX, uTipY);
      ctx.fillText('+V', vTipX, vTipY);
    }

    // Onion-skin ghosts of other control sections
    const sorted = [...ensureLoftSections(curShape)].sort((a, b) => a.t - b.t);
    for (const other of sorted) {
      if (other.id === sec.id) continue;
      const gPts = sampleClosedSectionUniform(other, 64, true);
      if (gPts.length >= 3) {
        ctx.strokeStyle = other.t < sec.t ? 'rgba(96, 165, 250, 0.26)' : 'rgba(251, 191, 36, 0.26)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let i = 0; i < gPts.length; i++) {
          const [gx, gy] = toCanvas(gPts[i][0], gPts[i][1]);
          if (i === 0) ctx.moveTo(gx, gy);
          else ctx.lineTo(gx, gy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isHollow) {
        const gIn = sampleSectionInnerUniform(other, 48, true, lsu, lsv, colRefR);
        if (gIn.length >= 3) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          for (let i = 0; i < gIn.length; i++) {
            const [gx, gy] = toCanvas(gIn[i][0], gIn[i][1]);
            if (i === 0) ctx.moveTo(gx, gy);
            else ctx.lineTo(gx, gy);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Preview of active section AFTER scale/twist/offset if transformed
    if (
      Math.abs(sec.scale - 1) > 1e-3 ||
      Math.abs(sec.twistDeg) > 1e-2 ||
      Math.abs(sec.offsetU) > 1e-3 ||
      Math.abs(sec.offsetV) > 1e-3
    ) {
      const tPts = sampleClosedSectionUniform(sec, 64, true);
      if (tPts.length >= 3) {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.52)';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        for (let i = 0; i < tPts.length; i++) {
          const [tx, ty] = toCanvas(tPts[i][0], tPts[i][1]);
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const outerSegs = evaluateSectionBezierSegments(sec.nodes);
    const innerPtsUntransformed = isHollow ? computeAutoInnerUntransformed(sec) : null;
    const innerSegs = isCustomInner && sec.innerNodes ? evaluateSectionBezierSegments(sec.innerNodes) : null;

    // Shaded cross-section fill (annular wall when hollow via evenodd!)
    if (outerSegs.length > 0) {
      ctx.beginPath();
      const [s0x, s0y] = toCanvas(outerSegs[0].p0[0], outerSegs[0].p0[1]);
      ctx.moveTo(s0x, s0y);
      for (const seg of outerSegs) {
        const [c1x, c1y] = toCanvas(seg.c1[0], seg.c1[1]);
        const [c2x, c2y] = toCanvas(seg.c2[0], seg.c2[1]);
        const [p1x, p1y] = toCanvas(seg.p1[0], seg.p1[1]);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p1x, p1y);
      }
      ctx.closePath();

      if (isHollow && innerPtsUntransformed && innerPtsUntransformed.length >= 3) {
        const [ix0, iy0] = toCanvas(innerPtsUntransformed[0][0], innerPtsUntransformed[0][1]);
        ctx.moveTo(ix0, iy0);
        for (let i = 1; i < innerPtsUntransformed.length; i++) {
          const [ix, iy] = toCanvas(innerPtsUntransformed[i][0], innerPtsUntransformed[i][1]);
          ctx.lineTo(ix, iy);
        }
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(52, 211, 153, 0.16)';
      ctx.fill('evenodd');
    }

    // Outer Bezier stroke
    if (outerSegs.length > 0) {
      ctx.beginPath();
      const [s0x, s0y] = toCanvas(outerSegs[0].p0[0], outerSegs[0].p0[1]);
      ctx.moveTo(s0x, s0y);
      for (const seg of outerSegs) {
        const [c1x, c1y] = toCanvas(seg.c1[0], seg.c1[1]);
        const [c2x, c2y] = toCanvas(seg.c2[0], seg.c2[1]);
        const [p1x, p1y] = toCanvas(seg.p1[0], seg.p1[1]);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p1x, p1y);
      }
      ctx.closePath();
      ctx.strokeStyle = activeTarget === 'outer' ? '#34d399' : 'rgba(52, 211, 153, 0.55)';
      ctx.lineWidth = activeTarget === 'outer' ? 2.1 : 1.5;
      ctx.stroke();
    }

    // Inner curve stroke (hollow mode only)
    if (isHollow) {
      if (isCustomInner && innerSegs && innerSegs.length > 0) {
        // Also show faint clamped inner preview if user dragged a custom node past the outer wall
        if (innerPtsUntransformed && innerPtsUntransformed.length >= 3) {
          ctx.beginPath();
          for (let i = 0; i < innerPtsUntransformed.length; i++) {
            const [ix, iy] = toCanvas(innerPtsUntransformed[i][0], innerPtsUntransformed[i][1]);
            if (i === 0) ctx.moveTo(ix, iy);
            else ctx.lineTo(ix, iy);
          }
          ctx.closePath();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
          ctx.lineWidth = 1.1;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        const [s0x, s0y] = toCanvas(innerSegs[0].p0[0], innerSegs[0].p0[1]);
        ctx.moveTo(s0x, s0y);
        for (const seg of innerSegs) {
          const [c1x, c1y] = toCanvas(seg.c1[0], seg.c1[1]);
          const [c2x, c2y] = toCanvas(seg.c2[0], seg.c2[1]);
          const [p1x, p1y] = toCanvas(seg.p1[0], seg.p1[1]);
          ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p1x, p1y);
        }
        ctx.closePath();
        ctx.strokeStyle = activeTarget === 'inner' ? '#38bdf8' : 'rgba(56, 189, 248, 0.65)';
        ctx.lineWidth = activeTarget === 'inner' ? 2.1 : 1.5;
        ctx.stroke();
      } else if (innerPtsUntransformed && innerPtsUntransformed.length >= 3) {
        ctx.beginPath();
        for (let i = 0; i < innerPtsUntransformed.length; i++) {
          const [ix, iy] = toCanvas(innerPtsUntransformed[i][0], innerPtsUntransformed[i][1]);
          if (i === 0) ctx.moveTo(ix, iy);
          else ctx.lineTo(ix, iy);
        }
        ctx.closePath();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draggable diamond handle for live wall thickness adjustment
        if (drawMode === 'nodes') {
          const [dx, dy] = getThicknessDiamondPos(innerPtsUntransformed);
          const r = 5;
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(dx, dy - r);
          ctx.lineTo(dx + r, dy);
          ctx.lineTo(dx, dy + r);
          ctx.lineTo(dx - r, dy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Helper to draw control nodes for a curve
    const drawCurveNodes = (target: LoftEditTarget, nodes: LoftNode[], isPrimary: boolean) => {
      const selIdx = getSelectedIdx(sec, target);
      const sel = nodes[selIdx];

      if (isPrimary && sel && sel.mode === 'bezier') {
        const [nx, ny] = toCanvas(sel.u, sel.v);
        const [ix, iy] = toCanvas(sel.u + (sel.inDu ?? 0), sel.v + (sel.inDv ?? 0));
        const [ox, oy] = toCanvas(sel.u + (sel.outDu ?? 0), sel.v + (sel.outDv ?? 0));
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.lineTo(nx, ny);
        ctx.lineTo(ox, oy);
        ctx.stroke();

        for (const [hx, hy] of [
          [ix, iy],
          [ox, oy],
        ]) {
          ctx.fillStyle = '#fbbf24';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(hx, hy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i];
        const [nx, ny] = toCanvas(nd.u, nd.v);
        const isSel = isPrimary && i === selIdx;
        const r = isSel ? 5.5 : isPrimary ? 4.2 : 3.2;
        if (!isPrimary) {
          ctx.fillStyle = target === 'inner' ? 'rgba(56, 189, 248, 0.55)' : 'rgba(52, 211, 153, 0.55)';
        } else if (isSel) {
          ctx.fillStyle = '#fbbf24';
        } else if (target === 'inner') {
          ctx.fillStyle = nd.mode === 'corner' ? '#fb923c' : nd.mode === 'bezier' ? '#c084fc' : '#38bdf8';
        } else {
          ctx.fillStyle = nd.mode === 'corner' ? '#38bdf8' : nd.mode === 'bezier' ? '#f472b6' : '#34d399';
        }
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = isPrimary ? 1.5 : 1;
        ctx.beginPath();
        if (nd.mode === 'corner') {
          ctx.rect(nx - r, ny - r, r * 2, r * 2);
        } else {
          ctx.arc(nx, ny, r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      }
    };

    if (drawMode === 'nodes') {
      if (slideAlongCurve) {
        const railTarget = activeTarget;
        const railNodes = getNodesForTarget(sec, railTarget);
        const railIdx = getSelectedIdx(sec, railTarget);
        const rail =
          drag.kind === 'node' && drag.target === railTarget && drag.idx === railIdx
            ? drag.slideRail
            : buildLoftNodeSlideRail(railNodes, railIdx);
        if (rail.samples.length >= 2) {
          ctx.save();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          for (let i = 0; i < rail.samples.length; i++) {
            const [rx, ry] = toCanvas(rail.samples[i].u, rail.samples[i].v);
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          for (const endPt of [rail.samples[0], rail.samples[rail.samples.length - 1]]) {
            const [ex, ey] = toCanvas(endPt.u, endPt.v);
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(ex, ey, 2.8, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
      if (isCustomInner && sec.innerNodes) {
        if (activeTarget === 'inner') {
          drawCurveNodes('outer', sec.nodes, false);
          drawCurveNodes('inner', sec.innerNodes, true);
        } else {
          drawCurveNodes('inner', sec.innerNodes, false);
          drawCurveNodes('outer', sec.nodes, true);
        }
      } else {
        drawCurveNodes('outer', sec.nodes, true);
      }
    }

    // Active freehand stroke overlay
    if (drag.kind === 'freehand' && drag.ptsCanvas.length > 1) {
      ctx.strokeStyle = drag.target === 'inner' ? '#38bdf8' : '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(drag.ptsCanvas[0][0], drag.ptsCanvas[0][1]);
      for (let i = 1; i < drag.ptsCanvas.length; i++) {
        ctx.lineTo(drag.ptsCanvas[i][0], drag.ptsCanvas[i][1]);
      }
      ctx.stroke();
    }

    // Visual anchor lattice & active snap guides
    if (anchorSnap) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.38)';
      for (const au of BASE_ANCHORS) {
        for (const av of BASE_ANCHORS) {
          const [ax, ay] = toCanvas(au, av);
          ctx.beginPath();
          ctx.arc(ax, ay, au === 0.5 && av === 0.5 ? 2.8 : 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (activeGuideU !== null) {
        const [gx0, gy0] = toCanvas(activeGuideU, -0.18);
        const [gx1, gy1] = toCanvas(activeGuideU, 1.18);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(gx0, gy0);
        ctx.lineTo(gx1, gy1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (activeGuideV !== null) {
        const [gx0, gy0] = toCanvas(-0.18, activeGuideV);
        const [gx1, gy1] = toCanvas(1.18, activeGuideV);
        ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(gx0, gy0);
        ctx.lineTo(gx1, gy1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  const getPointerPos = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const innerLeft = r.left + canvas.clientLeft;
    const innerTop = r.top + canvas.clientTop;
    const innerW = canvas.clientWidth || r.width || 1;
    const innerH = canvas.clientHeight || r.height || 1;
    return [
      ((e.clientX - innerLeft) / Math.max(1, innerW)) * sizePx,
      ((e.clientY - innerTop) / Math.max(1, innerH)) * sizePx,
    ];
  };

  const getAxisOffset = (nd: { u: number; v: number }): number => {
    if (!isoAlign) return nd.u - 0.5;
    const [cx] = toCanvas(nd.u, nd.v);
    return (cx - sizePx * 0.5) / Math.max(1, sizePx * 0.56);
  };

  const findMirrorIdxFor = (nodes: LoftNode[], hitIdx: number): number => {
    if (!mirrorEdit) return -1;
    const nd = nodes[hitIdx];
    if (!nd) return -1;
    const axisOff = getAxisOffset(nd);
    if (Math.abs(axisOff) < 0.045) return -1;
    const [mu, mv] = mirrorLocal(nd.u, nd.v);
    let bestMD = 0.05;
    let mirrorIdx = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (i === hitIdx) continue;
      const cand = nodes[i];
      const cOff = getAxisOffset(cand);
      if (Math.abs(cOff) < 0.045 || axisOff * cOff >= 0) continue;
      const d = Math.hypot(cand.u - mu, cand.v - mv);
      if (d < bestMD) {
        bestMD = d;
        mirrorIdx = i;
      }
    }
    return mirrorIdx;
  };

  const commitInsertNode = (
    insertTarget: LoftEditTarget,
    insertIdx: number,
    sx: number,
    sy: number,
    curveHitR: number,
    startDrag: boolean,
  ) => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    const nodes = getNodesForTarget(sec, insertTarget);
    opts.beforeMutate(insertTarget === 'inner' ? '内圈曲线插入节点' : '控制面曲线插入节点');
    unlockTransitionOnManualEdit(sec);
    const [lu, lv] = toLocal(sx, sy);
    const nextNode: LoftNode = {
      u: Math.round(lu * 1000) / 1000,
      v: Math.round(lv * 1000) / 1000,
      mode: 'smooth',
    };
    nodes.splice(insertIdx, 0, nextNode);

    let mirrorRef: LoftNode | null = null;
    if (mirrorEdit && Math.abs(getAxisOffset(nextNode)) >= 0.045) {
      const [mu, mv] = mirrorLocal(nextNode.u, nextNode.v);
      const [msx, msy] = toCanvas(mu, mv);
      const segsAfter = evaluateSectionBezierSegments(nodes);
      let mInsert = -1;
      let mBest = Infinity;
      for (let i = 0; i < segsAfter.length; i++) {
        const seg = segsAfter[i];
        let [px, py] = toCanvas(seg.p0[0], seg.p0[1]);
        for (let st = 1; st <= 16; st++) {
          const t = st / 16;
          const mt = 1 - t;
          const u = mt ** 3 * seg.p0[0] + 3 * mt ** 2 * t * seg.c1[0] + 3 * mt * t ** 2 * seg.c2[0] + t ** 3 * seg.p1[0];
          const v = mt ** 3 * seg.p0[1] + 3 * mt ** 2 * t * seg.c1[1] + 3 * mt * t ** 2 * seg.c2[1] + t ** 3 * seg.p1[1];
          const [qx, qy] = toCanvas(u, v);
          const d = distPointToSeg(msx, msy, px, py, qx, qy);
          if (d < mBest) {
            mBest = d;
            mInsert = i + 1;
          }
          px = qx;
          py = qy;
        }
      }
      if (mInsert >= 0 && mBest <= curveHitR * 1.35) {
        mirrorRef = {
          u: Math.round(clamp(mu, -0.3, 1.3) * 1000) / 1000,
          v: Math.round(clamp(mv, -0.3, 1.3) * 1000) / 1000,
          mode: 'smooth',
        };
        nodes.splice(mInsert, 0, mirrorRef);
      }
    }

    const actualIdx = Math.max(0, nodes.indexOf(nextNode));
    const actualMirror = mirrorRef ? nodes.indexOf(mirrorRef) : -1;
    setSelectedIdx(insertTarget, actualIdx);
    lastInsertedAt = Date.now();
    syncShapeTransitions(curShape);
    opts.afterMutate({ live: false });
    if (startDrag) {
      const axOff = actualMirror >= 0 ? getAxisOffset(nextNode) : 0;
      const origSide: -1 | 0 | 1 = actualMirror >= 0 ? (axOff < -0.045 ? -1 : axOff > 0.045 ? 1 : 0) : 0;
      const origNodes = nodes.map(cloneLoftNode);
      drag = {
        kind: 'node',
        target: insertTarget,
        idx: actualIdx,
        mirrorIdx: actualMirror,
        origSide,
        origNodes,
        slideRail: buildLoftNodeSlideRail(origNodes, actualIdx),
        mirrorRail:
          actualMirror >= 0 && actualMirror !== actualIdx
            ? buildLoftNodeSlideRail(origNodes, actualMirror)
            : null,
        historyPushed: true,
        startX: sx,
        startY: sy,
      };
    }
    drawCanvas();
    onSyncExternal();
  };

  canvas.onpointerdown = (e) => {
    if (activePointerId !== null && activePointerId !== e.pointerId) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic PointerEvent in tests
    }
    const [sx, sy] = getPointerPos(e);
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const handleHitR = isTouch ? 18 : 10;
    const nodeHitR = isTouch ? 20 : 12;
    const curveHitR = isTouch ? 14 : 9;

    const sec = getActiveSection(getShape());
    const isHollow = Boolean(getShape().loftHollow);
    const isCustomInner = isHollow && (sec.innerMode ?? 'parallel') === 'custom';
    const activeTarget = getActiveTarget();

    if (drawMode === 'freehand') {
      const lp = toLocal(sx, sy);
      drag = { kind: 'freehand', target: activeTarget, ptsLocal: [lp], ptsCanvas: [[sx, sy]] };
      drawCanvas();
      return;
    }

    // 1. Check bezier handles on active curve's selected node (pick closer)
    const activeNodes = getNodesForTarget(sec, activeTarget);
    const selIdx = getSelectedIdx(sec, activeTarget);
    const sel = activeNodes[selIdx];
    if (sel && sel.mode === 'bezier') {
      const [ix, iy] = toCanvas(sel.u + (sel.inDu ?? 0), sel.v + (sel.inDv ?? 0));
      const [ox, oy] = toCanvas(sel.u + (sel.outDu ?? 0), sel.v + (sel.outDv ?? 0));
      const dIn = Math.hypot(sx - ix, sy - iy);
      const dOut = Math.hypot(sx - ox, sy - oy);
      let pickSide: 'in' | 'out' | null = null;
      if (dIn <= handleHitR && dIn <= dOut) pickSide = 'in';
      else if (dOut <= handleHitR) pickSide = 'out';
      if (pickSide) {
        drag = {
          kind: 'handle',
          target: activeTarget,
          idx: selIdx,
          mirrorIdx: findMirrorIdxFor(activeNodes, selIdx),
          side: pickSide,
          historyPushed: false,
          startX: sx,
          startY: sy,
        };
        return;
      }
    }

    // 2. Check existing node hit on active curve first, then secondary curve (when custom inner is active)
    const candidateTargets: LoftEditTarget[] = isCustomInner
      ? activeTarget === 'inner'
        ? ['inner', 'outer']
        : ['outer', 'inner']
      : ['outer'];

    for (const cand of candidateTargets) {
      const nodes = getNodesForTarget(sec, cand);
      let hitIdx = -1;
      let bestD = nodeHitR;
      for (let i = 0; i < nodes.length; i++) {
        const [nx, ny] = toCanvas(nodes[i].u, nodes[i].v);
        const d = Math.hypot(sx - nx, sy - ny);
        if (d < bestD) {
          bestD = d;
          hitIdx = i;
        }
      }
      if (hitIdx >= 0) {
        editTarget = cand;
        setSelectedIdx(cand, hitIdx);
        const mirrorIdx = findMirrorIdxFor(nodes, hitIdx);
        const axOff = mirrorIdx >= 0 ? getAxisOffset(nodes[hitIdx]) : 0;
        const origSide: -1 | 0 | 1 = mirrorIdx >= 0 ? (axOff < -0.045 ? -1 : axOff > 0.045 ? 1 : 0) : 0;
        const origNodes = nodes.map(cloneLoftNode);
        drag = {
          kind: 'node',
          target: cand,
          idx: hitIdx,
          mirrorIdx,
          origSide,
          origNodes,
          slideRail: buildLoftNodeSlideRail(origNodes, hitIdx),
          mirrorRail:
            mirrorIdx >= 0 && mirrorIdx !== hitIdx
              ? buildLoftNodeSlideRail(origNodes, mirrorIdx)
              : null,
          historyPushed: false,
          startX: sx,
          startY: sy,
        };
        drawCanvas();
        onSyncExternal();
        return;
      }
    }

    // 2b & 3. Compute closest active curve edge, and check linked inner diamond / contour for live thickness drag
    const insertTarget = getActiveTarget();
    const nodes = getNodesForTarget(sec, insertTarget);
    const segs = evaluateSectionBezierSegments(nodes);
    let insertIdx = -1;
    let bestEdgeDist = curveHitR;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      let [px, py] = toCanvas(seg.p0[0], seg.p0[1]);
      for (let st = 1; st <= 16; st++) {
        const t = st / 16;
        const mt = 1 - t;
        const u = mt ** 3 * seg.p0[0] + 3 * mt ** 2 * t * seg.c1[0] + 3 * mt * t ** 2 * seg.c2[0] + t ** 3 * seg.p1[0];
        const v = mt ** 3 * seg.p0[1] + 3 * mt ** 2 * t * seg.c1[1] + 3 * mt * t ** 2 * seg.c2[1] + t ** 3 * seg.p1[1];
        const [qx, qy] = toCanvas(u, v);
        const d = distPointToSeg(sx, sy, px, py, qx, qy);
        if (d < bestEdgeDist) {
          bestEdgeDist = d;
          insertIdx = i + 1;
        }
        px = qx;
        py = qy;
      }
    }

    if (isHollow && !isCustomInner) {
      const autoInner = computeAutoInnerUntransformed(sec);
      const [dx, dy] = getThicknessDiamondPos(autoInner);
      const diamondDist = Math.hypot(sx - dx, sy - dy);
      let minInnerDist = Infinity;
      for (let i = 0; i < autoInner.length; i++) {
        const [ax, ay] = toCanvas(autoInner[i][0], autoInner[i][1]);
        const [bx, by] = toCanvas(
          autoInner[(i + 1) % autoInner.length][0],
          autoInner[(i + 1) % autoInner.length][1],
        );
        const d = distPointToSeg(sx, sy, ax, ay, bx, by);
        if (d < minInnerDist) minInnerDist = d;
      }
      if (diamondDist <= handleHitR || (minInnerDist <= curveHitR && minInnerDist + 2 < bestEdgeDist)) {
        const [cx, cy] = toCanvas(0.5, 0.5);
        drag = {
          kind: 'thickness',
          centerX: cx,
          centerY: cy,
          startDist: Math.max(8, Math.hypot(sx - cx, sy - cy)),
          origThickness: sec.innerThickness ?? 0.25,
          historyPushed: false,
        };
        return;
      }
    }

    // 3. Defer curve edge insert until drag threshold or clean single pointerup
    if (insertIdx >= 0 && e.detail <= 1) {
      drag = {
        kind: 'pending_insert',
        target: insertTarget,
        insertIdx,
        startX: sx,
        startY: sy,
        isTouch,
      };
    }
  };

  canvas.onpointermove = (e) => {
    if (drag.kind === 'none') return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const [sx, sy] = getPointerPos(e);
    const curShape = getShape();
    const sec = getActiveSection(curShape);

    if (drag.kind === 'pending_insert') {
      const thresh = drag.isTouch ? 5 : 3;
      if (Math.hypot(sx - drag.startX, sy - drag.startY) >= thresh) {
        const { target, insertIdx, isTouch } = drag;
        commitInsertNode(target, insertIdx, sx, sy, isTouch ? 14 : 9, true);
      }
      return;
    }

    if (drag.kind === 'freehand') {
      const last = drag.ptsCanvas[drag.ptsCanvas.length - 1];
      if (!last || Math.hypot(sx - last[0], sy - last[1]) >= 4) {
        drag.ptsCanvas.push([sx, sy]);
        drag.ptsLocal.push(toLocal(sx, sy));
        drawCanvas();
      }
      return;
    }

    if (drag.kind === 'thickness') {
      const curDist = Math.hypot(sx - drag.centerX, sy - drag.centerY);
      if (!drag.historyPushed) {
        if (Math.abs(curDist - drag.startDist) < 4) return;
        opts.beforeMutate('拖拽调节控制面壁厚');
        unlockTransitionOnManualEdit(sec);
        drag.historyPushed = true;
      }
      // Dragging closer to center increases wall thickness; dragging outward decreases wall thickness
      const deltaRatio = (drag.startDist - curDist) / Math.max(24, sizePx * 0.28);
      sec.innerThickness = Math.round(clamp(drag.origThickness + deltaRatio, 0.06, 0.78) * 100) / 100;
      syncShapeTransitions(curShape);
      onSyncExternal();
      opts.afterMutate({ live: true });
      return;
    }

    if (drag.kind === 'node') {
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate(
          slideAlongCurve
            ? drag.target === 'inner'
              ? '沿轨迹滑移内圈节点'
              : '沿轨迹滑移控制面节点'
            : drag.target === 'inner'
              ? '编辑控制面内圈节点'
              : '编辑控制面曲线节点',
        );
        unlockTransitionOnManualEdit(sec);
        drag.historyPushed = true;
      }
      const nodes = getNodesForTarget(sec, drag.target);
      const nd = nodes[drag.idx];
      if (nd) {
        if (slideAlongCurve) {
          const [lu, lv] = toLocal(sx, sy);
          const proj = projectOntoLoftSlideRail(drag.slideRail, lu, lv);
          const snappedArcS = !e.altKey
            ? computeRailSnapArcS(sec, drag.target, drag.slideRail, proj.u, proj.v, proj.arcS, drag.idx, drag.mirrorIdx)
            : (() => {
                activeGuideU = null;
                activeGuideV = null;
                return proj.arcS;
              })();
          applyLoftNodeSlideAtArcS(
            nodes,
            drag.origNodes,
            drag.idx,
            drag.slideRail,
            snappedArcS,
            drag.mirrorIdx >= 0 && drag.mirrorRail
              ? { idx: drag.mirrorIdx, rail: drag.mirrorRail, mirrorPoint: mirrorLocal }
              : undefined,
          );
        } else {
          let [lu, lv] = toLocal(sx, sy);
          if (drag.origSide !== 0) {
            if (isoAlign) {
              const marginPx = sizePx * 0.025;
              const clampedSx =
                drag.origSide === -1
                  ? Math.min(sx, sizePx * 0.5 - marginPx)
                  : Math.max(sx, sizePx * 0.5 + marginPx);
              [lu, lv] = toLocal(clampedSx, sy);
            } else {
              lu = drag.origSide === -1 ? Math.min(lu, 0.455) : Math.max(lu, 0.545);
            }
          }
          if (!e.altKey && drag.origSide === 0) {
            [lu, lv] = computeSnappedNodeUV(sec, drag.target, lu, lv, drag.idx, drag.mirrorIdx);
          } else if (!e.altKey) {
            const [su, sv] = computeSnappedNodeUV(sec, drag.target, lu, lv, drag.idx, drag.mirrorIdx);
            lu = drag.origSide === -1 ? Math.min(su, 0.455) : Math.max(su, 0.545);
            lv = sv;
          } else {
            activeGuideU = null;
            activeGuideV = null;
          }
          nd.u = Math.round(lu * 10000) / 10000;
          nd.v = Math.round(lv * 10000) / 10000;
          if (drag.mirrorIdx >= 0 && nodes[drag.mirrorIdx]) {
            const [mu, mv] = mirrorLocal(nd.u, nd.v);
            nodes[drag.mirrorIdx].u = Math.round(clamp(mu, -0.3, 1.3) * 10000) / 10000;
            nodes[drag.mirrorIdx].v = Math.round(clamp(mv, -0.3, 1.3) * 10000) / 10000;
          }
        }
      }
      syncShapeTransitions(curShape);
      drawCanvas();
      onSyncExternal();
      opts.afterMutate({ live: true });
      return;
    }

    if (drag.kind === 'handle') {
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate('调整曲线控制手柄');
        unlockTransitionOnManualEdit(sec);
        drag.historyPushed = true;
      }
      const nodes = getNodesForTarget(sec, drag.target);
      const nd = nodes[drag.idx];
      if (nd) {
        const [lu, lv] = toLocal(sx, sy);
        let du = clamp(lu - nd.u, -0.8, 0.8);
        let dv = clamp(lv - nd.v, -0.8, 0.8);
        if (anchorSnap && !e.altKey) {
          const r = Math.hypot(du, dv);
          if (r > 0.01) {
            const ang = Math.atan2(dv, du);
            const snapAng = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
            if (Math.abs(ang - snapAng) <= (8 * Math.PI) / 180) {
              const snapLen = snapStep > 0 ? Math.round(r / snapStep) * snapStep : r;
              du = clamp(Math.cos(snapAng) * snapLen, -0.8, 0.8);
              dv = clamp(Math.sin(snapAng) * snapLen, -0.8, 0.8);
            }
          }
        }
        if (drag.side === 'in') {
          nd.inDu = du;
          nd.inDv = dv;
        } else {
          nd.outDu = du;
          nd.outDv = dv;
        }
        if (mirrorEdit && !e.altKey && drag.mirrorIdx >= 0 && drag.mirrorIdx !== drag.idx) {
          const mNode = nodes[drag.mirrorIdx];
          if (mNode && mNode.mode === 'bezier') {
            const [mBaseU, mBaseV] = mirrorLocal(nd.u, nd.v);
            const [mTipU, mTipV] = mirrorLocal(nd.u + du, nd.v + dv);
            const mDu = clamp(mTipU - mBaseU, -0.8, 0.8);
            const mDv = clamp(mTipV - mBaseV, -0.8, 0.8);
            if (drag.side === 'in') {
              mNode.outDu = mDu;
              mNode.outDv = mDv;
            } else {
              mNode.inDu = mDu;
              mNode.inDv = mDv;
            }
          }
        }
      }
      syncShapeTransitions(curShape);
      drawCanvas();
      opts.afterMutate({ live: true });
    }
  };

  const finishPointer = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    activePointerId = null;
    if (drag.kind === 'none') return;
    if (canvas.hasPointerCapture(e.pointerId)) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore capture release failures
      }
    }

    if (drag.kind === 'pending_insert') {
      const { target, insertIdx, startX, startY, isTouch } = drag;
      drag = { kind: 'none' };
      if (e.type === 'pointerup') {
        commitInsertNode(target, insertIdx, startX, startY, isTouch ? 14 : 9, false);
      }
      return;
    }

    if (drag.kind === 'freehand') {
      const pts = drag.ptsLocal;
      const target = drag.target;
      drag = { kind: 'none' };
      activeGuideU = null;
      activeGuideV = null;
      if (pts.length >= 6) {
        opts.beforeMutate(target === 'inner' ? '手绘闭合内圈截面' : '手绘闭合控制面');
        const curShape = getShape();
        const sec = getActiveSection(curShape);
        unlockTransitionOnManualEdit(sec);
        const { nodes: fitted, usedFallback } = fitClosedFreehandNodesWithMeta(pts, 16);
        if (target === 'inner') {
          sec.innerMode = 'custom';
          sec.innerNodes = fitted;
          selectedInnerIdx = 0;
        } else {
          sec.nodes = fitted;
          selectedOuterIdx = 0;
        }
        drawMode = 'nodes';
        syncShapeTransitions(curShape);
        opts.afterMutate({ live: false });
        if (usedFallback) {
          toast('闭合笔画围合面积太小或点数不足，已按默认圆形拟合，可继续调整节点');
        } else {
          toast(`✨ 已拟合 ${fitted.length} 个${target === 'inner' ? '内圈' : '外圈'}闭合曲线节点`);
        }
      }
      drawCanvas();
      onSyncExternal();
      return;
    }

    const hadGuides = activeGuideU !== null || activeGuideV !== null;
    activeGuideU = null;
    activeGuideV = null;
    const pushed = drag.historyPushed;
    drag = { kind: 'none' };
    if (pushed) {
      opts.afterMutate({ live: false });
      drawCanvas();
      onSyncExternal();
    } else if (hadGuides) {
      drawCanvas();
    }
  };

  canvas.onpointerup = finishPointer;
  canvas.onpointercancel = finishPointer;
  canvas.onlostpointercapture = finishPointer;

  const deleteSelectedNode = () => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    const target = getActiveTarget();
    const nodes = getNodesForTarget(sec, target);
    if (nodes.length <= 3) {
      toast('闭合截面至少需要 3 个节点');
      return;
    }
    opts.beforeMutate(target === 'inner' ? '删除内圈曲线节点' : '删除曲线节点');
    unlockTransitionOnManualEdit(sec);
    const selIdx = getSelectedIdx(sec, target);
    const mirrorIdx = mirrorEdit ? findMirrorIdxFor(nodes, selIdx) : -1;
    if (mirrorIdx >= 0 && mirrorIdx !== selIdx && nodes.length >= 4) {
      const hi = Math.max(selIdx, mirrorIdx);
      const lo = Math.min(selIdx, mirrorIdx);
      nodes.splice(hi, 1);
      nodes.splice(lo, 1);
    } else {
      nodes.splice(selIdx, 1);
    }
    setSelectedIdx(target, Math.max(0, Math.min(selIdx, nodes.length - 1)));
    syncShapeTransitions(curShape);
    opts.afterMutate({ live: false });
    drawCanvas();
    onSyncExternal();
  };

  canvas.ondblclick = (e) => {
    if (drawMode !== 'nodes') return;
    const [sx, sy] = getPointerPos(e);
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    if (curShape.loftHollow && (sec.innerMode ?? 'parallel') !== 'custom') {
      const autoInner = computeAutoInnerUntransformed(sec);
      const [dx, dy] = getThicknessDiamondPos(autoInner);
      let nearAutoInner = Math.hypot(sx - dx, sy - dy) <= 14;
      if (!nearAutoInner) {
        for (let i = 0; i < autoInner.length; i++) {
          const [ax, ay] = toCanvas(autoInner[i][0], autoInner[i][1]);
          const [bx, by] = toCanvas(
            autoInner[(i + 1) % autoInner.length][0],
            autoInner[(i + 1) % autoInner.length][1],
          );
          if (distPointToSeg(sx, sy, ax, ay, bx, by) <= 12) {
            nearAutoInner = true;
            break;
          }
        }
      }
      if (nearAutoInner) {
        unlockInnerToCustom('解锁当前控制面内圈节点');
        toast('🔓 已解锁当前控制面的内圈控制点，可独立编辑或套用任意预设');
        drawCanvas();
        onSyncExternal();
        return;
      }
    }

    if (Date.now() - lastInsertedAt < 360) return;

    const activeTarget = getActiveTarget();
    const nodes = getNodesForTarget(sec, activeTarget);
    const selIdx = getSelectedIdx(sec, activeTarget);
    const sel = nodes[selIdx];
    if (sel && sel.mode === 'bezier') {
      const [ix, iy] = toCanvas(sel.u + (sel.inDu ?? 0), sel.v + (sel.inDv ?? 0));
      const [ox, oy] = toCanvas(sel.u + (sel.outDu ?? 0), sel.v + (sel.outDv ?? 0));
      if (Math.hypot(sx - ix, sy - iy) <= 12 || Math.hypot(sx - ox, sy - oy) <= 12) return;
    }

    let hitIdx = -1;
    let bestD = 14;
    for (let i = 0; i < nodes.length; i++) {
      const [nx, ny] = toCanvas(nodes[i].u, nodes[i].v);
      const d = Math.hypot(sx - nx, sy - ny);
      if (d < bestD) {
        bestD = d;
        hitIdx = i;
      }
    }
    if (hitIdx < 0) return;
    setSelectedIdx(activeTarget, hitIdx);
    deleteSelectedNode();
  };

  const screenDeltaToLocalDelta = (dxScreen: number, dyScreen: number): [number, number] => {
    const [u0, v0] = toLocal(sizePx * 0.5, sizePx * 0.5);
    const [u1, v1] = toLocal(sizePx * 0.5 + dxScreen * 10, sizePx * 0.5 + dyScreen * 10);
    const du = u1 - u0;
    const dv = v1 - v0;
    const mag = Math.hypot(du, dv) || 1;
    return [du / mag, dv / mag];
  };

  const applyNudgeAlongRailTarget = (
    curShape: ParametricShape,
    sec: LoftSection,
    target: LoftEditTarget,
    nodes: LoftNode[],
    selIdx: number,
    targetArcS: number,
    pushHistory: boolean,
    label: string,
  ): boolean => {
    const nd = nodes[selIdx];
    if (!nd) return false;
    const origNodes = nodes.map(cloneLoftNode);
    const rail = buildLoftNodeSlideRail(origNodes, selIdx);
    const mIdx = mirrorEdit ? findMirrorIdxFor(origNodes, selIdx) : -1;
    const mRail = mIdx >= 0 && mIdx !== selIdx ? buildLoftNodeSlideRail(origNodes, mIdx) : undefined;
    const testNodes = origNodes.map(cloneLoftNode);
    const testRes = applyLoftNodeSlideAtArcS(
      testNodes,
      origNodes,
      selIdx,
      rail,
      targetArcS,
      mRail ? { idx: mIdx, rail: mRail, mirrorPoint: mirrorLocal } : undefined,
    );
    if (Math.hypot(testRes.u - nd.u, testRes.v - nd.v) < 1e-6) return false;
    if (pushHistory) {
      opts.beforeMutate(label);
    }
    unlockTransitionOnManualEdit(sec);
    applyLoftNodeSlideAtArcS(
      nodes,
      origNodes,
      selIdx,
      rail,
      targetArcS,
      mRail ? { idx: mIdx, rail: mRail, mirrorPoint: mirrorLocal } : undefined,
    );
    syncShapeTransitions(curShape);
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const nudgeAlongRail = (dirSign: -1 | 1, stepOverride?: number, pushHistory = true): boolean => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    const target = getActiveTarget();
    const nodes = getNodesForTarget(sec, target);
    const selIdx = getSelectedIdx(sec, target);
    const nd = nodes[selIdx];
    if (!nd) return false;
    const step = stepOverride ?? nudgeStep;
    return applyNudgeAlongRailTarget(
      curShape,
      sec,
      target,
      nodes,
      selIdx,
      dirSign * step,
      pushHistory,
      target === 'inner' ? '沿轨迹微调内圈控制点' : '沿轨迹微调控制面节点',
    );
  };

  const applyNudgeScreen = (dxScreen: number, dyScreen: number, stepOverride?: number, pushHistory = true): boolean => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    const target = getActiveTarget();
    const nodes = getNodesForTarget(sec, target);
    const selIdx = getSelectedIdx(sec, target);
    const nd = nodes[selIdx];
    if (!nd) return false;
    const step = stepOverride ?? nudgeStep;
    const [duDir, dvDir] = screenDeltaToLocalDelta(dxScreen, dyScreen);
    if (slideAlongCurve) {
      const rail = buildLoftNodeSlideRail(nodes.map(cloneLoftNode), selIdx);
      const proj = projectOntoLoftSlideRail(rail, nd.u + duDir * step, nd.v + dvDir * step);
      return applyNudgeAlongRailTarget(
        curShape,
        sec,
        target,
        nodes,
        selIdx,
        proj.arcS,
        pushHistory,
        target === 'inner' ? '沿轨迹微调内圈控制点' : '沿轨迹微调控制面节点',
      );
    }
    const nextU = Math.round(clamp(nd.u + duDir * step, -0.3, 1.3) * 10000) / 10000;
    const nextV = Math.round(clamp(nd.v + dvDir * step, -0.3, 1.3) * 10000) / 10000;
    if (nextU === nd.u && nextV === nd.v) return false;
    if (pushHistory) {
      opts.beforeMutate(target === 'inner' ? '微调内圈控制点' : '微调控制面节点');
    }
    unlockTransitionOnManualEdit(sec);
    nd.u = nextU;
    nd.v = nextV;
    const mIdx = mirrorEdit ? findMirrorIdxFor(nodes, selIdx) : -1;
    if (mIdx >= 0 && mIdx !== selIdx && nodes[mIdx]) {
      const [mu, mv] = mirrorLocal(nd.u, nd.v);
      nodes[mIdx].u = Math.round(clamp(mu, -0.3, 1.3) * 10000) / 10000;
      nodes[mIdx].v = Math.round(clamp(mv, -0.3, 1.3) * 10000) / 10000;
    }
    syncShapeTransitions(curShape);
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const snapSelectedNode = () => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    const target = getActiveTarget();
    const nodes = getNodesForTarget(sec, target);
    const selIdx = getSelectedIdx(sec, target);
    const nd = nodes[selIdx];
    if (!nd) return;
    const mIdx = mirrorEdit ? findMirrorIdxFor(nodes, selIdx) : -1;
    if (slideAlongCurve) {
      const origNodes = nodes.map(cloneLoftNode);
      const rail = buildLoftNodeSlideRail(origNodes, selIdx);
      const [su, sv] = computeSnappedNodeUV(sec, target, nd.u, nd.v, selIdx, mIdx, true);
      const proj = projectOntoLoftSlideRail(rail, su, sv);
      activeGuideU = null;
      activeGuideV = null;
      const moved = applyNudgeAlongRailTarget(
        curShape,
        sec,
        target,
        nodes,
        selIdx,
        proj.arcS,
        true,
        '沿轨迹贴合控制点到锚点/网格',
      );
      if (!moved) {
        toast('当前控制点已沿轨迹对齐最近锚点/网格');
        return;
      }
      opts.afterMutate({ live: false });
      return;
    }
    const [su, sv] = computeSnappedNodeUV(sec, target, nd.u, nd.v, selIdx, mIdx, true);
    const rU = Math.round(su * 10000) / 10000;
    const rV = Math.round(sv * 10000) / 10000;
    activeGuideU = null;
    activeGuideV = null;
    if (rU === nd.u && rV === nd.v) {
      toast('当前控制点已对齐最近锚点/网格');
      return;
    }
    opts.beforeMutate('贴合控制点到锚点/网格');
    unlockTransitionOnManualEdit(sec);
    nd.u = rU;
    nd.v = rV;
    if (mIdx >= 0 && mIdx !== selIdx && nodes[mIdx]) {
      const [mu, mv] = mirrorLocal(nd.u, nd.v);
      nodes[mIdx].u = Math.round(clamp(mu, -0.3, 1.3) * 10000) / 10000;
      nodes[mIdx].v = Math.round(clamp(mv, -0.3, 1.3) * 10000) / 10000;
    }
    syncShapeTransitions(curShape);
    opts.afterMutate({ live: false });
    drawCanvas();
    onSyncExternal();
  };

  bindSubCanvasNudgeScope(canvas, {
    nudgeScreen: (dx, dy, shiftBoost, pushHistory) =>
      drawMode === 'nodes' && applyNudgeScreen(dx, dy, nudgeStep * (shiftBoost ? 4 : 1), pushHistory),
    nudgeAux: (dir, shiftBoost, pushHistory) =>
      drawMode === 'nodes' &&
      slideAlongCurve &&
      nudgeAlongRail(dir, nudgeStep * (shiftBoost ? 4 : 1), pushHistory),
    commitNudge: () => opts.afterMutate({ live: false }),
  });

  return {
    canvas,
    drawCanvas,
    get isoAlign() { return isoAlign; },
    setIsoAlign(v: boolean) {
      isoAlign = v;
      drawCanvas();
      onSyncExternal();
    },
    get drawMode() { return drawMode; },
    setDrawMode(m: 'nodes' | 'freehand') {
      drawMode = m;
      drawCanvas();
      onSyncExternal();
    },
    get mirrorEdit() { return mirrorEdit; },
    setMirrorEdit(v: boolean) {
      mirrorEdit = v;
      drawCanvas();
      onSyncExternal();
    },
    get slideAlongCurve() { return slideAlongCurve; },
    setSlideAlongCurve(v: boolean) {
      slideAlongCurve = v;
      drawCanvas();
      onSyncExternal();
    },
    get anchorSnap() { return anchorSnap; },
    setAnchorSnap(v: boolean) {
      anchorSnap = v;
      if (!v) {
        activeGuideU = null;
        activeGuideV = null;
      }
      drawCanvas();
      onSyncExternal();
    },
    get snapStep() { return snapStep; },
    setSnapStep(v: number) {
      snapStep = v;
      onSyncExternal();
    },
    get nudgeStep() { return nudgeStep; },
    setNudgeStep(v: number) {
      nudgeStep = v;
      onSyncExternal();
    },
    get editTarget(): LoftEditTarget { return getActiveTarget(); },
    setEditTarget(t: LoftEditTarget) {
      const curShape = getShape();
      if (t === 'inner') {
        if (!curShape.loftHollow) return;
        const sec = getActiveSection(curShape);
        if ((sec.innerMode ?? 'parallel') !== 'custom') {
          unlockInnerToCustom('切换为自由内圈编辑');
          toast('🔓 已解锁当前控制面内圈控制点，点击上方「平行等厚 / 等比同心」可随时恢复联动');
        } else {
          ensureInnerEditable(sec);
          editTarget = 'inner';
        }
      } else {
        editTarget = 'outer';
      }
      drawCanvas();
      onSyncExternal();
    },
    resetInnerParallelToOuter() {
      const curShape = getShape();
      if (!curShape.loftHollow) return;
      const sec = getActiveSection(curShape);
      opts.beforeMutate('重置内圈为平行外圈');
      unlockTransitionOnManualEdit(sec);
      const [lsu, lsv] = getLocalPlotDims(curShape);
      const prevMode = sec.innerMode;
      sec.innerMode = 'parallel';
      sec.innerNodes = fitEditableNodesFromSectionInner(sec, lsu, lsv, getColumnRefRadius(curShape));
      sec.innerMode = prevMode === 'custom' ? 'custom' : 'parallel';
      if (sec.innerMode === 'custom') editTarget = 'inner';
      selectedInnerIdx = 0;
      syncShapeTransitions(curShape);
      opts.afterMutate({ live: false });
      drawCanvas();
      onSyncExternal();
    },
    resetInnerProportionalToOuter() {
      const curShape = getShape();
      if (!curShape.loftHollow) return;
      const sec = getActiveSection(curShape);
      opts.beforeMutate('重置内圈为等比缩放外圈');
      unlockTransitionOnManualEdit(sec);
      const [lsu, lsv] = getLocalPlotDims(curShape);
      const colRefR = getColumnRefRadius(curShape);
      sec.innerMode = 'custom';
      sec.innerNodes = fitEditableNodesFromSectionInner(
        { ...sec, innerMode: 'proportional' },
        lsu,
        lsv,
        colRefR,
      );
      editTarget = 'inner';
      selectedInnerIdx = 0;
      syncShapeTransitions(curShape);
      opts.afterMutate({ live: false });
      drawCanvas();
      onSyncExternal();
    },
    get selectedNodeIdx() {
      const sec = getActiveSection(getShape());
      return getSelectedIdx(sec, getActiveTarget());
    },
    get selectedNode(): { u: number; v: number } | null {
      const sec = getActiveSection(getShape());
      const target = getActiveTarget();
      const nodes = getNodesForTarget(sec, target);
      const idx = getSelectedIdx(sec, target);
      const nd = nodes[idx];
      return nd ? { u: nd.u, v: nd.v } : null;
    },
    setSelectedNodeIdx(i: number) {
      setSelectedIdx(getActiveTarget(), i);
      drawCanvas();
      onSyncExternal();
    },
    nudgeSelectedByScreen: applyNudgeScreen,
    nudgeAlongRail,
    snapSelectedNodeToAnchor: snapSelectedNode,
    setSelectedNodeMode(mode: LoftNodeMode) {
      const curShape = getShape();
      const sec = getActiveSection(curShape);
      const target = getActiveTarget();
      const nodes = getNodesForTarget(sec, target);
      const selIdx = getSelectedIdx(sec, target);
      const nd = nodes[selIdx];
      if (!nd) return;
      const mIdx = mirrorEdit ? findMirrorIdxFor(nodes, selIdx) : -1;
      const mNd = mIdx >= 0 && mIdx !== selIdx ? nodes[mIdx] : undefined;
      if (nd.mode === mode && (!mNd || mNd.mode === mode)) return;
      opts.beforeMutate('切换节点类型');
      unlockTransitionOnManualEdit(sec);
      const applyMode = (idx: number) => {
        const t = nodes[idx];
        if (!t) return;
        if (mode === 'bezier' && t.mode !== 'bezier') {
          const sm = computeNodeSmoothTangents(nodes, idx);
          t.inDu = sm.inDu;
          t.inDv = sm.inDv;
          t.outDu = sm.outDu;
          t.outDv = sm.outDv;
        }
        t.mode = mode;
      };
      if (nd.mode !== mode) applyMode(selIdx);
      if (mNd && mNd.mode !== mode) {
        if (mode === 'bezier' && nd.mode === 'bezier') {
          const [mBaseU, mBaseV] = mirrorLocal(nd.u, nd.v);
          const [mInU, mInV] = mirrorLocal(nd.u + (nd.outDu ?? 0), nd.v + (nd.outDv ?? 0));
          const [mOutU, mOutV] = mirrorLocal(nd.u + (nd.inDu ?? 0), nd.v + (nd.inDv ?? 0));
          mNd.inDu = clamp(mInU - mBaseU, -0.8, 0.8);
          mNd.inDv = clamp(mInV - mBaseV, -0.8, 0.8);
          mNd.outDu = clamp(mOutU - mBaseU, -0.8, 0.8);
          mNd.outDv = clamp(mOutV - mBaseV, -0.8, 0.8);
          mNd.mode = 'bezier';
        } else {
          applyMode(mIdx);
        }
      }
      syncShapeTransitions(curShape);
      opts.afterMutate({ live: false });
      drawCanvas();
      onSyncExternal();
    },
    deleteSelectedNode,
    getState(): LoftEditorInitState {
      return {
        isoAlign,
        drawMode,
        mirrorEdit,
        slideAlongCurve,
        editTarget: getActiveTarget(),
        selectedOuterIdx,
        selectedInnerIdx,
        anchorSnap,
        snapStep,
        nudgeStep,
      };
    },
  };
}

function createCurveToolbarAndPresets(
  ctrl: ReturnType<typeof createCurveCanvasController>,
  shapeOrGetter: ParametricShape | (() => ParametricShape),
  opts: LoftMutateOpts,
  onAfterChange: () => void,
) {
  const getShape = () => (typeof shapeOrGetter === 'function' ? shapeOrGetter() : shapeOrGetter);
  const innerThickWrap = h('div', { style: 'width:100%' });
  let lastThickSecId = '';
  let thickSliderObj: ReturnType<typeof rangeRow> | null = null;

  const innerRelationButtons = LOFT_INNER_MODES.map((m) => ({
    mode: m.id,
    btn: h(
      'button',
      {
        class: 'btn small',
        title: m.title,
        onclick: () => {
          const curShape = getShape();
          const curSec = getActiveSection(curShape);
          if ((curSec.innerMode ?? 'parallel') === m.id) return;
          if (m.id === 'custom') {
            ctrl.setEditTarget('inner');
          } else {
            opts.beforeMutate(`切换控制面内圈为 ${m.label}`);
            unlockTransitionOnManualEdit(curSec);
            curSec.innerMode = m.id;
            ctrl.setEditTarget('outer');
            syncShapeTransitions(curShape);
            opts.afterMutate({ live: false });
          }
          onAfterChange();
        },
      },
      m.label,
    ) as HTMLButtonElement,
  }));

  const syncAllSectionsBtn = h(
    'button',
    {
      class: 'btn small',
      title: '将当前控制面的内圈模式、壁厚与内圈曲线同步应用到所有控制面',
      onclick: () => {
        const curShape = getShape();
        const curSec = getActiveSection(curShape);
        const allSecs = ensureLoftSections(curShape);
        if (allSecs.length <= 1) {
          toast('当前只有 1 个控制面');
          return;
        }
        opts.beforeMutate('同步内圈设置到全部控制面');
        for (const s of allSecs) {
          if (s.id === curSec.id) continue;
          s.innerMode = curSec.innerMode ?? 'parallel';
          s.innerThickness = curSec.innerThickness ?? 0.25;
          if (curSec.innerMode === 'custom' && curSec.innerNodes && curSec.innerNodes.length >= 3) {
            s.innerNodes = curSec.innerNodes.map(cloneLoftNode);
          }
        }
        syncShapeTransitions(curShape);
        opts.afterMutate({ live: false });
        onAfterChange();
        toast(`📋 已将「${curSec.name}」的内圈设置同步到全部 ${allSecs.length} 个控制面`);
      },
    },
    '📋 同步全部面',
  ) as HTMLButtonElement;

  const innerRelationBar = h(
    'div',
    { class: 'loft-mode-bar' },
    h('span', { class: 'hint' }, '当前面内圈：'),
    ...innerRelationButtons.map((x) => x.btn),
    syncAllSectionsBtn,
  );

  const outerTargetBtn = h(
    'button',
    {
      class: 'btn small',
      onclick: () => ctrl.setEditTarget('outer'),
    },
    '🟢 编辑外圈',
  ) as HTMLButtonElement;
  const innerTargetBtn = h(
    'button',
    {
      class: 'btn small',
      onclick: () => ctrl.setEditTarget('inner'),
    },
    '🔵 编辑内圈',
  ) as HTMLButtonElement;
  const resetParBtn = h(
    'button',
    {
      class: 'btn small',
      title: '将内圈控制点重置为与外圈等距平行的轮廓',
      onclick: () => ctrl.resetInnerParallelToOuter(),
    },
    '🔄 平行外圈',
  ) as HTMLButtonElement;
  const resetPropBtn = h(
    'button',
    {
      class: 'btn small',
      title: '将内圈控制点重置为外圈的同心等比缩小副本',
      onclick: () => ctrl.resetInnerProportionalToOuter(),
    },
    '📐 等比外圈',
  ) as HTMLButtonElement;
  const targetBar = h(
    'div',
    { class: 'loft-mode-bar' },
    outerTargetBtn,
    innerTargetBtn,
    resetParBtn,
    resetPropBtn,
  );

  const modeNodesBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setDrawMode('nodes'),
  }, '✒️ 节点曲线');
  const modeFreeBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setDrawMode('freehand'),
  }, '✏️ 手绘闭合');
  const alignBtn = h('button', {
    class: 'btn small',
    title: '开启后编辑器四向(上后/下前/左/右)与主画布当前等距视角完全同步，避免旋转想象错乱',
    onclick: () => ctrl.setIsoAlign(!ctrl.isoAlign),
  }, '🧭 等距同步');
  const mirrorBtn = h('button', {
    class: 'btn small',
    title: '拖拽对称一侧的节点时自动镜像更新另一侧',
    onclick: () => ctrl.setMirrorEdit(!ctrl.mirrorEdit),
  }, '↔ 对称');

  const freeHintEl = h('span', { class: 'hint' }) as HTMLSpanElement;
  const modeLabelEl = h('span', { class: 'hint' }) as HTMLSpanElement;
  const smoothBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setSelectedNodeMode('smooth'),
  }, '圆滑') as HTMLButtonElement;
  const cornerBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setSelectedNodeMode('corner'),
  }, '折角') as HTMLButtonElement;
  const bezierBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setSelectedNodeMode('bezier'),
  }, '手柄') as HTMLButtonElement;
  const slideBtn = h('button', {
    class: 'btn small',
    title: '开启后拖拽或微调控制点会贴合当前轮廓轨迹滑动（支持平滑延长或收缩圆角直边）',
    onclick: () => ctrl.setSlideAlongCurve(!ctrl.slideAlongCurve),
  }, '🛤️ 沿当前轨迹移动') as HTMLButtonElement;
  const delNodeBtn = h('button', {
    class: 'btn small danger',
    title: '删除当前选中节点（也可双击节点删除）',
    onclick: () => ctrl.deleteSelectedNode(),
  }, '删点') as HTMLButtonElement;

  const nodeModeWrap = h(
    'div',
    { class: 'loft-node-bar' },
    freeHintEl,
    modeLabelEl,
    smoothBtn,
    cornerBtn,
    bezierBtn,
    slideBtn,
    delNodeBtn,
  );
  const snapBtn = h('button', {
    class: 'btn small',
    title: '开启后拖拽节点将自动吸附到 0/0.25/0.5/0.75/1 锚点、同截面其他节点以及网格步距（按住 Alt 临时关闭）',
    onclick: () => ctrl.setAnchorSnap(!ctrl.anchorSnap),
  }, '🧲 锚点吸附') as HTMLButtonElement;

  const snapStepSel = select(
    SNAP_STEP_OPTIONS.map((o) => ({ id: String(o.value), label: o.label })),
    String(ctrl.snapStep),
    (v) => ctrl.setSnapStep(Number(v) || 0),
  );
  snapStepSel.title = '网格吸附步距（锚点优先吸附）';

  const snapNowBtn = h('button', {
    class: 'btn small',
    title: '立即将当前选中控制点吸附贴合到最近锚点或网格坐标',
    onclick: () => ctrl.snapSelectedNodeToAnchor(),
  }, '⊙ 贴合锚点') as HTMLButtonElement;

  const snapBar = h(
    'div',
    { class: 'fine-tune-bar' },
    snapBtn,
    snapStepSel,
    snapNowBtn,
  );

  const coordBadge = h('span', { class: 'fine-coord-badge' }) as HTMLSpanElement;

  const makeNudgeBtn = (label: string, dx: number, dy: number, title: string) => {
    let historyReady = false;
    const btn = h('button', { class: 'btn small nudge-btn', type: 'button', title }, label) as HTMLButtonElement;
    return makeRepeatableButton(btn, {
      onStep: () => {
        const changed = ctrl.nudgeSelectedByScreen(dx, dy, undefined, !historyReady);
        if (changed) {
          historyReady = true;
          opts.afterMutate({ live: true });
        }
        return changed;
      },
      onEnd: (didMutate) => {
        if (didMutate && historyReady) {
          opts.afterMutate({ live: false });
        }
        historyReady = false;
      },
    });
  };

  const nudgeStepSel = select(
    NUDGE_STEP_OPTIONS.map((o) => ({ id: String(o.value), label: o.label })),
    String(ctrl.nudgeStep),
    (v) => ctrl.setNudgeStep(Number(v) || 0.01),
  );
  nudgeStepSel.title = '微调步距';

  const makeRailNudgeBtn = (label: string, dirSign: -1 | 1, title: string) => {
    let historyReady = false;
    const btn = h('button', { class: 'btn small nudge-btn', type: 'button', title }, label) as HTMLButtonElement;
    return makeRepeatableButton(btn, {
      onStep: () => {
        const changed = ctrl.nudgeAlongRail(dirSign, undefined, !historyReady);
        if (changed) {
          historyReady = true;
          opts.afterMutate({ live: true });
        }
        return changed;
      },
      onEnd: (didMutate) => {
        if (didMutate && historyReady) {
          opts.afterMutate({ live: false });
        }
        historyReady = false;
      },
    });
  };
  const railNudgeWrap = h(
    'span',
    { class: 'nudge-pad' },
    makeRailNudgeBtn('◀ 沿轨', -1, '沿当前轨迹逆向微调选中节点'),
    makeRailNudgeBtn('沿轨 ▶', 1, '沿当前轨迹顺向微调选中节点'),
  );

  const fineTuneBar = h(
    'div',
    { class: 'fine-tune-bar' },
    coordBadge,
    h(
      'div',
      { class: 'nudge-pad' },
      makeNudgeBtn('←', -1, 0, '向左微调控制点 (支持长按 / 方向键)'),
      makeNudgeBtn('↑', 0, -1, '向上微调控制点 (支持长按 / 方向键)'),
      makeNudgeBtn('↓', 0, 1, '向下微调控制点 (支持长按 / 方向键)'),
      makeNudgeBtn('→', 1, 0, '向右微调控制点 (支持长按 / 方向键)'),
    ),
    railNudgeWrap,
    nudgeStepSel,
  );

  const presetHint = h('div', { class: 'hint', style: 'margin:4px 0 3px' }, '预设截面（替换当前控制面）：');

  const syncToolbar = () => {
    const curShape = getShape();
    const isHollow = Boolean(curShape.loftHollow);
    const sec = getActiveSection(curShape);
    const innerMode: LoftInnerMode = sec.innerMode ?? 'parallel';
    const isCustomInner = isHollow && innerMode === 'custom';
    const target = ctrl.editTarget;

    // 1. Hollow-only inner relation bar + thickness slider + target switcher
    targetBar.style.display = isHollow ? 'flex' : 'none';
    innerRelationBar.style.display = isHollow ? 'flex' : 'none';
    innerThickWrap.style.display = isHollow && !isCustomInner ? '' : 'none';

    if (isHollow) {
      for (const item of innerRelationButtons) {
        item.btn.classList.toggle('primary', innerMode === item.mode);
      }

      if (!isCustomInner) {
        const pctVal = Math.round((sec.innerThickness ?? 0.25) * 100);
        if (!thickSliderObj || lastThickSecId !== sec.id) {
          lastThickSecId = sec.id;
          innerThickWrap.innerHTML = '';
          thickSliderObj = rangeRow(
            '当前面壁厚 (%)',
            6,
            78,
            pctVal,
            (v) => {
              const curShape = getShape();
              const curSec = getActiveSection(curShape);
              unlockTransitionOnManualEdit(curSec);
              curSec.innerThickness = Math.round(clamp(v / 100, 0.06, 0.78) * 100) / 100;
              syncShapeTransitions(curShape);
              onAfterChange();
              opts.afterMutate({ live: true });
            },
            1,
            {
              onBegin: () => opts.beforeMutate('修改控制面壁厚'),
              onCommit: () => {
                syncShapeTransitions(getShape());
                onAfterChange();
                opts.afterMutate({ live: false });
              },
            },
          );
          innerThickWrap.append(thickSliderObj.row);
        } else {
          thickSliderObj.set(pctVal);
        }
      }

      outerTargetBtn.classList.toggle('primary', target === 'outer');
      innerTargetBtn.classList.toggle('primary', target === 'inner');
      innerTargetBtn.title = isCustomInner
        ? '编辑当前控制面的独立内圈节点'
        : '点击自动解锁当前控制面的内圈控制点进行自由编辑（也可双击画布蓝色虚线）';
      innerTargetBtn.textContent = isCustomInner ? '🔵 编辑内圈' : '🔵 编辑内圈 (点击解锁)';
      const showReset = target === 'inner' && isCustomInner;
      resetParBtn.style.display = showReset ? '' : 'none';
      resetPropBtn.style.display = showReset ? '' : 'none';
    }

    modeNodesBtn.classList.toggle('primary', ctrl.drawMode === 'nodes');
    modeFreeBtn.classList.toggle('primary', ctrl.drawMode === 'freehand');
    alignBtn.classList.toggle('primary', ctrl.isoAlign);
    mirrorBtn.classList.toggle('primary', ctrl.mirrorEdit);
    snapBtn.classList.toggle('primary', ctrl.anchorSnap);
    snapStepSel.value = String(ctrl.snapStep);
    nudgeStepSel.value = String(ctrl.nudgeStep);

    presetHint.textContent =
      isHollow && target === 'inner'
        ? '预设截面（点击套用到当前控制面【内圈镂空】）：'
        : '预设截面（点击套用到当前控制面【外圈轮廓】，含平放拱形）：';

    const isFree = ctrl.drawMode === 'freehand';
    freeHintEl.style.display = isFree ? '' : 'none';
    modeLabelEl.style.display = isFree ? 'none' : '';
    smoothBtn.style.display = isFree ? 'none' : '';
    cornerBtn.style.display = isFree ? 'none' : '';
    bezierBtn.style.display = isFree ? 'none' : '';
    slideBtn.style.display = isFree ? 'none' : '';
    slideBtn.classList.toggle('primary', ctrl.slideAlongCurve);
    delNodeBtn.style.display = isFree ? 'none' : '';
    snapBar.style.display = isFree ? 'none' : 'flex';
    fineTuneBar.style.display = isFree ? 'none' : 'flex';
    railNudgeWrap.style.display = !isFree && ctrl.slideAlongCurve ? 'inline-flex' : 'none';

    if (isFree) {
      freeHintEl.textContent =
        target === 'inner'
          ? '在下方框内一笔画出闭合【内圈孔洞】，松手自动拟合平滑节点'
          : '在下方框内一笔画出闭合【外圈轮廓】，松手自动拟合平滑节点';
      return;
    }

    const activeNodes = target === 'inner' && sec.innerNodes ? sec.innerNodes : sec.nodes;
    const nd = activeNodes[ctrl.selectedNodeIdx];
    const prefix = isHollow ? (target === 'inner' ? '内圈点' : '外圈点') : '节点';
    modeLabelEl.textContent = `${prefix} #${ctrl.selectedNodeIdx + 1}/${activeNodes.length}:`;
    coordBadge.textContent = nd
      ? `${prefix}#${ctrl.selectedNodeIdx + 1} (${nd.u.toFixed(3)}, ${nd.v.toFixed(3)})`
      : '未选节点';
    smoothBtn.classList.toggle('primary', nd?.mode === 'smooth');
    cornerBtn.classList.toggle('primary', nd?.mode === 'corner');
    bezierBtn.classList.toggle('primary', nd?.mode === 'bezier');
  };

  const applyPreset = (p: { id: LoftPresetId; label: string }) => {
    const curShape = getShape();
    const sec = getActiveSection(curShape);
    if (curShape.loftHollow && ctrl.editTarget === 'inner') {
      opts.beforeMutate(`套用内圈截面预设：${p.label}`);
      unlockTransitionOnManualEdit(sec);
      const [lsu, lsv] = getLocalPlotDims(curShape);
      sec.innerMode = 'custom';
      sec.innerNodes = createScaledLoftInnerPresetNodes(
        p.id,
        sec.innerThickness ?? 0.25,
        sec,
        lsu,
        lsv,
      );
    } else {
      opts.beforeMutate(`套用截面预设：${p.label}`);
      unlockTransitionOnManualEdit(sec);
      sec.nodes = createLoftPresetNodes(p.id);
    }
    syncShapeTransitions(curShape);
    ctrl.setSelectedNodeIdx(0);
    opts.afterMutate({ live: false });
    ctrl.drawCanvas();
    onAfterChange();
  };

  const mainPresetGrid = h(
    'div',
    { class: 'loft-preset-grid' },
    ...LOFT_PRESETS.map((p) =>
      h('button', {
        class: 'btn small',
        onclick: () => applyPreset(p),
      }, p.label),
    ),
  );

  const polyCollapse = h(
    'details',
    { class: 'loft-poly-collapse' },
    h('summary', {}, '🔷 正多边形预设 (3~12 边形)'),
    h(
      'div',
      { class: 'loft-preset-grid' },
      ...LOFT_POLYGON_PRESETS.map((p) =>
        h('button', {
          class: 'btn small',
          title: `套用 ${p.sides} 条直边的正多边形闭合曲线`,
          onclick: () => applyPreset(p),
        }, p.label),
      ),
    ),
  );

  const presetWrap = h('div', { style: 'width:100%' }, mainPresetGrid, polyCollapse);

  syncToolbar();

  return {
    innerRelationBar,
    innerThickWrap,
    targetBar,
    topBar: h('div', { class: 'loft-mode-bar' }, modeNodesBtn, modeFreeBtn, alignBtn, mirrorBtn),
    snapBar,
    fineTuneBar,
    nodeBar: nodeModeWrap,
    presetHint,
    presetWrap,
    syncToolbar,
  };
}

export function openLoftCurveModal(
  shape: ParametricShape,
  app: App,
  opts: LoftMutateOpts,
  initState?: LoftEditorInitState,
) {
  let refreshAll = () => {};
  let close = () => {};
  const binding = createModalLiveBinding(app, shape, opts.targetLayerId, opts);
  const liveOpts: LoftMutateOpts = {
    targetLayerId: opts.targetLayerId,
    beforeMutate: binding.beforeMutate,
    afterMutate: binding.afterMutate,
  };
  const getLiveShape = () => binding.getShape() ?? shape;

  const ctrl = createCurveCanvasController(360, getLiveShape, app, liveOpts, () => refreshAll(), initState);
  const ui = createCurveToolbarAndPresets(ctrl, getLiveShape, liveOpts, () => refreshAll());

  const secTitle = h('div', { class: 'hint', style: 'margin-bottom:4px' });
  const modalSecSwitchBar = h('div', {
    class: 'loft-mode-bar',
    style: 'justify-content:center;flex-wrap:wrap',
  });
  const modalAddStdBtn = h(
    'button',
    {
      class: 'btn small',
      title: '在当前与相邻控制面之间插入普通控制面',
      onclick: () => {
        insertStandardSectionOnShape(getLiveShape(), liveOpts);
        refreshAll();
      },
    },
    '+ 新增控制面',
  );
  const modalAddTransBtn = h(
    'button',
    {
      class: 'btn small primary',
      title: '新建一个曲线自动作为上下两控制面中间形态的过渡控制面',
      onclick: () => {
        insertTransitionSectionOnShape(getLiveShape(), liveOpts);
        refreshAll();
      },
    },
    '✨ 新建过渡面',
  );
  const modalConvertTransBtn = h(
    'button',
    {
      class: 'btn small',
      title: '将当前选中的中间控制面切换为自动过渡面，或解锁为普通控制面',
      onclick: () => {
        toggleSectionTransitionOnShape(getLiveShape(), liveOpts);
        refreshAll();
      },
    },
    '🔄 转换为过渡面',
  ) as HTMLButtonElement;
  const modalSecActionBar = h(
    'div',
    { class: 'loft-mode-bar', style: 'justify-content:center;flex-wrap:wrap' },
    modalAddStdBtn,
    modalAddTransBtn,
    modalConvertTransBtn,
  );
  const solidModalBtn = h(
    'button',
    {
      class: 'btn small',
      onclick: () => {
        const curShape = getLiveShape();
        if (!curShape.loftHollow) return;
        binding.beforeMutate('切换曲面柱为实心');
        curShape.loftHollow = false;
        ctrl.setEditTarget('outer');
        binding.afterMutate({ live: false, needsResort: true });
        refreshAll();
      },
    },
    '🟢 实心柱体',
  );
  const hollowModalBtn = h(
    'button',
    {
      class: 'btn small',
      onclick: () => {
        const curShape = getLiveShape();
        if (curShape.loftHollow) return;
        binding.beforeMutate('切换曲面柱为镂空');
        curShape.loftHollow = true;
        binding.afterMutate({ live: false, needsResort: true });
        refreshAll();
      },
    },
    '🕳️ 中间镂空',
  );

  let historyBarObj: ReturnType<typeof buildModalUndoRedoBar>;

  refreshAll = () => {
    const live = binding.getShape();
    if (!live) {
      close();
      return;
    }
    const sec = getActiveSection(live);
    const allSecs = ensureLoftSections(live);
    const zPx = Math.round(sec.t * live.heightPx);
    const hollowNote = live.loftHollow
      ? (sec.innerMode ?? 'parallel') === 'custom'
        ? ` · 自由内圈 ${sec.innerNodes?.length ?? 0}点`
        : ' · 双击蓝虚线可解锁自由内圈 / 拖◆调壁厚'
      : '';
    secTitle.textContent = `${sec.isTransition ? '✨[过渡面] ' : ''}当前控制面：${sec.name} · 高度 ${zPx}px (${zPxToMeters(zPx).toFixed(2)}m, ${Math.round(sec.t * 100)}%) · 外圈 ${sec.nodes.length}点${hollowNote}`;
    modalSecSwitchBar.innerHTML = '';
    const asc = [...allSecs].sort((a, b) => a.t - b.t);
    for (const s of asc) {
      modalSecSwitchBar.append(
        h(
          'button',
          {
            class: `btn small${s.id === sec.id ? ' primary' : ''}`,
            onclick: () => {
              live.activeLoftSectionId = s.id;
              refreshAll();
              app.emit('doc_live');
            },
          },
          `${s.isTransition ? '✨ ' : ''}${s.name} (${Math.round(s.t * 100)}%)`,
        ),
      );
    }
    const isTrans = Boolean(sec.isTransition);
    const canTrans = canLoftSectionBeTransition(allSecs, sec.id);
    modalConvertTransBtn.textContent = isTrans ? '✨ 过渡面生效中 · 转为普通面' : '🔄 转换为过渡面';
    modalConvertTransBtn.classList.toggle('transition-active', isTrans);
    modalConvertTransBtn.style.opacity = !isTrans && !canTrans ? '0.6' : '1';
    solidModalBtn.classList.toggle('primary', !live.loftHollow);
    hollowModalBtn.classList.toggle('primary', Boolean(live.loftHollow));
    ui.syncToolbar();
    ctrl.drawCanvas();
    historyBarObj?.sync();
  };

  historyBarObj = buildModalUndoRedoBar(binding, () => refreshAll(), [], {
    nudgeScreen: (dx, dy, shiftBoost, pushHistory) =>
      ctrl.drawMode === 'nodes' &&
      ctrl.nudgeSelectedByScreen(dx, dy, ctrl.nudgeStep * (shiftBoost ? 4 : 1), pushHistory),
    nudgeAux: (dir, shiftBoost, pushHistory) =>
      ctrl.drawMode === 'nodes' &&
      ctrl.slideAlongCurve &&
      ctrl.nudgeAlongRail(dir, ctrl.nudgeStep * (shiftBoost ? 4 : 1), pushHistory),
    commitNudge: () => liveOpts.afterMutate({ live: false }),
  });
  refreshAll();

  const onExternalDoc = (what: string) => {
    if (!ctrl.canvas.isConnected) {
      unsubDoc();
      return;
    }
    if (what === 'doc' || what === 'layers' || what === 'history') refreshAll();
  };
  const unsubDoc = app.on(onExternalDoc);

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:7px;align-items:center' },
    historyBarObj.bar,
    secTitle,
    modalSecSwitchBar,
    modalSecActionBar,
    h('div', { class: 'loft-mode-bar' }, solidModalBtn, hollowModalBtn),
    ui.innerRelationBar,
    ui.innerThickWrap,
    ui.targetBar,
    ui.topBar,
    ui.snapBar,
    ui.nodeBar,
    h('div', { class: 'loft-curve-wrap large' }, ctrl.canvas),
    ui.fineTuneBar,
    ui.presetHint,
    ui.presetWrap,
  );

  let closed = false;
  close = openSheet('✒️ 精细编辑控制面闭合曲线（外圈 & 内圈镂空）', body, {
    wide: true,
    onClose: () => {
      if (closed) return;
      closed = true;
      unsubDoc();
      historyBarObj.dispose();
      binding.dispose();
      app.emit('doc');
    },
    actions: [
      h('button', {
        class: 'btn primary',
        onclick: () => close(),
      }, '完成编辑 ✓'),
    ],
  });
}

export function buildLoftInspectorSection(
  shape: ParametricShape,
  app: App,
  opts: LoftMutateOpts,
): HTMLElement {
  ensureActiveLoftSection(shape);

  const root = h('div', { class: 'loft-editor-box' });
  root.append(h('div', { class: 'menu-sec' }, '曲面柱 / 平放拱控制面（支持多层实心与内圈镂空）'));

  let syncStackAndCurve = () => {};
  const ctrl = createCurveCanvasController(236, shape, app, opts, () => syncStackAndCurve());
  const ui = createCurveToolbarAndPresets(ctrl, shape, opts, () => syncStackAndCurve());

  // Solid vs Hollow toggle + optional recessed floor slider
  const solidBtn = h(
    'button',
    {
      class: 'btn small',
      style: 'flex:1',
      onclick: () => {
        if (!shape.loftHollow) return;
        opts.beforeMutate('切换曲面柱为实心');
        shape.loftHollow = false;
        ctrl.setEditTarget('outer');
        syncHollowHeader();
        syncStackAndCurve();
        opts.afterMutate({ live: false, needsResort: true });
      },
    },
    '🟢 实心柱体',
  );
  const hollowBtn = h(
    'button',
    {
      class: 'btn small',
      style: 'flex:1',
      onclick: () => {
        if (shape.loftHollow) return;
        opts.beforeMutate('切换曲面柱为中间镂空');
        shape.loftHollow = true;
        syncHollowHeader();
        syncStackAndCurve();
        opts.afterMutate({ live: false, needsResort: true });
      },
    },
    '🕳️ 中间镂空 (支持内圈)',
  );

  const floorRowObj = rangeRow(
    '内底封底 (%)',
    0,
    90,
    Math.round((shape.loftFloorT ?? 0) * 100),
    (v) => {
      if (v <= 0) delete shape.loftFloorT;
      else shape.loftFloorT = clamp(v / 100, 0, 0.90);
      opts.afterMutate({ live: true, needsResort: true });
    },
    2,
    {
      onBegin: () => opts.beforeMutate('调整镂空内底高度'),
      onCommit: () => opts.afterMutate({ live: false, needsResort: true }),
    },
  );
  const floorWrap = h(
    'div',
    {},
    floorRowObj.row,
    h('div', { class: 'hint', style: 'margin:-2px 0 4px' }, '0% = 上下完全贯通；调高可做封底天井、看台、喷泉池'),
  );

  const syncHollowHeader = () => {
    const isH = Boolean(shape.loftHollow);
    solidBtn.classList.toggle('primary', !isH);
    hollowBtn.classList.toggle('primary', isH);
    floorWrap.style.display = isH ? '' : 'none';
    floorRowObj.set(Math.round((shape.loftFloorT ?? 0) * 100));
  };

  root.append(
    h('div', { class: 'btn-row' }, solidBtn, hollowBtn),
    floorWrap,
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '面间补全'),
      select<LoftInterpMode>(
        [
          { id: 'smooth', label: '平滑曲面插值 (Catmull-Rom)' },
          { id: 'linear', label: '直线放样过渡 (Linear)' },
        ],
        shape.loftInterp ?? 'smooth',
        (v) => {
          opts.beforeMutate('切换曲面补全方式');
          shape.loftInterp = v;
          opts.afterMutate({ live: false });
        },
      ),
    ),
  );

  const stackListEl = h('div', { class: 'loft-stack-list' });
  const secPropsEl = h('div', { class: 'loft-sec-props' });

  const getSortedDesc = () =>
    [...ensureLoftSections(shape)].sort((a, b) => b.t - a.t);

  const renderStack = () => {
    stackListEl.innerHTML = '';
    const effOri = normalizeRotation(shape.ori + app.doc.viewRotation);
    const activeSec = getActiveSection(shape);
    const desc = getSortedDesc();
    const isH = Boolean(shape.loftHollow);
    const [lsu, lsv] = getLocalPlotDims(shape);
    const colRefR = isH ? computeColumnRefRadiusMetric(desc, lsu, lsv) : undefined;

    for (const sec of desc) {
      const isAct = sec.id === activeSec.id;
      const thumb = document.createElement('canvas');
      thumb.width = 30;
      thumb.height = 30;
      thumb.className = 'loft-sec-thumb';
      drawSectionThumb(thumb, sec, effOri, isAct, isH, lsu, lsv, colRefR);

      const zAtSec = Math.round(sec.t * shape.heightPx);
      const metaParts = [`${Math.round(sec.t * 100)}% · ${zAtSec}px (${zPxToMeters(zAtSec).toFixed(1)}m)`];
      if (sec.isTransition) metaParts.push('自动过渡');
      if (Math.abs(sec.scale - 1) > 1e-2) metaParts.push(`×${sec.scale.toFixed(2)}`);
      if (Math.abs(sec.twistDeg) > 1e-1) metaParts.push(`${Math.round(sec.twistDeg)}°`);
      if (isH) {
        const im = sec.innerMode ?? 'parallel';
        if (im === 'custom') {
          metaParts.push(`内圈${sec.innerNodes?.length ?? 0}点`);
        } else {
          metaParts.push(`${im === 'parallel' ? '平行' : '等比'}${Math.round((sec.innerThickness ?? 0.25) * 100)}%`);
        }
      }

      const row = h(
        'div',
        {
          class: `loft-sec-row${isAct ? ' active' : ''}`,
          onclick: () => {
            shape.activeLoftSectionId = sec.id;
            syncStackAndCurve();
            rebuildActiveSectionProps();
            app.emit('doc_live');
          },
        },
        thumb,
        h(
          'div',
          { class: 'loft-sec-meta' },
          h(
            'div',
            { class: 'loft-sec-name' },
            sec.name,
            sec.isTransition ? h('span', { class: 'sec-transition-badge' }, '✨过渡') : null,
          ),
          h('div', { class: 'loft-sec-sub' }, metaParts.join(' · ')),
        ),
        h('span', { class: 'loft-sec-nodes' }, `${sec.nodes.length}点`),
      );
      stackListEl.append(row);
    }
  };

  const rebuildActiveSectionProps = () => {
    secPropsEl.innerHTML = '';
    const sec = getActiveSection(shape);
    const getHeightPx = () => Math.max(1, Math.round(shape.heightPx));

    const nameIn = h('input', {
      type: 'text',
      class: 'text-input',
      value: sec.name,
      style: 'flex:1;padding:4px 7px;font-size:12px',
      onchange: () => {
        const curSec = getActiveSection(shape);
        opts.beforeMutate('重命名控制面');
        curSec.name = nameIn.value.trim() || '控制面';
        renderStack();
        opts.afterMutate({ live: false });
      },
    }) as HTMLInputElement;
    nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameIn.blur();
    });

    const mSpan = h('span', { class: 'hint mono' }, `${zPxToMeters(sec.t * getHeightPx()).toFixed(2)}m`);

    const pxIn = h('input', {
      type: 'number',
      class: 'num',
      min: '0',
      max: String(getHeightPx()),
      step: '1',
      value: String(Math.round(sec.t * getHeightPx())),
      onchange: () => {
        const curSec = getActiveSection(shape);
        const hPx = getHeightPx();
        const parsed = Number(pxIn.value);
        const px = clamp(Math.round(Number.isFinite(parsed) ? parsed : 0), 0, hPx);
        pxIn.value = String(px);
        opts.beforeMutate('调整控制面高度');
        curSec.t = px / hPx;
        syncShapeTransitions(shape);
        zPctRow.set(Math.round(curSec.t * 100));
        mSpan.textContent = `${zPxToMeters(curSec.t * hPx).toFixed(2)}m`;
        renderStack();
        ctrl.drawCanvas();
        opts.afterMutate({ live: false });
      },
    }) as HTMLInputElement;
    pxIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pxIn.blur();
    });

    const zPctRow = rangeRow(
      '高度位置 (%)',
      0,
      100,
      Math.round(sec.t * 100),
      (v) => {
        const curSec = getActiveSection(shape);
        const hPx = getHeightPx();
        curSec.t = clamp(v / 100, 0, 1);
        syncShapeTransitions(shape);
        const zPx = Math.round(curSec.t * hPx);
        pxIn.value = String(zPx);
        mSpan.textContent = `${zPxToMeters(curSec.t * hPx).toFixed(2)}m`;
        renderStack();
        ctrl.drawCanvas();
        opts.afterMutate({ live: true });
      },
      1,
      {
        onBegin: () => opts.beforeMutate('调整控制面位置'),
        onCommit: () => {
          syncShapeTransitions(shape);
          renderStack();
          ctrl.drawCanvas();
          opts.afterMutate({ live: false });
        },
      },
    );

    const scaleRow = rangeRow(
      '截面缩放',
      0.2,
      1.5,
      sec.scale,
      (v) => {
        const curSec = getActiveSection(shape);
        curSec.scale = Math.round(v * 100) / 100;
        renderStack();
        ctrl.drawCanvas();
        opts.afterMutate({ live: true, needsResort: true });
      },
      0.02,
      {
        onBegin: () => opts.beforeMutate('调整控制面缩放'),
        onCommit: () => {
          renderStack();
          ctrl.drawCanvas();
          opts.afterMutate({ live: false, needsResort: true });
        },
      },
    );

    const twistRow = rangeRow(
      '截面扭转 (°)',
      -180,
      180,
      sec.twistDeg,
      (v) => {
        const curSec = getActiveSection(shape);
        curSec.twistDeg = Math.round(v);
        renderStack();
        ctrl.drawCanvas();
        opts.afterMutate({ live: true });
      },
      5,
      {
        onBegin: () => opts.beforeMutate('调整控制面扭转角'),
        onCommit: () => {
          renderStack();
          ctrl.drawCanvas();
          opts.afterMutate({ live: false });
        },
      },
    );

    const offURow = rangeRow(
      'U 偏移',
      -0.45,
      0.45,
      sec.offsetU,
      (v) => {
        const curSec = getActiveSection(shape);
        curSec.offsetU = Math.round(v * 100) / 100;
        ctrl.drawCanvas();
        opts.afterMutate({ live: true, needsResort: true });
      },
      0.02,
      {
        onBegin: () => opts.beforeMutate('调整控制面 U 偏移'),
        onCommit: () => {
          ctrl.drawCanvas();
          opts.afterMutate({ live: false, needsResort: true });
        },
      },
    );

    const offVRow = rangeRow(
      'V 偏移',
      -0.45,
      0.45,
      sec.offsetV,
      (v) => {
        const curSec = getActiveSection(shape);
        curSec.offsetV = Math.round(v * 100) / 100;
        ctrl.drawCanvas();
        opts.afterMutate({ live: true, needsResort: true });
      },
      0.02,
      {
        onBegin: () => opts.beforeMutate('调整控制面 V 偏移'),
        onCommit: () => {
          ctrl.drawCanvas();
          opts.afterMutate({ live: false, needsResort: true });
        },
      },
    );

    const allSecsForTrans = ensureLoftSections(shape);
    const isTrans = Boolean(sec.isTransition);
    const canTrans = canLoftSectionBeTransition(allSecsForTrans, sec.id);
    const transToggleBtn = h(
      'button',
      {
        class: `btn small${isTrans ? ' transition-active' : ''}`,
        style: `width:100%;margin-bottom:4px;${!isTrans && !canTrans ? 'opacity:0.6;' : ''}`,
        title: isTrans
          ? '当前控制面曲线正自动作为上下两控制面的中间形态；点击可解锁为自由编辑'
          : '将当前控制面转换为上下控制面曲线的自动过渡中间形态（端点不可转换）',
        onclick: () => {
          if (toggleSectionTransitionOnShape(shape, opts)) {
            syncStackAndCurve();
            rebuildActiveSectionProps();
          }
        },
      },
      isTrans ? '✨ 过渡面生效中 · 点击转为普通面' : '🔄 转换为过渡面',
    );

    secPropsEl.append(
      h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '控制面名称'), nameIn),
      transToggleBtn,
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '高度 (px)'),
        pxIn,
        mSpan,
      ),
      zPctRow.row,
      scaleRow.row,
      twistRow.row,
      offURow.row,
      offVRow.row,
      h(
        'div',
        { class: 'preset-row' },
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              const curSec = getActiveSection(shape);
              opts.beforeMutate('重置控制面变形');
              curSec.scale = 1;
              curSec.twistDeg = 0;
              curSec.offsetU = 0;
              curSec.offsetV = 0;
              rebuildActiveSectionProps();
              syncStackAndCurve();
              opts.afterMutate({ live: false, needsResort: true });
            },
          },
          '↺ 重置缩放/扭转/偏移',
        ),
      ),
    );
  };

  syncStackAndCurve = () => {
    syncHollowHeader();
    renderStack();
    ui.syncToolbar();
    ctrl.drawCanvas();
  };

  const isPositionalSecName = (nm: string) =>
    nm === '底层控制面' || nm === '中腰控制面' || nm === '顶层控制面' || /^控制面 #\d+$/.test(nm);

  // Stack action buttons (+ Add, ✨ Transition, Duplicate, Swap Up, Swap Down, Delete)
  const addSecBtn = h(
    'button',
    {
      class: 'btn small primary',
      title: '在当前与相邻控制面之间插入一个新控制面（自动插值外圈与内圈）',
      onclick: () => {
        insertStandardSectionOnShape(shape, opts);
        syncStackAndCurve();
        rebuildActiveSectionProps();
      },
    },
    '+ 新增控制面',
  );

  const addTransBtn = h(
    'button',
    {
      class: 'btn small',
      title: '新建一个曲线自动保持上下控制面中间过渡形态的过渡控制面',
      onclick: () => {
        insertTransitionSectionOnShape(shape, opts);
        syncStackAndCurve();
        rebuildActiveSectionProps();
      },
    },
    '✨ 新建过渡面',
  );

  const dupSecBtn = h(
    'button',
    {
      class: 'btn small',
      title: '复制当前控制面（含外圈与内圈配置）',
      onclick: () => {
        opts.beforeMutate('复制控制面');
        const secs = ensureLoftSections(shape);
        const cur = getActiveSection(shape);
        const nt = cur.t + 0.1 <= 1 ? cur.t + 0.1 : Math.max(0, cur.t - 0.1);
        const dup: LoftSection = {
          id: nextLoftSectionId(),
          name: `${cur.name} 副本`,
          t: Math.round(nt * 100) / 100,
          scale: cur.scale,
          twistDeg: cur.twistDeg,
          offsetU: cur.offsetU,
          offsetV: cur.offsetV,
          nodes: cur.nodes.map(cloneLoftNode),
          innerMode: cur.innerMode,
          innerThickness: cur.innerThickness,
          innerNodes: cur.innerNodes?.map(cloneLoftNode),
        };
        secs.push(dup);
        shape.activeLoftSectionId = dup.id;
        syncShapeTransitions(shape);
        syncStackAndCurve();
        rebuildActiveSectionProps();
        opts.afterMutate({ live: false, needsResort: true });
      },
    },
    '⧉ 复制',
  );

  const swapWithNeighbor = (dir: -1 | 1) => {
    const desc = getSortedDesc();
    const cur = getActiveSection(shape);
    const idx = desc.findIndex((s) => s.id === cur.id);
    const nbIdx = idx + dir;
    if (idx < 0 || nbIdx < 0 || nbIdx >= desc.length) {
      toast(dir < 0 ? '已经在最顶层控制面了' : '已经在最底层控制面了');
      return;
    }
    opts.beforeMutate(dir < 0 ? '上移控制面形状' : '下移控制面形状');
    const nb = desc[nbIdx];
    const tmpNodes = cur.nodes;
    const tmpScale = cur.scale;
    const tmpTwist = cur.twistDeg;
    const tmpOU = cur.offsetU;
    const tmpOV = cur.offsetV;
    const tmpIM = cur.innerMode;
    const tmpIT = cur.innerThickness;
    const tmpIN = cur.innerNodes;
    const tmpTrans = cur.isTransition;

    cur.nodes = nb.nodes;
    cur.scale = nb.scale;
    cur.twistDeg = nb.twistDeg;
    cur.offsetU = nb.offsetU;
    cur.offsetV = nb.offsetV;
    cur.innerMode = nb.innerMode;
    cur.innerThickness = nb.innerThickness;
    cur.innerNodes = nb.innerNodes;
    if (nb.isTransition) cur.isTransition = true;
    else delete cur.isTransition;

    nb.nodes = tmpNodes;
    nb.scale = tmpScale;
    nb.twistDeg = tmpTwist;
    nb.offsetU = tmpOU;
    nb.offsetV = tmpOV;
    nb.innerMode = tmpIM;
    nb.innerThickness = tmpIT;
    nb.innerNodes = tmpIN;
    if (tmpTrans) nb.isTransition = true;
    else delete nb.isTransition;

    if (!isPositionalSecName(cur.name) && !isPositionalSecName(nb.name)) {
      const tmpName = cur.name;
      cur.name = nb.name;
      nb.name = tmpName;
    }

    shape.activeLoftSectionId = nb.id;
    syncShapeTransitions(shape);
    syncStackAndCurve();
    rebuildActiveSectionProps();
    opts.afterMutate({ live: false, needsResort: true });
    toast(dir < 0 ? '已将截面轮廓上移一层' : '已将截面轮廓下移一层');
  };

  const upSecBtn = h('button', {
    class: 'btn small',
    title: '与上方控制面交换截面',
    onclick: () => swapWithNeighbor(-1),
  }, '↑');

  const downSecBtn = h('button', {
    class: 'btn small',
    title: '与下方控制面交换截面',
    onclick: () => swapWithNeighbor(1),
  }, '↓');

  const delSecBtn = h(
    'button',
    {
      class: 'btn small danger',
      title: '删除当前控制面（至少保留 1 个）',
      onclick: () => {
        const secs = ensureLoftSections(shape);
        if (secs.length <= 1) {
          toast('至少需保留 1 个控制面');
          return;
        }
        opts.beforeMutate('删除控制面');
        const cur = getActiveSection(shape);
        const idx = secs.findIndex((s) => s.id === cur.id);
        secs.splice(idx, 1);
        const nextIdx = Math.max(0, Math.min(idx, secs.length - 1));
        shape.activeLoftSectionId = secs[nextIdx].id;
        syncShapeTransitions(shape);
        syncStackAndCurve();
        rebuildActiveSectionProps();
        opts.afterMutate({ live: false, needsResort: true });
      },
    },
    '删除',
  );

  const openModalBtn = h(
    'button',
    {
      class: 'btn small accent',
      style: 'width:100%',
      onclick: () => openLoftCurveModal(shape, app, opts, ctrl.getState()),
    },
    '🔍 大屏精细编辑控制面曲线',
  );

  syncStackAndCurve();
  rebuildActiveSectionProps();

  root.append(
    h('div', { class: 'loft-stack-toolbar' }, addSecBtn, addTransBtn, dupSecBtn, upSecBtn, downSecBtn, delSecBtn),
    stackListEl,
    h('div', { class: 'prop-block' }, secPropsEl),
    h(
      'div',
      { class: 'prop-block' },
      h('div', { style: 'font-size:12px;font-weight:700;margin-bottom:4px' }, '截面闭合曲线工具（虚线=相邻控制面）'),
      ui.innerRelationBar,
      ui.innerThickWrap,
      ui.targetBar,
      ui.topBar,
      ui.snapBar,
      ui.nodeBar,
      h('div', { class: 'loft-curve-wrap' }, ctrl.canvas),
      ui.fineTuneBar,
      ui.presetHint,
      ui.presetWrap,
      h('div', { style: 'margin-top:6px' }, openModalBtn),
    ),
  );

  return root;
}
