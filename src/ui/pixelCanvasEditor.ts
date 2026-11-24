// Standalone Pixel Meow-style 2D Pixel Canvas Editor modal for Builder Meow textures & planar faces
import {
  Check,
  Eraser,
  Grid3x3,
  Hand,
  Maximize,
  Pencil,
  Pipette,
  Redo2,
  SquareDashed,
  Undo2,
  WandSparkles,
  X,
  type IconNode,
} from 'lucide';
import type { App } from '../app';
import { clamp, parseHex, toHex, toHex8, type RGBA } from '../core/color';
import { tr } from '../core/i18n';
import type { PlanarFaceSpec } from '../core/textures';
import { formatActionHint, shortcutManager } from '../shortcuts/blenderShortcuts';
import { openColorPicker } from './colorPicker';
import { h, icon, openSheets, toast, toggle } from './dom';

export type SelectOp = 'replace' | 'add' | 'subtract' | 'intersect';
export type PixelEditorToolId = 'pencil' | 'eraser' | 'rect_select' | 'wand' | 'picker' | 'hand';

export interface PixelCanvasEditorOptions {
  app: App;
  title?: string;
  initialName?: string;
  initialData?: Uint8ClampedArray;
  width: number;
  height: number;
  allowResize?: boolean;
  faceContext?: {
    faceSpec: PlanarFaceSpec;
    baseColor: RGBA;
  };
  confirmLabel?: string;
  onSave: (result: { name: string; data: Uint8ClampedArray; width: number; height: number }) => void;
  onClose?: () => void;
}

const MAX_UNDO_STEPS = 50;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 96;
const RESIZE_PRESETS: readonly [number, number][] = [
  [8, 8],
  [16, 16],
  [24, 24],
  [32, 16],
  [32, 32],
  [64, 64],
];

let scopeSeq = 0;
let rememberedEditorColor: RGBA | null = null;

// ---------------- Pure Raster & Selection Algorithms (Node-safe) ----------------

function bresenham(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Interactive & batch 1px pixel-perfect stroke session ported from PixelPad Stroke (`stampPP` + `bresenham`).
 */
class PixelStrokeSession {
  readonly before: Uint8ClampedArray;
  readonly touched: Uint8Array;
  private lastStamp: [number, number] | null = null;
  private ppHistory: [number, number][] = [];
  dirty = false;

  constructor(
    public readonly buf: Uint8ClampedArray,
    public readonly w: number,
    public readonly h: number,
    public readonly color: RGBA,
    public readonly mode: 'paint' | 'erase',
    public readonly selection: Uint8Array | null = null,
  ) {
    this.before = new Uint8ClampedArray(buf);
    this.touched = new Uint8Array(Math.max(0, w * h));
  }

  private canTouch(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const p = y * this.w + x;
    if (this.selection && !this.selection[p]) return false;
    return true;
  }

  private plot(x: number, y: number): void {
    if (!this.canTouch(x, y)) return;
    const p = y * this.w + x;
    if (this.touched[p]) return;
    this.touched[p] = 1;

    const i = p * 4;
    const b = this.before;
    const d = this.buf;
    const sa = clamp(this.color.a, 0, 255) / 255;

    if (this.mode === 'erase') {
      const na = Math.round(b[i + 3] * (1 - sa));
      if (na <= 0) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      } else {
        d[i] = b[i];
        d[i + 1] = b[i + 1];
        d[i + 2] = b[i + 2];
        d[i + 3] = na;
      }
    } else {
      const da = b[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      } else {
        d[i] = Math.round((this.color.r * sa + b[i] * da * (1 - sa)) / oa);
        d[i + 1] = Math.round((this.color.g * sa + b[i + 1] * da * (1 - sa)) / oa);
        d[i + 2] = Math.round((this.color.b * sa + b[i + 2] * da * (1 - sa)) / oa);
        d[i + 3] = Math.round(oa * 255);
      }
    }
    this.dirty = true;
  }

  private unplot(x: number, y: number): void {
    if (!this.canTouch(x, y)) return;
    const p = y * this.w + x;
    const i = p * 4;
    this.touched[p] = 0;
    this.buf[i] = this.before[i];
    this.buf[i + 1] = this.before[i + 1];
    this.buf[i + 2] = this.before[i + 2];
    this.buf[i + 3] = this.before[i + 3];
  }

  private stampPP(x: number, y: number): void {
    const h = this.ppHistory;
    h.push([x, y]);
    this.plot(x, y);
    if (h.length >= 3) {
      const [a, b, c] = h.slice(-3);
      if ((a[0] === b[0] || a[1] === b[1]) && (c[0] === b[0] || c[1] === b[1]) && a[0] !== c[0] && a[1] !== c[1]) {
        this.unplot(b[0], b[1]);
        h.splice(h.length - 2, 1);
      }
    }
    if (h.length > 4) h.shift();
  }

  strokeTo(rawX: number, rawY: number): void {
    const x = Math.floor(rawX);
    const y = Math.floor(rawY);
    if (!this.lastStamp) {
      this.lastStamp = [x, y];
      this.stampPP(x, y);
      return;
    }
    const [lx, ly] = this.lastStamp;
    if (lx === x && ly === y) return;
    let last: [number, number] = [lx, ly];
    bresenham(lx, ly, x, y, (px, py) => {
      if (px === lx && py === ly) return;
      if (Math.max(Math.abs(px - last[0]), Math.abs(py - last[1])) >= 1) {
        this.stampPP(px, py);
        last = [px, py];
      }
    });
    this.lastStamp = last;
  }

  hasActualChanges(): boolean {
    if (!this.dirty) return false;
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i] !== this.before[i]) return true;
    }
    return false;
  }

  cancel(): void {
    this.buf.set(this.before);
    this.dirty = false;
  }
}

export function plotPixelPerfectStroke(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  points: [number, number][],
  color: RGBA,
  mode: 'paint' | 'erase',
  selection?: Uint8Array | null,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf);
  if (w <= 0 || h <= 0 || points.length === 0) return out;
  const session = new PixelStrokeSession(out, w, h, color, mode, selection ?? null);
  for (const [x, y] of points) {
    session.strokeTo(x, y);
  }
  return out;
}

export function rectSelectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const len = Math.max(0, w * h);
  const m = new Uint8Array(len);
  if (w <= 0 || h <= 0) return m;
  const rx0 = Math.floor(x0);
  const ry0 = Math.floor(y0);
  const rx1 = Math.floor(x1);
  const ry1 = Math.floor(y1);
  const ax = Math.max(0, Math.min(rx0, rx1));
  const bx = Math.min(w - 1, Math.max(rx0, rx1));
  const ay = Math.max(0, Math.min(ry0, ry1));
  const by = Math.min(h - 1, Math.max(ry0, ry1));
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      m[y * w + x] = 255;
    }
  }
  return m;
}

export function floodSelectMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): Uint8Array {
  const mask = new Uint8Array(Math.max(0, w * h));
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  if (w <= 0 || h <= 0 || ix < 0 || iy < 0 || ix >= w || iy >= h) return mask;
  const si = (iy * w + ix) * 4;
  const r = data[si];
  const g = data[si + 1];
  const b = data[si + 2];
  const a = data[si + 3];
  const tol = clamp(tolerance, 0, 255) * 4;

  const match = (p: number): boolean => {
    const i = p * 4;
    if (a === 0 && data[i + 3] === 0) return true;
    return (
      Math.abs(data[i] - r) +
        Math.abs(data[i + 1] - g) +
        Math.abs(data[i + 2] - b) +
        Math.abs(data[i + 3] - a) <=
      tol
    );
  };

  if (!contiguous) {
    for (let p = 0; p < w * h; p++) {
      if (match(p)) mask[p] = 255;
    }
    return mask;
  }

  const stack = [iy * w + ix];
  const seen = new Uint8Array(w * h);
  seen[stack[0]] = 1;
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (!match(p)) continue;
    mask[p] = 255;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0 && !seen[p - 1]) {
      seen[p - 1] = 1;
      stack.push(p - 1);
    }
    if (x < w - 1 && !seen[p + 1]) {
      seen[p + 1] = 1;
      stack.push(p + 1);
    }
    if (y > 0 && !seen[p - w]) {
      seen[p - w] = 1;
      stack.push(p - w);
    }
    if (y < h - 1 && !seen[p + w]) {
      seen[p + w] = 1;
      stack.push(p + w);
    }
  }
  return mask;
}

export function combineSelectionMask(oldMask: Uint8Array | null, newMask: Uint8Array, op: SelectOp): Uint8Array | null {
  const n = newMask.length;
  const out = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const o = oldMask && i < oldMask.length ? oldMask[i] : 0;
    const a = newMask[i] ? 255 : 0;
    let v = 0;
    switch (op) {
      case 'replace':
        v = a;
        break;
      case 'add':
        v = o || a ? 255 : 0;
        break;
      case 'subtract':
        v = o && !a ? 255 : 0;
        break;
      case 'intersect':
        v = o && a ? 255 : 0;
        break;
    }
    out[i] = v;
    if (v) any = true;
  }
  return any ? out : null;
}

export function invertSelectionMask(mask: Uint8Array | null, w: number, h: number): Uint8Array | null {
  const n = Math.max(0, w * h);
  if (n === 0) return null;
  const out = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const on = mask && i < mask.length ? mask[i] > 0 : false;
    out[i] = on ? 0 : 255;
    if (out[i]) any = true;
  }
  return any ? out : null;
}

export function computeSelectionEdges(mask: Uint8Array, w: number, h: number): number[] {
  const segs: number[] = [];
  if (w <= 0 || h <= 0) return segs;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 0;
  for (let y = 0; y <= h; y++) {
    let start = -1;
    let startTop = false;
    for (let x = 0; x <= w; x++) {
      const t = x < w && on(x, y - 1);
      const b = x < w && on(x, y);
      const edge = t !== b;
      if (edge && start >= 0 && t !== startTop) {
        segs.push(start, y, x, y);
        start = x;
        startTop = t;
        continue;
      }
      if (edge && start < 0) {
        start = x;
        startTop = t;
      } else if (!edge && start >= 0) {
        segs.push(start, y, x, y);
        start = -1;
      }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    let startL = false;
    for (let y = 0; y <= h; y++) {
      const l = y < h && on(x - 1, y);
      const r = y < h && on(x, y);
      const edge = l !== r;
      if (edge && start >= 0 && l !== startL) {
        segs.push(x, start, x, y);
        start = y;
        startL = l;
        continue;
      }
      if (edge && start < 0) {
        start = y;
        startL = l;
      } else if (!edge && start >= 0) {
        segs.push(x, start, x, y);
        start = -1;
      }
    }
  }
  return segs;
}

function pointInPolyUV(u: number, v: number, poly?: [number, number][]): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = (yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function masksEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] > 0) !== (b[i] > 0)) return false;
  }
  return true;
}

// ---------------- Ported PixelPad Vertical Quick Slider (Opacity Only) ----------------

class VSlider {
  el: HTMLElement;
  private track: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private label: HTMLElement;
  value: number;

  constructor(
    private opts: {
      min: number;
      max: number;
      value: number;
      title: string;
      format: (v: number) => string;
      onChange: (v: number) => void;
      fillColor?: () => string;
    },
  ) {
    this.value = opts.value;
    const titleEl = h('div', { class: 'vs-title' }, opts.title);
    this.fill = h('div', { class: 'vs-fill' });
    this.thumb = h('div', { class: 'vs-thumb' });
    this.track = h('div', { class: 'vs-track' }, this.fill, this.thumb);
    const hit = h('div', { class: 'vs-hit' }, this.track);
    this.label = h('div', { class: 'vs-label' });
    this.el = h('div', { class: 'vslider', title: opts.title }, titleEl, hit, this.label);

    let active = false;
    const upd = (e: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      if (r.height <= 0) return;
      const t = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const v = this.opts.min + t * (this.opts.max - this.opts.min);
      this.set(Math.round(v), true);
    };
    hit.addEventListener('pointerdown', (e) => {
      active = true;
      try {
        hit.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      upd(e);
      e.preventDefault();
    });
    hit.addEventListener('pointermove', (e) => {
      if (active) upd(e);
    });
    const end = () => {
      active = false;
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.set(this.value + (e.deltaY < 0 ? 1 : -1), true);
      },
      { passive: false },
    );
    this.set(opts.value);
  }

  set(v: number, emit = false): void {
    v = Math.max(this.opts.min, Math.min(this.opts.max, Math.round(v)));
    const changed = v !== this.value;
    this.value = v;
    const span = Math.max(1, this.opts.max - this.opts.min);
    const t = (v - this.opts.min) / span;
    this.fill.style.height = `${t * 100}%`;
    this.thumb.style.bottom = `${t * 100}%`;
    this.label.textContent = this.opts.format(v);
    if (this.opts.fillColor) this.fill.style.background = this.opts.fillColor();
    if (emit && changed) this.opts.onChange(v);
  }

  refreshFill(): void {
    if (this.opts.fillColor) this.fill.style.background = this.opts.fillColor();
  }
}

// ---------------- Lazy CSS Injection ----------------

function ensurePixelCanvasStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('bmeow-pixel-canvas-css')) return;
  const style = document.createElement('style');
  style.id = 'bmeow-pixel-canvas-css';
  style.textContent = `
.bmeow-px-root {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  overflow: hidden;
}
.bmeow-px-root ~ .sheet-overlay {
  z-index: 130;
}
body:has(.bmeow-px-root) #toast {
  z-index: 140;
}

.pxed-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  padding: 5px 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.pxed-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.pxed-title-tag {
  font-weight: 700;
  font-size: 13px;
  white-space: nowrap;
}
.pxed-name-input {
  width: 148px;
  max-width: 34vw;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
.pxed-name-input:focus {
  outline: none;
  border-color: var(--accent);
}
.pxed-dim-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--panel-alt);
  border: 1px solid var(--border);
  color: var(--accent);
  white-space: nowrap;
}
.pxed-top-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  flex-wrap: wrap;
}
.pxed-sep {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 2px;
  flex-shrink: 0;
}

.pxed-optbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: var(--panel-alt);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
.pxed-opt-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.pxed-opt-label {
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
  white-space: nowrap;
}
.pxed-seg {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--bg);
  padding: 2px;
  border-radius: 7px;
  border: 1px solid var(--border);
}
.pxed-chip {
  padding: 3px 7px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.pxed-chip:hover {
  color: var(--text);
  background: var(--panel-alt);
}
.pxed-chip.active {
  background: var(--accent);
  color: #fff;
}
.pxed-num-sm {
  width: 52px;
  padding: 3px 5px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
}
.pxed-tol-range {
  width: 82px;
  min-width: 60px;
}

.pxed-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.pxed-rail {
  width: 58px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}
.pxed-color-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #000;
  cursor: pointer;
  flex-shrink: 0;
  background: linear-gradient(var(--c, #000), var(--c, #000)),
    repeating-conic-gradient(#aaa 0 25%, #fff 0 50%) 0 0 / 10px 10px;
}
.pxed-color-hex {
  font-size: 9.5px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1;
}
.pxed-rail-div {
  width: 38px;
  height: 1px;
  background: var(--border);
  flex-shrink: 0;
}
.pxed-tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 48px;
  min-height: 44px;
  padding: 4px 2px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.pxed-tool-btn:hover {
  background: var(--panel-alt);
  color: var(--text);
}
.pxed-tool-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}

/* Ported PixelPad VSlider styles */
.bmeow-px-root .vslider {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 42px;
  flex-shrink: 0;
}
.bmeow-px-root .vs-title {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
.bmeow-px-root .vs-hit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  padding: 3px 0;
  cursor: pointer;
  touch-action: none;
}
.bmeow-px-root .vs-track {
  position: relative;
  width: 14px;
  height: 104px;
  border-radius: 7px;
  background: var(--bg);
  border: 1px solid var(--border);
  cursor: pointer;
  touch-action: none;
}
.bmeow-px-root .vs-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--accent);
  border-radius: 6px;
  pointer-events: none;
}
.bmeow-px-root .vs-thumb {
  position: absolute;
  left: -4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  transform: translateY(50%);
  pointer-events: none;
}
.bmeow-px-root .vs-label {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  white-space: nowrap;
}

.pxed-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--stage-bg);
  overflow: hidden;
}
.pxed-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}
.pxed-canvas.tool-hand,
.pxed-canvas.pan-hold {
  cursor: grab;
}
.pxed-canvas.pan-dragging {
  cursor: grabbing;
}
.pxed-canvas.tool-picker {
  cursor: copy;
}

.pxed-bottombar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  background: var(--panel);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.pxed-recent-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  min-width: 0;
  flex: 1;
  scrollbar-width: none;
}
.pxed-recent-wrap::-webkit-scrollbar {
  display: none;
}
.pxed-recent-swatch {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: var(--c, #000);
  flex-shrink: 0;
  cursor: pointer;
  padding: 0;
}
.pxed-recent-swatch.active {
  border: 2px solid #fff;
  box-shadow: 0 0 0 1.5px var(--accent);
}
.pxed-status-readout {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.pxed-coord-badge {
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
}
@media (max-width: 640px) {
  .pxed-rail {
    width: 52px;
    padding: 6px 2px;
  }
  .pxed-tool-btn {
    width: 44px;
    min-height: 40px;
  }
  .bmeow-px-root .vs-track {
    height: 82px;
  }
  .pxed-hint-text {
    display: none;
  }
}
`;
  document.head.appendChild(style);
}

// ---------------- Overlay Drawing Helpers ----------------

function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  vw: number,
  vh: number,
  strokeColor = 'rgba(96, 165, 250, 0.85)',
): void {
  ctx.save();
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const trText = tr(text);
  const m = ctx.measureText(trText);
  const pw = m.width + 12;
  const ph = 22;
  const r = 6;
  const bx = Math.max(4, Math.min(vw - pw - 4, x));
  const by = Math.max(4, Math.min(vh - ph - 4, y));
  ctx.fillStyle = 'rgba(20, 20, 26, 0.88)';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + pw, by, bx + pw, by + ph, r);
  ctx.arcTo(bx + pw, by + ph, bx, by + ph, r);
  ctx.arcTo(bx, by + ph, bx, by, r);
  ctx.arcTo(bx, by, bx + pw, by, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(trText, bx + 6, by + ph / 2);
  ctx.restore();
}

// ---------------- Main Full-Screen Pixel Canvas Editor ----------------

interface EditorSnapshot {
  label: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  selection: Uint8Array | null;
}

export function openPixelCanvasEditor(opts: PixelCanvasEditorOptions): () => void {
  ensurePixelCanvasStyles();

  // Ensure #toast exists in document.body BEFORE rootEl so calling toast() never appends a sibling after rootEl.
  let prevToastZ = '';
  let toastEl = typeof document !== 'undefined' ? document.getElementById('toast') : null;
  if (typeof document !== 'undefined' && !toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
  if (toastEl) {
    prevToastZ = toastEl.style.zIndex;
    toastEl.style.zIndex = '140';
  }

  let canvasW = clamp(Math.round(opts.width), 1, 256);
  let canvasH = clamp(Math.round(opts.height), 1, 256);
  let pixels = new Uint8ClampedArray(canvasW * canvasH * 4);
  if (opts.initialData) {
    pixels.set(opts.initialData.subarray(0, Math.min(opts.initialData.length, pixels.length)));
  }

  let selection: Uint8Array | null = null;
  let activeTool: PixelEditorToolId = 'pencil';
  let selectOp: SelectOp = 'replace';
  let wandTolerance = 0;
  let wandContiguous = true;
  let showGrid = true;
  let showBaseBackdrop = Boolean(opts.faceContext);

  const initialHexCol = opts.app.recentColors[0] ? parseHex(opts.app.recentColors[0]) : null;
  let activeColor: RGBA = rememberedEditorColor
    ? { ...rememberedEditorColor }
    : initialHexCol
      ? { ...initialHexCol, a: 255 }
      : { r: 56, g: 189, b: 248, a: 255 };

  const undoStack: EditorSnapshot[] = [];
  const redoStack: EditorSnapshot[] = [];

  // Viewport & interaction state
  let zoom = 12;
  let ox = 0;
  let oy = 0;
  let dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  let didInitialFit = false;
  let rafId = 0;
  let antsOffset = 0;
  let edgesCache: { sel: Uint8Array | null; w: number; h: number; segs: number[] } = {
    sel: null,
    w: 0,
    h: 0,
    segs: [],
  };

  let hoverDoc: { x: number; y: number } | null = null;
  let spacePanHold = false;
  let altHold = false;
  let activeStroke: PixelStrokeSession | null = null;
  let rectDrag: { startX: number; startY: number; curX: number; curY: number } | null = null;
  let quickPicking = false;
  let quickPickFound = false;
  let panning: { x: number; y: number; ox: number; oy: number } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: {
    dist: number;
    cx: number;
    cy: number;
    zoom: number;
    ox: number;
    oy: number;
    t: number;
    moved: boolean;
    maxCount: number;
    cancelled: boolean;
  } | null = null;

  // Offscreen pixel buffer & backdrop cache
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d')!;
  let offImgData: ImageData | null = null;
  let offDirty = true;

  let backdropCacheKey = '';
  const backdropCanvas = document.createElement('canvas');
  const backdropCtx = backdropCanvas.getContext('2d')!;
  let checkerPattern: CanvasPattern | null = null;

  // ---- UI Elements ----
  const defaultName = (opts.initialName ?? '').trim() || tr('自定义贴图');
  const nameInput = h('input', {
    type: 'text',
    class: 'pxed-name-input',
    value: defaultName,
    maxlength: 48,
    placeholder: '贴图名称',
    title: '编辑贴图名称',
  }) as HTMLInputElement;
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur();
  });

  const dimBadge = h('span', { class: 'pxed-dim-pill' }, `${canvasW}×${canvasH}`);
  const undoBtn = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      title: `撤回${formatActionHint('history.undo')}`,
      onclick: () => undo(),
    },
    icon(Undo2, 17),
  ) as HTMLButtonElement;
  const redoBtn = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      title: `重做${formatActionHint('history.redo')}`,
      onclick: () => redo(),
    },
    icon(Redo2, 17),
  ) as HTMLButtonElement;
  const gridBtn = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn on',
      title: '显隐 1px 像素网格',
      onclick: () => {
        showGrid = !showGrid;
        gridBtn.classList.toggle('on', showGrid);
        requestRender();
      },
    },
    icon(Grid3x3, 17),
  ) as HTMLButtonElement;
  const fitBtn = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      title: `适应画布视野${formatActionHint('view.fit')}`,
      onclick: () => fit(),
    },
    icon(Maximize, 17),
  ) as HTMLButtonElement;
  const cancelBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      onclick: () => close(),
    },
    icon(X, 15),
    ' 取消',
  ) as HTMLButtonElement;
  const confirmBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small primary',
      onclick: () => commitSave(),
    },
    icon(Check, 15),
    ` ${opts.confirmLabel ?? '保存贴图'}`,
  ) as HTMLButtonElement;

  const topbar = h(
    'div',
    { class: 'pxed-topbar' },
    h(
      'div',
      { class: 'pxed-title-group' },
      h('span', { class: 'pxed-title-tag' }, opts.title ?? '🎨 像素画板'),
      nameInput,
      dimBadge,
    ),
    h(
      'div',
      { class: 'pxed-top-actions' },
      undoBtn,
      redoBtn,
      h('span', { class: 'pxed-sep' }),
      gridBtn,
      fitBtn,
      h('span', { class: 'pxed-sep' }),
      cancelBtn,
      confirmBtn,
    ),
  );

  // ---- Options Strip ----
  const optBar = h('div', { class: 'pxed-optbar' });

  // ---- Left Rail: Swatch + Opacity VSlider + 6 Tools ----
  const colorBtn = h('button', {
    type: 'button',
    class: 'pxed-color-btn',
    title: '选择画笔颜色（RGBA）',
    onclick: () => openColorDialog(),
  }) as HTMLButtonElement;
  const colorHexLabel = h('span', { class: 'pxed-color-hex' });

  const opacitySlider = new VSlider({
    min: 1,
    max: 100,
    value: Math.max(1, Math.round((activeColor.a / 255) * 100)),
    title: '不透明度',
    format: (v) => `${v}%`,
    fillColor: () => `rgb(${activeColor.r},${activeColor.g},${activeColor.b})`,
    onChange: (pct) => {
      const nextA = clamp(Math.round((pct / 100) * 255), 1, 255);
      setActiveColor({ ...activeColor, a: nextA }, false);
    },
  });

  const toolDefs: { id: PixelEditorToolId; ic: IconNode; label: string; title: string }[] = [
    { id: 'pencil', ic: Pencil, label: '画笔', title: '1px 像素完美画笔（按住 Alt 点击画布快速吸色）' },
    { id: 'eraser', ic: Eraser, label: '橡皮', title: '1px 橡皮擦（支持不透明度调节与选区限制）' },
    { id: 'rect_select', ic: SquareDashed, label: '框选', title: '矩形选区（新选模式下单击 1px 可取消选区）' },
    { id: 'wand', ic: WandSparkles, label: '魔棒', title: '魔棒选区（按颜色容差选取区域）' },
    { id: 'picker', ic: Pipette, label: '吸管', title: '从画布吸取颜色' },
    { id: 'hand', ic: Hand, label: '抓手', title: '拖拽平移画布（也可按住空格或鼠标中键平移）' },
  ];
  const toolBtns = new Map<PixelEditorToolId, HTMLButtonElement>();
  const toolButtonList = toolDefs.map((td) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: `pxed-tool-btn${td.id === activeTool ? ' active' : ''}`,
        title: td.title,
        onclick: () => {
          activeTool = td.id;
          syncToolButtons();
          buildOptBar();
          updateStageCursor();
          requestRender();
        },
      },
      icon(td.ic, 18),
      h('span', {}, td.label),
    ) as HTMLButtonElement;
    toolBtns.set(td.id, btn);
    return btn;
  });

  const leftRail = h(
    'aside',
    { class: 'pxed-rail' },
    colorBtn,
    colorHexLabel,
    opacitySlider.el,
    h('div', { class: 'pxed-rail-div' }),
    ...toolButtonList,
  );

  // ---- Stage Canvas ----
  const stageEl = h('div', { class: 'pxed-stage' });
  const canvas = document.createElement('canvas');
  canvas.className = 'pxed-canvas';
  stageEl.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  // ---- Bottom Bar: Recent Colors + Live (x,y) & Zoom ----
  const recentStrip = h('div', { class: 'pxed-recent-wrap' });
  const coordReadout = h('span', { class: 'pxed-coord-badge' }, 'X: --, Y: --');
  const zoomReadout = h('span', {}, '12×');
  const bottomBar = h(
    'div',
    { class: 'pxed-bottombar' },
    recentStrip,
    h(
      'div',
      { class: 'pxed-status-readout' },
      h('span', { class: 'pxed-hint-text' }, 'Alt+画笔吸色 · 滚轮/双指缩放 · 双指点撤回 / 三指重做'),
      coordReadout,
      zoomReadout,
    ),
  );

  const rootEl = h(
    'div',
    { class: 'bmeow-px-root' },
    topbar,
    optBar,
    h('div', { class: 'pxed-body' }, leftRail, stageEl),
    bottomBar,
  );

  // ---- Core State Sync Helpers ----

  function setActiveColor(c: RGBA, syncSlider = true): void {
    activeColor = {
      r: clamp(Math.round(c.r), 0, 255),
      g: clamp(Math.round(c.g), 0, 255),
      b: clamp(Math.round(c.b), 0, 255),
      a: clamp(Math.round(c.a), 0, 255),
    };
    rememberedEditorColor = { ...activeColor };
    colorBtn.style.setProperty('--c', `rgba(${activeColor.r},${activeColor.g},${activeColor.b},${activeColor.a / 255})`);
    colorHexLabel.textContent = activeColor.a < 255 ? toHex8(activeColor) : toHex(activeColor);
    if (syncSlider) {
      opacitySlider.set(clamp(Math.round((activeColor.a / 255) * 100), 1, 100), false);
    } else {
      opacitySlider.refreshFill();
    }
    syncRecentStrip();
    requestRender();
  }

  function syncRecentStrip(): void {
    recentStrip.innerHTML = '';
    recentStrip.append(h('span', { class: 'pxed-opt-label' }, '最近'));
    const curHex = toHex(activeColor);
    for (const hex of opts.app.recentColors) {
      const upper = hex.toUpperCase();
      recentStrip.append(
        h('button', {
          type: 'button',
          class: `pxed-recent-swatch${curHex === upper ? ' active' : ''}`,
          style: `--c:${upper}`,
          title: `使用最近颜色 ${upper}`,
          onclick: () => {
            const parsed = parseHex(upper);
            if (!parsed) return;
            setActiveColor({ r: parsed.r, g: parsed.g, b: parsed.b, a: activeColor.a }, true);
          },
        }),
      );
    }
  }

  function openColorDialog(): void {
    openColorPicker(opts.app, {
      title: '选择像素画笔颜色',
      initialColor: { ...activeColor },
      allowAlpha: true,
      onPreview: (c) => setActiveColor(c, true),
      onCommit: (c) => {
        setActiveColor(c, true);
        syncRecentStrip();
      },
      onCancel: (startColor) => setActiveColor(startColor, true),
    });
  }

  function syncToolButtons(): void {
    for (const [id, btn] of toolBtns) {
      btn.classList.toggle('active', id === activeTool);
    }
  }

  function syncHistoryButtons(): void {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function updateStageCursor(): void {
    canvas.classList.toggle('pan-hold', spacePanHold);
    canvas.classList.toggle('pan-dragging', Boolean(panning));
    canvas.classList.toggle('tool-hand', activeTool === 'hand');
    canvas.classList.toggle('tool-picker', activeTool === 'picker' || (activeTool === 'pencil' && altHold));
  }

  function pushSnapshot(
    label: string,
    beforeW: number,
    beforeH: number,
    beforeData: Uint8ClampedArray,
    beforeSel: Uint8Array | null,
  ): void {
    undoStack.push({
      label,
      width: beforeW,
      height: beforeH,
      data: beforeData,
      selection: beforeSel ? new Uint8Array(beforeSel) : null,
    });
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
    redoStack.length = 0;
    syncHistoryButtons();
  }

  function applySnapshot(snap: EditorSnapshot): void {
    const sizeChanged = snap.width !== canvasW || snap.height !== canvasH;
    canvasW = snap.width;
    canvasH = snap.height;
    pixels = new Uint8ClampedArray(snap.data);
    selection = snap.selection ? new Uint8Array(snap.selection) : null;
    offDirty = true;
    dimBadge.textContent = `${canvasW}×${canvasH}`;
    if (sizeChanged) fit();
    buildOptBar();
    requestRender();
  }

  function undo(): boolean {
    const entry = undoStack.pop();
    if (!entry) {
      toast('没有可撤回的操作');
      return false;
    }
    redoStack.push({
      label: entry.label,
      width: canvasW,
      height: canvasH,
      data: new Uint8ClampedArray(pixels),
      selection: selection ? new Uint8Array(selection) : null,
    });
    applySnapshot(entry);
    syncHistoryButtons();
    toast(`已撤回: ${entry.label}`);
    return true;
  }

  function redo(): boolean {
    const entry = redoStack.pop();
    if (!entry) {
      toast('没有可重做的操作');
      return false;
    }
    undoStack.push({
      label: entry.label,
      width: canvasW,
      height: canvasH,
      data: new Uint8ClampedArray(pixels),
      selection: selection ? new Uint8Array(selection) : null,
    });
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
    applySnapshot(entry);
    syncHistoryButtons();
    toast(`已重做: ${entry.label}`);
    return true;
  }

  // ---- Selection Actions ----

  function setSelectionWithHistory(next: Uint8Array | null, label: string): void {
    if (masksEqual(selection, next)) return;
    pushSnapshot(label, canvasW, canvasH, new Uint8ClampedArray(pixels), selection);
    selection = next;
    buildOptBar();
    requestRender();
  }

  function actionSelectAll(): void {
    setSelectionWithHistory(new Uint8Array(canvasW * canvasH).fill(255), '全选画布');
  }

  function actionInvertSelection(): void {
    setSelectionWithHistory(invertSelectionMask(selection, canvasW, canvasH), '反选区域');
  }

  function actionDeselect(): void {
    if (!selection) return;
    setSelectionWithHistory(null, '取消选区');
  }

  function actionFillSelection(): void {
    const before = new Uint8ClampedArray(pixels);
    const total = canvasW * canvasH;
    let changed = false;
    for (let p = 0; p < total; p++) {
      if (selection && !selection[p]) continue;
      const i = p * 4;
      if (
        pixels[i] !== activeColor.r ||
        pixels[i + 1] !== activeColor.g ||
        pixels[i + 2] !== activeColor.b ||
        pixels[i + 3] !== activeColor.a
      ) {
        pixels[i] = activeColor.r;
        pixels[i + 1] = activeColor.g;
        pixels[i + 2] = activeColor.b;
        pixels[i + 3] = activeColor.a;
        changed = true;
      }
    }
    if (!changed) return;
    pushSnapshot('填充当前色', canvasW, canvasH, before, selection);
    offDirty = true;
    opts.app.rememberColor(toHex(activeColor));
    syncRecentStrip();
    requestRender();
  }

  function actionClearSelection(): void {
    const before = new Uint8ClampedArray(pixels);
    const total = canvasW * canvasH;
    let changed = false;
    for (let p = 0; p < total; p++) {
      if (selection && !selection[p]) continue;
      const i = p * 4;
      if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0 || pixels[i + 3] !== 0) {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
        changed = true;
      }
    }
    if (!changed) return;
    pushSnapshot('擦除选区', canvasW, canvasH, before, selection);
    offDirty = true;
    requestRender();
  }

  function actionFillTransparentWithBaseColor(): void {
    if (!opts.faceContext) return;
    const base = opts.faceContext.baseColor;
    const poly = opts.faceContext.faceSpec.clipPolyUV;
    const before = new Uint8ClampedArray(pixels);
    let changed = false;
    for (let y = 0; y < canvasH; y++) {
      const v = (y + 0.5) / canvasH;
      for (let x = 0; x < canvasW; x++) {
        const p = y * canvasW + x;
        if (selection && !selection[p]) continue;
        const i = p * 4;
        if (pixels[i + 3] !== 0) continue;
        if (poly && !pointInPolyUV((x + 0.5) / canvasW, v, poly)) continue;
        pixels[i] = clamp(Math.round(base.r), 0, 255);
        pixels[i + 1] = clamp(Math.round(base.g), 0, 255);
        pixels[i + 2] = clamp(Math.round(base.b), 0, 255);
        pixels[i + 3] = clamp(Math.round(base.a), 0, 255);
        changed = true;
      }
    }
    if (!changed) {
      toast('没有需要填充的透明像素');
      return;
    }
    pushSnapshot('底色填透明区', canvasW, canvasH, before, selection);
    offDirty = true;
    requestRender();
    toast('🪣 已用立面底色填充透明区域');
  }

  function resizeCanvasPreserveTopLeft(nextW: number, nextH: number): void {
    const nw = clamp(Math.round(nextW), 1, 256);
    const nh = clamp(Math.round(nextH), 1, 256);
    if (nw === canvasW && nh === canvasH) return;
    const beforeW = canvasW;
    const beforeH = canvasH;
    const beforeData = new Uint8ClampedArray(pixels);
    const beforeSel = selection ? new Uint8Array(selection) : null;

    const nextPixels = new Uint8ClampedArray(nw * nh * 4);
    const copyW = Math.min(beforeW, nw);
    const copyH = Math.min(beforeH, nh);
    for (let y = 0; y < copyH; y++) {
      const srcRowStart = y * beforeW * 4;
      const dstRowStart = y * nw * 4;
      nextPixels.set(beforeData.subarray(srcRowStart, srcRowStart + copyW * 4), dstRowStart);
    }

    let nextSel: Uint8Array | null = null;
    if (beforeSel) {
      const s = new Uint8Array(nw * nh);
      let any = false;
      for (let y = 0; y < copyH; y++) {
        for (let x = 0; x < copyW; x++) {
          if (beforeSel[y * beforeW + x]) {
            s[y * nw + x] = 255;
            any = true;
          }
        }
      }
      if (any) nextSel = s;
    }

    pushSnapshot(`调整尺寸 ${beforeW}×${beforeH}→${nw}×${nh}`, beforeW, beforeH, beforeData, beforeSel);
    canvasW = nw;
    canvasH = nh;
    pixels = nextPixels;
    selection = nextSel;
    offDirty = true;
    dimBadge.textContent = `${canvasW}×${canvasH}`;
    fit();
    buildOptBar();
    requestRender();
  }

  // ---- Dynamic Option Bar Builder ----

  function buildOptBar(): void {
    optBar.innerHTML = '';

    // 1. Selection Op + Wand options
    if (activeTool === 'rect_select' || activeTool === 'wand') {
      const ops: { id: SelectOp; label: string }[] = [
        { id: 'replace', label: '新选' },
        { id: 'add', label: '加选' },
        { id: 'subtract', label: '减选' },
        { id: 'intersect', label: '交集' },
      ];
      const opSeg = h(
        'div',
        { class: 'pxed-seg' },
        ...ops.map((op) =>
          h(
            'button',
            {
              type: 'button',
              class: `pxed-chip${selectOp === op.id ? ' active' : ''}`,
              onclick: () => {
                selectOp = op.id;
                buildOptBar();
              },
            },
            op.label,
          ),
        ),
      );
      optBar.append(h('div', { class: 'pxed-opt-group' }, h('span', { class: 'pxed-opt-label' }, '选区模式'), opSeg));
    }

    if (activeTool === 'wand') {
      const tolRng = h('input', {
        type: 'range',
        min: '0',
        max: '255',
        step: '1',
        value: String(wandTolerance),
        class: 'pxed-tol-range',
      }) as HTMLInputElement;
      const tolNum = h('input', {
        type: 'number',
        min: '0',
        max: '255',
        step: '1',
        value: String(wandTolerance),
        class: 'pxed-num-sm',
      }) as HTMLInputElement;
      tolRng.oninput = () => {
        wandTolerance = clamp(Math.round(+tolRng.value), 0, 255);
        tolNum.value = String(wandTolerance);
      };
      tolNum.onchange = () => {
        wandTolerance = clamp(Math.round(Number(tolNum.value) || 0), 0, 255);
        tolNum.value = String(wandTolerance);
        tolRng.value = String(wandTolerance);
      };
      tolNum.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tolNum.blur();
      });

      const contigTgl = toggle('连续', wandContiguous, (v) => {
        wandContiguous = v;
      });

      optBar.append(
        h('span', { class: 'pxed-sep' }),
        h('div', { class: 'pxed-opt-group' }, h('span', { class: 'pxed-opt-label' }, '容差'), tolRng, tolNum, contigTgl),
      );
    }

    // 2. Selection Actions (always accessible)
    const deselectBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        disabled: !selection,
        onclick: () => actionDeselect(),
      },
      '取消选区',
    ) as HTMLButtonElement;
    if (activeTool === 'rect_select' || activeTool === 'wand') {
      optBar.append(h('span', { class: 'pxed-sep' }));
    }
    optBar.append(
      h(
        'div',
        { class: 'pxed-opt-group' },
        h('span', { class: 'pxed-opt-label' }, '选区'),
        h('button', { type: 'button', class: 'btn small', onclick: () => actionSelectAll() }, '全选'),
        h('button', { type: 'button', class: 'btn small', onclick: () => actionInvertSelection() }, '反选'),
        deselectBtn,
        h('button', { type: 'button', class: 'btn small', onclick: () => actionFillSelection() }, '填充当前色'),
        h('button', { type: 'button', class: 'btn small', onclick: () => actionClearSelection() }, '擦除选区'),
      ),
    );

    // 3. Face Context Options
    if (opts.faceContext) {
      const faceBadge = h(
        'span',
        { class: 'pxed-opt-label' },
        `${opts.faceContext.faceSpec.shortLabel}`,
      );
      const backdropTgl = toggle('🧱 垫底显示立面底色', showBaseBackdrop, (v) => {
        showBaseBackdrop = v;
        requestRender();
      });
      const fillBaseBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          title: '用当前立面的基础底色填充贴图透明区域（支持撤回）',
          onclick: () => actionFillTransparentWithBaseColor(),
        },
        '🪣 底色填透明区',
      );
      optBar.append(
        h('span', { class: 'pxed-sep' }),
        h('div', { class: 'pxed-opt-group' }, faceBadge, backdropTgl, fillBaseBtn),
      );
    }

    // 4. Resize Presets & Custom W×H (when allowResize === true)
    if (opts.allowResize) {
      const presetSeg = h(
        'div',
        { class: 'pxed-seg' },
        ...RESIZE_PRESETS.map(([pw, ph]) =>
          h(
            'button',
            {
              type: 'button',
              class: `pxed-chip${canvasW === pw && canvasH === ph ? ' active' : ''}`,
              onclick: () => resizeCanvasPreserveTopLeft(pw, ph),
            },
            `${pw}×${ph}`,
          ),
        ),
      );

      const wIn = h('input', {
        type: 'number',
        min: '1',
        max: '256',
        step: '1',
        value: String(canvasW),
        class: 'pxed-num-sm',
        title: '画布宽度 (1..256)',
      }) as HTMLInputElement;
      const hIn = h('input', {
        type: 'number',
        min: '1',
        max: '256',
        step: '1',
        value: String(canvasH),
        class: 'pxed-num-sm',
        title: '画布高度 (1..256)',
      }) as HTMLInputElement;
      const applyCustomSize = () => {
        const nw = clamp(Math.round(Number(wIn.value) || canvasW), 1, 256);
        const nh = clamp(Math.round(Number(hIn.value) || canvasH), 1, 256);
        wIn.value = String(nw);
        hIn.value = String(nh);
        resizeCanvasPreserveTopLeft(nw, nh);
      };
      wIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyCustomSize();
      });
      hIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyCustomSize();
      });
      const applySizeBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          title: '应用自定义尺寸（保留左上角像素，支持撤回）',
          onclick: () => applyCustomSize(),
        },
        '应用尺寸',
      );

      optBar.append(
        h('span', { class: 'pxed-sep' }),
        h(
          'div',
          { class: 'pxed-opt-group' },
          h('span', { class: 'pxed-opt-label' }, '尺寸'),
          presetSeg,
          wIn,
          h('span', { class: 'pxed-opt-label' }, '×'),
          hIn,
          applySizeBtn,
        ),
      );
    }
  }

  // ---- Viewport Geometry & Rendering ----

  const vw = () => canvas.width / dpr;
  const vh = () => canvas.height / dpr;

  function toDoc(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - ox) / zoom,
      y: (sy - oy) / zoom,
    };
  }

  function toScreen(x: number, y: number): [number, number] {
    return [ox + x * zoom, oy + y * zoom];
  }

  function updateZoomLabel(): void {
    const zStr = zoom >= 10 ? `${Math.round(zoom)}×` : `${Math.round(zoom * 10) / 10}×`;
    zoomReadout.textContent = zStr;
  }

  function fit(): void {
    const w = vw();
    const hPx = vh();
    if (w <= 0 || hPx <= 0) return;
    const pad = 28;
    const raw = Math.min((w - pad * 2) / canvasW, (hPx - pad * 2) / canvasH);
    const z = raw >= 1 ? Math.max(1, Math.floor(raw)) : raw;
    zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    ox = (w - canvasW * zoom) / 2;
    oy = (hPx - canvasH * zoom) / 2;
    updateZoomLabel();
    requestRender();
  }

  function zoomAt(factor: number, cx = vw() / 2, cy = vh() / 2): void {
    const nz = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const dx = (cx - ox) / zoom;
    const dy = (cy - oy) / zoom;
    zoom = nz;
    ox = cx - dx * nz;
    oy = cy - dy * nz;
    updateZoomLabel();
    requestRender();
  }

  function resizeViewportCanvas(): void {
    const r = stageEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const nextDpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    const nw = Math.max(1, Math.round(r.width * nextDpr));
    const nh = Math.max(1, Math.round(r.height * nextDpr));
    const cssW = `${r.width}px`;
    const cssH = `${r.height}px`;
    if (canvas.width === nw && canvas.height === nh && dpr === nextDpr) {
      if (canvas.style.width !== cssW) canvas.style.width = cssW;
      if (canvas.style.height !== cssH) canvas.style.height = cssH;
      return;
    }
    dpr = nextDpr;
    canvas.width = nw;
    canvas.height = nh;
    canvas.style.width = cssW;
    canvas.style.height = cssH;
    if (!didInitialFit) {
      didInitialFit = true;
      fit();
      return;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    render();
  }

  function requestRender(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  function syncOffscreenBuffer(): void {
    if (!offDirty && offCanvas.width === canvasW && offCanvas.height === canvasH) return;
    if (offCanvas.width !== canvasW || offCanvas.height !== canvasH || !offImgData) {
      offCanvas.width = canvasW;
      offCanvas.height = canvasH;
      offImgData = offCtx.createImageData(canvasW, canvasH);
    }
    offImgData.data.set(pixels);
    offCtx.putImageData(offImgData, 0, 0);
    offDirty = false;
  }

  function syncFaceBackdropBuffer(): void {
    if (!opts.faceContext || !showBaseBackdrop) return;
    const bc = opts.faceContext.baseColor;
    const poly = opts.faceContext.faceSpec.clipPolyUV;
    const polyKey = poly ? poly.map(([u, v]) => `${u.toFixed(4)},${v.toFixed(4)}`).join(';') : 'full';
    const key = `${canvasW}x${canvasH}:${bc.r},${bc.g},${bc.b},${bc.a}:${polyKey}`;
    if (key === backdropCacheKey && backdropCanvas.width === canvasW && backdropCanvas.height === canvasH) return;
    backdropCacheKey = key;
    backdropCanvas.width = canvasW;
    backdropCanvas.height = canvasH;
    const img = backdropCtx.createImageData(canvasW, canvasH);
    const d = img.data;
    const r = clamp(Math.round(bc.r), 0, 255);
    const g = clamp(Math.round(bc.g), 0, 255);
    const b = clamp(Math.round(bc.b), 0, 255);
    const a = clamp(Math.round(bc.a), 0, 255);
    for (let y = 0; y < canvasH; y++) {
      const v = (y + 0.5) / canvasH;
      for (let x = 0; x < canvasW; x++) {
        if (poly && !pointInPolyUV((x + 0.5) / canvasW, v, poly)) continue;
        const i = (y * canvasW + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = a;
      }
    }
    backdropCtx.putImageData(img, 0, 0);
  }

  function render(): void {
    const viewW = vw();
    const viewH = vh();
    if (viewW <= 0 || viewH <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const stageBg = getComputedStyle(rootEl).getPropertyValue('--stage-bg').trim() || '#2a2a2e';
    ctx.fillStyle = stageBg;
    ctx.fillRect(0, 0, viewW, viewH);

    if (!checkerPattern) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const cc = c.getContext('2d')!;
      cc.fillStyle = '#d8dce3';
      cc.fillRect(0, 0, 16, 16);
      cc.fillStyle = '#b4bac6';
      cc.fillRect(0, 0, 8, 8);
      cc.fillRect(8, 8, 8, 8);
      checkerPattern = ctx.createPattern(c, 'repeat');
    }

    const dw = canvasW * zoom;
    const dh = canvasH * zoom;

    // Checkerboard under document
    ctx.save();
    ctx.translate(ox, oy);
    ctx.fillStyle = checkerPattern!;
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();

    ctx.imageSmoothingEnabled = false;

    // Optional face baseColor backdrop
    if (opts.faceContext && showBaseBackdrop) {
      syncFaceBackdropBuffer();
      ctx.drawImage(backdropCanvas, ox, oy, dw, dh);
    }

    // Main pixel buffer (nearest-neighbor)
    syncOffscreenBuffer();
    ctx.drawImage(offCanvas, ox, oy, dw, dh);

    // 1px pixel grid
    if (showGrid && zoom >= 4) {
      const intZoom = Math.abs(zoom - Math.round(zoom)) < 1e-4;
      ctx.beginPath();
      const x0 = Math.max(0, Math.floor(-ox / zoom));
      const x1 = Math.min(canvasW, Math.ceil((viewW - ox) / zoom));
      const y0 = Math.max(0, Math.floor(-oy / zoom));
      const y1 = Math.min(canvasH, Math.ceil((viewH - oy) / zoom));
      for (let x = x0; x <= x1; x++) {
        const rawX = ox + x * zoom;
        const sx = intZoom ? Math.round(rawX) + 0.5 : rawX;
        ctx.moveTo(sx, oy + y0 * zoom);
        ctx.lineTo(sx, oy + y1 * zoom);
      }
      for (let y = y0; y <= y1; y++) {
        const rawY = oy + y * zoom;
        const sy = intZoom ? Math.round(rawY) + 0.5 : rawY;
        ctx.moveTo(ox + x0 * zoom, sy);
        ctx.lineTo(ox + x1 * zoom, sy);
      }
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Face clipPolyUV exterior dimming + dashed polygon outline
    const poly = opts.faceContext?.faceSpec.clipPolyUV;
    if (poly && poly.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, dw, dh);
      poly.forEach(([u, v], idx) => {
        const sx = ox + u * dw;
        const sy = oy + v * dh;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(10, 12, 20, 0.55)';
      ctx.fill('evenodd');

      ctx.beginPath();
      poly.forEach(([u, v], idx) => {
        const sx = ox + u * dw;
        const sy = oy + v * dh;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.92)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Canvas border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, dw + 1, dh + 1);

    // Marching ants selection overlay
    if (selection) {
      if (edgesCache.sel !== selection || edgesCache.w !== canvasW || edgesCache.h !== canvasH) {
        edgesCache = {
          sel: selection,
          w: canvasW,
          h: canvasH,
          segs: computeSelectionEdges(selection, canvasW, canvasH),
        };
      }
      const s = edgesCache.segs;
      if (s.length > 0) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < s.length; i += 4) {
          const [ax, ay] = toScreen(s[i], s[i + 1]);
          const [bx, by] = toScreen(s[i + 2], s[i + 3]);
          ctx.moveTo(Math.round(ax) + 0.5, Math.round(ay) + 0.5);
          ctx.lineTo(Math.round(bx) + 0.5, Math.round(by) + 0.5);
        }
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -antsOffset;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
      }
    }

    // Hover 1px pixel preview for pencil / eraser
    if (hoverDoc && (activeTool === 'pencil' || activeTool === 'eraser') && !(activeTool === 'pencil' && altHold)) {
      const hx = Math.floor(hoverDoc.x);
      const hy = Math.floor(hoverDoc.y);
      if (hx >= 0 && hy >= 0 && hx < canvasW && hy < canvasH) {
        const [sx, sy] = toScreen(hx, hy);
        ctx.fillStyle =
          activeTool === 'eraser'
            ? 'rgba(255,255,255,0.4)'
            : `rgba(${activeColor.r},${activeColor.g},${activeColor.b},${Math.max(0.25, activeColor.a / 255) * 0.65})`;
        ctx.fillRect(sx, sy, zoom, zoom);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(1, zoom - 1), Math.max(1, zoom - 1));
      }
    }

    // Active rect_select drag overlay + live W×H badge
    if (rectDrag) {
      const minX = Math.min(rectDrag.startX, rectDrag.curX);
      const maxX = Math.max(rectDrag.startX, rectDrag.curX);
      const minY = Math.min(rectDrag.startY, rectDrag.curY);
      const maxY = Math.max(rectDrag.startY, rectDrag.curY);
      const [sx, sy] = toScreen(minX, minY);
      const [ex, ey] = toScreen(maxX + 1, maxY + 1);
      ctx.save();
      ctx.fillStyle = 'rgba(0, 150, 255, 0.16)';
      ctx.fillRect(sx, sy, ex - sx, ey - sy);
      ctx.strokeStyle = '#09f';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(sx, sy, ex - sx, ey - sy);
      ctx.restore();
      drawBadge(ctx, `宽 ${maxX - minX + 1} × 高 ${maxY - minY + 1} px`, ex + 8, ey + 8, viewW, viewH);
    }
  }

  // ---- Eyedropper & Pointer Interaction ----

  function pickColorAtDoc(docX: number, docY: number): boolean {
    const px = Math.floor(docX);
    const py = Math.floor(docY);
    if (px < 0 || py < 0 || px >= canvasW || py >= canvasH) return false;
    const i = (py * canvasW + px) * 4;
    const a = pixels[i + 3];
    if (a > 0) {
      setActiveColor({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a }, true);
      return true;
    }
    if (opts.faceContext && showBaseBackdrop) {
      const poly = opts.faceContext.faceSpec.clipPolyUV;
      if (!poly || pointInPolyUV((px + 0.5) / canvasW, (py + 0.5) / canvasH, poly)) {
        setActiveColor({ ...opts.faceContext.baseColor }, true);
        return true;
      }
    }
    return false;
  }

  function updateCoordReadout(docPt: { x: number; y: number } | null): void {
    if (!docPt) {
      coordReadout.textContent = 'X: --, Y: --';
      return;
    }
    const ix = Math.floor(docPt.x);
    const iy = Math.floor(docPt.y);
    if (ix < 0 || iy < 0 || ix >= canvasW || iy >= canvasH) {
      coordReadout.textContent = `(${ix}, ${iy})`;
    } else {
      coordReadout.textContent = `X: ${ix}, Y: ${iy}`;
    }
  }

  function localXY(e: PointerEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function reanchorGesture(isInitial: boolean): void {
    const pts = [...pointers.values()];
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    if (isInitial || !gesture) {
      gesture = {
        dist,
        cx,
        cy,
        zoom,
        ox,
        oy,
        t: performance.now(),
        moved: false,
        maxCount: pts.length,
        cancelled: false,
      };
    } else {
      gesture.dist = dist;
      gesture.cx = cx;
      gesture.cy = cy;
      gesture.zoom = zoom;
      gesture.ox = ox;
      gesture.oy = oy;
      gesture.maxCount = Math.max(gesture.maxCount, pts.length);
    }
  }

  function cancelPendingToolWork(): void {
    if (activeStroke) {
      activeStroke.cancel();
      activeStroke = null;
      offDirty = true;
      requestRender();
    }
    if (rectDrag) {
      rectDrag = null;
      requestRender();
    }
    quickPicking = false;
    quickPickFound = false;
  }

  function onPointerDown(e: PointerEvent): void {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = localXY(e);
    pointers.set(e.pointerId, p);

    if (pointers.size >= 2) {
      cancelPendingToolWork();
      panning = null;
      updateStageCursor();
      reanchorGesture(!gesture);
      return;
    }

    if (e.button === 1 || e.button === 2 || spacePanHold || activeTool === 'hand') {
      panning = { x: p.x, y: p.y, ox, oy };
      updateStageCursor();
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const docPt = toDoc(p.x, p.y);
    updateCoordReadout(docPt);

    if (activeTool === 'picker' || (activeTool === 'pencil' && e.altKey)) {
      quickPicking = true;
      quickPickFound = pickColorAtDoc(docPt.x, docPt.y);
      return;
    }

    if (activeTool === 'pencil' || activeTool === 'eraser') {
      const mode: 'paint' | 'erase' = activeTool === 'eraser' ? 'erase' : 'paint';
      const strokeColor: RGBA =
        mode === 'erase' && activeColor.a === 0 ? { ...activeColor, a: 255 } : { ...activeColor };
      activeStroke = new PixelStrokeSession(pixels, canvasW, canvasH, strokeColor, mode, selection);
      activeStroke.strokeTo(docPt.x, docPt.y);
      offDirty = true;
      requestRender();
      return;
    }

    if (activeTool === 'rect_select') {
      const ix = Math.floor(docPt.x);
      const iy = Math.floor(docPt.y);
      rectDrag = { startX: ix, startY: iy, curX: ix, curY: iy };
      requestRender();
      return;
    }

    if (activeTool === 'wand') {
      const ix = Math.floor(docPt.x);
      const iy = Math.floor(docPt.y);
      if (ix < 0 || iy < 0 || ix >= canvasW || iy >= canvasH) return;
      const m = floodSelectMask(pixels, canvasW, canvasH, ix, iy, wandTolerance, wandContiguous);
      const next = combineSelectionMask(selection, m, selectOp);
      setSelectionWithHistory(next, '魔棒选区');
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const p = localXY(e);
    const docPt = toDoc(p.x, p.y);
    if (e.pointerType !== 'touch') {
      hoverDoc = docPt;
      updateCoordReadout(docPt);
      if (!activeStroke && !rectDrag && !panning) requestRender();
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, p);

    if (gesture && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (Math.abs(dist - gesture.dist) > 10 || Math.hypot(cx - gesture.cx, cy - gesture.cy) > 10) {
        gesture.moved = true;
      }
      const nz = clamp(gesture.zoom * (dist / Math.max(1, gesture.dist)), MIN_ZOOM, MAX_ZOOM);
      const dx = (gesture.cx - gesture.ox) / gesture.zoom;
      const dy = (gesture.cy - gesture.oy) / gesture.zoom;
      zoom = nz;
      ox = cx - dx * nz;
      oy = cy - dy * nz;
      updateZoomLabel();
      requestRender();
      return;
    }

    if (panning) {
      ox = panning.ox + (p.x - panning.x);
      oy = panning.oy + (p.y - panning.y);
      requestRender();
      return;
    }

    if (quickPicking) {
      if (pickColorAtDoc(docPt.x, docPt.y)) quickPickFound = true;
      updateCoordReadout(docPt);
      return;
    }

    if (activeStroke) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const r = canvas.getBoundingClientRect();
      for (const ce of evs.length ? evs : [e]) {
        const dp = toDoc(ce.clientX - r.left, ce.clientY - r.top);
        activeStroke.strokeTo(dp.x, dp.y);
      }
      offDirty = true;
      updateCoordReadout(docPt);
      requestRender();
      return;
    }

    if (rectDrag) {
      rectDrag.curX = Math.floor(docPt.x);
      rectDrag.curY = Math.floor(docPt.y);
      updateCoordReadout(docPt);
      requestRender();
    }
  }

  function onPointerUp(e: PointerEvent, cancelled = false): void {
    const p = localXY(e);
    pointers.delete(e.pointerId);

    if (gesture) {
      if (cancelled) gesture.cancelled = true;
      if (pointers.size === 0) {
        if (
          !gesture.cancelled &&
          !gesture.moved &&
          performance.now() - gesture.t < 350 &&
          opts.app.settings.gestureUndoRedo !== false
        ) {
          if (gesture.maxCount >= 3) redo();
          else if (gesture.maxCount === 2) undo();
        }
        gesture = null;
      } else if (pointers.size >= 2) {
        reanchorGesture(false);
      }
      return;
    }

    if (panning) {
      panning = null;
      updateStageCursor();
      return;
    }

    if (quickPicking) {
      quickPicking = false;
      if (quickPickFound) {
        opts.app.rememberColor(toHex(activeColor));
        syncRecentStrip();
      }
      quickPickFound = false;
      return;
    }

    if (activeStroke) {
      const s = activeStroke;
      activeStroke = null;
      if (cancelled) {
        s.cancel();
        offDirty = true;
        requestRender();
      } else if (s.hasActualChanges()) {
        pushSnapshot(s.mode === 'erase' ? '橡皮擦擦除' : '像素画笔绘制', canvasW, canvasH, s.before, selection);
        if (s.mode === 'paint') {
          opts.app.rememberColor(toHex(activeColor));
          syncRecentStrip();
        }
      }
      if (e.pointerType === 'touch') {
        hoverDoc = null;
        updateCoordReadout(null);
      }
      return;
    }

    if (rectDrag) {
      const rd = rectDrag;
      rectDrag = null;
      if (!cancelled) {
        if (rd.startX === rd.curX && rd.startY === rd.curY && selectOp === 'replace') {
          setSelectionWithHistory(null, '取消选区');
        } else {
          const m = rectSelectMask(canvasW, canvasH, rd.startX, rd.startY, rd.curX, rd.curY);
          const next = combineSelectionMask(selection, m, selectOp);
          setSelectionWithHistory(next, '矩形选框');
        }
      }
      requestRender();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', (e) => onPointerUp(e, false));
  canvas.addEventListener('pointercancel', (e) => onPointerUp(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') {
      hoverDoc = null;
      updateCoordReadout(null);
      requestRender();
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const onWinKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Alt' && !altHold) {
      altHold = true;
      updateStageCursor();
      requestRender();
    }
  };
  const onWinKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Alt' && altHold) {
      altHold = false;
      updateStageCursor();
      requestRender();
    }
  };
  const onWinBlur = () => {
    spacePanHold = false;
    altHold = false;
    panning = null;
    pointers.clear();
    updateStageCursor();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onWinKeyDown);
    window.addEventListener('keyup', onWinKeyUp);
    window.addEventListener('blur', onWinBlur);
  }

  // ---- Marching Ants Timer, ResizeObserver & Subscriptions ----

  const antsTimer = window.setInterval(() => {
    if (selection) {
      antsOffset = (antsOffset + 1) % 16;
      requestRender();
    }
  }, 120);

  let resizeObs: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => resizeViewportCanvas());
    resizeObs.observe(stageEl);
  }

  const unsubRecent = opts.app.onRecentColors(() => syncRecentStrip());

  // ---- Shortcut Scope (blocks background 3D shortcuts; yields when ColorPicker sheet opens after rootEl) ----

  const scopeId = `pixel-canvas-editor-${++scopeSeq}`;
  const unsubScope = shortcutManager.registerScope({
    id: scopeId,
    priority: 120,
    modalBarrier: true,
    isActive: () => {
      if (!rootEl.isConnected) return false;
      let sib = rootEl.nextElementSibling;
      while (sib && sib.id === 'toast') sib = sib.nextElementSibling;
      return !sib;
    },
    triggers: {
      'history.undo': () => {
        undo();
        return true;
      },
      'history.redo': () => {
        redo();
        return true;
      },
      'view.fit': () => {
        fit();
        return true;
      },
      'view.zoomIn': () => {
        zoomAt(1.25);
        return true;
      },
      'view.zoomOut': () => {
        zoomAt(1 / 1.25);
        return true;
      },
    },
    holds: {
      'view.panHold': (active) => {
        spacePanHold = active;
        if (active && typeof document !== 'undefined' && document.activeElement instanceof HTMLButtonElement) {
          document.activeElement.blur();
        }
        updateStageCursor();
      },
    },
  });

  // ---- Lifecycle: Mount, Close, Save ----

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const idx = openSheets.indexOf(close);
    if (idx >= 0) openSheets.splice(idx, 1);

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    clearInterval(antsTimer);
    resizeObs?.disconnect();
    unsubRecent();
    unsubScope();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onWinKeyDown);
      window.removeEventListener('keyup', onWinKeyUp);
      window.removeEventListener('blur', onWinBlur);
    }
    if (toastEl) {
      toastEl.style.zIndex = prevToastZ;
    }
    rootEl.remove();
    opts.onClose?.();
  };

  function commitSave(): void {
    const cleanName = nameInput.value.trim() || defaultName;
    const outData = new Uint8ClampedArray(pixels);
    const outW = canvasW;
    const outH = canvasH;
    close();
    opts.onSave({ name: cleanName, data: outData, width: outW, height: outH });
  }

  // Initial sync & mount
  setActiveColor(activeColor, true);
  syncToolButtons();
  syncHistoryButtons();
  buildOptBar();
  updateStageCursor();

  document.body.appendChild(rootEl);
  openSheets.push(close);
  resizeViewportCanvas();

  return close;
}
