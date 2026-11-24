// TheoTown Dual-Scale Ruler Tool:
// 1. Vertical Z-axis (3 px = 1.6 m)
// 2. Horizontal Plane (1 diamond cell 32x16 = 9.6 m)
// 3. Mixed Direction 3-Point Pythagorean Triangle (sqrt(L_flat^2 + L_vert^2))

import type { RulerMode, RulerPoint3D } from '../app';
import {
  isoToScreenPx,
  measureHorizontalPlane,
  measureMixedPythagorean,
  measureVerticalMeters,
  screenPxToIsoAtZ,
  snapGridValue,
  viewPointToWorld,
  worldPointToView,
  type GridSnapStep,
  type MixedMeasureOrder,
  type ViewRotation,
} from './isoMath';
import { drawBadge, type Pt, type Tool, type ToolHost, type ToScreenFn } from './tools';

export interface RulerCoordContext {
  plotU: number;
  plotV: number;
  viewRotation: ViewRotation;
  originX: number;
  originY: number;
  snapStep: GridSnapStep | number;
  snapGrid: boolean;
  lockAxis: boolean;
}

export function projectRulerPoint3D(
  pt: RulerPoint3D,
  plotU: number,
  plotV: number,
  viewRotation: ViewRotation,
  originX: number,
  originY: number,
): [number, number] {
  const [vu, vv] = worldPointToView(pt.wu, pt.wv, plotU, plotV, viewRotation);
  return isoToScreenPx(vu, vv, pt.zPx, originX, originY);
}

export function pickPlanePointAtZ(
  rawX: number,
  rawY: number,
  zPx: number,
  ctx: RulerCoordContext,
  snapToGrid: boolean,
  anchor?: RulerPoint3D,
): RulerPoint3D {
  let [vu, vv] = screenPxToIsoAtZ(rawX, rawY, zPx, ctx.originX, ctx.originY);
  if (snapToGrid && ctx.snapGrid) {
    const step = Math.min(0.5, ctx.snapStep);
    vu = snapGridValue(vu, step);
    vv = snapGridValue(vv, step);
  }
  if (ctx.lockAxis && anchor) {
    const [au, av] = worldPointToView(anchor.wu, anchor.wv, ctx.plotU, ctx.plotV, ctx.viewRotation);
    if (Math.abs(vu - au) >= Math.abs(vv - av)) vv = av;
    else vu = au;
  }
  const [wu, wv] = viewPointToWorld(vu, vv, ctx.plotU, ctx.plotV, ctx.viewRotation);
  return { wu, wv, zPx };
}

export function pickVerticalPointFrom(
  anchor: RulerPoint3D,
  rawY: number,
  ctx: RulerCoordContext,
): RulerPoint3D {
  const [, ay] = projectRulerPoint3D(anchor, ctx.plotU, ctx.plotV, ctx.viewRotation, ctx.originX, ctx.originY);
  const dz = Math.round(ay - rawY);
  return { wu: anchor.wu, wv: anchor.wv, zPx: anchor.zPx + dz };
}

export function resolveConstrainedRulerPoint3D(
  rawX: number,
  rawY: number,
  existingPts: RulerPoint3D[],
  mode: RulerMode,
  order: MixedMeasureOrder,
  ctx: RulerCoordContext,
): RulerPoint3D {
  const idx = existingPts.length;
  if (mode === 'vertical') {
    if (idx === 0) return pickPlanePointAtZ(Math.round(rawX), Math.round(rawY), 0, ctx, false);
    return pickVerticalPointFrom(existingPts[0], rawY, ctx);
  }
  if (mode === 'horizontal') {
    if (idx === 0) return pickPlanePointAtZ(rawX, rawY, 0, ctx, true);
    return pickPlanePointAtZ(rawX, rawY, existingPts[0].zPx, ctx, true, existingPts[0]);
  }
  // Mixed 3-point mode
  if (idx === 0) {
    return pickPlanePointAtZ(rawX, rawY, 0, ctx, true);
  }
  if (idx === 1) {
    if (order === 'flat_then_vert') {
      return pickPlanePointAtZ(rawX, rawY, existingPts[0].zPx, ctx, true, existingPts[0]);
    }
    return pickVerticalPointFrom(existingPts[0], rawY, ctx);
  }
  // idx >= 2 (Point C)
  if (order === 'flat_then_vert') {
    return pickVerticalPointFrom(existingPts[1], rawY, ctx);
  }
  // 'vert_then_flat': strictly snap C onto B's elevated horizontal plane z = B.zPx
  return pickPlanePointAtZ(rawX, rawY, existingPts[1].zPx, ctx, true, existingPts[1]);
}

export class RulerTool implements Tool {
  private activePts: RulerPoint3D[] = [];
  private ptsBeforeDown: RulerPoint3D[] | null = null;
  private hoverPt: RulerPoint3D | null = null;
  private dragVertexIdx = -1;
  private pointerDown = false;
  private dragMoved = false;

  constructor(private host: ToolHost) {}

  get hasActiveMeasurement(): boolean {
    return this.activePts.length > 0;
  }

  private getCoordCtx(): RulerCoordContext {
    const app = this.host.app;
    const d = app.doc;
    const { originX, originY } = d.getViewOrigin();
    return {
      plotU: d.plotU,
      plotV: d.plotV,
      viewRotation: d.viewRotation,
      originX,
      originY,
      snapStep: app.getSnapStep(),
      snapGrid: app.settings.rulerSnapGrid,
      lockAxis: app.settings.rulerLockAxis,
    };
  }

  private projectPt(pt: RulerPoint3D): [number, number] {
    const d = this.host.app.doc;
    const { originX, originY } = d.getViewOrigin();
    return projectRulerPoint3D(pt, d.plotU, d.plotV, d.viewRotation, originX, originY);
  }

  resetCurrent() {
    this.activePts = [];
    this.ptsBeforeDown = null;
    this.hoverPt = null;
    this.dragVertexIdx = -1;
    this.host.requestRender();
    this.host.refreshUi();
  }

  pinCurrent() {
    const app = this.host.app;
    const reqCount = app.settings.rulerMode === 'mixed' ? 3 : 2;
    if (this.activePts.length < reqCount) {
      this.host.toast('请先完成当前测量取点再固定标注喵~');
      return;
    }
    app.pinnedRulers.push({
      id: `ruler_${Date.now()}`,
      mode: app.settings.rulerMode,
      order: app.settings.rulerMixedOrder,
      pts: this.activePts.map((pt) => ({ ...pt })),
    });
    this.activePts = [];
    this.ptsBeforeDown = null;
    this.host.toast('📌 已固定量尺标注到画布');
    this.host.requestRender();
    this.host.refreshUi();
  }

  clearPinned() {
    this.host.app.pinnedRulers = [];
    this.resetCurrent();
    this.host.toast('🗑️ 已清空所有量尺标注');
  }

  private constrainPoint(rawX: number, rawY: number): RulerPoint3D {
    const app = this.host.app;
    return resolveConstrainedRulerPoint3D(
      rawX,
      rawY,
      this.activePts,
      app.settings.rulerMode,
      app.settings.rulerMixedOrder,
      this.getCoordCtx(),
    );
  }

  down(p: Pt) {
    const app = this.host.app;
    const mode = app.settings.rulerMode;
    const reqCount = mode === 'mixed' ? 3 : 2;
    this.ptsBeforeDown = this.activePts.map((pt) => ({ ...pt }));
    this.pointerDown = true;
    this.dragMoved = false;

    // Allow dragging an existing vertex of a completed measurement
    if (this.activePts.length === reqCount) {
      const tol = 14 / this.host.scale();
      for (let i = 0; i < this.activePts.length; i++) {
        const [vx, vy] = this.projectPt(this.activePts[i]);
        if (Math.hypot(p.x - vx, p.y - vy) <= tol) {
          this.dragVertexIdx = i;
          return;
        }
      }
      // Start a fresh measurement
      this.activePts = [];
    }

    const pt = this.constrainPoint(p.x, p.y);
    this.activePts.push(pt);
    this.hoverPt = pt;
    this.host.requestRender();
    this.host.refreshUi();
  }

  move(p: Pt) {
    if (!this.pointerDown) {
      if (this.activePts.length > 0 && this.activePts.length < (this.host.app.settings.rulerMode === 'mixed' ? 3 : 2)) {
        this.hoverPt = this.constrainPoint(p.x, p.y);
        this.host.requestRender();
      }
      return;
    }
    this.dragMoved = true;

    const mode = this.host.app.settings.rulerMode;
    const order = this.host.app.settings.rulerMixedOrder;
    const ctx = this.getCoordCtx();

    if (this.dragVertexIdx >= 0) {
      const i = this.dragVertexIdx;
      if (mode === 'vertical') {
        if (i === 0) {
          const basePt = pickPlanePointAtZ(Math.round(p.x), Math.round(p.y), this.activePts[0].zPx, ctx, false);
          this.activePts[0] = basePt;
          this.activePts[1] = { wu: basePt.wu, wv: basePt.wv, zPx: this.activePts[1].zPx };
        } else {
          this.activePts[1] = pickVerticalPointFrom(this.activePts[0], p.y, ctx);
        }
      } else if (mode === 'horizontal') {
        const other = this.activePts[1 - i];
        this.activePts[i] = pickPlanePointAtZ(p.x, p.y, other.zPx, ctx, true, other);
      } else {
        if (order === 'flat_then_vert') {
          if (i === 0) {
            this.activePts[0] = pickPlanePointAtZ(p.x, p.y, this.activePts[1].zPx, ctx, true, this.activePts[1]);
          } else if (i === 1) {
            const nextB = pickPlanePointAtZ(p.x, p.y, this.activePts[0].zPx, ctx, true, this.activePts[0]);
            this.activePts[1] = nextB;
            this.activePts[2] = { wu: nextB.wu, wv: nextB.wv, zPx: this.activePts[2].zPx };
          } else {
            this.activePts[2] = pickVerticalPointFrom(this.activePts[1], p.y, ctx);
          }
        } else {
          if (i === 0) {
            const nextA = pickPlanePointAtZ(p.x, p.y, this.activePts[0].zPx, ctx, true);
            this.activePts[0] = nextA;
            this.activePts[1] = { wu: nextA.wu, wv: nextA.wv, zPx: this.activePts[1].zPx };
          } else if (i === 1) {
            const nextB = pickVerticalPointFrom(this.activePts[0], p.y, ctx);
            this.activePts[1] = nextB;
            // Keep B -> C strictly on horizontal plane z = B.zPx
            this.activePts[2] = { wu: this.activePts[2].wu, wv: this.activePts[2].wv, zPx: nextB.zPx };
          } else {
            this.activePts[2] = pickPlanePointAtZ(p.x, p.y, this.activePts[1].zPx, ctx, true, this.activePts[1]);
          }
        }
      }
      this.host.requestRender();
      this.host.refreshUi();
      return;
    }

    // Drag-to-measure convenience for 2-point modes
    if (mode !== 'mixed' && this.activePts.length === 1) {
      this.hoverPt = this.constrainPoint(p.x, p.y);
      this.host.requestRender();
    } else if (mode === 'mixed' && this.activePts.length > 0 && this.activePts.length < 3) {
      this.hoverPt = this.constrainPoint(p.x, p.y);
      this.host.requestRender();
    }
  }

  up(p: Pt) {
    this.pointerDown = false;
    this.dragVertexIdx = -1;
    this.ptsBeforeDown = null;
    const mode = this.host.app.settings.rulerMode;
    if (mode !== 'mixed' && this.activePts.length === 1 && this.dragMoved) {
      const endPt = this.constrainPoint(p.x, p.y);
      const [ax, ay] = this.projectPt(this.activePts[0]);
      const [bx, by] = this.projectPt(endPt);
      if (Math.hypot(bx - ax, by - ay) >= 2) {
        this.activePts.push(endPt);
        this.hoverPt = null;
      }
    }
    this.host.requestRender();
    this.host.refreshUi();
  }

  cancel() {
    this.pointerDown = false;
    this.dragVertexIdx = -1;
    this.hoverPt = null;
    if (this.ptsBeforeDown) {
      this.activePts = this.ptsBeforeDown;
      this.ptsBeforeDown = null;
    }
    this.host.requestRender();
    this.host.refreshUi();
  }

  getActiveSummary(): string {
    const mode = this.host.app.settings.rulerMode;
    const order = this.host.app.settings.rulerMixedOrder;
    const pts = this.activePts.map((pt) => this.projectPt(pt));
    if (mode === 'vertical') {
      if (pts.length < 2) return '竖直量尺：点击起点与终点（每 3px = 1.6m）';
      const r = measureVerticalMeters(pts[0][1], pts[1][1]);
      return `竖直高度: ${r.deltaPx.toFixed(0)} px = ${r.meters.toFixed(2)} m`;
    }
    if (mode === 'horizontal') {
      if (pts.length < 2) return '平面量尺：点击平面两点（1 格 32×16 = 9.6m）';
      const r = measureHorizontalPlane(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      return `平面距离: ${r.totalMeters.toFixed(2)} m (ΔU ${Math.abs(r.deltaU).toFixed(2)}格 · ΔV ${Math.abs(r.deltaV).toFixed(2)}格)`;
    }
    if (pts.length === 0) return '混合量尺 (1/3)：点击起点 A';
    if (pts.length === 1) return order === 'flat_then_vert' ? '混合量尺 (2/3)：点击平面拐点 B' : '混合量尺 (2/3)：点击竖直拐点 B';
    if (pts.length === 2) return order === 'flat_then_vert' ? '混合量尺 (3/3)：点击竖直终点 C' : '混合量尺 (3/3)：点击平面终点 C';
    const r = measureMixedPythagorean(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], order);
    return `混合总长: ${r.totalMeters.toFixed(2)} m = √(${r.flat.totalMeters.toFixed(2)}² + ${r.vert.meters.toFixed(2)}²) · 坡角 ${r.slopeDeg.toFixed(1)}°`;
  }

  private drawRulerGraphic(
    ctx: CanvasRenderingContext2D,
    toScreen: ToScreenFn,
    mode: RulerMode,
    order: MixedMeasureOrder,
    pts3D: RulerPoint3D[],
    isPreview: boolean,
  ) {
    if (pts3D.length === 0) return;
    const pts = pts3D.map((pt) => this.projectPt(pt));
    ctx.save();

    const drawNode = (pt: [number, number], label: string, color: string) => {
      const [sx, sy] = toScreen(pt[0], pt[1]);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (label) {
        ctx.font = '700 10px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2.5;
        ctx.strokeText(label, sx + 7, sy - 6);
        ctx.fillText(label, sx + 7, sy - 6);
      }
    };

    if (mode === 'vertical') {
      drawNode(pts[0], 'A', '#fbbf24');
      if (pts.length >= 2) {
        const [ax, ay] = toScreen(pts[0][0], pts[0][1]);
        const [bx, by] = toScreen(pts[1][0], pts[1][1]);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        if (isPreview) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.moveTo(ax - 7, ay);
        ctx.lineTo(ax + 7, ay);
        ctx.moveTo(bx - 7, by);
        ctx.lineTo(bx + 7, by);
        ctx.stroke();
        ctx.setLineDash([]);
        drawNode(pts[1], 'B', '#fbbf24');
        const r = measureVerticalMeters(pts[0][1], pts[1][1]);
        drawBadge(ctx, (ax + bx) * 0.5, (ay + by) * 0.5 - 12, `竖直: ${r.deltaPx.toFixed(0)}px = ${r.meters.toFixed(2)}m`, 'rgba(20,16,36,0.92)', '#fbbf24');
      }
      ctx.restore();
      return;
    }

    if (mode === 'horizontal') {
      drawNode(pts[0], 'A', '#22d3ee');
      if (pts.length >= 2) {
        const [ax, ay] = toScreen(pts[0][0], pts[0][1]);
        const [bx, by] = toScreen(pts[1][0], pts[1][1]);
        const r = measureHorizontalPlane(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);

        // U/V component decomposition dashed lines
        const { originX, originY } = this.host.app.doc.getViewOrigin();
        const zRef = pts3D[0].zPx;
        const [au, av] = screenPxToIsoAtZ(pts[0][0], pts[0][1], zRef, originX, originY);
        const [midX, midY] = isoToScreenPx(au + r.deltaU, av, zRef, originX, originY);
        const [smx, smy] = toScreen(midX, midY);

        ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(smx, smy);
        ctx.lineTo(bx, by);
        ctx.stroke();

        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        if (!isPreview) ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);

        drawNode(pts[1], 'B', '#22d3ee');
        drawBadge(
          ctx,
          (ax + bx) * 0.5,
          (ay + by) * 0.5 - 14,
          `平面: ${r.totalMeters.toFixed(2)}m (U:${Math.abs(r.deltaU).toFixed(2)}格 V:${Math.abs(r.deltaV).toFixed(2)}格)`,
          'rgba(20,16,36,0.92)',
          '#22d3ee',
        );
      }
      ctx.restore();
      return;
    }

    // Mixed 3-point Pythagorean triangle
    drawNode(pts[0], 'A', '#22d3ee');
    if (pts.length >= 2) {
      const [ax, ay] = toScreen(pts[0][0], pts[0][1]);
      const [bx, by] = toScreen(pts[1][0], pts[1][1]);
      const firstIsFlat = order === 'flat_then_vert';
      ctx.strokeStyle = firstIsFlat ? '#22d3ee' : '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      drawNode(pts[1], 'B', firstIsFlat ? '#22d3ee' : '#fbbf24');

      if (pts.length === 2) {
        if (firstIsFlat) {
          const rf = measureHorizontalPlane(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
          drawBadge(ctx, (ax + bx) * 0.5, (ay + by) * 0.5 - 12, `平: ${rf.totalMeters.toFixed(2)}m`, 'rgba(20,16,36,0.9)', '#22d3ee');
        } else {
          const rv = measureVerticalMeters(pts[0][1], pts[1][1]);
          drawBadge(ctx, (ax + bx) * 0.5, (ay + by) * 0.5 - 12, `竖: ${rv.meters.toFixed(2)}m`, 'rgba(20,16,36,0.9)', '#fbbf24');
        }
      }

      if (pts.length >= 3) {
        const [cx, cy] = toScreen(pts[2][0], pts[2][1]);
        const r = measureMixedPythagorean(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], order);

        // Second leg B->C
        ctx.strokeStyle = firstIsFlat ? '#fbbf24' : '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Hypotenuse A->C
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.25;
        if (isPreview) ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        drawNode(pts[2], 'C', '#4ade80');

        // Edge labels
        const flatMid = firstIsFlat ? [(ax + bx) * 0.5, (ay + by) * 0.5] : [(bx + cx) * 0.5, (by + cy) * 0.5];
        const vertMid = firstIsFlat ? [(bx + cx) * 0.5, (by + cy) * 0.5] : [(ax + bx) * 0.5, (ay + by) * 0.5];
        drawBadge(ctx, flatMid[0], flatMid[1] + 14, `平 ${r.flat.totalMeters.toFixed(2)}m`, 'rgba(20,16,36,0.88)', '#22d3ee');
        drawBadge(ctx, vertMid[0] + 34, vertMid[1], `竖 ${r.vert.meters.toFixed(2)}m`, 'rgba(20,16,36,0.88)', '#fbbf24');
        drawBadge(
          ctx,
          (ax + cx) * 0.5,
          (ay + cy) * 0.5 - 16,
          `混合: ${r.totalMeters.toFixed(2)}m (${r.slopeDeg.toFixed(1)}°)`,
          'rgba(10, 24, 18, 0.94)',
          '#4ade80',
        );
      }
    }
    ctx.restore();
  }

  drawPinnedOverlay(ctx: CanvasRenderingContext2D, toScreen: ToScreenFn) {
    for (const pin of this.host.app.pinnedRulers) {
      this.drawRulerGraphic(ctx, toScreen, pin.mode, pin.order, pin.pts, false);
    }
  }

  overlay(ctx: CanvasRenderingContext2D, toScreen: ToScreenFn) {
    const mode = this.host.app.settings.rulerMode;
    const order = this.host.app.settings.rulerMixedOrder;
    const reqCount = mode === 'mixed' ? 3 : 2;
    const previewPts =
      this.activePts.length > 0 && this.activePts.length < reqCount && this.hoverPt
        ? [...this.activePts, this.hoverPt]
        : this.activePts;
    if (previewPts.length > 0) {
      this.drawRulerGraphic(
        ctx,
        toScreen,
        mode,
        order,
        previewPts,
        this.activePts.length < reqCount,
      );
    }
  }
}
