/**
 * Drop-in `obsidian` stub for headless tests (aliased in via esbuild --alias).
 * Only the surface that Paper Atlas actually touches is implemented.
 */

export class TFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path = '') {
    this.path = path;
    const name = path.split('/').pop() || '';
    this.basename = name.replace(/\.[^.]+$/, '');
    this.extension = name.includes('.') ? (name.split('.').pop() as string) : '';
  }
}

export class ItemView {
  app: unknown;
  leaf: unknown;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf?: { app?: unknown }) {
    this.leaf = leaf;
    this.app = leaf?.app;
    this.containerEl = document.createElement('div');
    this.contentEl = document.createElement('div');
    this.containerEl.appendChild(this.contentEl);
  }

  registerDomEvent(): void {}
  registerEvent(): void {}
  addAction(): void {}
  async setState(): Promise<void> {}
  getState(): Record<string, unknown> {
    return {};
  }
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  constructor(app?: unknown, manifest?: unknown) {
    this.app = app;
    this.manifest = manifest;
  }
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: HTMLElement = document.createElement('div');
  constructor(app?: unknown, plugin?: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class Component {
  load(): void {}
  unload(): void {}
}

export class MarkdownRenderer {
  static async render(): Promise<void> {
    /* preview keeps the lightweight HTML already in place */
  }
}

export class Setting {
  constructor(_el?: unknown) {}
}

export class Menu {
  addItem(callback: (item: unknown) => void): this {
    const item = {
      setTitle: () => item,
      setIcon: () => item,
      onClick: () => item,
    };
    callback(item);
    return this;
  }

  addSeparator(): this {
    return this;
  }

  showAtMouseEvent(): void {}
}

export class Notice {
  constructor(_message?: string) {}
}

export class Modal {
  app: unknown;
  modalEl: HTMLElement = document.createElement('div');
  titleEl: HTMLElement = document.createElement('div');
  contentEl: HTMLElement = document.createElement('div');
  constructor(app?: unknown) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
}

const ICON_GLYPHS: Record<string, string> = {
  'layout-grid': '▦',
  maximize: '⤢',
  group: '▣',
  list: '☰',
  'panel-right': '▥',
  minus: '−',
  plus: '+',
  x: '×',
  network: '◈',
  trash: '🗑',
  palette: '🎨',
  'arrow-right': '→',
  pencil: '✎',
};

export function setIcon(el: HTMLElement, name: string): void {
  el.textContent = ICON_GLYPHS[name] || '•';
}

export const Platform = { isDesktop: true, isMobile: false };
