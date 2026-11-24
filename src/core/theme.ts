// UI Theme system: Preset themes + Custom user-picked UI colors
import type { RGBA } from './color';
import { clamp, toHex } from './color';

export type ThemeId = 'meow' | 'dark' | 'sakura' | 'light' | 'mint' | 'retro' | 'custom';

export interface ThemeTokens {
  bg: string;
  panel: string;
  panelAlt: string;
  panelGlass: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  stageBg: string;
}

export interface ThemePreset {
  id: ThemeId;
  name: string;
  badge: string;
  tokens: ThemeTokens;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'dark',
    name: '暗夜黑 (默认)',
    badge: '🌑',
    tokens: {
      bg: '#1e1e22',
      panel: '#27272c',
      panelAlt: '#313138',
      panelGlass: 'rgba(39, 39, 44, 0.92)',
      border: '#3d3d46',
      text: '#ececf1',
      muted: '#9898a6',
      accent: '#3b82f6',
      accentHover: '#2563eb',
      accentSoft: 'rgba(59, 130, 246, 0.22)',
      stageBg: '#2a2a2e',
    },
  },
  {
    id: 'meow',
    name: '星彩猫猫紫',
    badge: '🐱',
    tokens: {
      bg: '#1c162b',
      panel: '#261e3a',
      panelAlt: '#33294d',
      panelGlass: 'rgba(38, 30, 58, 0.92)',
      border: '#483a6b',
      text: '#f5f0ff',
      muted: '#b5a6d4',
      accent: '#a855f7',
      accentHover: '#9333ea',
      accentSoft: 'rgba(168, 85, 247, 0.25)',
      stageBg: '#221b33',
    },
  },
  {
    id: 'sakura',
    name: '樱花甜粉 (浅色)',
    badge: '🌸',
    tokens: {
      bg: '#fff5f8',
      panel: '#ffeaf1',
      panelAlt: '#ffdbe7',
      panelGlass: 'rgba(255, 234, 241, 0.92)',
      border: '#f3bfd1',
      text: '#43192b',
      muted: '#8c536b',
      accent: '#ec4899',
      accentHover: '#db2777',
      accentSoft: 'rgba(236, 72, 153, 0.20)',
      stageBg: '#f5dce5',
    },
  },
  {
    id: 'light',
    name: '清爽浅色 (日间)',
    badge: '☀️',
    tokens: {
      bg: '#f1f3f6',
      panel: '#ffffff',
      panelAlt: '#e5e9f0',
      panelGlass: 'rgba(255, 255, 255, 0.92)',
      border: '#d0d7e2',
      text: '#1e293b',
      muted: '#64748b',
      accent: '#2563eb',
      accentHover: '#1d4ed8',
      accentSoft: 'rgba(37, 99, 235, 0.16)',
      stageBg: '#dfe3ea',
    },
  },
  {
    id: 'mint',
    name: '薄荷青森',
    badge: '🌿',
    tokens: {
      bg: '#132226',
      panel: '#1a2e34',
      panelAlt: '#243e46',
      panelGlass: 'rgba(26, 46, 52, 0.92)',
      border: '#31535e',
      text: '#e8fbf8',
      muted: '#8eb6b3',
      accent: '#14b8a6',
      accentHover: '#0d9488',
      accentSoft: 'rgba(20, 184, 166, 0.24)',
      stageBg: '#17292e',
    },
  },
  {
    id: 'retro',
    name: '复古像素灰',
    badge: '🕹️',
    tokens: {
      bg: '#353540',
      panel: '#434350',
      panelAlt: '#525262',
      panelGlass: 'rgba(67, 67, 80, 0.92)',
      border: '#646476',
      text: '#f4f4f6',
      muted: '#b8b8c8',
      accent: '#f59e0b',
      accentHover: '#d97706',
      accentSoft: 'rgba(245, 158, 11, 0.24)',
      stageBg: '#2b2b34',
    },
  },
];

function shiftRgb(c: RGBA, delta: number): string {
  return toHex({
    r: clamp(Math.round(c.r + delta), 0, 255),
    g: clamp(Math.round(c.g + delta), 0, 255),
    b: clamp(Math.round(c.b + delta), 0, 255),
  });
}

function mixRgb(a: RGBA, b: RGBA, t: number): string {
  return toHex({
    r: clamp(Math.round(a.r + (b.r - a.r) * t), 0, 255),
    g: clamp(Math.round(a.g + (b.g - a.g) * t), 0, 255),
    b: clamp(Math.round(a.b + (b.b - a.b) * t), 0, 255),
  });
}

export function buildCustomThemeTokens(panelCol: RGBA, accentCol: RGBA, stageCol: RGBA): ThemeTokens {
  const lum = (0.299 * panelCol.r + 0.587 * panelCol.g + 0.114 * panelCol.b) / 255;
  const isLight = lum > 0.56;
  const dir = isLight ? -1 : 1;

  const panel = toHex(panelCol);
  const bg = shiftRgb(panelCol, isLight ? 14 : -12);
  const panelAlt = shiftRgb(panelCol, dir * 16);
  const border = shiftRgb(panelCol, dir * 32);
  const textCol: RGBA = isLight ? { r: 28, g: 30, b: 38, a: 255 } : { r: 242, g: 242, b: 247, a: 255 };
  const text = toHex(textCol);
  const muted = mixRgb(panelCol, textCol, 0.62);
  const accent = toHex(accentCol);
  const accentHover = shiftRgb(accentCol, -18);

  return {
    bg,
    panel,
    panelAlt,
    panelGlass: `rgba(${panelCol.r}, ${panelCol.g}, ${panelCol.b}, 0.92)`,
    border,
    text,
    muted,
    accent,
    accentHover,
    accentSoft: `rgba(${accentCol.r}, ${accentCol.g}, ${accentCol.b}, 0.24)`,
    stageBg: toHex(stageCol),
  };
}

export function resolveThemeTokens(
  theme: ThemeId,
  customPanel: RGBA,
  customAccent: RGBA,
  customStage: RGBA,
): ThemeTokens {
  if (theme === 'custom') {
    return buildCustomThemeTokens(customPanel, customAccent, customStage);
  }
  const preset = THEME_PRESETS.find((p) => p.id === theme) ?? THEME_PRESETS[0];
  return preset.tokens;
}

export function applyThemeToDom(tokens: ThemeTokens) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--bg', tokens.bg);
  r.setProperty('--panel', tokens.panel);
  r.setProperty('--panel-alt', tokens.panelAlt);
  r.setProperty('--panel-glass', tokens.panelGlass);
  r.setProperty('--border', tokens.border);
  r.setProperty('--text', tokens.text);
  r.setProperty('--muted', tokens.muted);
  r.setProperty('--accent', tokens.accent);
  r.setProperty('--accent-hover', tokens.accentHover);
  r.setProperty('--accent-soft', tokens.accentSoft);
  r.setProperty('--stage-bg', tokens.stageBg);
}
