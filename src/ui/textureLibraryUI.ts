// Texture asset library grid, interactive pixel crop dialog, image importer
// (rectangle & arbitrary parallelogram unwrap + optional crop), and Pixel Meow shear <-> rectangle workshop.

import type { App } from '../app';
import { clamp } from '../core/color';
import { tr } from '../core/i18n';
import type { ParametricShape } from '../core/isoRenderer';
import {
  BUILTIN_PRESET_GROUP_ID,
  DEFAULT_USER_GROUP_ID,
  applyEditedFaceBufferToShape,
  autoDetectParallelogramCorners,
  autoTrimTransparentCrop,
  commitTextureAssetEdit,
  countTextureAssetUsage,
  createDefaultParallelogramConfig,
  createTextureGroup,
  cropRgbaBuffer,
  deleteTextureGroup,
  deshearPixels,
  extractFaceTextureLayerBuffer,
  extractImageRgbaNearest,
  getAssetDisplayPixels,
  getPlanarFacesForShape,
  getTextureGroups,
  getTextureLibraryByGroup,
  isPlanarTextureShape,
  makeTextureAssetFromRgba,
  normalizeCropRect,
  onTextureLibraryChange,
  removeTextureAsset,
  renameTextureGroup,
  resolveAssetGroupId,
  rgbaToPngDataUrl,
  setTextureAssetGroup,
  toggleTextureAssetForm,
  unwrapParallelogramPixels,
  upsertTextureAsset,
  type FaceTextureSlot,
  type ParallelogramConfig,
  type ParallelogramMode,
  type PlanarFaceSpec,
  type ShearDirection,
  type TextureAsset,
  type TextureCropRect,
  type TextureDisplayForm,
} from '../core/textures';
import { loadImage, pickFile, saveFile } from '../platform';
import { shortcutManager } from '../shortcuts/blenderShortcuts';
import { confirm2, h, openSheet, openSheets, prompt2, rangeRow, toast, toggle } from './dom';
import { addDecalToSlot } from './faceComposerUI';
import { openPixelCanvasEditor } from './pixelCanvasEditor';

const activeFaceListeners = new Set<() => void>();

export function notifyActiveFaceChanged(): void {
  for (const cb of [...activeFaceListeners]) cb();
}

function onActiveFaceChange(cb: () => void): () => void {
  activeFaceListeners.add(cb);
  return () => activeFaceListeners.delete(cb);
}

let modalScopeSeq = 0;

export function drawRgbaThumbOnCanvas(
  canvas: HTMLCanvasElement,
  data: Uint8ClampedArray,
  w: number,
  hPx: number,
  cssW = 56,
  cssH = 56,
) {
  canvas.width = cssW;
  canvas.height = cssH;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, cssW, cssH);

  // Subtle checkerboard for transparent regions
  const cell = 6;
  for (let y = 0; y < cssH; y += cell) {
    for (let x = 0; x < cssW; x += cell) {
      const alt = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
      ctx.fillStyle = alt ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, y, cell, cell);
    }
  }

  if (w <= 0 || hPx <= 0 || data.length < w * hPx * 4) return;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = hPx;
  const octx = off.getContext('2d')!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octx.putImageData(new ImageData(data as any, w, hPx), 0, 0);

  const scale = Math.max(0.1, Math.min((cssW - 6) / w, (cssH - 6) / hPx));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(hPx * scale));
  const dx = Math.floor((cssW - dw) / 2);
  const dy = Math.floor((cssH - dh) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, w, hPx, dx, dy, dw, dh);
}

async function pngBytesFromRgba(data: Uint8ClampedArray, w: number, hPx: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, hPx);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(new ImageData(data as any, w, hPx), 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

// ---------------- Interactive Pixel Crop Dialog (8 handles + presets + live preview) ----------------

export function openTextureCropDialog(opts: {
  title?: string;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  initialCrop?: TextureCropRect;
  faceSpec?: PlanarFaceSpec;
  confirmLabel?: string;
  onConfirm: (crop: TextureCropRect | undefined) => void;
}) {
  const srcW = Math.max(1, Math.round(opts.width));
  const srcH = Math.max(1, Math.round(opts.height));
  let crop: TextureCropRect = opts.initialCrop
    ? {
        x: clamp(Math.round(opts.initialCrop.x), 0, srcW - 1),
        y: clamp(Math.round(opts.initialCrop.y), 0, srcH - 1),
        w: clamp(Math.round(opts.initialCrop.w), 1, srcW - clamp(Math.round(opts.initialCrop.x), 0, srcW - 1)),
        h: clamp(Math.round(opts.initialCrop.h), 1, srcH - clamp(Math.round(opts.initialCrop.y), 0, srcH - 1)),
      }
    : { x: 0, y: 0, w: srcW, h: srcH };

  const cw = 264;
  const ch = 224;
  const srcCanvas = h('canvas', {
    class: 'tex-import-canvas',
    style: 'cursor:crosshair',
    title: '框内拖拽移动选区，拖动 8 个手柄调整裁切范围，框外按下可拉出新选区',
  }) as HTMLCanvasElement;
  srcCanvas.width = cw;
  srcCanvas.height = ch;

  const previewCanvas = h('canvas', { class: 'tex-import-canvas' }) as HTMLCanvasElement;
  const infoBadge = h('div', { class: 'hint' });

  const offSrc = document.createElement('canvas');
  offSrc.width = srcW;
  offSrc.height = srcH;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  offSrc.getContext('2d')!.putImageData(new ImageData(opts.data as any, srcW, srcH), 0, 0);

  let viewScale = 1;
  let viewOx = 0;
  let viewOy = 0;

  const clampCrop = () => {
    crop.w = clamp(Math.round(crop.w), 1, srcW);
    crop.h = clamp(Math.round(crop.h), 1, srcH);
    crop.x = clamp(Math.round(crop.x), 0, Math.max(0, srcW - crop.w));
    crop.y = clamp(Math.round(crop.y), 0, Math.max(0, srcH - crop.h));
  };

  const makeNumInput = (label: string, val: number, min: number, max: number, onSet: (v: number) => void) => {
    const inp = h('input', {
      type: 'number',
      class: 'num',
      min: String(min),
      max: String(max),
      step: '1',
      value: String(val),
      onchange: () => {
        onSet(Math.round(Number(inp.value) || 0));
      },
    }) as HTMLInputElement;
    return {
      el: h('div', { class: 'crop-num-cell' }, h('span', { class: 'rl' }, label), inp),
      inp,
    };
  };

  const xField = makeNumInput('X', crop.x, 0, Math.max(0, srcW - 1), (v) => {
    crop.x = clamp(v, 0, srcW - 1);
    crop.w = Math.min(crop.w, srcW - crop.x);
    render();
  });
  const yField = makeNumInput('Y', crop.y, 0, Math.max(0, srcH - 1), (v) => {
    crop.y = clamp(v, 0, srcH - 1);
    crop.h = Math.min(crop.h, srcH - crop.y);
    render();
  });
  const wField = makeNumInput('宽 W', crop.w, 1, srcW, (v) => {
    crop.w = clamp(v, 1, srcW - crop.x);
    render();
  });
  const hField = makeNumInput('高 H', crop.h, 1, srcH, (v) => {
    crop.h = clamp(v, 1, srcH - crop.y);
    render();
  });

  const render = () => {
    clampCrop();
    xField.inp.value = String(crop.x);
    yField.inp.value = String(crop.y);
    wField.inp.value = String(crop.w);
    hField.inp.value = String(crop.h);

    const ctx = srcCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, cw, ch);
    for (let y = 0; y < ch; y += 8) {
      for (let x = 0; x < cw; x += 8) {
        ctx.fillStyle = ((x / 8 + y / 8) & 1) === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.16)';
        ctx.fillRect(x, y, 8, 8);
      }
    }

    viewScale = Math.min((cw - 24) / srcW, (ch - 24) / srcH);
    const dw = srcW * viewScale;
    const dh = srcH * viewScale;
    viewOx = Math.floor((cw - dw) / 2);
    viewOy = Math.floor((ch - dh) / 2);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offSrc, viewOx, viewOy, dw, dh);

    // Optional pixel grid when magnified >= 4x
    if (viewScale >= 4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      for (let gx = 1; gx < srcW; gx++) {
        const px = viewOx + gx * viewScale;
        ctx.beginPath();
        ctx.moveTo(px, viewOy);
        ctx.lineTo(px, viewOy + dh);
        ctx.stroke();
      }
      for (let gy = 1; gy < srcH; gy++) {
        const py = viewOy + gy * viewScale;
        ctx.beginPath();
        ctx.moveTo(viewOx, py);
        ctx.lineTo(viewOx + dw, py);
        ctx.stroke();
      }
      ctx.restore();
    }

    const rx0 = viewOx + crop.x * viewScale;
    const ry0 = viewOy + crop.y * viewScale;
    const rwPx = crop.w * viewScale;
    const rhPx = crop.h * viewScale;
    const rx1 = rx0 + rwPx;
    const ry1 = ry0 + rhPx;

    // Dim outside area cleanly
    ctx.save();
    ctx.fillStyle = 'rgba(8, 12, 22, 0.58)';
    ctx.fillRect(viewOx, viewOy, dw, Math.max(0, ry0 - viewOy));
    ctx.fillRect(viewOx, ry1, dw, Math.max(0, viewOy + dh - ry1));
    ctx.fillRect(viewOx, ry0, Math.max(0, rx0 - viewOx), rhPx);
    ctx.fillRect(rx1, ry0, Math.max(0, viewOx + dw - rx1), rhPx);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(rx0, ry0, rwPx, rhPx);

    const handles: [number, number][] = [
      [rx0, ry0], [(rx0 + rx1) * 0.5, ry0], [rx1, ry0],
      [rx1, (ry0 + ry1) * 0.5], [rx1, ry1], [(rx0 + rx1) * 0.5, ry1],
      [rx0, ry1], [rx0, (ry0 + ry1) * 0.5],
    ];
    for (const [hx, hy] of handles) {
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.rect(hx - 3.5, hy - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    const cropped = cropRgbaBuffer(opts.data, srcW, srcH, crop);
    drawRgbaThumbOnCanvas(previewCanvas, cropped.data, cropped.width, cropped.height, 176, 176);
    const isFull = crop.x === 0 && crop.y === 0 && crop.w === srcW && crop.h === srcH;
    infoBadge.textContent = tr(
      isFull
        ? `整张原图：${srcW}×${srcH} px（未裁剪）`
        : `裁切区域：起点 (${crop.x}, ${crop.y}) · 尺寸 ${crop.w}×${crop.h} px（原图 ${srcW}×${srcH}）`,
    );
  };

  type CropDrag =
    | { kind: 'move'; startPx: [number, number]; orig: TextureCropRect }
    | { kind: 'new'; startPx: [number, number] }
    | { kind: 'handle'; idx: number; orig: TextureCropRect };
  let drag: CropDrag | null = null;

  const pointerToCanvas = (e: PointerEvent): [number, number] => {
    const r = srcCanvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / Math.max(1, r.width)) * cw,
      ((e.clientY - r.top) / Math.max(1, r.height)) * ch,
    ];
  };
  const canvasToSrcPx = (cx: number, cy: number): [number, number] => [
    clamp(Math.round((cx - viewOx) / Math.max(1e-4, viewScale)), 0, srcW),
    clamp(Math.round((cy - viewOy) / Math.max(1e-4, viewScale)), 0, srcH),
  ];

  srcCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [cx, cy] = pointerToCanvas(e);
    const rx0 = viewOx + crop.x * viewScale;
    const ry0 = viewOy + crop.y * viewScale;
    const rx1 = rx0 + crop.w * viewScale;
    const ry1 = ry0 + crop.h * viewScale;
    const handles: [number, number][] = [
      [rx0, ry0], [(rx0 + rx1) * 0.5, ry0], [rx1, ry0],
      [rx1, (ry0 + ry1) * 0.5], [rx1, ry1], [(rx0 + rx1) * 0.5, ry1],
      [rx0, ry1], [rx0, (ry0 + ry1) * 0.5],
    ];
    let hitIdx = -1;
    let bestD = 12;
    handles.forEach(([hx, hy], idx) => {
      const d = Math.hypot(cx - hx, cy - hy);
      if (d <= bestD) { bestD = d; hitIdx = idx; }
    });
    const pt = canvasToSrcPx(cx, cy);
    if (hitIdx >= 0) {
      drag = { kind: 'handle', idx: hitIdx, orig: { ...crop } };
    } else if (cx >= rx0 && cx <= rx1 && cy >= ry0 && cy <= ry1) {
      drag = { kind: 'move', startPx: pt, orig: { ...crop } };
    } else {
      drag = { kind: 'new', startPx: pt };
    }
    srcCanvas.setPointerCapture(e.pointerId);
  });

  srcCanvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [cx, cy] = pointerToCanvas(e);
    const [px, py] = canvasToSrcPx(cx, cy);
    if (drag.kind === 'move') {
      crop.x = clamp(drag.orig.x + (px - drag.startPx[0]), 0, Math.max(0, srcW - drag.orig.w));
      crop.y = clamp(drag.orig.y + (py - drag.startPx[1]), 0, Math.max(0, srcH - drag.orig.h));
      crop.w = drag.orig.w;
      crop.h = drag.orig.h;
    } else if (drag.kind === 'new') {
      const x0 = clamp(Math.min(drag.startPx[0], px), 0, srcW - 1);
      const y0 = clamp(Math.min(drag.startPx[1], py), 0, srcH - 1);
      const x1 = clamp(Math.max(drag.startPx[0], px), x0 + 1, srcW);
      const y1 = clamp(Math.max(drag.startPx[1], py), y0 + 1, srcH);
      crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else {
      const { orig, idx } = drag;
      const oR = orig.x + orig.w;
      const oB = orig.y + orig.h;
      let nx0 = orig.x, ny0 = orig.y, nx1 = oR, ny1 = oB;
      if (idx === 0 || idx === 6 || idx === 7) nx0 = clamp(px, 0, oR - 1);
      if (idx === 2 || idx === 3 || idx === 4) nx1 = clamp(px, orig.x + 1, srcW);
      if (idx === 0 || idx === 1 || idx === 2) ny0 = clamp(py, 0, oB - 1);
      if (idx === 4 || idx === 5 || idx === 6) ny1 = clamp(py, orig.y + 1, srcH);
      crop = { x: nx0, y: ny0, w: Math.max(1, nx1 - nx0), h: Math.max(1, ny1 - ny0) };
    }
    render();
  });

  const endCropDrag = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    try { srcCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  srcCanvas.addEventListener('pointerup', endCropDrag);
  srcCanvas.addEventListener('pointercancel', endCropDrag);

  const presetRow = h(
    'div',
    { class: 'btn-row' },
    h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          crop = { x: 0, y: 0, w: srcW, h: srcH };
          render();
        },
      },
      '↺ 整张原图',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          crop = autoTrimTransparentCrop(opts.data, srcW, srcH);
          render();
        },
      },
      '✨ 去透明留白',
    ),
  );

  if (opts.faceSpec) {
    const fs = opts.faceSpec;
    presetRow.append(
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          title: `保持中心点，按所选平面比例 (${fs.faceW}:${fs.faceH}) 最大裁切`,
          onclick: () => {
            const targetRatio = fs.faceW / Math.max(1, fs.faceH);
            let nw = srcW;
            let nh = Math.round(nw / targetRatio);
            if (nh > srcH) {
              nh = srcH;
              nw = Math.round(nh * targetRatio);
            }
            nw = clamp(nw, 1, srcW);
            nh = clamp(nh, 1, srcH);
            crop = {
              x: Math.floor((srcW - nw) / 2),
              y: Math.floor((srcH - nh) / 2),
              w: nw,
              h: nh,
            };
            render();
          },
        },
        `📐 适配平面比例 (${fs.faceW}:${fs.faceH})`,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          title: `直接裁出 ${fs.faceW}×${fs.faceH} px（不超过原图范围）`,
          onclick: () => {
            const nw = clamp(fs.faceW, 1, srcW);
            const nh = clamp(fs.faceH, 1, srcH);
            crop = {
              x: Math.floor((srcW - nw) / 2),
              y: Math.floor((srcH - nh) / 2),
              w: nw,
              h: nh,
            };
            render();
          },
        },
        `🎯 1:1 匹配面尺寸 (${Math.min(srcW, fs.faceW)}×${Math.min(srcH, fs.faceH)})`,
      ),
    );
  }

  render();

  const body = h(
    'div',
    { class: 'tex-import-body' },
    presetRow,
    h('div', { class: 'crop-num-grid' }, xField.el, yField.el, wField.el, hField.el),
    h(
      'div',
      { class: 'tex-preview-pair' },
      h('div', { class: 'tex-preview-col' }, h('div', { class: 'hint' }, '拖动裁切框 / 8手柄'), srcCanvas),
      h('div', { class: 'tex-preview-col' }, h('div', { class: 'hint' }, '裁切预览'), previewCanvas),
    ),
    infoBadge,
  );

  let close = () => {};
  close = openSheet(opts.title ?? '✂️ 裁切纹理区域（非破坏性）', body, {
    wide: true,
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, '取消'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          onclick: () => {
            const finalCrop = normalizeCropRect(crop, srcW, srcH);
            close();
            opts.onConfirm(finalCrop);
          },
        },
        opts.confirmLabel ?? '✓ 应用裁切',
      ),
    ],
  });
}

// ---------------- Texture Asset Library Grid ----------------

function openAssetGroupPickerSheet(asset: TextureAsset, onMoved: (nextGroupId: string) => void) {
  const currentGroupId = resolveAssetGroupId(asset);
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  let close = () => {};

  const renderChoices = () => {
    body.innerHTML = '';
    const groups = getTextureGroups().filter((g) => g.id !== BUILTIN_PRESET_GROUP_ID);
    const curGrp = groups.find((g) => g.id === currentGroupId);
    body.append(
      h('div', { class: 'hint' }, `当前所在分组：${curGrp?.name ?? '我的贴图'} · 请选择要移入的目标分组：`),
    );

    const list = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    for (const grp of groups) {
      const isCur = grp.id === currentGroupId;
      list.append(
        h(
          'button',
          {
            type: 'button',
            class: `btn${isCur ? ' primary' : ''}`,
            style: 'justify-content:space-between;width:100%',
            onclick: () => {
              if (isCur) {
                close();
                return;
              }
              if (setTextureAssetGroup(asset.id, grp.id)) {
                close();
                onMoved(grp.id);
                toast(`已将「${asset.name}」移至「${grp.name}」`);
              }
            },
          },
          h('span', {}, `📁 ${grp.name}`),
          h('span', { class: 'hint', style: isCur ? 'color:#fff' : '' }, isCur ? '当前分组' : '移入此分组'),
        ),
      );
    }
    body.append(
      list,
      h(
        'button',
        {
          type: 'button',
          class: 'btn small accent',
          style: 'align-self:flex-start;margin-top:4px',
          onclick: async () => {
            const name = await prompt2('新建分组并移入贴图', '新建分组');
            if (name === null) return;
            const created = createTextureGroup(name);
            if (setTextureAssetGroup(asset.id, created.id)) {
              close();
              onMoved(created.id);
              toast(`已新建分组「${created.name}」并移入「${asset.name}」`);
            }
          },
        },
        '+ 新建分组并移入',
      ),
    );
  };

  renderChoices();
  close = openSheet(`📁 移动「${asset.name}」到分组`, body, {
    actions: [h('button', { type: 'button', class: 'btn', onclick: () => close() }, '取消')],
  });
}

export function buildTextureLibrarySection(opts: {
  app?: App;
  selectedAssetId?: string;
  actionHint?: string;
  faceSpec?: PlanarFaceSpec;
  groupState?: { get: () => string; set: (groupId: string) => void };
  getAssetUsageCount?: (assetId: string) => number;
  onPickAsset: (asset: TextureAsset, crop?: TextureCropRect) => void;
  onAssetsChanged?: () => void;
}): HTMLElement {
  const wrap = h('div', { class: 'tex-lib-wrap' });
  const groupBar = h('div', { class: 'tex-group-bar' });
  const groupActionsRow = h('div', { class: 'tex-group-actions' });
  const grid = h('div', { class: 'tex-lib-grid' });
  let cropOnPick = false;
  let localGroupFilter = 'all';

  const getFilter = (): string => (opts.groupState ? opts.groupState.get() : localGroupFilter);
  const setFilter = (id: string) => {
    if (opts.groupState) opts.groupState.set(id);
    else localGroupFilter = id;
  };

  const resolveUserTargetGroup = (): string => {
    const f = getFilter();
    if (f === 'all' || f === BUILTIN_PRESET_GROUP_ID || f === DEFAULT_USER_GROUP_ID) {
      return DEFAULT_USER_GROUP_ID;
    }
    const custom = getTextureGroups().find((g) => g.id === f && !g.builtIn);
    return custom ? custom.id : DEFAULT_USER_GROUP_ID;
  };

  const cropToggleBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      title: '开启后，点击素材库中的贴图会先弹出裁切窗口再贴入当前模型面',
      onclick: () => {
        cropOnPick = !cropOnPick;
        cropToggleBtn.classList.toggle('primary', cropOnPick);
        cropToggleBtn.textContent = tr(cropOnPick ? '✂️ 贴入先裁切: 开' : '✂️ 贴入先裁切');
      },
    },
    '✂️ 贴入先裁切',
  );

  const pickWithOptionalCrop = (asset: TextureAsset, forceCrop: boolean) => {
    if (!forceCrop) {
      opts.onPickAsset(asset);
      return;
    }
    openTextureCropDialog({
      title: `✂️ 裁切「${asset.name}」后贴入模型面`,
      data: asset.rectData,
      width: asset.width,
      height: asset.height,
      faceSpec: opts.faceSpec,
      confirmLabel: '✓ 裁切并贴入模型面',
      onConfirm: (crop) => opts.onPickAsset(asset, crop),
    });
  };

  const renderGroupBar = () => {
    groupBar.innerHTML = '';
    groupActionsRow.innerHTML = '';
    const groups = getTextureGroups();
    let activeFilter = getFilter();
    if (activeFilter !== 'all' && !groups.some((g) => g.id === activeFilter)) {
      activeFilter = 'all';
      setFilter('all');
    }

    const allCount = getTextureLibraryByGroup('all', true).length;
    groupBar.append(
      h(
        'button',
        {
          type: 'button',
          class: `tex-group-chip${activeFilter === 'all' ? ' active' : ''}`,
          title: `全部纹理 (${allCount})`,
          onclick: () => {
            if (getFilter() === 'all') return;
            setFilter('all');
            renderGroupBar();
            renderGrid();
          },
        },
        '全部',
      ),
    );

    for (const grp of groups) {
      const count = getTextureLibraryByGroup(grp.id, true).length;
      groupBar.append(
        h(
          'button',
          {
            type: 'button',
            class: `tex-group-chip${activeFilter === grp.id ? ' active' : ''}`,
            title: `${grp.name} (${count})`,
            onclick: () => {
              if (getFilter() === grp.id) return;
              setFilter(grp.id);
              renderGroupBar();
              renderGrid();
            },
          },
          grp.name,
        ),
      );
    }

    groupBar.append(
      h(
        'button',
        {
          type: 'button',
          class: 'btn mini',
          title: '新建自定义纹理分组',
          onclick: async () => {
            const name = await prompt2('新建纹理分组', '新建分组');
            if (name === null) return;
            const trimmed = name.trim();
            if (!trimmed) {
              toast('分组名称不能为空');
              return;
            }
            const created = createTextureGroup(trimmed);
            setFilter(created.id);
            renderGroupBar();
            renderGrid();
            opts.onAssetsChanged?.();
            toast(`已新建分组「${created.name}」`);
          },
        },
        '+ 新建分组',
      ),
    );

    const activeGroup = groups.find((g) => g.id === activeFilter);
    if (activeGroup && !activeGroup.builtIn) {
      groupActionsRow.style.display = '';
      groupActionsRow.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn mini',
            title: '重命名当前自定义分组',
            onclick: async () => {
              const nextName = await prompt2('重命名纹理分组', activeGroup.name);
              if (nextName === null) return;
              const trimmed = nextName.trim();
              if (!trimmed) {
                toast('分组名称不能为空');
                return;
              }
              if (renameTextureGroup(activeGroup.id, trimmed)) {
                renderGroupBar();
                opts.onAssetsChanged?.();
                toast(`已将分组重命名为「${trimmed}」`);
              }
            },
          },
          '✎ 重命名',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn mini danger',
            title: '删除此自定义分组（贴图会安全移回「我的贴图」）',
            onclick: async () => {
              const inGroupCount = getTextureLibraryByGroup(activeGroup.id, true).length;
              const ok = await confirm2(
                '确认删除分组',
                `确定删除分组「${activeGroup.name}」吗？${inGroupCount > 0 ? `分组内的 ${inGroupCount} 张贴图不会被删除，将安全返回「我的贴图」。` : '该分组内暂无贴图。'}`,
              );
              if (!ok) return;
              setFilter(DEFAULT_USER_GROUP_ID);
              if (deleteTextureGroup(activeGroup.id)) {
                renderGroupBar();
                renderGrid();
                opts.onAssetsChanged?.();
                toast(`已删除分组「${activeGroup.name}」，贴图已移回「我的贴图」`);
              }
            },
          },
          '🗑️ 删除分组',
        ),
      );
    } else {
      groupActionsRow.style.display = 'none';
    }
  };

  const renderGrid = () => {
    grid.innerHTML = '';
    const groupsById = new Map(getTextureGroups().map((g) => [g.id, g.name]));
    const assets = getTextureLibraryByGroup(getFilter(), true);
    if (assets.length === 0) {
      grid.append(
        h(
          'div',
          { class: 'hint', style: 'grid-column:1 / -1;padding:10px 4px;text-align:center' },
          '当前分组暂无贴图，可点击「+ 导入贴图」「+ 绘制贴图」或从其他分组移入。',
        ),
      );
      return;
    }

    for (const asset of assets) {
      const disp = getAssetDisplayPixels(asset);
      const isSelected = asset.id === opts.selectedAssetId;
      const formBadge = asset.displayForm === 'parallelogram' ? '▱' : '▭';
      const thumbCanvas = h('canvas', { class: 'tex-lib-thumb' }) as HTMLCanvasElement;
      drawRgbaThumbOnCanvas(thumbCanvas, disp.data, disp.width, disp.height, 64, 52);

      const toggleFormBtn = h(
        'button',
        {
          type: 'button',
          class: `btn mini${asset.displayForm === 'parallelogram' ? ' active' : ''}`,
          title: '在 ▭ 矩形 ⇄ ▱ 平行四边形 两种形态之间无损切换',
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            toggleTextureAssetForm(asset.id);
            renderGrid();
          },
        },
        `${formBadge}⇄`,
      );

      const editBtn = opts.app
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              title: asset.builtIn
                ? '在像素画布中编辑并另存为副本（原预设保持不变）'
                : '用像素画布编辑此纹理',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                const appRef = opts.app!;
                if (asset.builtIn) {
                  const targetGroupId = resolveUserTargetGroup();
                  openPixelCanvasEditor({
                    app: appRef,
                    title: `🖌️ 基于预设「${asset.name}」绘制副本`,
                    initialName: `${asset.name} 副本`,
                    initialData: new Uint8ClampedArray(asset.rectData),
                    width: asset.width,
                    height: asset.height,
                    allowResize: true,
                    confirmLabel: '✓ 另存为新贴图',
                    onSave: (res) => {
                      const copy = makeTextureAssetFromRgba({
                        name: res.name.trim() || `${asset.name} 副本`,
                        width: res.width,
                        height: res.height,
                        rectData: res.data,
                        displayForm: asset.displayForm,
                        paraConfig: asset.paraConfig,
                        groupId: targetGroupId,
                      });
                      if (getFilter() === BUILTIN_PRESET_GROUP_ID) {
                        setFilter(targetGroupId);
                      }
                      upsertTextureAsset(copy);
                      renderGroupBar();
                      renderGrid();
                      opts.onAssetsChanged?.();
                      toast(`✅ 已将副本「${copy.name}」保存到纹理库`);
                    },
                  });
                  return;
                }

                openPixelCanvasEditor({
                  app: appRef,
                  title: `🖌️ 编辑像素纹理 · ${asset.name}`,
                  initialName: asset.name,
                  initialData: new Uint8ClampedArray(asset.rectData),
                  width: asset.width,
                  height: asset.height,
                  allowResize: true,
                  onSave: (res) => {
                    asset.name = res.name.trim() || asset.name;
                    asset.width = res.width;
                    asset.height = res.height;
                    asset.rectData = new Uint8ClampedArray(res.data);
                    asset.pngDataUrl = rgbaToPngDataUrl(asset.rectData, asset.width, asset.height);
                    commitTextureAssetEdit(asset, true);
                    renderGrid();
                    opts.onAssetsChanged?.();
                    toast(`✅ 已更新纹理「${asset.name}」(${asset.width}×${asset.height})`);
                  },
                });
              },
            },
            '🖌️',
          )
        : null;

      const cropBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn mini',
          title: '裁切此贴图的局部区域再贴入模型面',
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            pickWithOptionalCrop(asset, true);
          },
        },
        '✂',
      );

      const shearBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn mini',
          title: '打开 Pixel Meow 斜切 / 平行四边形互转工坊',
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            openTextureShearDialog(asset, () => {
              renderGrid();
              opts.onAssetsChanged?.();
            });
          },
        },
        '斜切',
      );

      const moveGroupBtn = !asset.builtIn
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn mini',
              title: '移动到其他纹理分组',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                openAssetGroupPickerSheet(asset, () => {
                  renderGroupBar();
                  renderGrid();
                  opts.onAssetsChanged?.();
                });
              },
            },
            '📁',
          )
        : null;

      const delBtn = !asset.builtIn
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn mini danger',
              title: '删除自定义贴图',
              onclick: async (e: MouseEvent) => {
                e.stopPropagation();
                const refs = opts.getAssetUsageCount?.(asset.id) ?? 0;
                if (refs > 0) {
                  const ok = await confirm2(
                    '确认删除贴图',
                    `贴图「${asset.name}」当前被模型上的 ${refs} 处平面引用，删除后对应平面贴图将不再显示。确定删除吗？`,
                  );
                  if (!ok) return;
                }
                removeTextureAsset(asset.id);
                renderGroupBar();
                renderGrid();
                opts.onAssetsChanged?.();
                toast(`已删除贴图「${asset.name}」`);
              },
            },
            '✕',
          )
        : null;

      const grpName = groupsById.get(resolveAssetGroupId(asset)) ?? '我的贴图';
      const card = h(
        'div',
        {
          class: `tex-lib-card${isSelected ? ' active' : ''}`,
          title: `${asset.name}${asset.projectScoped ? ' (当前工程内嵌)' : ''} [${grpName}] (${disp.width}×${disp.height} px · ${asset.displayForm === 'parallelogram' ? '平行四边形形态' : '矩形形态'})\n点击应用到当前平面`,
          onclick: () => pickWithOptionalCrop(asset, cropOnPick),
        },
        h(
          'div',
          { class: 'tex-lib-thumb-box' },
          thumbCanvas,
          asset.projectScoped ? h('span', { class: 'tex-lib-proj-tag' }, '工程') : null,
          h('span', { class: 'tex-lib-dim' }, `${disp.width}×${disp.height}`),
        ),
        h('div', { class: 'tex-lib-name' }, asset.name),
        h(
          'div',
          { class: 'tex-lib-actions', style: 'flex-wrap:wrap' },
          toggleFormBtn,
          editBtn,
          cropBtn,
          shearBtn,
          moveGroupBtn,
          delBtn,
        ),
      );
      grid.append(card);
    }
  };

  const importBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small primary',
      onclick: () => {
        const targetGroupId = resolveUserTargetGroup();
        openTextureImportDialog(
          (created) => {
            if (getFilter() === BUILTIN_PRESET_GROUP_ID) {
              setFilter(targetGroupId);
            }
            renderGroupBar();
            renderGrid();
            opts.onAssetsChanged?.();
            pickWithOptionalCrop(created, cropOnPick);
          },
          opts.faceSpec,
          targetGroupId,
        );
      },
    },
    '+ 导入贴图',
  );

  const drawBtn = opts.app
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn small accent',
          title: '打开像素画布绘制新纹理并保存到当前分组',
          onclick: () => {
            const initW = opts.faceSpec ? clamp(Math.round(opts.faceSpec.faceW), 8, 64) : 16;
            const initH = opts.faceSpec ? clamp(Math.round(opts.faceSpec.faceH), 8, 64) : 16;
            const targetGroupId = resolveUserTargetGroup();
            openPixelCanvasEditor({
              app: opts.app!,
              title: '🖌️ 绘制新像素纹理',
              initialName: '手绘像素纹理',
              width: initW,
              height: initH,
              allowResize: true,
              onSave: (res) => {
                const created = makeTextureAssetFromRgba({
                  name: res.name.trim() || '手绘像素纹理',
                  width: res.width,
                  height: res.height,
                  rectData: res.data,
                  groupId: targetGroupId,
                });
                if (getFilter() === BUILTIN_PRESET_GROUP_ID) {
                  setFilter(targetGroupId);
                }
                upsertTextureAsset(created);
                renderGroupBar();
                renderGrid();
                opts.onAssetsChanged?.();
                toast(`✅ 已新建像素纹理「${created.name}」(${created.width}×${created.height})`);
              },
            });
          },
        },
        '+ 绘制贴图',
      )
    : null;

  renderGroupBar();
  renderGrid();
  wrap.append(
    h(
      'div',
      { class: 'tex-lib-head' },
      h('span', { class: 'hint' }, opts.actionHint ?? '点击素材应用；支持 ▭⇄▱ 切换、裁切与斜切互转'),
      h('div', { class: 'btn-row', style: 'margin:0;flex-wrap:wrap' }, importBtn, drawBtn, cropToggleBtn),
    ),
    groupBar,
    groupActionsRow,
    grid,
  );
  return wrap;
}

// ---------------- Custom Texture Importer (Rectangle & Arbitrary Parallelogram Unwrap + Optional Crop) ----------------

export function openTextureImportDialog(
  onImported: (asset: TextureAsset) => void,
  faceSpec?: PlanarFaceSpec,
  defaultGroupId?: string,
) {
  let srcData: Uint8ClampedArray | null = null;
  let srcW = 0;
  let srcH = 0;
  let name = '自定义贴图';

  let importKind: TextureDisplayForm = 'rect';
  let rectTargetScale = 1;
  let paraMethod: 'sawtooth' | 'quad' = 'sawtooth';
  let sawDir: ShearDirection = 'down_right';
  let sawStep = 2;

  let p00: [number, number] = [0, 0];
  let p10: [number, number] = [16, 0];
  let p01: [number, number] = [0, 16];
  let quadOutW = 16;
  let quadOutH = 16;
  let autoQuadOut = true;
  let pendingCrop: TextureCropRect | undefined;

  const nameIn = h('input', {
    type: 'text',
    class: 'text-input',
    value: name,
    placeholder: '贴图名称',
    oninput: () => { name = nameIn.value.trim() || '自定义贴图'; },
  }) as HTMLInputElement;

  const srcInfo = h('div', { class: 'hint' }, '尚未载入图像：可选择本地 PNG/JPG，或直接拖拽 / Ctrl+V 粘贴图片。');
  const controlsHost = h('div', { class: 'tex-import-controls' });
  const srcCanvas = h('canvas', { class: 'tex-import-canvas' }) as HTMLCanvasElement;
  const outCanvas = h('canvas', { class: 'tex-import-canvas' }) as HTMLCanvasElement;
  const outBadge = h('div', { class: 'hint' }, '');
  const cropOutBtn = h('button', { type: 'button', class: 'btn small', disabled: true }, '✂️ 裁切导入区域') as HTMLButtonElement;
  const clearCropBtn = h('button', { type: 'button', class: 'btn small', style: 'display:none' }, '↺ 取消裁切') as HTMLButtonElement;
  const confirmBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, '✓ 存入纹理素材库') as HTMLButtonElement;

  const computeUnwrappedRaw = (): {
    rectData: Uint8ClampedArray;
    width: number;
    height: number;
    paraConfig: ParallelogramConfig;
    displayForm: TextureDisplayForm;
  } | null => {
    if (!srcData || srcW <= 0 || srcH <= 0) return null;
    if (importKind === 'rect') {
      const tw = clamp(Math.round(srcW * rectTargetScale), 1, 256);
      const th = clamp(Math.round(srcH * rectTargetScale), 1, 256);
      const out = new Uint8ClampedArray(tw * th * 4);
      for (let y = 0; y < th; y++) {
        const sy = clamp(Math.floor((y / th) * srcH), 0, srcH - 1);
        for (let x = 0; x < tw; x++) {
          const sx = clamp(Math.floor((x / tw) * srcW), 0, srcW - 1);
          const si = (sy * srcW + sx) * 4;
          const di = (y * tw + x) * 4;
          out[di] = srcData[si];
          out[di + 1] = srcData[si + 1];
          out[di + 2] = srcData[si + 2];
          out[di + 3] = srcData[si + 3];
        }
      }
      return {
        rectData: out,
        width: tw,
        height: th,
        paraConfig: createDefaultParallelogramConfig(tw, th, 'down_right', 2),
        displayForm: 'rect',
      };
    }

    if (paraMethod === 'sawtooth') {
      const res = deshearPixels(srcData, srcW, srcH, sawDir, sawStep);
      return {
        rectData: res.data,
        width: res.width,
        height: res.height,
        paraConfig: createDefaultParallelogramConfig(res.width, res.height, sawDir, sawStep),
        displayForm: 'parallelogram',
      };
    }

    const ux = p10[0] - p00[0];
    const uy = p10[1] - p00[1];
    const vx = p01[0] - p00[0];
    const vy = p01[1] - p00[1];
    const targetW = autoQuadOut ? Math.max(2, Math.round(Math.hypot(ux, uy))) : clamp(Math.round(quadOutW), 1, 256);
    const targetH = autoQuadOut ? Math.max(2, Math.round(Math.hypot(vx, vy))) : clamp(Math.round(quadOutH), 1, 256);
    const res = unwrapParallelogramPixels(srcData, srcW, srcH, p00, p10, p01, targetW, targetH);
    return {
      rectData: res.data,
      width: res.width,
      height: res.height,
      paraConfig: {
        mode: 'custom_vectors',
        direction: res.uVec[1] < 0 ? 'up_right' : 'down_right',
        step: 2,
        uVec: res.uVec,
        vVec: res.vVec,
      },
      displayForm: 'parallelogram',
    };
  };

  const computeUnwrapped = () => {
    const raw = computeUnwrappedRaw();
    if (!raw) return null;
    const normCrop = normalizeCropRect(pendingCrop, raw.width, raw.height);
    if (!normCrop) return raw;
    const cropped = cropRgbaBuffer(raw.rectData, raw.width, raw.height, normCrop);
    return {
      rectData: cropped.data,
      width: cropped.width,
      height: cropped.height,
      paraConfig: createDefaultParallelogramConfig(cropped.width, cropped.height, raw.paraConfig.direction, raw.paraConfig.step),
      displayForm: raw.displayForm,
    };
  };

  let srcViewScale = 1;
  let srcViewOx = 0;
  let srcViewOy = 0;

  const drawPreviews = () => {
    const cw = 210;
    const ch = 175;
    srcCanvas.width = cw;
    srcCanvas.height = ch;
    const sctx = srcCanvas.getContext('2d')!;
    sctx.clearRect(0, 0, cw, ch);
    for (let y = 0; y < ch; y += 8) {
      for (let x = 0; x < cw; x += 8) {
        sctx.fillStyle = ((x / 8 + y / 8) & 1) === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)';
        sctx.fillRect(x, y, 8, 8);
      }
    }

    if (srcData && srcW > 0 && srcH > 0) {
      const off = document.createElement('canvas');
      off.width = srcW;
      off.height = srcH;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      off.getContext('2d')!.putImageData(new ImageData(srcData as any, srcW, srcH), 0, 0);
      srcViewScale = Math.min((cw - 20) / srcW, (ch - 20) / srcH);
      const dw = srcW * srcViewScale;
      const dh = srcH * srcViewScale;
      srcViewOx = Math.floor((cw - dw) / 2);
      srcViewOy = Math.floor((ch - dh) / 2);
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(off, srcViewOx, srcViewOy, dw, dh);

      if (importKind === 'parallelogram' && paraMethod === 'quad') {
        const toCan = (p: [number, number]): [number, number] => [
          srcViewOx + p[0] * srcViewScale,
          srcViewOy + p[1] * srcViewScale,
        ];
        const q00 = toCan(p00);
        const q10 = toCan(p10);
        const q01 = toCan(p01);
        const q11: [number, number] = [q10[0] + q01[0] - q00[0], q10[1] + q01[1] - q00[1]];
        sctx.strokeStyle = '#38bdf8';
        sctx.lineWidth = 1.5;
        sctx.setLineDash([4, 3]);
        sctx.beginPath();
        sctx.moveTo(q00[0], q00[1]);
        sctx.lineTo(q10[0], q10[1]);
        sctx.lineTo(q11[0], q11[1]);
        sctx.lineTo(q01[0], q01[1]);
        sctx.closePath();
        sctx.stroke();
        sctx.setLineDash([]);

        const handles: { pt: [number, number]; col: string }[] = [
          { pt: q00, col: '#22d3ee' },
          { pt: q10, col: '#fbbf24' },
          { pt: q01, col: '#f472b6' },
        ];
        for (const hnd of handles) {
          sctx.beginPath();
          sctx.arc(hnd.pt[0], hnd.pt[1], 5, 0, Math.PI * 2);
          sctx.fillStyle = hnd.col;
          sctx.fill();
          sctx.strokeStyle = '#0f172a';
          sctx.lineWidth = 1.5;
          sctx.stroke();
        }
      }
    }

    const res = computeUnwrapped();
    confirmBtn.disabled = !res;
    cropOutBtn.disabled = !res;
    clearCropBtn.style.display = pendingCrop ? '' : 'none';
    if (res) {
      drawRgbaThumbOnCanvas(outCanvas, res.rectData, res.width, res.height, cw, ch);
      outBadge.textContent = tr(`规范矩形底图：${res.width}×${res.height} px${pendingCrop ? `（已裁切 ${pendingCrop.w}×${pendingCrop.h}）` : ''}（库中可随时 ▭⇄▱ 无损切换）`);
    } else {
      drawRgbaThumbOnCanvas(outCanvas, new Uint8ClampedArray(0), 0, 0, cw, ch);
      outBadge.textContent = '';
    }
  };

  cropOutBtn.onclick = () => {
    const raw = computeUnwrappedRaw();
    if (!raw) return;
    openTextureCropDialog({
      title: '✂️ 裁切导入贴图区域',
      data: raw.rectData,
      width: raw.width,
      height: raw.height,
      initialCrop: pendingCrop,
      faceSpec,
      confirmLabel: '✓ 确认裁切范围',
      onConfirm: (next) => {
        pendingCrop = next;
        drawPreviews();
      },
    });
  };
  clearCropBtn.onclick = () => {
    pendingCrop = undefined;
    drawPreviews();
  };

  let dragCorner: 'p00' | 'p10' | 'p01' | null = null;
  srcCanvas.addEventListener('pointerdown', (e) => {
    if (!srcData || importKind !== 'parallelogram' || paraMethod !== 'quad') return;
    const rect = srcCanvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * srcCanvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * srcCanvas.height;
    const pts: { k: 'p00' | 'p10' | 'p01'; p: [number, number] }[] = [
      { k: 'p00', p: p00 },
      { k: 'p10', p: p10 },
      { k: 'p01', p: p01 },
    ];
    let best: 'p00' | 'p10' | 'p01' | null = null;
    let bestD = 18;
    for (const item of pts) {
      const px = srcViewOx + item.p[0] * srcViewScale;
      const py = srcViewOy + item.p[1] * srcViewScale;
      const d = Math.hypot(cx - px, cy - py);
      if (d <= bestD) { bestD = d; best = item.k; }
    }
    if (best) {
      dragCorner = best;
      srcCanvas.setPointerCapture(e.pointerId);
    }
  });
  srcCanvas.addEventListener('pointermove', (e) => {
    if (!dragCorner || !srcData) return;
    const rect = srcCanvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * srcCanvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * srcCanvas.height;
    const sx = clamp(Math.round((cx - srcViewOx) / Math.max(1e-4, srcViewScale)), 0, srcW);
    const sy = clamp(Math.round((cy - srcViewOy) / Math.max(1e-4, srcViewScale)), 0, srcH);
    if (dragCorner === 'p00') p00 = [sx, sy];
    else if (dragCorner === 'p10') p10 = [sx, sy];
    else p01 = [sx, sy];
    pendingCrop = undefined;
    drawPreviews();
  });
  srcCanvas.addEventListener('pointerup', (e) => {
    if (!dragCorner) return;
    dragCorner = null;
    try { srcCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  const rebuildControls = () => {
    controlsHost.innerHTML = '';
    const kindSeg = h(
      'div',
      { class: 'seg-row' },
      h(
        'button',
        {
          type: 'button',
          class: `seg-btn${importKind === 'rect' ? ' active' : ''}`,
          onclick: () => { importKind = 'rect'; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
        },
        '▭ 矩形贴图',
      ),
      h(
        'button',
        {
          type: 'button',
          class: `seg-btn${importKind === 'parallelogram' ? ' active' : ''}`,
          onclick: () => { importKind = 'parallelogram'; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
        },
        '▱ 平行四边形贴图 (斜切导入)',
      ),
    );
    controlsHost.append(kindSeg);

    if (importKind === 'rect') {
      const scaleRow = h(
        'div',
        { class: 'seg-row' },
        ...[1, 0.5, 0.25].map((sc) =>
          h(
            'button',
            {
              type: 'button',
              class: `seg-btn${rectTargetScale === sc ? ' active' : ''}`,
              onclick: () => { rectTargetScale = sc; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
            },
            sc === 1 ? '100% 原像素' : `${Math.round(sc * 100)}% 邻近缩小`,
          ),
        ),
      );
      controlsHost.append(h('div', { class: 'hint' }, '以最近邻像素格保持清晰边缘导入，无抗锯齿模糊。'), scaleRow);
    } else {
      const mSeg = h(
        'div',
        { class: 'seg-row' },
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn${paraMethod === 'sawtooth' ? ' active' : ''}`,
            onclick: () => { paraMethod = 'sawtooth'; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
          },
          'Pixel Meow 锯齿反解',
        ),
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn${paraMethod === 'quad' ? ' active' : ''}`,
            onclick: () => { paraMethod = 'quad'; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
          },
          '任意平行四边形四点校准',
        ),
      );
      controlsHost.append(mSeg);

      if (paraMethod === 'sawtooth') {
        const dirSeg = h(
          'div',
          { class: 'seg-row' },
          h(
            'button',
            {
              type: 'button',
              class: `seg-btn${sawDir === 'down_right' ? ' active' : ''}`,
              onclick: () => { sawDir = 'down_right'; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
            },
            '↘️ 原图为右下斜切',
          ),
          h(
            'button',
            {
              type: 'button',
              class: `seg-btn${sawDir === 'up_right' ? ' active' : ''}`,
              onclick: () => { sawDir = 'up_right'; pendingCrop = undefined; rebuildControls(); drawPreviews(); },
            },
            '↗️ 原图为右上斜切',
          ),
        );
        controlsHost.append(
          dirSeg,
          rangeRow('阶梯步长 (px)', 1, 16, sawStep, (v) => {
            sawStep = Math.max(1, Math.round(v));
            pendingCrop = undefined;
            drawPreviews();
          }, 1).row,
          h('div', { class: 'hint' }, '2:1 TheoTown 等距墙面默认步长为 2px，100% 逐像素无损展平。'),
        );
      } else {
        controlsHost.append(
          h(
            'div',
            { class: 'btn-row' },
            h(
              'button',
              {
                type: 'button',
                class: 'btn small',
                onclick: () => {
                  if (!srcData) return;
                  const c = autoDetectParallelogramCorners(srcData, srcW, srcH);
                  p00 = c.p00; p10 = c.p10; p01 = c.p01;
                  pendingCrop = undefined;
                  drawPreviews();
                },
              },
              '✨ 自动识别非透明角点',
            ),
            h(
              'button',
              {
                type: 'button',
                class: `btn small${autoQuadOut ? ' primary' : ''}`,
                onclick: () => {
                  autoQuadOut = !autoQuadOut;
                  pendingCrop = undefined;
                  rebuildControls();
                  drawPreviews();
                },
              },
              autoQuadOut ? '目标尺寸: 自动测算' : '目标尺寸: 手动输入',
            ),
          ),
          !autoQuadOut
            ? h(
                'div',
                { class: 'btn-row' },
                rangeRow('展开宽', 2, 128, quadOutW, (v) => { quadOutW = Math.round(v); pendingCrop = undefined; drawPreviews(); }, 1).row,
                rangeRow('展开高', 2, 128, quadOutH, (v) => { quadOutH = Math.round(v); pendingCrop = undefined; drawPreviews(); }, 1).row,
              )
            : h('span', {}),
          h('div', { class: 'hint' }, '请在左图中拖动 青(左上)、黄(右上)、粉(左下) 三个角点框住平行四边形贴图区域。'),
        );
      }
    }
  };

  const applyLoadedBlob = async (blob: Blob, filename?: string) => {
    try {
      const img = await loadImage(blob);
      const rawW = Math.max(1, img.naturalWidth || img.width);
      const rawH = Math.max(1, img.naturalHeight || img.height);
      const scale = Math.max(rawW, rawH) > 256 ? 256 / Math.max(rawW, rawH) : 1;
      const tw = Math.max(1, Math.round(rawW * scale));
      const th = Math.max(1, Math.round(rawH * scale));
      const ext = extractImageRgbaNearest(img, rawW, rawH, tw, th);
      srcData = ext.data;
      srcW = ext.width;
      srcH = ext.height;
      pendingCrop = undefined;
      const detected = autoDetectParallelogramCorners(srcData, srcW, srcH);
      p00 = detected.p00;
      p10 = detected.p10;
      p01 = detected.p01;
      quadOutW = Math.max(4, Math.round(Math.hypot(p10[0] - p00[0], p10[1] - p00[1])));
      quadOutH = Math.max(4, Math.round(Math.hypot(p01[0] - p00[0], p01[1] - p00[1])));
      if (filename) {
        name = filename.replace(/\.[^.]+$/, '') || name;
        nameIn.value = name;
      }
      srcInfo.textContent = tr(`已载入原图：${rawW}×${rawH} px${scale < 1 ? `（已最近邻缩至 ${srcW}×${srcH}）` : ''}`);
      rebuildControls();
      drawPreviews();
    } catch (err) {
      toast((err as Error).message || '读取图像失败');
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          void applyLoadedBlob(file, '剪贴板贴图');
          break;
        }
      }
    }
  };
  window.addEventListener('paste', onPaste);

  const dropBox = h(
    'div',
    {
      class: 'tex-dropzone',
      ondragover: (e: DragEvent) => { e.preventDefault(); dropBox.classList.add('over'); },
      ondragleave: () => dropBox.classList.remove('over'),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        dropBox.classList.remove('over');
        const f = e.dataTransfer?.files?.[0];
        if (f) void applyLoadedBlob(f, f.name);
      },
    },
    h(
      'button',
      {
        type: 'button',
        class: 'btn small primary',
        onclick: async () => {
          const f = await pickFile('image/*');
          if (f) await applyLoadedBlob(f, f.name);
        },
      },
      '📁 选择图片文件 (PNG / JPG)',
    ),
    h('span', { class: 'hint' }, '或直接拖入 / Ctrl+V 粘贴'),
  );

  rebuildControls();
  drawPreviews();

  const body = h(
    'div',
    { class: 'tex-import-body' },
    dropBox,
    srcInfo,
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '素材名称'), nameIn),
    controlsHost,
    h(
      'div',
      { class: 'tex-preview-pair' },
      h('div', { class: 'tex-preview-col' }, h('div', { class: 'hint' }, '源图 / 校准框'), srcCanvas),
      h('div', { class: 'tex-preview-col' }, h('div', { class: 'hint' }, '规范展开结果'), outCanvas),
    ),
    h('div', { class: 'btn-row' }, cropOutBtn, clearCropBtn),
    outBadge,
  );

  let close = () => {};
  confirmBtn.onclick = () => {
    const res = computeUnwrapped();
    if (!res) return;
    const targetGroupId =
      defaultGroupId && defaultGroupId !== BUILTIN_PRESET_GROUP_ID
        ? defaultGroupId
        : DEFAULT_USER_GROUP_ID;
    const asset = makeTextureAssetFromRgba({
      name,
      width: res.width,
      height: res.height,
      rectData: res.rectData,
      displayForm: res.displayForm,
      paraConfig: res.paraConfig,
      groupId: targetGroupId,
    });
    upsertTextureAsset(asset);
    close();
    toast(`✅ 已将「${asset.name}」导入纹理库 (${asset.width}×${asset.height})`);
    onImported(asset);
  };

  close = openSheet('📥 导入自定义纹理（矩形 / 平行四边形 / 裁切）', body, {
    wide: true,
    onClose: () => window.removeEventListener('paste', onPaste),
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, '取消'),
      confirmBtn,
    ],
  });
}

// ---------------- Pixel Meow Shear & Parallelogram Workshop Dialog (Working-Copy Isolated — M1 Fix) ----------------

export function openTextureShearDialog(asset: TextureAsset, onChanged?: () => void) {
  let workRectData = new Uint8ClampedArray(asset.rectData);
  let workW = asset.width;
  let workH = asset.height;
  let workPixelsChanged = false;

  let mode: ParallelogramMode = asset.paraConfig.mode;
  let direction: ShearDirection = asset.paraConfig.direction;
  let step = asset.paraConfig.step;
  let uVec: [number, number] = [...asset.paraConfig.uVec] as [number, number];
  let vVec: [number, number] = [...asset.paraConfig.vVec] as [number, number];
  let displayForm: TextureDisplayForm = asset.displayForm;

  const rectCanvas = h('canvas', { class: 'tex-import-canvas' }) as HTMLCanvasElement;
  const paraCanvas = h('canvas', { class: 'tex-import-canvas' }) as HTMLCanvasElement;
  const infoLine = h('div', { class: 'hint' });
  const ctrlBox = h('div', { class: 'tex-import-controls' });

  const buildWorkingAsset = (): TextureAsset => ({
    ...asset,
    width: workW,
    height: workH,
    rectData: workRectData,
    displayForm: 'parallelogram',
    paraConfig: {
      mode,
      direction,
      step,
      uVec: [...uVec] as [number, number],
      vVec: [...vVec] as [number, number],
    },
  });

  const refreshPreview = () => {
    drawRgbaThumbOnCanvas(rectCanvas, workRectData, workW, workH, 190, 160);
    const para = getAssetDisplayPixels(buildWorkingAsset());
    drawRgbaThumbOnCanvas(paraCanvas, para.data, para.width, para.height, 190, 160);
    infoLine.textContent = tr(`矩形尺寸 ${workW}×${workH} px ⇄ 平行四边形形态 ${para.width}×${para.height} px · 当前展示「${displayForm === 'parallelogram' ? '▱ 平行四边形' : '▭ 矩形'}」${workPixelsChanged ? ' (已修改待保存)' : ''}`);
  };

  const rebuildCtrl = () => {
    ctrlBox.innerHTML = '';
    ctrlBox.append(
      h(
        'div',
        { class: 'seg-row' },
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn${mode === 'sawtooth' ? ' active' : ''}`,
            onclick: () => { mode = 'sawtooth'; rebuildCtrl(); refreshPreview(); },
          },
          'Pixel Meow 锯齿斜切',
        ),
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn${mode === 'diamond' ? ' active' : ''}`,
            onclick: () => { mode = 'diamond'; rebuildCtrl(); refreshPreview(); },
          },
          '◇ 2:1 顶面菱形',
        ),
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn${mode === 'custom_vectors' ? ' active' : ''}`,
            onclick: () => { mode = 'custom_vectors'; rebuildCtrl(); refreshPreview(); },
          },
          '▱ 自定义平行四边形',
        ),
      ),
    );

    if (mode === 'sawtooth') {
      ctrlBox.append(
        h(
          'div',
          { class: 'seg-row' },
          h(
            'button',
            {
              type: 'button',
              class: `seg-btn${direction === 'down_right' ? ' active' : ''}`,
              onclick: () => { direction = 'down_right'; rebuildCtrl(); refreshPreview(); },
            },
            '↘️ 右下斜切 (左前墙)',
          ),
          h(
            'button',
            {
              type: 'button',
              class: `seg-btn${direction === 'up_right' ? ' active' : ''}`,
              onclick: () => { direction = 'up_right'; rebuildCtrl(); refreshPreview(); },
            },
            '↗️ 右上斜切 (右前墙)',
          ),
        ),
        rangeRow('锯齿步长 (px)', 1, 16, step, (v) => {
          step = Math.max(1, Math.round(v));
          refreshPreview();
        }, 1).row,
      );
    } else if (mode === 'custom_vectors') {
      ctrlBox.append(
        rangeRow('U 水平 ΔX', -128, 128, uVec[0], (v) => { uVec[0] = v; refreshPreview(); }, 1).row,
        rangeRow('U 竖直 ΔY', -128, 128, uVec[1], (v) => { uVec[1] = v; refreshPreview(); }, 1).row,
        rangeRow('V 水平 ΔX', -128, 128, vVec[0], (v) => { vVec[0] = v; refreshPreview(); }, 1).row,
        rangeRow('V 竖直 ΔY', -128, 128, vVec[1], (v) => { vVec[1] = v; refreshPreview(); }, 1).row,
      );
    } else {
      ctrlBox.append(h('div', { class: 'hint' }, '自动按 2:1 TheoTown 等距顶面菱形斜切方向投影该贴图。'));
    }

    ctrlBox.append(
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            type: 'button',
            class: `btn small${displayForm === 'rect' ? ' primary' : ''}`,
            onclick: () => { displayForm = 'rect'; rebuildCtrl(); refreshPreview(); },
          },
          '▭ 设为矩形展示',
        ),
        h(
          'button',
          {
            type: 'button',
            class: `btn small${displayForm === 'parallelogram' ? ' primary' : ''}`,
            onclick: () => { displayForm = 'parallelogram'; rebuildCtrl(); refreshPreview(); },
          },
          '▱ 设为平行四边形展示',
        ),
        !asset.builtIn && mode === 'sawtooth'
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn small',
                title: '按当前方向与步长在工作副本上反向解斜切为矩形（点击「应用并保存」后生效）',
                onclick: () => {
                  const maxStep = Math.floor((workW - 1) / Math.max(1, step));
                  if (workH <= maxStep) {
                    toast('图像高度不足以按该步长反解斜切');
                    return;
                  }
                  const res = deshearPixels(workRectData, workW, workH, direction, step);
                  workRectData = new Uint8ClampedArray(res.data);
                  workW = res.width;
                  workH = res.height;
                  workPixelsChanged = true;
                  displayForm = 'parallelogram';
                  rebuildCtrl();
                  refreshPreview();
                  toast(`预览已反解为 ${res.width}×${res.height} 正交矩形（点保存生效）`);
                },
              },
              '🔄 反解斜切底图为矩形',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'btn small',
            onclick: async () => {
              const exp = getAssetDisplayPixels({
                ...buildWorkingAsset(),
                displayForm,
              });
              const blob = await pngBytesFromRgba(exp.data, exp.width, exp.height);
              if (blob) {
                const suffix = displayForm === 'parallelogram' ? '_斜切' : '_矩形';
                const msg = await saveFile(blob, `${asset.name}${suffix}.png`, { share: true });
                toast(msg);
              }
            },
          },
          '📤 导出当前形态 PNG',
        ),
      ),
    );
  };

  rebuildCtrl();
  refreshPreview();

  const body = h(
    'div',
    { class: 'tex-import-body' },
    ctrlBox,
    h(
      'div',
      { class: 'tex-preview-pair' },
      h('div', { class: 'tex-preview-col' }, h('div', { class: 'hint' }, '▭ 正交矩形形态'), rectCanvas),
      h('div', { class: 'tex-preview-col' }, h('div', { class: 'hint' }, '▱ 平行四边形斜切形态'), paraCanvas),
    ),
    infoLine,
  );

  let close = () => {};
  close = openSheet(`📐 Pixel Meow 斜切工坊 · ${asset.name}`, body, {
    wide: true,
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, '取消'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary',
          onclick: () => {
            if (workPixelsChanged) {
              asset.rectData = workRectData;
              asset.width = workW;
              asset.height = workH;
              asset.pngDataUrl = rgbaToPngDataUrl(workRectData, workW, workH);
            }
            asset.displayForm = displayForm;
            asset.paraConfig = {
              mode,
              direction,
              step,
              uVec: [...uVec] as [number, number],
              vVec: [...vVec] as [number, number],
            };
            commitTextureAssetEdit(asset, workPixelsChanged);
            onChanged?.();
            close();
            toast(`已保存「${asset.name}」的斜切与形态设置`);
          },
        },
        '✓ 应用并保存',
      ),
    ],
  });
}

// ---------------- Shared Face Application, Whole-Face Pixel Editor, Dock & Modal Library ----------------

export function applyAssetToActivePlanarFace(
  app: App,
  asset: TextureAsset,
  crop?: TextureCropRect,
): boolean {
  const layer = app.doc.layer;
  if (!layer || layer.kind !== 'shape' || !layer.shape) {
    toast('请先在图层或画布中选中一个 3D 图形');
    return false;
  }
  if (!isPlanarTextureShape(layer.shape)) {
    toast(`「${layer.name}」不支持平面贴图（仅支持立方体、多棱柱、直角三棱柱、楔形坡屋顶、四棱锥）`);
    return false;
  }
  if (layer.locked) {
    toast(`图层「${layer.name}」已锁定，请先解锁`);
    return false;
  }
  const shape = layer.shape;
  const faces = getPlanarFacesForShape(shape);
  if (faces.length === 0) return false;
  const faceId = app.getActiveFaceId(layer.id, shape) ?? faces[0].id;
  const faceSpec = faces.find((f) => f.id === faceId) ?? faces[0];

  app.pushHistory(`为 ${faceSpec.shortLabel} 应用 ${asset.name}`);
  if (!shape.faceTextures) shape.faceTextures = {};
  if (!shape.faceTextures[faceSpec.id]) {
    shape.faceTextures[faceSpec.id] = { mode: 'none', shadeWithFace: true };
  }
  const slot = shape.faceTextures[faceSpec.id];
  if (slot.mode === 'custom') {
    addDecalToSlot(slot, asset.id, faceSpec, crop);
  } else {
    if (slot.mode === 'none') slot.mode = 'stretch';
    if (slot.shadeWithFace === undefined) slot.shadeWithFace = true;
    slot.assetId = asset.id;
    if (crop) slot.crop = crop;
    else delete slot.crop;
  }

  app.doc.rerenderShapeLayer(layer);
  app.emit('doc');
  toast(`已将「${asset.name}」应用到「${layer.name} · ${faceSpec.shortLabel}」`);
  return true;
}

export function openActiveFacePixelEditor(
  app: App,
  hooks?: {
    layerId?: number;
    shape?: ParametricShape;
    faceId?: string;
    beforeMutate?: (label: string) => void;
    afterMutate?: () => void;
  },
): boolean {
  const resolvedLayer =
    hooks?.layerId !== undefined
      ? app.doc.layers.find((l) => l.id === hooks.layerId)
      : !hooks?.shape
        ? app.doc.layer
        : undefined;
  const shape = hooks?.shape ?? (resolvedLayer?.kind === 'shape' ? resolvedLayer.shape : undefined);
  if (!shape || !isPlanarTextureShape(shape)) {
    toast('请先选中支持平面贴图的 3D 图形');
    return false;
  }
  if (resolvedLayer?.locked) {
    toast(`图层「${resolvedLayer.name}」已锁定，请先解锁`);
    return false;
  }
  const faces = getPlanarFacesForShape(shape);
  if (faces.length === 0) return false;

  const resolvedLayerId = hooks?.layerId ?? resolvedLayer?.id;
  const faceId = hooks?.faceId ?? app.getActiveFaceId(resolvedLayerId, shape) ?? faces[0].id;
  const faceSpec = faces.find((f) => f.id === faceId) ?? faces[0];
  const slot: FaceTextureSlot | undefined = shape.faceTextures?.[faceSpec.id];
  const hasTexture = Boolean(
    slot &&
    slot.mode !== 'none' &&
    ((slot.mode === 'custom' && slot.items && slot.items.length > 0) ||
      ((slot.mode === 'stretch' || slot.mode === 'tile') && slot.assetId)),
  );
  if (!hasTexture || !slot) {
    toast('当前平面尚未应用贴图，请先贴入纹理后再用像素画布编辑整面');
    return false;
  }

  const extracted = extractFaceTextureLayerBuffer(faceSpec, slot);
  const baseColor = faceSpec.isTop && shape.roofColor ? shape.roofColor : shape.baseColor;
  const defaultName = resolvedLayer
    ? `${resolvedLayer.name}·${faceSpec.shortLabel}`
    : `${faceSpec.shortLabel}整面贴图`;

  openPixelCanvasEditor({
    app,
    title: `🖌️ 编辑贴图面 · ${faceSpec.label} (${faceSpec.faceW}×${faceSpec.faceH})`,
    initialName: defaultName,
    initialData: extracted.data,
    width: faceSpec.faceW,
    height: faceSpec.faceH,
    allowResize: false,
    faceContext: {
      faceSpec,
      baseColor,
    },
    confirmLabel: '✓ 保存并应用到此平面',
    onSave: (res) => {
      const label = `像素画布编辑 ${faceSpec.shortLabel} 整面`;
      if (hooks?.beforeMutate) {
        hooks.beforeMutate(label);
      } else {
        app.pushHistory(label);
      }
      const liveLayer =
        resolvedLayerId !== undefined ? app.doc.layers.find((l) => l.id === resolvedLayerId) : undefined;
      const targetShape = liveLayer?.shape ?? shape;
      applyEditedFaceBufferToShape({
        shape: targetShape,
        layerId: resolvedLayerId,
        faceSpec,
        rgbaData: res.data,
        width: res.width,
        height: res.height,
        assetName: res.name.trim() || defaultName,
      });
      if (hooks?.afterMutate) {
        hooks.afterMutate();
      } else {
        if (liveLayer) app.doc.rerenderShapeLayer(liveLayer);
        app.emit('doc');
      }
      toast(`✅ 已将整面像素编辑 (${res.width}×${res.height}) 应用到「${faceSpec.shortLabel}」`);
    },
  });
  return true;
}

function resolveActivePlanarTarget(app: App): {
  layer: NonNullable<typeof app.doc.layer>;
  shape: ParametricShape;
  faces: PlanarFaceSpec[];
  activeFace: PlanarFaceSpec;
  activeSlot: FaceTextureSlot | undefined;
  hasActiveFaceTexture: boolean;
} | null {
  const layer = app.doc.layer;
  if (!layer || layer.kind !== 'shape' || !layer.shape || !isPlanarTextureShape(layer.shape)) {
    return null;
  }
  const shape = layer.shape;
  const faces = getPlanarFacesForShape(shape);
  if (faces.length === 0) return null;
  const activeFaceId = app.getActiveFaceId(layer.id, shape) ?? faces[0].id;
  const activeFace = faces.find((f) => f.id === activeFaceId) ?? faces[0];
  const activeSlot = shape.faceTextures?.[activeFace.id];
  const hasActiveFaceTexture = Boolean(
    activeSlot &&
    activeSlot.mode !== 'none' &&
    ((activeSlot.mode === 'custom' && activeSlot.items && activeSlot.items.length > 0) ||
      ((activeSlot.mode === 'stretch' || activeSlot.mode === 'tile') && activeSlot.assetId)),
  );
  return { layer, shape, faces, activeFace, activeSlot, hasActiveFaceTexture };
}

function renderTargetFaceStripContent(
  app: App,
  host: HTMLElement,
  onFaceChanged: () => void,
  compactLayout = true,
) {
  host.innerHTML = '';
  const layer = app.doc.layer;
  const target = resolveActivePlanarTarget(app);

  if (!layer || layer.kind !== 'shape' || !layer.shape) {
    host.append(
      h('div', { class: 'hint' }, '当前未选中 3D 图形图层，请选择一个图形后再贴图。'),
    );
    return;
  }

  if (!target) {
    host.append(
      h('div', { class: 'hint' }, `「${layer.name}」不支持平面贴图（仅支持立方体、多棱柱、三棱柱、坡屋顶、四棱锥）。`),
    );
    return;
  }

  const { shape, faces, activeFace, hasActiveFaceTexture } = target;
  const faceChips = h('div', { class: 'face-chip-grid', style: compactLayout ? 'margin-bottom:4px' : 'margin:0' });
  for (const f of faces) {
    const slot = shape.faceTextures?.[f.id];
    const hasTex = Boolean(slot && slot.mode !== 'none' && (slot.assetId || (slot.items && slot.items.length > 0)));
    faceChips.append(
      h(
        'button',
        {
          type: 'button',
          class: `face-chip${f.id === activeFace.id ? ' active' : ''}${hasTex ? ' textured' : ''}`,
          title: `${f.label} (${f.faceW}×${f.faceH} px)`,
          onclick: () => {
            app.setActiveFaceId(layer.id, f.id, shape);
            app.emit('doc_live');
            notifyActiveFaceChanged();
            onFaceChanged();
          },
        },
        h('span', {}, f.shortLabel),
        h('span', { class: 'face-chip-dim' }, `${f.faceW}×${f.faceH}`),
      ),
    );
  }

  const editFaceBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small accent',
      disabled: !hasActiveFaceTexture,
      title: hasActiveFaceTexture
        ? `将「${activeFace.shortLabel}」(${activeFace.faceW}×${activeFace.faceH} px) 打开为像素画布整面编辑`
        : '当前平面尚未贴入纹理，贴入后即可用像素画布编辑整面',
      onclick: () => {
        openActiveFacePixelEditor(app);
      },
    },
    '🖌️ 编辑当前贴图面',
  );

  if (compactLayout) {
    host.append(
      h(
        'div',
        { style: 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px' },
        h('span', { class: 'strip-pill' }, `目标: ${layer.name}`),
        editFaceBtn,
      ),
      faceChips,
    );
  } else {
    host.append(
      h('span', { class: 'strip-pill' }, `目标: ${layer.name}`),
      faceChips,
      editFaceBtn,
    );
  }
}

export class TextureLibraryDockPanel {
  readonly el: HTMLElement;
  private open = false;
  private targetStrip: HTMLElement;
  private scrollBody: HTMLElement;
  private libGroupFilter = 'all';
  private pendingLibRefresh = false;

  constructor(
    private app: App,
    private onRequestClose: () => void,
  ) {
    const closeBtn = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn sm',
        title: '收起纹理素材库面板',
        onclick: () => this.onRequestClose(),
      },
      '✕',
    );
    const header = h(
      'div',
      {
        class: 'tex-lib-drawer-head',
        style: 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0',
      },
      h('b', { style: 'font-size:13px' }, '📦 纹理素材库'),
      closeBtn,
    );
    this.targetStrip = h('div', {
      class: 'tex-lib-target-strip',
      style: 'padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0',
    });
    this.scrollBody = h('div', {
      class: 'tex-lib-drawer-body',
      style: 'flex:1;min-height:0;overflow-y:auto;padding:8px',
    });

    this.el = h('aside', { class: 'tex-lib-drawer' }, header, this.targetStrip, this.scrollBody);

    onTextureLibraryChange(() => {
      if (!this.open) return;
      if (this.pendingLibRefresh) return;
      this.pendingLibRefresh = true;
      queueMicrotask(() => {
        this.pendingLibRefresh = false;
        if (this.open) this.refresh();
      });
    });

    onActiveFaceChange(() => {
      if (this.open) this.refresh();
    });

    this.refresh();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.el.classList.toggle('open', open);
    if (open) this.refresh();
  }

  isOpen(): boolean {
    return this.open;
  }

  refresh(): void {
    const prevScroll = this.scrollBody.scrollTop;
    renderTargetFaceStripContent(this.app, this.targetStrip, () => this.refresh(), true);
    const target = resolveActivePlanarTarget(this.app);
    const selectedAssetId =
      target?.activeSlot && (target.activeSlot.mode === 'stretch' || target.activeSlot.mode === 'tile')
        ? target.activeSlot.assetId
        : undefined;

    this.scrollBody.innerHTML = '';
    this.scrollBody.append(
      buildTextureLibrarySection({
        app: this.app,
        selectedAssetId,
        actionHint: target
          ? `点击素材应用到「${target.activeFace.shortLabel}」（支持分组、手绘与斜切）`
          : '点击素材可浏览、绘制或分组管理（选中平面图形即可直接贴入）',
        faceSpec: target?.activeFace,
        groupState: {
          get: () => this.libGroupFilter,
          set: (id) => { this.libGroupFilter = id; },
        },
        getAssetUsageCount: (assetId) => countTextureAssetUsage(this.app.doc.layers.map((l) => l.shape), assetId),
        onPickAsset: (asset, crop) => {
          applyAssetToActivePlanarFace(this.app, asset, crop);
        },
        onAssetsChanged: () => {
          if (this.open) this.refresh();
        },
      }),
    );
    this.scrollBody.scrollTop = prevScroll;
  }
}

export function openTextureLibraryModal(app: App): () => void {
  if (typeof document !== 'undefined' && !document.getElementById('bmeow-texlib-stack-css')) {
    const style = document.createElement('style');
    style.id = 'bmeow-texlib-stack-css';
    style.textContent = `.tex-lib-fullscreen-overlay ~ .sheet-overlay { z-index: 110; }\nbody:has(.tex-lib-fullscreen-overlay) #toast { z-index: 115; }`;
    document.head.appendChild(style);
  }
  let prevToastZ = '';
  let toastEl = typeof document !== 'undefined' ? document.getElementById('toast') : null;
  if (typeof document !== 'undefined' && !toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
  if (toastEl) {
    prevToastZ = toastEl.style.zIndex;
    if (!prevToastZ || Number(prevToastZ) < 115) toastEl.style.zIndex = '115';
  }

  let closed = false;
  let autoCloseOnPick = false;
  let modalGroupFilter = 'all';
  let pendingLibRefresh = false;

  const titleEl = h('b', { style: 'font-size:14px;white-space:nowrap' }, '📦 纹理素材库');
  const targetStrip = h('div', {
    class: 'tex-lib-target-strip',
    style: 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1;min-width:0',
  });
  const scrollBody = h('div', {
    class: 'tex-lib-overlay-body',
    style: 'flex:1;min-height:0;overflow-y:auto;padding:12px',
  });

  const autoCloseToggle = toggle('贴入平面后自动关闭窗口', autoCloseOnPick, (v) => {
    autoCloseOnPick = v;
  });

  const closeBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      onclick: () => close(),
    },
    '✕ 关闭',
  );

  const topBar = h(
    'div',
    {
      class: 'tex-lib-overlay-head',
      style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0',
    },
    titleEl,
    targetStrip,
    h('div', { style: 'display:flex;align-items:center;gap:10px;flex-shrink:0' }, autoCloseToggle, closeBtn),
  );

  const overlay = h('div', { class: 'tex-lib-fullscreen-overlay' }, topBar, scrollBody);

  const refreshTargetStrip = () => {
    if (closed) return;
    renderTargetFaceStripContent(app, targetStrip, () => {
      refreshTargetStrip();
      refreshLibrary();
    }, false);
  };

  const refreshLibrary = () => {
    if (closed) return;
    const prevScroll = scrollBody.scrollTop;
    const target = resolveActivePlanarTarget(app);
    const selectedAssetId =
      target?.activeSlot && (target.activeSlot.mode === 'stretch' || target.activeSlot.mode === 'tile')
        ? target.activeSlot.assetId
        : undefined;

    scrollBody.innerHTML = '';
    scrollBody.append(
      buildTextureLibrarySection({
        app,
        selectedAssetId,
        actionHint: target
          ? `点击素材直接贴入「${target.layer.name} · ${target.activeFace.shortLabel}」（支持分组管理、像素绘制与裁剪）`
          : '点击素材可管理分组与像素绘制；请先选中平面 3D 图形后再贴入模型面',
        faceSpec: target?.activeFace,
        groupState: {
          get: () => modalGroupFilter,
          set: (id) => { modalGroupFilter = id; },
        },
        getAssetUsageCount: (assetId) => countTextureAssetUsage(app.doc.layers.map((l) => l.shape), assetId),
        onPickAsset: (asset, crop) => {
          const applied = applyAssetToActivePlanarFace(app, asset, crop);
          if (applied && autoCloseOnPick) {
            close();
            return;
          }
          refreshTargetStrip();
          refreshLibrary();
        },
        onAssetsChanged: () => {
          refreshTargetStrip();
          refreshLibrary();
        },
      }),
    );
    scrollBody.scrollTop = prevScroll;
  };

  const unsubLib = onTextureLibraryChange(() => {
    if (closed || pendingLibRefresh) return;
    pendingLibRefresh = true;
    queueMicrotask(() => {
      pendingLibRefresh = false;
      if (!closed) {
        refreshTargetStrip();
        refreshLibrary();
      }
    });
  });

  const unsubApp = app.on((what) => {
    if (closed) return;
    if (what === 'doc_live') {
      refreshTargetStrip();
    } else if (what === 'doc' || what === 'layers' || what === 'tool' || what === 'history') {
      refreshTargetStrip();
      refreshLibrary();
    }
  });

  const unsubFace = onActiveFaceChange(() => {
    if (!closed) {
      refreshTargetStrip();
      refreshLibrary();
    }
  });

  const scopeId = `tex-lib-modal-${++modalScopeSeq}`;
  const unsubScope = shortcutManager.registerScope({
    id: scopeId,
    priority: 95,
    modalBarrier: true,
    isActive: () => {
      if (!overlay.isConnected) return false;
      let sib = overlay.nextElementSibling;
      while (sib) {
        if (sib.id !== 'toast') return false;
        sib = sib.nextElementSibling;
      }
      return true;
    },
    triggers: {
      'history.undo': () => {
        const l = app.undo();
        toast(l ? `撤销: ${l}` : '没有可撤销的操作');
        return true;
      },
      'history.redo': () => {
        const l = app.redo();
        toast(l ? `重做: ${l}` : '没有可重做的操作');
        return true;
      },
    },
  });

  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    const idx = openSheets.indexOf(close);
    if (idx >= 0) openSheets.splice(idx, 1);
    if (toastEl) {
      toastEl.style.zIndex = prevToastZ;
    }
    unsubScope();
    unsubLib();
    unsubApp();
    unsubFace();
  };

  document.body.appendChild(overlay);
  openSheets.push(close);
  refreshTargetStrip();
  refreshLibrary();
  return close;
}
