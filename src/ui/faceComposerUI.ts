// Interactive Custom Face Texture Composer:
// Matches exact face pixel dimensions (faceW x faceH), supports stacking/dragging/scaling/flipping/tiling decals,
// and live toggling between Orthogonal Rectangle and Isometric Parallelogram planes for both preview & editing.

import type { App } from '../app';
import { clamp } from '../core/color';
import { tr } from '../core/i18n';
import {
  getPlanarFaceScreenOverlay,
  type ParametricShape,
} from '../core/isoRenderer';
import {
  getAssetDisplayPixels,
  getEffectiveAssetDims,
  getPlanarFacesForShape,
  getTextureAsset,
  getTextureLibrary,
  normalizeCropRect,
  sampleFaceTextureRGBA,
  type FaceDecalItem,
  type FaceTextureSlot,
  type PlanarFaceSpec,
  type TextureCropRect,
} from '../core/textures';
import { h, openSheet, rangeRow, toast, toggle } from './dom';
import {
  bindSubCanvasNudgeScope,
  buildModalUndoRedoBar,
  createModalLiveBinding,
  makeRepeatableButton,
  type EditorNudgeAdapter,
} from './fineEditShared';
import {
  drawRgbaThumbOnCanvas,
  openActiveFacePixelEditor,
  openTextureCropDialog,
  openTextureImportDialog,
} from './textureLibraryUI';

export type ComposerPlaneMode = 'rect' | 'parallelogram';

interface PlaneAffine {
  ox: number;
  oy: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  invDet: number;
  scalePx: number;
}

function nextDecalId(): string {
  return `dec_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`;
}

export function addDecalToSlot(
  slot: FaceTextureSlot,
  assetId: string,
  faceSpec: PlanarFaceSpec,
  crop?: TextureCropRect,
): FaceDecalItem | null {
  const asset = getTextureAsset(assetId);
  if (!asset) return null;
  if (!slot.items) slot.items = [];
  const normCrop = normalizeCropRect(crop, asset.width, asset.height);
  const eff = getEffectiveAssetDims(asset, normCrop);
  const iw = eff.w;
  const ih = eff.h;
  // Center by default; if stack already exists, stagger slightly so consecutive clicks remain distinct
  const stagger = (slot.items.length % 4) * 2;
  const item: FaceDecalItem = {
    id: nextDecalId(),
    assetId: asset.id,
    ...(normCrop ? { crop: normCrop } : {}),
    x: clamp(Math.floor((faceSpec.faceW - iw) / 2) + stagger, 0, Math.max(0, faceSpec.faceW - 1)),
    y: clamp(Math.floor((faceSpec.faceH - ih) / 2) + stagger, 0, Math.max(0, faceSpec.faceH - 1)),
    w: iw,
    h: ih,
    tileFill: false,
    flipX: false,
    flipY: false,
    rot90: 0,
    opacity: 1,
    visible: true,
  };
  slot.items.push(item);
  return item;
}

function computeParallelogramBasis(
  app: App,
  shape: ParametricShape,
  faceSpec: PlanarFaceSpec,
): { rawU: [number, number]; rawV: [number, number] } {
  const { originX, originY } = app.doc.getViewOrigin();
  const ov = getPlanarFaceScreenOverlay(
    shape,
    faceSpec.id,
    app.doc.plotU,
    app.doc.plotV,
    app.doc.viewRotation,
    originX,
    originY,
  );
  if (ov && ov.visible && ov.uvOriginPx && ov.uvEndUPx && ov.uvEndVPx) {
    const ux = ov.uvEndUPx[0] - ov.uvOriginPx[0];
    const uy = ov.uvEndUPx[1] - ov.uvOriginPx[1];
    const vx = ov.uvEndVPx[0] - ov.uvOriginPx[0];
    const vy = ov.uvEndVPx[1] - ov.uvOriginPx[1];
    const det = ux * vy - uy * vx;
    if (Math.abs(det) > 8) {
      return { rawU: [ux, uy], rawV: [vx, vy] };
    }
  }
  const fw = Math.max(4, faceSpec.faceW);
  const fh = Math.max(4, faceSpec.faceH);
  if (faceSpec.defaultIsoMode === 'iso_diamond') {
    return { rawU: [fw, fw * 0.5], rawV: [-fh, fh * 0.5] };
  }
  if (faceSpec.defaultIsoMode === 'wall_up_right') {
    return { rawU: [fw, -fw * 0.5], rawV: [0, fh] };
  }
  return { rawU: [fw, fw * 0.5], rawV: [0, fh] };
}

function buildAffineMapping(
  canvasW: number,
  canvasH: number,
  pad: number,
  faceSpec: PlanarFaceSpec,
  planeMode: ComposerPlaneMode,
  app: App,
  shape: ParametricShape,
): PlaneAffine {
  let rawU: [number, number] = [faceSpec.faceW, 0];
  let rawV: [number, number] = [0, faceSpec.faceH];
  if (planeMode === 'parallelogram') {
    const basis = computeParallelogramBasis(app, shape, faceSpec);
    rawU = basis.rawU;
    rawV = basis.rawV;
  }
  const cornersX = [0, rawU[0], rawV[0], rawU[0] + rawV[0]];
  const cornersY = [0, rawU[1], rawV[1], rawU[1] + rawV[1]];
  const minX = Math.min(...cornersX);
  const maxX = Math.max(...cornersX);
  const minY = Math.min(...cornersY);
  const maxY = Math.max(...cornersY);
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const availW = Math.max(24, canvasW - pad * 2);
  const availH = Math.max(24, canvasH - pad * 2);
  const scale = Math.min(availW / spanX, availH / spanY);
  const ux = rawU[0] * scale;
  const uy = rawU[1] * scale;
  const vx = rawV[0] * scale;
  const vy = rawV[1] * scale;
  const dw = spanX * scale;
  const dh = spanY * scale;
  const ox = (canvasW - dw) * 0.5 - minX * scale;
  const oy = (canvasH - dh) * 0.5 - minY * scale;
  const det = ux * vy - uy * vx;
  return {
    ox,
    oy,
    ux,
    uy,
    vx,
    vy,
    invDet: Math.abs(det) > 1e-6 ? 1 / det : 1,
    scalePx: scale,
  };
}

function planeToCanvas(m: PlaneAffine, faceW: number, faceH: number, fx: number, fy: number): [number, number] {
  const u = fx / Math.max(1, faceW);
  const v = fy / Math.max(1, faceH);
  return [
    m.ox + u * m.ux + v * m.vx,
    m.oy + u * m.uy + v * m.vy,
  ];
}

function canvasToPlane(m: PlaneAffine, faceW: number, faceH: number, cx: number, cy: number): [number, number] {
  const rx = cx - m.ox;
  const ry = cy - m.oy;
  const u = (rx * m.vy - ry * m.vx) * m.invDet;
  const v = (m.ux * ry - m.uy * rx) * m.invDet;
  return [u * faceW, v * faceH];
}

function pointInClipPoly(poly: [number, number][] | undefined, u: number, v: number): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const hit = ((yi > v) !== (yj > v)) && (u < ((xj - xi) * (v - yi)) / (yj - yi + 1e-12) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

export interface FaceComposerOptions {
  app: App;
  getShape: () => ParametricShape | null;
  getFaceSpec: () => PlanarFaceSpec | null;
  getSlot: () => FaceTextureSlot | null;
  targetLayerId?: number;
  beforeMutate: (label: string) => void;
  afterMutate: (opts?: { live?: boolean }) => void;
  onSyncExternal?: () => void;
  canvasW?: number;
  canvasH?: number;
  compact?: boolean;
  bindCanvasShortcuts?: boolean;
}

export interface FaceComposerController {
  el: HTMLElement;
  getPlaneMode: () => ComposerPlaneMode;
  setPlaneMode: (mode: ComposerPlaneMode) => void;
  getSelectedItemId: () => string | null;
  selectItem: (id: string | null) => void;
  refresh: () => void;
  refreshCanvasOnly: () => void;
  nudgeAdapter: EditorNudgeAdapter;
  dispose: () => void;
}

export function createFaceComposerWidget(opts: FaceComposerOptions): FaceComposerController {
  const cw = opts.canvasW ?? 264;
  const ch = opts.canvasH ?? 206;
  let planeMode: ComposerPlaneMode = 'rect';
  let selectedItemId: string | null = null;
  let nudgeStepPx = 1;
  let showGrid = true;

  const canvas = h('canvas', {
    class: 'composer-canvas',
    tabindex: '0',
    title: '点击选中贴片，拖拽移动，拖动四角蓝点缩放，方向键微调',
  }) as HTMLCanvasElement;
  canvas.width = cw;
  canvas.height = ch;

  const modeBtnRect = h('button', { type: 'button', class: 'seg-btn active' }, '▭ 矩形平面');
  const modeBtnPara = h('button', { type: 'button', class: 'seg-btn' }, '▱ 平行四边形平面');
  const sizeBadge = h('span', { class: 'strip-pill' });
  const gridBtn = h('button', { type: 'button', class: 'btn mini active', title: '显隐 1px 网格线' }, '# 网格');
  const itemPropsBox = h('div', { class: 'composer-item-props' });
  const itemListBox = h('div', { class: 'composer-item-list' });
  const editFaceRow = h('div', { class: 'btn-row', style: 'margin:0;display:none' });

  let lastAffine: PlaneAffine | null = null;
  let imgDataCache: ImageData | null = null;

  const ensureSelectedValid = (slot: FaceTextureSlot | null) => {
    const items = slot?.items ?? [];
    if (items.length === 0) {
      selectedItemId = null;
      return null;
    }
    if (!selectedItemId || !items.some((it) => it.id === selectedItemId)) {
      selectedItemId = items[items.length - 1].id;
    }
    return items.find((it) => it.id === selectedItemId) ?? null;
  };

  const renderCanvas = () => {
    const shape = opts.getShape();
    const spec = opts.getFaceSpec();
    const slot = opts.getSlot();
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, cw, ch);

    // Checkerboard canvas background
    const cell = 8;
    for (let y = 0; y < ch; y += cell) {
      for (let x = 0; x < cw; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    if (!shape || !spec) return;

    sizeBadge.textContent = `${spec.shortLabel} · ${spec.faceW}×${spec.faceH} px`;
    modeBtnRect.classList.toggle('active', planeMode === 'rect');
    modeBtnPara.classList.toggle('active', planeMode === 'parallelogram');
    gridBtn.classList.toggle('active', showGrid);

    const aff = buildAffineMapping(cw, ch, 16, spec, planeMode, opts.app, shape);
    lastAffine = aff;
    const baseFaceCol = spec.isTop && shape.roofColor ? shape.roofColor : shape.baseColor;

    // Fast nearest-neighbor inverse affine rasterization directly on ImageData for crisp 0-AA pixels
    const c00 = planeToCanvas(aff, spec.faceW, spec.faceH, 0, 0);
    const c10 = planeToCanvas(aff, spec.faceW, spec.faceH, spec.faceW, 0);
    const c11 = planeToCanvas(aff, spec.faceW, spec.faceH, spec.faceW, spec.faceH);
    const c01 = planeToCanvas(aff, spec.faceW, spec.faceH, 0, spec.faceH);
    const minPx = Math.max(0, Math.floor(Math.min(c00[0], c10[0], c11[0], c01[0])));
    const maxPx = Math.min(cw - 1, Math.ceil(Math.max(c00[0], c10[0], c11[0], c01[0])));
    const minPy = Math.max(0, Math.floor(Math.min(c00[1], c10[1], c11[1], c01[1])));
    const maxPy = Math.min(ch - 1, Math.ceil(Math.max(c00[1], c10[1], c11[1], c01[1])));

    if (!imgDataCache || imgDataCache.width !== cw || imgDataCache.height !== ch) {
      imgDataCache = ctx.getImageData(0, 0, cw, ch);
    } else {
      imgDataCache.data.set(ctx.getImageData(0, 0, cw, ch).data);
    }
    const buf = imgDataCache.data;
    const items = slot?.items ?? [];
    const previewSlot: FaceTextureSlot | undefined = slot ? { ...slot, mode: 'custom', items } : undefined;

    for (let py = minPy; py <= maxPy; py++) {
      const cy = py + 0.5;
      for (let px = minPx; px <= maxPx; px++) {
        const cx = px + 0.5;
        const rx = cx - aff.ox;
        const ry = cy - aff.oy;
        const u = (rx * aff.vy - ry * aff.vx) * aff.invDet;
        const v = (aff.ux * ry - aff.uy * rx) * aff.invDet;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        if (!pointInClipPoly(spec.clipPolyUV, u, v)) continue;

        let r = baseFaceCol.r;
        let g = baseFaceCol.g;
        let b = baseFaceCol.b;
        const texCol = previewSlot ? sampleFaceTextureRGBA(previewSlot, u, v, spec.faceW, spec.faceH) : null;
        if (texCol) {
          if (texCol.a >= 250) {
            r = texCol.r; g = texCol.g; b = texCol.b;
          } else {
            const a = texCol.a / 255;
            r = Math.round(r * (1 - a) + texCol.r * a);
            g = Math.round(g * (1 - a) + texCol.g * a);
            b = Math.round(b * (1 - a) + texCol.b * a);
          }
        }
        const di = (py * cw + px) * 4;
        buf[di] = r;
        buf[di + 1] = g;
        buf[di + 2] = b;
        buf[di + 3] = 255;
      }
    }
    ctx.putImageData(imgDataCache, 0, 0);

    // Subtle 1px pixel grid overlay when cell size >= 3px
    if (showGrid && aff.scalePx >= 3 && spec.faceW <= 128 && spec.faceH <= 128) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      for (let x = 1; x < spec.faceW; x++) {
        const pTop = planeToCanvas(aff, spec.faceW, spec.faceH, x, 0);
        const pBot = planeToCanvas(aff, spec.faceW, spec.faceH, x, spec.faceH);
        ctx.beginPath();
        ctx.moveTo(pTop[0], pTop[1]);
        ctx.lineTo(pBot[0], pBot[1]);
        ctx.stroke();
      }
      for (let y = 1; y < spec.faceH; y++) {
        const pL = planeToCanvas(aff, spec.faceW, spec.faceH, 0, y);
        const pR = planeToCanvas(aff, spec.faceW, spec.faceH, spec.faceW, y);
        ctx.beginPath();
        ctx.moveTo(pL[0], pL[1]);
        ctx.lineTo(pR[0], pR[1]);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Outer face boundary & clipPoly outline
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(c00[0], c00[1]);
    ctx.lineTo(c10[0], c10[1]);
    ctx.lineTo(c11[0], c11[1]);
    ctx.lineTo(c01[0], c01[1]);
    ctx.closePath();
    ctx.stroke();

    if (spec.clipPolyUV && spec.clipPolyUV.length >= 3) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      spec.clipPolyUV.forEach(([pu, pv], idx) => {
        const sp = planeToCanvas(aff, spec.faceW, spec.faceH, pu * spec.faceW, pv * spec.faceH);
        if (idx === 0) ctx.moveTo(sp[0], sp[1]);
        else ctx.lineTo(sp[0], sp[1]);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw selected decal bounding box & 4 corner resize handles
    const selItem = ensureSelectedValid(slot);
    if (selItem) {
      const b00 = planeToCanvas(aff, spec.faceW, spec.faceH, selItem.x, selItem.y);
      const b10 = planeToCanvas(aff, spec.faceW, spec.faceH, selItem.x + selItem.w, selItem.y);
      const b11 = planeToCanvas(aff, spec.faceW, spec.faceH, selItem.x + selItem.w, selItem.y + selItem.h);
      const b01 = planeToCanvas(aff, spec.faceW, spec.faceH, selItem.x, selItem.y + selItem.h);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(b00[0], b00[1]);
      ctx.lineTo(b10[0], b10[1]);
      ctx.lineTo(b11[0], b11[1]);
      ctx.lineTo(b01[0], b01[1]);
      ctx.closePath();
      ctx.stroke();

      for (const corner of [b00, b10, b11, b01]) {
        ctx.beginPath();
        ctx.arc(corner[0], corner[1], 4.2, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  let liveTitleEl: HTMLElement | null = null;
  let liveSliderW: { set: (v: number) => void } | null = null;
  let liveSliderH: { set: (v: number) => void } | null = null;

  const formatItemTitle = (sel: FaceDecalItem, name: string, cropped: boolean) =>
    `${name}${cropped ? ' [已裁切]' : ''} · (${Math.round(sel.x)}, ${Math.round(sel.y)}) ${Math.round(sel.w)}×${Math.round(sel.h)}`;

  const syncLiveItemReadout = () => {
    const slot = opts.getSlot();
    const sel = ensureSelectedValid(slot);
    if (!sel) return;
    const asset = getTextureAsset(sel.assetId);
    if (liveTitleEl) {
      liveTitleEl.textContent = tr(formatItemTitle(sel, asset?.name ?? '贴片', Boolean(sel.crop)));
    }
    liveSliderW?.set(Math.round(sel.w));
    liveSliderH?.set(Math.round(sel.h));
  };

  const renderItemControls = () => {
    itemPropsBox.innerHTML = '';
    itemListBox.innerHTML = '';
    liveTitleEl = null;
    liveSliderW = null;
    liveSliderH = null;
    const spec = opts.getFaceSpec();
    const slot = opts.getSlot();
    if (!spec) {
      editFaceRow.style.display = 'none';
      return;
    }
    if (!slot) {
      editFaceRow.style.display = 'none';
      itemPropsBox.append(
        h('div', { class: 'hint' }, '当前平面已处于非拼图模式（点击右侧素材可重新贴入，或点「↪ 恢复」回到拼图状态）。'),
      );
      return;
    }
    const items = slot.items ?? [];
    editFaceRow.style.display = items.length > 0 ? '' : 'none';
    const sel = ensureSelectedValid(slot);

    if (!sel) {
      itemPropsBox.append(
        h('div', { class: 'hint' }, '当前拼贴平面尚无贴片。点击「纹理素材库」中任意贴图即可贴入该平面自由拼搭。'),
      );
    } else {
      const asset = getTextureAsset(sel.assetId);
      const nudgeBtn = (lbl: string, dx: number, dy: number, title: string) =>
        makeRepeatableButton(
          h('button', { type: 'button', class: 'btn mini nudge-btn', title }, lbl) as HTMLButtonElement,
          {
            onStep: () => nudgeSelected(dx, dy, !nudgePushStarted),
            onEnd: (didMutate) => {
              if (didMutate || nudgePushStarted) {
                nudgePushStarted = false;
                opts.afterMutate({ live: false });
                renderItemControls();
              }
            },
          },
        );

      liveTitleEl = h('b', { style: 'font-size:11px' }, formatItemTitle(sel, asset?.name ?? '贴片', Boolean(sel.crop)));

      const wCtrl = !opts.compact
        ? rangeRow('宽 W', 1, Math.max(8, spec.faceW * 2), Math.round(sel.w), (v) => {
            sel.w = Math.max(1, Math.round(v));
            opts.afterMutate({ live: true });
            renderCanvas();
            syncLiveItemReadout();
          }, 1, {
            onBegin: () => opts.beforeMutate('调整贴片宽度'),
            onCommit: () => { opts.afterMutate({ live: false }); renderItemControls(); },
          })
        : null;
      const hCtrl = !opts.compact
        ? rangeRow('高 H', 1, Math.max(8, spec.faceH * 2), Math.round(sel.h), (v) => {
            sel.h = Math.max(1, Math.round(v));
            opts.afterMutate({ live: true });
            renderCanvas();
            syncLiveItemReadout();
          }, 1, {
            onBegin: () => opts.beforeMutate('调整贴片高度'),
            onCommit: () => { opts.afterMutate({ live: false }); renderItemControls(); },
          })
        : null;
      liveSliderW = wCtrl;
      liveSliderH = hCtrl;

      itemPropsBox.append(
        h(
          'div',
          { class: 'composer-sel-head' },
          liveTitleEl,
          h(
            'div',
            { class: 'btn-row', style: 'margin:0;gap:3px' },
            h(
              'button',
              {
                type: 'button',
                class: `btn mini${nudgeStepPx === 1 ? ' active' : ''}`,
                onclick: () => { nudgeStepPx = 1; renderItemControls(); },
              },
              '1px',
            ),
            h(
              'button',
              {
                type: 'button',
                class: `btn mini${nudgeStepPx === 4 ? ' active' : ''}`,
                onclick: () => { nudgeStepPx = 4; renderItemControls(); },
              },
              '4px',
            ),
          ),
        ),
        h(
          'div',
          { class: 'composer-nudge-strip' },
          nudgeBtn('←', -1, 0, '左移贴片'),
          nudgeBtn('↑', 0, -1, '上移贴片'),
          nudgeBtn('↓', 0, 1, '下移贴片'),
          nudgeBtn('→', 1, 0, '右移贴片'),
          h(
            'button',
            {
              type: 'button',
              class: `btn mini${sel.flipX ? ' active' : ''}`,
              title: '水平翻转',
              onclick: () => {
                opts.beforeMutate('水平翻转贴片');
                sel.flipX = !sel.flipX;
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '↔',
          ),
          h(
            'button',
            {
              type: 'button',
              class: `btn mini${sel.flipY ? ' active' : ''}`,
              title: '垂直翻转',
              onclick: () => {
                opts.beforeMutate('垂直翻转贴片');
                sel.flipY = !sel.flipY;
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '↕',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              title: '顺时针旋转 90°（自动互换贴片宽高）',
              onclick: () => {
                opts.beforeMutate('旋转贴片 90°');
                const cx = sel.x + sel.w * 0.5;
                const cy = sel.y + sel.h * 0.5;
                const oldW = sel.w;
                const oldH = sel.h;
                sel.rot90 = (((sel.rot90 ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
                sel.w = oldH;
                sel.h = oldW;
                sel.x = Math.round(cx - sel.w * 0.5);
                sel.y = Math.round(cy - sel.h * 0.5);
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '↻90°',
          ),
          h(
            'button',
            {
              type: 'button',
              class: `btn mini${sel.tileFill ? ' active' : ''}`,
              title: '在贴片框选区域内按原像素重复平铺（不拉伸）',
              onclick: () => {
                opts.beforeMutate('切换贴片区内部平铺');
                sel.tileFill = !sel.tileFill;
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '平铺',
          ),
        ),
        wCtrl && hCtrl
          ? h('div', { class: 'composer-size-sliders' }, wCtrl.row, hCtrl.row)
          : h('span', {}),
        h(
          'div',
          { class: 'btn-row' },
          asset
            ? h(
                'button',
                {
                  type: 'button',
                  class: `btn mini${sel.crop ? ' active' : ''}`,
                  title: '裁切此贴片显示的源纹理区域',
                  onclick: () => {
                    openTextureCropDialog({
                      title: `✂️ 裁切贴片 · ${asset.name}`,
                      data: asset.rectData,
                      width: asset.width,
                      height: asset.height,
                      initialCrop: sel.crop,
                      faceSpec: spec,
                      confirmLabel: '✓ 应用裁切到贴片',
                      onConfirm: (nextCrop) => {
                        opts.beforeMutate('裁切平面贴片纹理');
                        if (nextCrop) sel.crop = nextCrop;
                        else delete sel.crop;
                        const eff = getEffectiveAssetDims(asset, sel.crop);
                        const oddRot = (sel.rot90 ?? 0) % 2 === 1;
                        sel.w = oddRot ? eff.h : eff.w;
                        sel.h = oddRot ? eff.w : eff.h;
                        opts.afterMutate({ live: false });
                        refresh();
                      },
                    });
                  },
                },
                sel.crop ? '✂️ 已裁切' : '✂️ 裁切',
              )
            : null,
          asset
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'btn mini',
                  title: '还原贴片为当前裁切区域的 1:1 像素尺寸',
                  onclick: () => {
                    opts.beforeMutate('还原贴片原始尺寸');
                    const eff = getEffectiveAssetDims(asset, sel.crop);
                    const oddRot = (sel.rot90 ?? 0) % 2 === 1;
                    sel.w = oddRot ? eff.h : eff.w;
                    sel.h = oddRot ? eff.w : eff.h;
                    opts.afterMutate({ live: false });
                    refresh();
                  },
                },
                '1:1原尺寸',
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              onclick: () => {
                const idx = items.indexOf(sel);
                if (idx >= items.length - 1) return;
                opts.beforeMutate('贴片上移一层');
                items.splice(idx, 1);
                items.splice(idx + 1, 0, sel);
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '⬆ 上移',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              onclick: () => {
                const idx = items.indexOf(sel);
                if (idx <= 0) return;
                opts.beforeMutate('贴片下移一层');
                items.splice(idx, 1);
                items.splice(idx - 1, 0, sel);
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '⬇ 下移',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              onclick: () => {
                opts.beforeMutate('复制贴片');
                const copy: FaceDecalItem = {
                  ...sel,
                  id: nextDecalId(),
                  x: clamp(sel.x + 2, -spec.faceW, spec.faceW),
                  y: clamp(sel.y + 2, -spec.faceH, spec.faceH),
                };
                items.push(copy);
                selectedItemId = copy.id;
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            '📋 复制',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini danger',
              onclick: () => {
                const idx = items.indexOf(sel);
                if (idx < 0) return;
                opts.beforeMutate('删除贴片');
                items.splice(idx, 1);
                selectedItemId = items[items.length - 1]?.id ?? null;
                opts.afterMutate({ live: false });
                refresh();
                opts.onSyncExternal?.();
              },
            },
            '🗑 删除',
          ),
        ),
      );
    }

    if (items.length > 0) {
      itemListBox.append(h('div', { class: 'hint', style: 'margin-top:2px' }, `叠加贴片列表（${items.length} · 顶部遮挡底部）`));
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const a = getTextureAsset(it.assetId);
        const thCanvas = h('canvas', { class: 'composer-row-thumb' }) as HTMLCanvasElement;
        if (a) {
          const disp = getAssetDisplayPixels({ ...a, displayForm: planeMode === 'parallelogram' ? a.displayForm : 'rect' });
          drawRgbaThumbOnCanvas(thCanvas, disp.data, disp.width, disp.height, 24, 24);
        }
        const row = h(
          'div',
          {
            class: `composer-item-row${it.id === sel?.id ? ' active' : ''}`,
            onclick: () => {
              selectedItemId = it.id;
              refresh();
            },
          },
          thCanvas,
          h('span', { class: 'composer-item-name' }, `${a?.name ?? '贴片'} (${Math.round(it.w)}×${Math.round(it.h)})`),
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                opts.beforeMutate('显隐贴片');
                it.visible = it.visible === false ? true : false;
                opts.afterMutate({ live: false });
                refresh();
              },
            },
            it.visible === false ? '🙈' : '👁',
          ),
        );
        itemListBox.append(row);
      }
    }
  };

  const refresh = () => {
    renderCanvas();
    renderItemControls();
  };

  let nudgePushStarted = false;
  const nudgeSelected = (dxSign: number, dySign: number, pushHistory: boolean): boolean => {
    const slot = opts.getSlot();
    const spec = opts.getFaceSpec();
    if (!slot || !spec) return false;
    const sel = ensureSelectedValid(slot);
    if (!sel) return false;
    const step = nudgeStepPx;
    if (pushHistory) {
      opts.beforeMutate('微调贴片位置');
      nudgePushStarted = true;
    }
    sel.x = Math.round((sel.x + dxSign * step) * 10) / 10;
    sel.y = Math.round((sel.y + dySign * step) * 10) / 10;
    opts.afterMutate({ live: true });
    renderCanvas();
    syncLiveItemReadout();
    return true;
  };

  const nudgeAdapter: EditorNudgeAdapter = {
    nudgeScreen: (dx, dy, shiftBoost, pushHistory) => {
      const slot = opts.getSlot();
      const spec = opts.getFaceSpec();
      if (!slot || !spec) return false;
      const sel = ensureSelectedValid(slot);
      if (!sel) return false;
      if (pushHistory) opts.beforeMutate('快捷键微调贴片');
      const mult = shiftBoost ? Math.max(4, nudgeStepPx * 4) : nudgeStepPx;
      sel.x = Math.round(sel.x + dx * mult);
      sel.y = Math.round(sel.y + dy * mult);
      opts.afterMutate({ live: true });
      renderCanvas();
      syncLiveItemReadout();
      return true;
    },
    commitNudge: () => {
      opts.afterMutate({ live: false });
      renderItemControls();
    },
  };

  // Pointer drag: move or resize selected decal cleanly in BOTH Rectangle and Parallelogram modes
  type DragAction =
    | { kind: 'move'; item: FaceDecalItem; startFx: number; startFy: number; origX: number; origY: number }
    | { kind: 'resize'; item: FaceDecalItem; handle: 'nw' | 'ne' | 'se' | 'sw'; origX: number; origY: number; origW: number; origH: number };
  let drag: DragAction | null = null;
  let dragHistoryPushed = false;

  const canvasCoords = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / Math.max(1, r.width)) * canvas.width,
      ((e.clientY - r.top) / Math.max(1, r.height)) * canvas.height,
    ];
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !lastAffine) return;
    canvas.focus();
    const spec = opts.getFaceSpec();
    const slot = opts.getSlot();
    if (!spec || !slot) return;
    const aff = lastAffine;
    const [cx, cy] = canvasCoords(e);
    const items = slot.items ?? [];
    const sel = ensureSelectedValid(slot);

    // 1. Check 4 corner resize handles of selected decal first
    if (sel) {
      const corners: { handle: 'nw' | 'ne' | 'se' | 'sw'; fx: number; fy: number }[] = [
        { handle: 'nw', fx: sel.x, fy: sel.y },
        { handle: 'ne', fx: sel.x + sel.w, fy: sel.y },
        { handle: 'se', fx: sel.x + sel.w, fy: sel.y + sel.h },
        { handle: 'sw', fx: sel.x, fy: sel.y + sel.h },
      ];
      for (const c of corners) {
        const [sx, sy] = planeToCanvas(aff, spec.faceW, spec.faceH, c.fx, c.fy);
        if (Math.hypot(cx - sx, cy - sy) <= 10) {
          drag = {
            kind: 'resize',
            item: sel,
            handle: c.handle,
            origX: sel.x,
            origY: sel.y,
            origW: sel.w,
            origH: sel.h,
          };
          dragHistoryPushed = false;
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // 2. Hit test decals from top to bottom in plane space
    const [fx, fy] = canvasToPlane(aff, spec.faceW, spec.faceH, cx, cy);
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.visible === false) continue;
      if (fx >= it.x && fx <= it.x + it.w && fy >= it.y && fy <= it.y + it.h) {
        selectedItemId = it.id;
        drag = {
          kind: 'move',
          item: it,
          startFx: fx,
          startFy: fy,
          origX: it.x,
          origY: it.y,
        };
        dragHistoryPushed = false;
        canvas.setPointerCapture(e.pointerId);
        refresh();
        return;
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !lastAffine) return;
    const spec = opts.getFaceSpec();
    if (!spec) return;
    const [cx, cy] = canvasCoords(e);
    const [fx, fy] = canvasToPlane(lastAffine, spec.faceW, spec.faceH, cx, cy);
    const snap = !e.altKey;

    if (!dragHistoryPushed) {
      opts.beforeMutate(drag.kind === 'move' ? '移动平面贴片' : '缩放平面贴片');
      dragHistoryPushed = true;
    }

    if (drag.kind === 'move') {
      let nx = drag.origX + (fx - drag.startFx);
      let ny = drag.origY + (fy - drag.startFy);
      if (snap) {
        nx = Math.round(nx);
        ny = Math.round(ny);
      }
      drag.item.x = clamp(nx, -spec.faceW + 1, spec.faceW * 2);
      drag.item.y = clamp(ny, -spec.faceH + 1, spec.faceH * 2);
    } else {
      const rx = snap ? Math.round(fx) : fx;
      const ry = snap ? Math.round(fy) : fy;
      const { origX, origY, origW, origH, handle } = drag;
      const rightEdge = origX + origW;
      const botEdge = origY + origH;
      if (handle === 'nw') {
        const nx = Math.min(rightEdge - 1, rx);
        const ny = Math.min(botEdge - 1, ry);
        drag.item.x = nx;
        drag.item.y = ny;
        drag.item.w = Math.max(1, rightEdge - nx);
        drag.item.h = Math.max(1, botEdge - ny);
      } else if (handle === 'ne') {
        const ny = Math.min(botEdge - 1, ry);
        drag.item.y = ny;
        drag.item.w = Math.max(1, rx - origX);
        drag.item.h = Math.max(1, botEdge - ny);
      } else if (handle === 'se') {
        drag.item.w = Math.max(1, rx - origX);
        drag.item.h = Math.max(1, ry - origY);
      } else {
        const nx = Math.min(rightEdge - 1, rx);
        drag.item.x = nx;
        drag.item.w = Math.max(1, rightEdge - nx);
        drag.item.h = Math.max(1, ry - origY);
      }
    }
    opts.afterMutate({ live: true });
    renderCanvas();
    syncLiveItemReadout();
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (dragHistoryPushed) {
      dragHistoryPushed = false;
      opts.afterMutate({ live: false });
      renderItemControls();
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  modeBtnRect.onclick = () => {
    planeMode = 'rect';
    refresh();
  };
  modeBtnPara.onclick = () => {
    planeMode = 'parallelogram';
    refresh();
  };
  gridBtn.onclick = () => {
    showGrid = !showGrid;
    refresh();
  };

  let unbindScope: () => void = () => {};
  if (opts.bindCanvasShortcuts !== false) {
    unbindScope = bindSubCanvasNudgeScope(canvas, nudgeAdapter);
  }

  editFaceRow.append(
    h(
      'button',
      {
        type: 'button',
        class: 'btn small accent',
        style: 'width:100%',
        title: '将当前拼贴平面合成为整面像素画布进行逐像素精修',
        onclick: () => {
          const shape = opts.getShape();
          const spec = opts.getFaceSpec();
          if (!shape || !spec) return;
          const layerId = opts.targetLayerId ?? opts.app.doc.layers.find((l) => l.shape === shape)?.id;
          openActiveFacePixelEditor(opts.app, {
            layerId,
            shape,
            faceId: spec.id,
            beforeMutate: (label) => opts.beforeMutate(label),
            afterMutate: () => {
              opts.afterMutate({ live: false });
              refresh();
              opts.onSyncExternal?.();
            },
          });
        },
      },
      '🖌️ 像素画布精修整面',
    ),
  );

  const rootEl = h(
    'div',
    { class: 'composer-widget' },
    h('div', { class: 'composer-top-bar' }, sizeBadge, gridBtn),
    h('div', { class: 'seg-row' }, modeBtnRect, modeBtnPara),
    canvas,
    itemPropsBox,
    itemListBox,
    editFaceRow,
  );

  refresh();

  return {
    el: rootEl,
    getPlaneMode: () => planeMode,
    setPlaneMode: (m) => { planeMode = m; refresh(); },
    getSelectedItemId: () => selectedItemId,
    selectItem: (id) => { selectedItemId = id; refresh(); },
    refresh,
    refreshCanvasOnly: () => {
      renderCanvas();
      syncLiveItemReadout();
    },
    nudgeAdapter,
    dispose: () => { unbindScope(); },
  };
}

// ---------------- Large Modal Face Puzzle Composer (with Standalone Undo / Redo & Texture Picker) ----------------

export function openFaceComposerModal(
  app: App,
  initialShape: ParametricShape,
  faceId: string,
  targetLayerId: number | undefined,
  opts: {
    beforeMutate: (label: string) => void;
    afterMutate: (options?: { live?: boolean }) => void;
    onClosed?: () => void;
  },
) {
  const binding = createModalLiveBinding(app, initialShape, targetLayerId, {
    beforeMutate: opts.beforeMutate,
    afterMutate: (o) => opts.afterMutate(o),
  });

  const getActiveShape = () => binding.getShape() ?? initialShape;

  // Read-only resolver: NEVER mutates shape state during rendering or undo/redo (H2 fix)
  const resolveSpecReadOnly = (): PlanarFaceSpec | null => {
    const shape = getActiveShape();
    if (!shape) return null;
    const faces = getPlanarFacesForShape(shape);
    return faces.find((f) => f.id === faceId) ?? faces[0] ?? null;
  };

  const resolveSlotReadOnly = (): FaceTextureSlot | null => {
    const shape = getActiveShape();
    const spec = resolveSpecReadOnly();
    if (!shape || !spec) return null;
    const slot = shape.faceTextures?.[spec.id];
    if (!slot || slot.mode !== 'custom') return null;
    return slot;
  };

  // Call ONLY inside user-triggered mutation handlers after `binding.beforeMutate(...)`
  const ensureCustomSlotForWrite = (): { shape: ParametricShape; spec: PlanarFaceSpec; slot: FaceTextureSlot } | null => {
    const shape = getActiveShape();
    const spec = resolveSpecReadOnly();
    if (!shape || !spec) return null;
    if (!shape.faceTextures) shape.faceTextures = {};
    if (!shape.faceTextures[spec.id] || shape.faceTextures[spec.id].mode !== 'custom') {
      const prev = shape.faceTextures[spec.id];
      shape.faceTextures[spec.id] = {
        mode: 'custom',
        shadeWithFace: prev?.shadeWithFace ?? true,
        items: prev?.items ? prev.items.map((x) => ({ ...x })) : [],
      };
    }
    return { shape, spec, slot: shape.faceTextures[spec.id] };
  };

  let composerCtrl: FaceComposerController | null = null;
  let modalCropOnPick = false;
  const quickPickHost = h('div', { class: 'modal-tex-quick-grid' });
  const shadeHost = h('div', {});

  const modalCropToggle = h(
    'button',
    {
      type: 'button',
      class: 'btn mini',
      title: '开启后，点选下方贴图时先框选裁切子区域再贴入平面',
      onclick: () => {
        modalCropOnPick = !modalCropOnPick;
        modalCropToggle.classList.toggle('primary', modalCropOnPick);
        modalCropToggle.textContent = tr(modalCropOnPick ? '✂️ 先裁切:开' : '✂️ 先裁切');
      },
    },
    '✂️ 先裁切',
  );

  const stampAssetWithOptionalCrop = (assetId: string, assetName: string, assetData: Uint8ClampedArray, assetW: number, assetH: number) => {
    const doInsert = (crop?: TextureCropRect) => {
      binding.beforeMutate(`贴入 ${assetName}`);
      const ctx = ensureCustomSlotForWrite();
      if (!ctx) return;
      const created = addDecalToSlot(ctx.slot, assetId, ctx.spec, crop);
      binding.afterMutate({ live: false });
      if (created) composerCtrl?.selectItem(created.id);
      composerCtrl?.refresh();
      rebuildShadeToggle();
      syncModalEditFaceBtn();
    };
    if (!modalCropOnPick) {
      doInsert();
      return;
    }
    openTextureCropDialog({
      title: `✂️ 裁切「${assetName}」后贴入平面`,
      data: assetData,
      width: assetW,
      height: assetH,
      faceSpec: resolveSpecReadOnly() ?? undefined,
      confirmLabel: '✓ 裁切并贴入',
      onConfirm: (crop) => doInsert(crop),
    });
  };

  const rebuildQuickPick = () => {
    quickPickHost.innerHTML = '';
    const assets = getTextureLibrary(true);
    for (const asset of assets) {
      const disp = getAssetDisplayPixels(asset);
      const tc = h('canvas', { class: 'tex-mini-thumb' }) as HTMLCanvasElement;
      drawRgbaThumbOnCanvas(tc, disp.data, disp.width, disp.height, 40, 34);
      quickPickHost.append(
        h(
          'button',
          {
            type: 'button',
            class: 'tex-quick-btn',
            title: `点击将「${asset.name}」(${asset.width}×${asset.height}) 贴入当前平面`,
            onclick: () => stampAssetWithOptionalCrop(asset.id, asset.name, asset.rectData, asset.width, asset.height),
          },
          tc,
          h('span', { class: 'tex-quick-name' }, asset.name),
        ),
      );
    }
  };

  const rebuildShadeToggle = () => {
    shadeHost.innerHTML = '';
    const slot = resolveSlotReadOnly();
    if (!slot) {
      shadeHost.append(h('div', { class: 'hint' }, '当前面暂未启用自定义拼图，贴入任意素材后生效。'));
      return;
    }
    shadeHost.append(
      toggle('纹理跟随立面明暗光影', slot.shadeWithFace !== false, (v) => {
        binding.beforeMutate('切换纹理光影随面着色');
        const ctx = ensureCustomSlotForWrite();
        if (!ctx) return;
        ctx.slot.shadeWithFace = v;
        binding.afterMutate({ live: false });
      }),
    );
  };

  let syncModalEditFaceBtn = () => {};

  composerCtrl = createFaceComposerWidget({
    app,
    getShape: () => getActiveShape(),
    getFaceSpec: () => resolveSpecReadOnly(),
    getSlot: () => resolveSlotReadOnly(),
    targetLayerId,
    beforeMutate: (label) => binding.beforeMutate(label),
    afterMutate: (o) => binding.afterMutate(o),
    onSyncExternal: () => syncModalEditFaceBtn(),
    canvasW: 420,
    canvasH: 340,
    compact: false,
    bindCanvasShortcuts: false,
  });

  const modalEditFaceBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small accent',
      title: '将当前拼贴平面合成为整面像素画布进行逐像素精修',
      onclick: () => {
        const shape = getActiveShape();
        const spec = resolveSpecReadOnly();
        if (!shape || !spec) return;
        openActiveFacePixelEditor(app, {
          layerId: targetLayerId,
          shape,
          faceId: spec.id,
          beforeMutate: (label) => binding.beforeMutate(label),
          afterMutate: () => {
            binding.afterMutate({ live: false });
            composerCtrl?.refresh();
            rebuildShadeToggle();
            historyBar.sync();
            syncModalEditFaceBtn();
          },
        });
      },
    },
    '🖌️ 像素画布精修整面',
  ) as HTMLButtonElement;

  syncModalEditFaceBtn = () => {
    const shape = getActiveShape();
    const spec = resolveSpecReadOnly();
    const slot = shape && spec ? shape.faceTextures?.[spec.id] : undefined;
    const hasTex = Boolean(
      slot &&
      slot.mode !== 'none' &&
      ((slot.mode === 'custom' && slot.items && slot.items.length > 0) ||
        ((slot.mode === 'stretch' || slot.mode === 'tile') && slot.assetId)),
    );
    modalEditFaceBtn.disabled = !hasTex;
  };

  const historyBar = buildModalUndoRedoBar(
    binding,
    () => {
      composerCtrl?.refresh();
      rebuildShadeToggle();
      syncModalEditFaceBtn();
    },
    [modalEditFaceBtn, h('span', { class: 'hint' }, 'Alt+拖拽可脱离 1px 吸附 · 方向键/Shift+方向键 微调选中贴片')],
    composerCtrl.nudgeAdapter,
  );

  binding.onSync((live) => {
    if (live) {
      composerCtrl?.refreshCanvasOnly();
      return;
    }
    composerCtrl?.refresh();
    rebuildShadeToggle();
    syncModalEditFaceBtn();
  });

  rebuildQuickPick();
  rebuildShadeToggle();
  syncModalEditFaceBtn();

  const layout = h(
    'div',
    { class: 'composer-modal-layout' },
    h('div', { class: 'composer-modal-left' }, composerCtrl.el),
    h(
      'div',
      { class: 'composer-modal-right' },
      h(
        'div',
        { class: 'menu-sec', style: 'margin-top:0;display:flex;justify-content:space-between;align-items:center;gap:4px' },
        '点击素材叠加',
        h(
          'div',
          { style: 'display:flex;gap:4px' },
          modalCropToggle,
          h(
            'button',
            {
              type: 'button',
              class: 'btn mini primary',
              onclick: () => openTextureImportDialog(() => rebuildQuickPick(), resolveSpecReadOnly() ?? undefined),
            },
            '+ 导入',
          ),
        ),
      ),
      quickPickHost,
      h('div', { class: 'menu-sec' }, '光照混合'),
      shadeHost,
    ),
  );

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:8px' },
    historyBar.bar,
    layout,
  );

  let close = () => {};
  const initSpec = resolveSpecReadOnly();
  close = openSheet(`🧩 自定义平面拼贴窗口 · ${initSpec?.label ?? faceId}`, body, {
    wide: true,
    onClose: () => {
      composerCtrl?.dispose();
      historyBar.dispose();
      binding.dispose();
      opts.onClosed?.();
    },
    actions: [
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          onclick: () => {
            close();
            toast('✅ 已保存自定义平面拼贴');
          },
        },
        '✓ 完成',
      ),
    ],
  });
}
