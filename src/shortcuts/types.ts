// Portable keyboard shortcut system type definitions (zero host-app dependencies; shared by Blender Meow & Pixel Meow)

export interface KeyStroke {
  /** Physical KeyboardEvent.code, e.g. 'KeyW', 'Space', 'ArrowUp', 'Equal' */
  code: string;
  /** Ctrl on Windows/Linux or Cmd (Meta) on macOS */
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type ShortcutActionKind = 'trigger' | 'hold' | 'step_repeat';

export type ShortcutConflictScope = 'global' | 'workspace' | 'editor';

export interface ShortcutCategoryDef {
  id: string;
  label: string;
  icon?: string;
}

export interface ShortcutActionDef {
  id: string;
  category: string;
  label: string;
  description?: string;
  kind: ShortcutActionKind;
  /** Actions only conflict if scopes match or either is 'global' (default: 'global') */
  scope?: ShortcutConflictScope;
  /** For 'trigger': allow OS auto-repeat events while holding (default: false) */
  allowRepeat?: boolean;
  /** If true, Shift+<binding> matches when no explicit Shift binding matches, passing shiftBoost=true */
  allowShiftBoost?: boolean;
  /** Up to 2 default bindings: [primary, secondary] */
  defaultBindings: KeyStroke[];
}

export interface ShortcutPreset {
  id: string;
  name: string;
  description: string;
  bindings: Record<string, KeyStroke[]>;
}

export interface ShortcutFireContext {
  actionId: string;
  stroke: KeyStroke;
  isRepeat: boolean;
  shiftBoost: boolean;
}

export type TriggerHandler = (ctx: ShortcutFireContext, e: KeyboardEvent) => boolean | void;

export type HoldHandler = (active: boolean, e?: KeyboardEvent) => void;

export interface StepRepeatHandler {
  /** Should return true when a document/canvas mutation occurred so onEnd(true) commits once */
  onStep: (ctx: ShortcutFireContext, e: KeyboardEvent) => boolean | void;
  /** Called once on keyup / blur / releaseAllHeld to finalize coalesced live edits */
  onEnd?: (didMutate: boolean) => void;
}

export interface ShortcutScope {
  id: string;
  /** Higher priority evaluates first (e.g. 100 for modals, 50 for focused inline sub-canvases) */
  priority: number;
  isActive: () => boolean;
  /** When true and isActive(), blocks lower-priority scopes and root workspace handlers */
  modalBarrier?: boolean;
  triggers?: Record<string, TriggerHandler>;
  holds?: Record<string, HoldHandler>;
  stepRepeats?: Record<string, StepRepeatHandler>;
}

export interface ShortcutStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface ShortcutSerializedConfig {
  version: 1;
  appId: string;
  activePresetId: string;
  bindings: Record<string, string[]>;
}

export interface ShortcutConflictResult {
  unboundFrom: ShortcutActionDef[];
}

export interface ShortcutManagerOptions {
  appId: string;
  storageKey: string;
  categories: ShortcutCategoryDef[];
  actions: ShortcutActionDef[];
  presets: ShortcutPreset[];
  defaultPresetId?: string;
  storage?: ShortcutStorageAdapter;
  canRunRoot?: (actionId: string, e: KeyboardEvent) => boolean;
}
