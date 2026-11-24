// Interactive viewport: nearest-neighbour composite rendering, 32x16 isometric diamond grid, plot orientation markers, pinch/pan/undo gestures
import type { App } from './app';
import { isoToScreenPx, screenPxToIsoAtZ, worldBoxToView, worldPointToView } from './core/isoMath';
import type { Pt, Tool, ToolHost } from './core/tools';

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

    // Pinned 3D ruler overlays & active tool overlay (3D Gizmos / Ruler / Drag preview)
    this.onPinnedOverlay?.(ctx, this.toScreen);
    this.getTool().overlay?.(ctx, this.toScreen);
  }

  private drawIsoDiamondGrid(ctx: CanvasRenderingContext2D, w: number, h: number, z: number) {
    const d = this.app.doc;
    const { originX, originY } = d.getViewOrigin();
    const dw = w * z;
    const dh = h * z;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, dw, dh);
    ctx.clip();

    // Extended background grid lines across canvas aligned to plot origin (32x16 cell units)
    const span = Math.ceil((w / 32) + (h / 16)) + 4;
    const subStep = this.app.settings.snapEnabled && this.app.settings.snapStep < 1
      ? Math.max(0.25, this.app.settings.snapStep)
      : 1;

    if (subStep < 1 && z >= 2) {
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.14)';
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
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.24)';
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
