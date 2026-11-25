// Blender Meow shortcut registry, built-in presets (Standard / Arrows-Pan / Tablet-Left), singleton & dialog helper
import { h, openSheet, openSheets, toast } from '../ui/dom';
import { createShortcutEditorUI } from './shortcutEditorUI';
import { ShortcutManager } from './shortcutManager';
import type { ShortcutActionDef, ShortcutCategoryDef, ShortcutPreset } from './types';

export const BLENDER_SHORTCUT_CATEGORIES: ShortcutCategoryDef[] = [
  { id: 'canvas', label: '画布移动、旋转与视野', icon: '🖐️' },
  { id: 'history', label: '撤回与恢复', icon: '↩️' },
  { id: 'nudge', label: '微调操作（3D 图形 / 曲线节点 / 控制边）', icon: '🎯' },
  { id: 'tools', label: '工具切换与快捷指令', icon: '🛠️' },
];

export const BLENDER_SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  // ---- Canvas Navigation ----
  {
    id: 'view.panHold',
    category: 'canvas',
    label: '按住抓手拖拽平移画布',
    description: '按住此键配合鼠标左键拖拽即可平移视野',
    kind: 'hold',
    scope: 'workspace',
    defaultBindings: [{ code: 'Space' }],
  },
  {
    id: 'view.panUp',
    category: 'canvas',
    label: '向上移动画布视野',
    description: '按住平滑移动，配合 Shift 加速移动',
    kind: 'hold',
    scope: 'workspace',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'KeyW' }],
  },
  {
    id: 'view.panDown',
    category: 'canvas',
    label: '向下移动画布视野',
    description: '按住平滑移动，配合 Shift 加速移动',
    kind: 'hold',
    scope: 'workspace',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'KeyS' }],
  },
  {
    id: 'view.panLeft',
    category: 'canvas',
    label: '向左移动画布视野',
    description: '按住平滑移动，配合 Shift 加速移动',
    kind: 'hold',
    scope: 'workspace',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'KeyA' }],
  },
  {
    id: 'view.panRight',
    category: 'canvas',
    label: '向右移动画布视野',
    description: '按住平滑移动，配合 Shift 加速移动',
    kind: 'hold',
    scope: 'workspace',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'KeyD' }],
  },
  {
    id: 'view.zoomIn',
    category: 'canvas',
    label: '放大画布视野',
    kind: 'trigger',
    scope: 'workspace',
    allowRepeat: true,
    defaultBindings: [{ code: 'Equal' }, { code: 'NumpadAdd' }],
  },
  {
    id: 'view.zoomOut',
    category: 'canvas',
    label: '缩小画布视野',
    kind: 'trigger',
    scope: 'workspace',
    allowRepeat: true,
    defaultBindings: [{ code: 'Minus' }, { code: 'NumpadSubtract' }],
  },
  {
    id: 'view.fit',
    category: 'canvas',
    label: '适应屏幕居中画布',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'Digit0' }, { code: 'KeyF' }],
  },
  {
    id: 'view.rotateLeft',
    category: 'canvas',
    label: '逆时针旋转 90° 视角',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyQ' }],
  },
  {
    id: 'view.rotateRight',
    category: 'canvas',
    label: '顺时针旋转 90° 视角',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyE' }],
  },

  // ---- History Undo / Redo ----
  {
    id: 'history.undo',
    category: 'history',
    label: '撤回上一步',
    description: '同时适用于主画布与曲线/控制面大屏编辑弹窗',
    kind: 'trigger',
    scope: 'global',
    allowRepeat: true,
    defaultBindings: [{ code: 'KeyZ', mod: true }],
  },
  {
    id: 'history.redo',
    category: 'history',
    label: '恢复重做',
    description: '同时适用于主画布与曲线/控制面大屏编辑弹窗',
    kind: 'trigger',
    scope: 'global',
    allowRepeat: true,
    defaultBindings: [{ code: 'KeyY', mod: true }, { code: 'KeyZ', mod: true, shift: true }],
  },

  // ---- Fine-tune Nudges ----
  {
    id: 'nudge.up',
    category: 'nudge',
    label: '向上微调',
    description: '微调选中的曲线/拱形节点、柱体控制边或主画布 3D 图形（配合 Shift 大步距）',
    kind: 'step_repeat',
    scope: 'global',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'ArrowUp' }],
  },
  {
    id: 'nudge.down',
    category: 'nudge',
    label: '向下微调',
    description: '微调选中的曲线/拱形节点、柱体控制边或主画布 3D 图形（配合 Shift 大步距）',
    kind: 'step_repeat',
    scope: 'global',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'ArrowDown' }],
  },
  {
    id: 'nudge.left',
    category: 'nudge',
    label: '向左微调',
    description: '微调选中的曲线/拱形节点、柱体控制边或主画布 3D 图形（配合 Shift 大步距）',
    kind: 'step_repeat',
    scope: 'global',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'ArrowLeft' }],
  },
  {
    id: 'nudge.right',
    category: 'nudge',
    label: '向右微调',
    description: '微调选中的曲线/拱形节点、柱体控制边或主画布 3D 图形（配合 Shift 大步距）',
    kind: 'step_repeat',
    scope: 'global',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'ArrowRight' }],
  },
  {
    id: 'nudge.railPrev',
    category: 'nudge',
    label: '沿当前轨迹逆向微调 / 控制边内收',
    description: '在曲面柱与拱形编辑器开启「沿当前轨迹移动」时对应 ◀ 沿轨；柱体控制边下对应内收',
    kind: 'step_repeat',
    scope: 'editor',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'BracketLeft' }],
  },
  {
    id: 'nudge.railNext',
    category: 'nudge',
    label: '沿当前轨迹顺向微调 / 控制边外扩',
    description: '在曲面柱与拱形编辑器开启「沿当前轨迹移动」时对应 沿轨 ▶；柱体控制边下对应外扩',
    kind: 'step_repeat',
    scope: 'editor',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'BracketRight' }],
  },
  {
    id: 'nudge.zUp',
    category: 'nudge',
    label: '3D 图形垂直升高 (Z+)',
    description: '将主画布当前选中的图形向上抬高 1px（配合 Shift 抬高 4px）',
    kind: 'step_repeat',
    scope: 'workspace',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'PageUp' }, { code: 'ArrowUp', alt: true }],
  },
  {
    id: 'nudge.zDown',
    category: 'nudge',
    label: '3D 图形垂直降低 (Z-)',
    description: '将主画布当前选中的图形向下降低 1px（配合 Shift 降低 4px）',
    kind: 'step_repeat',
    scope: 'workspace',
    allowShiftBoost: true,
    defaultBindings: [{ code: 'PageDown' }, { code: 'ArrowDown', alt: true }],
  },

  // ---- Tools & Workspace Commands ----
  {
    id: 'tool.select',
    category: 'tools',
    label: '选择 / 3D 调整工具',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyV' }],
  },
  {
    id: 'tool.create',
    category: 'tools',
    label: '拖拽放置图形工具',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyC' }],
  },
  {
    id: 'tool.ruler',
    category: 'tools',
    label: 'TheoTown 量尺工具',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyR' }],
  },
  {
    id: 'tool.frame',
    category: 'tools',
    label: '场地边框工具',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyG' }],
  },
  {
    id: 'tool.hand',
    category: 'tools',
    label: '抓手平移工具',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyH' }],
  },
  {
    id: 'edit.duplicateLayer',
    category: 'tools',
    label: '复制当前选中图层',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyD', mod: true }],
  },
  {
    id: 'edit.deleteLayer',
    category: 'tools',
    label: '删除当前选中图层',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'Delete' }],
  },
  {
    id: 'view.toggleGrid',
    category: 'tools',
    label: '显隐 32×16 菱形网格',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyG', alt: true }],
  },
  {
    id: 'view.toggleGroundProjection',
    category: 'tools',
    label: '显隐离地选中图形的地面投影',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyP', alt: true }],
  },
  {
    id: 'view.toggleSnap',
    category: 'tools',
    label: '开启 / 关闭网格吸附',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyS', alt: true }],
  },
  {
    id: 'view.sortDepth',
    category: 'tools',
    label: '按当前视角深度自动排层',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyD', alt: true }],
  },
  {
    id: 'file.export',
    category: 'tools',
    label: '打开保存与导出面板 (.bmeow / PSD / PNG)',
    kind: 'trigger',
    scope: 'workspace',
    defaultBindings: [{ code: 'KeyS', mod: true }],
  },
  {
    id: 'ui.shortcuts',
    category: 'tools',
    label: '打开键盘快捷键与预设设置',
    kind: 'trigger',
    scope: 'global',
    defaultBindings: [{ code: 'KeyK' }, { code: 'Slash', shift: true }],
  },
];

export const BLENDER_SHORTCUT_PRESETS: ShortcutPreset[] = [
  {
    id: 'standard',
    name: '标准推荐预设（WASD 移画布 + 方向键微调）',
    description: 'WASD 丝滑平移画布、空格抓手、Ctrl+Z/Y 撤回恢复、方向键微调控制点或图形、Q/E 旋转视角。',
    bindings: {},
  },
  {
    id: 'arrows_canvas',
    name: '方向键移画布预设（方向键移画布 + IJKL / Ctrl+方向键微调）',
    description: '习惯用方向键直接移动画布视野时的布局；微调控制点/图形改为 Ctrl+方向键 或 I / J / K / L。',
    bindings: {
      'view.panUp': [{ code: 'ArrowUp' }, { code: 'KeyW' }],
      'view.panDown': [{ code: 'ArrowDown' }, { code: 'KeyS' }],
      'view.panLeft': [{ code: 'ArrowLeft' }, { code: 'KeyA' }],
      'view.panRight': [{ code: 'ArrowRight' }, { code: 'KeyD' }],
      'nudge.up': [{ code: 'ArrowUp', mod: true }, { code: 'KeyI' }],
      'nudge.down': [{ code: 'ArrowDown', mod: true }, { code: 'KeyK' }],
      'nudge.left': [{ code: 'ArrowLeft', mod: true }, { code: 'KeyJ' }],
      'nudge.right': [{ code: 'ArrowRight', mod: true }, { code: 'KeyL' }],
      'ui.shortcuts': [{ code: 'Slash', shift: true }, { code: 'F1' }],
    },
  },
  {
    id: 'tablet_left',
    name: '数位板 / 左手高频单手预设',
    description: '左手无需频繁按组合键：Z 直接撤回、X 直接重做、1/2/3 缩放适应、WASD 移画布，右手可用方向键微调。',
    bindings: {
      'history.undo': [{ code: 'KeyZ' }, { code: 'KeyZ', mod: true }],
      'history.redo': [{ code: 'KeyX' }, { code: 'KeyY', mod: true }],
      'view.zoomOut': [{ code: 'Digit1' }, { code: 'Minus' }],
      'view.zoomIn': [{ code: 'Digit2' }, { code: 'Equal' }],
      'view.fit': [{ code: 'Digit3' }, { code: 'Digit0' }],
    },
  },
];

export const shortcutManager = new ShortcutManager({
  appId: 'blendermeow',
  storageKey: 'blendermeow.shortcuts.v1',
  categories: BLENDER_SHORTCUT_CATEGORIES,
  actions: BLENDER_SHORTCUT_ACTIONS,
  presets: BLENDER_SHORTCUT_PRESETS,
  defaultPresetId: 'standard',
  canRunRoot: () => openSheets.length === 0,
});

export function formatActionHint(actionId: string): string {
  const lbl = shortcutManager.getAllLabels(actionId);
  return lbl ? ` (${lbl})` : '';
}

export function openShortcutsDialog(): void {
  const editor = createShortcutEditorUI(shortcutManager, {
    onToast: (msg) => toast(msg),
  });
  let close = () => {};
  close = openSheet('⌨️ 键盘快捷键与预设方案（支持自定义绑定与导出至 Pixel Meow）', editor.el, {
    wide: true,
    onClose: () => {
      editor.dispose();
    },
    actions: [
      hBtn('完成 ✓', 'btn primary', () => close()),
    ],
  });
}

function hBtn(label: string, className: string, onClick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: className, onclick: onClick }, label) as HTMLButtonElement;
}
