import { setIcon } from 'obsidian';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function iconEl(name: string, cls = 'pa-icon'): HTMLElement {
  const span = el('span', cls);
  setIcon(span, name);
  return span;
}

export function button(icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLButtonElement {
  const btn = el('button', 'clickable-icon pa-tool');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  btn.appendChild(iconEl(icon));
  btn.addEventListener('click', (evt) => {
    evt.preventDefault();
    onClick(evt);
  });
  return btn;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number): T & { cancel: () => void } {
  let timer: number | null = null;
  const wrapped = ((...args: Parameters<T>) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}
