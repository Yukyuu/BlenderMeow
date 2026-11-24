// Blender Meow entry: Topbar (90° rotation, 32x16 snap, PSD/PNG export, Pixel Meow handoff), Left Shape Toolbar, Stage, Right Inspector & Layers
import './style.css';
import { App as CapApp } from '@capacitor/app';
import { App, type RulerMode, type ToolId } from './app';
import { isNative } from './platform';
import { clamp } from './core/color';
import { PIXEL_MEOW_ONLINE_URL } from './core/about';
import {
  SUPPORTED_LOCALES,
  detectSystemLocale,
  getLanguageSetting,
  isEn,
  onLocaleChange,
  tr,
} from './core/i18n';
import { viewBoxToWorld, worldBoxToView, type GridSnapStep } from './core/isoMath';
import { SHAPE_LABELS, type ShapeKind } from './core/isoRenderer';
import { isEditableElement } from './shortcuts/keyCodec';
import { formatActionHint, openShortcutsDialog, shortcutManager } from './shortcuts/blenderShortcuts';
import { resolveAssetUrl } from './core/theotownAssets';
import { RulerTool } from './core/rulerTool';
import { CreateShapeTool, HandTool, PlotFrameTool, SelectGizmoTool, type Tool } from './core/tools';
import {
  APP_VERSION,
  buildAboutLicenseCard,
  checkVersionAndShowChangelog,
  openChangelogDialog,
} from './ui/changelogDialog';
import { initMcpBridge, shouldEnableMcpBridge } from './mcpBridge';
import {
  openExportDialog,
  openPlotFrameDialog,
  openProjectHome,
  openSendToPixelMeowDialog,
  openSettingsDialog,
} from './ui/dialogs';
import { h, icon, openSheet, openSheets, retranslateDom, select, toast, toggle } from './ui/dom';
import { InspectorPanel, openParamCreateDialog } from './ui/inspectorPanel';
import { LayerPanel } from './ui/layerPanel';
import { MaterialPanel } from './ui/materialPanel';
import { ensureColumnSections, hasActiveColumnSections, isColumnSectionShape } from './core/columnSections';
import { loadPersistedTextureLibrary } from './core/textureStore';
import { openArchCurveModal } from './ui/archEditor';
import { openColumnSectionModal } from './ui/columnSectionEditor';
import { openLoftCurveModal } from './ui/loftEditor';
import { openTextureLibraryModal, TextureLibraryDockPanel } from './ui/textureLibraryUI';
import { makeHost, View } from './view';
import {
  ArrowDownWideNarrow,
  Box,
  CircleDot,
  Compass,
  Cone,
  Cylinder,
  FolderOpen,
  Grid3x3,
  Hand,
  Hexagon,
  Images,
  Keyboard,
  Layers,
  Magnet,
  Maximize,
  MousePointer,
  Palette,
  PenSquare,
  Pyramid,
  Rainbow,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Send,
  Settings,
  SlidersHorizontal,
  Spline,
  SquarePlus,
  Triangle,
  TriangleRight,
  Undo2,
  type IconNode,
} from 'lucide';

const app = new App();

const root = document.getElementById('app')!;
const stage = h('div', { class: 'stage' });
const toolOptionStrip = h('div', { class: 'tool-option-strip' });
const rightDrawer = h('aside', { class: 'right-drawer' });
const cursorInfo = h('span', { class: 'cursor-info' }, '就绪 · 32×16 px = 9.6m · 竖直 3px = 1.6m');

let view: View;
const host = makeHost(
  app,
  // late-bound view wrapper
  {
    get zoom() { return view ? view.zoom : 4; },
    requestRender() { view?.requestRender(); },
  } as View,
  toast,
  () => {
    inspectorPanel.refresh();
    materialPanel.refresh();
    layerPanel.refresh();
    refreshToolStrip();
  },
);

const tools: Record<ToolId, Tool> = {
  select: new SelectGizmoTool(host),
  create: new CreateShapeTool(host),
  ruler: new RulerTool(host),
  frame: new PlotFrameTool(host),
  hand: new HandTool(),
};

const layerPanel = new LayerPanel(app, () => openParamCreateDialog(app));
const inspectorPanel = new InspectorPanel(app, () => openParamCreateDialog(app));
const materialPanel = new MaterialPanel(app);
const texLibDock = new TextureLibraryDockPanel(app, () => {
  texLibDock.setOpen(false);
  syncTexLibBtn();
  view?.resize();
});

let rightTab: 'inspector' | 'material' | 'layers' = 'inspector';
const tabInspectorBtn = h('button', {
  class: 'drawer-tab active',
  onclick: () => { rightTab = 'inspector'; syncDrawerTabs(); },
}, icon(SlidersHorizontal, 14), ' 形状修改');
const tabMaterialBtn = h('button', {
  class: 'drawer-tab',
  onclick: () => { rightTab = 'material'; syncDrawerTabs(); },
}, icon(Palette, 14), ' 材质与纹理');
const tabLayersBtn = h('button', {
  class: 'drawer-tab',
  onclick: () => { rightTab = 'layers'; syncDrawerTabs(); },
}, icon(Layers, 14), ' 图层管理');

function syncDrawerTabs() {
  app.rightTab = rightTab;
  tabInspectorBtn.classList.toggle('active', rightTab === 'inspector');
  tabMaterialBtn.classList.toggle('active', rightTab === 'material');
  tabLayersBtn.classList.toggle('active', rightTab === 'layers');
  inspectorPanel.el.classList.toggle('tab-hidden', rightTab !== 'inspector');
  materialPanel.el.classList.toggle('tab-hidden', rightTab !== 'material');
  layerPanel.el.classList.toggle('tab-hidden', rightTab !== 'layers');
  view?.requestRender();
}
syncDrawerTabs();

rightDrawer.append(
  h('div', { class: 'drawer-tabs' }, tabInspectorBtn, tabMaterialBtn, tabLayersBtn),
  h('div', { class: 'drawer-scroll' }, inspectorPanel.el, materialPanel.el, layerPanel.el),
);
syncDrawerTabs();

// ---------------- Topbar ----------------
function openBrandMenu() {
  let close = () => {};
  const langSubEl = h('span', { class: 'menu-lang-sub', 'data-no-i18n': '1' });
  const langBtns = new Map<string, HTMLButtonElement>();

  const updateLangCard = () => {
    const curSetting = getLanguageSetting();
    const sysLocale = detectSystemLocale();
    const en = isEn();
    const sysName = sysLocale === 'zh' ? (en ? 'Chinese' : '简体中文') : 'English';
    langSubEl.textContent =
      curSetting === 'auto'
        ? en
          ? `Auto · System: ${sysName}`
          : `自动 · 系统识别：${sysName}`
        : en
          ? `System: ${sysName}`
          : `系统识别：${sysName}`;
    for (const opt of SUPPORTED_LOCALES) {
      const btn = langBtns.get(opt.id);
      if (!btn) continue;
      btn.classList.toggle('active', curSetting === opt.id);
      if (opt.id === 'auto') {
        btn.textContent = en ? opt.enLabel : opt.zhLabel;
      }
    }
  };

  const langSeg = h(
    'div',
    { class: 'menu-lang-seg' },
    ...SUPPORTED_LOCALES.map((opt) => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'menu-lang-btn',
          'data-no-i18n': '1',
          onclick: () => {
            app.setLanguage(opt.id);
            updateLangCard();
            if (opt.id === 'auto') {
              toast(isEn() ? '🌐 Language: Follow System (English)' : '🌐 语言：跟随系统（简体中文）');
            } else if (opt.id === 'en') {
              toast('🌐 Language switched to English');
            } else {
              toast('🌐 语言已切换为简体中文');
            }
          },
        },
        opt.id === 'auto' ? (isEn() ? opt.enLabel : opt.zhLabel) : opt.nativeLabel,
      ) as HTMLButtonElement;
      langBtns.set(opt.id, btn);
      return btn;
    }),
  );
  updateLangCard();

  const langCard = h(
    'div',
    { class: 'menu-lang-card' },
    h(
      'div',
      { class: 'menu-lang-head' },
      h('span', { 'data-no-i18n': '1' }, '🌐 语言 / Language'),
      langSubEl,
    ),
    langSeg,
  );

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h(
      'div',
      { class: 'brand-banner' },
      h('img', { src: resolveAssetUrl('./icon.png'), alt: 'Blender Meow', class: 'brand-logo' }),
      h(
        'div',
        {},
        h('div', { style: 'font-weight:700;font-size:15px', 'data-no-i18n': '1' }, `Blender Meow · v${APP_VERSION}`),
        h('div', { class: 'hint' }, '32×16 菱形网格 · TheoTown 双比例尺 · 无缝导入 Pixel Meow'),
      ),
    ),
    langCard,
    h('div', { class: 'menu-sec' }, '快捷入口'),
    h(
      'div',
      { class: 'brand-menu-grid' },
      h(
        'button',
        {
          type: 'button',
          class: 'brand-menu-btn',
          onclick: () => {
            close();
            void openProjectHome(app, () => view.fit());
          },
        },
        '🏠 项目主页',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'brand-menu-btn',
          onclick: () => {
            close();
            openChangelogDialog('manual');
          },
        },
        '📜 更新日志',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'brand-menu-btn',
          onclick: () => {
            close();
            openSettingsDialog(app);
          },
        },
        '⚙️ 设置与主题',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'brand-menu-btn',
          onclick: () => {
            close();
            openShortcutsDialog();
          },
        },
        '⌨️ 键盘快捷键',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'brand-menu-btn full',
          onclick: () => {
            window.open(PIXEL_MEOW_ONLINE_URL, '_blank', 'noopener,noreferrer');
          },
        },
        '🎨 打开 Pixel Meow 在线版',
      ),
    ),
    buildAboutLicenseCard(),
  );

  const unsubLang = onLocaleChange(updateLangCard);
  close = openSheet('Blender Meow 菜单', body, {
    wide: true,
    onClose: () => unsubLang(),
    actions: [h('button', { class: 'btn primary', onclick: () => close() }, '完成')],
  });
}

const docTitleEl = h('span', { class: 'doc-title', 'data-no-i18n': '1' }, app.docName);
const plotPillEl = h('span', { class: 'canvas-size-pill' });
const brandBtn = h(
  'button',
  {
    class: 'brand-btn',
    title: 'Blender Meow 菜单、语言与关于',
    onclick: () => openBrandMenu(),
  },
  h('img', { src: resolveAssetUrl('./icon.png'), alt: 'Blender Meow', class: 'brand-icon' }),
  h('div', { class: 'title-box' }, h('div', { class: 'title-row' }, docTitleEl, plotPillEl), cursorInfo),
);

const undoBtn = h('button', {
  class: 'icon-btn',
  title: '撤销 (Ctrl+Z)',
  onclick: () => {
    const l = app.undo();
    toast(l ? `撤销: ${l}` : '没有可撤销的操作');
  },
}, icon(Undo2, 18));

const redoBtn = h('button', {
  class: 'icon-btn',
  title: '重做 (Ctrl+Y)',
  onclick: () => {
    const l = app.redo();
    toast(l ? `重做: ${l}` : '没有可重做的操作');
  },
}, icon(Redo2, 18));

const rotBadge = h('span', { class: 'rot-badge', title: '当前等距轴测观察方向' }, '0°');
const rotLeftBtn = h('button', {
  class: 'icon-btn',
  title: '逆时针旋转 90° 查看另一视角 (Q)',
  onclick: () => {
    app.rotateView(-1);
    toast(`⟲ 已切换至 ${app.doc.viewRotation * 90}° 等距视角`);
  },
}, icon(RotateCcw, 18));
const rotRightBtn = h('button', {
  class: 'icon-btn',
  title: '顺时针旋转 90° 查看另一视角 (E)',
  onclick: () => {
    app.rotateView(1);
    toast(`⟳ 已切换至 ${app.doc.viewRotation * 90}° 等距视角`);
  },
}, icon(RotateCw, 18));

const gridToggleBtn = h('button', {
  class: 'icon-btn',
  title: '显隐 32×16 菱形网格',
  onclick: () => {
    app.settings.showIsoGrid = !app.settings.showIsoGrid;
    app.saveSettings();
  },
}, icon(Grid3x3, 18));

const snapToggleBtn = h('button', {
  class: 'icon-btn',
  title: '开启/关闭 32×16 网格吸附',
  onclick: () => {
    app.settings.snapEnabled = !app.settings.snapEnabled;
    app.saveSettings();
    toast(app.settings.snapEnabled ? `🧲 已开启网格对齐 (${app.settings.snapStep} 格)` : '已关闭网格吸附');
  },
}, icon(Magnet, 18));

const snapStepSel = select<'1' | '0.5' | '0.25' | '0.125'>(
  [
    { id: '1', label: '1格 (32×16)' },
    { id: '0.5', label: '1/2格 (16×8)' },
    { id: '0.25', label: '1/4格 (8×4)' },
    { id: '0.125', label: '1/8格 (4×2)' },
  ],
  String(app.settings.snapStep) as '1' | '0.5' | '0.25' | '0.125',
  (v) => {
    app.settings.snapStep = Number(v) as GridSnapStep;
    app.settings.snapEnabled = true;
    app.saveSettings();
  },
);

const sortDepthBtn = h('button', {
  class: 'icon-btn',
  title: '按当前视角前后遮挡深度自动排列图层',
  onclick: () => {
    app.sortByDepth();
    toast('✨ 已按当前视角深度排层');
  },
}, icon(ArrowDownWideNarrow, 18));

const fitBtn = h('button', {
  class: 'icon-btn',
  title: '适应画布视野',
  onclick: () => view.fit(),
}, icon(Maximize, 18));

const texLibBtn = h('button', {
  class: 'btn small',
  title: '纹理素材库',
  onclick: () => {
    if (app.settings.dockedTextureLibrary) {
      texLibDock.setOpen(!texLibDock.isOpen());
      syncTexLibBtn();
      view.resize();
      setTimeout(() => view.resize(), 180);
    } else {
      if (texLibDock.isOpen()) {
        texLibDock.setOpen(false);
      }
      syncTexLibBtn();
      openTextureLibraryModal(app);
    }
  },
}, icon(Images, 16), ' 纹理库') as HTMLButtonElement;

function syncTexLibBtn() {
  const docked = app.settings.dockedTextureLibrary;
  const open = docked && texLibDock.isOpen();
  texLibBtn.classList.toggle('primary', open);
  texLibBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  texLibBtn.title = tr(
    docked
      ? '打开/关闭侧边停靠纹理素材库（可与材质与纹理、图层管理并排显示）'
      : '打开全屏纹理素材库（可在设置中切换为侧边停靠模式）',
  );
}

const exportBtn = h('button', {
  class: 'btn small',
  title: '保存项目 (.bmeow) 或导出 PSD / PNG',
  onclick: () => openExportDialog(app),
}, icon(Save, 16), ' 导出');

const sendPixelMeowBtn = h('button', {
  class: 'btn small primary handoff-btn',
  title: '直接将建模结果导入 Pixel Meow 画布',
  onclick: () => openSendToPixelMeowDialog(app),
}, icon(Send, 15), ' 导入 Pixel Meow');

const shortcutsBtn = h('button', {
  class: 'icon-btn',
  title: '键盘快捷键与预设方案',
  onclick: () => openShortcutsDialog(),
}, icon(Keyboard, 18));

const settingsBtn = h('button', {
  class: 'icon-btn',
  title: '设置与主题',
  onclick: () => openSettingsDialog(app),
}, icon(Settings, 18));

const drawerToggleBtn = h('button', {
  class: 'icon-btn drawer-toggle-btn',
  title: '展开/收起右侧属性与图层面板',
  onclick: () => {
    document.body.classList.toggle('drawer-open');
    setTimeout(() => view.resize(), 180);
  },
}, icon(Layers, 18));

const topbar = h(
  'header',
  { class: 'topbar' },
  brandBtn,
  h(
    'div',
    { class: 'topbar-actions' },
    h('button', { class: 'icon-btn', title: '项目管理', onclick: () => void openProjectHome(app, () => view.fit()) }, icon(FolderOpen, 18)),
    undoBtn,
    redoBtn,
    h('span', { class: 'top-sep' }),
    rotLeftBtn,
    rotBadge,
    rotRightBtn,
    h('span', { class: 'top-sep' }),
    gridToggleBtn,
    snapToggleBtn,
    snapStepSel,
    sortDepthBtn,
    fitBtn,
    texLibBtn,
    exportBtn,
    sendPixelMeowBtn,
    shortcutsBtn,
    settingsBtn,
  ),
  drawerToggleBtn,
);

// ---------------- Left Sidebar (Tools + Shape Presets) ----------------
const toolBtnMap = new Map<ToolId, HTMLButtonElement>();
const shapeBtnMap = new Map<ShapeKind, HTMLButtonElement>();

const toolDefs: { id: ToolId; ic: IconNode; short?: string; label: string }[] = [
  { id: 'select', ic: MousePointer, label: '选择 / 3D调整' },
  { id: 'create', ic: PenSquare, label: '拖拽放置图形' },
  { id: 'ruler', ic: Ruler, label: 'TheoTown 量尺' },
  { id: 'frame', ic: Compass, short: '场地框', label: '场地边框 显隐与位置尺寸（双击精确输入）' },
  { id: 'hand', ic: Hand, label: '抓手平移' },
];

const shapeDefs: { id: ShapeKind; ic: IconNode; short: string }[] = [
  { id: 'box', ic: Box, short: '立方体' },
  { id: 'right_tri_prism', ic: Triangle, short: '三棱柱' },
  { id: 'arch', ic: Rainbow, short: '拱形' },
  { id: 'cylinder', ic: Cylinder, short: '圆柱体' },
  { id: 'loft', ic: Spline, short: '曲面柱' },
  { id: 'prism', ic: Hexagon, short: '多棱柱' },
  { id: 'wedge', ic: TriangleRight, short: '坡屋顶' },
  { id: 'pyramid', ic: Pyramid, short: '四棱锥' },
  { id: 'cone', ic: Cone, short: '圆锥体' },
  { id: 'dome', ic: CircleDot, short: '穹顶球' },
  { id: 'theotown_base', ic: Grid3x3, short: '绿底座' },
];

const sidebar = h('nav', { class: 'side-toolbar' });
for (const td of toolDefs) {
  const b = h(
    'button',
    {
      class: 'tool-btn',
      title: td.label,
      onclick: () => {
        app.setTool(td.id);
        toast(td.label);
      },
      ondblclick: td.id === 'frame'
        ? () => {
            app.setTool('frame');
            openPlotFrameDialog(app);
          }
        : undefined,
    },
    icon(td.ic, 19),
    h('span', { class: 'tool-lbl' }, td.short ?? td.label.split(' ')[0]),
  ) as HTMLButtonElement;
  toolBtnMap.set(td.id, b);
  sidebar.append(b);
}

sidebar.append(h('div', { class: 'side-sep' }));

for (const sd of shapeDefs) {
  const b = h(
    'button',
    {
      class: 'tool-btn preset',
      title: `拖拽生成：${SHAPE_LABELS[sd.id]}（双击填参数生成）`,
      onclick: () => {
        app.setActiveShapePreset(sd.id);
        app.setTool('create');
        toast(`已选预设「${SHAPE_LABELS[sd.id]}」，在画布上拖拽放置或点右侧填参数`);
      },
      ondblclick: () => {
        app.setActiveShapePreset(sd.id);
        openParamCreateDialog(app);
      },
    },
    icon(sd.ic, 18),
    h('span', { class: 'tool-lbl' }, sd.short),
  ) as HTMLButtonElement;
  shapeBtnMap.set(sd.id, b);
  sidebar.append(b);
}

sidebar.append(
  h(
    'button',
    {
      class: 'tool-btn param-btn',
      title: '填入具体数值参数直接生成图形',
      onclick: () => openParamCreateDialog(app),
    },
    icon(SquarePlus, 18),
    h('span', { class: 'tool-lbl' }, '填参数'),
  ),
);

// ---------------- Contextual Tool Strip ----------------
function refreshToolStrip() {
  toolOptionStrip.innerHTML = '';

  if (app.tool === 'select') {
    const planeBtn = h('button', {
      class: `btn small${app.settings.selectDragMode === 'plane' ? ' primary' : ''}`,
      onclick: () => {
        app.settings.selectDragMode = 'plane';
        app.saveSettings();
      },
    }, '↔ 水平拖拽 (U/V)');
    const zBtn = h('button', {
      class: `btn small${app.settings.selectDragMode === 'vertical_z' ? ' primary' : ''}`,
      onclick: () => {
        app.settings.selectDragMode = 'vertical_z';
        app.saveSettings();
      },
    }, '↕ 垂直升降 (Z)');

    toolOptionStrip.append(
      planeBtn,
      zBtn,
      toggle('自动叠放顶面', app.settings.autoStackSnap, (v) => {
        app.settings.autoStackSnap = v;
        app.saveSettings();
      }),
    );

    const active = app.doc.layer;
    if (active && active.kind === 'shape' && active.shape && active.shape.shapeType !== 'theotown_base') {
      toolOptionStrip.append(
        h('button', {
          class: 'btn small',
          onclick: () => {
            const s = active.shape!;
            const wf = app.doc.getShapeWorldFootprint(s);
            const tz = app.doc.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0, active.id);
            app.pushHistory('叠放到下方顶面');
            s.zPx = tz;
            app.doc.rerenderShapeLayer(active);
            if (app.settings.autoSortOnEdit) app.doc.sortLayersByIsoDepth();
            app.emit('doc');
            app.emit('layers');
            toast(`已叠放至 Z = ${tz}px`);
          },
        }, '🧱 叠放到下方顶面'),
      );
      const activeId = active.id;
      const makeModalMutateOpts = () => ({
        targetLayerId: activeId,
        beforeMutate: (label: string) => app.pushHistory(label),
        afterMutate: (options?: { needsResort?: boolean; live?: boolean }) => {
          if (options?.needsResort && app.settings.autoSortOnEdit) {
            app.doc.sortLayersByIsoDepth();
          }
          const liveLayer = app.doc.layers.find((l) => l.id === activeId);
          if (liveLayer) app.doc.rerenderShapeLayer(liveLayer);
          if (options?.live) app.emit('doc_live');
          else {
            app.emit('doc');
            app.emit('layers');
          }
        },
      });
      if (active.shape.shapeType === 'loft') {
        toolOptionStrip.append(
          h('button', {
            class: 'btn small accent',
            onclick: () => {
              const liveShape = app.doc.layers.find((l) => l.id === activeId)?.shape ?? active.shape!;
              openLoftCurveModal(liveShape, app, makeModalMutateOpts());
            },
          }, '✒️ 精细编辑控制面曲线'),
        );
      }
      if (active.shape.shapeType === 'arch') {
        toolOptionStrip.append(
          h('button', {
            class: 'btn small accent',
            onclick: () => {
              const liveShape = app.doc.layers.find((l) => l.id === activeId)?.shape ?? active.shape!;
              openArchCurveModal(liveShape, app, makeModalMutateOpts());
            },
          }, '🌈 精细编辑拱形曲线'),
        );
      }
      if (isColumnSectionShape(active.shape)) {
        toolOptionStrip.append(
          h('button', {
            class: 'btn small accent',
            onclick: () => {
              const liveLayer = app.doc.layers.find((l) => l.id === activeId);
              const colShape = liveLayer?.shape ?? active.shape!;
              if (!hasActiveColumnSections(colShape)) {
                app.pushHistory('启用柱体控制面');
                ensureColumnSections(colShape);
                if (liveLayer) app.doc.rerenderShapeLayer(liveLayer);
                app.emit('doc');
                app.emit('layers');
              }
              openColumnSectionModal(colShape, app, makeModalMutateOpts());
            },
          }, '📐 精细编辑柱体控制面'),
        );
      }
    }
    return;
  }

  if (app.tool === 'create') {
    toolOptionStrip.append(
      h('span', { class: 'strip-pill' }, `当前预设: ${SHAPE_LABELS[app.createPreset.shapeType]}`),
      toggle('自动叠放顶面', app.settings.autoStackSnap, (v) => {
        app.settings.autoStackSnap = v;
        app.saveSettings();
      }),
      h('button', {
        class: 'btn small primary',
        onclick: () => openParamCreateDialog(app),
      }, '+ 填入指定参数生成'),
    );
    return;
  }

  if (app.tool === 'ruler') {
    const ruler = tools.ruler as RulerTool;
    const modes: { id: RulerMode; label: string }[] = [
      { id: 'vertical', label: '↕ 竖直 (3px=1.6m)' },
      { id: 'horizontal', label: '◇ 平面 (1格=9.6m)' },
      { id: 'mixed', label: '📐 混合勾股 (3点)' },
    ];
    for (const m of modes) {
      toolOptionStrip.append(
        h('button', {
          class: `btn small${app.settings.rulerMode === m.id ? ' primary' : ''}`,
          onclick: () => {
            app.settings.rulerMode = m.id;
            ruler.resetCurrent();
            app.saveSettings();
          },
        }, m.label),
      );
    }
    if (app.settings.rulerMode === 'mixed') {
      toolOptionStrip.append(
        h('button', {
          class: 'btn small',
          title: '切换三点取点顺序',
          onclick: () => {
            app.settings.rulerMixedOrder = app.settings.rulerMixedOrder === 'flat_then_vert' ? 'vert_then_flat' : 'flat_then_vert';
            ruler.resetCurrent();
            app.saveSettings();
          },
        }, app.settings.rulerMixedOrder === 'flat_then_vert' ? '顺序: 先平后竖' : '顺序: 先竖后平'),
      );
    }
    toolOptionStrip.append(
      toggle('网格磁吸', app.settings.rulerSnapGrid, (v) => {
        app.settings.rulerSnapGrid = v;
        app.saveSettings();
      }),
    );
    if (app.settings.rulerMode === 'horizontal') {
      toolOptionStrip.append(
        toggle('轴向锁定', app.settings.rulerLockAxis, (v) => {
          app.settings.rulerLockAxis = v;
          app.saveSettings();
        }),
      );
    }
    toolOptionStrip.append(
      h('span', { class: 'strip-pill ruler-readout' }, ruler.getActiveSummary()),
      h('button', { class: 'btn small', onclick: () => ruler.pinCurrent() }, '📌 固定'),
      h('button', { class: 'btn small', onclick: () => ruler.resetCurrent() }, '↺ 重测'),
      h('button', { class: 'btn small danger', onclick: () => ruler.clearPinned() }, '🗑️ 清空'),
    );
    return;
  }

  if (app.tool === 'frame') {
    const pf = app.doc.plotFrame;
    const fmtCell = (n: number) => Math.round(n * 100) / 100;
    toolOptionStrip.append(
      toggle('显示场地边框', pf.visible, (v) => {
        app.pushHistory(v ? '显示场地边框' : '隐藏场地边框');
        app.doc.plotFrame.visible = v;
        app.emit('doc');
      }),
      h('span', { class: 'strip-pill' }, `起点 (${fmtCell(pf.u)}, ${fmtCell(pf.v)}) · ${fmtCell(pf.sizeU)}×${fmtCell(pf.sizeV)}格`),
      h('button', {
        class: 'btn small primary',
        onclick: () => openPlotFrameDialog(app),
      }, '⚙ 精确参数'),
      h('button', {
        class: 'btn small',
        onclick: () => {
          const cur = app.doc.plotFrame;
          if (
            cur.visible
            && Math.abs(cur.u) < 1e-6
            && Math.abs(cur.v) < 1e-6
            && Math.abs(cur.sizeU - app.doc.plotU) < 1e-6
            && Math.abs(cur.sizeV - app.doc.plotV) < 1e-6
          ) {
            return;
          }
          app.pushHistory('复位场地边框');
          app.doc.plotFrame = {
            visible: true,
            u: 0,
            v: 0,
            sizeU: app.doc.plotU,
            sizeV: app.doc.plotV,
          };
          app.emit('doc');
          toast(`场地边框已复位为 ${app.doc.plotU}×${app.doc.plotV} 格`);
        },
      }, '↺ 复位默认'),
    );
    return;
  }

  toolOptionStrip.append(h('span', { class: 'hint' }, '抓手模式：单指或鼠标左键拖拽平移画布视野，双指/滚轮缩放'));
}

// ---------------- Mount Stage & View ----------------
const workspace = h('div', { class: 'workspace' }, sidebar, h('div', { class: 'stage-wrap' }, toolOptionStrip, stage), texLibDock.el, rightDrawer);
root.append(topbar, workspace);

view = new View(stage, app);
view.getTool = () => tools[app.tool];
app.cancelActiveTool = () => {
  tools[app.tool]?.cancel?.();
};
view.onPinnedOverlay = (ctx, toScreen) => {
  (tools.ruler as RulerTool).drawPinnedOverlay(ctx, toScreen);
};
view.onTwoFingerTap = () => {
  const l = app.undo();
  if (l) toast(`双指撤销: ${l}`);
};
view.onThreeFingerTap = () => {
  const l = app.redo();
  if (l) toast(`三指重做: ${l}`);
};
view.onCursor = (p) => {
  if (!p) {
    cursorInfo.textContent = tr(`视角 ${app.doc.viewRotation * 90}° · 32×16=9.6m · 竖3px=1.6m`);
    return;
  }
  cursorInfo.textContent = tr(`像素 (${p.x}, ${p.y}) · 网格 (U:${p.u.toFixed(2)}, V:${p.v.toFixed(2)}) · 视角 ${app.doc.viewRotation * 90}°`);
};

function syncAllUi() {
  docTitleEl.textContent = app.docName;
  plotPillEl.textContent = tr(`${app.doc.width}×${app.doc.height} · ${app.doc.plotU}×${app.doc.plotV}格`);
  rotBadge.textContent = `${app.doc.viewRotation * 90}°`;
  undoBtn.disabled = !app.history.canUndo;
  redoBtn.disabled = !app.history.canRedo;
  gridToggleBtn.classList.toggle('on', app.settings.showIsoGrid);
  snapToggleBtn.classList.toggle('on', app.settings.snapEnabled);
  snapStepSel.value = String(app.settings.snapStep);

  for (const [id, btn] of toolBtnMap) {
    btn.classList.toggle('active', app.tool === id);
  }
  for (const [id, btn] of shapeBtnMap) {
    btn.classList.toggle('active', app.tool === 'create' && app.createPreset.shapeType === id);
  }

  layerPanel.refresh();
  inspectorPanel.refresh();
  materialPanel.refresh();
  texLibDock.refresh();
  syncTexLibBtn();
  refreshToolStrip();
  view.requestRender();
}

app.on((what) => {
  if (what === 'history') {
    undoBtn.disabled = !app.history.canUndo;
    redoBtn.disabled = !app.history.canRedo;
    return;
  }
  if (what === 'doc_live') {
    undoBtn.disabled = !app.history.canUndo;
    redoBtn.disabled = !app.history.canRedo;
    layerPanel.refreshThumbsOnly();
    view.requestRender();
    return;
  }
  if (what === 'settings') {
    if (!app.settings.dockedTextureLibrary && texLibDock.isOpen()) {
      texLibDock.setOpen(false);
      view.resize();
    }
    syncTexLibBtn();
  }
  syncAllUi();
});

// Dynamic shortcut hints & Escape / modular shortcut system
function syncShortcutTooltips() {
  undoBtn.title = `${tr('撤销')}${formatActionHint('history.undo')}`;
  redoBtn.title = `${tr('重做')}${formatActionHint('history.redo')}`;
  rotLeftBtn.title = `${tr('逆时针旋转 90° 查看另一视角')}${formatActionHint('view.rotateLeft')}`;
  rotRightBtn.title = `${tr('顺时针旋转 90° 查看另一视角')}${formatActionHint('view.rotateRight')}`;
  gridToggleBtn.title = `${tr('显隐 32×16 菱形网格')}${formatActionHint('view.toggleGrid')}`;
  snapToggleBtn.title = `${tr('开启/关闭 32×16 网格吸附')}${formatActionHint('view.toggleSnap')}`;
  sortDepthBtn.title = `${tr('按当前视角前后遮挡深度自动排列图层')}${formatActionHint('view.sortDepth')}`;
  fitBtn.title = `${tr('适应画布视野')}${formatActionHint('view.fit')}`;
  exportBtn.title = `${tr('保存项目 (.bmeow) 或导出 PSD / PNG')}${formatActionHint('file.export')}`;
  shortcutsBtn.title = `${tr('键盘快捷键与预设方案')}${formatActionHint('ui.shortcuts')}`;
  const toolActionIds: Record<ToolId, string> = {
    select: 'tool.select',
    create: 'tool.create',
    ruler: 'tool.ruler',
    frame: 'tool.frame',
    hand: 'tool.hand',
  };
  for (const td of toolDefs) {
    const btn = toolBtnMap.get(td.id);
    if (btn) btn.title = `${tr(td.label)}${formatActionHint(toolActionIds[td.id])}`;
  }
}
syncShortcutTooltips();
shortcutManager.onChange(syncShortcutTooltips);
onLocaleChange(() => {
  retranslateDom(document.body);
  syncShortcutTooltips();
  syncAllUi();
  view.onCursor?.(null);
});

window.addEventListener('keydown', (e) => {
  if (shortcutManager.isRecording || isEditableElement(e.target)) return;
  if (e.key === 'Escape') {
    if (openSheets.length > 0) {
      openSheets[openSheets.length - 1]();
      return;
    }
    const curTool = tools[app.tool];
    if (
      (app.tool === 'select' || app.tool === 'create' || app.tool === 'frame') &&
      (curTool as SelectGizmoTool | CreateShapeTool | PlotFrameTool).isDragging
    ) {
      curTool.cancel?.();
      return;
    }
    const rulerTool = tools.ruler as RulerTool;
    if (app.tool === 'ruler' && rulerTool.hasActiveMeasurement) {
      rulerTool.resetCurrent();
      view.requestRender();
    }
  }
});

shortcutManager.onHold('view.panHold', (active) => {
  view.setPanHold(active);
});

shortcutManager.registerContinuousHold(
  ['view.panUp', 'view.panDown', 'view.panLeft', 'view.panRight'],
  (held, dt, shiftHeld) => {
    const speed = (shiftHeld ? 920 : 440) * dt;
    let dx = 0;
    let dy = 0;
    if (held.has('view.panLeft')) dx += speed;
    if (held.has('view.panRight')) dx -= speed;
    if (held.has('view.panUp')) dy += speed;
    if (held.has('view.panDown')) dy -= speed;
    if (dx !== 0 || dy !== 0) view.panByScreen(dx, dy);
  },
);

shortcutManager.onTrigger('view.zoomIn', () => view.zoomAt(1.2));
shortcutManager.onTrigger('view.zoomOut', () => view.zoomAt(1 / 1.2));
shortcutManager.onTrigger('view.fit', () => view.fit());
shortcutManager.onTrigger('view.rotateLeft', () => {
  app.rotateView(-1);
  toast(`⟲ 已切换至 ${app.doc.viewRotation * 90}° 等距视角`);
});
shortcutManager.onTrigger('view.rotateRight', () => {
  app.rotateView(1);
  toast(`⟳ 已切换至 ${app.doc.viewRotation * 90}° 等距视角`);
});

shortcutManager.onTrigger('history.undo', () => {
  const l = app.undo();
  toast(l ? `撤销: ${l}` : '没有可撤销的操作');
});
shortcutManager.onTrigger('history.redo', () => {
  const l = app.redo();
  toast(l ? `重做: ${l}` : '没有可重做的操作');
});

shortcutManager.onTrigger('tool.select', () => app.setTool('select'));
shortcutManager.onTrigger('tool.create', () => app.setTool('create'));
shortcutManager.onTrigger('tool.ruler', () => app.setTool('ruler'));
shortcutManager.onTrigger('tool.frame', () => app.setTool('frame'));
shortcutManager.onTrigger('tool.hand', () => app.setTool('hand'));

shortcutManager.onTrigger('edit.duplicateLayer', () => {
  if (!app.doc.layer) return false;
  app.duplicateActiveLayer();
  toast('已复制当前图层');
});
shortcutManager.onTrigger('edit.deleteLayer', () => {
  const cur = app.doc.layer;
  if (!cur || cur.locked) return false;
  app.deleteActiveLayer();
  toast('已删除当前图层（撤回可恢复）');
});
shortcutManager.onTrigger('view.toggleGrid', () => {
  app.settings.showIsoGrid = !app.settings.showIsoGrid;
  app.saveSettings();
});
shortcutManager.onTrigger('view.toggleSnap', () => {
  app.settings.snapEnabled = !app.settings.snapEnabled;
  app.saveSettings();
  toast(app.settings.snapEnabled ? `🧲 已开启网格对齐 (${app.settings.snapStep} 格)` : '已关闭网格吸附');
});
shortcutManager.onTrigger('view.sortDepth', () => {
  app.sortByDepth();
  toast('✨ 已按当前视角深度排层');
});
shortcutManager.onTrigger('file.export', () => openExportDialog(app));
shortcutManager.onTrigger('ui.shortcuts', () => openShortcutsDialog());

// Main 3D stage shape fine-tuning nudges (XY isometric plane + Z elevation)
{
  let shapeNudgePushed = false;
  const finishShapeNudge = (didMutate: boolean) => {
    const hadPush = shapeNudgePushed;
    shapeNudgePushed = false;
    if (didMutate || hadPush) {
      if (app.settings.autoSortOnEdit) app.doc.sortLayersByIsoDepth();
      app.emit('doc');
      app.emit('layers');
    }
  };
  const stepShapePlane = (duViewSign: number, dvViewSign: number, shiftBoost: boolean): boolean => {
    const layer = app.doc.layer;
    if (!layer || !layer.visible || layer.locked || layer.kind !== 'shape' || !layer.shape) {
      return false;
    }
    const d = app.doc;
    const s = layer.shape;
    const isBase = s.shapeType === 'theotown_base';
    const step = isBase ? 1 : (shiftBoost ? (app.settings.snapEnabled ? app.settings.snapStep : 0.5) : 0.125);
    const vb = worldBoxToView(s.u, s.v, s.sizeU, s.sizeV, s.ori, d.plotU, d.plotV, d.viewRotation);
    const nextVu = Math.round((vb.u + duViewSign * step) * 10000) / 10000;
    const nextVv = Math.round((vb.v + dvViewSign * step) * 10000) / 10000;
    if (!shapeNudgePushed) {
      app.pushHistory(`微调 ${layer.name} 位置`);
      shapeNudgePushed = true;
    }
    const wb = viewBoxToWorld(nextVu, nextVv, vb.sizeU, vb.sizeV, vb.ori, d.plotU, d.plotV, d.viewRotation);
    s.u = wb.u;
    s.v = wb.v;
    if (!isBase && app.settings.autoStackSnap) {
      const wf = d.getShapeWorldFootprint(s);
      s.zPx = d.getTopElevationAt(wf.u0, wf.v0, wf.u1 - wf.u0, wf.v1 - wf.v0, layer.id);
    }
    d.rerenderShapeLayer(layer);
    app.emit('doc_live');
    return true;
  };
  const stepShapeZ = (dzSign: -1 | 1, shiftBoost: boolean): boolean => {
    const layer = app.doc.layer;
    if (!layer || !layer.visible || layer.locked || layer.kind !== 'shape' || !layer.shape) {
      return false;
    }
    const s = layer.shape;
    if (s.shapeType === 'theotown_base') return false;
    const nextZ = clamp(Math.round(s.zPx + dzSign * (shiftBoost ? 4 : 1)), 0, 1024);
    if (nextZ === s.zPx) return false;
    if (!shapeNudgePushed) {
      app.pushHistory(`微调 ${layer.name} 高度位置 (Z)`);
      shapeNudgePushed = true;
    }
    s.zPx = nextZ;
    app.doc.rerenderShapeLayer(layer);
    app.emit('doc_live');
    return true;
  };

  shortcutManager.onStepRepeat('nudge.up', {
    onStep: (ctx) => stepShapePlane(-1, -1, ctx.shiftBoost),
    onEnd: finishShapeNudge,
  });
  shortcutManager.onStepRepeat('nudge.down', {
    onStep: (ctx) => stepShapePlane(1, 1, ctx.shiftBoost),
    onEnd: finishShapeNudge,
  });
  shortcutManager.onStepRepeat('nudge.left', {
    onStep: (ctx) => stepShapePlane(-1, 1, ctx.shiftBoost),
    onEnd: finishShapeNudge,
  });
  shortcutManager.onStepRepeat('nudge.right', {
    onStep: (ctx) => stepShapePlane(1, -1, ctx.shiftBoost),
    onEnd: finishShapeNudge,
  });
  shortcutManager.onStepRepeat('nudge.zUp', {
    onStep: (ctx) => stepShapeZ(1, ctx.shiftBoost),
    onEnd: finishShapeNudge,
  });
  shortcutManager.onStepRepeat('nudge.zDown', {
    onStep: (ctx) => stepShapeZ(-1, ctx.shiftBoost),
    onEnd: finishShapeNudge,
  });
}

shortcutManager.attach(window);

window.addEventListener('pagehide', () => {
  void app.flushAutosave();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void app.flushAutosave();
});

if (isNative()) {
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void app.flushAutosave();
  });
  void CapApp.addListener('pause', () => {
    void app.flushAutosave();
  });
  void CapApp.addListener('backButton', () => {
    if (openSheets.length > 0) {
      openSheets[openSheets.length - 1]();
      return;
    }
    if (document.body.classList.contains('drawer-open')) {
      document.body.classList.remove('drawer-open');
      setTimeout(() => view.resize(), 180);
      return;
    }
    if (texLibDock.isOpen()) {
      texLibDock.setOpen(false);
      syncTexLibBtn();
      view.resize();
      return;
    }
    const curTool = tools[app.tool];
    if ((app.tool === 'select' || app.tool === 'create' || app.tool === 'frame') && (curTool as SelectGizmoTool | CreateShapeTool | PlotFrameTool).isDragging) {
      curTool.cancel?.();
      return;
    }
    const rulerTool = tools.ruler as RulerTool;
    if (app.tool === 'ruler' && rulerTool.hasActiveMeasurement) {
      rulerTool.resetCurrent();
      view.requestRender();
      return;
    }
    void app.flushAutosave().finally(() => {
      void CapApp.minimizeApp();
    });
  });
}

// Boot
syncAllUi();
if (shouldEnableMcpBridge()) {
  const statusMount = h('span', { style: 'display:inline-flex;align-items:center' });
  const titleRow = brandBtn.querySelector('.title-row');
  if (titleRow) titleRow.appendChild(statusMount);
  initMcpBridge(
    {
      app,
      refreshAll: syncAllUi,
      fitView: () => view.fit(),
      requestRender: () => view.requestRender(),
    },
    statusMount,
  );
}
setTimeout(() => view.fit(), 30);
void loadPersistedTextureLibrary()
  .catch(() => 0)
  .then(() => app.loadProjectIndex())
  .then(() => {
    app.doc.rerenderAllShapes();
    syncAllUi();
    view.fit();
  })
  .catch(() => {
    /* keep starter document if storage fails */
  })
  .finally(() => {
    void checkVersionAndShowChangelog();
  });
