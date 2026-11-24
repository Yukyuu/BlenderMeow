// Tiny DOM helpers
import { createElement as lucide, type IconNode } from 'lucide';

type Props = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function icon(node: IconNode, size = 20): SVGElement {
  const el = lucide(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', '2');
  return el;
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2500);
}

export const openSheets: (() => void)[] = [];

export function openSheet(
  title: string,
  body: HTMLElement,
  opts: { onClose?: () => void; wide?: boolean; actions?: HTMLElement[]; closeOnBackdrop?: boolean } = {},
) {
  const close = () => {
    overlay.remove();
    opts.onClose?.();
  };
  const overlay = h(
    'div',
    {
      class: 'sheet-overlay',
      onpointerdown: (e: PointerEvent) => {
        if (e.target === overlay && opts.closeOnBackdrop !== false) close();
      },
    },
    h(
      'div',
      { class: `sheet${opts.wide ? ' wide' : ''}` },
      h('div', { class: 'sheet-head' }, h('span', { class: 'sheet-title' }, title), h('button', { class: 'sheet-close', title: '关闭', onclick: close }, '✕')),
      h('div', { class: 'sheet-body' }, body),
      opts.actions ? h('div', { class: 'sheet-actions' }, ...opts.actions) : null,
    ),
  );
  document.body.appendChild(overlay);
  openSheets.push(close);
  const origRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    origRemove();
    const i = openSheets.indexOf(close);
    if (i >= 0) openSheets.splice(i, 1);
  };
  return close;
}

export function prompt2(title: string, value: string): Promise<string | null> {
  return new Promise((res) => {
    const inp = h('input', { class: 'text-input', value, type: 'text' }) as HTMLInputElement;
    let done = false;
    const close = openSheet(title, h('div', {}, inp), {
      onClose: () => { if (!done) res(null); },
      actions: [
        h('button', { class: 'btn', onclick: () => close() }, '取消'),
        h('button', { class: 'btn primary', onclick: () => { done = true; res(inp.value); close(); } }, '确定'),
      ],
    });
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}

export function confirm2(title: string, msg: string): Promise<boolean> {
  return new Promise((res) => {
    let done = false;
    const close = openSheet(title, h('p', {}, msg), {
      onClose: () => { if (!done) res(false); },
      actions: [
        h('button', { class: 'btn', onclick: () => close() }, '取消'),
        h('button', { class: 'btn primary', onclick: () => { done = true; res(true); close(); } }, '确定'),
      ],
    });
  });
}

export function rangeRow(
  label: string,
  min: number,
  max: number,
  value: number,
  onInput: (v: number) => void,
  step = 1,
  hooks?: { onBegin?: () => void; onCommit?: (v: number) => void },
) {
  const num = h('input', { type: 'number', class: 'num', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  const rng = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  let sliding = false;
  rng.oninput = () => {
    if (!sliding) {
      sliding = true;
      hooks?.onBegin?.();
    }
    num.value = rng.value;
    onInput(+rng.value);
  };
  const finishSlide = () => {
    if (!sliding) return;
    sliding = false;
    hooks?.onCommit?.(+rng.value);
  };
  rng.onchange = finishSlide;
  rng.addEventListener('pointercancel', finishSlide);
  num.onchange = () => {
    const parsed = Number(num.value);
    const v = Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : 0));
    num.value = String(v);
    rng.value = String(v);
    hooks?.onBegin?.();
    onInput(v);
    hooks?.onCommit?.(v);
  };
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') num.blur();
  });
  const row = h('div', { class: 'range-row' }, h('span', { class: 'rl' }, label), rng, num);
  return { row, rng, num, set(v: number) { rng.value = String(v); num.value = String(Math.round(v * 100) / 100); } };
}

export function select<T extends string>(options: { id: T; label: string }[], value: T, onChange: (v: T) => void) {
  const s = h(
    'select',
    { class: 'select', onchange: () => onChange(s.value as T) },
    ...options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.label)),
  ) as HTMLSelectElement;
  return s;
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
  const cb = h('input', { type: 'checkbox', checked: value, onchange: () => onChange(cb.checked) }) as HTMLInputElement;
  return h('label', { class: 'toggle' }, cb, h('span', {}, label));
}
