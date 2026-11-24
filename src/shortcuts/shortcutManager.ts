// Standalone, reusable shortcut preset & custom keybinding engine (Blender Meow & Pixel Meow)
import {
  cloneKeyStroke,
  eventToKeyStroke,
  formatKeyStroke,
  isEditableElement,
  keyStrokesEqual,
  normalizeKeyStroke,
  parseKeyStroke,
  serializeKeyStroke,
} from './keyCodec';
import type {
  HoldHandler,
  KeyStroke,
  ShortcutActionDef,
  ShortcutCategoryDef,
  ShortcutConflictResult,
  ShortcutFireContext,
  ShortcutManagerOptions,
  ShortcutPreset,
  ShortcutScope,
  ShortcutSerializedConfig,
  ShortcutStorageAdapter,
  StepRepeatHandler,
  TriggerHandler,
} from './types';

interface ActiveCodeEntry {
  actionId: string;
  kind: 'hold' | 'step_repeat';
  scopeId: string | null;
  didMutate: boolean;
}

interface MatchedCandidate {
  action: ShortcutActionDef;
  shiftBoost: boolean;
}

function defaultStorageAdapter(): ShortcutStorageAdapter | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return {
    getItem: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* ignore quota / sandbox errors */
      }
    },
  };
}

function scopesConflict(a: ShortcutActionDef, b: ShortcutActionDef): boolean {
  const sa = a.scope ?? 'global';
  const sb = b.scope ?? 'global';
  return sa === sb || sa === 'global' || sb === 'global';
}

export class ShortcutManager {
  readonly appId: string;
  private readonly storageKey: string;
  private readonly storage?: ShortcutStorageAdapter;
  readonly categories: ShortcutCategoryDef[];
  readonly actions: ShortcutActionDef[];
  private readonly actionMap = new Map<string, ShortcutActionDef>();
  private readonly presets: ShortcutPreset[];
  private readonly defaultPresetId: string;
  private readonly canRunRoot?: (actionId: string, e: KeyboardEvent) => boolean;

  private activePresetId: string;
  private bindings = new Map<string, KeyStroke[]>();
  private listeners = new Set<() => void>();

  private rootTriggers = new Map<string, TriggerHandler>();
  private rootHolds = new Map<string, HoldHandler>();
  private rootStepRepeats = new Map<string, StepRepeatHandler>();
  private scopes = new Map<string, ShortcutScope>();

  private activeCodes = new Map<string, ActiveCodeEntry>();
  private rafPollLoops = new Set<() => void>();
  private recording = false;

  constructor(opts: ShortcutManagerOptions) {
    this.appId = opts.appId;
    this.storageKey = opts.storageKey;
    this.storage = opts.storage ?? defaultStorageAdapter();
    this.categories = [...opts.categories];
    this.actions = [...opts.actions];
    for (const a of this.actions) {
      this.actionMap.set(a.id, a);
    }
    this.presets = [...opts.presets];
    this.defaultPresetId = opts.defaultPresetId ?? this.presets[0]?.id ?? 'default';
    this.activePresetId = this.defaultPresetId;
    this.canRunRoot = opts.canRunRoot;

    this.applyPresetInternal(this.defaultPresetId, false);
    this.loadFromStorage();
  }

  // ---------------- Config, Presets & Custom Bindings ----------------

  getPresets(): ShortcutPreset[] {
    return this.presets;
  }

  getActivePresetId(): string {
    return this.activePresetId;
  }

  getActivePresetName(): string {
    if (this.activePresetId === 'custom') return '✨ 自定义方案';
    return this.presets.find((p) => p.id === this.activePresetId)?.name ?? '默认预设';
  }

  getActionDef(actionId: string): ShortcutActionDef | undefined {
    return this.actionMap.get(actionId);
  }

  getBindings(actionId: string): KeyStroke[] {
    return (this.bindings.get(actionId) ?? []).map(cloneKeyStroke);
  }

  getPrimaryLabel(actionId: string): string {
    const list = this.bindings.get(actionId);
    if (!list || list.length === 0) return '';
    return formatKeyStroke(list[0]);
  }

  getAllLabels(actionId: string): string {
    const list = this.bindings.get(actionId);
    if (!list || list.length === 0) return '';
    return list.map((ks) => formatKeyStroke(ks)).join(' / ');
  }

  private getPresetBindingsForAction(presetId: string, actionId: string): KeyStroke[] {
    const preset = this.presets.find((p) => p.id === presetId);
    if (preset && preset.bindings[actionId]) {
      return preset.bindings[actionId].slice(0, 2).map(cloneKeyStroke);
    }
    const def = this.actionMap.get(actionId);
    return def ? def.defaultBindings.slice(0, 2).map(cloneKeyStroke) : [];
  }

  isActionModified(actionId: string): boolean {
    const baseId = this.activePresetId === 'custom' ? this.defaultPresetId : this.activePresetId;
    const base = this.getPresetBindingsForAction(baseId, actionId);
    const cur = this.bindings.get(actionId) ?? [];
    if (base.length !== cur.length) return true;
    for (let i = 0; i < cur.length; i++) {
      if (!keyStrokesEqual(base[i], cur[i])) return true;
    }
    return false;
  }

  private matchesPreset(presetId: string): boolean {
    const preset = this.presets.find((p) => p.id === presetId);
    if (!preset) return false;
    for (const act of this.actions) {
      const base = this.getPresetBindingsForAction(presetId, act.id);
      const cur = this.bindings.get(act.id) ?? [];
      if (base.length !== cur.length) return false;
      for (let i = 0; i < cur.length; i++) {
        if (!keyStrokesEqual(base[i], cur[i])) return false;
      }
    }
    return true;
  }

  private syncActivePresetFlag(): void {
    if (this.activePresetId !== 'custom' && this.matchesPreset(this.activePresetId)) return;
    for (const p of this.presets) {
      if (this.matchesPreset(p.id)) {
        this.activePresetId = p.id;
        return;
      }
    }
    this.activePresetId = 'custom';
  }

  private applyPresetInternal(presetId: string, save: boolean): void {
    const preset = this.presets.find((p) => p.id === presetId) ?? this.presets[0];
    this.bindings.clear();
    for (const act of this.actions) {
      const arr = preset?.bindings[act.id] ?? act.defaultBindings;
      this.bindings.set(act.id, arr.slice(0, 2).map(cloneKeyStroke));
    }
    this.activePresetId = preset?.id ?? this.defaultPresetId;
    if (save) {
      this.saveToStorage();
      this.emitChange();
    }
  }

  applyPreset(presetId: string): void {
    this.releaseAllHeld();
    this.applyPresetInternal(presetId, true);
  }

  setSlotBinding(
    actionId: string,
    slotIndex: 0 | 1,
    stroke: KeyStroke | null,
  ): ShortcutConflictResult {
    const targetAct = this.actionMap.get(actionId);
    if (!targetAct) return { unboundFrom: [] };

    this.releaseAllHeld();
    const unboundFrom: ShortcutActionDef[] = [];
    const normalized = stroke ? normalizeKeyStroke(stroke) : null;

    if (normalized) {
      for (const other of this.actions) {
        if (!scopesConflict(targetAct, other)) continue;
        const list = this.bindings.get(other.id) ?? [];
        const filtered: KeyStroke[] = [];
        let removed = false;
        for (let i = 0; i < list.length; i++) {
          if (other.id === actionId && i === slotIndex) {
            filtered.push(list[i]);
            continue;
          }
          if (keyStrokesEqual(list[i], normalized)) {
            removed = true;
            continue;
          }
          filtered.push(list[i]);
        }
        if (removed) {
          this.bindings.set(other.id, filtered);
          if (other.id !== actionId) unboundFrom.push(other);
        }
      }
    }

    const cur = [...(this.bindings.get(actionId) ?? [])];
    if (!normalized) {
      if (slotIndex < cur.length) cur.splice(slotIndex, 1);
    } else if (slotIndex === 0) {
      if (cur.length === 0) cur.push(normalized);
      else cur[0] = normalized;
    } else {
      if (cur.length === 0) cur.push(normalized);
      else if (cur.length === 1) cur.push(normalized);
      else cur[1] = normalized;
    }
    // Deduplicate identical slots within the same action
    const dedup: KeyStroke[] = [];
    for (const ks of cur) {
      if (!dedup.some((d) => keyStrokesEqual(d, ks))) dedup.push(ks);
    }
    this.bindings.set(actionId, dedup.slice(0, 2));
    this.syncActivePresetFlag();
    this.saveToStorage();
    this.emitChange();
    return { unboundFrom };
  }

  resetAction(actionId: string): void {
    const baseId = this.activePresetId === 'custom' ? this.defaultPresetId : this.activePresetId;
    const base = this.getPresetBindingsForAction(baseId, actionId);
    this.releaseAllHeld();
    this.bindings.set(actionId, base);
    this.syncActivePresetFlag();
    this.saveToStorage();
    this.emitChange();
  }

  resetToPreset(presetId?: string): void {
    const targetId = presetId ?? (this.activePresetId === 'custom' ? this.defaultPresetId : this.activePresetId);
    this.applyPreset(targetId);
  }

  exportConfig(): ShortcutSerializedConfig {
    const out: Record<string, string[]> = {};
    for (const act of this.actions) {
      const list = this.bindings.get(act.id) ?? [];
      out[act.id] = list.map(serializeKeyStroke);
    }
    return {
      version: 1,
      appId: this.appId,
      activePresetId: this.activePresetId,
      bindings: out,
    };
  }

  exportJson(): string {
    return JSON.stringify(this.exportConfig(), null, 2);
  }

  importJson(json: string): { importedCount: number; presetId: string } {
    const parsed = JSON.parse(json) as Partial<ShortcutSerializedConfig>;
    if (!parsed || typeof parsed !== 'object' || !parsed.bindings || typeof parsed.bindings !== 'object') {
      throw new Error('无效的快捷键配置文件格式');
    }
    this.releaseAllHeld();
    let importedCount = 0;
    for (const act of this.actions) {
      const rawArr = parsed.bindings[act.id];
      if (!Array.isArray(rawArr)) continue;
      const valid: KeyStroke[] = [];
      for (const s of rawArr) {
        if (typeof s !== 'string') continue;
        const ks = parseKeyStroke(s);
        if (ks && !valid.some((v) => keyStrokesEqual(v, ks))) {
          valid.push(ks);
        }
      }
      this.bindings.set(act.id, valid.slice(0, 2));
      importedCount++;
    }
    if (
      typeof parsed.activePresetId === 'string' &&
      this.presets.some((p) => p.id === parsed.activePresetId) &&
      this.matchesPreset(parsed.activePresetId)
    ) {
      this.activePresetId = parsed.activePresetId;
    } else {
      this.syncActivePresetFlag();
    }
    this.saveToStorage();
    this.emitChange();
    return { importedCount, presetId: this.activePresetId };
  }

  private saveToStorage(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, this.exportJson());
    } catch {
      /* ignore */
    }
  }

  private loadFromStorage(): void {
    if (!this.storage) return;
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return;
    try {
      this.importJsonNoEmit(raw);
    } catch {
      /* keep defaults if corrupt */
    }
  }

  private importJsonNoEmit(json: string): void {
    const parsed = JSON.parse(json) as Partial<ShortcutSerializedConfig>;
    if (!parsed || typeof parsed !== 'object' || !parsed.bindings || typeof parsed.bindings !== 'object') return;
    for (const act of this.actions) {
      const rawArr = parsed.bindings[act.id];
      if (!Array.isArray(rawArr)) continue;
      const valid: KeyStroke[] = [];
      for (const s of rawArr) {
        if (typeof s !== 'string') continue;
        const ks = parseKeyStroke(s);
        if (ks && !valid.some((v) => keyStrokesEqual(v, ks))) valid.push(ks);
      }
      this.bindings.set(act.id, valid.slice(0, 2));
    }
    this.syncActivePresetFlag();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  // ---------------- Handler & Scope Registration ----------------

  onTrigger(actionId: string, handler: TriggerHandler): () => void {
    this.rootTriggers.set(actionId, handler);
    return () => {
      if (this.rootTriggers.get(actionId) === handler) this.rootTriggers.delete(actionId);
    };
  }

  onHold(actionId: string, handler: HoldHandler): () => void {
    this.rootHolds.set(actionId, handler);
    return () => {
      if (this.rootHolds.get(actionId) === handler) this.rootHolds.delete(actionId);
    };
  }

  onStepRepeat(actionId: string, handler: StepRepeatHandler): () => void {
    this.rootStepRepeats.set(actionId, handler);
    return () => {
      if (this.rootStepRepeats.get(actionId) === handler) this.rootStepRepeats.delete(actionId);
    };
  }

  /**
   * Drives smooth 60fps continuous actions (e.g. WASD canvas panning) only while any listed action is held.
   * Stops requestAnimationFrame automatically when released (0 idle CPU).
   */
  registerContinuousHold(
    actionIds: string[],
    onTick: (held: ReadonlySet<string>, dtSec: number, shiftHeld: boolean) => void,
  ): () => void {
    const idSet = new Set(actionIds);
    const held = new Set<string>();
    let rafId = 0;
    let lastTs = 0;
    let shiftHeld = false;
    let disposed = false;

    const tick = (now: number) => {
      rafId = 0;
      if (disposed || held.size === 0) return;
      const dt = lastTs > 0 ? Math.min(0.05, Math.max(0, (now - lastTs) / 1000)) : 1 / 60;
      lastTs = now;
      if (dt > 0) onTick(held, dt, shiftHeld);
      if (!disposed && held.size > 0 && typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
      }
    };

    const ensureLoop = () => {
      if (rafId !== 0 || held.size === 0 || disposed) return;
      if (typeof requestAnimationFrame === 'function') {
        lastTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    const unsubs: (() => void)[] = [];
    for (const id of actionIds) {
      unsubs.push(
        this.onHold(id, (active, ev) => {
          if (ev) shiftHeld = Boolean(ev.shiftKey);
          if (active) {
            held.add(id);
            ensureLoop();
          } else {
            held.delete(id);
            if (held.size === 0 && rafId && typeof cancelAnimationFrame === 'function') {
              cancelAnimationFrame(rafId);
              rafId = 0;
            }
          }
        }),
      );
    }

    const onShiftTrack = (e: KeyboardEvent) => {
      if (held.size > 0) shiftHeld = Boolean(e.shiftKey);
    };
    const clearShift = () => {
      held.clear();
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
    this.rafPollLoops.add(clearShift);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onShiftTrack);
      window.addEventListener('keyup', onShiftTrack);
    }

    return () => {
      disposed = true;
      for (const u of unsubs) u();
      this.rafPollLoops.delete(clearShift);
      clearShift();
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onShiftTrack);
        window.removeEventListener('keyup', onShiftTrack);
      }
      void idSet;
    };
  }

  registerScope(scope: ShortcutScope): () => void {
    this.scopes.set(scope.id, scope);
    return () => {
      this.scopes.delete(scope.id);
      this.releaseScopeHeld(scope.id);
    };
  }

  setRecording(active: boolean): void {
    this.recording = active;
    if (active) this.releaseAllHeld();
  }

  get isRecording(): boolean {
    return this.recording;
  }

  isHeld(actionId: string): boolean {
    for (const entry of this.activeCodes.values()) {
      if (entry.actionId === actionId && entry.kind === 'hold') return true;
    }
    return false;
  }

  // ---------------- Event Dispatch & Anti-Stuck-Key Lifecycle ----------------

  private findCandidatesInPool(
    stroke: KeyStroke,
    canHandle: (action: ShortcutActionDef) => boolean,
  ): MatchedCandidate[] {
    const exact: MatchedCandidate[] = [];
    for (const act of this.actions) {
      if (!canHandle(act)) continue;
      const list = this.bindings.get(act.id) ?? [];
      if (list.some((b) => keyStrokesEqual(b, stroke))) {
        exact.push({ action: act, shiftBoost: false });
      }
    }
    if (exact.length > 0) return exact;

    if (stroke.shift) {
      const noShift: KeyStroke = normalizeKeyStroke({ ...stroke, shift: false });
      const boosted: MatchedCandidate[] = [];
      for (const act of this.actions) {
        if (!act.allowShiftBoost || !canHandle(act)) continue;
        const list = this.bindings.get(act.id) ?? [];
        if (list.some((b) => keyStrokesEqual(b, noShift))) {
          boosted.push({ action: act, shiftBoost: true });
        }
      }
      if (boosted.length > 0) return boosted;
    }
    return [];
  }

  private getScopeHoldHandler(scopeId: string | null, actionId: string): HoldHandler | undefined {
    if (scopeId === null) return this.rootHolds.get(actionId);
    return this.scopes.get(scopeId)?.holds?.[actionId];
  }

  private getScopeStepHandler(scopeId: string | null, actionId: string): StepRepeatHandler | undefined {
    if (scopeId === null) return this.rootStepRepeats.get(actionId);
    return this.scopes.get(scopeId)?.stepRepeats?.[actionId];
  }

  private countHoldFor(scopeId: string | null, actionId: string): number {
    let cnt = 0;
    for (const entry of this.activeCodes.values()) {
      if (entry.kind === 'hold' && entry.scopeId === scopeId && entry.actionId === actionId) {
        cnt++;
      }
    }
    return cnt;
  }

  private dispatchStepRepeat(
    handler: StepRepeatHandler,
    actionId: string,
    stroke: KeyStroke,
    shiftBoost: boolean,
    scopeId: string | null,
    e: KeyboardEvent,
  ): boolean {
    const ctx: ShortcutFireContext = {
      actionId,
      stroke,
      isRepeat: Boolean(e.repeat),
      shiftBoost,
    };
    const prevEntry = this.activeCodes.get(e.code);
    const mutated = Boolean(handler.onStep(ctx, e));
    if (prevEntry && prevEntry.kind === 'step_repeat' && prevEntry.actionId === actionId && prevEntry.scopeId === scopeId) {
      if (mutated) prevEntry.didMutate = true;
    } else {
      if (prevEntry) this.releaseCodeEntry(e.code, e);
      this.activeCodes.set(e.code, {
        actionId,
        kind: 'step_repeat',
        scopeId,
        didMutate: mutated,
      });
    }
    return true;
  }

  private dispatchHoldDown(
    handler: HoldHandler,
    actionId: string,
    scopeId: string | null,
    e: KeyboardEvent,
  ): boolean {
    if (e.repeat) return true;
    const prev = this.activeCodes.get(e.code);
    if (prev && (prev.actionId !== actionId || prev.scopeId !== scopeId || prev.kind !== 'hold')) {
      this.releaseCodeEntry(e.code, e);
    }
    const alreadyHeld = this.countHoldFor(scopeId, actionId) > 0;
    this.activeCodes.set(e.code, {
      actionId,
      kind: 'hold',
      scopeId,
      didMutate: false,
    });
    if (!alreadyHeld) {
      handler(true, e);
    }
    return true;
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (this.recording) return false;
    if (isEditableElement(e.target)) return false;
    const stroke = eventToKeyStroke(e);
    if (!stroke) return false;

    const activeScopes = [...this.scopes.values()]
      .filter((s) => s.isActive())
      .sort((a, b) => b.priority - a.priority);

    let blockedByModal = false;
    for (const sc of activeScopes) {
      const cands = this.findCandidatesInPool(stroke, (act) =>
        Boolean(sc.triggers?.[act.id] || sc.holds?.[act.id] || sc.stepRepeats?.[act.id]),
      );
      for (const { action, shiftBoost } of cands) {
        if (action.kind === 'step_repeat' && sc.stepRepeats?.[action.id]) {
          e.preventDefault();
          return this.dispatchStepRepeat(sc.stepRepeats[action.id], action.id, stroke, shiftBoost, sc.id, e);
        }
        if (action.kind === 'hold' && sc.holds?.[action.id]) {
          e.preventDefault();
          return this.dispatchHoldDown(sc.holds[action.id], action.id, sc.id, e);
        }
        if (action.kind === 'trigger' && sc.triggers?.[action.id]) {
          if (e.repeat && !action.allowRepeat) return false;
          const res = sc.triggers[action.id](
            { actionId: action.id, stroke, isRepeat: Boolean(e.repeat), shiftBoost },
            e,
          );
          if (res !== false) {
            e.preventDefault();
            return true;
          }
        }
      }
      if (sc.modalBarrier) {
        blockedByModal = true;
        break;
      }
    }

    if (blockedByModal) return false;

    const rootCands = this.findCandidatesInPool(stroke, (act) => {
      if (this.canRunRoot && !this.canRunRoot(act.id, e)) return false;
      return Boolean(
        this.rootTriggers.has(act.id) ||
        this.rootHolds.has(act.id) ||
        this.rootStepRepeats.has(act.id),
      );
    });
    for (const { action, shiftBoost } of rootCands) {
      if (action.kind === 'step_repeat') {
        const sr = this.rootStepRepeats.get(action.id);
        if (sr) {
          e.preventDefault();
          return this.dispatchStepRepeat(sr, action.id, stroke, shiftBoost, null, e);
        }
      } else if (action.kind === 'hold') {
        const hh = this.rootHolds.get(action.id);
        if (hh) {
          e.preventDefault();
          return this.dispatchHoldDown(hh, action.id, null, e);
        }
      } else {
        const th = this.rootTriggers.get(action.id);
        if (th) {
          if (e.repeat && !action.allowRepeat) return false;
          const res = th(
            { actionId: action.id, stroke, isRepeat: Boolean(e.repeat), shiftBoost },
            e,
          );
          if (res !== false) {
            e.preventDefault();
            return true;
          }
        }
      }
    }

    return false;
  }

  private releaseCodeEntry(code: string, e?: KeyboardEvent): void {
    const entry = this.activeCodes.get(code);
    if (!entry) return;
    this.activeCodes.delete(code);
    if (entry.kind === 'hold') {
      if (this.countHoldFor(entry.scopeId, entry.actionId) === 0) {
        this.getScopeHoldHandler(entry.scopeId, entry.actionId)?.(false, e);
      }
    } else if (entry.kind === 'step_repeat') {
      this.getScopeStepHandler(entry.scopeId, entry.actionId)?.onEnd?.(entry.didMutate);
    }
  }

  private releaseScopeHeld(scopeId: string): void {
    for (const [code, entry] of [...this.activeCodes.entries()]) {
      if (entry.scopeId === scopeId) {
        this.releaseCodeEntry(code);
      }
    }
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (!e || !e.code) return;
    this.releaseCodeEntry(e.code, e);
  }

  releaseAllHeld(): void {
    for (const code of [...this.activeCodes.keys()]) {
      this.releaseCodeEntry(code);
    }
    for (const stop of this.rafPollLoops) stop();
  }

  attach(win?: Window): () => void {
    const target = win ?? (typeof window !== 'undefined' ? window : undefined);
    if (!target) return () => {};
    const onDown = (e: KeyboardEvent) => {
      this.handleKeyDown(e);
    };
    const onUp = (e: KeyboardEvent) => {
      this.handleKeyUp(e);
    };
    const onBlur = () => {
      this.releaseAllHeld();
    };
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this.releaseAllHeld();
      }
    };
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
    }
    return () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis);
      }
      this.releaseAllHeld();
    };
  }
}
