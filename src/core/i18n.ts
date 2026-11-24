// Core i18n engine (zh-CN / en, extensible to additional locales)
import { EN_CORE_UI } from '../i18n/en_core_ui';
import { EN_EDITORS } from '../i18n/en_editors';
import { EN_TEXTURES_COLOR } from '../i18n/en_textures_color';
import { EN_SHORTCUTS_CHANGELOG } from '../i18n/en_shortcuts_changelog';
import { EN_PATTERNS, registerInnerTranslator } from '../i18n/en_patterns';

export type LocaleId = 'zh' | 'en';
export type LanguageSetting = 'auto' | LocaleId;

export interface LocaleOption {
  id: LanguageSetting;
  nativeLabel: string;
  zhLabel: string;
  enLabel: string;
}

export const SUPPORTED_LOCALES: LocaleOption[] = [
  { id: 'auto', nativeLabel: 'Auto', zhLabel: '跟随系统', enLabel: 'Follow System' },
  { id: 'zh', nativeLabel: '简体中文', zhLabel: '简体中文', enLabel: 'Chinese' },
  { id: 'en', nativeLabel: 'English', zhLabel: '英语', enLabel: 'English' },
];

const EN_DICT: Record<string, string> = {
  ...EN_CORE_UI,
  ...EN_EDITORS,
  ...EN_TEXTURES_COLOR,
  ...EN_SHORTCUTS_CHANGELOG,
};

const SETTINGS_STORAGE_KEY = 'buildermeow.settings.v1';

/**
 * Detect effective UI locale from browser/OS language tags.
 * Chinese (`zh*`) -> `'zh'`; English (`en*`) or any other/unknown language -> `'en'`.
 */
export function detectSystemLocale(langs?: readonly string[] | null): LocaleId {
  let list: readonly string[] = langs ?? [];
  if (!langs && typeof navigator !== 'undefined') {
    list = navigator.languages?.length
      ? navigator.languages
      : (navigator.language ? [navigator.language] : []);
  }
  const primary = String(list[0] ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (primary === 'zh' || primary.startsWith('zh-')) return 'zh';
  return 'en';
}

export function resolveLocale(setting: LanguageSetting, langs?: readonly string[] | null): LocaleId {
  if (setting === 'zh' || setting === 'en') return setting;
  return detectSystemLocale(langs);
}

function readInitialSetting(): LanguageSetting {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { language?: unknown };
        if (parsed.language === 'zh' || parsed.language === 'en' || parsed.language === 'auto') {
          return parsed.language;
        }
      }
    }
  } catch { /* ignore storage errors */ }
  return 'auto';
}

let currentSetting: LanguageSetting = readInitialSetting();
let activeLocale: LocaleId = resolveLocale(currentSetting);
const listeners = new Set<() => void>();

function syncDocumentLang() {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = activeLocale === 'zh' ? 'zh-CN' : 'en';
    document.title =
      activeLocale === 'en'
        ? 'Blender Meow · 2:1 Isometric 3D Pixel Studio'
        : 'Blender Meow · 伪3D等距像素建模工坊';
  }
}
syncDocumentLang();

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('languagechange', () => {
    if (currentSetting !== 'auto') return;
    const next = detectSystemLocale();
    if (next !== activeLocale) {
      activeLocale = next;
      syncDocumentLang();
      listeners.forEach((fn) => fn());
    }
  });
}

export function getLanguageSetting(): LanguageSetting {
  return currentSetting;
}

export function getLocale(): LocaleId {
  return activeLocale;
}

export function isEn(): boolean {
  return activeLocale === 'en';
}

export function setLanguageSetting(setting: LanguageSetting): boolean {
  const norm: LanguageSetting = setting === 'zh' || setting === 'en' ? setting : 'auto';
  const nextLocale = resolveLocale(norm);
  const changed = norm !== currentSetting || nextLocale !== activeLocale;
  currentSetting = norm;
  activeLocale = nextLocale;
  syncDocumentLang();
  if (changed) {
    listeners.forEach((fn) => fn());
  }
  return changed;
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function translateSingleLine(core: string): string {
  const exact = EN_DICT[core];
  if (exact !== undefined) return exact;

  // Preserve leading/trailing whitespace if trimmed version matches
  const trimMatch = core.match(/^(\s+)([\s\S]*?)(\s*)$/);
  if (trimMatch) {
    const inner = trimMatch[2];
    if (inner) {
      const trInner = translateSingleLine(inner);
      if (trInner !== inner) return `${trimMatch[1]}${trInner}${trimMatch[3]}`;
    }
  }

  for (let i = 0; i < EN_PATTERNS.length; i++) {
    const [re, fmt] = EN_PATTERNS[i];
    const m = core.match(re);
    if (m) {
      const out = fmt(m[0], ...m.slice(1));
      if (out !== core) return out;
    }
  }

  // Trailing shortcut hint: "操作名称 (Ctrl+Z)" or "操作名称 (Q / Shift+E)"
  const keyM = core.match(/^(.*?)(\s*\([^()\u4e00-\u9fff]+\))$/);
  if (keyM && keyM[1]) {
    const base = EN_DICT[keyM[1]];
    if (base !== undefined) return `${base}${keyM[2]}`;
  }

  // Common compound separators
  const dashIdx = core.indexOf(' — ');
  if (dashIdx > 0) {
    const a = core.slice(0, dashIdx);
    const b = core.slice(dashIdx + 3);
    const ta = translateSingleLine(a);
    const tb = translateSingleLine(b);
    if (ta !== a || tb !== b) return `${ta} — ${tb}`;
  }

  if (core.includes(' · ')) {
    const parts = core.split(' · ');
    const mapped = parts.map((p) => translateSingleLine(p));
    if (mapped.some((m, i) => m !== parts[i])) return mapped.join(' · ');
  }

  const cnColonIdx = core.indexOf('：');
  if (cnColonIdx > 0) {
    const head = core.slice(0, cnColonIdx);
    const rest = core.slice(cnColonIdx + 1);
    const th = EN_DICT[head];
    if (th !== undefined) {
      return rest ? `${th}: ${translateSingleLine(rest)}` : `${th}:`;
    }
  }

  const asciiColonIdx = core.indexOf(': ');
  if (asciiColonIdx > 0) {
    const head = core.slice(0, asciiColonIdx);
    const rest = core.slice(asciiColonIdx + 2);
    const th = EN_DICT[head];
    if (th !== undefined) {
      return `${th}: ${translateSingleLine(rest)}`;
    }
  }

  // Leading non-alphanumeric emoji/symbol prefix
  const iconM = core.match(/^([^\u4e00-\u9fffA-Za-z0-9]+)(.+?)(\s*)$/);
  if (iconM && EN_DICT[iconM[2]] !== undefined) {
    return `${iconM[1]}${EN_DICT[iconM[2]]}${iconM[3]}`;
  }

  return core;
}

export function tr(text: string): string {
  if (!text || activeLocale === 'zh') return text;

  const exact = EN_DICT[text];
  if (exact !== undefined) return exact;

  if (text.includes('\n')) {
    const lines = text.split('\n');
    const mapped = lines.map((line) => translateSingleLine(line));
    if (mapped.some((m, i) => m !== lines[i])) return mapped.join('\n');
    return text;
  }

  return translateSingleLine(text);
}

registerInnerTranslator(tr);

export function t(zh: string, en?: string): string {
  if (activeLocale === 'zh') return zh;
  return en ?? tr(zh);
}
