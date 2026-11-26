// Central application state, multi-project persistence, grid snap & shape creation defaults
import { PIXEL_MEOW_ONLINE_URL } from './core/about';
import { clamp, type RGBA } from './core/color';
import { BuilderDocument, BuilderLayer } from './core/document';
import { cloneGroundShadowConfig } from './core/groundShadow';
import { History } from './core/history';
import { setLanguageSetting, tr, type LanguageSetting } from './core/i18n';
import { type GridSnapStep, type MixedMeasureOrder } from './core/isoMath';
import {
  cloneShape,
  createDefaultShape,
  normalizeShadeSteps,
  SHAPE_LABELS,
  type ParametricShape,
  type ShapeKind,
} from './core/isoRenderer';
import { applyThemeToDom, resolveThemeTokens, type ThemeId, type ThemeTokens } from './core/theme';
import { getPlanarFacesForShape } from './core/textures';
import { kvDel, kvGet, kvSet } from './platform';
import { deserializeBmeowProject, serializeBmeowProject } from './core/exporter';

export type ToolId = 'select' | 'create' | 'ruler' | 'frame' | 'hand';

export type RulerMode = 'vertical' | 'horizontal' | 'mixed';

export interface RulerPoint3D {
  wu: number;
  wv: number;
  zPx: number;
}

export interface PinnedRulerAnnotation {
  id: string;
  mode: RulerMode;
  order: MixedMeasureOrder;
  pts: RulerPoint3D[];
}

export const DEFAULT_ISO_GRID_COLOR: RGBA = { r: 168, g: 85, b: 247, a: 61 };

export interface Settings {
  language: LanguageSetting;
  uiTheme: ThemeId;
  uiCustomPanel: RGBA;
  uiCustomAccent: RGBA;
  uiCustomStage: RGBA;
  showIsoGrid: boolean;
  isoGridColor: RGBA;
  showGroundProjection: boolean;
  keepGroundedOnTilt: boolean;
  snapEnabled: boolean;
  snapStep: GridSnapStep;
  showPixelGrid: boolean;
  pixelGridMinZoom: number;
  smoothing: boolean;
  shadeSteps: number;
  gestureUndoRedo: boolean;
  autoStackSnap: boolean;
  autoSortOnEdit: boolean;
  exportPath: string;
  exportTreeUri?: string;
  pixelMeowWebUrl: string;
  // Ruler tool options
  rulerMode: RulerMode;
  rulerMixedOrder: MixedMeasureOrder;
  rulerSnapGrid: boolean;
  rulerLockAxis: boolean;
  // Select drag axis lock
  selectDragMode: 'plane' | 'vertical_z';
  dockedTextureLibrary: boolean;
  themeDefaultDarkV2?: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  plotU: number;
  plotV: number;
  updatedAt: number;
  thumb: string;
}

type Listener = (what: string) => void;

const SETTINGS_KEY = 'buildermeow.settings.v1';
const PROJECTS_INDEX_KEY = 'buildermeow.projects.index';
const RECENT_COLORS_KEY = 'blendermeow.recentColors';

const DEFAULT_RECENT_COLORS: string[] = [
  '#A8B0C2', '#E2E8F0', '#94A3B8', '#64748B',
  '#38BDF8', '#FDE047', '#FB923C', '#F87171',
  '#C084FC', '#4ADE80', '#528628', '#334155',
];

export class App {
  doc: BuilderDocument;
  history = new History();
  tool: ToolId = 'select';
  rightTab: 'inspector' | 'material' | 'layers' = 'inspector';
  docId = 'proj_' + Date.now();
  docName = '等距建筑 1';
  projects: ProjectMeta[] = [];
  settings: Settings;
  createPreset: ParametricShape;
  pinnedRulers: PinnedRulerAnnotation[] = [];
  recentColors: string[] = [...DEFAULT_RECENT_COLORS];
  activeFaceByLayer = new Map<number, string>();
  private listeners = new Set<Listener>();
  private recentColorListeners = new Set<() => void>();
  private autosaveTimer: number | undefined;
  cancelActiveTool: (() => void) | null = null;

  constructor() {
    this.settings = this.loadSettings();
    setLanguageSetting(this.settings.language);
    this.docName = tr('等距建筑 1');
    this.recentColors = this.loadRecentColors();
    this.createPreset = createDefaultShape('box', {
      baseColor: { r: 168, g: 176, b: 194, a: 255 },
      heightPx: 24,
    });
    this.doc = this.createStarterDocument();
    this.applyTheme();
  }

  private loadRecentColors(): string[] {
    if (typeof localStorage === 'undefined') return [...DEFAULT_RECENT_COLORS];
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || 'null');
      if (Array.isArray(parsed)) {
        const clean = parsed
          .filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()))
          .map((c) => c.trim().toUpperCase())
          .slice(0, 16);
        if (clean.length > 0) return clean;
      }
    } catch { /* ignore */ }
    return [...DEFAULT_RECENT_COLORS];
  }

  private loadSettings(): Settings {
    const def: Settings = {
      language: 'auto',
      uiTheme: 'dark',
      uiCustomPanel: { r: 38, g: 30, b: 58, a: 255 },
      uiCustomAccent: { r: 168, g: 85, b: 247, a: 255 },
      uiCustomStage: { r: 34, g: 27, b: 51, a: 255 },
      showIsoGrid: true,
      isoGridColor: { ...DEFAULT_ISO_GRID_COLOR },
      showGroundProjection: true,
      keepGroundedOnTilt: true,
      snapEnabled: true,
      snapStep: 1,
      showPixelGrid: true,
      pixelGridMinZoom: 6,
      smoothing: false,
      shadeSteps: 0,
      gestureUndoRedo: true,
      autoStackSnap: false,
      autoSortOnEdit: true,
      exportPath: 'BlenderMeow',
      pixelMeowWebUrl: PIXEL_MEOW_ONLINE_URL,
      rulerMode: 'mixed',
      rulerMixedOrder: 'flat_then_vert',
      rulerSnapGrid: true,
      rulerLockAxis: false,
      selectDragMode: 'plane',
      dockedTextureLibrary: false,
      themeDefaultDarkV2: true,
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return def;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const merged: Settings = { ...def, ...parsed };
      merged.language =
        parsed.language === 'zh' || parsed.language === 'en' || parsed.language === 'auto'
          ? parsed.language
          : 'auto';
      merged.shadeSteps = normalizeShadeSteps(merged.shadeSteps);
      merged.dockedTextureLibrary = Boolean(merged.dockedTextureLibrary);
      merged.showGroundProjection = parsed.showGroundProjection !== undefined ? Boolean(parsed.showGroundProjection) : true;
      merged.keepGroundedOnTilt = parsed.keepGroundedOnTilt !== undefined ? Boolean(parsed.keepGroundedOnTilt) : true;
      const rawGrid = parsed.isoGridColor;
      merged.isoGridColor =
        rawGrid &&
        typeof rawGrid === 'object' &&
        Number.isFinite(rawGrid.r) &&
        Number.isFinite(rawGrid.g) &&
        Number.isFinite(rawGrid.b)
          ? {
              r: clamp(Math.round(rawGrid.r), 0, 255),
              g: clamp(Math.round(rawGrid.g), 0, 255),
              b: clamp(Math.round(rawGrid.b), 0, 255),
              a: clamp(Math.round(Number.isFinite(rawGrid.a) ? rawGrid.a : DEFAULT_ISO_GRID_COLOR.a), 0, 255),
            }
          : { ...DEFAULT_ISO_GRID_COLOR };
      if (!parsed.uiTheme) {
        merged.uiTheme = 'dark';
      }
      if (!parsed.themeDefaultDarkV2) {
        if (parsed.exportPath === 'BuilderMeow') {
          merged.exportPath = 'BlenderMeow';
        }
        merged.themeDefaultDarkV2 = true;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        } catch { /* ignore */ }
      }
      return merged;
    } catch {
      return def;
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* ignore */ }
    this.applyTheme();
    this.emit('settings');
  }

  setLanguage(language: LanguageSetting) {
    const norm: LanguageSetting = language === 'zh' || language === 'en' ? language : 'auto';
    this.settings.language = norm;
    setLanguageSetting(norm);
    this.saveSettings();
    this.emit('language');
  }

  get themeTokens(): ThemeTokens {
    return resolveThemeTokens(
      this.settings.uiTheme,
      this.settings.uiCustomPanel,
      this.settings.uiCustomAccent,
      this.settings.uiCustomStage,
    );
  }

  applyTheme() {
    applyThemeToDom(this.themeTokens);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onRecentColors(fn: () => void): () => void {
    this.recentColorListeners.add(fn);
    return () => this.recentColorListeners.delete(fn);
  }

  emit(what: string) {
    for (const fn of this.listeners) fn(what);
    if (what === 'doc' || what === 'layers' || what === 'history' || what === 'doc_live') {
      this.scheduleAutosave();
    }
  }

  private createStarterDocument(): BuilderDocument {
    const d = new BuilderDocument(256, 256, 4, 4, 16);
    d.shadeSteps = this.settings.shadeSteps;
    d.groundShadow = cloneGroundShadowConfig({ enabled: true });
    const base = new BuilderLayer(
      256,
      256,
      tr('TheoTown 4×4 绿地底座'),
      'shape',
      createDefaultShape('theotown_base', { u: 0, v: 0, zPx: 0, sizeU: 4, sizeV: 4, heightPx: 0 }),
    );
    d.rerenderShapeLayer(base);
    d.layers.push(base);

    const tower = new BuilderLayer(
      256,
      256,
      tr('主楼立方体'),
      'shape',
      createDefaultShape('box', {
        u: 1,
        v: 1,
        zPx: 0,
        sizeU: 2,
        sizeV: 2,
        heightPx: 36,
        baseColor: { r: 176, g: 186, b: 204, a: 255 },
        pattern: {
          type: 'windows',
          primaryColor: { r: 96, g: 185, b: 245, a: 255 },
          rows: 4,
          cols: 2,
          spacingPx: 2,
          marginPx: 3,
          applyTop: false,
        },
      }),
    );
    d.rerenderShapeLayer(tower);
    d.layers.push(tower);
    d.active = 1;
    return d;
  }

  newDocument(
    w: number,
    h: number,
    plotU: number,
    plotV: number,
    name: string,
    withTheoTownBase = true,
    withGroundShadow = true,
  ) {
    this.cancelActiveTool?.();
    this.docId = 'proj_' + Date.now();
    this.docName = name;
    this.doc = new BuilderDocument(w, h, plotU, plotV, 16);
    this.doc.shadeSteps = this.settings.shadeSteps;
    this.doc.groundShadow = cloneGroundShadowConfig({ enabled: withGroundShadow });
    if (withTheoTownBase) {
      const base = new BuilderLayer(
        w,
        h,
        tr(`TheoTown ${plotU}×${plotV} 底座`),
        'shape',
        createDefaultShape('theotown_base', { u: 0, v: 0, zPx: 0, sizeU: plotU, sizeV: plotV, heightPx: 0 }),
      );
      this.doc.rerenderShapeLayer(base);
      this.doc.layers.push(base);
    }
    this.pinnedRulers = [];
    this.history.clear();
    this.emit('doc');
    this.emit('layers');
  }

  setDocument(doc: BuilderDocument, name: string, id?: string) {
    this.cancelActiveTool?.();
    this.docId = id ?? 'proj_' + Date.now();
    this.docName = name;
    this.doc = doc;
    this.pinnedRulers = [];
    this.history.clear();
    this.emit('doc');
    this.emit('layers');
  }

  resizeCanvas(
    w: number,
    h: number,
    plotU = this.doc.plotU,
    plotV = this.doc.plotV,
    bottomMarginPx = this.doc.bottomMarginPx,
    opts?: { rasterDx?: number; rasterDy?: number; syncBaseLayer?: boolean },
  ): boolean {
    const nw = Math.max(32, Math.min(2048, Math.round(w)));
    const nh = Math.max(32, Math.min(2048, Math.round(h)));
    const nPlotU = Math.max(1, Math.min(24, Math.round(plotU)));
    const nPlotV = Math.max(1, Math.min(24, Math.round(plotV)));
    const nMargin = Math.max(0, Math.min(256, Math.round(bottomMarginPx)));
    if (
      nw === this.doc.width
      && nh === this.doc.height
      && nPlotU === this.doc.plotU
      && nPlotV === this.doc.plotV
      && nMargin === this.doc.bottomMarginPx
      && opts?.rasterDx === undefined
      && opts?.rasterDy === undefined
    ) {
      return false;
    }
    this.cancelActiveTool?.();
    this.pushHistory(`调整画布尺寸为 ${nw}×${nh}`);
    this.doc.resize(nw, nh, nPlotU, nPlotV, nMargin, opts);
    this.emit('doc');
    this.emit('layers');
    return true;
  }

  setTool(t: ToolId) {
    if (this.tool !== t) this.cancelActiveTool?.();
    this.tool = t;
    this.emit('tool');
  }

  setActiveShapePreset(kind: ShapeKind) {
    const prev = this.createPreset;
    this.createPreset = createDefaultShape(kind, {
      baseColor: { ...prev.baseColor },
      roofColor: prev.roofColor ? { ...prev.roofColor } : null,
      autoShade: prev.autoShade,
      shadeContrast: prev.shadeContrast,
      outlineMode: prev.outlineMode,
      outlineColor: prev.outlineColor ? { ...prev.outlineColor } : null,
      edgeHighlight: prev.edgeHighlight,
      heightPx: kind === 'theotown_base' ? 0 : kind === 'sphere' ? 18 : Math.max(6, prev.heightPx || 24),
      pattern: { ...prev.pattern, primaryColor: { ...prev.pattern.primaryColor } },
    });
    this.emit('preset');
  }

  pushHistory(label: string) {
    this.history.push(label, this.doc);
    this.emit('history');
  }

  undo() {
    this.cancelActiveTool?.();
    const lbl = this.history.undo(this.doc);
    if (!lbl) return null;
    this.emit('doc');
    this.emit('layers');
    this.emit('history');
    return lbl;
  }

  redo() {
    this.cancelActiveTool?.();
    const lbl = this.history.redo(this.doc);
    if (!lbl) return null;
    this.emit('doc');
    this.emit('layers');
    this.emit('history');
    return lbl;
  }

  rotateView(delta: 1 | -1) {
    this.cancelActiveTool?.();
    this.pushHistory(delta > 0 ? '顺时针旋转 90°' : '逆时针旋转 90°');
    this.doc.rotateView(delta);
    this.emit('doc');
    this.emit('layers');
  }

  sortByDepth() {
    this.cancelActiveTool?.();
    this.pushHistory('按当前视角深度排层');
    this.doc.sortLayersByIsoDepth();
    this.emit('doc');
    this.emit('layers');
  }

  addShapeLayer(shape: ParametricShape, customName?: string): BuilderLayer {
    const label = customName?.trim() || `${tr(SHAPE_LABELS[shape.shapeType])} ${this.doc.layers.length + 1}`;
    this.pushHistory(`新建 ${label}`);
    const layer = new BuilderLayer(this.doc.width, this.doc.height, label, 'shape', cloneShape(shape));
    this.doc.rerenderShapeLayer(layer);
    if (shape.shapeType === 'theotown_base') {
      this.doc.layers.unshift(layer);
      this.doc.active = 0;
    } else {
      const insertAt = Math.min(this.doc.layers.length, this.doc.active + 1);
      this.doc.layers.splice(insertAt, 0, layer);
      this.doc.active = insertAt;
    }
    if (this.settings.autoSortOnEdit) {
      this.doc.sortLayersByIsoDepth();
    }
    this.emit('doc');
    this.emit('layers');
    return layer;
  }

  addRasterLayer(img: CanvasImageSource, name: string, role: 'underlay' | 'overlay' = 'underlay'): BuilderLayer {
    this.pushHistory(`导入参考图 ${name}`);
    const l = new BuilderLayer(this.doc.width, this.doc.height, name, 'raster');
    l.rasterRole = role;
    // Bottom-center align raster image
    const iw = 'width' in img ? Number(img.width) : this.doc.width;
    const ih = 'height' in img ? Number(img.height) : this.doc.height;
    const dx = Math.floor((this.doc.width - iw) / 2);
    const dy = this.doc.height - ih - this.doc.bottomMarginPx;
    l.drawImage(img, dx, dy);
    if (role === 'underlay') {
      this.doc.layers.unshift(l);
      this.doc.active = 0;
    } else {
      this.doc.layers.push(l);
      this.doc.active = this.doc.layers.length - 1;
    }
    this.emit('doc');
    this.emit('layers');
    return l;
  }

  duplicateActiveLayer() {
    this.cancelActiveTool?.();
    const cur = this.doc.layer;
    if (!cur) return;
    this.pushHistory('复制图层');
    const c = cur.clone();
    if (c.kind === 'shape' && c.shape) {
      c.shape.u = Math.min(this.doc.plotU - c.shape.sizeU, c.shape.u + (this.settings.snapEnabled ? this.settings.snapStep : 0.5));
      this.doc.rerenderShapeLayer(c);
    }
    this.doc.layers.splice(this.doc.active + 1, 0, c);
    this.doc.active += 1;
    this.emit('doc');
    this.emit('layers');
  }

  deleteActiveLayer() {
    this.cancelActiveTool?.();
    if (this.doc.layers.length === 0) return;
    this.pushHistory('删除图层');
    this.doc.layers.splice(this.doc.active, 1);
    this.doc.active = Math.max(0, Math.min(this.doc.active, this.doc.layers.length - 1));
    this.emit('doc');
    this.emit('layers');
  }

  moveLayer(delta: -1 | 1) {
    this.cancelActiveTool?.();
    const i = this.doc.active;
    const j = i + delta;
    if (j < 0 || j >= this.doc.layers.length) return;
    this.pushHistory('调整图层顺序');
    if (this.settings.autoSortOnEdit) {
      this.settings.autoSortOnEdit = false;
      this.saveSettings();
    }
    const [item] = this.doc.layers.splice(i, 1);
    this.doc.layers.splice(j, 0, item);
    this.doc.active = j;
    this.emit('doc');
    this.emit('layers');
  }

  reorderLayer(fromIdx: number, toIdx: number) {
    this.cancelActiveTool?.();
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= this.doc.layers.length || toIdx >= this.doc.layers.length) return;
    this.pushHistory('拖拽排序图层');
    if (this.settings.autoSortOnEdit) {
      this.settings.autoSortOnEdit = false;
      this.saveSettings();
    }
    const activeId = this.doc.layer?.id;
    const [item] = this.doc.layers.splice(fromIdx, 1);
    this.doc.layers.splice(toIdx, 0, item);
    if (activeId !== undefined) {
      const ni = this.doc.layers.findIndex((l) => l.id === activeId);
      if (ni >= 0) this.doc.active = ni;
    }
    this.emit('doc');
    this.emit('layers');
  }

  setGroundShadow(
    patch: { enabled?: boolean; interBlockEnabled?: boolean; color?: RGBA },
    opts: { pushHistory?: string; live?: boolean } = {},
  ) {
    if (opts.pushHistory) {
      this.pushHistory(opts.pushHistory);
    }
    if (typeof patch.enabled === 'boolean') {
      this.doc.groundShadow.enabled = patch.enabled;
    }
    if (typeof patch.interBlockEnabled === 'boolean') {
      this.doc.groundShadow.interBlockEnabled = patch.interBlockEnabled;
      if (!patch.interBlockEnabled) {
        for (const l of this.doc.layers) {
          l.cachedSunField = null;
          l.cachedSunFieldSig = '';
        }
      }
    }
    if (patch.color) {
      this.doc.groundShadow.color = {
        r: clamp(Math.round(patch.color.r), 0, 255),
        g: clamp(Math.round(patch.color.g), 0, 255),
        b: clamp(Math.round(patch.color.b), 0, 255),
        a: clamp(Math.round(patch.color.a), 0, 255),
      };
    }
    if (opts.live) {
      this.emit('doc_live');
    } else {
      this.emit('doc');
      this.emit('layers');
    }
  }

  setShadeSteps(
    steps: number,
    opts: { live?: boolean; pushHistory?: string; persistDefault?: boolean } = {},
  ) {
    const next = normalizeShadeSteps(steps);
    const docChanged = this.doc.shadeSteps !== next;
    const persistDefault = opts.persistDefault !== false;
    if (opts.pushHistory && docChanged) {
      this.pushHistory(opts.pushHistory);
    }
    if (persistDefault) {
      this.settings.shadeSteps = next;
    }
    if (docChanged) {
      this.doc.shadeSteps = next;
      this.doc.rerenderAllShapes({ preserveGeometryCache: true });
    }
    if (opts.live) {
      if (docChanged) this.emit('doc_live');
    } else {
      if (persistDefault) this.saveSettings();
      if (docChanged) {
        this.emit('doc');
        this.emit('layers');
      }
    }
  }

  getSnapStep(): number {
    return this.settings.snapEnabled ? this.settings.snapStep : 0.0625;
  }

  getActiveFaceId(layerId: number | undefined, shape: ParametricShape): string | undefined {
    const faces = getPlanarFacesForShape(shape);
    if (faces.length === 0) return undefined;
    if (layerId !== undefined) {
      const uiFace = this.activeFaceByLayer.get(layerId);
      if (uiFace && faces.some((f) => f.id === uiFace)) return uiFace;
    }
    if (shape.activeFaceId && faces.some((f) => f.id === shape.activeFaceId)) {
      return shape.activeFaceId;
    }
    return faces[0].id;
  }

  setActiveFaceId(layerId: number | undefined, faceId: string, shape?: ParametricShape): void {
    if (layerId !== undefined) {
      this.activeFaceByLayer.set(layerId, faceId);
    } else if (shape) {
      shape.activeFaceId = faceId;
    }
  }

  rememberColor(hex: string) {
    const u = hex.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(u)) return;
    this.recentColors = [u, ...this.recentColors.filter((c) => c !== u)].slice(0, 16);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(this.recentColors));
      } catch { /* ignore */ }
    }
    for (const fn of this.recentColorListeners) fn();
  }

  // -------- Multi-project IndexedDB persistence --------

  private scheduleAutosave() {
    if (typeof window === 'undefined') return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = undefined;
      void this.autosave();
    }, 900);
  }

  async flushAutosave(): Promise<void> {
    if (this.autosaveTimer !== undefined) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
      await this.autosave();
    }
  }

  private makeThumbDataUrl(): string {
    if (typeof document === 'undefined') return '';
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const rendered = this.doc.render(true);
    if (rendered) {
      const s = Math.min(96 / this.doc.width, 96 / this.doc.height);
      const dw = Math.round(this.doc.width * s);
      const dh = Math.round(this.doc.height * s);
      ctx.drawImage(rendered, Math.floor((96 - dw) / 2), Math.floor((96 - dh) / 2), dw, dh);
    }
    return c.toDataURL('image/png');
  }

  async autosave() {
    try {
      const json = serializeBmeowProject(this.doc, this.docName);
      await kvSet(`proj.${this.docId}`, json);
      const list = ((await kvGet<ProjectMeta[]>(PROJECTS_INDEX_KEY)) ?? []).filter((p) => p.id !== this.docId);
      list.unshift({
        id: this.docId,
        name: this.docName,
        width: this.doc.width,
        height: this.doc.height,
        plotU: this.doc.plotU,
        plotV: this.doc.plotV,
        updatedAt: Date.now(),
        thumb: this.makeThumbDataUrl(),
      });
      this.projects = list.slice(0, 30);
      await kvSet(PROJECTS_INDEX_KEY, this.projects);
    } catch (e) {
      console.warn('autosave failed', e);
    }
  }

  async loadProjectIndex() {
    try {
      this.projects = (await kvGet<ProjectMeta[]>(PROJECTS_INDEX_KEY)) ?? [];
      if (this.projects.length > 0 && this.history.pushSeq === 0) {
        const id = this.projects[0].id;
        const json = await kvGet<string>(`proj.${id}`);
        if (json && this.history.pushSeq === 0) {
          const { doc, name } = await deserializeBmeowProject(json);
          if (this.history.pushSeq === 0) {
            this.setDocument(doc, name, id);
          }
        }
      }
    } catch { /* ignore */ }
  }

  async openSavedProject(id: string): Promise<boolean> {
    try {
      const json = await kvGet<string>(`proj.${id}`);
      if (!json) return false;
      const { doc, name } = await deserializeBmeowProject(json);
      this.setDocument(doc, name, id);
      return true;
    } catch (e) {
      console.warn('openSavedProject failed', e);
      return false;
    }
  }

  async deleteSavedProject(id: string) {
    await kvDel(`proj.${id}`);
    this.projects = this.projects.filter((p) => p.id !== id);
    await kvSet(PROJECTS_INDEX_KEY, this.projects);
  }
}
