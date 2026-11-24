import type { App } from '../app';
import { tr } from '../core/i18n';
import { cloneShape, type ParametricShape } from '../core/isoRenderer';
import { formatActionHint, shortcutManager } from '../shortcuts/blenderShortcuts';
import type { ShortcutScope } from '../shortcuts/types';
import { h, openSheets, toast } from './dom';

export interface EditorNudgeAdapter {
  nudgeScreen: (dx: number, dy: number, shiftBoost: boolean, pushHistory: boolean) => boolean;
  nudgeAux?: (dir: -1 | 1, shiftBoost: boolean, pushHistory: boolean) => boolean;
  commitNudge: () => void;
}

export interface FineMutateOpts {
  beforeMutate: (label: string) => void;
  afterMutate: (opts?: { live?: boolean; needsResort?: boolean }) => void;
}

export interface ModalLiveBinding {
  getShape: () => ParametricShape | null;
  beforeMutate: (label: string) => void;
  afterMutate: (opts?: { live?: boolean; needsResort?: boolean }) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
  onSync: (cb: (live?: boolean) => void) => void;
  dispose: () => void;
}

export const SNAP_STEP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '仅锚点' },
  { value: 0.01, label: '0.01' },
  { value: 0.025, label: '0.025' },
  { value: 0.05, label: '0.05 (1/20)' },
  { value: 0.1, label: '0.10 (1/10)' },
  { value: 0.125, label: '1/8 (0.125)' },
];

export const NUDGE_STEP_OPTIONS: { value: number; label: string }[] = [
  { value: 0.002, label: '0.002 (超精)' },
  { value: 0.005, label: '0.005 (精细)' },
  { value: 0.01, label: '0.01' },
  { value: 0.025, label: '0.025' },
  { value: 0.05, label: '0.05' },
];

export const BASE_ANCHORS = [0, 0.25, 0.5, 0.75, 1];

export function snapUVToAnchors(
  u: number,
  v: number,
  anchorsU: number[],
  anchorsV: number[],
  gridStep: number,
  anchorTol = 0.024,
): {
  u: number;
  v: number;
  snappedU: boolean;
  snappedV: boolean;
  guideU: number | null;
  guideV: number | null;
} {
  let outU = u;
  let outV = v;
  let guideU: number | null = null;
  let guideV: number | null = null;
  let bestDistU = anchorTol;
  for (const a of anchorsU) {
    const d = Math.abs(u - a);
    if (d <= bestDistU) {
      bestDistU = d;
      outU = a;
      guideU = a;
    }
  }
  let bestDistV = anchorTol;
  for (const a of anchorsV) {
    const d = Math.abs(v - a);
    if (d <= bestDistV) {
      bestDistV = d;
      outV = a;
      guideV = a;
    }
  }
  let snappedU = guideU !== null;
  let snappedV = guideV !== null;
  if (!snappedU && gridStep > 0) {
    outU = Math.round((Math.round(u / gridStep) * gridStep) * 100000) / 100000;
    snappedU = true;
  }
  if (!snappedV && gridStep > 0) {
    outV = Math.round((Math.round(v / gridStep) * gridStep) * 100000) / 100000;
    snappedV = true;
  }
  return { u: outU, v: outV, snappedU, snappedV, guideU, guideV };
}

export function snapScalarToStep(val: number, step: number, anchors: number[] = [], anchorTol = 0): number {
  let bestDist = anchorTol;
  let bestAnchor: number | null = null;
  for (const a of anchors) {
    const d = Math.abs(val - a);
    if (d <= bestDist) {
      bestDist = d;
      bestAnchor = a;
    }
  }
  if (bestAnchor !== null) return bestAnchor;
  if (step > 0) {
    return Math.round((Math.round(val / step) * step) * 100000) / 100000;
  }
  return val;
}

function replaceShapeInPlace(target: ParametricShape, next: ParametricShape): void {
  const cloned = cloneShape(next);
  for (const k of Object.keys(target) as (keyof ParametricShape)[]) {
    if (!(k in cloned)) {
      delete target[k];
    }
  }
  Object.assign(target, cloned);
}

/**
 * Keeps an expanded modal bound to the live layer shape across `app.undo()` / `app.redo()`,
 * or uses a local snapshot stack when editing an unsaved standalone shape.
 */
export function createModalLiveBinding(
  app: App,
  initialShape: ParametricShape,
  targetLayerId: number | undefined,
  opts: FineMutateOpts,
): ModalLiveBinding {
  const syncListeners: ((live?: boolean) => void)[] = [];
  const notifySync = (live = false) => {
    for (const cb of syncListeners) cb(live);
  };

  if (typeof targetLayerId === 'number') {
    const unsub = app.on((what) => {
      if (what === 'history') notifySync(true);
      else if (what === 'doc' || what === 'layers') notifySync(false);
    });
    return {
      getShape: () => app.doc.layers.find((l) => l.id === targetLayerId)?.shape ?? null,
      beforeMutate: (label) => opts.beforeMutate(label),
      afterMutate: (mutOpts) => {
        opts.afterMutate(mutOpts);
        notifySync(Boolean(mutOpts?.live));
      },
      canUndo: () => app.history.canUndo,
      canRedo: () => app.history.canRedo,
      undo: () => {
        const label = app.undo();
        if (!label) return false;
        toast(`已撤回: ${label}`);
        notifySync(false);
        return true;
      },
      redo: () => {
        const label = app.redo();
        if (!label) return false;
        toast(`已恢复: ${label}`);
        notifySync(false);
        return true;
      },
      onSync: (cb) => syncListeners.push(cb),
      dispose: () => {
        unsub();
        syncListeners.length = 0;
      },
    };
  }

  // Standalone draft shape (e.g. create dialog): keep local undo/redo stack
  const undoStack: { label: string; shape: ParametricShape }[] = [];
  const redoStack: { label: string; shape: ParametricShape }[] = [];
  return {
    getShape: () => initialShape,
    beforeMutate: (label) => {
      undoStack.push({ label, shape: cloneShape(initialShape) });
      if (undoStack.length > 40) undoStack.shift();
      redoStack.length = 0;
      opts.beforeMutate(label);
      notifySync(true);
    },
    afterMutate: (mutOpts) => {
      opts.afterMutate(mutOpts);
      notifySync(Boolean(mutOpts?.live));
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => {
      const entry = undoStack.pop();
      if (!entry) return false;
      redoStack.push({ label: entry.label, shape: cloneShape(initialShape) });
      replaceShapeInPlace(initialShape, entry.shape);
      opts.afterMutate({ live: false, needsResort: true });
      toast(`已撤回: ${entry.label}`);
      notifySync(false);
      return true;
    },
    redo: () => {
      const entry = redoStack.pop();
      if (!entry) return false;
      undoStack.push({ label: entry.label, shape: cloneShape(initialShape) });
      replaceShapeInPlace(initialShape, entry.shape);
      opts.afterMutate({ live: false, needsResort: true });
      toast(`已恢复: ${entry.label}`);
      notifySync(false);
      return true;
    },
    onSync: (cb) => syncListeners.push(cb),
    dispose: () => {
      syncListeners.length = 0;
    },
  };
}

let nextFineScopeSeq = 0;
const trackedSubCanvases = new Set<{ canvas: HTMLCanvasElement; unsub: () => void }>();

function buildNudgeStepRepeats(adapter: EditorNudgeAdapter): NonNullable<ShortcutScope['stepRepeats']> {
  let stepStarted = false;
  const runStep = (fn: () => boolean) => {
    const changed = fn();
    if (changed) stepStarted = true;
    return changed;
  };
  const finish = (didMutate: boolean) => {
    if (didMutate || stepStarted) {
      stepStarted = false;
      adapter.commitNudge();
    }
  };
  const sr: NonNullable<ShortcutScope['stepRepeats']> = {
    'nudge.left': { onStep: (ctx) => runStep(() => adapter.nudgeScreen(-1, 0, ctx.shiftBoost, !stepStarted)), onEnd: finish },
    'nudge.right': { onStep: (ctx) => runStep(() => adapter.nudgeScreen(1, 0, ctx.shiftBoost, !stepStarted)), onEnd: finish },
    'nudge.up': { onStep: (ctx) => runStep(() => adapter.nudgeScreen(0, -1, ctx.shiftBoost, !stepStarted)), onEnd: finish },
    'nudge.down': { onStep: (ctx) => runStep(() => adapter.nudgeScreen(0, 1, ctx.shiftBoost, !stepStarted)), onEnd: finish },
  };
  if (adapter.nudgeAux) {
    const aux = adapter.nudgeAux;
    sr['nudge.railPrev'] = { onStep: (ctx) => runStep(() => aux(-1, ctx.shiftBoost, !stepStarted)), onEnd: finish };
    sr['nudge.railNext'] = { onStep: (ctx) => runStep(() => aux(1, ctx.shiftBoost, !stepStarted)), onEnd: finish };
  }
  return sr;
}

export function bindSubCanvasNudgeScope(
  canvas: HTMLCanvasElement,
  adapter: EditorNudgeAdapter,
): () => void {
  for (const entry of [...trackedSubCanvases]) {
    if (!entry.canvas.isConnected) {
      entry.unsub();
      trackedSubCanvases.delete(entry);
    }
  }
  const scopeId = `subcanvas-${++nextFineScopeSeq}`;
  const unsub = shortcutManager.registerScope({
    id: scopeId,
    priority: 50,
    modalBarrier: false,
    isActive: () => canvas.isConnected && document.activeElement === canvas && openSheets.length === 0,
    stepRepeats: buildNudgeStepRepeats(adapter),
  });
  const rec = { canvas, unsub };
  trackedSubCanvases.add(rec);
  return () => {
    trackedSubCanvases.delete(rec);
    unsub();
  };
}

export function buildModalUndoRedoBar(
  binding: ModalLiveBinding,
  onAfterHistory: () => void,
  extraControls: (HTMLElement | string)[] = [],
  nudgeAdapter?: EditorNudgeAdapter,
): {
  bar: HTMLElement;
  sync: () => void;
  dispose: () => void;
} {
  const undoBtn = h('button', {
    class: 'btn small',
    type: 'button',
    title: `${tr('撤回上一步编辑')}${formatActionHint('history.undo')}`,
    onclick: () => {
      if (binding.undo()) onAfterHistory();
    },
  }, '↩ 撤回') as HTMLButtonElement;

  const redoBtn = h('button', {
    class: 'btn small',
    type: 'button',
    title: `${tr('恢复已撤回的编辑')}${formatActionHint('history.redo')}`,
    onclick: () => {
      if (binding.redo()) onAfterHistory();
    },
  }, '↪ 恢复') as HTMLButtonElement;

  const sync = () => {
    undoBtn.disabled = !binding.canUndo();
    redoBtn.disabled = !binding.canRedo();
  };
  sync();
  binding.onSync(() => {
    sync();
  });

  const bar = h('div', { class: 'modal-history-bar' },
    undoBtn,
    redoBtn,
    ...extraControls,
  );

  const unsubShortcuts = shortcutManager.onChange(() => {
    undoBtn.title = `${tr('撤回上一步编辑')}${formatActionHint('history.undo')}`;
    redoBtn.title = `${tr('恢复已撤回的编辑')}${formatActionHint('history.redo')}`;
  });

  const scopeId = `modal-${++nextFineScopeSeq}`;
  const unsubScope = shortcutManager.registerScope({
    id: scopeId,
    priority: 100,
    modalBarrier: true,
    isActive: () => {
      if (!bar.isConnected) return false;
      const sheet = bar.closest('.sheet');
      const overlay = sheet?.closest('.sheet-overlay');
      if (overlay && overlay.nextElementSibling) return false; // Yield to nested dialog above this modal
      return true;
    },
    triggers: {
      'history.undo': () => {
        if (binding.undo()) onAfterHistory();
        return true;
      },
      'history.redo': () => {
        if (binding.redo()) onAfterHistory();
        return true;
      },
    },
    stepRepeats: nudgeAdapter ? buildNudgeStepRepeats(nudgeAdapter) : undefined,
  });

  return {
    bar,
    sync,
    dispose: () => {
      unsubScope();
      unsubShortcuts();
    },
  };
}

export function makeRepeatableButton(
  btn: HTMLButtonElement,
  handlers: {
    onStep: () => boolean;
    onEnd?: (didMutate: boolean) => void;
  },
): HTMLButtonElement {
  let delayTimer: number | null = null;
  let repeatTimer: number | null = null;
  let didMutate = false;
  let active = false;

  const stop = () => {
    if (delayTimer !== null) {
      window.clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (repeatTimer !== null) {
      window.clearInterval(repeatTimer);
      repeatTimer = null;
    }
    if (active) {
      active = false;
      handlers.onEnd?.(didMutate);
      didMutate = false;
    }
  };

  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled || e.button !== 0) return;
    e.preventDefault();
    active = true;
    didMutate = false;
    if (handlers.onStep()) didMutate = true;
    delayTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(() => {
        if (!btn.isConnected || btn.disabled) {
          stop();
          return;
        }
        if (handlers.onStep()) didMutate = true;
      }, 65);
    }, 320);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const changed = handlers.onStep();
      handlers.onEnd?.(changed);
    }
  });
  return btn;
}
