// Interactive canvas tools: Select/3D Gizmo, Drag-Create Shape, and Hand Pan
import type { App } from '../app';
import { buildArchCrossSection, getArchSampleCount } from './arch';
import { clamp } from './color';
import {
  evaluateColumnSectionRing,
  hasActiveColumnSections,
  isPolygonalColumnShape,
  normalizeColumnSections,
  syncColumnTransitionSections,
} from './columnSections';
import type { BuilderLayer, PlotFrameConfig } from './document';
import {
  cellsToMeters,
  isoToScreenPx,
  normalizeRotation,
  screenPxToIsoAtZ,
  snapGridValue,
  viewBoxToWorld,
  worldBoxToView,
  zPxToMeters,
} from './isoMath';
import {
  cloneShape,
  getPlanarFaceScreenOverlay,
  getShapeScreenBounds,
  renderShapeToBuffer,
  transformLocalToViewPoint,
  type ParametricShape,
} from './isoRenderer';
import { getPlanarFacesForShape, isPlanarTextureShape } from './textures';
import {
  computeColumnRefRadiusMetric,
  normalizeLoftSections,
  sampleClosedSectionUniform,
  sampleSectionInnerUniform,
  syncLoftTransitionSections,
} from './loft';

export interface Pt {
  x: number;
  y: number;
  pointerType?: string;
}

export type ToScreenFn = (x: number, y: number) => [number, number];

export interface ToolHost {
  app: App;
  scale: () => number;
  requestRender: () => void;
  toast: (msg: string) => void;
  refreshUi: () => void;
}

export interface Tool {
  down(p: Pt): void;
  move(p: Pt): void;
  up(p: Pt): void;
  cancel(): void;
  overlay?(ctx: CanvasRenderingContext2D, toScreen: ToScreenFn): void;
}

export function drawBadge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  bg = 'rgba(20, 16, 36, 0.90)',
  border = '#a855f7',
  fg = '#f8fafc',
) {
  ctx.save();
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const padX = 7;
  const h = 20;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const bx = Math.round(sx - w / 2);
  const by = Math.round(sy - h / 2);

  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5);
  ctx.restore();
}

function drawScreenDiamond(
  ctx: CanvasRenderingContext2D,
  toScreen: ToScreenFn,
  vu: number,
  vv: number,
  vsu: number,
  vsv: number,
  zPx: number,
  originX: number,
  originY: number,
): [number, number][] {
  const pts = [
    isoToScreenPx(vu, vv, zPx, originX, originY),
    isoToScreenPx(vu + vsu, vv, zPx, originX, originY),
    isoToScreenPx(vu + vsu, vv + vsv, zPx, originX, originY),
    isoToScreenPx(vu, vv + vsv, zPx, originX, originY),
  ].map(([x, y]) => toScreen(x, y));

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.lineTo(pts[3][0], pts[3][1]);
  ctx.closePath();
  return pts;
}

// ---------------- Select & 3D Gizmo Tool ----------------

type GizmoHandle =
  | 'none'
  | 'move'
  | 'height'
  | 'z_lift'
  | 'edge_umin'
  | 'edge_umax'
  | 'edge_vmin'
  | 'edge_vmax'
  | `loft_sec:${string}`
  | `col_sec:${string}`;

export class SelectGizmoTool implements Tool {
  private dragHandle: GizmoHandle = 'none';
  private dragStart: [number, number] = [0, 0];
  private origShape: ParametricShape | null = null;
  private origViewBox: { u: number; v: number; sizeU: number; sizeV: number; ori: 0 | 1 | 2 | 3 } | null = null;
  private origActive = 0;
  private origLayers: BuilderLayer[] = [];
  private historyPushed = false;
  private targetLayer: BuilderLayer | null = null;

  constructor(private host: ToolHost) {}

  get isDragging(): boolean {
    return this.dragHandle !== 'none';
  }

  private hitTestShapeLayer(px: number, py: number): number {
    const d = this.host.app.doc;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const tol = Math.max(1, Math.round(4 / Math.max(1, this.host.scale())));
    for (let li = d.layers.length - 1; li >= 0; li--) {
      const l = d.layers[li];
      if (!l.visible || l.locked || l.kind !== 'shape') continue;
      for (let dy = -tol; dy <= tol; dy++) {
        const y = iy + dy;
        if (y < 0 || y >= d.height) continue;
        for (let dx = -tol; dx <= tol; dx++) {
          const x = ix + dx;
          if (x < 0 || x >= d.width) continue;
          if (l.data[(y * d.width + x) * 4 + 3] > 0) return li;
        }
      }
    }
    return -1;
  }

  private getGizmoPoints(l: BuilderLayer) {
    const d = this.host.app.doc;
    const s = l.shape!;
    const { originX, originY } = d.getViewOrigin();
    const vb = worldBoxToView(s.u, s.v, s.sizeU, s.sizeV, s.ori, d.plotU, d.plotV, d.viewRotation);
    const z0 = s.zPx;
    const z1 = s.zPx + s.heightPx;

    const topCenter = isoToScreenPx(vb.u + vb.sizeU * 0.5, vb.v + vb.sizeV * 0.5, z1, originX, originY);
    const zLiftAnchor = isoToScreenPx(vb.u + vb.sizeU, vb.v, z0 + s.heightPx * 0.5, originX, originY);
    const zLiftHandle: [number, number] = [zLiftAnchor[0] + 10 / Math.max(1, this.host.scale() * 0.25), zLiftAnchor[1]];

    const edgeUMin = isoToScreenPx(vb.u, vb.v + vb.sizeV * 0.5, z0, originX, originY);
    const edgeUMax = isoToScreenPx(vb.u + vb.sizeU, vb.v + vb.sizeV * 0.5, z0, originX, originY);
    const edgeVMin = isoToScreenPx(vb.u + vb.sizeU * 0.5, vb.v, z0, originX, originY);
    const edgeVMax = isoToScreenPx(vb.u + vb.sizeU * 0.5, vb.v + vb.sizeV, z0, originX, originY);

    return { vb, originX, originY, topCenter, zLiftHandle, edgeUMin, edgeUMax, edgeVMin, edgeVMax };
  }

  private getLoftSectionHandles(l: BuilderLayer): { id: string; name: string; t: number; pos: [number, number] }[] {
    const s = l.shape;
    if (!s || s.shapeType !== 'loft' || s.heightPx <= 0) return [];
    const d = this.host.app.doc;
    const { originX, originY } = d.getViewOrigin();
    const vb = worldBoxToView(s.u, s.v, s.sizeU, s.sizeV, s.ori, d.plotU, d.plotV, d.viewRotation);
    const secs = normalizeLoftSections(s.loftSections);
    const shiftX = 10 / Math.max(1, this.host.scale() * 0.25);
    return secs.map((sec) => {
      const zSec = s.zPx + sec.t * s.heightPx;
      const anchor = isoToScreenPx(vb.u, vb.v + vb.sizeV, zSec, originX, originY);
      return {
        id: sec.id,
        name: sec.name,
        t: sec.t,
        pos: [anchor[0] - shiftX, anchor[1]],
      };
    });
  }

  private getColumnSectionHandles(l: BuilderLayer): { id: string; name: string; t: number; pos: [number, number] }[] {
    const s = l.shape;
    if (!s || !hasActiveColumnSections(s) || s.heightPx <= 0) return [];
    const d = this.host.app.doc;
    const { originX, originY } = d.getViewOrigin();
    const vb = worldBoxToView(s.u, s.v, s.sizeU, s.sizeV, s.ori, d.plotU, d.plotV, d.viewRotation);
    const secs = normalizeColumnSections(s.colSections, s.shapeType, s.prismSides);
    const shiftX = 10 / Math.max(1, this.host.scale() * 0.25);
    return secs.map((sec) => {
      const zSec = s.zPx + sec.t * s.heightPx;
      const anchor = isoToScreenPx(vb.u, vb.v + vb.sizeV, zSec, originX, originY);
      return {
        id: sec.id,
        name: sec.name,
        t: sec.t,
        pos: [anchor[0] - shiftX, anchor[1]],
      };
    });
  }

  private hitHandle(p: Pt, l: BuilderLayer): GizmoHandle {
    if (l.kind !== 'shape' || !l.shape) return 'none';
    const pts = this.getGizmoPoints(l);
    const tol = 14 / this.host.scale();
    const near = (pt: [number, number], r = tol) => Math.hypot(p.x - pt[0], p.y - pt[1]) <= r;

    if (l.shape.shapeType === 'loft') {
      const secHandles = this.getLoftSectionHandles(l);
      for (const sh of secHandles) {
        if (near(sh.pos, tol)) {
          return `loft_sec:${sh.id}`;
        }
      }
    } else if (hasActiveColumnSections(l.shape)) {
      const colHandles = this.getColumnSectionHandles(l);
      for (const ch of colHandles) {
        if (near(ch.pos, tol)) {
          return `col_sec:${ch.id}`;
        }
      }
    }

    if (l.shape.shapeType !== 'theotown_base' && near(pts.topCenter, tol * 1.15)) return 'height';
    if (near(pts.zLiftHandle, tol * 1.1)) return 'z_lift';
    if (near(pts.edgeUMax, tol)) return 'edge_umax';
    if (near(pts.edgeVMax, tol)) return 'edge_vmax';
    if (near(pts.edgeUMin, tol)) return 'edge_umin';
    if (near(pts.edgeVMin, tol)) return 'edge_vmin';

    // Check if pointer is inside footprint at z0 or z1 or opaque pixels of this layer
    const d = this.host.app.doc;
    const ix = Math.floor(p.x);
    const iy = Math.floor(p.y);
    if (ix >= 0 && iy >= 0 && ix < d.width && iy < d.height) {
      if (l.data[(iy * d.width + ix) * 4 + 3] > 0) return 'move';
    }
    const [iu, iv] = screenPxToIsoAtZ(p.x, p.y, l.shape.zPx, pts.originX, pts.originY);
    if (iu >= pts.vb.u && iu <= pts.vb.u + pts.vb.sizeU && iv >= pts.vb.v && iv <= pts.vb.v + pts.vb.sizeV) {
      return 'move';
    }
    return 'none';
  }

  down(p: Pt) {
    const app = this.host.app;
    const d = app.doc;
    this.origActive = d.active;
    this.origLayers = [...d.layers];
    const cur = d.layer;

    if (cur && cur.visible && !cur.locked && cur.kind === 'shape' && cur.shape) {
      const h = this.hitHandle(p, cur);
      if (h !== 'none') {
        this.beginDrag(cur, h, p);
        return;
      }
    }

    const hitIdx = this.hitTestShapeLayer(p.x, p.y);
    if (hitIdx >= 0) {
      d.active = hitIdx;
      const hitLayer = d.layers[hitIdx];
      this.host.refreshUi();
      this.beginDrag(hitLayer, 'move', p);
      return;
    }

    this.dragHandle = 'none';
    this.targetLayer = null;
    this.origLayers = [];
  }

  private beginDrag(l: BuilderLayer, handle: GizmoHandle, p: Pt) {
    const d = this.host.app.doc;
    const s = l.shape!;
    this.targetLayer = l;
    this.dragHandle = handle;
    this.dragStart = [p.x, p.y];
    this.origShape = cloneShape(s);
    const vb = worldBoxToView(s.u, s.v, s.sizeU, s.sizeV, s.ori, d.plotU, d.plotV, d.viewRotation);
    this.origViewBox = { u: vb.u, v: vb.v, sizeU: vb.sizeU, sizeV: vb.sizeV, ori: vb.ori };
    this.historyPushed = false;
    if (handle.startsWith('loft_sec:')) {
      s.activeLoftSectionId = handle.slice('loft_sec:'.length);
      this.host.refreshUi();
    } else if (handle.startsWith('col_sec:')) {
      s.activeColSectionId = handle.slice('col_sec:'.length);
      this.host.refreshUi();
    }
  }

  move(p: Pt) {
    if (!this.targetLayer || !this.targetLayer.shape || !this.origShape || !this.origViewBox || this.dragHandle === 'none') {
      return;
    }
    const app = this.host.app;
    const d = app.doc;
    const s = this.targetLayer.shape;

    if (!this.historyPushed) {
      if (Math.hypot(p.x - this.dragStart[0], p.y - this.dragStart[1]) * this.host.scale() < 2) return;
      app.pushHistory(`编辑 ${this.targetLayer.name}`);
      this.historyPushed = true;
    }

    const isBase = s.shapeType === 'theotown_base';
    const snap = isBase ? Math.max(1, Math.round(app.getSnapStep())) : app.getSnapStep();
    const minSize = isBase ? 1 : Math.max(0.25, snap >= 1 ? 1 : snap);
    const { originX, originY } = d.getViewOrigin();

    if (this.dragHandle.startsWith('loft_sec:')) {
      const secId = this.dragHandle.slice('loft_sec:'.length);
      const origSec = this.origShape.loftSections?.find((sec) => sec.id === secId);
      const targetSec = s.loftSections?.find((sec) => sec.id === secId);
      if (origSec && targetSec && this.origShape.heightPx > 0) {
        const dy = p.y - this.dragStart[1];
        targetSec.t = clamp(Math.round((origSec.t - dy / this.origShape.heightPx) * 100) / 100, 0, 1);
        s.activeLoftSectionId = secId;
        const ori = normalizeRotation(s.ori);
        const lsu = ori % 2 === 1 ? s.sizeV : s.sizeU;
        const lsv = ori % 2 === 1 ? s.sizeU : s.sizeV;
        if (s.loftSections) syncLoftTransitionSections(s.loftSections, lsu, lsv);
      }
    } else if (this.dragHandle.startsWith('col_sec:')) {
      const secId = this.dragHandle.slice('col_sec:'.length);
      const origSec = this.origShape.colSections?.find((sec) => sec.id === secId);
      const targetSec = s.colSections?.find((sec) => sec.id === secId);
      if (origSec && targetSec && this.origShape.heightPx > 0) {
        const dy = p.y - this.dragStart[1];
        targetSec.t = clamp(Math.round((origSec.t - dy / this.origShape.heightPx) * 100) / 100, 0, 1);
        s.activeColSectionId = secId;
        syncColumnTransitionSections(s);
      }
    } else if (this.dragHandle === 'height') {
      const dy = p.y - this.dragStart[1];
      s.heightPx = clamp(Math.round(this.origShape.heightPx - dy), 1, 1024);
    } else if (this.dragHandle === 'z_lift' || (this.dragHandle === 'move' && app.settings.selectDragMode === 'vertical_z')) {
      const dy = p.y - this.dragStart[1];
      s.zPx = clamp(Math.round(this.origShape.zPx - dy), 0, 1024);
    } else {
      const [uStart, vStart] = screenPxToIsoAtZ(this.dragStart[0], this.dragStart[1], this.origShape.zPx, originX, originY);
      const [uNow, vNow] = screenPxToIsoAtZ(p.x, p.y, this.origShape.zPx, originX, originY);
      const du = uNow - uStart;
      const dv = vNow - vStart;

      let vu = this.origViewBox.u;
      let vv = this.origViewBox.v;
      let vsu = this.origViewBox.sizeU;
      let vsv = this.origViewBox.sizeV;

      if (this.dragHandle === 'move') {
        vu = snapGridValue(vu + du, snap);
        vv = snapGridValue(vv + dv, snap);
      } else if (this.dragHandle === 'edge_umax') {
        vsu = Math.max(minSize, snapGridValue(vsu + du, snap));
      } else if (this.dragHandle === 'edge_vmax') {
        vsv = Math.max(minSize, snapGridValue(vsv + dv, snap));
      } else if (this.dragHandle === 'edge_umin') {
        const nextU = Math.min(vu + vsu - minSize, snapGridValue(vu + du, snap));
        vsu = Math.max(minSize, Math.round((vu + vsu - nextU) * 10000) / 10000);
        vu = nextU;
      } else if (this.dragHandle === 'edge_vmin') {
        const nextV = Math.min(vv + vsv - minSize, snapGridValue(vv + dv, snap));
        vsv = Math.max(minSize, Math.round((vv + vsv - nextV) * 10000) / 10000);
        vv = nextV;
      }

      const wb = viewBoxToWorld(vu, vv, vsu, vsv, this.origViewBox.ori, d.plotU, d.plotV, d.viewRotation);
      s.u = wb.u;
      s.v = wb.v;
      s.sizeU = isBase ? Math.max(1, Math.round(wb.sizeU)) : wb.sizeU;
      s.sizeV = isBase ? Math.max(1, Math.round(wb.sizeV)) : wb.sizeV;
      s.ori = wb.ori;

      if (this.dragHandle === 'move' && app.settings.autoStackSnap && !isBase) {
        const wf = d.getShapeWorldFootprint(s);
        s.zPx = d.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0, this.targetLayer.id);
      }
    }

    d.rerenderShapeLayer(this.targetLayer);
    if (app.settings.autoSortOnEdit) {
      d.sortLayersByIsoDepth();
    }
    app.emit('doc_live');
  }

  up(_p: Pt) {
    const app = this.host.app;
    const d = app.doc;
    const changed = this.historyPushed;
    this.dragHandle = 'none';
    this.targetLayer = null;
    this.origShape = null;
    this.origViewBox = null;
    this.origLayers = [];
    this.historyPushed = false;
    if (changed) {
      if (app.settings.autoSortOnEdit) {
        d.sortLayersByIsoDepth();
      }
      app.emit('doc');
      app.emit('layers');
    } else {
      this.host.requestRender();
    }
  }

  cancel() {
    if (this.dragHandle === 'none' && !this.targetLayer) return;
    const app = this.host.app;
    const d = app.doc;
    if (this.targetLayer && this.origShape) {
      if (this.targetLayer.shape) {
        this.targetLayer.shape = cloneShape(this.origShape);
      }
      d.rerenderShapeLayer(this.targetLayer);
    }
    if (this.origLayers.length > 0) {
      d.layers = [...this.origLayers];
    }
    d.active = Math.max(0, Math.min(this.origActive, d.layers.length - 1));
    if (this.historyPushed) {
      app.history.discardLast();
      app.emit('history');
    }
    this.dragHandle = 'none';
    this.targetLayer = null;
    this.origShape = null;
    this.origViewBox = null;
    this.origLayers = [];
    this.historyPushed = false;
    this.host.refreshUi();
    this.host.requestRender();
  }

  overlay(ctx: CanvasRenderingContext2D, toScreen: ToScreenFn) {
    const d = this.host.app.doc;
    const l = d.layer;
    if (!l || l.kind !== 'shape' || !l.shape || !l.visible) return;
    const s = l.shape;
    const { vb, originX, originY, topCenter, zLiftHandle, edgeUMin, edgeUMax, edgeVMin, edgeVMax } =
      this.getGizmoPoints(l);

    ctx.save();
    // Bottom diamond
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    const botPts = drawScreenDiamond(ctx, toScreen, vb.u, vb.v, vb.sizeU, vb.sizeV, s.zPx, originX, originY);
    ctx.stroke();

    if (s.shapeType !== 'theotown_base' && s.heightPx > 0) {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
      const topPts = drawScreenDiamond(ctx, toScreen, vb.u, vb.v, vb.sizeU, vb.sizeV, s.zPx + s.heightPx, originX, originY);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(botPts[i][0], botPts[i][1]);
        ctx.lineTo(topPts[i][0], topPts[i][1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const drawDot = (pt: [number, number], fill: string, r = 5, diamond = false) => {
      const [sx, sy] = toScreen(pt[0], pt[1]);
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (diamond) {
        ctx.moveTo(sx, sy - r - 1);
        ctx.lineTo(sx + r + 1, sy);
        ctx.lineTo(sx, sy + r + 1);
        ctx.lineTo(sx - r - 1, sy);
        ctx.closePath();
      } else {
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    };

    // Footprint edge resize handles
    for (const pt of [edgeUMin, edgeUMax, edgeVMin, edgeVMax]) {
      drawDot(pt, '#38bdf8', 4.5, false);
    }

    // Z lift handle
    drawDot(zLiftHandle, '#22d3ee', 5, false);

    // Height handle (amber diamond)
    if (s.shapeType !== 'theotown_base') {
      drawDot(topCenter, '#fbbf24', 5.5, true);
      const [hx, hy] = toScreen(topCenter[0], topCenter[1]);
      drawBadge(
        ctx,
        hx,
        hy - 18,
        `${s.sizeU}×${s.sizeV}格 (${cellsToMeters(s.sizeU).toFixed(1)}×${cellsToMeters(s.sizeV).toFixed(1)}m) · H ${s.heightPx}px (${zPxToMeters(s.heightPx).toFixed(2)}m)`,
        'rgba(20, 16, 36, 0.92)',
        '#fbbf24',
      );
    } else {
      const [hx, hy] = toScreen(topCenter[0], topCenter[1]);
      drawBadge(
        ctx,
        hx,
        hy - 16,
        `底座 ${s.sizeU}×${s.sizeV}格 (${cellsToMeters(s.sizeU).toFixed(1)}×${cellsToMeters(s.sizeV).toFixed(1)}m)`,
      );
    }

    // 3D Control-section wireframe loops & elevation handles for 'loft'
    if (s.shapeType === 'loft' && s.heightPx > 0) {
      const secs = normalizeLoftSections(s.loftSections);
      const activeId = s.activeLoftSectionId ?? secs[secs.length - 1]?.id;
      const handles = this.getLoftSectionHandles(l);
      const handleById = new Map(handles.map((hh) => [hh.id, hh]));

      const oddVb = vb.ori % 2 === 1;
      const lsu = oddVb ? vb.sizeV : vb.sizeU;
      const lsv = oddVb ? vb.sizeU : vb.sizeV;
      const colRefR = s.loftHollow ? computeColumnRefRadiusMetric(secs, lsu, lsv) : undefined;

      for (const sec of secs) {
        const isAct = sec.id === activeId;
        const zSec = s.zPx + sec.t * s.heightPx;
        const pts = sampleClosedSectionUniform(sec, 48, true);
        if (pts.length >= 3) {
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const pt3 = transformLocalToViewPoint(pts[i][0], pts[i][1], zSec, vb.u, vb.v, vb.sizeU, vb.sizeV, vb.ori);
            const iso = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
            const sc = toScreen(iso[0], iso[1]);
            if (i === 0) ctx.moveTo(sc[0], sc[1]);
            else ctx.lineTo(sc[0], sc[1]);
          }
          ctx.closePath();
          ctx.strokeStyle = isAct ? '#34d399' : 'rgba(192, 132, 252, 0.72)';
          ctx.lineWidth = isAct ? 2 : 1.2;
          ctx.setLineDash(isAct ? [] : [4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (s.loftHollow) {
          const inPts = sampleSectionInnerUniform(sec, 40, true, lsu, lsv, colRefR);
          if (inPts.length >= 3) {
            ctx.beginPath();
            for (let i = 0; i < inPts.length; i++) {
              const pt3 = transformLocalToViewPoint(inPts[i][0], inPts[i][1], zSec, vb.u, vb.v, vb.sizeU, vb.sizeV, vb.ori);
              const iso = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
              const sc = toScreen(iso[0], iso[1]);
              if (i === 0) ctx.moveTo(sc[0], sc[1]);
              else ctx.lineTo(sc[0], sc[1]);
            }
            ctx.closePath();
            ctx.strokeStyle = isAct ? '#38bdf8' : 'rgba(56, 189, 248, 0.55)';
            ctx.lineWidth = isAct ? 1.8 : 1.1;
            ctx.setLineDash(isAct ? [5, 3] : [3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        const hh = handleById.get(sec.id);
        if (hh) {
          drawDot(hh.pos, isAct ? '#34d399' : '#c084fc', isAct ? 5.5 : 4.2, true);
          if (isAct && this.dragHandle === `loft_sec:${sec.id}`) {
            const [sx, sy] = toScreen(hh.pos[0], hh.pos[1]);
            drawBadge(
              ctx,
              sx - 44,
              sy,
              `${sec.name} ${Math.round(sec.t * 100)}% (${Math.round(sec.t * s.heightPx)}px)`,
              'rgba(16, 28, 24, 0.94)',
              '#34d399',
            );
          }
        }
      }
    }

    // 3D Control-section wireframe loops & elevation handles for polygonal/cylinder columns
    if (hasActiveColumnSections(s) && s.heightPx > 0) {
      const secs = normalizeColumnSections(s.colSections, s.shapeType, s.prismSides);
      const activeId = s.activeColSectionId ?? secs[secs.length - 1]?.id;
      const handles = this.getColumnSectionHandles(l);
      const handleById = new Map(handles.map((hh) => [hh.id, hh]));
      const isPoly = isPolygonalColumnShape(s);

      for (const sec of secs) {
        const isAct = sec.id === activeId;
        const zSec = s.zPx + sec.t * s.heightPx;
        const pts = evaluateColumnSectionRing(sec, 32);
        if (pts.length >= 3) {
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const pt3 = transformLocalToViewPoint(pts[i][0], pts[i][1], zSec, vb.u, vb.v, vb.sizeU, vb.sizeV, vb.ori);
            const iso = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
            const sc = toScreen(iso[0], iso[1]);
            if (i === 0) ctx.moveTo(sc[0], sc[1]);
            else ctx.lineTo(sc[0], sc[1]);
          }
          ctx.closePath();
          ctx.strokeStyle = isAct ? '#34d399' : 'rgba(192, 132, 252, 0.72)';
          ctx.lineWidth = isAct ? 2 : 1.2;
          ctx.setLineDash(isAct ? [] : [4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          if (isAct && isPoly && sec.edges.length === pts.length) {
            const nE = pts.length;
            for (let ei = 0; ei < nE; ei++) {
              if (!sec.edges[ei].locked) continue;
              const aPt = pts[ei];
              const bPt = pts[(ei + 1) % nE];
              const p3a = transformLocalToViewPoint(aPt[0], aPt[1], zSec, vb.u, vb.v, vb.sizeU, vb.sizeV, vb.ori);
              const p3b = transformLocalToViewPoint(bPt[0], bPt[1], zSec, vb.u, vb.v, vb.sizeU, vb.sizeV, vb.ori);
              const sa = toScreen(...isoToScreenPx(p3a.x, p3a.y, p3a.z, originX, originY));
              const sb = toScreen(...isoToScreenPx(p3b.x, p3b.y, p3b.z, originX, originY));
              ctx.beginPath();
              ctx.moveTo(sa[0], sa[1]);
              ctx.lineTo(sb[0], sb[1]);
              ctx.strokeStyle = '#f59e0b';
              ctx.lineWidth = 3;
              ctx.stroke();
            }
          }
        }

        const hh = handleById.get(sec.id);
        if (hh) {
          drawDot(hh.pos, isAct ? '#34d399' : '#c084fc', isAct ? 5.5 : 4.2, true);
          if (isAct && this.dragHandle === `col_sec:${sec.id}`) {
            const [sx, sy] = toScreen(hh.pos[0], hh.pos[1]);
            drawBadge(
              ctx,
              sx - 44,
              sy,
              `${sec.name} ${Math.round(sec.t * 100)}% (${Math.round(sec.t * s.heightPx)}px)`,
              'rgba(16, 28, 24, 0.94)',
              '#34d399',
            );
          }
        }
      }
    }

    // 3D Arch profile wireframe on front & back faces for 'arch'
    if (s.shapeType === 'arch' && s.heightPx > 0) {
      const z0 = Math.round(s.zPx);
      const heightPx = Math.max(1, Math.round(s.heightPx));
      const spanCells = vb.ori % 2 === 1 ? vb.sizeV : vb.sizeU;
      const spanMetric = Math.max(4, spanCells * 18);
      const heightMetric = Math.max(4, heightPx);
      const cs = buildArchCrossSection({
        outerNodes: s.archNodes,
        hollow: s.archHollow ?? false,
        hollowStyle: s.archHollowStyle ?? 'shell',
        innerMode: s.archInnerMode ?? 'parallel',
        thickness: s.archThickness ?? 0.28,
        innerNodes: s.archInnerNodes,
        spanMetric,
        heightMetric,
        sampleCount: getArchSampleCount(spanMetric, heightMetric),
      });
      const lvFront = vb.ori === 0 || vb.ori === 3 ? 1 : 0;
      const lvBack = 1 - lvFront;
      for (const [lv, isFront] of [
        [lvBack, false],
        [lvFront, true],
      ] as [number, boolean][]) {
        if (cs.poly.length < 3) continue;
        ctx.beginPath();
        for (let i = 0; i < cs.poly.length; i++) {
          const [ps, ph] = cs.poly[i];
          const pt3 = transformLocalToViewPoint(ps, lv, z0 + ph * heightPx, vb.u, vb.v, vb.sizeU, vb.sizeV, vb.ori);
          const iso = isoToScreenPx(pt3.x, pt3.y, pt3.z, originX, originY);
          const sc = toScreen(iso[0], iso[1]);
          if (i === 0) ctx.moveTo(sc[0], sc[1]);
          else ctx.lineTo(sc[0], sc[1]);
        }
        ctx.closePath();
        ctx.strokeStyle = isFront ? '#34d399' : 'rgba(56, 189, 248, 0.48)';
        ctx.lineWidth = isFront ? 1.8 : 1.1;
        ctx.setLineDash(isFront ? [] : [4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Highlight active target planar face when editing textures in "材质与纹理" tab
    if (this.host.app.rightTab === 'material' && isPlanarTextureShape(s) && s.heightPx > 0) {
      const faceId = this.host.app.getActiveFaceId(l.id, s);
      if (faceId) {
        const ov = getPlanarFaceScreenOverlay(s, faceId, d.plotU, d.plotV, d.viewRotation, originX, originY);
        if (ov && ov.screenVerts.length >= 3) {
          const pts = ov.screenVerts.map(([px, py]) => toScreen(px, py));
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
            else ctx.lineTo(pts[i][0], pts[i][1]);
          }
          ctx.closePath();
          if (ov.visible) {
            ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
            ctx.fill();
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.72)';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([4, 3]);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          const spec = getPlanarFacesForShape(s).find((f) => f.id === faceId);
          if (spec) {
            let cx = 0, cy = 0;
            for (const [px, py] of pts) { cx += px; cy += py; }
            cx /= pts.length;
            cy /= pts.length;
            drawBadge(
              ctx,
              cx,
              cy,
              `${spec.shortLabel}${ov.visible ? '' : ' (背面)'}`,
              'rgba(10, 24, 34, 0.90)',
              '#22d3ee',
              '#67e8f9',
            );
          }
        }
      }
    }

    ctx.restore();
  }
}

// ---------------- Drag-Create Isometric Shape Tool ----------------

export class CreateShapeTool implements Tool {
  private dragging = false;
  private startVu = 0;
  private startVv = 0;
  private curVu = 0;
  private curVv = 0;
  private startScreen: [number, number] = [0, 0];
  private nowScreen: [number, number] = [0, 0];
  private baseZ = 0;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewImgData: ImageData | null = null;
  private prevDirty: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private host: ToolHost) {}

  get isDragging(): boolean {
    return this.dragging;
  }

  private getCurrentViewBox() {
    const app = this.host.app;
    const isBase = app.createPreset.shapeType === 'theotown_base';
    const snap = isBase ? Math.max(1, Math.round(app.getSnapStep())) : app.getSnapStep();
    const isTinyTap = Math.hypot(this.nowScreen[0] - this.startScreen[0], this.nowScreen[1] - this.startScreen[1]) * this.host.scale() < 6;
    if (isTinyTap) {
      const rawU = isBase
        ? Math.max(1, Math.round(app.createPreset.sizeU || 1))
        : Math.max(snap >= 1 ? 1 : snap, app.createPreset.sizeU || 1);
      const rawV = isBase
        ? Math.max(1, Math.round(app.createPreset.sizeV || 1))
        : Math.max(snap >= 1 ? 1 : snap, app.createPreset.sizeV || 1);
      const odd = app.doc.viewRotation % 2 === 1;
      const su = odd ? rawV : rawU;
      const sv = odd ? rawU : rawV;
      const u = snapGridValue(this.startVu - su * 0.5, snap);
      const v = snapGridValue(this.startVv - sv * 0.5, snap);
      return { vu: u, vv: v, vsu: su, vsv: sv, isTinyTap: true };
    }
    const minSize = isBase ? 1 : Math.max(0.25, snap >= 1 ? 1 : snap);
    const u0 = snapGridValue(Math.min(this.startVu, this.curVu), snap);
    const v0 = snapGridValue(Math.min(this.startVv, this.curVv), snap);
    const u1 = snapGridValue(Math.max(this.startVu, this.curVu), snap);
    const v1 = snapGridValue(Math.max(this.startVv, this.curVv), snap);
    return {
      vu: u0,
      vv: v0,
      vsu: Math.max(minSize, Math.round((u1 - u0) * 10000) / 10000),
      vsv: Math.max(minSize, Math.round((v1 - v0) * 10000) / 10000),
      isTinyTap: false,
    };
  }

  down(p: Pt) {
    const app = this.host.app;
    const d = app.doc;
    const { originX, originY } = d.getViewOrigin();
    const [vu, vv] = screenPxToIsoAtZ(p.x, p.y, 0, originX, originY);
    const isBase = app.createPreset.shapeType === 'theotown_base';
    const snap = isBase ? Math.max(1, Math.round(app.getSnapStep())) : app.getSnapStep();
    this.startVu = snapGridValue(vu, snap);
    this.startVv = snapGridValue(vv, snap);
    this.curVu = this.startVu;
    this.curVv = this.startVv;
    this.startScreen = [p.x, p.y];
    this.nowScreen = [p.x, p.y];
    this.baseZ = 0;
    this.dragging = true;
    this.host.requestRender();
  }

  move(p: Pt) {
    if (!this.dragging) return;
    const app = this.host.app;
    const d = app.doc;
    const { originX, originY } = d.getViewOrigin();
    const [vu, vv] = screenPxToIsoAtZ(p.x, p.y, 0, originX, originY);
    const isBase = app.createPreset.shapeType === 'theotown_base';
    const snap = isBase ? Math.max(1, Math.round(app.getSnapStep())) : app.getSnapStep();
    this.curVu = snapGridValue(vu, snap);
    this.curVv = snapGridValue(vv, snap);
    this.nowScreen = [p.x, p.y];
    this.host.requestRender();
  }

  up(_p: Pt) {
    if (!this.dragging) return;
    this.dragging = false;
    const app = this.host.app;
    const d = app.doc;
    const { vu, vv, vsu, vsv, isTinyTap } = this.getCurrentViewBox();
    const vOri = isTinyTap ? normalizeRotation(app.createPreset.ori + d.viewRotation) : app.createPreset.ori;
    const wb = viewBoxToWorld(vu, vv, vsu, vsv, vOri, d.plotU, d.plotV, d.viewRotation);

    const shape = cloneShape(app.createPreset);
    shape.u = wb.u;
    shape.v = wb.v;
    shape.sizeU = shape.shapeType === 'theotown_base' ? Math.max(1, Math.round(wb.sizeU)) : wb.sizeU;
    shape.sizeV = shape.shapeType === 'theotown_base' ? Math.max(1, Math.round(wb.sizeV)) : wb.sizeV;
    shape.ori = wb.ori;
    shape.zPx = app.settings.autoStackSnap && shape.shapeType !== 'theotown_base'
      ? d.getTopElevationAt(shape.u, shape.v, shape.sizeU, shape.sizeV)
      : this.baseZ;

    const created = app.addShapeLayer(shape);
    this.host.toast(`✨ 已生成「${created.name}」(${shape.sizeU}×${shape.sizeV}格 · H ${shape.heightPx}px)`);
    app.setTool('select');
    this.host.refreshUi();
    this.host.requestRender();
  }

  cancel() {
    this.dragging = false;
    this.host.requestRender();
  }

  overlay(ctx: CanvasRenderingContext2D, toScreen: ToScreenFn) {
    if (!this.dragging) return;
    const app = this.host.app;
    const d = app.doc;
    const { originX, originY } = d.getViewOrigin();
    const { vu, vv, vsu, vsv, isTinyTap } = this.getCurrentViewBox();
    const vOri = isTinyTap ? normalizeRotation(app.createPreset.ori + d.viewRotation) : app.createPreset.ori;
    const wb = viewBoxToWorld(vu, vv, vsu, vsv, vOri, d.plotU, d.plotV, d.viewRotation);

    const previewShape = cloneShape(app.createPreset);
    previewShape.u = wb.u;
    previewShape.v = wb.v;
    previewShape.sizeU = previewShape.shapeType === 'theotown_base' ? Math.max(1, Math.round(wb.sizeU)) : wb.sizeU;
    previewShape.sizeV = previewShape.shapeType === 'theotown_base' ? Math.max(1, Math.round(wb.sizeV)) : wb.sizeV;
    previewShape.ori = wb.ori;
    previewShape.zPx = app.settings.autoStackSnap && previewShape.shapeType !== 'theotown_base'
      ? d.getTopElevationAt(wb.u, wb.v, wb.sizeU, wb.sizeV)
      : 0;

    if (!this.previewCanvas) this.previewCanvas = document.createElement('canvas');
    if (this.previewCanvas.width !== d.width || this.previewCanvas.height !== d.height) {
      this.previewCanvas.width = d.width;
      this.previewCanvas.height = d.height;
      this.previewImgData = null;
      this.prevDirty = null;
    }
    const pctx = this.previewCanvas.getContext('2d')!;
    if (!this.previewImgData || this.previewImgData.width !== d.width || this.previewImgData.height !== d.height) {
      this.previewImgData = pctx.createImageData(d.width, d.height);
    }
    const img = this.previewImgData;
    const prev = this.prevDirty;
    if (prev) {
      const rowStart = prev.x0 * 4;
      const rowEnd = prev.x1 * 4;
      for (let y = prev.y0; y < prev.y1; y++) {
        const base = y * d.width * 4;
        img.data.fill(0, base + rowStart, base + rowEnd);
      }
    }
    const raw = getShapeScreenBounds(previewShape, d.plotU, d.plotV, d.viewRotation, originX, originY);
    const nb = {
      x0: Math.max(0, Math.floor(raw.minX) - 4),
      y0: Math.max(0, Math.floor(raw.minY) - 4),
      x1: Math.min(d.width, Math.ceil(raw.maxX) + 4),
      y1: Math.min(d.height, Math.ceil(raw.maxY) + 4),
    };
    renderShapeToBuffer(img.data, d.width, d.height, previewShape, d.plotU, d.plotV, d.viewRotation, originX, originY, d.shadeSteps);
    const hasNew = nb.x1 > nb.x0 && nb.y1 > nb.y0;
    const ux0 = prev ? (hasNew ? Math.min(prev.x0, nb.x0) : prev.x0) : nb.x0;
    const uy0 = prev ? (hasNew ? Math.min(prev.y0, nb.y0) : prev.y0) : nb.y0;
    const ux1 = prev ? (hasNew ? Math.max(prev.x1, nb.x1) : prev.x1) : nb.x1;
    const uy1 = prev ? (hasNew ? Math.max(prev.y1, nb.y1) : prev.y1) : nb.y1;
    if (ux1 > ux0 && uy1 > uy0) {
      pctx.putImageData(img, 0, 0, ux0, uy0, ux1 - ux0, uy1 - uy0);
    }
    this.prevDirty = hasNew ? nb : null;

    const [sx0, sy0] = toScreen(0, 0);
    const [sx1, sy1] = toScreen(d.width, d.height);
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.previewCanvas, sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    drawScreenDiamond(ctx, toScreen, vu, vv, vsu, vsv, previewShape.zPx, originX, originY);
    ctx.stroke();

    const [cx, cy] = isoToScreenPx(vu + vsu * 0.5, vv + vsv * 0.5, previewShape.zPx + previewShape.heightPx, originX, originY);
    const [scx, scy] = toScreen(cx, cy);
    drawBadge(
      ctx,
      scx,
      scy - 16,
      `${vsu}×${vsv} 格 · ${cellsToMeters(vsu).toFixed(1)}×${cellsToMeters(vsv).toFixed(1)} m`,
    );
    ctx.restore();
  }
}

// ---------------- Plot Orientation Frame Adjust Tool ----------------

type FrameHandle = 'none' | 'move' | 'edge_umin' | 'edge_umax' | 'edge_vmin' | 'edge_vmax';

export class PlotFrameTool implements Tool {
  private dragHandle: FrameHandle = 'none';
  private dragStart: [number, number] = [0, 0];
  private origFrame: PlotFrameConfig | null = null;
  private origViewBox: { u: number; v: number; sizeU: number; sizeV: number } | null = null;
  private historyPushed = false;

  constructor(private host: ToolHost) {}

  get isDragging(): boolean {
    return this.dragHandle !== 'none';
  }

  private getFrameHandles() {
    const d = this.host.app.doc;
    const pf = d.plotFrame;
    const { originX, originY } = d.getViewOrigin();
    const vb = worldBoxToView(pf.u, pf.v, pf.sizeU, pf.sizeV, 0, d.plotU, d.plotV, d.viewRotation);
    const center = isoToScreenPx(vb.u + vb.sizeU * 0.5, vb.v + vb.sizeV * 0.5, 0, originX, originY);
    const edgeUMin = isoToScreenPx(vb.u, vb.v + vb.sizeV * 0.5, 0, originX, originY);
    const edgeUMax = isoToScreenPx(vb.u + vb.sizeU, vb.v + vb.sizeV * 0.5, 0, originX, originY);
    const edgeVMin = isoToScreenPx(vb.u + vb.sizeU * 0.5, vb.v, 0, originX, originY);
    const edgeVMax = isoToScreenPx(vb.u + vb.sizeU * 0.5, vb.v + vb.sizeV, 0, originX, originY);
    return { vb, originX, originY, center, edgeUMin, edgeUMax, edgeVMin, edgeVMax };
  }

  down(p: Pt) {
    const d = this.host.app.doc;
    const pf = d.plotFrame;
    if (!pf.visible) {
      this.host.toast('场地边框当前已隐藏，请在上方工具条开启显示后再拖拽调整');
      return;
    }
    const { vb, originX, originY, center, edgeUMin, edgeUMax, edgeVMin, edgeVMax } = this.getFrameHandles();
    const tol = 15 / this.host.scale();
    const near = (pt: [number, number], r = tol) => Math.hypot(p.x - pt[0], p.y - pt[1]) <= r;

    let handle: FrameHandle = 'none';
    if (near(edgeUMax)) handle = 'edge_umax';
    else if (near(edgeVMax)) handle = 'edge_vmax';
    else if (near(edgeUMin)) handle = 'edge_umin';
    else if (near(edgeVMin)) handle = 'edge_vmin';
    else if (near(center, tol * 1.2)) handle = 'move';
    else {
      const [iu, iv] = screenPxToIsoAtZ(p.x, p.y, 0, originX, originY);
      if (iu >= vb.u - 0.15 && iu <= vb.u + vb.sizeU + 0.15 && iv >= vb.v - 0.15 && iv <= vb.v + vb.sizeV + 0.15) {
        handle = 'move';
      }
    }

    if (handle === 'none') return;
    this.dragHandle = handle;
    this.dragStart = [p.x, p.y];
    this.origFrame = { ...pf };
    this.origViewBox = { u: vb.u, v: vb.v, sizeU: vb.sizeU, sizeV: vb.sizeV };
    this.historyPushed = false;
  }

  move(p: Pt) {
    if (this.dragHandle === 'none' || !this.origFrame || !this.origViewBox) return;
    const app = this.host.app;
    const d = app.doc;
    if (!this.historyPushed) {
      if (Math.hypot(p.x - this.dragStart[0], p.y - this.dragStart[1]) * this.host.scale() < 2) return;
      app.pushHistory('调整场地边框');
      this.historyPushed = true;
    }

    const snap = app.getSnapStep();
    const minSize = Math.max(0.25, snap >= 1 ? 1 : snap);
    const { originX, originY } = d.getViewOrigin();
    const [uStart, vStart] = screenPxToIsoAtZ(this.dragStart[0], this.dragStart[1], 0, originX, originY);
    const [uNow, vNow] = screenPxToIsoAtZ(p.x, p.y, 0, originX, originY);
    const du = uNow - uStart;
    const dv = vNow - vStart;

    let vu = this.origViewBox.u;
    let vv = this.origViewBox.v;
    let vsu = this.origViewBox.sizeU;
    let vsv = this.origViewBox.sizeV;

    if (this.dragHandle === 'move') {
      vu = snapGridValue(vu + du, snap);
      vv = snapGridValue(vv + dv, snap);
    } else if (this.dragHandle === 'edge_umax') {
      vsu = Math.max(minSize, snapGridValue(vsu + du, snap));
    } else if (this.dragHandle === 'edge_vmax') {
      vsv = Math.max(minSize, snapGridValue(vsv + dv, snap));
    } else if (this.dragHandle === 'edge_umin') {
      const nextU = Math.min(vu + vsu - minSize, snapGridValue(vu + du, snap));
      vsu = Math.max(minSize, Math.round((vu + vsu - nextU) * 10000) / 10000);
      vu = nextU;
    } else if (this.dragHandle === 'edge_vmin') {
      const nextV = Math.min(vv + vsv - minSize, snapGridValue(vv + dv, snap));
      vsv = Math.max(minSize, Math.round((vv + vsv - nextV) * 10000) / 10000);
      vv = nextV;
    }

    const wb = viewBoxToWorld(vu, vv, vsu, vsv, 0, d.plotU, d.plotV, d.viewRotation);
    d.plotFrame.u = wb.u;
    d.plotFrame.v = wb.v;
    d.plotFrame.sizeU = wb.sizeU;
    d.plotFrame.sizeV = wb.sizeV;
    app.emit('doc_live');
  }

  up(_p: Pt) {
    const changed = this.historyPushed;
    this.dragHandle = 'none';
    this.origFrame = null;
    this.origViewBox = null;
    this.historyPushed = false;
    if (changed) {
      this.host.app.emit('doc');
      this.host.refreshUi();
    } else {
      this.host.requestRender();
    }
  }

  cancel() {
    if (this.dragHandle === 'none' && !this.origFrame) return;
    const app = this.host.app;
    if (this.origFrame) {
      app.doc.plotFrame = { ...this.origFrame };
    }
    if (this.historyPushed) {
      app.history.discardLast();
      app.emit('history');
    }
    this.dragHandle = 'none';
    this.origFrame = null;
    this.origViewBox = null;
    this.historyPushed = false;
    this.host.refreshUi();
    this.host.requestRender();
  }

  overlay(ctx: CanvasRenderingContext2D, toScreen: ToScreenFn) {
    const d = this.host.app.doc;
    const pf = d.plotFrame;
    const { vb, originX, originY, center, edgeUMin, edgeUMax, edgeVMin, edgeVMax } = this.getFrameHandles();

    ctx.save();
    if (!pf.visible) {
      const [scx, scy] = toScreen(...isoToScreenPx(d.plotU * 0.5, d.plotV * 0.5, 0, originX, originY));
      drawBadge(ctx, scx, scy, '场地方向边框已隐藏（可在上方工具条或参数弹窗开启）', 'rgba(15, 23, 42, 0.92)', '#64748b');
      ctx.restore();
      return;
    }

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    drawScreenDiamond(ctx, toScreen, vb.u, vb.v, vb.sizeU, vb.sizeV, 0, originX, originY);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawDot = (pt: [number, number], fill: string, r = 5, diamond = false) => {
      const [sx, sy] = toScreen(pt[0], pt[1]);
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (diamond) {
        ctx.moveTo(sx, sy - r - 1);
        ctx.lineTo(sx + r + 1, sy);
        ctx.lineTo(sx, sy + r + 1);
        ctx.lineTo(sx - r - 1, sy);
        ctx.closePath();
      } else {
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    };

    for (const pt of [edgeUMin, edgeUMax, edgeVMin, edgeVMax]) {
      drawDot(pt, '#38bdf8', 5, false);
    }
    drawDot(center, '#fbbf24', 5.5, true);

    const [cx, cy] = toScreen(center[0], center[1]);
    drawBadge(
      ctx,
      cx,
      cy - 20,
      `场地边框 ${pf.sizeU}×${pf.sizeV}格 (${cellsToMeters(pf.sizeU).toFixed(1)}×${cellsToMeters(pf.sizeV).toFixed(1)}m) · 起点 (${pf.u}, ${pf.v})`,
      'rgba(15, 23, 42, 0.92)',
      '#38bdf8',
    );
    ctx.restore();
  }
}

// ---------------- Hand Pan Tool ----------------

export class HandTool implements Tool {
  down(_p: Pt) {}
  move(_p: Pt) {}
  up(_p: Pt) {}
  cancel() {}
}
