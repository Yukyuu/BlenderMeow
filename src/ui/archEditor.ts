// Interactive 2D elevation arch curve editor (outer & hollow inner curve control points, parallel/proportional/vertical-thickness presets, freehand & modal)
import type { App } from '../app';
import {
  ARCH_INNER_MODES,
  ARCH_PRESETS,
  applyArchNodeSlideAtArcS,
  buildArchCrossSection,
  buildArchNodeSlideRail,
  cloneArchNode,
  createArchPresetNodes,
  createScaledInnerPresetNodes,
  evaluateArchBezierSegments,
  fitEditableNodesFromInnerCurve,
  fitFreehandArchNodesWithMeta,
  projectOntoArchSlideRail,
  sampleArchInnerCurve,
  sampleArchOuterCurve,
  sanitizeArchNodesInPlace,
  type ArchHollowStyle,
  type ArchInnerMode,
  type ArchNode,
  type ArchNodeMode,
  type ArchSlideRail,
} from '../core/arch';
import { clamp } from '../core/color';
import { cellsToMeters, zPxToMeters } from '../core/isoMath';
import type { ParametricShape } from '../core/isoRenderer';
import { h, openSheet, rangeRow, select, toast, toggle } from './dom';
import {
  NUDGE_STEP_OPTIONS,
  bindSubCanvasNudgeScope,
  buildModalUndoRedoBar,
  createModalLiveBinding,
  makeRepeatableButton,
} from './fineEditShared';

export interface ArchMutateOpts {
  targetLayerId?: number;
  beforeMutate: (label: string) => void;
  afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => void;
}

export type ArchEditTarget = 'outer' | 'inner';

export interface ArchEditorInitState {
  editTarget?: ArchEditTarget;
  drawMode?: 'nodes' | 'freehand';
  mirrorEdit?: boolean;
  slideAlongCurve?: boolean;
  nudgeStep?: number;
  selectedOuterIdx?: number;
  selectedInnerIdx?: number;
}

function getShapeArchMetrics(shape: ParametricShape): { spanCells: number; spanMetric: number; heightMetric: number } {
  const odd = shape.ori % 2 === 1;
  const spanCells = Math.max(0.125, odd ? shape.sizeV : shape.sizeU);
  const spanMetric = Math.max(4, spanCells * 18);
  const heightMetric = Math.max(4, shape.heightPx);
  return { spanCells, spanMetric, heightMetric };
}

function ensureOuterNodes(shape: ParametricShape): ArchNode[] {
  if (!shape.archNodes || !Array.isArray(shape.archNodes) || shape.archNodes.length < 2) {
    shape.archNodes = createArchPresetNodes('semicircle');
  }
  sanitizeArchNodesInPlace(shape.archNodes, false);
  return shape.archNodes;
}

function computeCurrentAutoInnerCurve(shape: ParametricShape, modeOverride?: ArchInnerMode): [number, number][] {
  const outerPts = sampleArchOuterCurve(ensureOuterNodes(shape), 64, false);
  const { spanMetric, heightMetric } = getShapeArchMetrics(shape);
  const useMode = modeOverride ?? (shape.archInnerMode === 'custom' ? 'parallel' : (shape.archInnerMode ?? 'parallel'));
  return sampleArchInnerCurve(
    outerPts,
    shape.archThickness ?? 0.28,
    shape.archHollowStyle ?? 'shell',
    useMode,
    undefined,
    spanMetric,
    heightMetric,
  );
}

function ensureInnerNodes(shape: ParametricShape): ArchNode[] {
  if (!shape.archInnerNodes || !Array.isArray(shape.archInnerNodes) || shape.archInnerNodes.length < 2) {
    const autoInner = computeCurrentAutoInnerCurve(shape);
    shape.archInnerNodes = fitEditableNodesFromInnerCurve(autoInner);
  }
  sanitizeArchNodesInPlace(shape.archInnerNodes, true);
  return shape.archInnerNodes;
}

function distPointToSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function computeArchSmoothHandles(
  nodes: ArchNode[],
  idx: number,
): { inDs: number; inDh: number; outDs: number; outDh: number } {
  const n = nodes.length;
  if (n < 2) return { inDs: -0.1, inDh: 0, outDs: 0.1, outDh: 0 };
  if (idx === 0) {
    const ds = (nodes[1].s - nodes[0].s) / 3;
    const dh = (nodes[1].h - nodes[0].h) / 3;
    return { inDs: 0, inDh: 0, outDs: ds, outDh: dh };
  }
  if (idx === n - 1) {
    const ds = (nodes[n - 1].s - nodes[n - 2].s) / 3;
    const dh = (nodes[n - 1].h - nodes[n - 2].h) / 3;
    return { inDs: -ds, inDh: -dh, outDs: 0, outDh: 0 };
  }
  const ts = (nodes[idx + 1].s - nodes[idx - 1].s) / 6;
  const th = (nodes[idx + 1].h - nodes[idx - 1].h) / 6;
  return { inDs: -ts, inDh: -th, outDs: ts, outDh: th };
}

function findMirrorPartnerIdx(nodes: ArchNode[], idx: number): number {
  const nd = nodes[idx];
  if (!nd) return -1;
  if (idx === 0) return nodes.length - 1;
  if (idx === nodes.length - 1) return 0;
  const off = nd.s - 0.5;
  if (Math.abs(off) < 0.045) return -1;
  const ms = 1 - nd.s;
  const mh = nd.h;
  let bestIdx = -1;
  let bestD = 0.04;
  for (let i = 1; i < nodes.length - 1; i++) {
    if (i === idx) continue;
    const cand = nodes[i];
    const cOff = cand.s - 0.5;
    if (Math.abs(cOff) < 0.045 || off * cOff >= 0) continue;
    const d = Math.hypot(cand.s - ms, cand.h - mh);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

type DragState =
  | { kind: 'none' }
  | {
      kind: 'pending_insert';
      target: ArchEditTarget;
      insertIdx: number;
      startX: number;
      startY: number;
      isTouch: boolean;
    }
  | {
      kind: 'node';
      target: ArchEditTarget;
      idx: number;
      mirrorIdx: number;
      origSide: -1 | 0 | 1;
      historyPushed: boolean;
      startX: number;
      startY: number;
      origNodes: ArchNode[];
      slideRail: ArchSlideRail;
      mirrorRail?: ArchSlideRail;
    }
  | {
      kind: 'handle';
      target: ArchEditTarget;
      idx: number;
      mirrorIdx: number;
      side: 'in' | 'out';
      historyPushed: boolean;
      startX: number;
      startY: number;
    }
  | {
      kind: 'thickness';
      startY: number;
      origThickness: number;
      historyPushed: boolean;
    }
  | {
      kind: 'freehand';
      target: ArchEditTarget;
      ptsLocal: [number, number][];
      ptsCanvas: [number, number][];
    };

function createArchCanvasController(
  widthPx: number,
  heightPx: number,
  shape: ParametricShape,
  opts: ArchMutateOpts,
  onSyncExternal: () => void,
  initState?: ArchEditorInitState,
) {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const canvas = h('canvas', {
    width: String(Math.round(widthPx * dpr)),
    height: String(Math.round(heightPx * dpr)),
    tabIndex: '0',
    class: 'loft-curve-canvas',
    style: `width:${widthPx}px;max-width:100%;height:auto;aspect-ratio:${widthPx} / ${heightPx};`,
  }) as HTMLCanvasElement;

  let drawMode: 'nodes' | 'freehand' = initState?.drawMode ?? 'nodes';
  let editTarget: ArchEditTarget =
    initState?.editTarget === 'inner' && shape.archHollow && (shape.archInnerMode ?? 'parallel') === 'custom'
      ? 'inner'
      : 'outer';
  let mirrorEdit = initState?.mirrorEdit ?? true;
  let slideAlongCurve = initState?.slideAlongCurve ?? false;
  let nudgeStep = initState?.nudgeStep ?? 0.01;
  let selectedOuterIdx = initState?.selectedOuterIdx ?? 1;
  let selectedInnerIdx = initState?.selectedInnerIdx ?? 1;
  let drag: DragState = { kind: 'none' };
  let activePointerId: number | null = null;
  let lastInsertedAt = 0;

  // Compute aspect-matched drawing frame so equal metric wall thickness looks visibly parallel in 2D too
  const getBoxLayout = () => {
    const padX = Math.round(widthPx * 0.10);
    const padTop = Math.round(heightPx * 0.13);
    const padBot = Math.round(heightPx * 0.15);
    const maxW = widthPx - padX * 2;
    const maxH = heightPx - padTop - padBot;
    const { spanMetric, heightMetric } = getShapeArchMetrics(shape);
    const aspect = clamp(spanMetric / heightMetric, 0.68, 2.2);

    let boxW = maxW;
    let boxH = boxW / aspect;
    if (boxH > maxH) {
      boxH = maxH;
      boxW = boxH * aspect;
    }
    const left = Math.round((widthPx - boxW) * 0.5);
    const top = Math.round(padTop + (maxH - boxH) * 0.5);
    return { left, top, boxW, boxH, padTop, padBot };
  };

  const toCanvas = (s: number, hVal: number): [number, number] => {
    const { left, top, boxW, boxH } = getBoxLayout();
    return [left + s * boxW, top + (1 - hVal) * boxH];
  };

  const toLocal = (sx: number, sy: number): [number, number] => {
    const { left, top, boxW, boxH } = getBoxLayout();
    return [
      clamp((sx - left) / Math.max(1, boxW), 0, 1),
      clamp(1 - (sy - top) / Math.max(1, boxH), 0, 1),
    ];
  };

  const getActiveTarget = (): ArchEditTarget => {
    if (!shape.archHollow || (shape.archInnerMode ?? 'parallel') !== 'custom') {
      editTarget = 'outer';
      return 'outer';
    }
    return editTarget;
  };

  const getNodesForTarget = (t: ArchEditTarget): ArchNode[] =>
    t === 'inner' ? ensureInnerNodes(shape) : ensureOuterNodes(shape);

  const getSelectedIdx = (t: ArchEditTarget): number => {
    const nodes = getNodesForTarget(t);
    if (t === 'inner') {
      if (selectedInnerIdx >= nodes.length) selectedInnerIdx = Math.max(0, nodes.length - 1);
      return selectedInnerIdx;
    }
    if (selectedOuterIdx >= nodes.length) selectedOuterIdx = Math.max(0, nodes.length - 1);
    return selectedOuterIdx;
  };

  const setSelectedIdx = (t: ArchEditTarget, idx: number) => {
    if (t === 'inner') selectedInnerIdx = idx;
    else selectedOuterIdx = idx;
  };

  const unlockInnerToCustom = (pushUndoLabel?: string) => {
    if (!shape.archHollow) return;
    if (shape.archInnerMode !== 'custom') {
      if (pushUndoLabel) opts.beforeMutate(pushUndoLabel);
      if (Array.isArray(shape.archInnerNodes) && shape.archInnerNodes.length >= 2) {
        sanitizeArchNodesInPlace(shape.archInnerNodes, true);
      } else {
        const autoInner = computeCurrentAutoInnerCurve(shape);
        shape.archInnerNodes = fitEditableNodesFromInnerCurve(autoInner);
      }
      shape.archInnerMode = 'custom';
      selectedInnerIdx = Math.min(selectedInnerIdx, shape.archInnerNodes.length - 1);
      if (pushUndoLabel) opts.afterMutate({ live: false });
    } else {
      ensureInnerNodes(shape);
    }
    editTarget = 'inner';
  };

  const getInnerCrownCanvasPos = (innerPts: [number, number][] | null): [number, number] | null => {
    if (!innerPts || innerPts.length < 2) return null;
    const mid = innerPts[Math.floor(innerPts.length / 2)];
    return toCanvas(mid[0], mid[1]);
  };

  const drawNodeSet = (
    ctx: CanvasRenderingContext2D,
    nodes: ArchNode[],
    isPrimary: boolean,
    selIdx: number,
    theme: 'outer' | 'inner',
  ) => {
    const sel = nodes[selIdx];
    if (isPrimary && drawMode === 'nodes' && sel && sel.mode === 'bezier') {
      const [nx, ny] = toCanvas(sel.s, sel.h);
      const showIn = selIdx > 0;
      const showOut = selIdx < nodes.length - 1;
      const [ix, iy] = toCanvas(sel.s + (sel.inDs ?? 0), sel.h + (sel.inDh ?? 0));
      const [ox, oy] = toCanvas(sel.s + (sel.outDs ?? 0), sel.h + (sel.outDh ?? 0));

      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (showIn) {
        ctx.moveTo(ix, iy);
        ctx.lineTo(nx, ny);
      }
      if (showOut) {
        ctx.moveTo(nx, ny);
        ctx.lineTo(ox, oy);
      }
      ctx.stroke();

      for (const [show, hx, hy] of [
        [showIn, ix, iy],
        [showOut, ox, oy],
      ] as [boolean, number, number][]) {
        if (!show) continue;
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (drawMode !== 'nodes') return;
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const [nx, ny] = toCanvas(nd.s, nd.h);
      const isSel = isPrimary && i === selIdx;
      const isEnd = i === 0 || i === nodes.length - 1;
      const r = isSel ? 5.6 : isPrimary ? 4.3 : 3.4;
      const baseMain = theme === 'inner' ? '#38bdf8' : '#34d399';
      ctx.globalAlpha = isPrimary ? 1 : 0.55;
      ctx.fillStyle = isSel
        ? '#fbbf24'
        : isEnd
          ? '#fb923c'
          : nd.mode === 'corner'
            ? '#a78bfa'
            : nd.mode === 'bezier'
              ? '#f472b6'
              : baseMain;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (nd.mode === 'corner' || isEnd) {
        ctx.rect(nx - r, ny - r, r * 2, r * 2);
      } else {
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  const drawCanvas = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!shape.archHollow && editTarget === 'inner') {
      editTarget = 'outer';
    }
    const outerNodes = ensureOuterNodes(shape);
    const isHollow = Boolean(shape.archHollow);
    const innerMode: ArchInnerMode = shape.archInnerMode ?? 'parallel';
    const isCustomInner = isHollow && innerMode === 'custom';
    const innerNodes = isCustomInner ? ensureInnerNodes(shape) : undefined;
    const activeTarget = getActiveTarget();

    const { left, top, boxW, boxH, padTop, padBot } = getBoxLayout();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = '#14111f';
    ctx.fillRect(0, 0, widthPx, heightPx);

    // Elevation grid inside [0..1] x [0..1]
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

    // Nominal [0, 1] bounding frame
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(left, top, boxW, boxH);
    ctx.setLineDash([]);

    // Ground baseline h = 0
    const yGround = top + boxH;
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(Math.max(8, left - 14), yGround);
    ctx.lineTo(Math.min(widthPx - 8, left + boxW + 14), yGround);
    ctx.stroke();

    // Symmetry center axis s = 0.5
    if (mirrorEdit) {
      const [mx, myTop] = toCanvas(0.5, 1.05);
      const [, myBot] = toCanvas(0.5, -0.04);
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, myTop);
      ctx.lineTo(mx, myBot);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axis & active mode labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.76)';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const topHint = isHollow
      ? activeTarget === 'inner'
        ? '当前编辑：🔵 内圈曲线'
        : `当前编辑：🟢 外圈 · 内圈(${innerMode === 'parallel' ? '平行等厚' : innerMode === 'proportional' ? '等比同心' : innerMode === 'equal_vertical' ? '竖向等厚' : '自由控制点'})`
      : '拱顶 H=100%（实心模式）';
    ctx.fillText(topHint, widthPx * 0.5, Math.max(9, padTop * 0.48));
    ctx.fillText('底面基准线 (H=0)', widthPx * 0.5, heightPx - Math.max(8, padBot * 0.42));

    // Actual solid/hollow cross-section fill preview
    const { spanMetric, heightMetric } = getShapeArchMetrics(shape);
    const cs = buildArchCrossSection({
      outerNodes,
      hollow: isHollow,
      hollowStyle: shape.archHollowStyle ?? 'shell',
      innerMode,
      thickness: shape.archThickness ?? 0.28,
      innerNodes,
      spanMetric,
      heightMetric,
      sampleCount: 64,
    });

    if (cs.poly.length >= 3) {
      ctx.beginPath();
      for (let i = 0; i < cs.poly.length; i++) {
        const [px, py] = toCanvas(cs.poly[i][0], cs.poly[i][1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(52, 211, 153, 0.18)';
      ctx.fill();
    }

    // Portal outer wall frame
    if (isHollow && (shape.archHollowStyle ?? 'shell') === 'portal') {
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const [p0x, p0y] = toCanvas(0, 0);
      const [p1x, p1y] = toCanvas(0, 1);
      const [p2x, p2y] = toCanvas(1, 1);
      const [p3x, p3y] = toCanvas(1, 0);
      ctx.moveTo(p0x, p0y);
      ctx.lineTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.lineTo(p3x, p3y);
      ctx.stroke();
    }

    // Outer Bezier curve
    const outerSegs = evaluateArchBezierSegments(outerNodes, false);
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
      ctx.strokeStyle = activeTarget === 'outer' ? '#34d399' : 'rgba(52, 211, 153, 0.50)';
      ctx.lineWidth = activeTarget === 'outer' ? 2.2 : 1.5;
      ctx.stroke();
    }

    // Inner curve (either linked auto-offset with thickness handle OR custom editable Bezier spline)
    if (isHollow && cs.innerPts && cs.innerPts.length >= 2) {
      if (isCustomInner && innerNodes) {
        // Also lightly show clamped actual tunnel boundary if clamped inside outer shell
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 0; i < cs.innerPts.length; i++) {
          const [ix, iy] = toCanvas(cs.innerPts[i][0], cs.innerPts[i][1]);
          if (i === 0) ctx.moveTo(ix, iy);
          else ctx.lineTo(ix, iy);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        const innerSegs = evaluateArchBezierSegments(innerNodes, true);
        if (innerSegs.length > 0) {
          ctx.beginPath();
          const [i0x, i0y] = toCanvas(innerSegs[0].p0[0], innerSegs[0].p0[1]);
          ctx.moveTo(i0x, i0y);
          for (const seg of innerSegs) {
            const [c1x, c1y] = toCanvas(seg.c1[0], seg.c1[1]);
            const [c2x, c2y] = toCanvas(seg.c2[0], seg.c2[1]);
            const [p1x, p1y] = toCanvas(seg.p1[0], seg.p1[1]);
            ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p1x, p1y);
          }
          ctx.strokeStyle = activeTarget === 'inner' ? '#38bdf8' : 'rgba(56, 189, 248, 0.65)';
          ctx.lineWidth = activeTarget === 'inner' ? 2.2 : 1.5;
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (let i = 0; i < cs.innerPts.length; i++) {
          const [ix, iy] = toCanvas(cs.innerPts[i][0], cs.innerPts[i][1]);
          if (i === 0) ctx.moveTo(ix, iy);
          else ctx.lineTo(ix, iy);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw draggable diamond thickness handle at inner crown in linked modes
        const crownPos = getInnerCrownCanvasPos(cs.innerPts);
        if (crownPos && drawMode === 'nodes') {
          const [cx, cy] = crownPos;
          const r = 5.2;
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r);
          ctx.lineTo(cx - r, cy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    if (drawMode === 'nodes' && slideAlongCurve) {
      const drawSlideRail = (rail: ArchSlideRail, strokeStyle: string, lineWidth: number) => {
        if (rail.samples.length < 2) return;
        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (let k = 0; k < rail.samples.length; k++) {
          const [rx, ry] = toCanvas(rail.samples[k].s, rail.samples[k].h);
          if (k === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.stroke();
        ctx.restore();
      };
      const railNodes = activeTarget === 'inner' && innerNodes ? innerNodes : outerNodes;
      const selRailIdx = getSelectedIdx(activeTarget);
      if (drag.kind === 'node' && drag.target === activeTarget) {
        drawSlideRail(drag.slideRail, 'rgba(245, 158, 11, 0.85)', 2.2);
        if (mirrorEdit && drag.mirrorRail) {
          drawSlideRail(drag.mirrorRail, 'rgba(245, 158, 11, 0.4)', 1.5);
        }
      } else if (selRailIdx >= 0 && selRailIdx < railNodes.length) {
        const rail = buildArchNodeSlideRail(railNodes, selRailIdx, activeTarget === 'inner');
        drawSlideRail(rail, 'rgba(245, 158, 11, 0.85)', 2.2);
        if (mirrorEdit) {
          const mIdx = findMirrorPartnerIdx(railNodes, selRailIdx);
          if (mIdx >= 0 && mIdx !== selRailIdx) {
            const mRail = buildArchNodeSlideRail(railNodes, mIdx, activeTarget === 'inner');
            drawSlideRail(mRail, 'rgba(245, 158, 11, 0.4)', 1.5);
          }
        }
      }
    }

    // Draw inactive curve nodes first, then active curve nodes + handles on top
    if (isCustomInner && innerNodes) {
      if (activeTarget === 'inner') {
        drawNodeSet(ctx, outerNodes, false, getSelectedIdx('outer'), 'outer');
        drawNodeSet(ctx, innerNodes, true, getSelectedIdx('inner'), 'inner');
      } else {
        drawNodeSet(ctx, innerNodes, false, getSelectedIdx('inner'), 'inner');
        drawNodeSet(ctx, outerNodes, true, getSelectedIdx('outer'), 'outer');
      }
    } else {
      drawNodeSet(ctx, outerNodes, true, getSelectedIdx('outer'), 'outer');
    }

    // Active freehand stroke preview
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
  };

  const getPointerPos = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const innerLeft = r.left + canvas.clientLeft;
    const innerTop = r.top + canvas.clientTop;
    const innerW = canvas.clientWidth || r.width || 1;
    const innerH = canvas.clientHeight || r.height || 1;
    return [
      ((e.clientX - innerLeft) / Math.max(1, innerW)) * widthPx,
      ((e.clientY - innerTop) / Math.max(1, innerH)) * heightPx,
    ];
  };

  const commitInsertNode = (
    target: ArchEditTarget,
    insertIdx: number,
    sx: number,
    sy: number,
    curveHitR: number,
    startDrag: boolean,
  ) => {
    const nodes = getNodesForTarget(target);
    const isInner = target === 'inner';
    opts.beforeMutate(isInner ? '拱形内圈插入控制点' : '拱形外圈插入控制点');
    const [ls, lh] = toLocal(sx, sy);
    const primaryNode: ArchNode = {
      s: Math.round(clamp(ls, isInner ? 0.02 : 0.01, isInner ? 0.98 : 0.99) * 1000) / 1000,
      h: Math.round(clamp(lh, 0.02, isInner ? 0.96 : 1) * 1000) / 1000,
      mode: 'smooth',
    };
    nodes.splice(insertIdx, 0, primaryNode);

    let mirrorRef: ArchNode | null = null;
    if (mirrorEdit && Math.abs(ls - 0.5) >= 0.045) {
      const ms = Math.round((1 - ls) * 1000) / 1000;
      const mh = primaryNode.h;
      const [msx, msy] = toCanvas(ms, mh);
      const segsAfter = evaluateArchBezierSegments(nodes, isInner);
      let mInsert = -1;
      let mBest = Infinity;
      for (let i = 0; i < segsAfter.length; i++) {
        const seg = segsAfter[i];
        let [px, py] = toCanvas(seg.p0[0], seg.p0[1]);
        for (let st = 1; st <= 16; st++) {
          const t = st / 16;
          const mt = 1 - t;
          const cs = mt ** 3 * seg.p0[0] + 3 * mt ** 2 * t * seg.c1[0] + 3 * mt * t ** 2 * seg.c2[0] + t ** 3 * seg.p1[0];
          const ch = mt ** 3 * seg.p0[1] + 3 * mt ** 2 * t * seg.c1[1] + 3 * mt * t ** 2 * seg.c2[1] + t ** 3 * seg.p1[1];
          const [qx, qy] = toCanvas(cs, ch);
          const d = distPointToSeg(msx, msy, px, py, qx, qy);
          if (d < mBest) {
            mBest = d;
            mInsert = i + 1;
          }
          px = qx;
          py = qy;
        }
      }
      if (mInsert >= 1 && mInsert <= nodes.length - 1 && mBest <= curveHitR * 1.35) {
        mirrorRef = { s: ms, h: mh, mode: 'smooth' };
        nodes.splice(mInsert, 0, mirrorRef);
      }
    }

    sanitizeArchNodesInPlace(nodes, isInner);
    const actualIdx = Math.max(0, nodes.indexOf(primaryNode));
    const actualMirror = mirrorRef ? nodes.indexOf(mirrorRef) : -1;
    setSelectedIdx(target, actualIdx);
    lastInsertedAt = Date.now();
    opts.afterMutate({ live: false });
    if (startDrag) {
      const origSide: -1 | 0 | 1 =
        actualMirror >= 0 ? (primaryNode.s < 0.48 ? -1 : primaryNode.s > 0.52 ? 1 : 0) : 0;
      const origNodes = nodes.map(cloneArchNode);
      drag = {
        kind: 'node',
        target,
        idx: actualIdx,
        mirrorIdx: actualMirror,
        origSide,
        historyPushed: true,
        startX: sx,
        startY: sy,
        origNodes,
        slideRail: buildArchNodeSlideRail(origNodes, actualIdx, isInner),
        mirrorRail:
          actualMirror >= 0 && actualMirror !== actualIdx
            ? buildArchNodeSlideRail(origNodes, actualMirror, isInner)
            : undefined,
      };
    }
    drawCanvas();
    onSyncExternal();
  };

  canvas.onpointerdown = (e) => {
    if (activePointerId !== null && activePointerId !== e.pointerId) return;
    e.preventDefault();
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      // Ignore focus errors
    }
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

    const isHollow = Boolean(shape.archHollow);
    const isCustomInner = isHollow && (shape.archInnerMode ?? 'parallel') === 'custom';
    const activeTarget = getActiveTarget();

    if (drawMode === 'freehand') {
      if (activeTarget === 'inner' && !isCustomInner) {
        unlockInnerToCustom();
      }
      const lp = toLocal(sx, sy);
      drag = { kind: 'freehand', target: getActiveTarget(), ptsLocal: [lp], ptsCanvas: [[sx, sy]] };
      drawCanvas();
      return;
    }

    // 1. Check Bezier handles on currently active curve's selected node (pick closer)
    const activeNodes = getNodesForTarget(activeTarget);
    const selIdx = getSelectedIdx(activeTarget);
    const sel = activeNodes[selIdx];
    if (sel && sel.mode === 'bezier') {
      const mirrorIdx = mirrorEdit ? findMirrorPartnerIdx(activeNodes, selIdx) : -1;
      let bestSide: 'in' | 'out' | null = null;
      let bestHDist = handleHitR;
      if (selIdx > 0) {
        const [ix, iy] = toCanvas(sel.s + (sel.inDs ?? 0), sel.h + (sel.inDh ?? 0));
        const d = Math.hypot(sx - ix, sy - iy);
        if (d <= bestHDist) {
          bestHDist = d;
          bestSide = 'in';
        }
      }
      if (selIdx < activeNodes.length - 1) {
        const [ox, oy] = toCanvas(sel.s + (sel.outDs ?? 0), sel.h + (sel.outDh ?? 0));
        const d = Math.hypot(sx - ox, sy - oy);
        if (d <= bestHDist) {
          bestHDist = d;
          bestSide = 'out';
        }
      }
      if (bestSide) {
        drag = { kind: 'handle', target: activeTarget, idx: selIdx, mirrorIdx, side: bestSide, historyPushed: false, startX: sx, startY: sy };
        return;
      }
    }

    // 2. Check existing node hit on active curve first, then secondary curve (when custom inner is active)
    const candidateTargets: ArchEditTarget[] = isCustomInner
      ? activeTarget === 'inner'
        ? ['inner', 'outer']
        : ['outer', 'inner']
      : ['outer'];

    for (const cand of candidateTargets) {
      const cNodes = getNodesForTarget(cand);
      let hitIdx = -1;
      let bestD = nodeHitR;
      for (let i = 0; i < cNodes.length; i++) {
        const [nx, ny] = toCanvas(cNodes[i].s, cNodes[i].h);
        const d = Math.hypot(sx - nx, sy - ny);
        if (d < bestD) {
          bestD = d;
          hitIdx = i;
        }
      }
      if (hitIdx >= 0) {
        editTarget = cand;
        setSelectedIdx(cand, hitIdx);
        const mirrorIdx = mirrorEdit ? findMirrorPartnerIdx(cNodes, hitIdx) : -1;
        const hitNode = cNodes[hitIdx];
        const origSide: -1 | 0 | 1 =
          mirrorIdx >= 0 ? (hitNode.s < 0.48 ? -1 : hitNode.s > 0.52 ? 1 : 0) : 0;
        const origNodes = cNodes.map(cloneArchNode);
        const candInner = cand === 'inner';
        drag = {
          kind: 'node',
          target: cand,
          idx: hitIdx,
          mirrorIdx,
          origSide,
          historyPushed: false,
          startX: sx,
          startY: sy,
          origNodes,
          slideRail: buildArchNodeSlideRail(origNodes, hitIdx, candInner),
          mirrorRail:
            mirrorIdx >= 0 && mirrorIdx !== hitIdx
              ? buildArchNodeSlideRail(origNodes, mirrorIdx, candInner)
              : undefined,
        };
        drawCanvas();
        onSyncExternal();
        return;
      }
    }

    // 2b & 3. Compute distance to active curve for edge insert, and compare against linked inner curve
    const targetForInsert = getActiveTarget();
    const nodes = getNodesForTarget(targetForInsert);
    const isInner = targetForInsert === 'inner';
    const segs = evaluateArchBezierSegments(nodes, isInner);
    let insertIdx = -1;
    let bestEdgeDist = curveHitR;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      let [px, py] = toCanvas(seg.p0[0], seg.p0[1]);
      for (let st = 1; st <= 16; st++) {
        const t = st / 16;
        const mt = 1 - t;
        const cs = mt ** 3 * seg.p0[0] + 3 * mt ** 2 * t * seg.c1[0] + 3 * mt * t ** 2 * seg.c2[0] + t ** 3 * seg.p1[0];
        const ch = mt ** 3 * seg.p0[1] + 3 * mt ** 2 * t * seg.c1[1] + 3 * mt * t ** 2 * seg.c2[1] + t ** 3 * seg.p1[1];
        const [qx, qy] = toCanvas(cs, ch);
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
      const autoInner = computeCurrentAutoInnerCurve(shape);
      const crownPos = getInnerCrownCanvasPos(autoInner);
      const crownDist = crownPos ? Math.hypot(sx - crownPos[0], sy - crownPos[1]) : Infinity;
      let minInnerDist = Infinity;
      for (let i = 0; i < autoInner.length - 1; i++) {
        const [ax, ay] = toCanvas(autoInner[i][0], autoInner[i][1]);
        const [bx, by] = toCanvas(autoInner[i + 1][0], autoInner[i + 1][1]);
        const d = distPointToSeg(sx, sy, ax, ay, bx, by);
        if (d < minInnerDist) minInnerDist = d;
      }
      if (crownDist <= handleHitR || (minInnerDist <= curveHitR && minInnerDist + 2 < bestEdgeDist)) {
        drag = {
          kind: 'thickness',
          startY: sy,
          origThickness: shape.archThickness ?? 0.28,
          historyPushed: false,
        };
        return;
      }
    }

    // 3. Defer click-on-curve insertion until pointer moves cleanly or pointerup (avoid accidental insert on double-click)
    if (insertIdx >= 1 && insertIdx <= nodes.length - 1 && e.detail <= 1) {
      drag = {
        kind: 'pending_insert',
        target: targetForInsert,
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
      if (!drag.historyPushed) {
        if (Math.abs(sy - drag.startY) < 4) return;
        opts.beforeMutate('拖拽调整拱壁厚度');
        drag.historyPushed = true;
      }
      const { boxH } = getBoxLayout();
      const deltaFrac = (sy - drag.startY) / Math.max(24, boxH);
      shape.archThickness = Math.round(clamp(drag.origThickness + deltaFrac, 0.06, 0.78) * 100) / 100;
      onSyncExternal();
      opts.afterMutate({ live: true });
      return;
    }

    if (drag.kind === 'node') {
      const isInner = drag.target === 'inner';
      const nodes = getNodesForTarget(drag.target);
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate(isInner ? '调整拱形内圈控制点' : '调整拱形外圈控制点');
        drag.historyPushed = true;
      }
      const [ls, lh] = toLocal(sx, sy);
      const nd = nodes[drag.idx];
      if (slideAlongCurve) {
        const proj = projectOntoArchSlideRail(drag.slideRail, ls, lh);
        applyArchNodeSlideAtArcS(
          nodes,
          drag.origNodes,
          drag.idx,
          drag.slideRail,
          proj.arcS,
          isInner,
          mirrorEdit && drag.mirrorRail
            ? { idx: drag.mirrorIdx, rail: drag.mirrorRail }
            : undefined,
        );
        const ndRef = nodes[drag.idx];
        sanitizeArchNodesInPlace(nodes, isInner);
        const newIdx = ndRef ? nodes.indexOf(ndRef) : -1;
        setSelectedIdx(drag.target, newIdx >= 0 ? newIdx : drag.idx);
        drawCanvas();
        opts.afterMutate({ live: true });
        return;
      }
      if (nd) {
        const minS = isInner ? 0.02 : 0;
        const maxS = isInner ? 0.98 : 1;
        const maxH = isInner ? 0.97 : 1;
        const isFirst = drag.idx === 0;
        const isLast = drag.idx === nodes.length - 1;
        const mRef = drag.mirrorIdx >= 0 && drag.mirrorIdx < nodes.length ? nodes[drag.mirrorIdx] : null;
        if (isFirst) {
          nd.s = Math.round(clamp(ls, minS, 0.46) * 1000) / 1000;
          nd.h = 0;
          if (drag.mirrorIdx === nodes.length - 1) {
            nodes[nodes.length - 1].s = Math.round((1 - nd.s) * 1000) / 1000;
            nodes[nodes.length - 1].h = 0;
          }
        } else if (isLast) {
          nd.s = Math.round(clamp(ls, 0.54, maxS) * 1000) / 1000;
          nd.h = 0;
          if (drag.mirrorIdx === 0) {
            nodes[0].s = Math.round((1 - nd.s) * 1000) / 1000;
            nodes[0].h = 0;
          }
        } else {
          let clampedS = clamp(ls, minS, maxS);
          if (drag.origSide === -1) clampedS = Math.min(clampedS, 0.48);
          else if (drag.origSide === 1) clampedS = Math.max(clampedS, 0.52);
          nd.s = Math.round(clampedS * 1000) / 1000;
          nd.h = Math.round(clamp(lh, 0.02, maxH) * 1000) / 1000;
          if (drag.mirrorIdx > 0 && drag.mirrorIdx < nodes.length - 1 && nodes[drag.mirrorIdx]) {
            nodes[drag.mirrorIdx].s = Math.round((1 - nd.s) * 1000) / 1000;
            nodes[drag.mirrorIdx].h = nd.h;
          }
        }
        sanitizeArchNodesInPlace(nodes, isInner);
        const newIdx = nodes.indexOf(nd);
        if (newIdx >= 0) {
          drag.idx = newIdx;
          setSelectedIdx(drag.target, newIdx);
        }
        if (mRef) {
          drag.mirrorIdx = nodes.indexOf(mRef);
        }
      }
      drawCanvas();
      opts.afterMutate({ live: true });
      return;
    }

    if (drag.kind === 'handle') {
      const nodes = getNodesForTarget(drag.target);
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate(drag.target === 'inner' ? '调整拱形内圈手柄' : '调整拱形外圈手柄');
        drag.historyPushed = true;
      }
      const nd = nodes[drag.idx];
      if (nd) {
        const [ls, lh] = toLocal(sx, sy);
        const ds = Math.round(clamp(ls - nd.s, -0.8, 0.8) * 1000) / 1000;
        const dh = Math.round(clamp(lh - nd.h, -0.8, 0.8) * 1000) / 1000;
        if (drag.side === 'in') {
          nd.inDs = ds;
          nd.inDh = dh;
          if (mirrorEdit && !e.altKey) {
            if (drag.mirrorIdx >= 0 && nodes[drag.mirrorIdx]?.mode === 'bezier') {
              nodes[drag.mirrorIdx].outDs = -ds;
              nodes[drag.mirrorIdx].outDh = dh;
            } else if (drag.mirrorIdx === -1 && Math.abs(nd.s - 0.5) < 0.04) {
              nd.outDs = -ds;
              nd.outDh = dh;
            }
          }
        } else {
          nd.outDs = ds;
          nd.outDh = dh;
          if (mirrorEdit && !e.altKey) {
            if (drag.mirrorIdx >= 0 && nodes[drag.mirrorIdx]?.mode === 'bezier') {
              nodes[drag.mirrorIdx].inDs = -ds;
              nodes[drag.mirrorIdx].inDh = dh;
            } else if (drag.mirrorIdx === -1 && Math.abs(nd.s - 0.5) < 0.04) {
              nd.inDs = -ds;
              nd.inDh = dh;
            }
          }
        }
      }
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
      if (pts.length >= 5) {
        const isInner = target === 'inner';
        opts.beforeMutate(isInner ? '手绘拟合拱形内圈' : '手绘拟合拱形外圈');
        const { nodes: fitted, usedFallback } = fitFreehandArchNodesWithMeta(pts, 9, isInner);
        if (isInner) {
          shape.archInnerNodes = fitted;
          shape.archInnerMode = 'custom';
          selectedInnerIdx = Math.min(1, fitted.length - 1);
        } else {
          shape.archNodes = fitted;
          selectedOuterIdx = Math.min(1, fitted.length - 1);
        }
        drawMode = 'nodes';
        opts.afterMutate({ live: false });
        if (usedFallback) {
          toast('笔画端点跨度太窄或点数不足，已按基础拱形拟合，可继续调整节点');
        } else {
          toast(`✨ 已拟合 ${fitted.length} 个${isInner ? '内圈' : '外圈'}控制点`);
        }
      }
      drawCanvas();
      onSyncExternal();
      return;
    }

    const pushed = drag.historyPushed;
    drag = { kind: 'none' };
    if (pushed) {
      opts.afterMutate({ live: false });
      onSyncExternal();
    }
  };

  canvas.onpointerup = finishPointer;
  canvas.onpointercancel = finishPointer;
  canvas.onlostpointercapture = finishPointer;

  const deleteSelectedNode = () => {
    const t = getActiveTarget();
    const isInner = t === 'inner';
    const nodes = getNodesForTarget(t);
    const selIdx = getSelectedIdx(t);
    if (selIdx === 0 || selIdx === nodes.length - 1) {
      toast('左右拱脚端点固定在底面，可水平拖动调节跨度');
      return;
    }
    if (nodes.length <= 2) {
      toast('拱形曲线至少保留左右 2 个端点');
      return;
    }
    opts.beforeMutate(isInner ? '删除内圈控制点' : '删除外圈控制点');
    const mirrorIdx = mirrorEdit ? findMirrorPartnerIdx(nodes, selIdx) : -1;
    if (mirrorIdx > 0 && mirrorIdx < nodes.length - 1 && mirrorIdx !== selIdx && nodes.length >= 4) {
      const hi = Math.max(selIdx, mirrorIdx);
      const lo = Math.min(selIdx, mirrorIdx);
      nodes.splice(hi, 1);
      nodes.splice(lo, 1);
    } else {
      nodes.splice(selIdx, 1);
    }
    sanitizeArchNodesInPlace(nodes, isInner);
    setSelectedIdx(t, Math.max(0, Math.min(selIdx, nodes.length - 1)));
    opts.afterMutate({ live: false });
    drawCanvas();
    onSyncExternal();
  };

  const insertMidpointNode = () => {
    if (shape.archHollow && editTarget === 'inner' && shape.archInnerMode !== 'custom') {
      unlockInnerToCustom('解锁内圈并插入控制点');
    }
    const t = getActiveTarget();
    const isInner = t === 'inner';
    const nodes = getNodesForTarget(t);
    const selIdx = getSelectedIdx(t);
    const segIdx = selIdx < nodes.length - 1 ? selIdx : Math.max(0, nodes.length - 2);
    const segs = evaluateArchBezierSegments(nodes, isInner);
    const seg = segs[segIdx];
    if (!seg) return;
    const ms = 0.125 * seg.p0[0] + 0.375 * seg.c1[0] + 0.375 * seg.c2[0] + 0.125 * seg.p1[0];
    const mh = 0.125 * seg.p0[1] + 0.375 * seg.c1[1] + 0.375 * seg.c2[1] + 0.125 * seg.p1[1];
    opts.beforeMutate(isInner ? '新增内圈控制点' : '新增外圈控制点');
    nodes.splice(segIdx + 1, 0, {
      s: Math.round(clamp(ms, 0.02, 0.98) * 1000) / 1000,
      h: Math.round(clamp(mh, 0.02, isInner ? 0.96 : 1) * 1000) / 1000,
      mode: 'smooth',
    });
    sanitizeArchNodesInPlace(nodes, isInner);
    setSelectedIdx(t, segIdx + 1);
    opts.afterMutate({ live: false });
    drawCanvas();
    onSyncExternal();
  };

  canvas.ondblclick = (e) => {
    if (drawMode !== 'nodes') return;
    const [sx, sy] = getPointerPos(e);
    // Double-clicking near a linked inner curve unlocks it into editable inner control points!
    if (shape.archHollow && (shape.archInnerMode ?? 'parallel') !== 'custom') {
      const autoInner = computeCurrentAutoInnerCurve(shape);
      for (let i = 0; i < autoInner.length - 1; i++) {
        const [ax, ay] = toCanvas(autoInner[i][0], autoInner[i][1]);
        const [bx, by] = toCanvas(autoInner[i + 1][0], autoInner[i + 1][1]);
        if (distPointToSeg(sx, sy, ax, ay, bx, by) <= 12) {
          unlockInnerToCustom('解锁内圈自由控制点编辑');
          toast('🔓 已解锁内圈控制点，可独立拖动或点上方关系预设恢复平行/等厚');
          drawCanvas();
          onSyncExternal();
          return;
        }
      }
    }

    if (Date.now() - lastInsertedAt < 360) return;

    const activeTarget = getActiveTarget();
    const nodes = getNodesForTarget(activeTarget);
    const selIdx = getSelectedIdx(activeTarget);
    const sel = nodes[selIdx];
    if (sel && sel.mode === 'bezier') {
      if (selIdx > 0) {
        const [ix, iy] = toCanvas(sel.s + (sel.inDs ?? 0), sel.h + (sel.inDh ?? 0));
        if (Math.hypot(sx - ix, sy - iy) <= 12) return;
      }
      if (selIdx < nodes.length - 1) {
        const [ox, oy] = toCanvas(sel.s + (sel.outDs ?? 0), sel.h + (sel.outDh ?? 0));
        if (Math.hypot(sx - ox, sy - oy) <= 12) return;
      }
    }

    let hitIdx = -1;
    let bestD = 14;
    for (let i = 0; i < nodes.length; i++) {
      const [nx, ny] = toCanvas(nodes[i].s, nodes[i].h);
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

  const applyNudgeAlongRailTarget = (
    target: ArchEditTarget,
    nodes: ArchNode[],
    selIdx: number,
    targetArcS: number,
    pushHistory: boolean,
    label: string,
  ): boolean => {
    const nd = nodes[selIdx];
    if (!nd) return false;
    const isInner = target === 'inner';
    const origNodes = nodes.map(cloneArchNode);
    const rail = buildArchNodeSlideRail(origNodes, selIdx, isInner);
    const mIdx = mirrorEdit ? findMirrorPartnerIdx(origNodes, selIdx) : -1;
    const mRail = mIdx >= 0 && mIdx !== selIdx ? buildArchNodeSlideRail(origNodes, mIdx, isInner) : undefined;
    const testNodes = origNodes.map(cloneArchNode);
    const testRes = applyArchNodeSlideAtArcS(
      testNodes,
      origNodes,
      selIdx,
      rail,
      targetArcS,
      isInner,
      mRail ? { idx: mIdx, rail: mRail } : undefined,
    );
    if (Math.hypot(testRes.s - nd.s, testRes.h - nd.h) < 1e-6) return false;
    if (pushHistory) {
      opts.beforeMutate(label);
    }
    applyArchNodeSlideAtArcS(
      nodes,
      origNodes,
      selIdx,
      rail,
      targetArcS,
      isInner,
      mRail ? { idx: mIdx, rail: mRail } : undefined,
    );
    const ndRef = nodes[selIdx];
    sanitizeArchNodesInPlace(nodes, isInner);
    const nextIdx = ndRef ? nodes.indexOf(ndRef) : -1;
    setSelectedIdx(target, nextIdx >= 0 ? nextIdx : Math.min(selIdx, nodes.length - 1));
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const nudgeAlongRail = (dirSign: -1 | 1, stepOverride?: number, pushHistory = true): boolean => {
    const t = getActiveTarget();
    const isInner = t === 'inner';
    const nodes = getNodesForTarget(t);
    const selIdx = getSelectedIdx(t);
    const nd = nodes[selIdx];
    if (!nd) return false;
    const step = stepOverride ?? nudgeStep;
    return applyNudgeAlongRailTarget(
      t,
      nodes,
      selIdx,
      dirSign * step,
      pushHistory,
      isInner ? '沿轨迹微调拱形内圈控制点' : '沿轨迹微调拱形外圈控制点',
    );
  };

  const applyNudgeScreen = (dxScreen: number, dyScreen: number, stepOverride?: number, pushHistory = true): boolean => {
    const t = getActiveTarget();
    const isInner = t === 'inner';
    const nodes = getNodesForTarget(t);
    const selIdx = getSelectedIdx(t);
    const nd = nodes[selIdx];
    if (!nd) return false;
    const step = stepOverride ?? nudgeStep;
    const ds = dxScreen * step;
    const dh = -dyScreen * step;
    if (slideAlongCurve) {
      const rail = buildArchNodeSlideRail(nodes.map(cloneArchNode), selIdx, isInner);
      const proj = projectOntoArchSlideRail(rail, nd.s + ds, nd.h + dh);
      return applyNudgeAlongRailTarget(
        t,
        nodes,
        selIdx,
        proj.arcS,
        pushHistory,
        isInner ? '沿轨迹微调拱形内圈控制点' : '沿轨迹微调拱形外圈控制点',
      );
    }

    const minS = isInner ? 0.02 : 0;
    const maxS = isInner ? 0.98 : 1;
    const maxH = isInner ? 0.97 : 1;
    const isFirst = selIdx === 0;
    const isLast = selIdx === nodes.length - 1;
    const mIdx = mirrorEdit ? findMirrorPartnerIdx(nodes, selIdx) : -1;
    const origSide: -1 | 0 | 1 =
      mIdx >= 0 ? (nd.s < 0.48 ? -1 : nd.s > 0.52 ? 1 : 0) : 0;

    let nextS = nd.s;
    let nextH = nd.h;
    if (isFirst) {
      if (ds === 0 && dh !== 0) {
        if (pushHistory) toast('拱脚端点固定在底面基准线 (H=0)，请用 ← / → 微调跨度位置');
        return false;
      }
      nextS = Math.round(clamp(nd.s + ds, minS, 0.46) * 10000) / 10000;
      nextH = 0;
    } else if (isLast) {
      if (ds === 0 && dh !== 0) {
        if (pushHistory) toast('拱脚端点固定在底面基准线 (H=0)，请用 ← / → 微调跨度位置');
        return false;
      }
      const minLastS = Math.max((nodes[0]?.s ?? 0) + (isInner ? 0.08 : 0.12), 0.54);
      nextS = Math.round(clamp(nd.s + ds, minLastS, maxS) * 10000) / 10000;
      nextH = 0;
    } else {
      let clampedS = clamp(nd.s + ds, minS, maxS);
      if (origSide === -1) clampedS = Math.min(clampedS, 0.48);
      else if (origSide === 1) clampedS = Math.max(clampedS, 0.52);
      nextS = Math.round(clampedS * 10000) / 10000;
      nextH = Math.round(clamp(nd.h + dh, 0.02, maxH) * 10000) / 10000;
    }

    if (nextS === nd.s && nextH === nd.h) return false;
    if (pushHistory) {
      opts.beforeMutate(isInner ? '微调拱形内圈控制点' : '微调拱形外圈控制点');
    }
    nd.s = nextS;
    nd.h = nextH;
    if (mIdx >= 0 && mIdx !== selIdx && nodes[mIdx]) {
      if ((isFirst && mIdx === nodes.length - 1) || (isLast && mIdx === 0)) {
        nodes[mIdx].s = Math.round((1 - nd.s) * 10000) / 10000;
        nodes[mIdx].h = 0;
      } else if (!isFirst && !isLast && mIdx > 0 && mIdx < nodes.length - 1) {
        nodes[mIdx].s = Math.round((1 - nd.s) * 10000) / 10000;
        nodes[mIdx].h = nd.h;
      }
    }
    sanitizeArchNodesInPlace(nodes, isInner);
    const newIdx = nodes.indexOf(nd);
    setSelectedIdx(t, newIdx >= 0 ? newIdx : Math.min(selIdx, nodes.length - 1));
    drawCanvas();
    onSyncExternal();
    return true;
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
    get drawMode() { return drawMode; },
    setDrawMode(m: 'nodes' | 'freehand') {
      drawMode = m;
      drawCanvas();
      onSyncExternal();
    },
    get editTarget(): ArchEditTarget { return getActiveTarget(); },
    setEditTarget(t: ArchEditTarget) {
      if (t === 'inner') {
        if (!shape.archHollow) return;
        if ((shape.archInnerMode ?? 'parallel') !== 'custom') {
          unlockInnerToCustom('切换至内圈自由控制点编辑');
          toast('🔵 已切换至内圈控制点编辑（点上方「平行等厚」等可随时恢复自动跟随）');
        } else {
          ensureInnerNodes(shape);
          editTarget = 'inner';
        }
      } else {
        editTarget = 'outer';
      }
      drawCanvas();
      onSyncExternal();
    },
    setEditTargetSilent(t: ArchEditTarget) {
      editTarget = t;
      drawCanvas();
    },
    syncInnerNodesFromOuter(mode: 'parallel' | 'proportional') {
      if (!shape.archHollow) return;
      opts.beforeMutate(mode === 'parallel' ? '按外圈平行生成内圈控制点' : '按外圈等比生成内圈控制点');
      const sampled = computeCurrentAutoInnerCurve(shape, mode);
      shape.archInnerNodes = fitEditableNodesFromInnerCurve(sampled);
      shape.archInnerMode = 'custom';
      editTarget = 'inner';
      selectedInnerIdx = Math.min(1, shape.archInnerNodes.length - 1);
      opts.afterMutate({ live: false });
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
    get nudgeStep() { return nudgeStep; },
    setNudgeStep(v: number) {
      nudgeStep = v;
      onSyncExternal();
    },
    get selectedNodeIdx() { return getSelectedIdx(getActiveTarget()); },
    setSelectedNodeIdx(i: number) {
      setSelectedIdx(getActiveTarget(), i);
      drawCanvas();
      onSyncExternal();
    },
    nudgeSelectedByScreen: applyNudgeScreen,
    nudgeAlongRail,
    setSelectedNodeMode(mode: ArchNodeMode) {
      const t = getActiveTarget();
      const isInner = t === 'inner';
      const nodes = getNodesForTarget(t);
      const selIdx = getSelectedIdx(t);
      const nd = nodes[selIdx];
      if (!nd) return;
      const mIdx = mirrorEdit ? findMirrorPartnerIdx(nodes, selIdx) : -1;
      const mNd = mIdx >= 0 && mIdx !== selIdx ? nodes[mIdx] : undefined;
      if (nd.mode === mode && (!mNd || mNd.mode === mode)) return;
      opts.beforeMutate(isInner ? '切换内圈节点类型' : '切换外圈节点类型');
      const applyMode = (idx: number) => {
        const target = nodes[idx];
        if (!target) return;
        if (mode === 'bezier' && target.mode !== 'bezier') {
          const sm = computeArchSmoothHandles(nodes, idx);
          target.inDs = sm.inDs;
          target.inDh = sm.inDh;
          target.outDs = sm.outDs;
          target.outDh = sm.outDh;
        }
        target.mode = mode;
      };
      if (nd.mode !== mode) applyMode(selIdx);
      if (mNd && mNd.mode !== mode) {
        if (mode === 'bezier' && nd.mode === 'bezier') {
          mNd.inDs = -(nd.outDs ?? 0);
          mNd.inDh = nd.outDh ?? 0;
          mNd.outDs = -(nd.inDs ?? 0);
          mNd.outDh = nd.inDh ?? 0;
          mNd.mode = 'bezier';
        } else {
          applyMode(mIdx);
        }
      }
      opts.afterMutate({ live: false });
      drawCanvas();
      onSyncExternal();
    },
    insertMidpointNode,
    deleteSelectedNode,
    getState(): ArchEditorInitState {
      return {
        drawMode,
        mirrorEdit,
        slideAlongCurve,
        nudgeStep,
        editTarget: getActiveTarget(),
        selectedOuterIdx,
        selectedInnerIdx,
      };
    },
  };
}

function createArchToolbarAndPresets(
  ctrl: ReturnType<typeof createArchCanvasController>,
  shape: ParametricShape,
  opts: ArchMutateOpts,
  onAfterChange: () => void,
) {
  // Hollow-only target bar (🟢 编辑外圈 vs 🔵 编辑内圈 + quick sync actions), with persistent DOM buttons
  const outerTargetBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setEditTarget('outer'),
  }, '🟢 编辑外圈') as HTMLButtonElement;
  const innerTargetBtn = h('button', {
    class: 'btn small',
    title: '切换为独立编辑内圈控制点与预设',
    onclick: () => ctrl.setEditTarget('inner'),
  }, '🔵 编辑内圈') as HTMLButtonElement;
  const syncParBtn = h('button', {
    class: 'btn small',
    title: '按当前外圈平行偏移重新生成可编辑的内圈控制点',
    onclick: () => ctrl.syncInnerNodesFromOuter('parallel'),
  }, '🔄 平行外圈') as HTMLButtonElement;
  const syncPropBtn = h('button', {
    class: 'btn small',
    title: '按当前外圈等比缩放重新生成可编辑的内圈控制点',
    onclick: () => ctrl.syncInnerNodesFromOuter('proportional'),
  }, '📐 等比外圈') as HTMLButtonElement;
  const targetBarWrap = h('div', { class: 'loft-mode-bar' }, outerTargetBtn, innerTargetBtn, syncParBtn, syncPropBtn);

  const modeNodesBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setDrawMode('nodes'),
  }, '✒️ 节点曲线');
  const modeFreeBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setDrawMode('freehand'),
  }, '✏️ 手绘拟合');
  const mirrorBtn = h('button', {
    class: 'btn small',
    title: '开启后编辑一侧控制点或手柄将自动左右对称同步（按住 Alt 拖手柄可单独调尖角）',
    onclick: () => ctrl.setMirrorEdit(!ctrl.mirrorEdit),
  }, '↔ 左右对称');

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
    title: '开启后拖拽控制点会贴合当前拱形轨迹滑动（支持沿直边顺滑缩放圆角与过渡段）',
    onclick: () => ctrl.setSlideAlongCurve(!ctrl.slideAlongCurve),
  }, '🛤️ 沿当前轨迹移动') as HTMLButtonElement;
  const addNodeBtn = h('button', {
    class: 'btn small',
    title: '在当前控制点旁插入新节点（也可直接点击曲线任意位置插点）',
    onclick: () => ctrl.insertMidpointNode(),
  }, '+ 插点') as HTMLButtonElement;
  const delNodeBtn = h('button', {
    class: 'btn small danger',
    title: '删除当前选中控制点（也可双击节点删除）',
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
    addNodeBtn,
    delNodeBtn,
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

  const nudgeStepSel = select(
    NUDGE_STEP_OPTIONS.map((o) => ({ id: String(o.value), label: o.label })),
    String(ctrl.nudgeStep),
    (v) => ctrl.setNudgeStep(Number(v) || 0.01),
  );
  nudgeStepSel.title = '微调步距';

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

  const presetLabelEl = h('div', { class: 'hint' });

  const syncToolbar = () => {
    const isHollow = Boolean(shape.archHollow);
    const activeTarget = ctrl.editTarget;
    const isEditingInner = isHollow && activeTarget === 'inner' && (shape.archInnerMode ?? 'parallel') === 'custom';

    // 1. Hollow-only curve target switcher
    targetBarWrap.style.display = isHollow ? 'flex' : 'none';
    if (isHollow) {
      outerTargetBtn.classList.toggle('primary', !isEditingInner);
      innerTargetBtn.classList.toggle('primary', isEditingInner);
      syncParBtn.style.display = isEditingInner ? '' : 'none';
      syncPropBtn.style.display = isEditingInner ? '' : 'none';
    }

    // 2. Mode buttons
    modeNodesBtn.classList.toggle('primary', ctrl.drawMode === 'nodes');
    modeFreeBtn.classList.toggle('primary', ctrl.drawMode === 'freehand');
    mirrorBtn.classList.toggle('primary', ctrl.mirrorEdit);
    nudgeStepSel.value = String(ctrl.nudgeStep);

    // 3. Node inspector bar (toggle visibility & classes without rebuilding DOM)
    const isFree = ctrl.drawMode === 'freehand';
    freeHintEl.style.display = isFree ? '' : 'none';
    modeLabelEl.style.display = isFree ? 'none' : '';
    smoothBtn.style.display = isFree ? 'none' : '';
    cornerBtn.style.display = isFree ? 'none' : '';
    bezierBtn.style.display = isFree ? 'none' : '';
    slideBtn.style.display = isFree ? 'none' : '';
    slideBtn.classList.toggle('primary', ctrl.slideAlongCurve);
    addNodeBtn.style.display = isFree ? 'none' : '';
    delNodeBtn.style.display = isFree ? 'none' : '';
    fineTuneBar.style.display = isFree ? 'none' : 'flex';
    railNudgeWrap.style.display = !isFree && ctrl.slideAlongCurve ? 'inline-flex' : 'none';

    if (isFree) {
      freeHintEl.textContent = `从左向右一笔画出${isEditingInner ? '🔵 内圈' : '🟢 外圈'}弧线，松手自动拟合控制点`;
    } else {
      const nodes = isEditingInner ? ensureInnerNodes(shape) : ensureOuterNodes(shape);
      const selIdx = ctrl.selectedNodeIdx;
      const nd = nodes[selIdx];
      const isEnd = selIdx === 0 || selIdx === nodes.length - 1;
      const prefix = isEditingInner ? '内圈' : '外圈';
      modeLabelEl.textContent = `${prefix} #${selIdx + 1}/${nodes.length}${isEnd ? '(脚)' : ''}:`;
      coordBadge.textContent = nd
        ? `${prefix}#${selIdx + 1}${isEnd ? '(脚)' : ''} (${nd.s.toFixed(3)}, ${nd.h.toFixed(3)})`
        : '未选节点';
      smoothBtn.classList.toggle('primary', nd?.mode === 'smooth');
      cornerBtn.classList.toggle('primary', nd?.mode === 'corner');
      bezierBtn.classList.toggle('primary', nd?.mode === 'bezier');
    }

    // 4. Preset caption
    presetLabelEl.textContent = isEditingInner
      ? '🔵 内圈形状预设（点击直接套用到内圈券洞，不影响外圈）：'
      : isHollow && (shape.archInnerMode ?? 'parallel') !== 'custom'
        ? '🟢 外圈形状预设（内圈将按上方关系预设自动保持平行/等厚；也可直接拖蓝色◆调壁厚）：'
        : '点击弧线任意处添加控制点 · 双击节点删除 · 形状预设：';
  };

  const presetWrap = h(
    'div',
    { class: 'loft-preset-grid' },
    ...ARCH_PRESETS.map((p) =>
      h('button', {
        class: 'btn small',
        onclick: () => {
          const isEditingInner =
            Boolean(shape.archHollow) &&
            ctrl.editTarget === 'inner' &&
            (shape.archInnerMode ?? 'parallel') === 'custom';
          if (isEditingInner) {
            opts.beforeMutate(`套用拱形内圈预设：${p.label}`);
            const { spanMetric, heightMetric } = getShapeArchMetrics(shape);
            shape.archInnerNodes = createScaledInnerPresetNodes(
              p.id,
              shape.archThickness ?? 0.28,
              spanMetric,
              heightMetric,
            );
            ctrl.setSelectedNodeIdx(Math.min(1, shape.archInnerNodes.length - 1));
          } else {
            opts.beforeMutate(`套用拱形预设：${p.label}`);
            shape.archNodes = createArchPresetNodes(p.id);
            ctrl.setSelectedNodeIdx(Math.min(1, shape.archNodes.length - 1));
          }
          opts.afterMutate({ live: false });
          ctrl.drawCanvas();
          onAfterChange();
        },
      }, p.label),
    ),
  );

  syncToolbar();

  return {
    targetBar: targetBarWrap,
    topBar: h('div', { class: 'loft-mode-bar' }, modeNodesBtn, modeFreeBtn, mirrorBtn),
    nodeBar: nodeModeWrap,
    fineTuneBar,
    presetLabelEl,
    presetWrap,
    syncToolbar,
  };
}

/**
 * Builds the Hollow-Only inner curve mode presets + thickness slider block.
 */
function buildHollowInnerControlsBlock(
  shape: ParametricShape,
  ctrl: ReturnType<typeof createArchCanvasController>,
  opts: ArchMutateOpts,
  onModeOrHollowChanged: () => void,
): { el: HTMLElement; syncValues: () => void } {
  const wrap = h('div', { class: 'loft-sec-props' });
  let syncThicknessRow: ((v: number) => void) | null = null;
  let modeBtns: { id: ArchInnerMode; btn: HTMLButtonElement }[] = [];

  const render = () => {
    wrap.innerHTML = '';
    syncThicknessRow = null;
    modeBtns = [];
    if (!shape.archHollow) return;

    const curMode: ArchInnerMode = shape.archInnerMode ?? 'parallel';
    const modePresetGrid = h('div', { class: 'loft-preset-grid' });
    const descEl = h(
      'div',
      { class: 'hint', style: 'margin-top:-2px' },
      ARCH_INNER_MODES.find((m) => m.id === curMode)?.desc ?? '',
    );

    for (const m of ARCH_INNER_MODES) {
      const b = h(
        'button',
        {
          class: `btn small${curMode === m.id ? ' primary' : ''}`,
          title: m.desc,
          onclick: () => {
            if ((shape.archInnerMode ?? 'parallel') === m.id) {
              if (m.id === 'custom') ctrl.setEditTarget('inner');
              return;
            }
            opts.beforeMutate(`切换内圈模式：${m.short}`);
            if (m.id === 'custom') {
              if (!shape.archInnerNodes || shape.archInnerNodes.length < 2) {
                const autoInner = computeCurrentAutoInnerCurve(shape);
                shape.archInnerNodes = fitEditableNodesFromInnerCurve(autoInner);
              } else {
                sanitizeArchNodesInPlace(shape.archInnerNodes, true);
              }
              shape.archInnerMode = 'custom';
              ctrl.setEditTargetSilent('inner');
            } else {
              shape.archInnerMode = m.id;
              ctrl.setEditTargetSilent('outer');
            }
            opts.afterMutate({ needsResort: true, live: false });
            render();
            onModeOrHollowChanged();
          },
        },
        m.short,
      ) as HTMLButtonElement;
      modeBtns.push({ id: m.id, btn: b });
      modePresetGrid.append(b);
    }

    wrap.append(
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '镂空样式'),
        select<ArchHollowStyle>(
          [
            { id: 'shell', label: '空心半圆筒壳体 (独立拱圈)' },
            { id: 'portal', label: '方体城门 / 桥洞 (平顶券门)' },
          ],
          shape.archHollowStyle ?? 'shell',
          (st) => {
            opts.beforeMutate('切换拱形镂空样式');
            shape.archHollowStyle = st;
            opts.afterMutate({ needsResort: true, live: false });
            onModeOrHollowChanged();
          },
        ),
      ),
      h('div', { class: 'hint' }, '内圈曲线联动预设（仅镂空开启时生效）：'),
      modePresetGrid,
      descEl,
    );

    if (curMode !== 'custom') {
      const rRow = rangeRow(
        '拱壁厚度',
        0.06,
        0.78,
        shape.archThickness ?? 0.28,
        (v) => {
          shape.archThickness = Math.round(v * 100) / 100;
          ctrl.drawCanvas();
          opts.afterMutate({ live: true });
        },
        0.02,
        {
          onBegin: () => opts.beforeMutate('调整拱壁厚度'),
          onCommit: () => opts.afterMutate({ live: false }),
        },
      );
      syncThicknessRow = (v: number) => rRow.set(v);
      wrap.append(rRow.row);
    }
  };

  render();

  return {
    el: wrap,
    syncValues: () => {
      const curMode: ArchInnerMode = shape.archInnerMode ?? 'parallel';
      const anyModeMismatch =
        (Boolean(shape.archHollow) && modeBtns.length === 0) ||
        (!shape.archHollow && modeBtns.length > 0) ||
        (curMode === 'custom' && syncThicknessRow !== null) ||
        (curMode !== 'custom' && Boolean(shape.archHollow) && syncThicknessRow === null);
      if (anyModeMismatch) {
        render();
        return;
      }
      for (const mb of modeBtns) {
        mb.btn.classList.toggle('primary', mb.id === curMode);
      }
      if (syncThicknessRow) {
        syncThicknessRow(shape.archThickness ?? 0.28);
      }
    },
  };
}

export function openArchCurveModal(
  shape: ParametricShape,
  app: App,
  opts: ArchMutateOpts,
  initState?: ArchEditorInitState,
) {
  let close = () => {};
  const binding = createModalLiveBinding(app, shape, opts.targetLayerId, opts);
  const liveOpts: ArchMutateOpts = {
    targetLayerId: opts.targetLayerId,
    beforeMutate: binding.beforeMutate,
    afterMutate: binding.afterMutate,
  };

  const infoTitle = h('div', { class: 'hint', style: 'margin-bottom:4px' });
  const contentHost = h('div', {
    style: 'display:flex;flex-direction:column;gap:8px;align-items:center;width:100%',
  });

  let boundShape: ParametricShape | null = null;
  let ctrl: ReturnType<typeof createArchCanvasController> | null = null;
  let ui: ReturnType<typeof createArchToolbarAndPresets> | null = null;
  let hollowBlock: ReturnType<typeof buildHollowInnerControlsBlock> | null = null;
  let renderTopToggle = () => {};
  let refreshBound = () => {};
  let historyBarObj: ReturnType<typeof buildModalUndoRedoBar>;

  const mountForShape = (targetShape: ParametricShape, state?: ArchEditorInitState) => {
    boundShape = targetShape;
    contentHost.innerHTML = '';

    const c = createArchCanvasController(360, 252, targetShape, liveOpts, () => refreshAll(), state);
    const u = createArchToolbarAndPresets(c, targetShape, liveOpts, () => refreshAll());
    const hb = buildHollowInnerControlsBlock(targetShape, c, liveOpts, () => refreshAll());
    ctrl = c;
    ui = u;
    hollowBlock = hb;

    const hollowToggleWrap = h('div', { style: 'width:100%' });
    renderTopToggle = () => {
      hollowToggleWrap.innerHTML = '';
      hollowToggleWrap.append(
        toggle('中间镂空（空心拱券 / 桥洞）', Boolean(targetShape.archHollow), (checked) => {
          liveOpts.beforeMutate(checked ? '开启拱形镂空' : '关闭拱形镂空');
          targetShape.archHollow = checked;
          if (!targetShape.archInnerMode) targetShape.archInnerMode = 'parallel';
          if (targetShape.archThickness === undefined) targetShape.archThickness = 0.28;
          if (!checked) c.setEditTargetSilent('outer');
          liveOpts.afterMutate({ needsResort: true, live: false });
          hb.syncValues();
          refreshAll();
        }),
      );
    };

    refreshBound = () => {
      const outerNodes = ensureOuterNodes(targetShape);
      const { spanCells } = getShapeArchMetrics(targetShape);
      const innerCount =
        targetShape.archHollow && (targetShape.archInnerMode ?? 'parallel') === 'custom'
          ? ` · 内圈点 ${ensureInnerNodes(targetShape).length} 个`
          : '';
      infoTitle.textContent = `跨度 ${spanCells}格 (${cellsToMeters(spanCells).toFixed(1)}m) · 拱高 ${targetShape.heightPx}px (${zPxToMeters(targetShape.heightPx).toFixed(2)}m) · 外圈点 ${outerNodes.length} 个${innerCount}`;
      hb.syncValues();
      u.syncToolbar();
      c.drawCanvas();
    };

    renderTopToggle();
    refreshBound();
    contentHost.append(
      hollowToggleWrap,
      h('div', { style: 'width:100%' }, hb.el),
      u.targetBar,
      u.topBar,
      u.nodeBar,
      h('div', { class: 'loft-curve-wrap large' }, c.canvas),
      u.fineTuneBar,
      u.presetLabelEl,
      u.presetWrap,
    );
  };

  const refreshAll = () => {
    const live = binding.getShape();
    if (!live) {
      close();
      return;
    }
    if (live !== boundShape) {
      mountForShape(live, ctrl ? ctrl.getState() : initState);
    } else {
      renderTopToggle();
      refreshBound();
    }
    historyBarObj?.sync();
  };

  historyBarObj = buildModalUndoRedoBar(binding, () => refreshAll(), [], {
    nudgeScreen: (dx, dy, shiftBoost, pushHistory) =>
      Boolean(
        ctrl &&
          ctrl.drawMode === 'nodes' &&
          ctrl.nudgeSelectedByScreen(dx, dy, ctrl.nudgeStep * (shiftBoost ? 4 : 1), pushHistory),
      ),
    nudgeAux: (dir, shiftBoost, pushHistory) =>
      Boolean(
        ctrl &&
          ctrl.drawMode === 'nodes' &&
          ctrl.slideAlongCurve &&
          ctrl.nudgeAlongRail(dir, ctrl.nudgeStep * (shiftBoost ? 4 : 1), pushHistory),
      ),
    commitNudge: () => liveOpts.afterMutate({ live: false }),
  });
  mountForShape(binding.getShape() ?? shape, initState);
  historyBarObj.sync();

  const onExternalDoc = (what: string) => {
    if (!contentHost.isConnected) {
      unsubDoc();
      return;
    }
    if (what === 'doc' || what === 'layers' || what === 'history') {
      refreshAll();
    }
  };
  const unsubDoc = app.on(onExternalDoc);

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:8px;align-items:center' },
    historyBarObj.bar,
    infoTitle,
    contentHost,
  );

  let closed = false;
  close = openSheet('🌈 精细编辑拱形外圈 / 内圈曲线与镂空预设', body, {
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
      }, '完成'),
    ],
  });
}

export function buildArchInspectorSection(
  shape: ParametricShape,
  app: App,
  opts: ArchMutateOpts,
): HTMLElement {
  ensureOuterNodes(shape);
  const root = h('div', { class: 'prop-block loft-editor-box' });

  let refreshMini = () => {};
  const ctrl = createArchCanvasController(236, 172, shape, opts, () => refreshMini());
  const ui = createArchToolbarAndPresets(ctrl, shape, opts, () => refreshMini());
  const hollowBlock = buildHollowInnerControlsBlock(shape, ctrl, opts, () => refreshMini());

  const hollowToggle = toggle('中间镂空（空心拱券 / 桥洞）', Boolean(shape.archHollow), (checked) => {
    opts.beforeMutate(checked ? '开启拱形镂空' : '关闭拱形镂空');
    shape.archHollow = checked;
    if (shape.archThickness === undefined) shape.archThickness = 0.28;
    if (!shape.archHollowStyle) shape.archHollowStyle = 'shell';
    if (!shape.archInnerMode) shape.archInnerMode = 'parallel';
    if (!checked) ctrl.setEditTargetSilent('outer');
    hollowBlock.syncValues();
    refreshMini();
    opts.afterMutate({ needsResort: true, live: false });
  });

  refreshMini = () => {
    hollowBlock.syncValues();
    ui.syncToolbar();
    ctrl.drawCanvas();
  };
  refreshMini();

  const expandModalBtn = h(
    'button',
    {
      class: 'btn small accent',
      style: 'width:100%;justify-content:center',
      onclick: () => openArchCurveModal(shape, app, opts, ctrl.getState()),
    },
    '🔍 放大精细编辑拱形曲线',
  );

  root.append(
    h('div', { class: 'menu-sec' }, '拱形结构与外/内圈曲线控制'),
    hollowToggle,
    hollowBlock.el,
    ui.targetBar,
    ui.topBar,
    ui.nodeBar,
    h('div', { class: 'loft-curve-wrap' }, ctrl.canvas),
    ui.fineTuneBar,
    ui.presetLabelEl,
    ui.presetWrap,
    expandModalBtn,
  );

  return root;
}
