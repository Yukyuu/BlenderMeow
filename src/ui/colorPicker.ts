// Unified Pixel Meow Color Picker sheet: SV square, Hue bar, RGB / HSV / HSL sliders with < / > fine-tuning,
// HEX / RGBA code copy-paste, palettes (built-in + custom + import/export/.bmeow extract) & recent colors.
import type { App } from '../app';
import {
  type RGBA,
  clamp,
  hsvToRgb,
  hslToRgb,
  parseColorCode,
  parseHex,
  rgbToHsl,
  rgbToHsv,
  toHex,
  toHex8,
} from '../core/color';
import {
  BUILTIN_PALETTES,
  type Palette,
  extractColorsFromBmeowJson,
  loadUserPalettes,
  paletteToGpl,
  parsePaletteFile,
  saveUserPalettes,
} from '../core/palette';
import { isNative, pickFile, saveFile } from '../platform';
import { confirm2, h, openSheet, prompt2, select, toast } from './dom';

const CUR_PALETTE_KEY = 'blendermeow.curPalette';
const COLOR_MODE_KEY = 'blendermeow.colorMode';
const ALPHA_UNIT_KEY = 'blendermeow.alphaUnit';

function safeLsGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLsSet(key: string, val: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, val);
  } catch { /* ignore */ }
}

export class PaletteStore {
  user: Palette[] = loadUserPalettes();
  currentId: string;
  listeners: (() => void)[] = [];

  constructor() {
    const saved = safeLsGet(CUR_PALETTE_KEY);
    if (saved) {
      this.currentId = saved;
    } else if (this.user[0]?.colors.length === 0) {
      this.currentId = 'iso_arch32';
    } else {
      this.currentId = this.user[0]?.id ?? 'iso_arch32';
    }
  }

  get all(): Palette[] {
    return [...this.user, ...BUILTIN_PALETTES];
  }

  get current(): Palette {
    return this.all.find((p) => p.id === this.currentId) ?? this.all[0];
  }

  setCurrent(id: string) {
    this.currentId = id;
    safeLsSet(CUR_PALETTE_KEY, id);
    this.changed();
  }

  save() {
    saveUserPalettes(this.user);
    this.changed();
  }

  changed() {
    for (const l of this.listeners) l();
  }

  addColor(hex: string) {
    const u = hex.toUpperCase();
    let p = this.current;
    if (p.builtin) {
      p = this.user[0] ?? this.createPalette('我的色板');
      this.setCurrent(p.id);
    }
    if (!p.colors.includes(u)) p.colors.push(u);
    this.save();
  }

  createPalette(name: string, colors: string[] = []): Palette {
    const p: Palette = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, colors };
    this.user.push(p);
    this.save();
    return p;
  }
}

let sharedStore: PaletteStore | null = null;
export function getPaletteStore(): PaletteStore {
  if (!sharedStore) sharedStore = new PaletteStore();
  return sharedStore;
}

export interface ColorPickerTarget {
  title?: string;
  initialColor: RGBA;
  allowAlpha?: boolean; // default false for 3D model colors (enforces a = 255)
  onPreview?: (c: RGBA) => void;
  onCommit?: (c: RGBA) => void;
  onCancel?: (startColor: RGBA) => void;
}

export function openColorPicker(app: App, target: ColorPickerTarget, store: PaletteStore = getPaletteStore()) {
  const allowAlpha = !!target.allowAlpha;
  const start: RGBA = {
    r: clamp(Math.round(target.initialColor.r), 0, 255),
    g: clamp(Math.round(target.initialColor.g), 0, 255),
    b: clamp(Math.round(target.initialColor.b), 0, 255),
    a: allowAlpha ? clamp(Math.round(target.initialColor.a), 0, 255) : 255,
  };
  let cur: RGBA = { ...start };
  let dirty = false;
  let cancelled = false;

  const setTargetColor = (partial: Partial<RGBA>) => {
    const next: RGBA = {
      r: clamp(Math.round(partial.r ?? cur.r), 0, 255),
      g: clamp(Math.round(partial.g ?? cur.g), 0, 255),
      b: clamp(Math.round(partial.b ?? cur.b), 0, 255),
      a: allowAlpha ? clamp(Math.round(partial.a ?? cur.a), 0, 255) : 255,
    };
    if (next.r === cur.r && next.g === cur.g && next.b === cur.b && next.a === cur.a) return;
    cur = next;
    dirty = true;
    target.onPreview?.({ ...cur });
  };

  let [hh, ss, vv] = rgbToHsv(cur.r, cur.g, cur.b);
  let [hl, sl, ll] = rgbToHsl(cur.r, cur.g, cur.b);
  const syncHsvFromRgb = (r: number, g: number, b: number) => {
    const [nh, ns, nv] = rgbToHsv(r, g, b);
    if (ns > 0 && nv > 0) hh = nh;
    if (nv > 0) ss = ns;
    vv = nv;
  };
  const syncHslFromRgb = (r: number, g: number, b: number) => {
    const [nhl, nsl, nll] = rgbToHsl(r, g, b);
    if (nsl > 0 && nll > 0 && nll < 100) hl = nhl;
    if (nll > 0 && nll < 100) sl = nsl;
    ll = nll;
  };
  const savedMode = safeLsGet(COLOR_MODE_KEY);
  let mode: 'hsv' | 'rgb' | 'hsl' = savedMode === 'rgb' || savedMode === 'hsl' ? savedMode : 'hsv';

  // ---- SV square + hue bar ----
  const sv = h('canvas', { class: 'sv-canvas', width: 256, height: 256 }) as HTMLCanvasElement;
  const hue = h('canvas', { class: 'hue-canvas', width: 256, height: 24 }) as HTMLCanvasElement;
  const svCtx = sv.getContext('2d')!;
  const hueCtx = hue.getContext('2d')!;

  const drawHue = () => {
    const g = hueCtx.createLinearGradient(0, 0, 256, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    hueCtx.fillStyle = g;
    hueCtx.fillRect(0, 0, 256, 24);
    const x = (hh / 360) * 256;
    hueCtx.strokeStyle = '#fff';
    hueCtx.lineWidth = 3;
    hueCtx.strokeRect(x - 3, 1, 6, 22);
    hueCtx.strokeStyle = '#000';
    hueCtx.lineWidth = 1;
    hueCtx.strokeRect(x - 4, 0, 8, 24);
  };

  const drawSV = () => {
    const [r, g, b] = hsvToRgb(hh, 100, 100);
    svCtx.fillStyle = `rgb(${r},${g},${b})`;
    svCtx.fillRect(0, 0, 256, 256);
    const wg = svCtx.createLinearGradient(0, 0, 256, 0);
    wg.addColorStop(0, '#fff');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    svCtx.fillStyle = wg;
    svCtx.fillRect(0, 0, 256, 256);
    const bg = svCtx.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, '#000');
    svCtx.fillStyle = bg;
    svCtx.fillRect(0, 0, 256, 256);
    const x = (ss / 100) * 256;
    const y = (1 - vv / 100) * 256;
    svCtx.beginPath();
    svCtx.arc(x, y, 8, 0, Math.PI * 2);
    svCtx.strokeStyle = '#fff';
    svCtx.lineWidth = 3;
    svCtx.stroke();
    svCtx.beginPath();
    svCtx.arc(x, y, 9.5, 0, Math.PI * 2);
    svCtx.strokeStyle = '#000';
    svCtx.lineWidth = 1;
    svCtx.stroke();
  };

  const dragOn = (el: HTMLCanvasElement, fn: (fx: number, fy: number) => void) => {
    let activePointerId: number | null = null;
    const go = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      fn(
        clamp((e.clientX - r.left) / r.width, 0, 1),
        clamp((e.clientY - r.top) / r.height, 0, 1),
      );
    };
    const end = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = null;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
    };
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      activePointerId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      go(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (activePointerId === e.pointerId) go(e);
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', () => { activePointerId = null; });
  };

  const fromHsv = () => {
    const [r, g, b] = hsvToRgb(hh, ss, vv);
    syncHslFromRgb(r, g, b);
    setTargetColor({ r, g, b });
    refresh(false);
  };
  const fromHsl = () => {
    const [r, g, b] = hslToRgb(hl, sl, ll);
    syncHsvFromRgb(r, g, b);
    setTargetColor({ r, g, b });
    refresh(false);
  };
  const fromRgb = (r: number, g: number, b: number) => {
    syncHsvFromRgb(r, g, b);
    syncHslFromRgb(r, g, b);
    setTargetColor({ r, g, b });
    refresh(true);
  };

  dragOn(sv, (fx, fy) => {
    ss = fx * 100;
    vv = (1 - fy) * 100;
    fromHsv();
  });
  dragOn(hue, (fx) => {
    hh = fx * 360;
    fromHsv();
  });

  // ---- reusable < / > fine-tune step buttons with press-and-hold repeat ----
  let holdTimer = 0;
  let repeatTimer = 0;
  const clearStepRepeat = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = 0; }
  };
  const mkStepBtn = (dir: -1 | 1, title: string, onStep: (delta: number) => void): HTMLButtonElement => {
    const btn = h('button', {
      type: 'button',
      class: 'ch-step-btn',
      title,
      'aria-label': title,
    }, dir < 0 ? '<' : '>') as HTMLButtonElement;
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      clearStepRepeat();
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      onStep(dir);
      holdTimer = window.setTimeout(() => {
        repeatTimer = window.setInterval(() => {
          if (btn.disabled) { clearStepRepeat(); return; }
          onStep(dir);
        }, 65);
      }, 380);
    });
    btn.addEventListener('pointerup', clearStepRepeat);
    btn.addEventListener('pointercancel', clearStepRepeat);
    btn.addEventListener('lostpointercapture', clearStepRepeat);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!btn.disabled) onStep(dir);
      }
    });
    return btn;
  };

  // ---- slider channels ----
  const sliderBox = h('div', { class: 'channel-box' });
  const tabBtns = (['hsv', 'rgb', 'hsl'] as const).map((m) =>
    h('button', {
      type: 'button',
      class: 'tab',
      onclick: () => {
        mode = m;
        safeLsSet(COLOR_MODE_KEY, m);
        buildSliders();
        refresh(true);
      },
    }, m.toUpperCase()),
  );
  type Ch = {
    rng: HTMLInputElement;
    num: HTMLInputElement;
    decBtn: HTMLButtonElement;
    incBtn: HTMLButtonElement;
    max: number;
    get: () => number;
    grad: () => string;
  };
  let channels: Ch[] = [];
  const mkCh = (label: string, max: number, get: () => number, set: (v: number) => void, grad: () => string): Ch => {
    const rng = h('input', { type: 'range', min: '0', max: String(max), step: '1', class: 'ch-range' }) as HTMLInputElement;
    const num = h('input', { type: 'number', min: '0', max: String(max), class: 'num' }) as HTMLInputElement;
    rng.oninput = () => {
      num.value = rng.value;
      set(+rng.value);
    };
    num.onchange = () => {
      const parsed = Number(num.value);
      const v = clamp(Math.round(Number.isFinite(parsed) ? parsed : 0), 0, max);
      set(v);
    };
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') num.blur();
    });
    const stepBy = (delta: number) => {
      const next = clamp(Math.round(get()) + delta, 0, max);
      set(next);
    };
    const decBtn = mkStepBtn(-1, `${label} -1`, stepBy);
    const incBtn = mkStepBtn(1, `${label} +1`, stepBy);
    sliderBox.append(h('div', { class: 'range-row ch-row' }, h('span', { class: 'rl' }, label), decBtn, rng, incBtn, num));
    return { rng, num, decBtn, incBtn, max, get, grad };
  };

  const buildSliders = () => {
    sliderBox.innerHTML = '';
    tabBtns.forEach((b, i) => b.classList.toggle('active', (['hsv', 'rgb', 'hsl'] as const)[i] === mode));
    const c = () => cur;
    if (mode === 'rgb') {
      channels = [
        mkCh('R', 255, () => c().r, (v) => fromRgb(v, c().g, c().b), () => `linear-gradient(90deg, rgb(0,${c().g},${c().b}), rgb(255,${c().g},${c().b}))`),
        mkCh('G', 255, () => c().g, (v) => fromRgb(c().r, v, c().b), () => `linear-gradient(90deg, rgb(${c().r},0,${c().b}), rgb(${c().r},255,${c().b}))`),
        mkCh('B', 255, () => c().b, (v) => fromRgb(c().r, c().g, v), () => `linear-gradient(90deg, rgb(${c().r},${c().g},0), rgb(${c().r},${c().g},255))`),
      ];
    } else if (mode === 'hsv') {
      const gradHsv = (f: (t: number) => [number, number, number]) => () =>
        `linear-gradient(90deg, ${[0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map((t) => {
          const [r, g, b] = hsvToRgb(...f(t));
          return `rgb(${r},${g},${b})`;
        }).join(',')})`;
      channels = [
        mkCh('H', 360, () => hh, (v) => { hh = v; fromHsv(); }, gradHsv((t) => [t * 360, 100, 100])),
        mkCh('S', 100, () => ss, (v) => { ss = v; fromHsv(); }, gradHsv((t) => [hh, t * 100, vv])),
        mkCh('V', 100, () => vv, (v) => { vv = v; fromHsv(); }, gradHsv((t) => [hh, ss, t * 100])),
      ];
    } else {
      const gradHsl = (f: (t: number) => string) => () =>
        `linear-gradient(90deg, ${[0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map(f).join(',')})`;
      channels = [
        mkCh('H', 360, () => hl, (v) => { hl = v; fromHsl(); }, gradHsl((t) => `hsl(${t * 360},100%,50%)`)),
        mkCh('S', 100, () => sl, (v) => { sl = v; fromHsl(); }, gradHsl((t) => `hsl(${hl},${t * 100}%,${ll}%)`)),
        mkCh('L', 100, () => ll, (v) => { ll = v; fromHsl(); }, gradHsl((t) => `hsl(${hl},${sl}%,${t * 100}%)`)),
      ];
    }
  };

  // ---- Optional alpha section (only when target.allowAlpha === true) ----
  let alphaUnit: 'pct' | '256' = safeLsGet(ALPHA_UNIT_KEY) === '256' ? '256' : 'pct';
  const alphaLabel = h('span', { class: 'rl' }, alphaUnit === '256' ? 'A256' : 'A%');
  const alphaRng = h('input', { type: 'range', min: '0', max: '255', step: '1', class: 'ch-range alpha-range' }) as HTMLInputElement;
  const alphaNum = h('input', { type: 'number', min: '0', max: alphaUnit === '256' ? '255' : '100', class: 'num' }) as HTMLInputElement;
  const pctUnitBtn = h('button', { type: 'button', class: 'tab cp-alpha-unit-btn' }, '百分位 %') as HTMLButtonElement;
  const byteUnitBtn = h('button', { type: 'button', class: 'tab cp-alpha-unit-btn' }, '256分位') as HTMLButtonElement;
  const setAlphaUnit = (u: 'pct' | '256') => {
    alphaUnit = u;
    safeLsSet(ALPHA_UNIT_KEY, u);
    alphaLabel.textContent = u === '256' ? 'A256' : 'A%';
    alphaNum.max = u === '256' ? '255' : '100';
    refresh(true);
  };
  pctUnitBtn.onclick = () => setAlphaUnit('pct');
  byteUnitBtn.onclick = () => setAlphaUnit('256');

  const stepAlpha = (delta: number) => {
    if (alphaUnit === '256') {
      setTargetColor({ a: clamp(cur.a + delta, 0, 255) });
    } else {
      const curPct = Math.round((cur.a / 255) * 100);
      const nextPct = clamp(curPct + delta, 0, 100);
      setTargetColor({ a: Math.round((nextPct / 100) * 255) });
    }
    refresh(true);
  };
  const alphaDecBtn = mkStepBtn(-1, '不透明度 -1', stepAlpha);
  const alphaIncBtn = mkStepBtn(1, '不透明度 +1', stepAlpha);

  alphaRng.oninput = () => {
    setTargetColor({ a: clamp(Math.round(+alphaRng.value), 0, 255) });
    syncAlphaAndCodeReadout();
  };
  alphaNum.onchange = () => {
    const parsed = Number(alphaNum.value);
    const val = Number.isFinite(parsed) ? parsed : 0;
    if (alphaUnit === '256') {
      setTargetColor({ a: clamp(Math.round(val), 0, 255) });
    } else {
      const p = clamp(Math.round(val), 0, 100);
      setTargetColor({ a: Math.round((p / 100) * 255) });
    }
    refresh(true);
  };
  alphaNum.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') alphaNum.blur();
  });

  // ---- HEX / RGBA code input & copy ----
  const copyText = (text: string, label: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(`已复制 ${label}: ${text}`)).catch(() => toast(text));
    } else {
      toast(`${label}: ${text}`);
    }
  };
  const codeIn = h('input', {
    class: 'text-input hex-input mono',
    maxlength: 40,
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    placeholder: allowAlpha ? '#RRGGBBAA 或 rgba(r,g,b,a)' : '#RRGGBB 或 rgb(r,g,b)',
    title: allowAlpha
      ? '输入 8 位 RGBA (#RRGGBBAA)、6 位 HEX (#RRGGBB)、rgba(r,g,b,a) 或 r,g,b,a'
      : '支持粘贴 6/8 位 HEX (#RRGGBB / #RRGGBBAA)、rgb(r,g,b) 或 rgba(...)（模型色彩自动保持不透明）',
  }) as HTMLInputElement;
  codeIn.spellcheck = false;
  const copyCodeBtn = h('button', {
    type: 'button',
    class: 'btn small cp-copy-btn',
    title: allowAlpha ? '复制当前 8 位 RGBA 代码' : '复制当前 HEX 颜色代码',
    onclick: () => copyText(allowAlpha ? toHex8(cur) : toHex(cur), allowAlpha ? '8位RGBA' : 'HEX'),
  }, '复制');
  const rgbaSub = h('div', {
    class: 'cp-rgba-sub',
    title: allowAlpha ? '点击复制 rgba(r, g, b, a) 代码' : '点击复制 rgb(r, g, b) 代码',
    onclick: () => {
      if (allowAlpha) {
        copyText(`rgba(${cur.r}, ${cur.g}, ${cur.b}, ${+(cur.a / 255).toFixed(3)})`, 'RGBA');
      } else {
        copyText(`rgb(${cur.r}, ${cur.g}, ${cur.b})`, 'RGB');
      }
    },
  });
  const applyCodeInput = () => {
    const parsed = parseColorCode(codeIn.value);
    if (parsed) {
      if (allowAlpha && parsed.hasAlpha) setTargetColor({ a: parsed.rgba.a });
      fromRgb(parsed.rgba.r, parsed.rgba.g, parsed.rgba.b);
      buildPalettes();
    } else {
      toast('无效的颜色代码（支持 #RRGGBB、#RRGGBBAA、rgb(r,g,b)）');
      codeIn.value = allowAlpha ? toHex8(cur) : toHex(cur);
    }
  };
  codeIn.onchange = applyCodeInput;
  codeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      codeIn.blur();
    }
  });

  const swOld = h('div', {
    class: 'swatch-big',
    title: '原颜色 (点击恢复)',
    onclick: () => {
      setTargetColor(start);
      [hh, ss, vv] = rgbToHsv(start.r, start.g, start.b);
      [hl, sl, ll] = rgbToHsl(start.r, start.g, start.b);
      refresh(true);
      buildPalettes();
    },
  });
  const swNew = h('div', { class: 'swatch-big', title: '当前选择的新颜色' });
  swOld.style.setProperty('--c', `rgba(${start.r},${start.g},${start.b},${start.a / 255})`);

  const refreshSw = () => {
    const c = cur;
    swNew.style.setProperty('--c', `rgba(${c.r},${c.g},${c.b},${c.a / 255})`);
  };
  const syncAlphaAndCodeReadout = () => {
    const c = cur;
    if (allowAlpha) {
      const pct = Math.round((c.a / 255) * 100);
      pctUnitBtn.classList.toggle('active', alphaUnit === 'pct');
      byteUnitBtn.classList.toggle('active', alphaUnit === '256');
      alphaLabel.textContent = alphaUnit === '256' ? 'A256' : 'A%';
      alphaNum.max = alphaUnit === '256' ? '255' : '100';
      alphaRng.value = String(c.a);
      if (document.activeElement !== alphaNum) {
        alphaNum.value = String(alphaUnit === '256' ? c.a : pct);
      }
      alphaDecBtn.disabled = c.a <= 0;
      alphaIncBtn.disabled = c.a >= 255;
      rgbaSub.textContent = `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a}) · ${pct}%`;
    } else {
      rgbaSub.textContent = `rgb(${c.r}, ${c.g}, ${c.b})`;
    }
    if (document.activeElement !== codeIn) {
      codeIn.value = allowAlpha ? toHex8(c) : toHex(c);
    }
    refreshSw();
  };

  const refresh = (all: boolean) => {
    void all;
    drawSV();
    drawHue();
    const c = cur;
    for (const ch of channels) {
      const v = Math.round(ch.get());
      ch.rng.value = String(v);
      if (document.activeElement !== ch.num) {
        ch.num.value = String(v);
      }
      ch.rng.style.background = ch.grad();
      ch.decBtn.disabled = v <= 0;
      ch.incBtn.disabled = v >= ch.max;
    }
    if (allowAlpha) {
      alphaRng.style.background = `linear-gradient(90deg, rgba(${c.r},${c.g},${c.b},0), rgb(${c.r},${c.g},${c.b})), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/12px 12px`;
    }
    syncAlphaAndCodeReadout();
  };

  // ---- palettes ----
  const palWrap = h('div', { class: 'palette-section' });
  const buildPalettes = () => {
    palWrap.innerHTML = '';
    const p = store.current;
    const sel = select(
      store.all.map((x) => ({ id: x.id, label: (x.builtin ? '📦 ' : '🎨 ') + x.name })),
      p.id,
      (id) => {
        store.setCurrent(id);
        buildPalettes();
      },
    );
    const grid = h('div', { class: 'swatch-grid' });
    for (const c of p.colors) {
      const sw = h('button', {
        type: 'button',
        class: 'swatch' + (toHex(cur) === c.toUpperCase() ? ' sel' : ''),
        title: c,
        style: `--c:${c}`,
      });
      let timer = 0;
      let long = false;
      let downX = 0;
      let downY = 0;
      const cancelHold = () => {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
      };
      sw.addEventListener('pointerdown', (e) => {
        long = false;
        downX = e.clientX;
        downY = e.clientY;
        cancelHold();
        if (p.builtin) return;
        timer = window.setTimeout(async () => {
          timer = 0;
          long = true;
          if (await confirm2('删除颜色', `从「${p.name}」中删除 ${c} ?`)) {
            p.colors = p.colors.filter((x) => x !== c);
            store.save();
            buildPalettes();
          }
        }, 550);
      });
      sw.addEventListener('pointermove', (e) => {
        if (!timer) return;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) cancelHold();
      });
      sw.addEventListener('pointerup', cancelHold);
      sw.addEventListener('pointerleave', cancelHold);
      sw.addEventListener('pointercancel', cancelHold);
      sw.addEventListener('click', () => {
        if (long) return;
        const v = parseHex(c);
        if (!v) return;
        fromRgb(v.r, v.g, v.b);
        buildPalettes();
      });
      grid.append(sw);
    }
    grid.append(
      h('button', {
        type: 'button',
        class: 'swatch add',
        title: '添加当前颜色到色板',
        onclick: () => {
          store.addColor(toHex(cur));
          buildPalettes();
        },
      }, '+'),
    );

    const actions = h(
      'div',
      { class: 'btn-row' },
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: async () => {
          const n = await prompt2('新建色板', '新色板');
          if (n && n.trim()) {
            const np = store.createPalette(n.trim());
            store.setCurrent(np.id);
            buildPalettes();
          }
        },
      }, '新建'),
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: async () => {
          const n = await prompt2('另存为新色板', p.name + ' 副本');
          if (n && n.trim()) {
            const np = store.createPalette(n.trim(), [...p.colors]);
            store.setCurrent(np.id);
            buildPalettes();
          }
        },
      }, '另存'),
      !p.builtin && h('button', {
        type: 'button',
        class: 'btn small',
        onclick: async () => {
          const n = await prompt2('重命名色板', p.name);
          if (n && n.trim()) {
            p.name = n.trim();
            store.save();
            buildPalettes();
          }
        },
      }, '重命名'),
      !p.builtin && h('button', {
        type: 'button',
        class: 'btn small danger',
        onclick: async () => {
          if (await confirm2('删除色板', `确定删除「${p.name}」?`)) {
            store.user = store.user.filter((x) => x !== p);
            if (!store.user.length) store.user.push({ id: 'mine', name: '我的色板', colors: [] });
            store.setCurrent(store.user[0].id);
            store.save();
            buildPalettes();
          }
        },
      }, '删除'),
      h('button', {
        type: 'button',
        class: 'btn small',
        title: '导入 .gpl / .hex / .txt 色板或从 .bmeow 工程提取模型色彩',
        onclick: async () => {
          const f = await pickFile('.gpl,.hex,.txt,.bmeow,text/plain,application/json', 'document');
          if (!f) return;
          try {
            const text = await f.text();
            let cols: string[] = [];
            if (/\.bmeow$/i.test(f.name) || text.trimStart().startsWith('{')) {
              cols = extractColorsFromBmeowJson(text);
            }
            if (!cols.length && !/\.bmeow$/i.test(f.name)) {
              cols = parsePaletteFile(text);
            }
            if (!cols.length) {
              toast('未找到可用颜色');
              return;
            }
            const np = store.createPalette(f.name.replace(/\.[^.]+$/, '') || '导入色板', cols);
            store.setCurrent(np.id);
            buildPalettes();
            toast(`已导入 ${cols.length} 种颜色`);
          } catch (err) {
            console.error(err);
            toast('导入色板失败: ' + (err as Error).message);
          }
        },
      }, '导入'),
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: async () => {
          const msg = await saveFile(new Blob([paletteToGpl(p)], { type: 'text/plain' }), `${p.name}.gpl`, {
            folder: app.settings.exportPath,
            treeUri: app.settings.exportTreeUri,
            share: isNative(),
          });
          toast(msg);
        },
      }, '导出 .gpl'),
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          const data = app.doc.renderToBuffer(true);
          const set = new Set<string>();
          for (let i = 0; i < data.length && set.size < 256; i += 4) {
            if (data[i + 3] > 0) set.add(toHex({ r: data[i], g: data[i + 1], b: data[i + 2] }));
          }
          if (!set.size) {
            toast('模型画布为空');
            return;
          }
          const np = store.createPalette('模型画布色板', [...set]);
          store.setCurrent(np.id);
          buildPalettes();
          toast(`提取到 ${set.size} 种颜色`);
        },
      }, '从画布提取'),
    );

    const recent = h(
      'div',
      { class: 'swatch-row' },
      ...app.recentColors.map((c) =>
        h('button', {
          type: 'button',
          class: 'swatch small' + (toHex(cur) === c.toUpperCase() ? ' sel' : ''),
          style: `--c:${c}`,
          title: c,
          onclick: () => {
            const v = parseHex(c);
            if (!v) return;
            fromRgb(v.r, v.g, v.b);
            buildPalettes();
          },
        }),
      ),
    );
    palWrap.append(h('div', { class: 'pal-head' }, h('b', {}, '色板'), sel), grid, actions);
    if (app.recentColors.length) palWrap.append(h('div', { class: 'pal-head' }, h('b', {}, '最近使用')), recent);
  };

  buildSliders();
  const rightCol = h(
    'div',
    { class: 'cp-right' },
    h('div', { class: 'swatch-pair' }, swOld, swNew),
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, allowAlpha ? 'RGBA' : 'HEX'), codeIn, copyCodeBtn),
    rgbaSub,
    h('div', { class: 'tabs' }, ...tabBtns),
    sliderBox,
  );
  if (allowAlpha) {
    rightCol.append(
      h('div', { class: 'cp-alpha-head' },
        h('span', { class: 'cp-alpha-title' }, '不透明度'),
        h('div', { class: 'cp-alpha-unit-seg' }, pctUnitBtn, byteUnitBtn),
      ),
      h('div', { class: 'range-row ch-row' }, alphaLabel, alphaDecBtn, alphaRng, alphaIncBtn, alphaNum),
    );
  }

  const body = h(
    'div',
    { class: 'color-picker' },
    h(
      'div',
      { class: 'cp-top' },
      h('div', { class: 'cp-left' }, sv, hue),
      rightCol,
    ),
    palWrap,
  );

  refresh(true);
  buildPalettes();

  const close = openSheet(target.title ?? '选色器', body, {
    wide: true,
    onClose: () => {
      clearStepRepeat();
      const sameAsStart = cur.r === start.r && cur.g === start.g && cur.b === start.b && cur.a === start.a;
      if (cancelled || sameAsStart) {
        if (dirty) target.onCancel?.({ ...start });
        return;
      }
      app.rememberColor(toHex(cur));
      target.onCommit?.({ ...cur });
    },
    actions: [
      h('button', {
        type: 'button',
        class: 'btn',
        onclick: () => {
          cancelled = true;
          close();
        },
      }, '取消'),
      h('button', {
        type: 'button',
        class: 'btn primary',
        onclick: () => close(),
      }, '完成'),
    ],
  });
}
