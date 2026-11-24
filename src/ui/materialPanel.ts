// Material & Texture Panel ("材质与纹理"):
// - Planar face selector for planar primitives (box, prism, right_tri_prism, wedge, pyramid)
// - Per-face texture mapping modes: None, Stretch ("填充"), Tile ("覆盖" repeat without distortion), Custom ("自定义" puzzle plane)
// - Texture Asset Library with Pixel Meow lossless sawtooth shear & arbitrary parallelogram conversion
// - Migrated general material, shading, outline, and procedural surface texture controls

import type { App } from '../app';
import { clamp, parseHex, toHex, toHex8, type RGBA } from '../core/color';
import { DEFAULT_GROUND_SHADOW_COLOR, DEFAULT_GROUND_SHADOW_HEX } from '../core/groundShadow';
import {
  MAX_SHADE_CONTRAST,
  MIN_SHADE_CONTRAST,
  type FacadePatternType,
  type OutlineMode,
  type ParametricShape,
  type ShapeKind,
} from '../core/isoRenderer';
import {
  cloneFaceTextureSlot,
  countTextureAssetUsage,
  cropRgbaBuffer,
  getAssetDisplayPixels,
  getEffectiveAssetDims,
  getPlanarFacesForShape,
  getTextureAsset,
  getTextureLibrary,
  isPlanarTextureShape,
  onTextureLibraryChange,
  type FaceTextureMode,
  type FaceTextureSlot,
  type PlanarFaceSpec,
  type TextureCropRect,
} from '../core/textures';
import { openColorPicker } from './colorPicker';
import { h, rangeRow, select, toast, toggle } from './dom';
import {
  addDecalToSlot,
  createFaceComposerWidget,
  openFaceComposerModal,
  type ComposerPlaneMode,
  type FaceComposerController,
} from './faceComposerUI';
import {
  buildTextureLibrarySection,
  drawRgbaThumbOnCanvas,
  notifyActiveFaceChanged,
  openActiveFacePixelEditor,
  openTextureCropDialog,
} from './textureLibraryUI';

const PATTERN_OPTIONS: { id: FacadePatternType; label: string }[] = [
  { id: 'none', label: '无纹理 (纯色光影)' },
  { id: 'windows', label: '像素窗户阵列' },
  { id: 'curtain_v', label: '竖向条纹幕墙' },
  { id: 'curtain_h', label: '横向层间带窗' },
  { id: 'brick', label: '像素砖纹立面' },
  { id: 'roof_grid', label: '顶面等距格栅' },
];

export function buildColorPickerRow(
  label: string,
  col: RGBA,
  app: App,
  hooks: {
    onRestoreSilent: (orig: RGBA) => void;
    onBegin?: () => void;
    onPreview: (next: RGBA) => void;
    onCommit: (next: RGBA) => void;
    onCancel: (orig: RGBA) => void;
    allowAlpha?: boolean;
  },
): HTMLElement {
  const allowAlpha = Boolean(hooks.allowAlpha);
  const normCol = (c: RGBA): RGBA => ({
    r: clamp(Math.round(c.r), 0, 255),
    g: clamp(Math.round(c.g), 0, 255),
    b: clamp(Math.round(c.b), 0, 255),
    a: allowAlpha ? clamp(Math.round(c.a), 0, 255) : 255,
  });
  const fmtHex = (c: RGBA) => (allowAlpha ? toHex8(c) : toHex(c));
  const toChipCss = (c: RGBA) =>
    allowAlpha
      ? `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`
      : toHex(c);

  let currentCol: RGBA = normCol(col);
  const chip = h('span', {
    class: `cp-trigger-chip${allowAlpha ? ' alpha' : ''}`,
    style: `--c:${toChipCss(currentCol)}`,
  });
  const hexLabel = h('span', { class: 'cp-trigger-hex mono' }, fmtHex(currentCol));
  const swatches = h('div', { class: 'swatch-mini-row' });

  const syncTrigger = (c: RGBA) => {
    chip.style.setProperty('--c', toChipCss(c));
    hexLabel.textContent = fmtHex(c);
  };

  let unsubRecent = () => {};
  const renderSwatches = () => {
    swatches.innerHTML = '';
    const activeHex = toHex(currentCol);
    for (const c of app.recentColors.slice(0, 8)) {
      const upper = c.toUpperCase();
      swatches.append(
        h('button', {
          type: 'button',
          class: `swatch-mini${upper === activeHex ? ' active' : ''}`,
          style: `background:${upper}`,
          title: upper,
          onclick: () => {
            const parsed = parseHex(upper);
            if (!parsed) return;
            const next: RGBA = { r: parsed.r, g: parsed.g, b: parsed.b, a: currentCol.a };
            if (fmtHex(next) === fmtHex(currentCol)) return;
            hooks.onBegin?.();
            currentCol = next;
            syncTrigger(currentCol);
            app.rememberColor(toHex(currentCol));
            hooks.onCommit({ ...currentCol });
            renderSwatches();
          },
        }),
      );
    }
  };

  const triggerBtn = h(
    'button',
    {
      type: 'button',
      class: 'color-picker-trigger',
      title: `打开 Pixel Meow 选色器设置${label}`,
      onclick: () => {
        const sessionStart: RGBA = { ...currentCol };
        openColorPicker(app, {
          title: `选择${label}`,
          initialColor: sessionStart,
          allowAlpha,
          onPreview: (next) => {
            syncTrigger(next);
            hooks.onPreview(next);
          },
          onCancel: (orig) => {
            currentCol = normCol(orig);
            syncTrigger(currentCol);
            renderSwatches();
            hooks.onCancel({ ...currentCol });
          },
          onCommit: (finalCol) => {
            const nextNorm = normCol(finalCol);
            const changed =
              nextNorm.r !== sessionStart.r ||
              nextNorm.g !== sessionStart.g ||
              nextNorm.b !== sessionStart.b ||
              nextNorm.a !== sessionStart.a;
            if (!changed) {
              currentCol = { ...sessionStart };
              syncTrigger(currentCol);
              renderSwatches();
              return;
            }
            hooks.onRestoreSilent({ ...sessionStart });
            hooks.onBegin?.();
            currentCol = nextNorm;
            hooks.onCommit({ ...currentCol });
            syncTrigger(currentCol);
            renderSwatches();
          },
        });
      },
    },
    chip,
    hexLabel,
    h('span', { class: 'cp-trigger-tag' }, '取色板'),
  );

  const rootEl = h(
    'div',
    { class: 'prop-block' },
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, label), triggerBtn),
    swatches,
  );
  renderSwatches();
  unsubRecent = app.onRecentColors(() => {
    if (!rootEl.isConnected) {
      unsubRecent();
      return;
    }
    renderSwatches();
  });

  return rootEl;
}

export function buildRgbaColorPickerRow(
  label: string,
  col: RGBA,
  app: App,
  hooks: {
    onRestoreSilent: (orig: RGBA) => void;
    onBegin?: () => void;
    onPreview: (next: RGBA) => void;
    onCommit: (next: RGBA) => void;
    onCancel: (orig: RGBA) => void;
  },
): HTMLElement {
  return buildColorPickerRow(label, col, app, { ...hooks, allowAlpha: true });
}

export function buildGroundShadowControlsSection(
  app: App,
  onRebuild?: () => void,
): HTMLElement {
  const gs = app.doc.groundShadow;
  const wrap = h('div', { class: 'shape-form' });
  wrap.append(
    h('div', { class: 'menu-sec' }, '☀️ TheoTown 自动地面阴影与体块投影 (1:1 正右方)'),
    toggle('启用自动地面阴影（单独导出为「地面阴影」图层）', gs.enabled, (v) => {
      app.setGroundShadow({ enabled: v }, { pushHistory: v ? '启用自动地面阴影' : '隐藏自动地面阴影' });
      onRebuild?.();
    }),
    toggle('🧪 启用体块间投射阴影（实验性 · 单独导出为「结构阴影」图层）', Boolean(gs.interBlockEnabled), (v) => {
      app.setGroundShadow(
        { interBlockEnabled: v },
        { pushHistory: v ? '启用体块间投射阴影 (实验)' : '关闭体块间投射阴影' },
      );
      onRebuild?.();
    }),
  );

  if (gs.enabled || gs.interBlockEnabled) {
    wrap.append(
      buildRgbaColorPickerRow('阴影颜色与不透明度（共用）', gs.color, app, {
        onRestoreSilent: (orig) => {
          app.doc.groundShadow.color = { ...orig };
        },
        onBegin: () => app.pushHistory('修改阴影颜色'),
        onPreview: (next) => {
          app.setGroundShadow({ color: next }, { live: true });
        },
        onCancel: (orig) => {
          app.setGroundShadow({ color: orig }, { live: true });
        },
        onCommit: (next) => {
          app.setGroundShadow({ color: next });
          onRebuild?.();
        },
      }),
      (() => {
        let opPushed = false;
        const pct = Math.round((gs.color.a / 255) * 1000) / 10;
        return rangeRow(
          '阴影不透明度 (%)',
          0,
          100,
          pct,
          (v) => {
            const nextA = clamp(Math.round((v / 100) * 255), 0, 255);
            app.setGroundShadow({ color: { ...app.doc.groundShadow.color, a: nextA } }, { live: true });
          },
          0.1,
          {
            onBegin: () => {
              opPushed = true;
              app.pushHistory('调整阴影不透明度');
            },
            onCommit: () => {
              if (!opPushed) return;
              opPushed = false;
              app.emit('doc');
              app.emit('layers');
              onRebuild?.();
            },
          },
        ).row;
      })(),
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn small',
            title: `重置阴影颜色为 TheoTown 推荐默认值 (${DEFAULT_GROUND_SHADOW_HEX})`,
            onclick: () => {
              const cur = app.doc.groundShadow.color;
              const def = DEFAULT_GROUND_SHADOW_COLOR;
              if (cur.r === def.r && cur.g === def.g && cur.b === def.b && cur.a === def.a) return;
              app.setGroundShadow(
                { color: { ...def } },
                { pushHistory: `重置阴影颜色为 ${DEFAULT_GROUND_SHADOW_HEX}` },
              );
              onRebuild?.();
            },
          },
          `↺ 重置阴影色 (${DEFAULT_GROUND_SHADOW_HEX})`,
        ),
      ),
    );
  }
  wrap.append(
    h('div', { class: 'hint' }, '地面阴影仅作用于 Z=0 地面；开启「体块间投射阴影」实验选项后，高体块可按 1:1 光线向右侧邻近/下方体块投射独立结构阴影。'),
  );
  return wrap;
}

export function buildGeneralMaterialSection(
  shape: ParametricShape,
  app: App,
  opts: {
    beforeMutate: (label: string) => void;
    afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => void;
    onRebuild?: (kind: ShapeKind) => void;
  },
): HTMLElement {
  const wrap = h('div', { class: 'shape-form' });
  if (shape.shapeType === 'theotown_base') {
    wrap.append(h('div', { class: 'hint' }, 'TheoTown 绿地底座使用标准草坪像素模板，无材质颜色设置。'));
    return wrap;
  }

  wrap.append(h('div', { class: 'menu-sec' }, '像素光影与轮廓'));
  wrap.append(
    buildColorPickerRow('主体颜色', shape.baseColor, app, {
      onRestoreSilent: (orig) => {
        shape.baseColor = { ...orig, a: 255 };
      },
      onBegin: () => opts.beforeMutate('修改主体颜色'),
      onPreview: (c) => {
        shape.baseColor = { ...c, a: 255 };
        opts.afterMutate({ live: true });
      },
      onCancel: (orig) => {
        shape.baseColor = { ...orig, a: 255 };
        opts.afterMutate({ live: true });
      },
      onCommit: (c) => {
        shape.baseColor = { ...c, a: 255 };
        opts.afterMutate({ live: false });
      },
    }),
  );

  const hasRoof = shape.roofColor !== null;
  wrap.append(
    toggle('使用独立顶面 / 屋顶颜色', hasRoof, (checked) => {
      opts.beforeMutate('切换顶面颜色');
      shape.roofColor = checked ? { r: 214, g: 112, b: 96, a: 255 } : null;
      opts.afterMutate();
      opts.onRebuild?.(shape.shapeType);
    }),
  );
  if (shape.roofColor) {
    wrap.append(
      buildColorPickerRow('顶面颜色', shape.roofColor, app, {
        onRestoreSilent: (orig) => {
          if (shape.roofColor) shape.roofColor = { ...orig, a: 255 };
        },
        onBegin: () => opts.beforeMutate('修改顶面颜色'),
        onPreview: (c) => {
          if (!shape.roofColor) return;
          shape.roofColor = { ...c, a: 255 };
          opts.afterMutate({ live: true });
        },
        onCancel: (orig) => {
          if (!shape.roofColor) return;
          shape.roofColor = { ...orig, a: 255 };
          opts.afterMutate({ live: true });
        },
        onCommit: (c) => {
          if (!shape.roofColor) return;
          shape.roofColor = { ...c, a: 255 };
          opts.afterMutate({ live: false });
        },
      }),
    );
  }

  wrap.append(
    toggle('三面自动像素明暗着色', shape.autoShade, (v) => {
      opts.beforeMutate('切换自动光影');
      shape.autoShade = v;
      opts.afterMutate();
    }),
    rangeRow(
      '光影反差',
      MIN_SHADE_CONTRAST,
      MAX_SHADE_CONTRAST,
      shape.shadeContrast,
      (v) => {
        shape.shadeContrast = v;
        opts.afterMutate({ live: true });
      },
      0.1,
      {
        onBegin: () => opts.beforeMutate('调整光影反差'),
        onCommit: () => opts.afterMutate({ live: false }),
      },
    ).row,
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '轮廓'),
      select<OutlineMode>(
        [
          { id: 'none', label: '无描边' },
          { id: 'outer', label: '仅外圈轮廓' },
          { id: 'all_edges', label: '完整轮廓 + 棱线' },
        ],
        shape.outlineMode,
        (v) => {
          opts.beforeMutate('调整轮廓模式');
          shape.outlineMode = v;
          opts.afterMutate();
        },
      ),
    ),
    toggle('前向受光棱线高光', shape.edgeHighlight, (v) => {
      opts.beforeMutate('切换棱线高光');
      shape.edgeHighlight = v;
      opts.afterMutate();
    }),
  );

  // Procedural facade patterns
  wrap.append(h('div', { class: 'menu-sec' }, '程序化建筑表面纹理 (2:1 像素斜切)'));
  wrap.append(
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '纹理样式'),
      select(PATTERN_OPTIONS, shape.pattern.type, (t) => {
        opts.beforeMutate('修改立面纹理');
        shape.pattern.type = t;
        opts.afterMutate();
        opts.onRebuild?.(shape.shapeType);
      }),
    ),
  );

  if (shape.pattern.type !== 'none') {
    wrap.append(
      buildColorPickerRow('纹理色', shape.pattern.primaryColor, app, {
        onRestoreSilent: (orig) => {
          shape.pattern.primaryColor = { ...orig, a: 255 };
        },
        onBegin: () => opts.beforeMutate('修改纹理颜色'),
        onPreview: (c) => {
          shape.pattern.primaryColor = { ...c, a: 255 };
          opts.afterMutate({ live: true });
        },
        onCancel: (orig) => {
          shape.pattern.primaryColor = { ...orig, a: 255 };
          opts.afterMutate({ live: true });
        },
        onCommit: (c) => {
          shape.pattern.primaryColor = { ...c, a: 255 };
          opts.afterMutate({ live: false });
        },
      }),
      rangeRow(
        '行数 (层)',
        1,
        16,
        shape.pattern.rows,
        (v) => {
          shape.pattern.rows = Math.round(v);
          opts.afterMutate({ live: true });
        },
        1,
        {
          onBegin: () => opts.beforeMutate('调整纹理行数'),
          onCommit: () => opts.afterMutate({ live: false }),
        },
      ).row,
      rangeRow(
        '列数 (跨)',
        1,
        16,
        shape.pattern.cols,
        (v) => {
          shape.pattern.cols = Math.round(v);
          opts.afterMutate({ live: true });
        },
        1,
        {
          onBegin: () => opts.beforeMutate('调整纹理列数'),
          onCommit: () => opts.afterMutate({ live: false }),
        },
      ).row,
      rangeRow(
        '间距 (px)',
        1,
        8,
        shape.pattern.spacingPx,
        (v) => {
          shape.pattern.spacingPx = Math.round(v);
          opts.afterMutate({ live: true });
        },
        1,
        {
          onBegin: () => opts.beforeMutate('调整纹理间距'),
          onCommit: () => opts.afterMutate({ live: false }),
        },
      ).row,
      rangeRow(
        '边距 (px)',
        0,
        12,
        shape.pattern.marginPx,
        (v) => {
          shape.pattern.marginPx = Math.round(v);
          opts.afterMutate({ live: true });
        },
        1,
        {
          onBegin: () => opts.beforeMutate('调整纹理边距'),
          onCommit: () => opts.afterMutate({ live: false }),
        },
      ).row,
      toggle('顶面叠加等距格栅', shape.pattern.applyTop, (v) => {
        opts.beforeMutate('切换顶面格栅');
        shape.pattern.applyTop = v;
        opts.afterMutate();
      }),
    );
  }

  return wrap;
}

export class MaterialPanel {
  el: HTMLElement;
  private body: HTMLElement;
  private titleEl: HTMLElement;
  private suppressRefresh = false;
  private composerCtrl: FaceComposerController | null = null;
  private composerPlaneMode: ComposerPlaneMode = 'rect';
  private libGroupFilter = 'all';
  private pendingLibRefresh = false;

  constructor(private app: App) {
    this.titleEl = h('b', {}, '材质与纹理');
    this.body = h('div', { class: 'inspector-body' });
    this.el = h(
      'div',
      { class: 'inspector-section' },
      h('div', { class: 'panel-head' }, this.titleEl),
      this.body,
    );
    onTextureLibraryChange((reason) => {
      if (!this.el.isConnected) return;
      if (reason === 'pixels' || reason === 'list' || reason === 'project_hydrate') {
        this.app.doc.rerenderAllShapes();
        this.app.emit('doc_live');
      }
      if (
        reason === 'groups' ||
        reason === 'pixels' ||
        reason === 'list' ||
        reason === 'display' ||
        reason === 'project_hydrate'
      ) {
        if (this.pendingLibRefresh) return;
        this.pendingLibRefresh = true;
        queueMicrotask(() => {
          this.pendingLibRefresh = false;
          if (this.el.isConnected) this.refresh(true);
        });
      }
    });
    this.refresh();
  }

  refresh(force = false) {
    if (!force && this.suppressRefresh) return;
    if (this.composerCtrl) {
      this.composerPlaneMode = this.composerCtrl.getPlaneMode();
      this.composerCtrl.dispose();
      this.composerCtrl = null;
    }
    this.body.innerHTML = '';

    const active = this.app.doc.layer;
    const isShapeLayer = this.app.tool !== 'create' && active && active.kind === 'shape' && active.shape;
    const shape = isShapeLayer ? active!.shape! : this.app.createPreset;
    const activeId = isShapeLayer ? active!.id : undefined;

    this.titleEl.textContent = isShapeLayer ? `材质与纹理 · ${active!.name}` : '材质与纹理 · 新建预设';

    const mutHooks = {
      beforeMutate: (label: string) => {
        if (!isShapeLayer) return;
        this.suppressRefresh = true;
        try {
          this.app.pushHistory(label);
        } finally {
          this.suppressRefresh = false;
        }
      },
      afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => {
        if (!isShapeLayer) {
          if (!options?.live) {
            this.suppressRefresh = true;
            try {
              this.app.emit('preset');
            } finally {
              this.suppressRefresh = false;
            }
          }
          return;
        }
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
      onRebuild: () => this.refresh(true),
    };

    if (!isShapeLayer && active?.kind === 'raster') {
      this.body.append(h('div', { class: 'hint', style: 'margin-bottom:6px' }, `当前为参考图层「${active.name}」（以下调整后续新图形材质预设）`));
    }

    // 1. Planar face selection & custom texture attachment section
    if (isPlanarTextureShape(shape)) {
      this.buildPlanarTextureSection(shape, activeId, mutHooks);
    } else if (shape.shapeType !== 'theotown_base') {
      this.body.append(
        h('div', { class: 'menu-sec' }, '🎯 平面选择与自定义纹理'),
        h(
          'div',
          { class: 'hint' },
          '自定义平面纹理贴附目前仅支持拥有规则平面的几何体（立方体 / 长方体、多棱柱、直角三棱柱、楔形坡屋顶、四棱锥）。曲面柱、圆柱、拱形与穹顶可使用下方程序化表面纹理。',
        ),
      );
    }

    // 2. General material, lighting, outlines & procedural patterns (migrated from Inspector)
    this.body.append(buildGeneralMaterialSection(shape, this.app, mutHooks));

    // 3. Automatic TheoTown 1:1 ground shadow settings (always accessible for current project)
    this.body.append(buildGroundShadowControlsSection(this.app, () => this.refresh(true)));
  }

  private buildPlanarTextureSection(
    shape: ParametricShape,
    activeId: number | undefined,
    hooks: {
      beforeMutate: (label: string) => void;
      afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => void;
      onRebuild: () => void;
    },
  ) {
    const faces = getPlanarFacesForShape(shape);
    if (faces.length === 0) return;
    const faceId = this.app.getActiveFaceId(activeId, shape) ?? faces[0].id;
    const activeFace = faces.find((f) => f.id === faceId) ?? faces[0];

    const ensureSlot = (targetFaceId = activeFace.id): FaceTextureSlot => {
      if (!shape.faceTextures) shape.faceTextures = {};
      if (!shape.faceTextures[targetFaceId]) {
        shape.faceTextures[targetFaceId] = { mode: 'none', shadeWithFace: true };
      }
      return shape.faceTextures[targetFaceId];
    };
    const currentSlot: FaceTextureSlot = shape.faceTextures?.[activeFace.id] ?? { mode: 'none', shadeWithFace: true };
    const mode: FaceTextureMode = currentSlot.mode ?? 'none';

    // Face selector header & pills
    this.body.append(h('div', { class: 'menu-sec' }, '🎯 平面选择与贴图模式'));
    const pillGrid = h('div', { class: 'face-chip-grid' });
    for (const f of faces) {
      const slot = shape.faceTextures?.[f.id];
      const hasTex = Boolean(slot && slot.mode !== 'none' && (slot.assetId || (slot.items && slot.items.length > 0)));
      const btn = h(
        'button',
        {
          type: 'button',
          class: `face-chip${f.id === activeFace.id ? ' active' : ''}${hasTex ? ' textured' : ''}`,
          title: `${f.label} (${f.faceW}×${f.faceH} px)`,
          onclick: () => {
            this.app.setActiveFaceId(activeId, f.id, shape);
            this.app.emit('doc_live');
            notifyActiveFaceChanged();
            this.refresh(true);
          },
        },
        h('span', {}, f.shortLabel),
        h('span', { class: 'face-chip-dim' }, `${f.faceW}×${f.faceH}`),
      );
      pillGrid.append(btn);
    }
    this.body.append(pillGrid);

    const copyBtnRow = h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          title: '将当前平面的贴图配置复制到所有侧面/斜面',
          onclick: () => {
            const src = shape.faceTextures?.[activeFace.id];
            if (!src || src.mode === 'none') {
              toast('当前平面未设置贴图');
              return;
            }
            hooks.beforeMutate('复制贴图到全部侧面');
            if (!shape.faceTextures) shape.faceTextures = {};
            const targets = faces.filter((f) => !f.isTop);
            for (const tf of targets) {
              shape.faceTextures[tf.id] = cloneFaceTextureSlot(src);
            }
            hooks.afterMutate();
            this.refresh(true);
            toast(`已应用到 ${targets.length} 个平面`);
          },
        },
        '📋 应用到全部侧面',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn small danger',
          disabled: !shape.faceTextures?.[activeFace.id] || shape.faceTextures[activeFace.id].mode === 'none',
          onclick: () => {
            if (!shape.faceTextures?.[activeFace.id]) return;
            hooks.beforeMutate('清空当前平面贴图');
            delete shape.faceTextures[activeFace.id];
            if (Object.keys(shape.faceTextures).length === 0) delete shape.faceTextures;
            hooks.afterMutate();
            this.refresh(true);
          },
        },
        '🧹 清空此面',
      ),
    );
    this.body.append(copyBtnRow);

    // Mode tabs: 无 / 填充 / 覆盖 / 自定义
    const setMode = (nextMode: FaceTextureMode) => {
      if (mode === nextMode) return;
      hooks.beforeMutate(`切换贴图模式: ${nextMode}`);
      if (nextMode === 'none') {
        if (shape.faceTextures) {
          delete shape.faceTextures[activeFace.id];
          if (Object.keys(shape.faceTextures).length === 0) delete shape.faceTextures;
        }
      } else {
        const slot = ensureSlot(activeFace.id);
        slot.mode = nextMode;
        if (slot.shadeWithFace === undefined) slot.shadeWithFace = true;
        if ((nextMode === 'stretch' || nextMode === 'tile') && !slot.assetId) {
          slot.assetId = getTextureLibrary()[0]?.id;
        }
        if (nextMode === 'tile' && slot.tileScale === undefined) {
          slot.tileScale = 1;
        }
        if (nextMode === 'custom' && !slot.items) {
          slot.items = [];
        }
      }
      hooks.afterMutate();
      this.refresh(true);
    };

    const modeSeg = h(
      'div',
      { class: 'seg-row' },
      ...(
        [
          { id: 'none', lbl: '无' },
          { id: 'stretch', lbl: '填充(拉伸)' },
          { id: 'tile', lbl: '覆盖(平铺)' },
          { id: 'custom', lbl: '自定义(拼图)' },
        ] as { id: FaceTextureMode; lbl: string }[]
      ).map((m) =>
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn${mode === m.id ? ' active' : ''}`,
            onclick: () => setMode(m.id),
          },
          m.lbl,
        ),
      ),
    );
    this.body.append(modeSeg);

    const editWholeFaceBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn small primary',
        style: 'width:100%',
        title: `将该面当前贴图效果合成为 ${activeFace.faceW}×${activeFace.faceH} px 独立像素画布进行整面绘制/精修`,
        onclick: () => {
          openActiveFacePixelEditor(this.app, {
            layerId: activeId,
            shape,
            faceId: activeFace.id,
            beforeMutate: (l) => hooks.beforeMutate(l),
            afterMutate: () => {
              hooks.afterMutate();
              this.refresh(true);
            },
          });
        },
      },
      `🖌️ 用像素画布编辑整个平面 (${activeFace.faceW}×${activeFace.faceH} px)`,
    );
    const editFaceRow = h('div', { class: 'btn-row', style: 'margin:4px 0' }, editWholeFaceBtn);
    const syncEditFaceBtn = () => {
      const sl = shape.faceTextures?.[activeFace.id];
      const slMode = sl?.mode ?? 'none';
      const hasTex = Boolean(
        sl &&
        slMode !== 'none' &&
        ((slMode === 'custom' && sl.items && sl.items.length > 0) ||
          ((slMode === 'stretch' || slMode === 'tile') && sl.assetId)),
      );
      editFaceRow.style.display = hasTex ? '' : 'none';
    };
    syncEditFaceBtn();
    this.body.append(editFaceRow);

    // Per-mode settings panel
    if (mode === 'stretch' || mode === 'tile') {
      const boundAsset = getTextureAsset(currentSlot.assetId);
      const previewThumb = h('canvas', { class: 'tex-bound-thumb' }) as HTMLCanvasElement;
      const effDims = boundAsset ? getEffectiveAssetDims(boundAsset, currentSlot.crop) : null;
      if (boundAsset) {
        if (currentSlot.crop) {
          const cropped = cropRgbaBuffer(boundAsset.rectData, boundAsset.width, boundAsset.height, currentSlot.crop);
          drawRgbaThumbOnCanvas(previewThumb, cropped.data, cropped.width, cropped.height, 44, 44);
        } else {
          const disp = getAssetDisplayPixels(boundAsset);
          drawRgbaThumbOnCanvas(previewThumb, disp.data, disp.width, disp.height, 44, 44);
        }
      }

      const texCropActionsRow = boundAsset
        ? h(
            'div',
            { class: 'row', style: 'gap:6px;margin-top:4px' },
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                style: 'flex:1;padding:4px 8px;font-size:11px',
                onclick: () => {
                  openTextureCropDialog({
                    title: `✂️ 裁切纹理「${boundAsset.name}」→ ${activeFace.shortLabel}`,
                    data: boundAsset.rectData,
                    width: boundAsset.width,
                    height: boundAsset.height,
                    initialCrop: currentSlot.crop,
                    faceSpec: activeFace,
                    confirmLabel: '✓ 应用裁切',
                    onConfirm: (nextCrop: TextureCropRect | undefined) => {
                      hooks.beforeMutate(`裁切 ${activeFace.shortLabel} 纹理`);
                      const sl = ensureSlot(activeFace.id);
                      if (nextCrop) sl.crop = nextCrop;
                      else delete sl.crop;
                      hooks.afterMutate();
                      this.refresh(true);
                    },
                  });
                },
              },
              currentSlot.crop && effDims ? `✂️ 调整裁切 (${effDims.w}×${effDims.h})` : '✂️ 裁切纹理',
            ),
            currentSlot.crop
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    style: 'padding:4px 8px;font-size:11px',
                    title: '还原使用整张原图',
                    onclick: () => {
                      hooks.beforeMutate(`还原 ${activeFace.shortLabel} 整图`);
                      const sl = ensureSlot(activeFace.id);
                      delete sl.crop;
                      hooks.afterMutate();
                      this.refresh(true);
                    },
                  },
                  '↺ 整图',
                )
              : null,
          )
        : null;

      this.body.append(
        h(
          'div',
          { class: 'tex-bound-bar' },
          previewThumb,
          h(
            'div',
            { class: 'tex-bound-meta' },
            h(
              'b',
              { style: 'font-size:12px' },
              boundAsset
                ? currentSlot.crop && effDims
                  ? `${boundAsset.name} · 裁切 ${effDims.w}×${effDims.h}`
                  : boundAsset.name
                : '未选择纹理',
            ),
            h(
              'span',
              { class: 'hint' },
              mode === 'stretch'
                ? `拉伸填满整个「${activeFace.shortLabel}」(${activeFace.faceW}×${activeFace.faceH} px)`
                : `保持原像素比例重复覆盖「${activeFace.shortLabel}」(${activeFace.faceW}×${activeFace.faceH} px)，无拉伸失真`,
            ),
          ),
        ),
      );
      if (texCropActionsRow) this.body.append(texCropActionsRow);

      if (mode === 'tile') {
        this.body.append(
          rangeRow(
            '平铺倍率',
            0.25,
            4,
            currentSlot.tileScale ?? 1,
            (v) => {
              ensureSlot().tileScale = v;
              hooks.afterMutate({ live: true });
            },
            0.25,
            {
              onBegin: () => hooks.beforeMutate('调整纹理平铺倍率'),
              onCommit: () => hooks.afterMutate({ live: false }),
            },
          ).row,
          rangeRow(
            'X 偏移 (px)',
            -32,
            32,
            currentSlot.offsetX ?? 0,
            (v) => {
              ensureSlot().offsetX = Math.round(v);
              hooks.afterMutate({ live: true });
            },
            1,
            {
              onBegin: () => hooks.beforeMutate('调整纹理横向偏移'),
              onCommit: () => hooks.afterMutate({ live: false }),
            },
          ).row,
          rangeRow(
            'Y 偏移 (px)',
            -32,
            32,
            currentSlot.offsetY ?? 0,
            (v) => {
              ensureSlot().offsetY = Math.round(v);
              hooks.afterMutate({ live: true });
            },
            1,
            {
              onBegin: () => hooks.beforeMutate('调整纹理纵向偏移'),
              onCommit: () => hooks.afterMutate({ live: false }),
            },
          ).row,
        );
      }

      this.body.append(
        h(
          'div',
          { class: 'btn-row' },
          h(
            'button',
            {
              type: 'button',
              class: `btn small${currentSlot.flipX ? ' primary' : ''}`,
              onclick: () => {
                hooks.beforeMutate('水平翻转平面贴图');
                const sl = ensureSlot();
                sl.flipX = !sl.flipX;
                hooks.afterMutate();
                this.refresh(true);
              },
            },
            '↔ 水平翻转',
          ),
          h(
            'button',
            {
              type: 'button',
              class: `btn small${currentSlot.flipY ? ' primary' : ''}`,
              onclick: () => {
                hooks.beforeMutate('垂直翻转平面贴图');
                const sl = ensureSlot();
                sl.flipY = !sl.flipY;
                hooks.afterMutate();
                this.refresh(true);
              },
            },
            '↕ 垂直翻转',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: () => {
                hooks.beforeMutate('旋转平面贴图 90°');
                const sl = ensureSlot();
                sl.rot90 = (((sl.rot90 ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
                hooks.afterMutate();
                this.refresh(true);
              },
            },
            `↻ 旋转 (${(currentSlot.rot90 ?? 0) * 90}°)`,
          ),
        ),
        rangeRow(
          '不透明度',
          0.1,
          1,
          currentSlot.opacity ?? 1,
          (v) => {
            ensureSlot().opacity = v;
            hooks.afterMutate({ live: true });
          },
          0.05,
          {
            onBegin: () => hooks.beforeMutate('调整贴图不透明度'),
            onCommit: () => hooks.afterMutate({ live: false }),
          },
        ).row,
        toggle('纹理跟随立面明暗光影', currentSlot.shadeWithFace !== false, (v) => {
          hooks.beforeMutate('切换纹理光影随面着色');
          ensureSlot().shadeWithFace = v;
          hooks.afterMutate();
        }),
      );
    } else if (mode === 'custom') {
      const ctrl = createFaceComposerWidget({
        app: this.app,
        getShape: () => shape,
        getFaceSpec: () => getPlanarFacesForShape(shape).find((f) => f.id === activeFace.id) ?? activeFace,
        getSlot: () => shape.faceTextures?.[activeFace.id] ?? null,
        targetLayerId: activeId,
        beforeMutate: (label) => hooks.beforeMutate(label),
        afterMutate: (o) => hooks.afterMutate(o),
        onSyncExternal: () => {
          if (shape.faceTextures?.[activeFace.id]?.mode !== 'custom') {
            this.refresh(true);
            return;
          }
          syncEditFaceBtn();
        },
        canvasW: 268,
        canvasH: 204,
        compact: true,
        bindCanvasShortcuts: true,
      });
      ctrl.setPlaneMode(this.composerPlaneMode);
      this.composerCtrl = ctrl;

      this.body.append(
        ctrl.el,
        h(
          'div',
          { class: 'btn-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn small primary',
              onclick: () => {
                openFaceComposerModal(this.app, shape, activeFace.id, activeId, {
                  beforeMutate: hooks.beforeMutate,
                  afterMutate: hooks.afterMutate,
                  onClosed: () => this.refresh(true),
                });
              },
            },
            '🔍 打开大屏精细拼贴窗口 (支持撤回/恢复)',
          ),
        ),
        toggle('纹理跟随立面明暗光影', currentSlot.shadeWithFace !== false, (v) => {
          hooks.beforeMutate('切换纹理光影随面着色');
          ensureSlot().shadeWithFace = v;
          hooks.afterMutate();
        }),
      );
    }

    // Texture asset library (always visible below face mapping controls on planar shapes)
    this.body.append(h('div', { class: 'menu-sec' }, '📦 纹理素材库（矩形 ⇄ 平行四边形斜切）'));
    this.body.append(
      buildTextureLibrarySection({
        app: this.app,
        selectedAssetId: mode === 'stretch' || mode === 'tile' ? currentSlot.assetId : undefined,
        actionHint: mode === 'custom'
          ? `点击素材将其贴入「${activeFace.shortLabel}」自定义平面`
          : `点击素材应用到「${activeFace.shortLabel}」（支持 ▭⇄▱ 无损斜切与裁切）`,
        faceSpec: activeFace,
        groupState: {
          get: () => this.libGroupFilter,
          set: (id) => { this.libGroupFilter = id; },
        },
        getAssetUsageCount: (assetId) => countTextureAssetUsage(this.app.doc.layers.map((l) => l.shape), assetId),
        onPickAsset: (asset, crop) => {
          if (mode === 'custom') {
            hooks.beforeMutate(`向 ${activeFace.shortLabel} 贴入 ${asset.name}`);
            const sl = ensureSlot(activeFace.id);
            sl.mode = 'custom';
            const spec: PlanarFaceSpec = getPlanarFacesForShape(shape).find((f) => f.id === activeFace.id) ?? activeFace;
            const added = addDecalToSlot(sl, asset.id, spec, crop);
            hooks.afterMutate();
            if (added) {
              this.composerCtrl?.selectItem(added.id);
            }
            this.composerCtrl?.refresh();
            syncEditFaceBtn();
          } else {
            hooks.beforeMutate(`为 ${activeFace.shortLabel} 应用 ${asset.name}`);
            const sl = ensureSlot(activeFace.id);
            if (sl.mode === 'none') sl.mode = 'stretch';
            if (sl.shadeWithFace === undefined) sl.shadeWithFace = true;
            sl.assetId = asset.id;
            if (crop) sl.crop = crop;
            else delete sl.crop;
            hooks.afterMutate();
            this.refresh(true);
          }
        },
        onAssetsChanged: () => {
          if (this.el.isConnected) this.refresh(true);
        },
      }),
    );
  }
}
