// Interactive Multi-Section Stack & Control-Edge / Control-Ring Editor for Columns
// Polygonal columns (box / prism / vertical right_tri_prism) simplify points into movable, rotatable, lockable edges.
// Cylinders use simplified section ring offset + radius scaling without per-edge angle/lock controls.
import type { App } from '../app';
import { clamp } from '../core/color';
import { tr } from '../core/i18n';
import {
  applyColumnEdgeEdit,
  applyColumnSectionTransform,
  canColumnSectionBeTransition,
  convertColumnSectionToTransition,
  createDefaultColumnEdges,
  ensureActiveColumnSection,
  ensureColumnSections,
  evaluateColumnSectionEdges,
  evaluateColumnSectionRing,
  getColumnSectionsReadOnly,
  hasActiveColumnSections,
  insertColumnSectionAtT,
  insertColumnTransitionSection,
  isColumnSectionShape,
  isPolygonalColumnShape,
  nextColSectionId,
  normalizeAngleDeg,
  syncColumnTransitionSections,
  type ColumnInterpMode,
  type ColumnSection,
} from '../core/columnSections';
import { normalizeRotation, zPxToMeters } from '../core/isoMath';
import type { ParametricShape } from '../core/isoRenderer';
import { h, openSheet, rangeRow, select, toast } from './dom';
import {
  BASE_ANCHORS,
  NUDGE_STEP_OPTIONS,
  SNAP_STEP_OPTIONS,
  bindSubCanvasNudgeScope,
  buildModalUndoRedoBar,
  createModalLiveBinding,
  makeRepeatableButton,
  snapScalarToStep,
  snapUVToAnchors,
} from './fineEditShared';

export interface ColumnMutateOpts {
  targetLayerId?: number;
  beforeMutate: (label: string) => void;
  afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => void;
}

export interface ColumnEditorInitState {
  isoAlign?: boolean;
  anchorSnap?: boolean;
  snapStep?: number;
  nudgeStep?: number;
  selectedEdgeIdx?: number;
  nudgeTarget?: 'edge' | 'center';
}

function unlockColTransitionOnManualEdit(sec: ColumnSection): void {
  if (!sec.isTransition) return;
  delete sec.isTransition;
  toast('🔓 已手动调整控制边/属性，自动转为独立控制面');
}

function computeTargetTBetweenColSections(shape: ParametricShape): number {
  const secs = ensureColumnSections(shape);
  const cur = ensureActiveColumnSection(shape);
  const sorted = [...secs].sort((a, b) => a.t - b.t);
  const curIdx = cur ? sorted.findIndex((s) => s.id === cur.id) : sorted.length - 1;
  if (curIdx >= 0 && curIdx < sorted.length - 1) {
    return (sorted[curIdx].t + sorted[curIdx + 1].t) * 0.5;
  }
  if (curIdx > 0) {
    return (sorted[curIdx - 1].t + sorted[curIdx].t) * 0.5;
  }
  return 0.5;
}

function insertColTransitionOnShape(shape: ParametricShape, mutOpts: ColumnMutateOpts): ColumnSection | null {
  mutOpts.beforeMutate('新建柱体过渡控制面');
  const targetT = computeTargetTBetweenColSections(shape);
  const created = insertColumnTransitionSection(shape, targetT);
  mutOpts.afterMutate({ live: false, needsResort: true });
  if (created) toast('✨ 已新建柱体过渡控制面（控制边与位置自动跟随上下层过渡）');
  return created;
}

function toggleColTransitionOnShape(shape: ParametricShape, mutOpts: ColumnMutateOpts): boolean {
  const secs = ensureColumnSections(shape);
  const cur = ensureActiveColumnSection(shape);
  if (!cur) return false;
  if (cur.isTransition) {
    mutOpts.beforeMutate('解锁柱体过渡面为普通控制面');
    delete cur.isTransition;
    mutOpts.afterMutate({ live: false, needsResort: true });
    toast('🔓 已解锁为可自由编辑的普通控制面');
    return true;
  }
  if (!canColumnSectionBeTransition(secs, cur.id)) {
    toast('顶层与底层端点控制面无法设为过渡面，请先选中中间层控制面');
    return false;
  }
  mutOpts.beforeMutate('转换为柱体过渡控制面');
  convertColumnSectionToTransition(shape, cur.id);
  mutOpts.afterMutate({ live: false, needsResort: true });
  toast('✨ 已转换为上下控制面的自动过渡形态');
  return true;
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

function distPointToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function createColumnCanvasController(
  sizePx: number,
  shapeOrGetter: ParametricShape | (() => ParametricShape),
  app: App,
  opts: ColumnMutateOpts,
  onSyncExternal: () => void,
  initState?: ColumnEditorInitState,
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
  let anchorSnap = initState?.anchorSnap ?? true;
  let snapStep = initState?.snapStep ?? 0.05;
  let nudgeStep = initState?.nudgeStep ?? 0.01;
  let selectedEdgeIdx = initState?.selectedEdgeIdx ?? 0;
  let nudgeTarget: 'edge' | 'center' =
    initState?.nudgeTarget ?? (isPolygonalColumnShape(getShape()) ? 'edge' : 'center');
  let activeGuideU: number | null = null;
  let activeGuideV: number | null = null;
  let activeAngleGuideDeg: number | null = null;

  type DragState =
    | { kind: 'none' }
    | {
        kind: 'edge_pos';
        edgeIdx: number;
        historyPushed: boolean;
        startX: number;
        startY: number;
      }
    | {
        kind: 'edge_angle';
        edgeIdx: number;
        origMidpoint: [number, number];
        origAngleDeg: number;
        origOffset: number;
        historyPushed: boolean;
        startX: number;
        startY: number;
      }
    | {
        kind: 'center';
        origOffU: number;
        origOffV: number;
        startLocalU: number;
        startLocalV: number;
        historyPushed: boolean;
        startX: number;
        startY: number;
      }
    | {
        kind: 'cyl_scale';
        historyPushed: boolean;
        startX: number;
        startY: number;
      };

  let drag: DragState = { kind: 'none' };
  let activePointerId: number | null = null;

  const getEffOri = (): 0 | 1 | 2 | 3 => normalizeRotation(getShape().ori + app.doc.viewRotation);

  const getActiveSec = (): ColumnSection => {
    const s = getShape();
    return ensureActiveColumnSection(s) ?? ensureColumnSections(s)[0];
  };

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
      return [clamp(0.5 + nx, -0.45, 1.45), clamp(0.5 + ny, -0.45, 1.45)];
    }
    const du = (nx + ny) * SQRT1_2;
    const dv = (ny - nx) * SQRT1_2;
    const [lu, lv] = viewUvToLocal(0.5 + du, 0.5 + dv, getEffOri());
    return [clamp(lu, -0.45, 1.45), clamp(lv, -0.45, 1.45)];
  };

  const getAngleKnobCanvasPos = (
    seg: ReturnType<typeof evaluateColumnSectionEdges>[number],
  ): [number, number] => {
    const [mx, my] = toCanvas(seg.midpoint[0], seg.midpoint[1]);
    const [tx, ty] = toCanvas(seg.midpoint[0] + seg.normal[0] * 0.14, seg.midpoint[1] + seg.normal[1] * 0.14);
    const vx = tx - mx;
    const vy = ty - my;
    const mag = Math.hypot(vx, vy) || 1;
    const px = Math.min(26, Math.max(16, sizePx * 0.08));
    return [mx + (vx / mag) * px, my + (vy / mag) * px];
  };

  const drawCanvas = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const curShape = getShape();
    const sec = getActiveSec();
    const isPoly = isPolygonalColumnShape(curShape);
    if (isPoly && sec.edges.length > 0 && selectedEdgeIdx >= sec.edges.length) {
      selectedEdgeIdx = 0;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sizePx, sizePx);

    ctx.fillStyle = '#14111f';
    ctx.fillRect(0, 0, sizePx, sizePx);

    // Subtle 1/4 grid inside [0, 1]^2
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

    // Orientation labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isoAlign) {
      ctx.fillText(tr('后 ↑'), sizePx * 0.5, 11);
      ctx.fillText(tr('前 ↓'), sizePx * 0.5, sizePx - 11);
      ctx.fillText(tr('左'), 13, sizePx * 0.5);
      ctx.fillText(tr('右'), sizePx - 13, sizePx * 0.5);
    } else {
      const [uTipX, uTipY] = toCanvas(1.12, 0.5);
      const [vTipX, vTipY] = toCanvas(0.5, 1.12);
      ctx.fillText('+U', uTipX, uTipY);
      ctx.fillText('+V', vTipX, vTipY);
    }

    // Onion-skin ghosts of other control sections
    const allSecs = getColumnSectionsReadOnly(curShape);
    for (const other of allSecs) {
      if (other.id === sec.id) continue;
      const gPts = evaluateColumnSectionRing(other, 40);
      if (gPts.length >= 3) {
        ctx.strokeStyle = other.t < sec.t ? 'rgba(96, 165, 250, 0.28)' : 'rgba(251, 191, 36, 0.28)';
        ctx.lineWidth = 1.2;
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
    }

    // Visual anchor points when snap enabled
    if (anchorSnap) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.36)';
      for (const au of BASE_ANCHORS) {
        for (const av of BASE_ANCHORS) {
          const [ax, ay] = toCanvas(au, av);
          ctx.beginPath();
          ctx.arc(ax, ay, au === 0.5 && av === 0.5 ? 2.6 : 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (isPoly) {
      const segs = evaluateColumnSectionEdges(sec);
      if (segs.length >= 3) {
        // Fill polygon interior
        ctx.beginPath();
        const [fx0, fy0] = toCanvas(segs[0].start[0], segs[0].start[1]);
        ctx.moveTo(fx0, fy0);
        for (let i = 1; i < segs.length; i++) {
          const [fx, fy] = toCanvas(segs[i].start[0], segs[i].start[1]);
          ctx.lineTo(fx, fy);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(52, 211, 153, 0.16)';
        ctx.fill();

        // Draw each edge color-coded (locked = #f59e0b amber, selected = #fbbf24, unlocked = #34d399)
        for (const seg of segs) {
          const [ax, ay] = toCanvas(seg.start[0], seg.start[1]);
          const [bx, by] = toCanvas(seg.end[0], seg.end[1]);
          const isSel = seg.edgeIndex === selectedEdgeIdx;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = seg.locked ? '#f59e0b' : isSel ? '#fbbf24' : '#34d399';
          ctx.lineWidth = isSel || seg.locked ? 3.2 : 2;
          ctx.stroke();
        }

        // Draw corner vertices quietly (read-only corners; NOT editable points)
        for (const seg of segs) {
          const [vx, vy] = toCanvas(seg.start[0], seg.start[1]);
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(vx, vy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw midpoint move handles & rotation knobs
        for (const seg of segs) {
          const isSel = seg.edgeIndex === selectedEdgeIdx;
          const [mx, my] = toCanvas(seg.midpoint[0], seg.midpoint[1]);

          if (isSel && !seg.locked) {
            const [kx, ky] = getAngleKnobCanvasPos(seg);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(kx, ky);
            ctx.stroke();

            ctx.fillStyle = '#a855f7';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(kx, ky, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }

          ctx.fillStyle = seg.locked ? '#f59e0b' : isSel ? '#fbbf24' : '#34d399';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.4;
          const r = isSel ? 5.2 : 4;
          ctx.beginPath();
          if (seg.locked) {
            ctx.rect(mx - r, my - r, r * 2, r * 2);
          } else {
            ctx.arc(mx, my, r, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.stroke();
        }
      }
    } else {
      // Cylinder circular control ring (no per-edge angle/lock)
      const pts = evaluateColumnSectionRing(sec, 48);
      if (pts.length >= 8) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const [px, py] = toCanvas(pts[i][0], pts[i][1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(52, 211, 153, 0.16)';
        ctx.fill();
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // 4 cardinal rim scale handles
        const r = 0.5 * sec.scale;
        const cu = 0.5 + sec.offsetU;
        const cv = 0.5 + sec.offsetV;
        for (const [hx, hy] of [
          toCanvas(cu + r, cv),
          toCanvas(cu - r, cv),
          toCanvas(cu, cv + r),
          toCanvas(cu, cv - r),
        ]) {
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Center section move diamond (offsetU / offsetV)
    const [cx, cy] = toCanvas(0.5 + sec.offsetU, 0.5 + sec.offsetV);
    ctx.fillStyle = nudgeTarget === 'center' || !isPoly ? '#38bdf8' : 'rgba(56, 189, 248, 0.72)';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.4;
    const dr = 5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dr);
    ctx.lineTo(cx + dr, cy);
    ctx.lineTo(cx, cy + dr);
    ctx.lineTo(cx - dr, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Active snap guide lines
    if (activeGuideU !== null) {
      const [gx0, gy0] = toCanvas(activeGuideU, -0.2);
      const [gx1, gy1] = toCanvas(activeGuideU, 1.2);
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
      const [gx0, gy0] = toCanvas(-0.2, activeGuideV);
      const [gx1, gy1] = toCanvas(1.2, activeGuideV);
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(gx0, gy0);
      ctx.lineTo(gx1, gy1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (activeAngleGuideDeg !== null) {
      ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(tr(`吸附角度: ${activeAngleGuideDeg}°`), 10, 26);
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

  canvas.onpointerdown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    canvas.focus();
    activePointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events
    }

    const [sx, sy] = getPointerPos(e);
    const curShape = getShape();
    const sec = getActiveSec();
    const isPoly = isPolygonalColumnShape(curShape);
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const hitR = isTouch ? 18 : 11;

    if (isPoly) {
      const segs = evaluateColumnSectionEdges(sec);
      const selSeg = segs[selectedEdgeIdx];
      // 1. Check angle rotation knob on selected unlocked edge
      if (selSeg && !selSeg.locked) {
        const [kx, ky] = getAngleKnobCanvasPos(selSeg);
        if (Math.hypot(sx - kx, sy - ky) <= hitR) {
          drag = {
            kind: 'edge_angle',
            edgeIdx: selSeg.edgeIndex,
            origMidpoint: [selSeg.midpoint[0], selSeg.midpoint[1]],
            origAngleDeg: sec.edges[selSeg.edgeIndex].angleDeg,
            origOffset: sec.edges[selSeg.edgeIndex].offset,
            historyPushed: false,
            startX: sx,
            startY: sy,
          };
          return;
        }
      }

      // 2. Check edge midpoint handle or edge line hit
      let bestIdx = -1;
      let bestDist = hitR * 1.15;
      for (const seg of segs) {
        const [mx, my] = toCanvas(seg.midpoint[0], seg.midpoint[1]);
        const dMid = Math.hypot(sx - mx, sy - my);
        if (dMid <= bestDist) {
          bestDist = dMid;
          bestIdx = seg.edgeIndex;
        }
      }
      if (bestIdx < 0) {
        for (const seg of segs) {
          const [ax, ay] = toCanvas(seg.start[0], seg.start[1]);
          const [bx, by] = toCanvas(seg.end[0], seg.end[1]);
          const dSeg = distPointToSeg(sx, sy, ax, ay, bx, by);
          if (dSeg <= bestDist) {
            bestDist = dSeg;
            bestIdx = seg.edgeIndex;
          }
        }
      }
      if (bestIdx >= 0) {
        selectedEdgeIdx = bestIdx;
        drawCanvas();
        onSyncExternal();
        if (sec.edges[bestIdx]?.locked) {
          toast('该控制边已锁定固定（橙色），请在下方解除锁定后再拖动或调角度');
          return;
        }
        drag = {
          kind: 'edge_pos',
          edgeIdx: bestIdx,
          historyPushed: false,
          startX: sx,
          startY: sy,
        };
        return;
      }

      // 3. Center diamond hit
      const [cx, cy] = toCanvas(0.5 + sec.offsetU, 0.5 + sec.offsetV);
      if (Math.hypot(sx - cx, sy - cy) <= hitR * 1.4) {
        const [lu, lv] = toLocal(sx, sy);
        drag = {
          kind: 'center',
          origOffU: sec.offsetU,
          origOffV: sec.offsetV,
          startLocalU: lu,
          startLocalV: lv,
          historyPushed: false,
          startX: sx,
          startY: sy,
        };
        return;
      }
    } else {
      // Cylinder: check center diamond vs rim scale handles
      const [cx, cy] = toCanvas(0.5 + sec.offsetU, 0.5 + sec.offsetV);
      if (Math.hypot(sx - cx, sy - cy) <= hitR * 1.4) {
        const [lu, lv] = toLocal(sx, sy);
        drag = {
          kind: 'center',
          origOffU: sec.offsetU,
          origOffV: sec.offsetV,
          startLocalU: lu,
          startLocalV: lv,
          historyPushed: false,
          startX: sx,
          startY: sy,
        };
        return;
      }
      const r = 0.5 * sec.scale;
      const cu = 0.5 + sec.offsetU;
      const cv = 0.5 + sec.offsetV;
      for (const [hx, hy] of [
        toCanvas(cu + r, cv),
        toCanvas(cu - r, cv),
        toCanvas(cu, cv + r),
        toCanvas(cu, cv - r),
      ]) {
        if (Math.hypot(sx - hx, sy - hy) <= hitR * 1.35) {
          drag = { kind: 'cyl_scale', historyPushed: false, startX: sx, startY: sy };
          return;
        }
      }
      // Or clicking anywhere near ring starts radial scaling
      const [lu, lv] = toLocal(sx, sy);
      if (Math.abs(Math.hypot(lu - cu, lv - cv) - r) <= 0.14) {
        drag = { kind: 'cyl_scale', historyPushed: false, startX: sx, startY: sy };
      }
    }
  };

  canvas.onpointermove = (e) => {
    if (drag.kind === 'none') return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const [sx, sy] = getPointerPos(e);
    const curShape = getShape();
    const sec = getActiveSec();

    if (drag.kind === 'edge_pos') {
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate('拖动柱体控制边位置');
        drag.historyPushed = true;
      }
      const edge = sec.edges[drag.edgeIdx];
      if (!edge || edge.locked) return;
      let [lu, lv] = toLocal(sx, sy);
      const localDeg = edge.angleDeg + sec.twistDeg;
      const rad = (localDeg * Math.PI) / 180;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);

      activeGuideU = null;
      activeGuideV = null;
      if (anchorSnap && !e.altKey) {
        // Cardinal edges snap directly to U/V anchor coordinates!
        if (Math.abs(nx) > 0.99 || Math.abs(ny) > 0.99) {
          const segs = evaluateColumnSectionEdges(sec);
          const anchorsU = [...BASE_ANCHORS];
          const anchorsV = [...BASE_ANCHORS];
          for (const sg of segs) {
            if (sg.edgeIndex === drag.edgeIdx) continue;
            anchorsU.push(sg.start[0], sg.midpoint[0]);
            anchorsV.push(sg.start[1], sg.midpoint[1]);
          }
          const snapped = snapUVToAnchors(lu, lv, anchorsU, anchorsV, snapStep, 0.025);
          if (Math.abs(nx) > 0.99) {
            lu = snapped.u;
            activeGuideU = snapped.guideU;
          } else {
            lv = snapped.v;
            activeGuideV = snapped.guideV;
          }
        }
      }

      const dLocal = nx * (lu - 0.5) + ny * (lv - 0.5);
      let nextOffset = (dLocal - nx * sec.offsetU - ny * sec.offsetV) / Math.max(0.15, sec.scale) - edge.baseDist;
      if (anchorSnap && !e.altKey && Math.abs(nx) <= 0.99 && Math.abs(ny) <= 0.99 && snapStep > 0) {
        nextOffset = snapScalarToStep(nextOffset, snapStep, [0], 0.02);
      }
      nextOffset = Math.round(nextOffset * 10000) / 10000;
      unlockColTransitionOnManualEdit(sec);
      applyColumnEdgeEdit(sec, drag.edgeIdx, nextOffset, edge.angleDeg, { pivotMidpoint: false });
      syncColumnTransitionSections(curShape);
      drawCanvas();
      onSyncExternal();
      opts.afterMutate({ live: true, needsResort: true });
      return;
    }

    if (drag.kind === 'edge_angle') {
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate('旋转柱体控制边角度');
        drag.historyPushed = true;
      }
      const edge = sec.edges[drag.edgeIdx];
      if (!edge || edge.locked) return;
      const [lu, lv] = toLocal(sx, sy);
      const dx = lu - drag.origMidpoint[0];
      const dy = lv - drag.origMidpoint[1];
      if (Math.hypot(dx, dy) < 0.02) return;
      let rawDeg = (Math.atan2(dy, dx) * 180) / Math.PI - sec.twistDeg;
      activeAngleGuideDeg = null;
      if (anchorSnap && !e.altKey) {
        // Snap cleanly to 15° increments + baseAngleDeg
        const stepDeg = snapStep >= 0.1 ? 15 : 5;
        const baseCand = normalizeAngleDeg(edge.baseAngleDeg);
        const snap15 = Math.round(rawDeg / 15) * 15;
        if (Math.abs(rawDeg - baseCand) <= 4) {
          rawDeg = baseCand;
          activeAngleGuideDeg = Math.round(rawDeg * 10) / 10;
        } else if (Math.abs(rawDeg - snap15) <= 4) {
          rawDeg = snap15;
          activeAngleGuideDeg = normalizeAngleDeg(snap15);
        } else if (stepDeg > 0) {
          rawDeg = Math.round(rawDeg / stepDeg) * stepDeg;
        }
      }
      unlockColTransitionOnManualEdit(sec);
      applyColumnEdgeEdit(sec, drag.edgeIdx, edge.offset, rawDeg, {
        pivotMidpoint: true,
        midpoint: drag.origMidpoint,
      });
      syncColumnTransitionSections(curShape);
      drawCanvas();
      onSyncExternal();
      opts.afterMutate({ live: true, needsResort: true });
      return;
    }

    if (drag.kind === 'center') {
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate('平移控制面中心位置');
        drag.historyPushed = true;
      }
      const [lu, lv] = toLocal(sx, sy);
      let nextU = drag.origOffU + (lu - drag.startLocalU);
      let nextV = drag.origOffV + (lv - drag.startLocalV);
      activeGuideU = null;
      activeGuideV = null;
      if (anchorSnap && !e.altKey) {
        const centerAnchors = [-0.25, 0, 0.25];
        const su = snapScalarToStep(nextU, snapStep, centerAnchors, 0.022);
        const sv = snapScalarToStep(nextV, snapStep, centerAnchors, 0.022);
        if (centerAnchors.includes(su)) activeGuideU = 0.5 + su;
        if (centerAnchors.includes(sv)) activeGuideV = 0.5 + sv;
        nextU = su;
        nextV = sv;
      }
      unlockColTransitionOnManualEdit(sec);
      applyColumnSectionTransform(sec, {
        offsetU: Math.round(nextU * 10000) / 10000,
        offsetV: Math.round(nextV * 10000) / 10000,
      });
      syncColumnTransitionSections(curShape);
      drawCanvas();
      onSyncExternal();
      opts.afterMutate({ live: true, needsResort: true });
      return;
    }

    if (drag.kind === 'cyl_scale') {
      if (!drag.historyPushed) {
        if (Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
        opts.beforeMutate('调整圆柱控制面半径');
        drag.historyPushed = true;
      }
      const [lu, lv] = toLocal(sx, sy);
      const cu = 0.5 + sec.offsetU;
      const cv = 0.5 + sec.offsetV;
      let nextScale = Math.hypot(lu - cu, lv - cv) * 2;
      if (anchorSnap && !e.altKey) {
        nextScale = snapScalarToStep(nextScale, snapStep, [0.5, 0.75, 1.0, 1.25, 1.5], 0.025);
      }
      unlockColTransitionOnManualEdit(sec);
      sec.scale = Math.round(clamp(nextScale, 0.15, 1.6) * 1000) / 1000;
      syncColumnTransitionSections(curShape);
      drawCanvas();
      onSyncExternal();
      opts.afterMutate({ live: true, needsResort: true });
    }
    void curShape;
  };

  const finishPointer = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    activePointerId = null;
    if (drag.kind === 'none') return;
    if (canvas.hasPointerCapture(e.pointerId)) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release errors
      }
    }
    const pushed = drag.historyPushed;
    drag = { kind: 'none' };
    activeGuideU = null;
    activeGuideV = null;
    activeAngleGuideDeg = null;
    drawCanvas();
    if (pushed) {
      opts.afterMutate({ live: false, needsResort: true });
      onSyncExternal();
    }
  };

  canvas.onpointerup = finishPointer;
  canvas.onpointercancel = finishPointer;
  canvas.onlostpointercapture = finishPointer;

  const screenDeltaToLocalDir = (dxScreen: number, dyScreen: number): [number, number] => {
    const [u0, v0] = toLocal(sizePx * 0.5, sizePx * 0.5);
    const [u1, v1] = toLocal(sizePx * 0.5 + dxScreen * 10, sizePx * 0.5 + dyScreen * 10);
    const du = u1 - u0;
    const dv = v1 - v0;
    const mag = Math.hypot(du, dv) || 1;
    return [du / mag, dv / mag];
  };

  const nudgeByScreen = (dxScreen: number, dyScreen: number, pushHistory = true, stepMult = 1): boolean => {
    const curShape = getShape();
    const sec = getActiveSec();
    const [du, dv] = screenDeltaToLocalDir(dxScreen, dyScreen);
    const isPoly = isPolygonalColumnShape(curShape);
    const step = nudgeStep * stepMult;

    if (isPoly && nudgeTarget === 'edge') {
      const edge = sec.edges[selectedEdgeIdx];
      if (!edge) return false;
      if (edge.locked) {
        if (pushHistory) toast('当前选中控制边已锁定固定，请先解除锁定');
        return false;
      }
      const rad = ((edge.angleDeg + sec.twistDeg) * Math.PI) / 180;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);
      const proj = du * nx + dv * ny;
      if (Math.abs(proj) < 0.16) {
        if (pushHistory) toast('该方向与当前边平行，请按垂向箭头或用「内收 / 外扩」微调');
        return false;
      }
      const deltaOffset = (proj * step) / Math.max(0.15, sec.scale);
      const targetOff = Math.round((edge.offset + deltaOffset) * 10000) / 10000;
      if (pushHistory) opts.beforeMutate('微调控制边位置');
      unlockColTransitionOnManualEdit(sec);
      const changed = applyColumnEdgeEdit(sec, selectedEdgeIdx, targetOff, edge.angleDeg, { pivotMidpoint: false });
      if (!changed) return false;
      syncColumnTransitionSections(curShape);
      drawCanvas();
      onSyncExternal();
      return true;
    }

    if (pushHistory) opts.beforeMutate('微调控制面偏移');
    unlockColTransitionOnManualEdit(sec);
    const prevU = sec.offsetU;
    const prevV = sec.offsetV;
    applyColumnSectionTransform(sec, {
      offsetU: Math.round((sec.offsetU + du * step) * 10000) / 10000,
      offsetV: Math.round((sec.offsetV + dv * step) * 10000) / 10000,
    });
    if (sec.offsetU === prevU && sec.offsetV === prevV) return false;
    syncColumnTransitionSections(curShape);
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const nudgeEdgeNormal = (sign: -1 | 1, pushHistory = true, stepMult = 1): boolean => {
    const curShape = getShape();
    const sec = getActiveSec();
    const edge = sec.edges[selectedEdgeIdx];
    if (!edge) return false;
    if (edge.locked) {
      if (pushHistory) toast('当前控制边已锁定固定');
      return false;
    }
    if (pushHistory) opts.beforeMutate(sign > 0 ? '外扩控制边' : '内收控制边');
    unlockColTransitionOnManualEdit(sec);
    const targetOff = Math.round((edge.offset + sign * nudgeStep * stepMult) * 10000) / 10000;
    const changed = applyColumnEdgeEdit(sec, selectedEdgeIdx, targetOff, edge.angleDeg, { pivotMidpoint: false });
    if (!changed) return false;
    syncColumnTransitionSections(curShape);
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const nudgeEdgeAngle = (deltaDeg: number, pushHistory = true): boolean => {
    const curShape = getShape();
    const sec = getActiveSec();
    const edge = sec.edges[selectedEdgeIdx];
    if (!edge) return false;
    if (edge.locked) {
      if (pushHistory) toast('当前控制边已锁定固定');
      return false;
    }
    if (pushHistory) opts.beforeMutate('微调控制边角度');
    unlockColTransitionOnManualEdit(sec);
    const changed = applyColumnEdgeEdit(sec, selectedEdgeIdx, edge.offset, edge.angleDeg + deltaDeg, {
      pivotMidpoint: true,
    });
    if (!changed) return false;
    syncColumnTransitionSections(curShape);
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const nudgeCylinderScale = (sign: -1 | 1, pushHistory = true, stepMult = 1): boolean => {
    const curShape = getShape();
    const sec = getActiveSec();
    const next = Math.round(clamp(sec.scale + sign * nudgeStep * 2 * stepMult, 0.15, 1.6) * 1000) / 1000;
    if (next === sec.scale) return false;
    if (pushHistory) opts.beforeMutate('微调圆柱控制面缩放');
    unlockColTransitionOnManualEdit(sec);
    sec.scale = next;
    syncColumnTransitionSections(curShape);
    drawCanvas();
    onSyncExternal();
    return true;
  };

  const snapCurrentTargetToAnchor = () => {
    const curShape = getShape();
    const sec = getActiveSec();
    const isPoly = isPolygonalColumnShape(curShape);
    if (isPoly && nudgeTarget === 'edge') {
      const edge = sec.edges[selectedEdgeIdx];
      if (!edge) return;
      if (edge.locked) {
        toast('该控制边已锁定固定');
        return;
      }
      const nextAngle = Math.round(edge.angleDeg / 15) * 15;
      const rad = ((nextAngle + sec.twistDeg) * Math.PI) / 180;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);
      const curMid = evaluateColumnSectionEdges(sec)[selectedEdgeIdx]?.midpoint ?? [0.5, 0.5];
      let targetOff = snapScalarToStep(edge.offset, snapStep || 0.05, [0], 0.02);
      if (Math.abs(nx) > 0.99 || Math.abs(ny) > 0.99) {
        const sn = snapUVToAnchors(curMid[0], curMid[1], BASE_ANCHORS, BASE_ANCHORS, snapStep || 0.05, 0.04);
        const dLocal = nx * (sn.u - 0.5) + ny * (sn.v - 0.5);
        targetOff =
          Math.round(
            (((dLocal - nx * sec.offsetU - ny * sec.offsetV) / Math.max(0.15, sec.scale)) - edge.baseDist) *
              10000,
          ) / 10000;
      }
      opts.beforeMutate('贴合控制边到锚点');
      unlockColTransitionOnManualEdit(sec);
      const changed = applyColumnEdgeEdit(sec, selectedEdgeIdx, targetOff, nextAngle, {
        pivotMidpoint: Math.abs(nextAngle - edge.angleDeg) > 1e-3,
      });
      syncColumnTransitionSections(curShape);
      opts.afterMutate({ live: false, needsResort: true });
      drawCanvas();
      onSyncExternal();
      if (!changed) toast('当前边已对齐最近锚点或受相邻边几何限制');
      return;
    }

    const su = Math.round(snapScalarToStep(sec.offsetU, snapStep || 0.05, [-0.25, 0, 0.25], 0.03) * 10000) / 10000;
    const sv = Math.round(snapScalarToStep(sec.offsetV, snapStep || 0.05, [-0.25, 0, 0.25], 0.03) * 10000) / 10000;
    if (su === sec.offsetU && sv === sec.offsetV) {
      toast('当前控制面中心已对齐锚点');
      return;
    }
    opts.beforeMutate('贴合控制面中心到锚点');
    unlockColTransitionOnManualEdit(sec);
    applyColumnSectionTransform(sec, { offsetU: su, offsetV: sv });
    syncColumnTransitionSections(curShape);
    opts.afterMutate({ live: false, needsResort: true });
    drawCanvas();
    onSyncExternal();
  };

  bindSubCanvasNudgeScope(canvas, {
    nudgeScreen: (dx, dy, shiftBoost, pushHistory) =>
      nudgeByScreen(dx, dy, pushHistory, shiftBoost ? 4 : 1),
    nudgeAux: (dir, shiftBoost, pushHistory) =>
      isPolygonalColumnShape(getShape())
        ? nudgeEdgeNormal(dir, pushHistory, shiftBoost ? 4 : 1)
        : nudgeCylinderScale(dir, pushHistory, shiftBoost ? 4 : 1),
    commitNudge: () => opts.afterMutate({ live: false, needsResort: true }),
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
    get anchorSnap() { return anchorSnap; },
    setAnchorSnap(v: boolean) {
      anchorSnap = v;
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
    get selectedEdgeIdx() { return selectedEdgeIdx; },
    setSelectedEdgeIdx(i: number) {
      selectedEdgeIdx = Math.max(0, i);
      drawCanvas();
      onSyncExternal();
    },
    get nudgeTarget() { return nudgeTarget; },
    setNudgeTarget(t: 'edge' | 'center') {
      nudgeTarget = t;
      drawCanvas();
      onSyncExternal();
    },
    nudgeByScreen,
    nudgeEdgeNormal,
    nudgeEdgeAngle,
    nudgeCylinderScale,
    snapCurrentTargetToAnchor,
    getState(): ColumnEditorInitState {
      return {
        isoAlign,
        anchorSnap,
        snapStep,
        nudgeStep,
        selectedEdgeIdx,
        nudgeTarget,
      };
    },
  };
}

function createColumnControlsBlock(
  ctrl: ReturnType<typeof createColumnCanvasController>,
  shapeOrGetter: ParametricShape | (() => ParametricShape),
  opts: ColumnMutateOpts,
  onAfterChange: () => void,
) {
  const getShape = () => (typeof shapeOrGetter === 'function' ? shapeOrGetter() : shapeOrGetter);
  const root = h('div', { style: 'display:flex;flex-direction:column;gap:6px;width:100%' });

  const alignBtn = h('button', {
    class: 'btn small',
    title: '开启后编辑器四向与主画布等距视角一致',
    onclick: () => ctrl.setIsoAlign(!ctrl.isoAlign),
  }, '🧭 等距同步') as HTMLButtonElement;

  const snapBtn = h('button', {
    class: 'btn small',
    title: '拖拽边/中心/角度时自动吸附锚点与网格（按住 Alt 临时关闭）',
    onclick: () => ctrl.setAnchorSnap(!ctrl.anchorSnap),
  }, '🧲 锚点吸附') as HTMLButtonElement;

  const snapStepSel = select(
    SNAP_STEP_OPTIONS.map((o) => ({ id: String(o.value), label: o.label })),
    String(ctrl.snapStep),
    (v) => ctrl.setSnapStep(Number(v) || 0),
  );

  const snapNowBtn = h('button', {
    class: 'btn small',
    title: '立即将当前选中边/中心吸附到最近锚点',
    onclick: () => ctrl.snapCurrentTargetToAnchor(),
  }, '⊙ 贴合锚点') as HTMLButtonElement;

  const targetEdgeBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setNudgeTarget('edge'),
  }, '📏 微调控制边') as HTMLButtonElement;
  const targetCenterBtn = h('button', {
    class: 'btn small',
    onclick: () => ctrl.setNudgeTarget('center'),
  }, '⊕ 平移截面') as HTMLButtonElement;

  const coordBadge = h('span', { class: 'fine-coord-badge' }) as HTMLSpanElement;

  const makeRepeatScreenNudge = (label: string, dx: number, dy: number, title: string) => {
    let historyReady = false;
    const btn = h('button', { class: 'btn small nudge-btn', type: 'button', title }, label) as HTMLButtonElement;
    return makeRepeatableButton(btn, {
      onStep: () => {
        const changed = ctrl.nudgeByScreen(dx, dy, !historyReady);
        if (changed) {
          historyReady = true;
          opts.afterMutate({ live: true, needsResort: true });
        }
        return changed;
      },
      onEnd: (didMutate) => {
        if (didMutate && historyReady) {
          opts.afterMutate({ live: false, needsResort: true });
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

  // Polygonal edge controls (rendered/updated dynamically when selection changes)
  const polyPanel = h('div', { class: 'loft-sec-props' });
  const cylPanel = h('div', { class: 'loft-sec-props' });
  let lastEdgeSig = '';
  let posSlider: ReturnType<typeof rangeRow> | null = null;
  let angSlider: ReturnType<typeof rangeRow> | null = null;
  let cylScaleSlider: ReturnType<typeof rangeRow> | null = null;
  let lastCylSig = '';

  const buildPolyPanel = () => {
    const curShape = getShape();
    const isPoly = isPolygonalColumnShape(curShape);
    polyPanel.style.display = isPoly ? 'flex' : 'none';
    cylPanel.style.display = isPoly ? 'none' : 'flex';
    targetEdgeBtn.style.display = isPoly ? '' : 'none';
    targetCenterBtn.style.display = isPoly ? '' : 'none';
    if (!isPoly) {
      const sec = ensureActiveColumnSection(curShape);
      if (!sec) return;
      const scalePct = Math.round(sec.scale * 100);
      const cylSig = `${curShape.shapeType}:${sec.id}`;
      if (cylSig !== lastCylSig || !cylScaleSlider) {
        lastCylSig = cylSig;
        cylPanel.innerHTML = '';
        cylScaleSlider = rangeRow(
          '截面半径缩放 (%)',
          15,
          160,
          scalePct,
          (v) => {
            const curShape = getShape();
            const cur = ensureActiveColumnSection(curShape);
            if (!cur) return;
            unlockColTransitionOnManualEdit(cur);
            cur.scale = Math.round(clamp(v / 100, 0.15, 1.6) * 1000) / 1000;
            syncColumnTransitionSections(curShape);
            ctrl.drawCanvas();
            opts.afterMutate({ live: true, needsResort: true });
          },
          1,
          {
            onBegin: () => opts.beforeMutate('调整圆柱截面半径'),
            onCommit: () => {
              syncColumnTransitionSections(getShape());
              onAfterChange();
              opts.afterMutate({ live: false, needsResort: true });
            },
          },
        );
        const makeCylNudge = (label: string, sign: -1 | 1) => {
          let started = false;
          const b = h('button', { class: 'btn small', type: 'button' }, label) as HTMLButtonElement;
          return makeRepeatableButton(b, {
            onStep: () => {
              const changed = ctrl.nudgeCylinderScale(sign, !started);
              if (changed) {
                started = true;
                opts.afterMutate({ live: true, needsResort: true });
              }
              return changed;
            },
            onEnd: (didMutate) => {
              if (didMutate && started) opts.afterMutate({ live: false, needsResort: true });
              started = false;
            },
          });
        };
        cylPanel.append(
          h('div', { class: 'hint' }, '圆柱控制面（仅调整圆面位移与半径缩放，无需编辑单边/控制点）：'),
          cylScaleSlider.row,
          h('div', { class: 'loft-mode-bar' }, makeCylNudge('➖ 缩小半径', -1), makeCylNudge('➕ 放大半径', 1)),
        );
      } else {
        cylScaleSlider.set(scalePct);
      }
      coordBadge.textContent = tr(`中心偏移 (${sec.offsetU.toFixed(3)}, ${sec.offsetV.toFixed(3)}) · 半径 ${Math.round(sec.scale * 100)}%`);
      return;
    }

    const sec = ensureActiveColumnSection(curShape);
    if (!sec || sec.edges.length < 3) return;
    const edgeIdx = clamp(ctrl.selectedEdgeIdx, 0, sec.edges.length - 1);
    const edge = sec.edges[edgeIdx];
    const sig = `${curShape.shapeType}:${sec.id}:${sec.edges.length}:${edgeIdx}:${sec.edges.map((e) => (e.locked ? '1' : '0')).join('')}`;

    if (ctrl.nudgeTarget === 'center') {
      coordBadge.textContent = tr(`中心偏移 (${sec.offsetU.toFixed(3)}, ${sec.offsetV.toFixed(3)})`);
    } else {
      coordBadge.textContent = tr(`${edge.label ?? `边#${edgeIdx + 1}`} ${edge.locked ? '🔒' : ''}· 偏移 ${edge.offset >= 0 ? '+' : ''}${edge.offset.toFixed(3)} · ${edge.angleDeg.toFixed(1)}°`);
    }

    if (sig === lastEdgeSig && posSlider && angSlider) {
      posSlider.set(Math.round(edge.offset * 1000) / 10);
      angSlider.set(Math.round(edge.angleDeg * 10) / 10);
      return;
    }
    lastEdgeSig = sig;
    polyPanel.innerHTML = '';

    // Edge pills selector
    const edgeBtns = sec.edges.map((eItem, ei) => {
      const b = h(
        'button',
        {
          class: `btn small${ei === edgeIdx ? ' primary' : ''}${eItem.locked ? ' col-edge-locked' : ''}`,
          onclick: () => ctrl.setSelectedEdgeIdx(ei),
        },
        `${eItem.locked ? '🔒 ' : ''}${eItem.label ?? `边#${ei + 1}`}`,
      );
      return b;
    });

    const lockBtn = h(
      'button',
      {
        class: `btn small${edge.locked ? ' col-edge-locked' : ''}`,
        title: '锁定后该控制边在画布中保持绝对位置和角度不动，不受其他边移动或截面缩放/偏移影响',
        onclick: () => {
          const s = getShape();
          const liveSec = ensureActiveColumnSection(s);
          const liveEdge = liveSec?.edges[edgeIdx];
          if (!liveSec || !liveEdge) return;
          opts.beforeMutate(liveEdge.locked ? '解除控制边锁定' : '固定控制边位置与角度');
          unlockColTransitionOnManualEdit(liveSec);
          liveEdge.locked = !liveEdge.locked;
          syncColumnTransitionSections(s);
          opts.afterMutate({ live: false });
          ctrl.drawCanvas();
          onAfterChange();
        },
      },
      edge.locked ? '🔓 已固定此边 (点击解锁)' : '🔒 固定此边 (不动)',
    ) as HTMLButtonElement;

    const resetEdgeBtn = h('button', {
      class: 'btn small',
      title: '将该控制边的位置与角度恢复为默认形状（需先解锁）',
      disabled: Boolean(edge.locked),
      onclick: () => {
        const s = getShape();
        const liveSec = ensureActiveColumnSection(s);
        const liveEdge = liveSec?.edges[edgeIdx];
        if (!liveSec || !liveEdge || liveEdge.locked) return;
        opts.beforeMutate('重置控制边');
        unlockColTransitionOnManualEdit(liveSec);
        const changed = applyColumnEdgeEdit(liveSec, edgeIdx, 0, liveEdge.baseAngleDeg, { pivotMidpoint: false });
        if (!changed) {
          liveEdge.offset = 0;
          liveEdge.angleDeg = liveEdge.baseAngleDeg;
        }
        syncColumnTransitionSections(s);
        opts.afterMutate({ live: false, needsResort: true });
        ctrl.drawCanvas();
        onAfterChange();
      },
    }, '↺ 重置此边');

    const offPct = Math.round(edge.offset * 1000) / 10; // percentage of plot width (-60..60)
    posSlider = rangeRow(
      '边位置偏移 (%)',
      -60,
      60,
      offPct,
      (v) => {
        const s = getShape();
        const liveSec = ensureActiveColumnSection(s);
        const liveEdge = liveSec?.edges[edgeIdx];
        if (!liveSec || !liveEdge || liveEdge.locked) return;
        unlockColTransitionOnManualEdit(liveSec);
        applyColumnEdgeEdit(liveSec, edgeIdx, v / 100, liveEdge.angleDeg, { pivotMidpoint: false });
        syncColumnTransitionSections(s);
        ctrl.drawCanvas();
        opts.afterMutate({ live: true, needsResort: true });
      },
      0.5,
      {
        onBegin: () => opts.beforeMutate('修改控制边位置'),
        onCommit: () => {
          syncColumnTransitionSections(getShape());
          onAfterChange();
          opts.afterMutate({ live: false, needsResort: true });
        },
      },
    );
    (posSlider.row.querySelector('input') as HTMLInputElement | null)?.toggleAttribute(
      'disabled',
      Boolean(edge.locked),
    );

    const angRow = rangeRow(
      '边法向角度 (°)',
      -180,
      180,
      Math.round(edge.angleDeg * 10) / 10,
      (v) => {
        const s = getShape();
        const liveSec = ensureActiveColumnSection(s);
        const liveEdge = liveSec?.edges[edgeIdx];
        if (!liveSec || !liveEdge || liveEdge.locked) return;
        unlockColTransitionOnManualEdit(liveSec);
        applyColumnEdgeEdit(liveSec, edgeIdx, liveEdge.offset, v, { pivotMidpoint: true });
        syncColumnTransitionSections(s);
        ctrl.drawCanvas();
        opts.afterMutate({ live: true, needsResort: true });
      },
      0.5,
      {
        onBegin: () => opts.beforeMutate('修改控制边角度'),
        onCommit: () => {
          syncColumnTransitionSections(getShape());
          onAfterChange();
          opts.afterMutate({ live: false, needsResort: true });
        },
      },
    );
    angSlider = angRow;
    (angSlider.row.querySelector('input') as HTMLInputElement | null)?.toggleAttribute(
      'disabled',
      Boolean(edge.locked),
    );

    const makeNormNudge = (label: string, sign: -1 | 1) => {
      let started = false;
      const b = h('button', {
        class: 'btn small',
        type: 'button',
        disabled: Boolean(edge.locked),
      }, label) as HTMLButtonElement;
      return makeRepeatableButton(b, {
        onStep: () => {
          const changed = ctrl.nudgeEdgeNormal(sign, !started);
          if (changed) {
            started = true;
            opts.afterMutate({ live: true, needsResort: true });
          }
          return changed;
        },
        onEnd: (didMutate) => {
          if (didMutate && started) opts.afterMutate({ live: false, needsResort: true });
          started = false;
        },
      });
    };

    const makeAngNudge = (label: string, deg: number) => {
      let started = false;
      const b = h('button', {
        class: 'btn small',
        type: 'button',
        disabled: Boolean(edge.locked),
      }, label) as HTMLButtonElement;
      return makeRepeatableButton(b, {
        onStep: () => {
          const changed = ctrl.nudgeEdgeAngle(deg, !started);
          if (changed) {
            started = true;
            opts.afterMutate({ live: true, needsResort: true });
          }
          return changed;
        },
        onEnd: (didMutate) => {
          if (didMutate && started) opts.afterMutate({ live: false, needsResort: true });
          started = false;
        },
      });
    };

    polyPanel.append(
      h('div', { class: 'loft-preset-grid' }, ...edgeBtns),
      h('div', { class: 'loft-mode-bar' }, lockBtn, resetEdgeBtn),
      posSlider.row,
      h('div', { class: 'loft-mode-bar' },
        makeNormNudge('◀ 法向内收', -1),
        makeNormNudge('法向外扩 ▶', 1),
      ),
      angSlider.row,
      h('div', { class: 'loft-mode-bar' },
        makeAngNudge('↺ -5°', -5),
        makeAngNudge('↺ -1°', -1),
        makeAngNudge('+1° ↻', 1),
        makeAngNudge('+5° ↻', 5),
      ),
    );
  };

  const modeBar = h('div', { class: 'loft-mode-bar' }, alignBtn, snapBtn, snapStepSel, snapNowBtn);
  const fineBar = h(
    'div',
    { class: 'fine-tune-bar' },
    h('div', { class: 'loft-mode-bar', style: 'justify-content:center;width:100%' }, targetEdgeBtn, targetCenterBtn),
    coordBadge,
    h(
      'div',
      { class: 'nudge-pad' },
      makeRepeatScreenNudge('←', -1, 0, '向左微调 (方向键)'),
      makeRepeatScreenNudge('↑', 0, -1, '向上微调 (方向键)'),
      makeRepeatScreenNudge('↓', 0, 1, '向下微调 (方向键)'),
      makeRepeatScreenNudge('→', 1, 0, '向右微调 (方向键)'),
    ),
    nudgeStepSel,
  );

  const sync = () => {
    alignBtn.classList.toggle('primary', ctrl.isoAlign);
    snapBtn.classList.toggle('primary', ctrl.anchorSnap);
    snapStepSel.value = String(ctrl.snapStep);
    nudgeStepSel.value = String(ctrl.nudgeStep);
    targetEdgeBtn.classList.toggle('primary', ctrl.nudgeTarget === 'edge');
    targetCenterBtn.classList.toggle('primary', ctrl.nudgeTarget === 'center');
    buildPolyPanel();
  };

  sync();

  root.append(modeBar, h('div', { class: 'loft-curve-wrap' }, ctrl.canvas), fineBar, polyPanel, cylPanel);
  return {
    modeBar,
    fineBar,
    polyPanel,
    cylPanel,
    sync,
  };
}

export function openColumnSectionModal(
  shape: ParametricShape,
  app: App,
  opts: ColumnMutateOpts,
  initState?: ColumnEditorInitState,
) {
  let close = () => {};
  const binding = createModalLiveBinding(app, shape, opts.targetLayerId, opts);
  const liveOpts: ColumnMutateOpts = {
    targetLayerId: opts.targetLayerId,
    beforeMutate: binding.beforeMutate,
    afterMutate: binding.afterMutate,
  };
  const getLiveShape = () => binding.getShape() ?? shape;

  let refreshAll = () => {};
  const ctrl = createColumnCanvasController(340, getLiveShape, app, liveOpts, () => refreshAll(), initState);
  const blocks = createColumnControlsBlock(ctrl, getLiveShape, liveOpts, () => refreshAll());
  // Enlarge canvas wrapper inside modal
  const canvasWrap = ctrl.canvas.parentElement;
  if (canvasWrap) canvasWrap.className = 'loft-curve-wrap large';

  const secTitle = h('div', { class: 'hint', style: 'margin-bottom:2px' });
  const secTabsWrap = h('div', { class: 'loft-mode-bar', style: 'width:100%' });
  const modalAddStdBtn = h(
    'button',
    {
      class: 'btn small',
      title: '在当前与相邻控制面之间插入普通控制面',
      onclick: () => {
        const live = getLiveShape();
        liveOpts.beforeMutate('添加柱体控制面');
        insertColumnSectionAtT(live, computeTargetTBetweenColSections(live));
        syncColumnTransitionSections(live);
        liveOpts.afterMutate({ live: false, needsResort: true });
        refreshAll();
      },
    },
    '+ 添加截面',
  );
  const modalAddTransBtn = h(
    'button',
    {
      class: 'btn small primary',
      title: '新建一个控制边与位置自动在上下两控制面之间过渡的中间控制面',
      onclick: () => {
        insertColTransitionOnShape(getLiveShape(), liveOpts);
        refreshAll();
      },
    },
    '✨ 新建过渡面',
  );
  const modalConvertTransBtn = h(
    'button',
    {
      class: 'btn small',
      title: '切换当前中间控制面为上下控制面之间的自动过渡形态',
      onclick: () => {
        toggleColTransitionOnShape(getLiveShape(), liveOpts);
        refreshAll();
      },
    },
    '🔄 转换为过渡面',
  ) as HTMLButtonElement;
  const secActionBar = h(
    'div',
    { class: 'loft-mode-bar', style: 'justify-content:center;flex-wrap:wrap' },
    modalAddStdBtn,
    modalAddTransBtn,
    modalConvertTransBtn,
  );

  let historyBarObj: ReturnType<typeof buildModalUndoRedoBar>;

  refreshAll = () => {
    const live = binding.getShape();
    if (!live || !isColumnSectionShape(live)) {
      close();
      return;
    }
    const secs = ensureColumnSections(live);
    const activeSec = ensureActiveColumnSection(live) ?? secs[0];
    const zPx = Math.round((activeSec?.t ?? 0) * live.heightPx);
    const isPoly = isPolygonalColumnShape(live);
    const lockCount = isPoly && activeSec ? activeSec.edges.filter((e) => e.locked).length : 0;
    secTitle.textContent = tr(
      `${activeSec?.isTransition ? '✨[过渡面] ' : ''}当前控制面：${activeSec?.name ?? ''} · ${zPx}px (${Math.round((activeSec?.t ?? 0) * 100)}%)${
        isPoly ? ` · ${activeSec?.edges.length ?? 0}条控制边 (锁定 ${lockCount} 条)` : ' · 圆柱控制环'
      }`,
    );

    secTabsWrap.innerHTML = '';
    for (const s of [...secs].sort((a, b) => a.t - b.t)) {
      secTabsWrap.append(
        h(
          'button',
          {
            class: `btn small${s.id === activeSec?.id ? ' primary' : ''}`,
            onclick: () => {
              live.activeColSectionId = s.id;
              refreshAll();
            },
          },
          `${s.isTransition ? '✨ ' : ''}${s.name} (${Math.round(s.t * 100)}%)`,
        ),
      );
    }

    const isTrans = Boolean(activeSec?.isTransition);
    const canTrans = activeSec ? canColumnSectionBeTransition(secs, activeSec.id) : false;
    modalConvertTransBtn.textContent = tr(isTrans ? '✨ 过渡面生效中 · 转为普通面' : '🔄 转换为过渡面');
    modalConvertTransBtn.classList.toggle('transition-active', isTrans);
    modalConvertTransBtn.style.opacity = !isTrans && !canTrans ? '0.6' : '1';

    blocks.sync();
    ctrl.drawCanvas();
    historyBarObj?.sync();
  };

  historyBarObj = buildModalUndoRedoBar(binding, () => refreshAll(), [], {
    nudgeScreen: (dx, dy, shiftBoost, pushHistory) =>
      ctrl.nudgeByScreen(dx, dy, pushHistory, shiftBoost ? 4 : 1),
    nudgeAux: (dir, shiftBoost, pushHistory) =>
      isPolygonalColumnShape(getLiveShape())
        ? ctrl.nudgeEdgeNormal(dir, pushHistory, shiftBoost ? 4 : 1)
        : ctrl.nudgeCylinderScale(dir, pushHistory, shiftBoost ? 4 : 1),
    commitNudge: () => liveOpts.afterMutate({ live: false, needsResort: true }),
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
    secTabsWrap,
    secActionBar,
    blocks.modeBar,
    ctrl.canvas.parentElement ?? ctrl.canvas,
    blocks.fineBar,
    blocks.polyPanel,
    blocks.cylPanel,
  );

  let closed = false;
  close = openSheet('📐 大屏精细编辑柱体控制面', body, {
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

export function buildColumnInspectorSection(
  shape: ParametricShape,
  app: App,
  opts: ColumnMutateOpts,
): HTMLElement {
  const root = h('div', { class: 'loft-editor-box' });

  if (shape.shapeType === 'right_tri_prism' && (shape.triPrismCut ?? 'vertical') !== 'vertical') {
    root.append(
      h('div', { class: 'hint' }, '提示：斜面三棱柱不支持水平截面控制面，请切换为「垂直柱切面」后再启用控制面。'),
    );
    return root;
  }

  if (!isColumnSectionShape(shape)) return root;

  const renderRoot = () => {
    root.innerHTML = '';
    root.append(
      h(
        'div',
        { class: 'menu-sec' },
        shape.shapeType === 'cylinder' ? '圆柱多层控制面（仅半径与位移）' : '柱体控制面与控制边编辑',
      ),
    );

    if (!hasActiveColumnSections(shape)) {
      root.append(
        h('div', { class: 'prop-block' },
          h(
            'div',
            { class: 'hint' },
            shape.shapeType === 'cylinder'
              ? '可启用多层控制面来制作收腰、阶梯或偏心圆柱体。'
              : '启用控制面后可添加多层截面，拖动并锁定各控制边（位置/角度），无需增删控制点。',
          ),
          h(
            'button',
            {
              class: 'btn small accent',
              style: 'width:100%',
              onclick: () => {
                opts.beforeMutate('启用柱体控制面');
                ensureColumnSections(shape);
                opts.afterMutate({ live: false, needsResort: true });
                renderRoot();
              },
            },
            '📐 启用多层控制面与控制边',
          ),
        ),
      );
      return;
    }

    ensureActiveColumnSection(shape);
    let syncAll = () => {};
    const ctrl = createColumnCanvasController(236, shape, app, opts, () => syncAll());
    const blocks = createColumnControlsBlock(ctrl, shape, opts, () => syncAll());

    const stackListEl = h('div', { class: 'loft-stack-list' });
    const secPropsEl = h('div', { class: 'loft-sec-props' });

    const interpRow = h(
      'div',
      { class: 'prop-block' },
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '竖向过渡'),
        select(
          [
            { id: 'smooth', label: '平滑样条 (Smooth)' },
            { id: 'linear', label: '直线硬折 (Linear)' },
          ],
          shape.colInterp ?? 'smooth',
          (v: ColumnInterpMode) => {
            opts.beforeMutate('修改柱体控制面插值方式');
            shape.colInterp = v;
            opts.afterMutate({ live: false, needsResort: true });
            syncAll();
          },
        ),
      ),
    );

    const rebuildActiveSectionProps = () => {
      secPropsEl.innerHTML = '';
      const secsForTrans = ensureColumnSections(shape);
      const sec = ensureActiveColumnSection(shape);
      if (!sec) return;
      const isPoly = isPolygonalColumnShape(shape);
      const getHeightPx = () => Math.max(1, Math.round(shape.heightPx));

      const nameIn = h('input', {
        type: 'text',
        class: 'text-input',
        style: 'flex:1;min-width:0;padding:4px 7px;font-size:12px',
        value: sec.name,
      }) as HTMLInputElement;
      nameIn.onchange = () => {
        const next = nameIn.value.trim();
        if (!next || next === sec.name) return;
        opts.beforeMutate('重命名柱体控制面');
        sec.name = next;
        renderStackList();
        opts.afterMutate({ live: false });
      };

      const pxIn = h('input', {
        type: 'number',
        class: 'num',
        min: '0',
        max: String(getHeightPx()),
        step: '1',
        value: String(Math.round(sec.t * getHeightPx())),
      }) as HTMLInputElement;

      const tSlider = rangeRow(
        '高度占比 t',
        0,
        1,
        Math.round(sec.t * 100) / 100,
        (v) => {
          sec.t = clamp(Math.round(v * 100) / 100, 0, 1);
          syncColumnTransitionSections(shape);
          pxIn.value = String(Math.round(sec.t * getHeightPx()));
          renderStackList();
          ctrl.drawCanvas();
          opts.afterMutate({ live: true });
        },
        0.01,
        {
          onBegin: () => opts.beforeMutate('调整控制面高度'),
          onCommit: () => {
            syncColumnTransitionSections(shape);
            renderStackList();
            ctrl.drawCanvas();
            opts.afterMutate({ live: false });
          },
        },
      );

      pxIn.onchange = () => {
        const hp = getHeightPx();
        const px = clamp(Math.round(Number(pxIn.value) || 0), 0, hp);
        pxIn.value = String(px);
        const nextT = clamp(Math.round((px / hp) * 1000) / 1000, 0, 1);
        if (nextT === sec.t) return;
        opts.beforeMutate('输入控制面像素高度');
        sec.t = nextT;
        syncColumnTransitionSections(shape);
        tSlider.set(Math.round(nextT * 100) / 100);
        renderStackList();
        ctrl.drawCanvas();
        opts.afterMutate({ live: false });
      };

      const isTrans = Boolean(sec.isTransition);
      const canTrans = canColumnSectionBeTransition(secsForTrans, sec.id);
      const transToggleBtn = h(
        'button',
        {
          class: `btn small${isTrans ? ' transition-active' : ''}`,
          style: `width:100%;margin-bottom:2px;${!isTrans && !canTrans ? 'opacity:0.6;' : ''}`,
          title: isTrans
            ? '当前控制面正自动作为上下两控制面的中间过渡形态；点击可解锁为自由编辑'
            : '将当前控制面转换为上下控制面之间的自动过渡中间形态（端点不可转换）',
          onclick: () => {
            if (toggleColTransitionOnShape(shape, opts)) syncAll();
          },
        },
        isTrans ? '✨ 过渡面生效中 · 点击转为普通面' : '🔄 转换为过渡面',
      );

      secPropsEl.append(
        h('div', { style: 'display:flex;align-items:center;gap:6px' }, h('span', { class: 'rl' }, '名称'), nameIn),
        transToggleBtn,
        tSlider.row,
        h(
          'div',
          { class: 'range-row' },
          h('span', { class: 'rl' }, '绝对高度 (px)'),
          pxIn,
          h('span', { class: 'rv', style: 'min-width:52px' }, `/ ${getHeightPx()}px`),
        ),
      );

      if (isPoly) {
        const scaleRow = rangeRow(
          '整体缩放 (%)',
          15,
          160,
          Math.round(sec.scale * 100),
          (v) => {
            unlockColTransitionOnManualEdit(sec);
            applyColumnSectionTransform(sec, { scale: v / 100 });
            syncColumnTransitionSections(shape);
            ctrl.drawCanvas();
            blocks.sync();
            opts.afterMutate({ live: true, needsResort: true });
          },
          1,
          {
            onBegin: () => opts.beforeMutate('调整控制面缩放'),
            onCommit: () => {
              syncColumnTransitionSections(shape);
              opts.afterMutate({ live: false, needsResort: true });
            },
          },
        );
        const twistRow = rangeRow(
          '整体旋转 (°)',
          -180,
          180,
          Math.round(sec.twistDeg),
          (v) => {
            unlockColTransitionOnManualEdit(sec);
            applyColumnSectionTransform(sec, { twistDeg: v });
            syncColumnTransitionSections(shape);
            ctrl.drawCanvas();
            blocks.sync();
            opts.afterMutate({ live: true, needsResort: true });
          },
          1,
          {
            onBegin: () => opts.beforeMutate('旋转控制面'),
            onCommit: () => {
              syncColumnTransitionSections(shape);
              opts.afterMutate({ live: false, needsResort: true });
            },
          },
        );
        const resetSecEdgesBtn = h('button', {
          class: 'btn small',
          title: '将本层未锁定的边恢复默认位置和角度（锁定边保持不动）',
          onclick: () => {
            const defEdges = createDefaultColumnEdges(shape.shapeType, shape.prismSides);
            opts.beforeMutate('重置当前控制面未锁定边');
            unlockColTransitionOnManualEdit(sec);
            for (let i = 0; i < sec.edges.length; i++) {
              if (sec.edges[i].locked || !defEdges[i]) continue;
              sec.edges[i].angleDeg = defEdges[i].baseAngleDeg;
              sec.edges[i].offset = 0;
            }
            if (!sec.edges.some((e) => e.locked)) {
              sec.scale = 1;
              sec.twistDeg = 0;
              sec.offsetU = 0;
              sec.offsetV = 0;
            }
            syncColumnTransitionSections(shape);
            opts.afterMutate({ live: false, needsResort: true });
            ctrl.drawCanvas();
            syncAll();
          },
        }, '↺ 重置未锁边');

        secPropsEl.append(
          scaleRow.row,
          twistRow.row,
          h('div', { class: 'loft-mode-bar' }, resetSecEdgesBtn),
        );
      }
    };

    const renderStackList = () => {
      stackListEl.innerHTML = '';
      const secs = [...ensureColumnSections(shape)].sort((a, b) => b.t - a.t);
      const activeSec = ensureActiveColumnSection(shape);
      const isPoly = isPolygonalColumnShape(shape);
      for (const sec of secs) {
        const isAct = sec.id === activeSec?.id;
        const zPx = Math.round(sec.t * shape.heightPx);
        const locks = isPoly ? sec.edges.filter((e) => e.locked).length : 0;
        const item = h(
          'div',
          {
            class: `loft-sec-item${isAct ? ' active' : ''}`,
            onclick: () => {
              shape.activeColSectionId = sec.id;
              syncAll();
            },
          },
          h(
            'span',
            { class: 'loft-sec-name' },
            `${isAct ? '▶ ' : ''}${sec.name}`,
            sec.isTransition ? h('span', { class: 'sec-transition-badge' }, '✨过渡') : null,
          ),
          h(
            'span',
            { class: 'loft-sec-meta' },
            `${Math.round(sec.t * 100)}% · ${zPx}px${sec.isTransition ? ' · 自动过渡' : ''}${locks > 0 ? ` · 🔒${locks}` : ''}`,
          ),
        );
        stackListEl.append(item);
      }
    };

    syncAll = () => {
      renderStackList();
      rebuildActiveSectionProps();
      blocks.sync();
      ctrl.drawCanvas();
    };

    const addSecBtn = h('button', {
      class: 'btn small primary',
      onclick: () => {
        const targetT = computeTargetTBetweenColSections(shape);
        opts.beforeMutate('添加柱体控制面');
        insertColumnSectionAtT(shape, targetT);
        syncColumnTransitionSections(shape);
        opts.afterMutate({ live: false, needsResort: true });
        syncAll();
      },
    }, '+ 添加截面');

    const addTransBtn = h('button', {
      class: 'btn small',
      title: '新建一个控制边与位置自动保持上下层中间形态的过渡控制面',
      onclick: () => {
        insertColTransitionOnShape(shape, opts);
        syncAll();
      },
    }, '✨ 新建过渡面');

    const dupSecBtn = h('button', {
      class: 'btn small',
      title: '同高度复制一个截面，可拉出锐利阶梯/凸缘',
      onclick: () => {
        const secs = ensureColumnSections(shape);
        const cur = ensureActiveColumnSection(shape);
        if (!cur) return;
        opts.beforeMutate('复制柱体控制面');
        const dup: ColumnSection = {
          ...cur,
          id: nextColSectionId(),
          name: `${cur.name} 副本`,
          edges: cur.edges.map((e) => ({ ...e })),
        };
        delete dup.isTransition;
        secs.push(dup);
        secs.sort((a, b) => a.t - b.t);
        shape.activeColSectionId = dup.id;
        syncColumnTransitionSections(shape);
        opts.afterMutate({ live: false, needsResort: true });
        syncAll();
      },
    }, '复制');

    const delSecBtn = h('button', {
      class: 'btn small danger',
      onclick: () => {
        const secs = ensureColumnSections(shape);
        if (secs.length <= 1) {
          toast('至少需保留 1 个控制面');
          return;
        }
        const cur = ensureActiveColumnSection(shape);
        if (!cur) return;
        opts.beforeMutate('删除柱体控制面');
        const idx = secs.findIndex((s) => s.id === cur.id);
        secs.splice(idx, 1);
        shape.activeColSectionId = secs[Math.max(0, Math.min(idx, secs.length - 1))].id;
        syncColumnTransitionSections(shape);
        opts.afterMutate({ live: false, needsResort: true });
        syncAll();
      },
    }, '删除');

    const openModalBtn = h('button', {
      class: 'btn small accent',
      style: 'width:100%',
      onclick: () => openColumnSectionModal(shape, app, opts, ctrl.getState()),
    }, '🔍 大屏精细编辑控制面与控制边');

    const revertBtn = h('button', {
      class: 'btn small',
      style: 'width:100%',
      title: '清除自定义控制面，恢复为原始简单几何柱体',
      onclick: () => {
        opts.beforeMutate('还原默认简单柱体');
        delete shape.colSections;
        delete shape.colInterp;
        delete shape.activeColSectionId;
        opts.afterMutate({ live: false, needsResort: true });
        renderRoot();
      },
    }, '↩ 还原默认简单柱体');

    syncAll();

    root.append(
      interpRow,
      h('div', { class: 'loft-stack-toolbar' }, addSecBtn, addTransBtn, dupSecBtn, delSecBtn),
      stackListEl,
      h('div', { class: 'prop-block' }, secPropsEl),
      h('div', { class: 'prop-block' },
        h('div', { style: 'font-size:12px;font-weight:700;margin-bottom:4px' },
          isPolygonalColumnShape(shape) ? '控制边画布（橙色方点=已固定边，紫圆=旋转柄）' : '圆柱控制环（拖蓝点调半径，拖中心◆位移）',
        ),
        blocks.modeBar,
        ctrl.canvas.parentElement ?? ctrl.canvas,
        blocks.fineBar,
        blocks.polyPanel,
        blocks.cylPanel,
        h('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:5px' }, openModalBtn, revertBtn),
      ),
    );
  };

  renderRoot();
  return root;
}
