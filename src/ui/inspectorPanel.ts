// Parametric 3D shape geometry inspector ("形状修改") + "Create by Parameters" dialog
import type { App } from '../app';
import {
  cellsToMeters,
  metersToCells,
  metersToZPx,
  zPxToMeters,
  type ViewRotation,
} from '../core/isoMath';
import {
  cloneShape,
  createDefaultShape,
  SHAPE_LABELS,
  type ParametricShape,
  type ShapeKind,
  type TriPrismCut,
} from '../core/isoRenderer';
import { createArchPresetNodes } from '../core/arch';
import { hasActiveColumnSections, isColumnSectionShape, syncColumnSectionsEdgeCount } from '../core/columnSections';
import { ensureActiveLoftSection } from '../core/loft';
import { tr } from '../core/i18n';
import { sanitizeFaceTexturesForShape } from '../core/textures';
import { buildArchInspectorSection } from './archEditor';
import { buildColumnInspectorSection } from './columnSectionEditor';
import { h, openSheet, rangeRow, select, toast } from './dom';
import { buildLoftInspectorSection } from './loftEditor';
import { buildGeneralMaterialSection } from './materialPanel';

const SHAPE_OPTIONS: { id: ShapeKind; label: string }[] = [
  { id: 'box', label: '立方体 / 长方体' },
  { id: 'right_tri_prism', label: '直角三棱柱 (半立方体)' },
  { id: 'arch', label: '拱形 / 拱券 (躺卧半圆柱)' },
  { id: 'cylinder', label: '圆柱体' },
  { id: 'loft', label: '曲面柱体 (多控制面放样)' },
  { id: 'prism', label: '多棱柱 (3~12边)' },
  { id: 'wedge', label: '楔形 / 坡屋顶' },
  { id: 'pyramid', label: '四棱锥' },
  { id: 'cone', label: '圆锥体' },
  { id: 'dome', label: '穹顶 / 球体' },
  { id: 'theotown_base', label: 'TheoTown 绿地底座' },
];

function makeDualUnitInput(
  label: string,
  initialNative: number,
  toMeters: (v: number) => number,
  fromMeters: (m: number) => number,
  unitLabel: string,
  stepNative: number,
  minNative: number,
  onCommit: (v: number) => void,
) {
  const nIn = h('input', {
    type: 'number',
    class: 'num dual',
    step: String(stepNative),
    min: String(minNative),
    value: String(Math.round(initialNative * 1000) / 1000),
  }) as HTMLInputElement;
  const mIn = h('input', {
    type: 'number',
    class: 'num dual',
    step: '0.1',
    min: String(Math.round(toMeters(minNative) * 100) / 100),
    value: String(Math.round(toMeters(initialNative) * 100) / 100),
  }) as HTMLInputElement;

  nIn.onchange = () => {
    const v = Math.max(minNative, +nIn.value || 0);
    const rv = Math.round(v * 1000) / 1000;
    nIn.value = String(rv);
    mIn.value = String(Math.round(toMeters(rv) * 100) / 100);
    onCommit(rv);
  };
  mIn.onchange = () => {
    const m = Math.max(toMeters(minNative), +mIn.value || 0);
    const nv = Math.max(minNative, fromMeters(m));
    const rv = stepNative >= 1 ? Math.round(nv) : Math.round(nv * 16) / 16;
    nIn.value = String(rv);
    mIn.value = String(Math.round(toMeters(rv) * 100) / 100);
    onCommit(rv);
  };

  return {
    el: h(
      'div',
      { class: 'dual-row' },
      h('span', { class: 'rl' }, label),
      nIn,
      h('span', { class: 'unit-tag' }, unitLabel),
      mIn,
      h('span', { class: 'unit-tag' }, 'm'),
    ),
    setNative(v: number) {
      nIn.value = String(Math.round(v * 1000) / 1000);
      mIn.value = String(Math.round(toMeters(v) * 100) / 100);
    },
  };
}

export function buildShapeForm(
  shape: ParametricShape,
  app: App,
  opts: {
    allowChangeType: boolean;
    includeMaterial?: boolean;
    beforeMutate: (label: string) => void;
    afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => void;
    onTypeChanged?: (kind: ShapeKind) => void;
    targetLayerId?: number;
  },
): HTMLElement {
  const wrap = h('div', { class: 'shape-form' });
  const isBase = shape.shapeType === 'theotown_base';

  if (opts.allowChangeType) {
    wrap.append(
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '立体类型'),
        select(SHAPE_OPTIONS, shape.shapeType, (k) => {
          opts.beforeMutate(`切换为 ${SHAPE_LABELS[k]}`);
          shape.shapeType = k;
          if (k === 'theotown_base') {
            shape.heightPx = 0;
            shape.sizeU = Math.max(1, Math.round(shape.sizeU));
            shape.sizeV = Math.max(1, Math.round(shape.sizeV));
            delete shape.colSections;
            delete shape.colInterp;
            delete shape.activeColSectionId;
          } else {
            if (shape.heightPx <= 0) shape.heightPx = 24;
            if (k === 'loft') {
              ensureActiveLoftSection(shape);
              shape.loftInterp = shape.loftInterp ?? 'smooth';
              shape.loftHollow = shape.loftHollow ?? false;
            }
            if (k === 'arch') {
              if (!shape.archNodes || shape.archNodes.length < 2) {
                shape.archNodes = createArchPresetNodes('semicircle');
              }
              shape.archHollow = shape.archHollow ?? false;
              shape.archHollowStyle = shape.archHollowStyle ?? 'shell';
              shape.archInnerMode = shape.archInnerMode ?? 'parallel';
              shape.archThickness = shape.archThickness ?? 0.28;
            }
            if (isColumnSectionShape(shape)) {
              syncColumnSectionsEdgeCount(shape);
            } else {
              delete shape.colSections;
              delete shape.colInterp;
              delete shape.activeColSectionId;
            }
          }
          sanitizeFaceTexturesForShape(shape);
          opts.afterMutate({ needsResort: true });
          opts.onTypeChanged?.(k);
        }),
      ),
    );
  }

  // Spatial dimensions (Grid / px <-> Meter)
  wrap.append(h('div', { class: 'menu-sec' }, '位置与尺寸（格/像素 ⇄ TheoTown 米）'));

  const uRow = makeDualUnitInput('U 起点', shape.u, cellsToMeters, metersToCells, '格', 0.25, -16, (v) => {
    opts.beforeMutate('修改 U 位置');
    shape.u = v;
    opts.afterMutate({ needsResort: true });
  });
  const vRow = makeDualUnitInput('V 起点', shape.v, cellsToMeters, metersToCells, '格', 0.25, -16, (v) => {
    opts.beforeMutate('修改 V 位置');
    shape.v = v;
    opts.afterMutate({ needsResort: true });
  });
  const suRow = makeDualUnitInput('U 宽度', shape.sizeU, cellsToMeters, metersToCells, '格', isBase ? 1 : 0.25, isBase ? 1 : 0.125, (v) => {
    opts.beforeMutate('修改 U 宽度');
    shape.sizeU = isBase ? Math.max(1, Math.round(v)) : v;
    opts.afterMutate({ needsResort: true });
  });
  const svRow = makeDualUnitInput('V 深度', shape.sizeV, cellsToMeters, metersToCells, '格', isBase ? 1 : 0.25, isBase ? 1 : 0.125, (v) => {
    opts.beforeMutate('修改 V 深度');
    shape.sizeV = isBase ? Math.max(1, Math.round(v)) : v;
    opts.afterMutate({ needsResort: true });
  });
  const zRow = makeDualUnitInput('离地 Z', shape.zPx, zPxToMeters, metersToZPx, 'px', 1, 0, (v) => {
    opts.beforeMutate('修改离地高度 Z');
    shape.zPx = Math.round(v);
    opts.afterMutate({ needsResort: true });
  });

  wrap.append(uRow.el, vRow.el, suRow.el, svRow.el, zRow.el);

  if (!isBase) {
    const hRow = makeDualUnitInput('立体高度', shape.heightPx, zPxToMeters, metersToZPx, 'px', 1, 1, (v) => {
      opts.beforeMutate('修改立体高度');
      shape.heightPx = Math.max(1, Math.round(v));
      opts.afterMutate({ needsResort: true });
    });
    wrap.append(hRow.el);

    wrap.append(
      h(
        'div',
        { class: 'preset-row' },
        ...[
          { px: 6, label: '3.2m (6px)' },
          { px: 12, label: '6.4m (12px)' },
          { px: 18, label: '9.6m (18px)' },
          { px: 36, label: '19.2m (36px)' },
        ].map((p) =>
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                opts.beforeMutate(`高度设为 ${p.px}px`);
                shape.heightPx = p.px;
                hRow.setNative(p.px);
                opts.afterMutate({ needsResort: true });
              },
            },
            p.label,
          ),
        ),
        h(
          'button',
          {
            class: 'btn small accent',
            title: '自动计算正下方物体顶面并叠放上去',
            onclick: () => {
              const wf = app.doc.getShapeWorldFootprint(shape);
              const topZ = app.doc.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0, opts.targetLayerId);
              opts.beforeMutate('叠放到下方顶面');
              shape.zPx = topZ;
              zRow.setNative(topZ);
              opts.afterMutate({ needsResort: true });
              toast(`🧱 已叠放至 Z = ${topZ}px (${zPxToMeters(topZ).toFixed(2)}m)`);
            },
          },
          '🧱 叠放到顶面',
        ),
      ),
    );
  }

  // Geometry sub-options
  if (shape.shapeType === 'prism') {
    wrap.append(
      rangeRow(
        '棱柱边数',
        3,
        12,
        shape.prismSides,
        (v) => {
          shape.prismSides = Math.round(v);
          syncColumnSectionsEdgeCount(shape);
          sanitizeFaceTexturesForShape(shape);
          opts.afterMutate({ live: true });
        },
        1,
        {
          onBegin: () => opts.beforeMutate('修改棱柱边数'),
          onCommit: () => {
            syncColumnSectionsEdgeCount(shape);
            sanitizeFaceTexturesForShape(shape);
            opts.afterMutate({ live: false });
            if (hasActiveColumnSections(shape)) opts.onTypeChanged?.(shape.shapeType);
          },
        },
      ).row,
    );
  }
  if (shape.shapeType === 'right_tri_prism') {
    wrap.append(
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '切分方向'),
        select<TriPrismCut>(
          [
            { id: 'vertical', label: '竖直对角切半 (直角底面)' },
            { id: 'slope', label: '水平对角切半 (直角坡体)' },
          ],
          shape.triPrismCut ?? 'vertical',
          (v) => {
            opts.beforeMutate('修改三棱柱切分方向');
            shape.triPrismCut = v;
            if (v !== 'vertical') {
              delete shape.colSections;
              delete shape.colInterp;
              delete shape.activeColSectionId;
            }
            sanitizeFaceTexturesForShape(shape);
            opts.afterMutate({ needsResort: true });
            opts.onTypeChanged?.(shape.shapeType);
          },
        ),
      ),
    );
  }
  if (shape.shapeType === 'wedge') {
    wrap.append(
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '楔形形态'),
        select<'ramp' | 'gable'>(
          [
            { id: 'ramp', label: '单坡斜面 (Ramp)' },
            { id: 'gable', label: '双坡人字屋顶 (Gable)' },
          ],
          shape.wedgeMode,
          (v) => {
            opts.beforeMutate('修改屋顶形态');
            shape.wedgeMode = v;
            sanitizeFaceTexturesForShape(shape);
            opts.afterMutate();
          },
        ),
      ),
    );
  }
  if (shape.shapeType === 'dome') {
    wrap.append(
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '球体形态'),
        select<'dome' | 'sphere'>(
          [
            { id: 'dome', label: '半球穹顶 (Dome)' },
            { id: 'sphere', label: '完整球体 (Sphere)' },
          ],
          shape.domeMode,
          (v) => {
            opts.beforeMutate('修改穹顶形态');
            shape.domeMode = v;
            opts.afterMutate();
          },
        ),
      ),
    );
  }
  if (
    shape.shapeType === 'right_tri_prism' ||
    shape.shapeType === 'arch' ||
    shape.shapeType === 'wedge' ||
    shape.shapeType === 'prism' ||
    shape.shapeType === 'loft'
  ) {
    wrap.append(
      h(
        'div',
        { class: 'range-row' },
        h('span', { class: 'rl' }, '局部朝向'),
        select<'0' | '1' | '2' | '3'>(
          [
            { id: '0', label: '0° (+U 朝前)' },
            { id: '1', label: '90° (+V 朝前)' },
            { id: '2', label: '180° (-U 朝前)' },
            { id: '3', label: '270° (-V 朝前)' },
          ],
          String(shape.ori) as '0' | '1' | '2' | '3',
          (v) => {
            opts.beforeMutate('旋转图形朝向');
            shape.ori = Number(v) as ViewRotation;
            opts.afterMutate();
          },
        ),
      ),
    );
  }
  if (shape.shapeType === 'arch') {
    wrap.append(
      buildArchInspectorSection(shape, app, {
        targetLayerId: opts.targetLayerId,
        beforeMutate: opts.beforeMutate,
        afterMutate: opts.afterMutate,
      }),
    );
  }
  if (shape.shapeType === 'loft') {
    wrap.append(
      buildLoftInspectorSection(shape, app, {
        targetLayerId: opts.targetLayerId,
        beforeMutate: opts.beforeMutate,
        afterMutate: opts.afterMutate,
      }),
    );
  }
  if (
    shape.shapeType === 'box' ||
    shape.shapeType === 'cylinder' ||
    shape.shapeType === 'prism' ||
    shape.shapeType === 'right_tri_prism'
  ) {
    wrap.append(
      buildColumnInspectorSection(shape, app, {
        targetLayerId: opts.targetLayerId,
        beforeMutate: opts.beforeMutate,
        afterMutate: opts.afterMutate,
      }),
    );
  }

  if (opts.includeMaterial) {
    wrap.append(
      buildGeneralMaterialSection(shape, app, {
        beforeMutate: opts.beforeMutate,
        afterMutate: opts.afterMutate,
        onRebuild: (k) => opts.onTypeChanged?.(k),
      }),
    );
  }

  return wrap;
}

export class InspectorPanel {
  el: HTMLElement;
  private body: HTMLElement;
  private titleEl: HTMLElement;
  private suppressRefresh = false;

  constructor(private app: App, private onOpenParamCreate: () => void) {
    this.titleEl = h('b', {}, '形状修改');
    this.body = h('div', { class: 'inspector-body' });
    const head = h(
      'div',
      { class: 'panel-head' },
      this.titleEl,
      h(
        'button',
        { class: 'btn small primary', onclick: () => this.onOpenParamCreate() },
        '+ 填参数生成',
      ),
    );
    this.el = h('div', { class: 'inspector-section' }, head, this.body);
    this.refresh();
  }

  refresh(force = false) {
    if (!force && this.suppressRefresh) return;
    this.body.innerHTML = '';
    const d = this.app.doc;
    const active = d.layer;

    if (this.app.tool === 'create' || !active || active.kind !== 'shape' || !active.shape) {
      this.titleEl.textContent = tr('新建立体预设参数');
      this.body.append(
        h('div', { class: 'hint', style: 'margin-bottom:6px' },
          this.app.tool === 'create'
            ? '在画布拖拽底面即可按以下预设生成图形；也可点击右上角直接填参数生成。'
            : active?.kind === 'raster'
              ? `当前选中参考图层「${active.name}」（以下为新图形默认参数）`
              : '未选中立体图层（以下为新图形默认参数）'),
        buildShapeForm(this.app.createPreset, this.app, {
          allowChangeType: true,
          beforeMutate: () => {},
          afterMutate: (options) => {
            if (!options?.live) {
              this.suppressRefresh = true;
              try {
                this.app.emit('preset');
              } finally {
                this.suppressRefresh = false;
              }
            }
          },
          onTypeChanged: () => this.refresh(true),
        }),
      );
      return;
    }

    const shape = active.shape;
    const activeId = active.id;
    this.titleEl.textContent = tr(`选中: ${active.name}`);

    this.body.append(
      buildShapeForm(shape, this.app, {
        allowChangeType: true,
        targetLayerId: activeId,
        beforeMutate: (label) => {
          this.suppressRefresh = true;
          try {
            this.app.pushHistory(label);
          } finally {
            this.suppressRefresh = false;
          }
        },
        afterMutate: (options) => {
          const liveDoc = this.app.doc;
          if (options?.needsResort && this.app.settings.autoSortOnEdit) {
            liveDoc.sortLayersByIsoDepth();
          }
          const liveLayer = liveDoc.layers.find((l) => l.id === activeId);
          if (liveLayer) liveDoc.rerenderShapeLayer(liveLayer);
          if (options?.live) {
            this.app.emit('doc_live');
          } else {
            this.suppressRefresh = true;
            try {
              this.app.emit('doc');
              this.app.emit('layers');
            } finally {
              this.suppressRefresh = false;
            }
          }
        },
        onTypeChanged: () => this.refresh(true),
      }),
    );
  }
}

export function openParamCreateDialog(app: App) {
  const draft = cloneShape(app.createPreset);
  let customName = '';
  const nameIn = h('input', {
    type: 'text',
    class: 'text-input',
    placeholder: '图层名称（留空则自动命名）',
    oninput: () => { customName = nameIn.value; },
  }) as HTMLInputElement;

  const formHost = h('div', {});
  const rebuildForm = () => {
    formHost.innerHTML = '';
    formHost.append(
      buildShapeForm(draft, app, {
        allowChangeType: true,
        includeMaterial: true,
        beforeMutate: () => {},
        afterMutate: () => {},
        onTypeChanged: () => rebuildForm(),
      }),
    );
  };
  rebuildForm();

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:8px' },
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '图层名'), nameIn),
    formHost,
  );

  let close = () => {};
  close = openSheet('🧱 填入参数生成立体图形', body, {
    wide: true,
    actions: [
      h('button', { class: 'btn', onclick: () => close() }, '取消'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            app.createPreset = cloneShape(draft);
            const created = app.addShapeLayer(draft, customName);
            app.setTool('select');
            close();
            toast(`✨ 已按参数生成「${created.name}」`);
          },
        },
        '✓ 立即生成到画布',
      ),
    ],
  });
}
