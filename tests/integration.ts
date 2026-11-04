/**
 * Headless integration test: boots AtlasView against the real paper notes with a
 * fake Obsidian app + happy-dom. Build & run:
 *   npx esbuild tests/integration.ts --bundle --platform=node --format=cjs \
 *     --alias:obsidian=./tests/obsidian-stub.ts --outfile=/tmp/pa-integration.cjs
 *   node /tmp/pa-integration.cjs
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { listFiles, listMarkdown, parseFrontmatter, readUtf8 } from './helpers';
import { normalizeSettings } from '../src/settings';

const VAULT = '/home/andew/Nutstore Files/我的坚果云/Obsidian';
const PAPERS_REL = '30_References/Paper/manager';
const PAPERS = join(VAULT, PAPERS_REL);

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

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
  g.DOMParser = win.DOMParser;
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
  proto.createEl = function createEl(this: Element, tag: string, options?: { cls?: string; text?: string }): HTMLElement {
    const node = document.createElement(tag);
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

  // ── fake vault ─────────────────────────────────────────
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

  const written: Array<{ path: string; data: string }> = [];
  const boardFiles = new Map<string, string>();
  const app = {
    vault: {
      configDir: '.obsidian',
      getMarkdownFiles: () => markdownFiles,
      cachedRead: async (file: { path: string }) => contents.get(file.path) || '',
      getAbstractFileByPath: (path: string) => markdownFiles.find((file) => file.path === path) || null,
      createFolder: async () => undefined,
      create: async (path: string, data: string) => {
        written.push({ path, data });
        return new TFile(path);
      },
      modify: async (file: { path: string }, data: string) => {
        written.push({ path: file.path, data });
      },
      adapter: {
        exists: async (path: string) => boardFiles.has(path) || existsSync(join(VAULT, path)),
        read: async (path: string) => boardFiles.get(path) ?? readUtf8(join(VAULT, path)),
        write: async (path: string, data: string) => {
          boardFiles.set(path, data);
          written.push({ path, data });
        },
        rename: async (from: string, to: string) => {
          const data = boardFiles.get(from);
          if (data == null) return;
          boardFiles.delete(from);
          boardFiles.set(to, data);
          written.push({ path: to, data });
        },
        remove: async (path: string) => {
          boardFiles.delete(path);
        },
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

  // isolated board path so the test never reads or overwrites the user's real canvas
  const settings = normalizeSettings({ boardPath: `${PAPERS_REL}/__paper-atlas-test__.pcanvas` });
  const plugin = {
    settings,
    saveSettings: async () => undefined,
    getAtlasView: () => view,
  } as never;

  console.log('\n[1] 启动视图');
  const view = new AtlasView({ app } as never, plugin);
  await (view as unknown as { onOpen(): Promise<void> }).onOpen();

  const root = view.contentEl.querySelector('.pa-root') as HTMLElement | null;
  const internal = view as unknown as {
    board: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
      years: Array<{ id: string; year: number; y: number }>;
    };
    snapshot(): string;
    viewport: { x: number; y: number; z: number };
    selection: Set<string>;
    edgeSelection: string | null;
    palette: Record<string, { bg: string; border: string }>;
    searchQuery: string;
    applyTransform(): void;
    renderSidebarList(): void;
    renderEdges(): void;
    createEdge(a: string, b: string, fromSide?: string, toSide?: string): void;
    refreshSelection(): void;
    cycleEdgeArrow(): void;
    startEdit(id: string, field: string): void;
    applyEdit(id: string, field: string, value: string): void;
    resetNode(id: string): void;
    deleteSelection(): void;
    undo(): void;
    saveNow(): Promise<void>;
    addPaperAt(path: string, x: number, y: number): void;
  };

  check('画布根节点存在', Boolean(root));
  check('论文仓渲染了 91 条', view.contentEl.querySelectorAll('.pa-item').length === 91,
    String(view.contentEl.querySelectorAll('.pa-item').length));
  check('领域筛选有 10 个选项', view.contentEl.querySelectorAll('.pa-field-filter option, .pa-select option').length >= 10);
  check('空画布提示可见', view.contentEl.querySelector('.pa-empty')?.classList.contains('is-hidden') === false);
  const yearLineCount = view.contentEl.querySelectorAll('.pa-year-line').length;
  const currentYear = new Date().getFullYear();
  check('年份横线覆盖 2015..今年', yearLineCount === currentYear - 2015 + 1,
    `${yearLineCount} / ${currentYear - 2015 + 1}`);
  check('最上面一条是今年', (view.contentEl.querySelector('.pa-year-band-label')?.textContent || '').includes(String(currentYear)));
  check('年份写在横线之间的左上角', view.contentEl.querySelectorAll('.pa-year-band-label').length === yearLineCount,
    String(view.contentEl.querySelectorAll('.pa-year-band-label').length));
  check('年份选择器包含全部年份 + 各年',
    view.contentEl.querySelectorAll('.pa-year-select option').length === yearLineCount + 1,
    String(view.contentEl.querySelectorAll('.pa-year-select option').length));
  const seeded = JSON.parse(internal.snapshot()) as { years?: unknown[] };
  check('撤销快照包含年份线', Array.isArray(seeded.years) && seeded.years.length === yearLineCount);

  // happy-dom 的 getBoundingClientRect 恒为 0，给聚焦逻辑一个真实尺寸
  const stageEl = view.contentEl.querySelector('.pa-stage') as HTMLElement | null;
  if (stageEl) {
    stageEl.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) }) as DOMRect;
  }

  const yearSelect = view.contentEl.querySelector('.pa-year-select') as HTMLSelectElement | null;
  if (yearSelect) {
    const beforeView = { ...internal.viewport };
    yearSelect.value = yearSelect.options[1]?.value ?? '';
    yearSelect.dispatchEvent(new Event('change'));
    check('选择年份后聚焦到该年',
      internal.viewport.x !== beforeView.x || internal.viewport.y !== beforeView.y || internal.viewport.z !== beforeView.z,
      `${JSON.stringify(beforeView)} -> ${JSON.stringify(internal.viewport)}`);
  } else {
    check('找到年份选择器', false);
  }

  const wholeBody = internal.palette['Whole-body Motion'];
  internal.searchQuery = 'zzzz-not-found';
  internal.renderSidebarList();
  check('搜索无结果时显示空列表', Boolean(view.contentEl.querySelector('.pa-list-empty')));
  internal.searchQuery = '';
  internal.renderSidebarList();
  check('清空搜索后恢复 91 条', view.contentEl.querySelectorAll('.pa-item').length === 91);

  check('继承了论文管理器的领域底色', wholeBody?.bg === '#38d9a9', JSON.stringify(wholeBody));
  check('主色由底色推导而不是照抄红色边框', Boolean(wholeBody) && wholeBody.border !== '#e53935' && wholeBody.border !== '#38d9a9',
    JSON.stringify(wholeBody));

  console.log('\n[2] 一键铺开 + 卡片渲染');
  view.spreadAllPapers();
  const nodes = internal.board.nodes;
  const nodeEls = view.contentEl.querySelectorAll('.pa-node');
  check('画布生成 91 张卡片', nodes.length === 91, String(nodes.length));
  check('DOM 里也是 91 张', nodeEls.length === 91, String(nodeEls.length));
  const frames = Array.from(view.contentEl.querySelectorAll('.pa-group'));
  check('领域外壳回来了', frames.length >= 9, String(frames.length));
  check('外壳只有颜色、没有大字标签', frames.every((frame) => (frame.textContent || '').trim() === ''));
  check('每张卡都有主领域胶囊', view.contentEl.querySelectorAll('.pa-node .pa-field-pill').length === 91,
    String(view.contentEl.querySelectorAll('.pa-node .pa-field-pill').length));
  check('主领域胶囊有文字', (view.contentEl.querySelector('.pa-node .pa-field-pill')?.textContent || '').length > 0);
  check('空状态已隐藏', view.contentEl.querySelector('.pa-empty')?.classList.contains('is-hidden') === true);
  check('每张卡都有标题', view.contentEl.querySelectorAll('.pa-node .pa-title').length === 91);
  check('机构统一显示未标注', view.contentEl.querySelectorAll('.pa-node .pa-inst.is-empty').length === 91,
    String(view.contentEl.querySelectorAll('.pa-node .pa-inst.is-empty').length));
  const covers = view.contentEl.querySelectorAll('.pa-node .pa-cover-img').length;
  check('封面图渲染（约 37 张）', covers >= 30 && covers <= 45, String(covers));
  check('所有卡片坐标有效', nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  check('每张卡都有四个连接点', view.contentEl.querySelectorAll('.pa-node .pa-port').length === 91 * 4,
    String(view.contentEl.querySelectorAll('.pa-node .pa-port').length));

  console.log('\n[3] 保存画布');
  await internal.saveNow();
  const saved = written.filter((item) => item.path === settings.boardPath).pop();
  check('写入了 .pcanvas 文件', Boolean(saved));
  if (saved) {
    const parsed = JSON.parse(saved.data) as { nodes: unknown[]; edges: unknown[]; viewport: unknown };
    check('保存了 91 个节点', parsed.nodes.length === 91, String(parsed.nodes.length));
    check('保存了视口', Boolean(parsed.viewport));
  }

  await internal.saveNow();
  check('再次保存会留下 .bak 备份', written.some((item) => item.path.endsWith('.bak')));

  console.log('\n[4] 连线与编辑');
  const first = nodes[0] as unknown as { id: string; paper: string; overrides?: Record<string, unknown> };
  const second = nodes[1] as unknown as { id: string };
  internal.createEdge(first.id, second.id, 'right', 'left');
  check('连线写入数据', internal.board.edges.length === 1);
  check('连线记住了两端锚点', (internal.board.edges[0] as unknown as { fromSide?: string }).fromSide === 'right');

  const edgeId = (internal.board.edges[0] as unknown as { id: string }).id;
  internal.edgeSelection = edgeId;
  internal.refreshSelection();
  const edgeToolbar = view.contentEl.querySelector('.pa-edge-toolbar') as HTMLElement | null;
  check('选中连线浮出工具栏', Boolean(edgeToolbar) && !edgeToolbar?.classList.contains('is-hidden'));
  internal.cycleEdgeArrow();
  check('箭头方向可切换', (internal.board.edges[0] as unknown as { arrow?: string }).arrow === 'both');
  check('连线渲染到 SVG', view.contentEl.querySelectorAll('.pa-edge').length === 1,
    String(view.contentEl.querySelectorAll('.pa-edge').length));
  (internal.board.edges[0] as unknown as { label?: string }).label = '改进';
  internal.renderEdges();
  check('连线标签渲染', view.contentEl.querySelector('.pa-edge-label')?.textContent === '改进');

  const heightNode = nodes[2] as unknown as { id: string; h: number; expanded?: boolean };
  const beforeH = heightNode.h;
  const beforeExpanded = heightNode.expanded;
  internal.startEdit(heightNode.id, 'understanding');
  check('编辑理解不会撑高卡片', heightNode.h === beforeH && heightNode.expanded === beforeExpanded,
    `${beforeH} -> ${heightNode.h}`);

  internal.applyEdit(first.id, 'title', '我的自定义标题');
  check('覆盖值写入节点', first.overrides?.title === '我的自定义标题');
  const editedTitle = view.contentEl
    .querySelector(`.pa-node[data-id="${first.id}"] .pa-title`)
    ?.textContent;
  check('卡片立刻显示新标题', editedTitle === '我的自定义标题', String(editedTitle));

  internal.resetNode(first.id);
  check('恢复后覆盖值被清除', first.overrides === undefined);
  const restored = view.contentEl.querySelector(`.pa-node[data-id="${first.id}"] .pa-title`)?.textContent || '';
  check('恢复为笔记标题', restored.length > 0 && restored !== '我的自定义标题', restored);

  console.log('\n[4b] 封面选择器');
  const coverPaper = (internal.index.all as Array<{ images: Array<{ path: string; link: string }> }>).find(
    (paper) => paper.images.filter((image) => image.path).length >= 3,
  );
  if (coverPaper) {
    const usable = coverPaper.images.filter((image) => image.path);
    let picked: string | null | undefined;
    const { CoverPickerModal } = await import('../src/view/modals');
    const modal = new CoverPickerModal(
      app as never,
      coverPaper.images,
      usable[0]?.path ?? null,
      (path) => `app://local/${path}`,
      (path) => {
        picked = path;
      },
    );
    (modal as unknown as { onOpen(): void }).onOpen();
    check('弹窗锁定了宽度', modal.modalEl.style.width.includes('720'), modal.modalEl.style.width);
    check('封面格子数量正确', modal.contentEl.querySelectorAll('.pa-cover-cell').length === usable.length,
      `${modal.contentEl.querySelectorAll('.pa-cover-cell').length}/${usable.length}`);
    check('当前封面有标记', Boolean(modal.contentEl.querySelector('.pa-cover-cell.is-current')));
    const firstCell = modal.contentEl.querySelector('.pa-cover-cell') as HTMLElement;
    firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('点击封面回传路径', picked === usable[0]?.path, String(picked));
  } else {
    check('找到带多张图的论文', false);
  }

  console.log('\n[5] 删除与撤销');
  internal.edgeSelection = null;
  internal.refreshSelection();
  internal.selection.add(first.id);
  internal.deleteSelection();
  check('删除后剩 90 张', internal.board.nodes.length === 90, String(internal.board.nodes.length));
  check('删掉的论文回到论文仓', view.contentEl.querySelectorAll('.pa-item').length === 1,
    String(view.contentEl.querySelectorAll('.pa-item').length));
  check('相连的线一并删除', internal.board.edges.length === 0);
  check('DOM 同步删除', view.contentEl.querySelectorAll('.pa-node').length === 90);
  internal.undo();
  check('撤销后恢复 91 张', internal.board.nodes.length === 91, String(internal.board.nodes.length));
  check('撤销后连线恢复', internal.board.edges.length === 1);

  console.log('\n[6] 语义缩放与筛选');
  internal.viewport.z = 0.2;
  internal.applyTransform();
  check('缩到 20% 进入色块模式', root?.dataset.zoom === 'far', root?.dataset.zoom);
  internal.viewport.z = 0.4;
  internal.applyTransform();
  check('缩到 40% 仍是完整卡片', root?.dataset.zoom === 'near', root?.dataset.zoom);
  internal.viewport.z = 1;
  internal.applyTransform();
  check('100% 显示完整卡片', root?.dataset.zoom === 'near', root?.dataset.zoom);

  check('全部在画布上时论文仓为空', view.contentEl.querySelectorAll('.pa-item').length === 0,
    String(view.contentEl.querySelectorAll('.pa-item').length));

  console.log('\n[7] 重复拖入保护');
  internal.addPaperAt(first.paper, 0, 0);
  check('同一篇论文不会重复加卡', internal.board.nodes.length === 91, String(internal.board.nodes.length));

  console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
