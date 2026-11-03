/**
 * Renders a static preview of the atlas (real notes + real CSS) to /tmp/atlas-preview.html.
 * Screenshot: firefox --headless --screenshot /tmp/atlas.png --window-size=1600,1000 file:///tmp/atlas-preview.html
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { listFiles, listMarkdown, parseFrontmatter, readUtf8 } from './helpers';
import { normalizeSettings } from '../src/settings';

const VAULT = '/home/andew/Nutstore Files/我的坚果云/Obsidian';
const PAPERS_REL = '30_References/Paper/manager';
const PAPERS = join(VAULT, PAPERS_REL);
const PLUGIN_DIR = join(VAULT, '.obsidian/plugins/paper-atlas');

function installGlobals(win: Window): void {
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.HTMLElement = win.HTMLElement;
  g.HTMLInputElement = win.HTMLInputElement;
  g.HTMLTextAreaElement = win.HTMLTextAreaElement;
  g.HTMLButtonElement = win.HTMLButtonElement;
  g.HTMLSelectElement = win.HTMLSelectElement;
  g.HTMLImageElement = win.HTMLImageElement;
  g.Element = win.Element;
  g.Node = win.Node;
  g.SVGElement = win.SVGElement;
  g.Event = win.Event;
  g.MouseEvent = win.MouseEvent;
  g.KeyboardEvent = win.KeyboardEvent;
}

function installDomHelpers(win: Window): void {
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.empty = function empty(this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.addClass = function addClass(this: Element, ...names: string[]): void {
    this.classList.add(...names);
  };
  proto.removeClass = function removeClass(this: Element, ...names: string[]): void {
    this.classList.remove(...names);
  };
  proto.toggleClass = function toggleClass(this: Element, name: string, value?: boolean): void {
    if (value === undefined) this.classList.toggle(name);
    else this.classList.toggle(name, value);
  };
  proto.setText = function setText(this: Element, text: string): void {
    this.textContent = text;
  };
  proto.createDiv = function createDiv(this: Element, options?: { cls?: string; text?: string }): HTMLElement {
    const node = document.createElement('div');
    if (options?.cls) node.className = options.cls;
    if (options?.text) node.textContent = options.text;
    this.appendChild(node);
    return node;
  };
}

async function main(): Promise<void> {
  const win = new Window({ url: 'https://localhost/' });
  installGlobals(win);
  installDomHelpers(win);

  const { AtlasView } = await import('../src/view/AtlasView');
  const { TFile } = await import('obsidian');

  const markdownFiles = listMarkdown(PAPERS).map((full) => new TFile(full.slice(VAULT.length + 1)));
  const contents = new Map<string, string>();
  const frontmatters = new Map<string, Record<string, unknown>>();
  for (const file of markdownFiles) {
    const text = readUtf8(join(VAULT, file.path));
    contents.set(file.path, text);
    frontmatters.set(file.path, parseFrontmatter(text));
  }

  const imageIndex = new Map<string, string>();
  for (const root of ['80_Attachments', join(PAPERS_REL, 'AI论文图片')]) {
    const absolute = join(VAULT, root);
    if (!existsSync(absolute)) continue;
    for (const full of listFiles(absolute)) {
      const relative = full.slice(VAULT.length + 1);
      const name = relative.split('/').pop() as string;
      if (!imageIndex.has(name)) imageIndex.set(name, relative);
    }
  }

  const resolveLink = (link: string): string | null => {
    const clean = (link.split('#')[0] || '').trim();
    if (!clean) return null;
    if (clean.includes('/')) return existsSync(join(VAULT, clean)) ? clean : null;
    return imageIndex.get(clean) || null;
  };

  const app = {
    vault: {
      configDir: '.obsidian',
      getMarkdownFiles: () => markdownFiles,
      cachedRead: async (file: { path: string }) => contents.get(file.path) || '',
      getAbstractFileByPath: () => null,
      createFolder: async () => undefined,
      create: async (path: string) => new TFile(path),
      modify: async () => undefined,
      adapter: {
        exists: async (path: string) => existsSync(join(VAULT, path)),
        read: async (path: string) => readUtf8(join(VAULT, path)),
        write: async () => undefined,
        getResourcePath: (path: string) => `app://local/${encodeURI(path)}`,
      },
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => ({ frontmatter: frontmatters.get(file.path) }),
      getFirstLinkpathDest: (link: string) => {
        const resolved = resolveLink(link);
        return resolved ? new TFile(resolved) : null;
      },
    },
    workspace: {
      getLeaf: () => ({ openFile: async () => undefined }),
      openLinkText: async () => undefined,
    },
  };

  const settings = normalizeSettings({ boardPath: `${PAPERS_REL}/论文图谱.pcanvas` });
  const view = new AtlasView({ app } as never, {
    settings,
    saveSettings: async () => undefined,
    getAtlasView: () => view,
  } as never);

  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  const internal = view as unknown as {
    index: { all: Array<{ path: string; title: string; understandingSource: string; images: unknown[]; primaryField: string }> };
    board: { nodes: unknown[]; edges: unknown[]; viewport: { x: number; y: number; z: number } };
    viewport: { x: number; y: number; z: number };
    edgeSelection: string | null;
    refreshSelection(): void;
    renderAll(): void;
  };

  const all = internal.index.all;
  const pick = (predicate: (paper: (typeof all)[number]) => boolean) => all.find(predicate);

  const chosen = [
    pick((paper) => paper.understandingSource === 'heading'),
    pick((paper) => paper.title.startsWith('GMT')),
    pick((paper) => paper.title.startsWith('BeyondMimic')),
    pick((paper) => paper.images.length > 0 && paper.primaryField === 'Locomotion'),
    pick((paper) => paper.images.length > 0 && paper.primaryField === 'Learning Methods'),
  ].filter((paper): paper is (typeof all)[number] => Boolean(paper));

  const width = 380;
  const height = 470;
  const nodes = chosen.map((paper, index) => ({
    id: `n${index}`,
    paper: paper.path,
    x: (index % 2) * (width + 42),
    y: Math.floor(index / 2) * (height + 42),
    w: width,
    h: height,
  }));

  internal.board.nodes = nodes;
  internal.board.edges = [
    { id: 'e1', from: 'n0', to: 'n1', label: '对比' },
    { id: 'e2', from: 'n1', to: 'n2', label: '改进', color: '#2f9e44' },
    { id: 'e3', from: 'n0', to: 'n3' },
  ];
  const css = readFileSync(join(PLUGIN_DIR, 'styles.css'), 'utf8');
  const fileBase = `file://${encodeURI(VAULT)}/`;
  const outDir = join(PLUGIN_DIR, '.preview-tmp');

  const writePreview = (name: string, z: number, x: number, y: number): void => {
    internal.viewport = { x, y, z };
    internal.renderAll();
    const body = view.contentEl.innerHTML.replace(/app:\/\/local\//g, fileBase);
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  :root {
    --background-primary: #ffffff;
    --background-primary-alt: #f6f7f9;
    --background-secondary: #f1f2f5;
    --background-secondary-alt: #e9ebef;
    --background-modifier-border: #dfe2e8;
    --background-modifier-hover: #eceef3;
    --background-modifier-form-field: #ffffff;
    --text-normal: #23252b;
    --text-muted: #5b6170;
    --text-faint: #939aa7;
    --text-error: #e03131;
    --text-on-accent: #ffffff;
    --interactive-accent: #4c6ef5;
    --font-interface: -apple-system, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    --font-text: -apple-system, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-family: var(--font-interface);
  }
  .pa-view { height: 100%; }
</style>
<style>${css}</style>
</head><body><div class="pa-view">${body}</div></body></html>`;
    writeFileSync(join(outDir, name), html);
  };

  const firstEdge = internal.board.edges[0] as unknown as { id: string };
  internal.edgeSelection = firstEdge.id;
  internal.refreshSelection();
  writePreview('preview-near.html', 0.82, 40, 70);
  internal.edgeSelection = null;
  internal.refreshSelection();
  writePreview('preview-mid.html', 0.42, 90, 150);
  writePreview('preview-far.html', 0.18, 160, 260);

  // dark-theme variant of the close-up (Obsidian default dark palette)
  const darkVars = `:root {
    --background-primary: #202020;
    --background-primary-alt: #1a1a1a;
    --background-secondary: #262626;
    --background-secondary-alt: #2c2c2c;
    --background-modifier-border: #3a3a3a;
    --background-modifier-hover: #2f2f2f;
    --background-modifier-form-field: #262626;
    --text-normal: #dadada;
    --text-muted: #a0a0a0;
    --text-faint: #6f6f6f;
    --text-error: #e05252;
    --text-on-accent: #ffffff;
    --interactive-accent: #7c8cf8;
    --font-interface: -apple-system, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    --font-text: -apple-system, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-family: var(--font-interface);
  }
  html, body { background: #1a1a1a; }`;
  for (const name of ['near', 'mid', 'far']) {
    const light = readFileSync(join(outDir, `preview-${name}.html`), 'utf8');
    writeFileSync(join(outDir, `preview-${name}-dark.html`), light.replace(/:root \{[\s\S]*?\n  \}/, darkVars));
  }

  // cover picker, rendered in a modal-sized shell
  const coverPaper = all.find((paper) => paper.images.length >= 4);
  if (coverPaper) {
    const { CoverPickerModal } = await import('../src/view/modals');
    const usable = coverPaper.images.filter((image) => image.path);
    const modal = new CoverPickerModal(
      app as never,
      coverPaper.images,
      usable[0]?.path ?? null,
      (path) => `app://local/${encodeURI(path)}`,
      () => undefined,
    );
    (modal as unknown as { onOpen(): void }).onOpen();
    const modalBody = modal.contentEl.innerHTML.replace(/app:\/\/local\//g, fileBase);
    const coverHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; background: #1a1a1a; }
  body { display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px; box-sizing: border-box; }
  ${darkVars}
  .preview-modal { width: 720px; max-width: 92vw; padding: 18px 22px 16px; border: 1px solid var(--background-modifier-border); border-radius: 12px; background: var(--background-primary); box-shadow: 0 18px 50px rgb(0 0 0 / 45%); }
  .preview-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font-size: 17px; font-weight: 650; color: var(--text-normal); }
  .preview-modal-close { color: var(--text-faint); font-size: 18px; }
</style>
<style>${css}</style>
</head><body><div class="preview-modal"><div class="preview-modal-head"><span>选择封面图</span><span class="preview-modal-close">×</span></div>${modalBody}</div></body></html>`;
    writeFileSync(join(outDir, 'preview-cover.html'), coverHtml);
  }

  console.log('previews written, cards:', nodes.length);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
