// Color utilities: RGB / HSV / HSL / HEX conversions
export interface RGBA { r: number; g: number; b: number; a: number } // r,g,b 0-255, a 0-255

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s * 100, max * 100];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100; v /= 100;
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function shadeColorHsv(base: RGBA, sFactor: number, vFactor: number): RGBA {
  const [h, s, v] = rgbToHsv(base.r, base.g, base.b);
  const ns = clamp(s * sFactor, 0, 100);
  const nv = clamp(v * vFactor, 0, 100);
  const [r, g, b] = hsvToRgb(h, ns, nv);
  return { r, g, b, a: base.a };
}

let cachedSoftHsvR = -1;
let cachedSoftHsvG = -1;
let cachedSoftHsvB = -1;
let cachedSoftH = 0;
let cachedSoftS = 0;
let cachedSoftV = 0;

/**
 * High-dynamic HSV shading with an exponential highlight shoulder so bright base colors
 * maintain smooth tonal separation even at wide contrast multipliers (up to 5.0).
 */
export function shadeColorSoftHsv(base: RGBA, sFactor: number, vFactor: number): RGBA {
  let h: number;
  let s: number;
  let v: number;
  if (base.r === cachedSoftHsvR && base.g === cachedSoftHsvG && base.b === cachedSoftHsvB) {
    h = cachedSoftH;
    s = cachedSoftS;
    v = cachedSoftV;
  } else {
    [h, s, v] = rgbToHsv(base.r, base.g, base.b);
    cachedSoftHsvR = base.r;
    cachedSoftHsvG = base.g;
    cachedSoftHsvB = base.b;
    cachedSoftH = h;
    cachedSoftS = s;
    cachedSoftV = v;
  }
  let nv: number;
  let ns: number;
  if (vFactor <= 1) {
    nv = clamp(v * vFactor, 0, 100);
    ns = clamp(s * sFactor, 0, 100);
  } else {
    const headroom = 100 - v;
    const desiredGain = v * (vFactor - 1);
    nv = headroom > 1e-4 ? 100 - headroom * Math.exp(-desiredGain / headroom) : 100;
    const overflow = Math.max(0, (v * vFactor - 100) / 80);
    ns = clamp(s * sFactor * Math.exp(-overflow * 0.55), 0, 100);
  }
  const [r, g, b] = hsvToRgb(h, ns, nv);
  return { r, g, b, a: base.a };
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const v = l + c / 2;
  const sv = v === 0 ? 0 : (2 * (v - l)) / v;
  return hsvToRgb(h, sv * 100, v * 100);
}

export function toHex(c: { r: number; g: number; b: number }): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

/** 8-digit RGBA hex code (#RRGGBBAA) */
export function toHex8(c: RGBA): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a)}`.toUpperCase();
}

export function parseHex(s: string): RGBA | null {
  s = s.trim().replace(/^(?:#|0x)/i, '');
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255,
    };
  }
  return null;
}

function parseRgbChannel(tok: string): number | null {
  const t = tok.trim();
  if (!t) return null;
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return clamp(Math.round((pct / 100) * 255), 0, 255);
  }
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return clamp(Math.round(v), 0, 255);
}

function parseAlphaToken(tok: string, isCssFunc: boolean): number | null {
  const t = tok.trim();
  if (!t) return null;
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1));
    if (!Number.isFinite(pct) || pct < 0) return null;
    return clamp(Math.round((pct / 100) * 255), 0, 255);
  }
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0) return null;
  if (isCssFunc) {
    if (t.includes('.') || v <= 1) return clamp(Math.round(v * 255), 0, 255);
    return clamp(Math.round(v), 0, 255);
  }
  if (t.includes('.') && v <= 1) return clamp(Math.round(v * 255), 0, 255);
  return clamp(Math.round(v), 0, 255);
}

/**
 * Parse HEX (#RGB, #RGBA, #RRGGBB, #RRGGBBAA), CSS rgb()/rgba() (comma or space/slash syntax),
 * or bare 3/4-component numeric tuples ("255, 128, 0, 200" / "255 128 0 0.5").
 */
export function parseColorCode(raw: string): { rgba: RGBA; hasAlpha: boolean } | null {
  const s = raw.trim();
  if (!s) return null;

  const hexClean = s.replace(/^(?:#|0x)/i, '');
  if (/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hexClean)) {
    const rgba = parseHex(hexClean);
    if (!rgba) return null;
    const hasAlpha = hexClean.length === 4 || hexClean.length === 8;
    return { rgba, hasAlpha };
  }

  const funcMatch = s.match(/^rgba?\(\s*(.+?)\s*\)$/i);
  if (funcMatch) {
    const parts = funcMatch[1].replace(/\s*\/\s*/g, ',').split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    if (r === null || g === null || b === null) return null;
    if (parts.length === 4) {
      const a = parseAlphaToken(parts[3], true);
      if (a === null) return null;
      return { rgba: { r, g, b, a }, hasAlpha: true };
    }
    return { rgba: { r, g, b, a: 255 }, hasAlpha: false };
  }

  const bareParts = s.replace(/\s*\/\s*/g, ',').split(/[\s,]+/).filter(Boolean);
  if (bareParts.length === 3 || bareParts.length === 4) {
    const r = parseRgbChannel(bareParts[0]);
    const g = parseRgbChannel(bareParts[1]);
    const b = parseRgbChannel(bareParts[2]);
    if (r === null || g === null || b === null) return null;
    if (bareParts.length === 4) {
      const a = parseAlphaToken(bareParts[3], false);
      if (a === null) return null;
      return { rgba: { r, g, b, a }, hasAlpha: true };
    }
    return { rgba: { r, g, b, a: 255 }, hasAlpha: false };
  }

  return null;
}

export function cssColor(c: RGBA): string {
  return `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;
}
