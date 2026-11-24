// Layer panel for managing 3D shape layers & reference raster layers (with depth auto-sort & drag reordering)
import type { App } from '../app';
import { clamp, toHex8 } from '../core/color';
import { tr } from '../core/i18n';
import { BLEND_MODES, type BlendMode, type BuilderLayer } from '../core/document';
import {
  DEFAULT_GROUND_SHADOW_COLOR,
  DEFAULT_GROUND_SHADOW_HEX,
  GROUND_SHADOW_LAYER_NAME,
  INTER_BLOCK_SHADOW_LAYER_NAME,
} from '../core/groundShadow';
import { cellsToMeters, zPxToMeters } from '../core/isoMath';
import { loadTemplateImage, THEOTOWN_TEMPLATES } from '../core/theotownAssets';
import { loadImage, pickFile } from '../platform';
import { h, icon, openSheet, prompt2, select, toast } from './dom';
import { buildRgbaColorPickerRow } from './materialPanel';
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Lock,
  LockOpen,
  Plus,
  Trash2,
} from 'lucide';

export class LayerPanel {
  el: HTMLElement;
  private list: HTMLElement;
  private props: HTMLElement;
  private thumbs = new Map<number, HTMLCanvasElement>();
  private shadowThumb: HTMLCanvasElement | null = null;
  private interBlockThumb: HTMLCanvasElement | null = null;
  private selectedShadowKind: 'none' | 'ground' | 'inter_block' = 'none';
  private dragActive = false;

  constructor(
    private app: App,
    private onOpenCreateParam: () => void,
  ) {
    this.list = h('div', { class: 'layer-list' });
    this.list.addEventListener('touchmove', (e) => {
      if (this.dragActive) e.preventDefault();
    }, { passive: false });
    this.props = h('div', { class: 'layer-props' });

    const tb = (ic: Parameters<typeof icon>[0], title: string, fn: () => void) =>
      h('button', { class: 'icon-btn sm', title, onclick: fn }, icon(ic, 16));

    const head = h(
      'div',
      { class: 'panel-head' },
      h('div', { class: 'panel-head-title' }, h('b', {}, '立体图层'), h('span', { class: 'hint' }, '按叠放遮挡排序')),
      h(
        'div',
        { class: 'panel-tools' },
        tb(Plus, '填参数新建图形', () => this.onOpenCreateParam()),
        tb(Copy, '复制图层', () => app.duplicateActiveLayer()),
        tb(ArrowUp, '上移一层', () => app.moveLayer(1)),
        tb(ArrowDown, '下移一层', () => app.moveLayer(-1)),
        tb(ArrowDownWideNarrow, '按当前视角深度自动排层', () => {
          app.sortByDepth();
          toast('✨ 已按当前视角前后遮挡深度排层');
        }),
        tb(ImagePlus, '导入参考图 / TheoTown 底板', () => this.openImportRefDialog()),
        tb(Trash2, '删除图层', () => app.deleteActiveLayer()),
      ),
    );

    this.el = h('div', { class: 'layer-section' }, head, this.props, this.list);
    this.refresh();
  }

  private openImportRefDialog() {
    let close = () => {};
    const body = h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:10px' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          close();
          const f = await pickFile('image/*', 'document');
          if (!f) return;
          try {
            const img = await loadImage(f);
            this.app.addRasterLayer(img, f.name.replace(/\.[^.]+$/, '') || tr('参考图'), 'underlay');
            toast(`🖼️ 已导入参考图「${f.name}」`);
          } catch (e) {
            toast('导入参考图失败: ' + (e as Error).message);
          }
        },
      }, '📁 从本地选择 PNG / 参考底图'),
      h('div', { class: 'menu-sec' }, '共享 TheoTown 官方底板贴图模板'),
      h(
        'div',
        { class: 'preset-row' },
        ...THEOTOWN_TEMPLATES.map((tpl) =>
          h(
            'button',
            {
              class: 'btn small',
              onclick: async () => {
                try {
                  const img = await loadTemplateImage(tpl.url);
                  close();
                  this.app.addRasterLayer(img, tr(tpl.name), 'underlay');
                  toast(`🧩 已垫底导入 ${tpl.name}`);
                } catch (e) {
                  toast((e as Error).message);
                }
              },
            },
            `${tpl.size}×${tpl.size} (${tpl.width}×${tpl.height})`,
          ),
        ),
      ),
    );
    close = openSheet('导入垫底参考图 / TheoTown 贴图', body);
  }

  private drawThumbCanvas(src: HTMLCanvasElement | null, w: number, hPx: number, target: HTMLCanvasElement) {
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, target.width, target.height);
    if (!src) return;
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(target.width / Math.max(1, w), target.height / Math.max(1, hPx));
    const dw = Math.max(1, Math.round(w * s));
    const dh = Math.max(1, Math.round(hPx * s));
    ctx.drawImage(src, Math.floor((target.width - dw) / 2), Math.floor((target.height - dh) / 2), dw, dh);
  }

  private drawThumb(l: BuilderLayer, target: HTMLCanvasElement) {
    this.drawThumbCanvas(l.canvas, l.width, l.height, target);
  }

  refreshThumbsOnly() {
    for (const l of this.app.doc.layers) {
      const thumb = this.thumbs.get(l.id);
      if (thumb) this.drawThumb(l, thumb);
    }
    if (this.shadowThumb) {
      const d = this.app.doc;
      this.drawThumbCanvas(d.getGroundShadowCanvas(), d.width, d.height, this.shadowThumb);
    }
    if (this.interBlockThumb) {
      const d = this.app.doc;
      this.drawThumbCanvas(d.getInterBlockShadowCanvas(), d.width, d.height, this.interBlockThumb);
    }
  }

  private buildGroundShadowRow(): HTMLElement {
    const d = this.app.doc;
    const gs = d.groundShadow;
    if (!this.shadowThumb) {
      this.shadowThumb = h('canvas', { width: '36', height: '36', class: 'layer-thumb' }) as HTMLCanvasElement;
    }
    this.drawThumbCanvas(d.getGroundShadowCanvas(), d.width, d.height, this.shadowThumb);
    const pct = Math.round((gs.color.a / 255) * 100);
    const subtitle = `${toHex8(gs.color)} (${pct}%) · 1:1 正右投射`;
    const badge = h('span', { class: 'layer-kind-badge shadow' }, '阴影');

    return h(
      'div',
      {
        class: `layer-row shadow-row${this.selectedShadowKind === 'ground' ? ' active' : ''}${gs.enabled ? '' : ' hidden-layer'}`,
        title: '自动地面阴影（导出 PSD 时自动作为独立图层；位于底座之上、所有 3D 体块之下）',
        onclick: () => {
          this.selectedShadowKind = 'ground';
          this.refresh();
        },
      },
      h('span', { class: 'layer-grip', style: 'opacity:0.35;cursor:default' }, icon(GripVertical, 15)),
      this.shadowThumb,
      h(
        'div',
        { class: 'layer-meta' },
        h('div', { class: 'layer-title-line' }, badge, h('span', { class: 'layer-name' }, `${GROUND_SHADOW_LAYER_NAME} (自动)`)),
        h('div', { class: 'layer-sub' }, subtitle),
      ),
      h(
        'div',
        { class: 'layer-btns', onclick: (e: MouseEvent) => e.stopPropagation() },
        h(
          'button',
          {
            class: 'icon-btn sm',
            title: gs.enabled ? '关闭自动地面阴影' : '开启自动地面阴影',
            onclick: () => {
              this.app.setGroundShadow(
                { enabled: !gs.enabled },
                { pushHistory: !gs.enabled ? '启用自动地面阴影' : '隐藏自动地面阴影' },
              );
            },
          },
          icon(gs.enabled ? Eye : EyeOff, 15),
        ),
      ),
    );
  }

  private buildInterBlockShadowRow(): HTMLElement {
    const d = this.app.doc;
    const gs = d.groundShadow;
    const enabled = Boolean(gs.interBlockEnabled);
    if (!this.interBlockThumb) {
      this.interBlockThumb = h('canvas', { width: '36', height: '36', class: 'layer-thumb' }) as HTMLCanvasElement;
    }
    this.drawThumbCanvas(d.getInterBlockShadowCanvas(), d.width, d.height, this.interBlockThumb);
    const pct = Math.round((gs.color.a / 255) * 100);
    const subtitle = `${toHex8(gs.color)} (${pct}%) · 实验性体块投影`;
    const badge = h('span', { class: 'layer-kind-badge shadow' }, '实验');

    return h(
      'div',
      {
        class: `layer-row shadow-row${this.selectedShadowKind === 'inter_block' ? ' active' : ''}${enabled ? '' : ' hidden-layer'}`,
        title: '体块间投射阴影（实验性：高体块按 1:1 向右侧矮体块或台阶表面投射阴影，导出为独立「结构阴影」图层）',
        onclick: () => {
          this.selectedShadowKind = 'inter_block';
          this.refresh();
        },
      },
      h('span', { class: 'layer-grip', style: 'opacity:0.35;cursor:default' }, icon(GripVertical, 15)),
      this.interBlockThumb,
      h(
        'div',
        { class: 'layer-meta' },
        h('div', { class: 'layer-title-line' }, badge, h('span', { class: 'layer-name' }, `${INTER_BLOCK_SHADOW_LAYER_NAME} (体块间 · 实验)`)),
        h('div', { class: 'layer-sub' }, subtitle),
      ),
      h(
        'div',
        { class: 'layer-btns', onclick: (e: MouseEvent) => e.stopPropagation() },
        h(
          'button',
          {
            class: 'icon-btn sm',
            title: enabled ? '关闭体块间投射阴影' : '启用体块间投射阴影 (实验)',
            onclick: () => {
              this.app.setGroundShadow(
                { interBlockEnabled: !enabled },
                { pushHistory: !enabled ? '启用体块间投射阴影 (实验)' : '关闭体块间投射阴影' },
              );
            },
          },
          icon(enabled ? Eye : EyeOff, 15),
        ),
      ),
    );
  }

  refresh() {
    const d = this.app.doc;
    const activeLayer = d.layer;

    // Props bar for active shadow virtual layer or active normal layer
    this.props.innerHTML = '';
    if (this.selectedShadowKind !== 'none') {
      const gs = d.groundShadow;
      const initPct = Math.round((gs.color.a / 255) * 1000) / 10;
      const opVal = h('span', { class: 'op-val' }, `${initPct}%`);
      const opRng = h('input', {
        type: 'range',
        min: '0',
        max: '100',
        step: '0.1',
        value: String(initPct),
      }) as HTMLInputElement;
      let opPushed = false;
      opRng.oninput = () => {
        if (!opPushed) {
          opPushed = true;
          this.app.pushHistory('调整阴影不透明度');
        }
        const nextA = clamp(Math.round((+opRng.value / 100) * 255), 0, 255);
        opVal.textContent = `${opRng.value}%`;
        this.app.setGroundShadow({ color: { ...d.groundShadow.color, a: nextA } }, { live: true });
      };
      const finishOp = () => {
        if (!opPushed) return;
        opPushed = false;
        this.app.emit('doc');
        this.app.emit('layers');
      };
      opRng.onchange = finishOp;
      opRng.addEventListener('pointercancel', finishOp);
      const resetBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          title: `重置阴影颜色为 ${DEFAULT_GROUND_SHADOW_HEX}`,
          onclick: () => {
            const cur = d.groundShadow.color;
            const def = DEFAULT_GROUND_SHADOW_COLOR;
            if (cur.r === def.r && cur.g === def.g && cur.b === def.b && cur.a === def.a) return;
            this.app.setGroundShadow(
              { color: { ...def } },
              { pushHistory: `重置阴影颜色为 ${DEFAULT_GROUND_SHADOW_HEX}` },
            );
          },
        },
        '↺ 默认色',
      );
      const colRow = buildRgbaColorPickerRow('阴影色 (共用)', gs.color, this.app, {
        onRestoreSilent: (orig) => { d.groundShadow.color = { ...orig }; },
        onBegin: () => this.app.pushHistory('修改阴影颜色'),
        onPreview: (next) => this.app.setGroundShadow({ color: next }, { live: true }),
        onCancel: (orig) => this.app.setGroundShadow({ color: orig }, { live: true }),
        onCommit: (next) => this.app.setGroundShadow({ color: next }),
      });
      this.props.append(
        h('div', { style: 'display:flex;flex-direction:column;gap:6px;width:100%' }, colRow, h('div', { class: 'range-row' }, opRng, opVal, resetBtn)),
      );
    } else if (activeLayer) {
      const blendSel = select(BLEND_MODES, activeLayer.blend, (v: BlendMode) => {
        this.app.pushHistory('修改混合模式');
        activeLayer.blend = v;
        this.app.emit('doc');
      });
      const opVal = h('span', { class: 'op-val' }, `${Math.round(activeLayer.opacity * 100)}%`);
      const opRng = h('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(activeLayer.opacity * 100)),
      }) as HTMLInputElement;
      let opPushed = false;
      opRng.oninput = () => {
        if (!opPushed) {
          opPushed = true;
          this.app.pushHistory('调整图层不透明度');
        }
        activeLayer.opacity = +opRng.value / 100;
        opVal.textContent = `${opRng.value}%`;
        this.app.emit('doc_live');
      };
      const finishOp = () => {
        if (!opPushed) return;
        opPushed = false;
        this.app.emit('doc');
      };
      opRng.onchange = finishOp;
      opRng.addEventListener('pointercancel', finishOp);
      this.props.append(blendSel, opRng, opVal);
    }

    const liveIds = new Set(d.layers.map((l) => l.id));
    for (const tid of this.thumbs.keys()) {
      if (!liveIds.has(tid)) this.thumbs.delete(tid);
    }

    this.list.innerHTML = '';
    const shadowIdx = d.getGroundShadowInsertIndex();
    const showInterRow = Boolean(d.groundShadow.interBlockEnabled) || this.selectedShadowKind === 'inter_block';
    const interIdx = d.getInterBlockShadowInsertIndex();
    if (showInterRow && interIdx >= d.layers.length) {
      this.list.append(this.buildInterBlockShadowRow());
    }
    if (shadowIdx >= d.layers.length) {
      this.list.append(this.buildGroundShadowRow());
    }
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i];
      const isActive = this.selectedShadowKind === 'none' && i === d.active;

      let thumb = this.thumbs.get(l.id);
      if (!thumb) {
        thumb = h('canvas', { width: '36', height: '36', class: 'layer-thumb' }) as HTMLCanvasElement;
        this.thumbs.set(l.id, thumb);
      }
      this.drawThumb(l, thumb);

      const badge = h(
        'span',
        { class: `layer-kind-badge ${l.kind}` },
        l.kind === 'shape' ? '3D' : '图',
      );
      const subtitle = l.kind === 'shape' && l.shape
        ? `${l.shape.sizeU}×${l.shape.sizeV}格 (${cellsToMeters(l.shape.sizeU).toFixed(1)}m) · H ${l.shape.heightPx}px (${zPxToMeters(l.shape.heightPx).toFixed(1)}m)`
        : `${l.width}×${l.height} 参考图`;

      const grip = h('span', { class: 'layer-grip', title: '拖动排序' }, icon(GripVertical, 15));

      const row = h(
        'div',
        {
          class: `layer-row${isActive ? ' active' : ''}${l.visible ? '' : ' hidden-layer'}`,
          onclick: () => {
            if (this.dragActive) return;
            this.selectedShadowKind = 'none';
            d.active = i;
            this.app.emit('layers');
          },
          ondblclick: async (e: MouseEvent) => {
            e.stopPropagation();
            const n = await prompt2('重命名图层', tr(l.name));
            if (n !== null && n.trim()) {
              this.app.pushHistory('重命名图层');
              l.name = n.trim();
              this.app.emit('layers');
            }
          },
        },
        grip,
        thumb,
        h(
          'div',
          { class: 'layer-meta' },
          h('div', { class: 'layer-title-line' }, badge, h('span', { class: 'layer-name' }, l.name)),
          h('div', { class: 'layer-sub' }, subtitle),
        ),
        h(
          'div',
          { class: 'layer-btns', onclick: (e: MouseEvent) => e.stopPropagation() },
          h(
            'button',
            {
              class: 'icon-btn sm',
              title: l.visible ? '隐藏图层' : '显示图层',
              onclick: () => {
                this.app.pushHistory('切换显隐');
                l.visible = !l.visible;
                this.app.emit('doc');
                this.app.emit('layers');
              },
            },
            icon(l.visible ? Eye : EyeOff, 15),
          ),
          h(
            'button',
            {
              class: `icon-btn sm${l.locked ? ' on' : ''}`,
              title: l.locked ? '解锁' : '锁定',
              onclick: () => {
                this.app.pushHistory('切换锁定');
                l.locked = !l.locked;
                this.app.emit('layers');
              },
            },
            icon(l.locked ? Lock : LockOpen, 15),
          ),
        ),
      );

      // Drag handle reorder
      grip.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        const startY = ev.clientY;
        const rows = [...this.list.querySelectorAll('.layer-row')] as HTMLElement[];
        const visualIdx = rows.indexOf(row);
        if (visualIdx < 0) return;
        this.dragActive = true;
        row.classList.add('dragging');
        const onMove = (me: PointerEvent) => {
          const dy = me.clientY - startY;
          row.style.transform = `translateY(${dy}px)`;
          row.style.zIndex = '5';
        };
        const cleanup = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          row.style.transform = '';
          row.style.zIndex = '';
          row.classList.remove('dragging');
        };
        const onUp = (ue: PointerEvent) => {
          cleanup();
          const stepH = Math.max(36, row.getBoundingClientRect().height + 4);
          const shift = Math.round((ue.clientY - startY) / stepH);
          setTimeout(() => { this.dragActive = false; }, 40);
          if (shift !== 0) {
            const targetVisual = Math.max(0, Math.min(d.layers.length - 1, visualIdx + shift));
            const targetDocIdx = d.layers.length - 1 - targetVisual;
            this.app.reorderLayer(i, targetDocIdx);
          }
        };
        const onCancel = () => {
          cleanup();
          this.dragActive = false;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
      });

      this.list.append(row);
      if (showInterRow && i === interIdx) {
        this.list.append(this.buildInterBlockShadowRow());
      }
      if (i === shadowIdx) {
        this.list.append(this.buildGroundShadowRow());
      }
    }
  }
}
