// Cross-platform KeyStroke codec: physical code matching, Mod abstraction, IME guards & readable labels
import type { KeyStroke } from './types';

export const MODIFIER_CODES = new Set<string>([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
]);

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const plat = (navigator.platform || navigator.userAgent || '').toLowerCase();
  return plat.includes('mac') || plat.includes('iphone') || plat.includes('ipad');
}

export function normalizeKeyStroke(ks: KeyStroke): KeyStroke {
  const out: KeyStroke = { code: ks.code };
  if (ks.mod) out.mod = true;
  if (ks.alt) out.alt = true;
  if (ks.shift) out.shift = true;
  return out;
}

export function cloneKeyStroke(ks: KeyStroke): KeyStroke {
  return normalizeKeyStroke(ks);
}

export function keyStrokesEqual(a: KeyStroke, b: KeyStroke): boolean {
  return (
    a.code === b.code &&
    Boolean(a.mod) === Boolean(b.mod) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift)
  );
}

/** Converts a KeyboardEvent into a KeyStroke, ignoring IME composition frames and bare modifier keys */
export function eventToKeyStroke(e: KeyboardEvent): KeyStroke | null {
  if (!e || e.isComposing || e.keyCode === 229) return null;
  const code = e.code;
  if (!code || MODIFIER_CODES.has(code)) return null;
  const ks: KeyStroke = { code };
  if (e.ctrlKey || e.metaKey) ks.mod = true;
  if (e.altKey) ks.alt = true;
  if (e.shiftKey) ks.shift = true;
  return ks;
}

export function serializeKeyStroke(ks: KeyStroke): string {
  const parts: string[] = [];
  if (ks.mod) parts.push('Mod');
  if (ks.alt) parts.push('Alt');
  if (ks.shift) parts.push('Shift');
  parts.push(ks.code);
  return parts.join('+');
}

export function parseKeyStroke(raw: string): KeyStroke | null {
  if (typeof raw !== 'string') return null;
  const tokens = raw
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  let mod = false;
  let alt = false;
  let shift = false;
  let code = '';
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === 'mod' || low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta') {
      mod = true;
    } else if (low === 'alt' || low === 'option') {
      alt = true;
    } else if (low === 'shift') {
      shift = true;
    } else {
      code = tok;
    }
  }
  if (!code || MODIFIER_CODES.has(code)) return null;
  const ks: KeyStroke = { code };
  if (mod) ks.mod = true;
  if (alt) ks.alt = true;
  if (shift) ks.shift = true;
  return ks;
}

const CODE_DISPLAY_MAP: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'NumEnter',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'Num+',
  NumpadSubtract: 'Num-',
  NumpadMultiply: 'Num*',
  NumpadDivide: 'Num/',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  Insert: 'Ins',
};

export function formatCodeLabel(code: string): string {
  if (CODE_DISPLAY_MAP[code]) return CODE_DISPLAY_MAP[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length === 7) return `Num${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

export function formatKeyStroke(ks: KeyStroke, mac = isMacPlatform()): string {
  const parts: string[] = [];
  if (ks.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (ks.alt) parts.push(mac ? '⌥' : 'Alt');
  if (ks.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(formatCodeLabel(ks.code));
  return parts.join('+');
}

const NON_TEXT_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'color',
  'file',
]);

/** Returns true when keyboard focus is inside a text input/textarea/select/contentEditable element */
export function isEditableElement(el: EventTarget | null): boolean {
  if (!el || typeof HTMLElement === 'undefined') return false;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}
