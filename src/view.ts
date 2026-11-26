// Interactive viewport: nearest-neighbour composite rendering, 32x16 isometric diamond grid, plot orientation markers, ground projection, pinch/pan/undo gestures
import type { App } from './app';
import { clamp } from './core/color';
import {
  evaluateColumnSectionRing,
  hasActiveColumnSections,
  normalizeColumnSections,
} from './core/columnSections';
import {
  isoToScreenPx,
  normalizeRotation,
  screenPxToIsoAtZ,
  worldBoxToView,
  worldPointToView,
  zPxToMeters,
} from './core/isoMath';
import { getShapeTiltedViewBounds, hasActiveTilt, transformLocalToViewPoint } from './core/isoRenderer';
import { normalizeLoftSections, sampleClosedSectionUniform } from './core/loft';
import { drawBadge, type Pt, type Tool, type ToolHost } from './core/tools';

export class View {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  zoom = 4;
  ox = 0;
  oy = 0;
  private dpr = window.devicePixelRatio || 1;
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: {
    dist: number; cx: number; cy: number;
    zoom: number; ox: number; oy: number;
    t: number; moved: boolean; maxCount: number; cancelled: boolean;
  } | null = null;
  private drawing = false;
  private panning: { x: number; y: number; ox: number; oy: number } | null = null;
  private checker: CanvasPattern | null = null;
  private panHoldActive = false;

  getTool: () => Tool = () => { throw new Error('no tool'); };
  onPinnedOverlay?: (ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number]) => void;
  onTwoFingerTap: () => void = () => {};
  onThreeFingerTap: () => void = () => {};
  onCursor: (p: { x: number; y: number; u: number; v: number } | null) => void = () => {};

  constructor(private host: HTMLElement, private app: App) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.bind();
  }

  get vw(): number { return this.canvas.width / this.dpr; }
  get vh(): number { return this.canvas.height / this.dpr; }

  resize() {
    const r = this.host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const nw = Math.max(1, Math.round(r.width * dpr));
    const nh = Math.max(1, Math.round(r.height * dpr));
    const cssW = `${r.width}px`;
    const cssH = `${r.height}px`;
    if (this.canvas.width === nw && this.canvas.height === nh && this.dpr === dpr) {
      if (this.canvas.style.width !== cssW) this.canvas.style.width = cssW;
      if (this.canvas.style.height !== cssH) this.canvas.style.height = cssH;
      return;
    }
    this.dpr = dpr;
    this.canvas.width = nw;
    this.canvas.height = nh;
    this.canvas.style.width = cssW;
    this.canvas.style.height = cssH;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.render();
  }

  fit() {
    const d = this.app.doc;
    const pad = 28;
    const z = Math.min((this.vw - pad * 2) / d.width, (this.vh - pad * 2) / d.height);
    this.zoom = z >= 1 ? Math.max(1, Math.floor(z)) : Math.max(0.5, z);
    this.ox = (this.vw - d.width * this.zoom) / 2;
    this.oy = (this.vh - d.height * this.zoom) / 2;
    this.requestRender();
  }

  zoomAt(factor: number, cx = this.vw / 2, cy = this.vh / 2) {
    const nz = Math.max(0.5, Math.min(64, this.zoom * factor));
    const dx = (cx - this.ox) / this.zoom;
    const dy = (cy - this.oy) / this.zoom;
    this.zoom = nz;
    this.ox = cx - dx * nz;
    this.oy = cy - dy * nz;
    this.requestRender();
  }

  setPanHold(active: boolean) {
    if (this.panHoldActive === active) return;
    this.panHoldActive = active;
    if (active && typeof document !== 'undefined' && document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
    this.canvas.classList.toggle('pan-hold', active);
  }

  panByScreen(dxPx: number, dyPx: number) {
    if (dxPx === 0 && dyPx === 0) return;
    this.ox += dxPx;
    this.oy += dyPx;
    this.requestRender();
  }

  toDoc(sx: number, sy: number, e?: PointerEvent): Pt {
    return {
      x: (sx - this.ox) / this.zoom,
      y: (sy - this.oy) / this.zoom,
      pointerType: e ? e.pointerType : 'mouse',
    };
  }

  toScreen = (x: number, y: number): [number, number] => [this.ox + x * this.zoom, this.oy + y * this.zoom];

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render() {
    const ctx = this.ctx;
    const d = this.app.doc;
    const z = this.zoom;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.app.themeTokens.stageBg;
    ctx.fillRect(0, 0, this.vw, this.vh);

    if (!this.checker) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const cc = c.getContext('2d')!;
      cc.fillStyle = '#2c2c34';
      cc.fillRect(0, 0, 16, 16);
      cc.fillStyle = '#24242b';
      cc.fillRect(0, 0, 8, 8);
      cc.fillRect(8, 8, 8, 8);
      this.checker = ctx.createPattern(c, 'repeat');
    }

    const dw = d.width * z;
    const dh = d.height * z;
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.fillStyle = this.checker!;
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();

    // Draw isometric plot grid behind shapes if enabled
    if (this.app.settings.showIsoGrid) {
      this.drawIsoDiamondGrid(ctx, d.width, d.height, z);
    }

    // Composite document
    const rendered = d.render(true);
    if (rendered) {
      ctx.imageSmoothingEnabled = this.app.settings.smoothing;
      ctx.drawImage(rendered, this.ox, this.oy, dw, dh);
    }

    // 1px pixel grid on high zoom
    if (this.app.settings.showPixelGrid && z >= this.app.settings.pixelGridMinZoom) {
      ctx.beginPath();
      const x0 = Math.max(0, Math.floor(-this.ox / z));
      const x1 = Math.min(d.width, Math.ceil((this.vw - this.ox) / z));
      const y0 = Math.max(0, Math.floor(-this.oy / z));
      const y1 = Math.min(d.height, Math.ceil((this.vh - this.oy) / z));
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round(this.ox + x * z) + 0.5;
        ctx.moveTo(sx, this.oy + y0 * z);
        ctx.lineTo(sx, this.oy + y1 * z);
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round(this.oy + y * z) + 0.5;
        ctx.moveTo(this.ox + x0 * z, sy);
        ctx.lineTo(this.ox + x1 * z, sy);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Canvas border
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.ox - 0.5, this.oy - 0.5, dw + 1, dh + 1);

    // Plot orientation frame & compass markers (hideable & adjustable)
    this.drawPlotFrameAndCompass(ctx);

    // Selected elevated shape ground projection overlay (Z = 0 footprint + plumb lines)
    if (this.app.settings.showGroundProjection) {
      this.drawGroundProjection(ctx);
    }

    // Pinned 3D ruler overlays & active tool overlay (3D Gizmos / Ruler / Drag preview)
    this.onPinnedOverlay?.(ctx, this.toScreen);
    this.getTool().overlay?.(ctx, this.toScreen);
  }

  private drawIsoDiamondGrid(ctx: CanvasRenderingContext2D, w: number, h: number, z: number) {
    const d = this.app.doc;
    const { originX, originY } = d.getViewOrigin();
    const dw = w * z;
    const dh = h * z;
    const gc = this.app.settings.isoGridColor;
    const mainAlpha = clamp((gc?.a ?? 61) / 255, 0, 1);
    const subAlpha = clamp(mainAlpha * 0.58, 0, 1);
    const gr = clamp(Math.round(gc?.r ?? 168), 0, 255);
    const gg = clamp(Math.round(gc?.g ?? 85), 0, 255);
    const gb = clamp(Math.round(gc?.b ?? 247), 0, 255);

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, dw, dh);
    ctx.clip();

    // Extended background grid lines across canvas aligned to plot origin (32x16 cell units)
    const span = Math.ceil((w / 32) + (h / 16)) + 4;
    const subStep = this.app.settings.snapEnabled && this.app.settings.snapStep < 1
      ? Math.max(0.25, this.app.settings.snapStep)
      : 1;

    if (subStep < 1 && z >= 2 && subAlpha > 0) {
      ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${subAlpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let u = -span; u <= span; u += subStep) {
        if (Math.abs(u - Math.round(u)) < 1e-4) continue;
        const [ax, ay] = isoToScreenPx(u, -span, 0, originX, originY);
        const [bx, by] = isoToScreenPx(u, span, 0, originX, originY);
        const [sax, say] = this.toScreen(ax, ay);
        const [sbx, sby] = this.toScreen(bx, by);
        ctx.moveTo(sax, say);
        ctx.lineTo(sbx, sby);
      }
      for (let v = -span; v <= span; v += subStep) {
        if (Math.abs(v - Math.round(v)) < 1e-4) continue;
        const [ax, ay] = isoToScreenPx(-span, v, 0, originX, originY);
        const [bx, by] = isoToScreenPx(span, v, 0, originX, originY);
        const [sax, say] = this.toScreen(ax, ay);
        const [sbx, sby] = this.toScreen(bx, by);
        ctx.moveTo(sax, say);
        ctx.lineTo(sbx, sby);
      }
      ctx.stroke();
    }

    // Main 32x16 cells across canvas
    if (mainAlpha > 0) {
      ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${mainAlpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let u = -span; u <= span; u++) {
        const [ax, ay] = isoToScreenPx(u, -span, 0, originX, originY);
        const [bx, by] = isoToScreenPx(u, span, 0, originX, originY);
        const [sax, say] = this.toScreen(ax, ay);
        const [sbx, sby] = this.toScreen(bx, by);
        ctx.moveTo(sax, say);
        ctx.lineTo(sbx, sby);
      }
      for (let v = -span; v <= span; v++) {
        const [ax, ay] = isoToScreenPx(-span, v, 0, originX, originY);
        const [bx, by] = isoToScreenPx(span, v, 0, originX, originY);
        const [sax, say] = this.toScreen(ax, ay);
        const [sbx, sby] = this.toScreen(bx, by);
        ctx.moveTo(sax, say);
        ctx.lineTo(sbx, sby);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawGroundProjection(ctx: CanvasRenderingContext2D) {
    const d = this.app.doc;
    const l = d.layer;
    if (!l || !l.visible || l.kind !== 'shape' || !l.shape) return;
    const s = l.shape;
    if (s.shapeType === 'theotown_base') return;
    const isTilted = hasActiveTilt(s);
    if (!isTilted && s.zPx <= 0) return;

    const { originX, originY } = d.getViewOrigin();
    const vb = worldBoxToView(
      s.u,
      s.v,
      Math.max(0.0625, s.sizeU),
      Math.max(0.0625, s.sizeV),
      normalizeRotation(s.ori),
      d.plotU,
      d.plotV,
      d.viewRotation,
    );
    const u0 = vb.u;
    const v0 = vb.v;
    const su = vb.sizeU;
    const sv = vb.sizeV;
    const ori = vb.ori;
    const z0 = Math.round(s.zPx);
    const toViewScreen = (vu: number, vv: number, z: number): [number, number] =>
      this.toScreen(...isoToScreenPx(vu, vv, z, originX, originY));
    const localToView = (lu: number, lv: number): [number, number] => {
      const pt = transformLocalToViewPoint(lu, lv, 0, u0, v0, su, sv, ori);
      return [pt.x, pt.y];
    };

    const primaryPoly: [number, number][] = [];
    let secondaryPoly: [number, number][] | null = null;
    const dropAnchors: [number, number, number][] = []; // [vu, vv, topZ]
    let centerU = u0 + su * 0.5;
    let centerV = v0 + sv * 0.5;
    let centerTopZ = z0;
    let displayElevZ = z0;

    if (isTilted) {
      const tb = getShapeTiltedViewBounds(s, d.plotU, d.plotV, d.viewRotation);
      if (tb.maxZ <= 0 || tb.points3D.length < 3) return;
      // 2D convex hull (Andrew's monotone chain) in (u, v) view plane
      const sorted = [...tb.points3D].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
      const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const lower: typeof sorted = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-7) {
          lower.pop();
        }
        lower.push(p);
      }
      const upper: typeof sorted = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-7) {
          upper.pop();
        }
        upper.push(p);
      }
      lower.pop();
      upper.pop();
      const hull = [...lower, ...upper];
      if (hull.length < 3) return;
      for (const pt of hull) primaryPoly.push([pt.x, pt.y]);
      const step = Math.max(1, Math.floor(hull.length / Math.min(6, hull.length)));
      for (let i = 0; i < hull.length; i += step) {
        if (hull[i].z > 0) dropAnchors.push([hull[i].x, hull[i].y, hull[i].z]);
      }
      centerU = (tb.minU + tb.maxU) * 0.5;
      centerV = (tb.minV + tb.maxV) * 0.5;
      centerTopZ = Math.max(0, (tb.minZ + tb.maxZ) * 0.5);
      displayElevZ = Math.round(tb.minZ);
    } else if (s.shapeType === 'loft') {
      const secs = normalizeLoftSections(s.loftSections);
      const botSec = s.flipZ ? secs[secs.length - 1] : secs[0];
      const topSec = s.flipZ ? secs[0] : secs[secs.length - 1];
      const botPts = sampleClosedSectionUniform(botSec, 48, true);
      for (const [lu, lv] of botPts) primaryPoly.push(localToView(lu, lv));
      if (topSec && topSec.id !== botSec.id) {
        secondaryPoly = sampleClosedSectionUniform(topSec, 48, true).map(([lu, lv]) => localToView(lu, lv));
      }
      for (let i = 0; i < 4; i++) {
        const idx = Math.floor((i * primaryPoly.length) / 4);
        if (primaryPoly[idx]) dropAnchors.push([primaryPoly[idx][0], primaryPoly[idx][1], z0]);
      }
    } else if (hasActiveColumnSections(s)) {
      const secs = normalizeColumnSections(s.colSections, s.shapeType, s.prismSides);
      const botSec = s.flipZ ? secs[secs.length - 1] : secs[0];
      const topSec = s.flipZ ? secs[0] : secs[secs.length - 1];
      const botPts = evaluateColumnSectionRing(botSec, 36);
      for (const [lu, lv] of botPts) primaryPoly.push(localToView(lu, lv));
      if (topSec && topSec.id !== botSec.id) {
        secondaryPoly = evaluateColumnSectionRing(topSec, 36).map(([lu, lv]) => localToView(lu, lv));
      }
      const step = Math.max(1, Math.floor(primaryPoly.length / Math.min(4, primaryPoly.length)));
      for (let i = 0; i < primaryPoly.length && dropAnchors.length < 4; i += step) {
        dropAnchors.push([primaryPoly[i][0], primaryPoly[i][1], z0]);
      }
    } else if (
      s.shapeType === 'cylinder' ||
      s.shapeType === 'cone' ||
      s.shapeType === 'dome' ||
      s.shapeType === 'sphere'
    ) {
      const cu = u0 + su * 0.5;
      const cv = v0 + sv * 0.5;
      const ru = su * 0.5;
      const rv = sv * 0.5;
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const ang = (i * Math.PI * 2) / segs;
        primaryPoly.push([cu + Math.cos(ang) * ru, cv + Math.sin(ang) * rv]);
      }
      dropAnchors.push([cu + ru, cv, z0], [cu, cv + rv, z0], [cu - ru, cv, z0], [cu, cv - rv, z0]);
    } else if (s.shapeType === 'prism') {
      const n = Math.max(3, Math.min(12, Math.round(s.prismSides)));
      const startAngle = Math.PI / n;
      for (let i = 0; i < n; i++) {
        const ang = startAngle - (i * Math.PI * 2) / n;
        primaryPoly.push(localToView(0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5));
      }
      const step = Math.max(1, Math.floor(n / Math.min(6, n)));
      for (let i = 0; i < n; i += step) dropAnchors.push([primaryPoly[i][0], primaryPoly[i][1], z0]);
    } else if (s.shapeType === 'right_tri_prism' && (s.triPrismCut ?? 'vertical') === 'vertical') {
      const pts: [number, number][] = [localToView(0, 0), localToView(1, 0), localToView(0, 1)];
      primaryPoly.push(...pts);
      for (const [pu, pv] of pts) dropAnchors.push([pu, pv, z0]);
    } else {
      const boxPts: [number, number][] = [
        [u0, v0],
        [u0 + su, v0],
        [u0 + su, v0 + sv],
        [u0, v0 + sv],
      ];
      primaryPoly.push(...boxPts);
      for (const [pu, pv] of boxPts) dropAnchors.push([pu, pv, z0]);
    }

    if (primaryPoly.length < 3) return;

    const traceViewPolyAtZ0 = (poly: [number, number][]) => {
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const [sx, sy] = toViewScreen(poly[i][0], poly[i][1], 0);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    };

    ctx.save();

    // Optional faint outer bounding diamond for upright round shapes to aid 32x16 cell alignment
    if (
      !isTilted &&
      (s.shapeType === 'cylinder' ||
        s.shapeType === 'cone' ||
        s.shapeType === 'dome' ||
        s.shapeType === 'sphere')
    ) {
      traceViewPolyAtZ0([
        [u0, v0],
        [u0 + su, v0],
        [u0 + su, v0 + sv],
        [u0, v0 + sv],
      ]);
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.34)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
    }

    // Secondary overhanging ring contour (e.g. wider top on loft/column)
    if (secondaryPoly && secondaryPoly.length >= 3) {
      traceViewPolyAtZ0(secondaryPoly);
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
    }

    // Primary projected footprint fill & crisp outline at Z = 0
    traceViewPolyAtZ0(primaryPoly);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.20)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 3]);
    ctx.stroke();

    // Vertical drop guide lines from shape vertices down to Z = 0
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const [au, av, az] of dropAnchors) {
      const [topX, topY] = toViewScreen(au, av, az);
      const [botX, botY] = toViewScreen(au, av, 0);
      ctx.moveTo(topX, topY);
      ctx.lineTo(botX, botY);
    }
    ctx.stroke();

    // Ground anchor dots at each vertical drop landing point
    ctx.setLineDash([]);
    ctx.fillStyle = '#34d399';
    for (const [au, av] of dropAnchors) {
      const [botX, botY] = toViewScreen(au, av, 0);
      ctx.beginPath();
      ctx.arc(botX, botY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center plumb line + ground target crosshair
    const [cTopX, cTopY] = toViewScreen(centerU, centerV, centerTopZ);
    const [cBotX, cBotY] = toViewScreen(centerU, centerV, 0);
    ctx.strokeStyle = 'rgba(110, 231, 183, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(cTopX, cTopY);
    ctx.lineTo(cBotX, cBotY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#6ee7b7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cBotX - 5, cBotY);
    ctx.lineTo(cBotX + 5, cBotY);
    ctx.moveTo(cBotX, cBotY - 5);
    ctx.lineTo(cBotX, cBotY + 5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cBotX, cBotY, 3.5, 0, Math.PI * 2);
    ctx.stroke();

    // Ground projection coordinate & elevation badge
    const fmt = (n: number) => Math.round(n * 100) / 100;
    let maxScreenY = cBotY;
    for (const [pu, pv] of primaryPoly) {
      const [, sy] = toViewScreen(pu, pv, 0);
      if (sy > maxScreenY) maxScreenY = sy;
    }
    drawBadge(
      ctx,
      cBotX,
      maxScreenY + 16,
      `地面投影 · U:${fmt(s.u)} V:${fmt(s.v)} · 离地 ${displayElevZ}px (${zPxToMeters(displayElevZ).toFixed(2)}m)`,
      'rgba(8, 28, 24, 0.92)',
      '#34d399',
      '#a7f3d0',
    );

    ctx.restore();
  }

  private drawPlotFrameAndCompass(ctx: CanvasRenderingContext2D) {
    const d = this.app.doc;
    const pf = d.plotFrame;
    if (!pf.visible) return;

    const { originX, originY } = d.getViewOrigin();
    const vb = worldBoxToView(pf.u, pf.v, pf.sizeU, pf.sizeV, 0, d.plotU, d.plotV, d.viewRotation);

    ctx.save();
    // Draw ground isometric orientation frame border
    const p0 = this.toScreen(...isoToScreenPx(vb.u, vb.v, 0, originX, originY));
    const p1 = this.toScreen(...isoToScreenPx(vb.u + vb.sizeU, vb.v, 0, originX, originY));
    const p2 = this.toScreen(...isoToScreenPx(vb.u + vb.sizeU, vb.v + vb.sizeV, 0, originX, originY));
    const p3 = this.toScreen(...isoToScreenPx(vb.u, vb.v + vb.sizeV, 0, originX, originY));
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
    ctx.stroke();

    // World edges midpoints following plotFrame: N=(v=pf.v), E=(u=pf.u+pf.sizeU), S=(v=pf.v+pf.sizeV), W=(u=pf.u)
    const markers: { label: string; wu: number; wv: number; color: string }[] = [
      { label: 'N (-V)', wu: pf.u + pf.sizeU * 0.5, wv: pf.v - 0.35, color: '#f87171' },
      { label: 'E (+U)', wu: pf.u + pf.sizeU + 0.35, wv: pf.v + pf.sizeV * 0.5, color: '#38bdf8' },
      { label: 'S (+V)', wu: pf.u + pf.sizeU * 0.5, wv: pf.v + pf.sizeV + 0.35, color: '#4ade80' },
      { label: 'W (-U)', wu: pf.u - 0.35, wv: pf.v + pf.sizeV * 0.5, color: '#fbbf24' },
    ];
    ctx.font = '700 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of markers) {
      const [vu, vv] = worldPointToView(m.wu, m.wv, d.plotU, d.plotV, d.viewRotation);
      const [px, py] = isoToScreenPx(vu, vv, 0, originX, originY);
      const [sx, sy] = this.toScreen(px, py);
      ctx.fillStyle = 'rgba(15, 12, 26, 0.72)';
      ctx.beginPath();
      ctx.roundRect(sx - 18, sy - 8, 36, 16, 4);
      ctx.fill();
      ctx.fillStyle = m.color;
      ctx.fillText(m.label, sx, sy + 0.5);
    }
    ctx.restore();
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private emitCursor(sx: number, sy: number) {
    const pt = this.toDoc(sx, sy);
    const { originX, originY } = this.app.doc.getViewOrigin();
    const [u, v] = screenPxToIsoAtZ(pt.x, pt.y, 0, originX, originY);
    this.onCursor({ x: Math.round(pt.x), y: Math.round(pt.y), u, v });
  }

  private bind() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.onCursor(null);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.setPanHold(false);
      this.panning = null;
      this.canvas.classList.remove('pan-dragging');
    });
  }

  private reanchorGesture(isInitial: boolean) {
    const pts = [...this.pointers.values()];
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    if (isInitial || !this.gesture) {
      this.gesture = {
        dist,
        cx,
        cy,
        zoom: this.zoom,
        ox: this.ox,
        oy: this.oy,
        t: performance.now(),
        moved: false,
        maxCount: pts.length,
        cancelled: false,
      };
    } else {
      this.gesture.dist = dist;
      this.gesture.cx = cx;
      this.gesture.cy = cy;
      this.gesture.zoom = this.zoom;
      this.gesture.ox = this.ox;
      this.gesture.oy = this.oy;
      this.gesture.maxCount = Math.max(this.gesture.maxCount, pts.length);
    }
  }

  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size >= 2) {
      if (this.drawing) {
        this.getTool().cancel();
        this.drawing = false;
      }
      this.panning = null;
      this.reanchorGesture(!this.gesture);
      return;
    }

    if (e.button === 1 || e.button === 2 || this.panHoldActive || this.app.tool === 'hand') {
      this.panning = { x: p.x, y: p.y, ox: this.ox, oy: this.oy };
      this.canvas.classList.add('pan-dragging');
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    this.drawing = true;
    this.getTool().down(this.toDoc(p.x, p.y, e));
    this.emitCursor(p.x, p.y);
  }

  private onMove(e: PointerEvent) {
    const p = this.local(e);
    if (e.pointerType !== 'touch') this.emitCursor(p.x, p.y);
    if (!this.pointers.has(e.pointerId)) {
      if (this.app.tool === 'ruler') {
        this.getTool().move(this.toDoc(p.x, p.y, e));
      }
      return;
    }

    this.pointers.set(e.pointerId, p);
    if (this.gesture && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const g = this.gesture;
      if (Math.abs(dist - g.dist) > 10 || Math.hypot(cx - g.cx, cy - g.cy) > 10) g.moved = true;
      const nz = Math.max(0.5, Math.min(64, g.zoom * (dist / Math.max(1, g.dist))));
      const dx = (g.cx - g.ox) / g.zoom;
      const dy = (g.cy - g.oy) / g.zoom;
      this.zoom = nz;
      this.ox = cx - dx * nz;
      this.oy = cy - dy * nz;
      this.requestRender();
      return;
    }

    if (this.panning) {
      this.ox = this.panning.ox + (p.x - this.panning.x);
      this.oy = this.panning.oy + (p.y - this.panning.y);
      this.requestRender();
      return;
    }

    if (this.drawing) {
      this.getTool().move(this.toDoc(p.x, p.y, e));
      this.emitCursor(p.x, p.y);
    }
  }

  private onUp(e: PointerEvent, cancelled = false) {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);

    if (this.gesture) {
      if (cancelled) {
        this.gesture.cancelled = true;
      }
      if (this.pointers.size === 0) {
        const g = this.gesture;
        if (!g.cancelled && !g.moved && performance.now() - g.t < 350 && this.app.settings.gestureUndoRedo) {
          if (g.maxCount >= 3) this.onThreeFingerTap();
          else if (g.maxCount === 2) this.onTwoFingerTap();
        }
        this.gesture = null;
      } else if (this.pointers.size >= 2) {
        this.reanchorGesture(false);
      }
      return;
    }

    if (this.panning) {
      this.panning = null;
      this.canvas.classList.remove('pan-dragging');
      return;
    }

    if (this.drawing) {
      this.drawing = false;
      if (cancelled) this.getTool().cancel();
      else this.getTool().up(this.toDoc(p.x, p.y, e));
    }
  }
}

export function makeHost(app: App, view: View, toast: (m: string) => void, refreshUi: () => void): ToolHost {
  return {
    app,
    scale: () => view.zoom,
    requestRender: () => view.requestRender(),
    toast,
    refreshUi,
  };
}
