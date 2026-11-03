import { ItemView, Menu, Notice, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import type PaperAtlasPlugin from '../main';
import type { AtlasEdge, AtlasNode, EdgeArrow, EdgeSide, EditableField, PaperEntry } from '../types';
import { MIN_CARD_HEIGHT, MIN_CARD_WIDTH, STATUS_LABEL } from '../types';
import { emptyBoard, findNodeByPaper, parseBoard, serializeBoard, uid } from '../core/board';
import { PaperIndex } from '../core/index';
import { autoLayout, nodesBounds } from '../core/layout';
import { clonePalette, loadPalette, paletteFor, type FieldPalette } from '../core/colors';
import { buildCardElement, resolveCard, type CardModel } from './card';
import { draftGeometry, edgeGeometry, nearestSide, sidePoint } from './edges';
import { button, clamp, debounce, el } from './dom';
import { CoverPickerModal, TextAreaModal, TextPromptModal } from './modals';

export const ATLAS_VIEW_TYPE = 'paper-atlas-view';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;
const EXPAND_DELTA = 200;

type Drag =
  | { kind: 'pan'; clientX: number; clientY: number; originX: number; originY: number; moved: boolean }
  | {
      kind: 'node';
      clientX: number;
      clientY: number;
      origin: Map<string, { x: number; y: number }>;
      moved: boolean;
      snapshot: string;
    }
  | {
      kind: 'resize';
      nodeId: string;
      clientX: number;
      clientY: number;
      width: number;
      height: number;
      moved: boolean;
      snapshot: string;
    }
  | { kind: 'marquee'; startX: number; startY: number; x: number; y: number; additive: boolean }
  | {
      kind: 'edge';
      from: string;
      fromSide: EdgeSide;
      temp: SVGPathElement;
      clientX: number;
      clientY: number;
    };

interface EdgeRecord {
  hit: SVGPathElement;
  path: SVGPathElement;
  label: HTMLElement | null;
}

interface EditingState {
  nodeId: string;
  field: EditableField;
}

interface SidebarPress {
  path: string;
  clientX: number;
  clientY: number;
  ghost: HTMLElement | null;
}

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

export class AtlasView extends ItemView {
  readonly plugin: PaperAtlasPlugin;

  private boardPath: string;
  private board = emptyBoard();
  private index: PaperIndex;
  private palette: FieldPalette = clonePalette();
  private viewport = { x: 0, y: 0, z: 1 };
  private selection = new Set<string>();
  private edgeSelection: string | null = null;
  private drag: Drag | null = null;
  private spaceDown = false;
  private editing: EditingState | null = null;
  private sidebarPress: SidebarPress | null = null;
  private dragMoved = false;

  private history: string[] = [];
  private historyIndex = -1;

  private root!: HTMLElement;
  private stage!: HTMLElement;
  private world!: HTMLElement;
  private nodeLayer!: HTMLElement;
  private edgeSvg!: SVGSVGElement;
  private labelLayer!: HTMLElement;
  private marqueeEl!: HTMLElement;
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private zoomLabel!: HTMLElement;
  private emptyHint!: HTMLElement;
  private groupLayer!: HTMLElement;
  private legendEl!: HTMLElement;
  private edgeToolbar!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private fieldFilter!: HTMLSelectElement;
  private statusFilter!: HTMLSelectElement;

  private nodeEls = new Map<string, HTMLElement>();
  private edgeEls = new Map<string, EdgeRecord>();

  private searchQuery = '';
  private fieldQuery = '';
  private statusQuery = '';

  private saveDebounced!: (() => void) & { cancel: () => void };
  private readFailed = false;
  private rescanDebounced!: (() => void) & { cancel: () => void };
  private loaded = false;

  constructor(leaf: WorkspaceLeaf, plugin: PaperAtlasPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.boardPath = plugin.settings.boardPath;
    this.index = new PaperIndex(this.app, plugin.settings.paperFolder);
  }

  getViewType(): string {
    return ATLAS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '论文图谱';
  }

  getIcon(): string {
    return 'network';
  }

  getState(): Record<string, unknown> {
    return { file: this.boardPath };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const next = state && typeof state === 'object' ? (state as { file?: unknown }).file : undefined;
    if (typeof next === 'string' && next && next !== this.boardPath) {
      this.boardPath = next;
      if (this.loaded) await this.loadAll();
    }
    await super.setState(state, result);
  }

  protected async onOpen(): Promise<void> {
    this.contentEl.addClass('pa-view');
    this.buildChrome();
    this.saveDebounced = debounce(() => {
      void this.saveNow();
    }, 450);
    this.rescanDebounced = debounce(() => {
      void this.refreshPapers();
    }, 1200);
    this.registerDomEvent(this.root, 'keydown', (evt) => this.onKeyDown(evt));
    this.registerDomEvent(window, 'keyup', (evt) => {
      if (evt.code === 'Space') this.spaceDown = false;
    });
    this.registerEvent(this.app.vault.on('modify', (file) => this.onVaultTouch(file.path)));
    this.registerEvent(this.app.vault.on('create', (file) => this.onVaultTouch(file.path)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.onVaultTouch(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onVaultRename(file.path, oldPath)));

    await this.loadAll();
  }

  protected async onClose(): Promise<void> {
    this.saveDebounced?.cancel();
    this.rescanDebounced?.cancel();
    await this.saveNow();
  }

  // ── bootstrap ────────────────────────────────────────────

  private buildChrome(): void {
    this.contentEl.empty();
    const root = el('div', 'pa-root');
    root.tabIndex = 0;
    root.classList.toggle('pa-sidebar-open', this.plugin.settings.sidebarOpen);
    root.classList.toggle('pa-legend-open', this.plugin.settings.showLegend);
    this.root = root;
    this.contentEl.appendChild(root);

    const toolbar = el('div', 'pa-toolbar');
    toolbar.appendChild(button('layout-grid', '自动布局', () => this.autoLayoutAll()));
    toolbar.appendChild(button('maximize', '适应视图', () => this.fitAll()));
    toolbar.appendChild(button('list', '领域图例', () => this.toggleLegend()));
    toolbar.appendChild(button('panel-right', '论文仓', () => this.toggleSidebar()));
    toolbar.appendChild(el('div', 'pa-toolbar-spacer'));
    toolbar.appendChild(button('minus', '缩小', () => this.zoomAtCenter(1 / 1.2)));
    this.zoomLabel = el('span', 'pa-zoom-label', '100%');
    toolbar.appendChild(this.zoomLabel);
    toolbar.appendChild(button('plus', '放大', () => this.zoomAtCenter(1.2)));

    const stage = el('div', 'pa-stage');
    this.stage = stage;

    const world = el('div', 'pa-world');
    this.world = world;
    this.groupLayer = el('div', 'pa-group-layer');
    this.edgeSvg = document.createElementNS(SVG_NS, 'svg');
    this.edgeSvg.setAttribute('class', 'pa-edges');
    this.edgeSvg.setAttribute('width', '1');
    this.edgeSvg.setAttribute('height', '1');
    this.edgeSvg.innerHTML =
      '<defs><marker id="pa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>';
    this.labelLayer = el('div', 'pa-edge-labels');
    this.nodeLayer = el('div', 'pa-node-layer');
    world.append(this.groupLayer, this.edgeSvg, this.labelLayer, this.nodeLayer);

    this.marqueeEl = el('div', 'pa-marquee');
    this.marqueeEl.classList.add('is-hidden');

    this.emptyHint = el('div', 'pa-empty');
    this.emptyHint.append(
      el('div', 'pa-empty-title', '画布还是空的'),
      el('div', 'pa-empty-text', '从右侧论文仓拖一张卡片进来，或者一键铺开全部论文。'),
    );
    const spread = el('button', 'pa-btn mod-cta', '铺开全部论文');
    spread.type = 'button';
    spread.addEventListener('click', () => this.spreadAllPapers());
    this.emptyHint.appendChild(spread);
    this.emptyHint.classList.add('is-hidden');

    this.legendEl = el('div', 'pa-legend');

    this.edgeToolbar = el('div', 'pa-edge-toolbar');
    this.edgeToolbar.classList.add('is-hidden');
    this.edgeToolbar.append(
      button('trash', '删除连线', () => this.deleteEdge(this.edgeSelection || '')),
      button('palette', '连线颜色', () => this.openEdgeColorMenu()),
      button('maximize', '聚焦两端', () => this.focusSelectedEdge()),
      button('arrow-right', '切换箭头方向', () => this.cycleEdgeArrow()),
      button('pencil', '编辑标签', () => {
        if (this.edgeSelection) this.editEdgeLabel(this.edgeSelection);
      }),
    );

    stage.append(world, this.emptyHint, this.marqueeEl, this.legendEl, this.edgeToolbar, toolbar);
    stage.addEventListener('pointerdown', (evt) => this.onStagePointerDown(evt));
    stage.addEventListener('wheel', (evt) => this.onWheel(evt), { passive: false });
    stage.addEventListener('contextmenu', (evt) => this.onContextMenu(evt));
    stage.addEventListener('pointerdown', (evt) => {
      if ((evt.target as HTMLElement).closest('.pa-editor')) return;
      root.focus({ preventScroll: true });
    });

    this.nodeLayer.addEventListener('dblclick', (evt) => this.onNodeDoubleClick(evt));
    this.nodeLayer.addEventListener('click', (evt) => this.onNodeClick(evt));
    stage.addEventListener('dblclick', (evt) => {
      const label = (evt.target as HTMLElement).closest('.pa-edge-label') as HTMLElement | null;
      if (label?.dataset.edge) {
        evt.preventDefault();
        this.editEdgeLabel(label.dataset.edge);
      }
    });

    const sidebar = this.buildSidebar();

    root.append(stage, sidebar);
    this.applyTransform();
  }

  private buildSidebar(): HTMLElement {
    const sidebar = el('aside', 'pa-sidebar');
    const head = el('div', 'pa-sidebar-head');
    const title = el('div', 'pa-sidebar-title');
    title.append(el('span', 'pa-sidebar-name', '论文仓'));
    this.countEl = el('span', 'pa-count', '0');
    title.appendChild(this.countEl);
    head.appendChild(title);
    head.appendChild(button('x', '收起论文仓', () => this.toggleSidebar(false)));
    sidebar.appendChild(head);

    const controls = el('div', 'pa-sidebar-controls');
    this.searchInput = el('input', 'pa-search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = '搜索题目 / 作者 / 领域';
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value.trim().toLowerCase();
      this.renderSidebarList();
    });
    controls.appendChild(this.searchInput);

    const filterRow = el('div', 'pa-filter-row');
    this.fieldFilter = el('select', 'pa-select');
    this.fieldFilter.addEventListener('change', () => {
      this.fieldQuery = this.fieldFilter.value;
      this.renderSidebarList();
    });
    this.statusFilter = el('select', 'pa-select');
    const statusOptions: Array<[string, string]> = [
      ['', '全部状态'],
      ['unread', '未读'],
      ['skimmed', '粗读'],
      ['intensive', '精读'],
      ['read', '已读'],
    ];
    for (const [value, text] of statusOptions) {
      const option = el('option', '', text);
      option.value = value;
      this.statusFilter.appendChild(option);
    }
    this.statusFilter.addEventListener('change', () => {
      this.statusQuery = this.statusFilter.value;
      this.renderSidebarList();
    });
    filterRow.append(this.fieldFilter, this.statusFilter);
    controls.appendChild(filterRow);
    sidebar.appendChild(controls);

    this.listEl = el('div', 'pa-list');
    this.listEl.addEventListener('pointerdown', (evt) => this.onSidebarPointerDown(evt));
    this.listEl.addEventListener('dblclick', (evt) => {
      const item = (evt.target as HTMLElement).closest('.pa-item') as HTMLElement | null;
      if (!item) return;
      const path = item.dataset.paper;
      if (!path) return;
      const center = this.viewportCenter();
      this.addPaperAt(path, center.x, center.y);
    });
    sidebar.appendChild(this.listEl);
    return sidebar;
  }

  private async loadAll(): Promise<void> {
    this.index = new PaperIndex(this.app, this.plugin.settings.paperFolder);
    await this.index.refresh();
    await this.reloadPalette();
    await this.loadBoard();
    this.fillFieldFilter();
    this.renderAll();
    this.history = [this.snapshot()];
    this.historyIndex = 0;
    this.loaded = true;
  }

  private async reloadPalette(): Promise<void> {
    this.palette = await loadPalette(this.app, this.plugin.settings.inheritPalette);
  }

  private async loadBoard(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const backupPath = `${this.boardPath}.bak`;
    try {
      if (!(await adapter.exists(this.boardPath))) {
        this.board = emptyBoard();
        this.readFailed = false;
      } else {
        const raw = await adapter.read(this.boardPath);
        let parsed = parseBoard(raw);
        if (!parsed && (await adapter.exists(backupPath))) {
          const backup = parseBoard(await adapter.read(backupPath));
          if (backup) {
            parsed = backup;
            new Notice('Paper Atlas：画布文件损坏，已从 .bak 备份恢复');
          }
        }
        if (parsed) {
          this.board = parsed;
          this.readFailed = false;
        } else {
          this.board = emptyBoard();
          this.readFailed = true;
          new Notice('Paper Atlas：画布文件无法解析，已保护原文件不被覆盖（可从 .bak 恢复）');
        }
      }
    } catch (error) {
      console.error('Paper Atlas: failed to read board', error);
      new Notice('Paper Atlas：画布文件读取失败，已使用空白画布（为避免覆盖原文件，本次不会自动保存）');
      this.board = emptyBoard();
      this.readFailed = true;
    }
    this.viewport = { ...this.board.viewport };
    this.selection.clear();
    this.edgeSelection = null;
  }

  private fillFieldFilter(): void {
    const current = this.fieldFilter.value;
    this.fieldFilter.empty();
    const all = el('option', '', '全部领域');
    all.value = '';
    this.fieldFilter.appendChild(all);
    for (const field of this.index.fields()) {
      const option = el('option', '', field);
      option.value = field;
      this.fieldFilter.appendChild(option);
    }
    this.fieldFilter.value = current && this.index.fields().includes(current) ? current : '';
    this.fieldQuery = this.fieldFilter.value;
  }

  private renderAll(): void {
    this.applyTransform();
    this.renderGroups();
    this.renderNodes();
    this.renderEdges();
    this.renderSidebarList();
    this.updateEmptyHint();
  }

  // ── rendering ────────────────────────────────────────────

  private applyTransform(): void {
    this.board.viewport = { ...this.viewport };
    if (!this.world) return;
    const { x, y, z } = this.viewport;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.root.dataset.zoom = z < 0.3 ? 'far' : 'near';
    this.stage.style.setProperty('--pa-grid', `${24 * z}px`);
    this.stage.style.backgroundPosition = `${x}px ${y}px`;
    this.root.style.setProperty('--pa-inv-zoom', String(Math.min(8, Math.max(0.35, 1 / z))));
    this.updateEdgeToolbar();
    this.zoomLabel.setText(`${Math.round(z * 100)}%`);
  }

  private renderNodes(): void {
    this.nodeLayer.empty();
    this.nodeEls.clear();
    for (const node of this.board.nodes) {
      const nodeEl = this.createNodeEl(node);
      this.nodeLayer.appendChild(nodeEl);
      this.nodeEls.set(node.id, nodeEl);
    }
    this.updateEmptyHint();
    this.updateLegend();
  }

  private createNodeEl(node: AtlasNode): HTMLElement {
    const paper = this.index.get(node.paper);
    const model = resolveCard(node, paper, this.palette);
    const card = buildCardElement(model, node, (path) => this.coverUrl(path));

    const nodeEl = el('div', 'pa-node');
    nodeEl.dataset.id = node.id;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.style.width = `${node.w}px`;
    nodeEl.style.height = `${node.h}px`;
    nodeEl.style.setProperty('--pa-accent', model.accent);
    nodeEl.classList.toggle('is-selected', this.selection.has(node.id));
    nodeEl.classList.toggle('is-missing', model.missing);
    nodeEl.classList.toggle('is-expanded', Boolean(node.expanded));
    nodeEl.appendChild(card.root);

    for (const side of ['top', 'right', 'bottom', 'left'] as EdgeSide[]) {
      const port = el('div', `pa-port pa-port-${side}`);
      port.dataset.paPort = side;
      port.title = '从这里拖出一条关系线';
      nodeEl.appendChild(port);
    }
    const resize = el('div', 'pa-resize');
    resize.title = '拖动调整卡片大小';
    nodeEl.appendChild(resize);
    return nodeEl;
  }

  private refreshNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    const existing = this.nodeEls.get(nodeId);
    if (!node || !existing) return;
    const next = this.createNodeEl(node);
    existing.replaceWith(next);
    this.nodeEls.set(nodeId, next);
    this.updateEdges();
  }

  private renderGroups(): void {
    this.groupLayer.empty();
    if (!this.board.nodes.length) return;

    const groups = new Map<string, AtlasNode[]>();
    for (const node of this.board.nodes) {
      const field = this.fieldOf(node);
      const list = groups.get(field) || [];
      list.push(node);
      groups.set(field, list);
    }

    for (const [field, nodes] of groups) {
      const bounds = nodesBounds(nodes);
      if (!bounds) continue;
      const color = paletteFor(this.palette, field);
      const frame = el('div', 'pa-group');
      frame.style.left = `${bounds.minX - 24}px`;
      frame.style.top = `${bounds.minY - 24}px`;
      frame.style.width = `${bounds.maxX - bounds.minX + 48}px`;
      frame.style.height = `${bounds.maxY - bounds.minY + 48}px`;
      frame.style.borderColor = withAlpha(color.border, '66');
      frame.style.background = withAlpha(color.bg, '18');
      this.groupLayer.appendChild(frame);
    }
  }

  private renderEdges(): void {
    for (const record of this.edgeEls.values()) {
      record.hit.remove();
      record.path.remove();
      record.label?.remove();
    }
    this.edgeEls.clear();

    for (const edge of this.board.edges) {
      const from = this.getNode(edge.from);
      const to = this.getNode(edge.to);
      if (!from || !to) continue;

      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('class', 'pa-edge-hit');
      hit.dataset.edge = edge.id;
      this.edgeSvg.appendChild(hit);

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'pa-edge');
      const arrow = edge.arrow || 'forward';
      if (arrow !== 'none') path.setAttribute('marker-end', 'url(#pa-arrow)');
      if (arrow === 'both') path.setAttribute('marker-start', 'url(#pa-arrow)');
      path.dataset.edge = edge.id;
      if (edge.color) path.style.stroke = edge.color;
      path.classList.toggle('is-selected', this.edgeSelection === edge.id);
      this.edgeSvg.appendChild(path);

      let label: HTMLElement | null = null;
      if (edge.label) {
        label = el('div', 'pa-edge-label', edge.label);
        label.dataset.edge = edge.id;
        if (edge.color) label.style.borderColor = edge.color;
        this.labelLayer.appendChild(label);
      }

      this.edgeEls.set(edge.id, { hit, path, label });
    }
    this.updateEdges();
  }

  private updateEdges(): void {
    for (const edge of this.board.edges) {
      const record = this.edgeEls.get(edge.id);
      if (!record) continue;
      const from = this.getNode(edge.from);
      const to = this.getNode(edge.to);
      if (!from || !to) continue;
      const geometry = edgeGeometry(from, to, edge.fromSide, edge.toSide);
      record.hit.setAttribute('d', geometry.d);
      record.path.setAttribute('d', geometry.d);
      if (record.label) {
        record.label.style.left = `${geometry.midX}px`;
        record.label.style.top = `${geometry.midY}px`;
      }
    }
    this.updateEdgeToolbar();
  }

  private updateNodeDom(node: AtlasNode): void {
    const nodeEl = this.nodeEls.get(node.id);
    if (!nodeEl) return;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.style.width = `${node.w}px`;
    nodeEl.style.height = `${node.h}px`;
  }

  private refreshSelection(): void {
    for (const [id, nodeEl] of this.nodeEls) {
      nodeEl.classList.toggle('is-selected', this.selection.has(id));
    }
    for (const [id, record] of this.edgeEls) {
      const selected = this.edgeSelection === id;
      record.path.classList.toggle('is-selected', selected);
      record.hit.classList.toggle('is-selected', selected);
    }
    this.updateEdgeToolbar();
  }

  private updateEmptyHint(): void {
    if (!this.emptyHint) return;
    this.emptyHint.classList.toggle('is-hidden', this.board.nodes.length > 0);
  }

  // ── sidebar ──────────────────────────────────────────────

  private renderSidebarList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const papers = this.index.all.filter(
      (paper) => !findNodeByPaper(this.board, paper.path) && this.matchesFilter(paper),
    );
    this.countEl.setText(`${papers.length}/${this.index.size}`);

    if (!papers.length) {
      const allOnCanvas =
        this.index.size > 0 &&
        this.index.all.every((paper) => Boolean(findNodeByPaper(this.board, paper.path)));
      const message = allOnCanvas
        ? '所有论文都已经在画布上了'
        : this.board.nodes.length && !this.searchQuery && !this.fieldQuery && !this.statusQuery
          ? '剩下的论文都已经在画布上了'
          : '没有匹配的论文';
      this.listEl.appendChild(el('div', 'pa-list-empty', message));
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const paper of papers) {
      fragment.appendChild(this.buildSidebarItem(paper));
    }
    this.listEl.appendChild(fragment);
  }

  private matchesFilter(paper: PaperEntry): boolean {
    if (this.fieldQuery && paper.primaryField !== this.fieldQuery && !paper.fields.includes(this.fieldQuery)) {
      return false;
    }
    if (this.statusQuery && paper.status !== this.statusQuery) return false;
    if (!this.searchQuery) return true;
    const haystack = [paper.title, ...paper.authors, ...paper.fields, paper.venue, paper.institution]
      .join(' ')
      .toLowerCase();
    return haystack.includes(this.searchQuery);
  }

  private buildSidebarItem(paper: PaperEntry): HTMLElement {
    const item = el('div', 'pa-item');
    item.dataset.paper = paper.path;
    const color = paletteFor(this.palette, paper.primaryField);
    const bar = el('span', 'pa-item-bar');
    bar.style.background = color.border;
    item.appendChild(bar);

    const body = el('div', 'pa-item-body');
    body.appendChild(el('div', 'pa-item-title', paper.title));
    const meta = el('div', 'pa-item-meta');
    meta.append(
      el('span', '', paper.date || '时间未知'),
      el('span', 'pa-dot', '·'),
      el('span', `pa-status pa-status-${paper.status}`, STATUS_LABEL[paper.status]),
    );
    body.appendChild(meta);
    item.appendChild(body);

    const cover = paper.images.find((image) => image.path);
    if (cover) {
      const thumb = el('div', 'pa-item-thumb');
      const img = el('img', 'pa-item-img');
      img.src = this.coverUrl(cover.path);
      img.loading = 'lazy';
      img.alt = '';
      thumb.appendChild(img);
      item.appendChild(thumb);
    }
    return item;
  }

  private onSidebarPointerDown(evt: PointerEvent): void {
    if (evt.button !== 0) return;
    const item = (evt.target as HTMLElement).closest('.pa-item') as HTMLElement | null;
    if (!item?.dataset.paper) return;
    this.sidebarPress = { path: item.dataset.paper, clientX: evt.clientX, clientY: evt.clientY, ghost: null };

    const move = (moveEvt: PointerEvent): void => {
      const press = this.sidebarPress;
      if (!press) return;
      const dx = moveEvt.clientX - press.clientX;
      const dy = moveEvt.clientY - press.clientY;
      if (!press.ghost && Math.hypot(dx, dy) < 5) return;
      if (!press.ghost) {
        press.ghost = this.createDragGhost(press.path);
        document.body.appendChild(press.ghost);
      }
      press.ghost.style.left = `${moveEvt.clientX + 12}px`;
      press.ghost.style.top = `${moveEvt.clientY + 12}px`;
      const overStage = this.stage.getBoundingClientRect();
      const inside =
        moveEvt.clientX >= overStage.left &&
        moveEvt.clientX <= overStage.right &&
        moveEvt.clientY >= overStage.top &&
        moveEvt.clientY <= overStage.bottom;
      press.ghost.classList.toggle('is-over-canvas', inside);
    };

    const up = (upEvt: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const press = this.sidebarPress;
      this.sidebarPress = null;
      if (!press) return;
      if (press.ghost) {
        press.ghost.remove();
        const rect = this.stage.getBoundingClientRect();
        const inside =
          upEvt.clientX >= rect.left &&
          upEvt.clientX <= rect.right &&
          upEvt.clientY >= rect.top &&
          upEvt.clientY <= rect.bottom;
        if (inside) {
          const point = this.screenToBoard(upEvt.clientX, upEvt.clientY);
          this.addPaperAt(press.path, point.x, point.y);
        }
        return;
      }
      const node = findNodeByPaper(this.board, press.path);
      if (node) {
        this.selection.clear();
        this.selection.add(node.id);
        this.edgeSelection = null;
        this.refreshSelection();
        this.centerOn(node);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private createDragGhost(path: string): HTMLElement {
    const paper = this.index.get(path);
    const ghost = el('div', 'pa-drag-ghost');
    ghost.textContent = paper?.title || path;
    if (paper) ghost.style.borderColor = paletteFor(this.palette, paper.primaryField).border;
    return ghost;
  }

  private toggleSidebar(force?: boolean): void {
    const open = force ?? !this.root.classList.contains('pa-sidebar-open');
    this.root.classList.toggle('pa-sidebar-open', open);
    this.plugin.settings.sidebarOpen = open;
    void this.plugin.saveSettings();
  }

  // ── pointer interaction ──────────────────────────────────

  private onStagePointerDown(evt: PointerEvent): void {
    if (evt.button === 2) return;
    this.dragMoved = false;
    const target = evt.target as HTMLElement;
    if (target.closest('.pa-toolbar, .pa-edge-toolbar')) return;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const port = target.closest('[data-pa-port]') as HTMLElement | null;
    if (port) {
      const nodeEl = port.closest('.pa-node') as HTMLElement | null;
      const side = (port.dataset.paPort as EdgeSide) || 'right';
      if (nodeEl?.dataset.id) {
        evt.preventDefault();
        this.beginEdgeDraft(nodeEl.dataset.id, side, evt);
        return;
      }
    }

    const resize = target.closest('.pa-resize') as HTMLElement | null;
    if (resize) {
      const nodeEl = resize.closest('.pa-node') as HTMLElement | null;
      if (nodeEl?.dataset.id) {
        evt.preventDefault();
        this.beginResize(nodeEl.dataset.id, evt);
        return;
      }
    }

    const nodeEl = target.closest('.pa-node') as HTMLElement | null;
    if (nodeEl?.dataset.id) {
      const id = nodeEl.dataset.id;
      const additive = evt.shiftKey || evt.metaKey || evt.ctrlKey;
      if (additive) {
        if (this.selection.has(id)) this.selection.delete(id);
        else this.selection.add(id);
      } else if (!this.selection.has(id)) {
        this.selection.clear();
        this.selection.add(id);
      }
      this.edgeSelection = null;
      this.refreshSelection();
      this.beginNodeDrag(evt);
      return;
    }

    const edgeHit = target.closest('.pa-edge-hit') as SVGElement | null;
    const edgeLabel = target.closest('.pa-edge-label') as HTMLElement | null;
    const edgeId = edgeHit?.dataset.edge || edgeLabel?.dataset.edge;
    if (edgeId) {
      this.selection.clear();
      this.edgeSelection = edgeId;
      this.refreshSelection();
      evt.preventDefault();
      return;
    }

    if (evt.button === 1 || this.spaceDown || evt.altKey) {
      evt.preventDefault();
      this.beginPan(evt);
      return;
    }

    this.beginMarquee(evt);
  }

  private beginPan(evt: PointerEvent): void {
    const drag: Drag = {
      kind: 'pan',
      clientX: evt.clientX,
      clientY: evt.clientY,
      originX: this.viewport.x,
      originY: this.viewport.y,
      moved: false,
    };
    this.drag = drag;
    this.attachDragListeners();
  }

  private beginNodeDrag(evt: PointerEvent): void {
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of this.selection) {
      const node = this.getNode(id);
      if (node) origin.set(id, { x: node.x, y: node.y });
    }
    if (!origin.size) return;
    this.drag = {
      kind: 'node',
      clientX: evt.clientX,
      clientY: evt.clientY,
      origin,
      moved: false,
      snapshot: this.snapshot(),
    };
    this.attachDragListeners();
  }

  private beginResize(nodeId: string, evt: PointerEvent): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    this.drag = {
      kind: 'resize',
      nodeId,
      clientX: evt.clientX,
      clientY: evt.clientY,
      width: node.w,
      height: node.h,
      moved: false,
      snapshot: this.snapshot(),
    };
    this.attachDragListeners();
  }

  private beginMarquee(evt: PointerEvent): void {
    const rect = this.stage.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const additive = evt.shiftKey || evt.metaKey || evt.ctrlKey;
    if (!additive) {
      this.selection.clear();
      this.edgeSelection = null;
      this.refreshSelection();
    }
    this.drag = { kind: 'marquee', startX: x, startY: y, x, y, additive };
    this.marqueeEl.classList.remove('is-hidden');
    this.marqueeEl.style.left = `${x}px`;
    this.marqueeEl.style.top = `${y}px`;
    this.marqueeEl.style.width = '0px';
    this.marqueeEl.style.height = '0px';
    this.attachDragListeners();
  }

  private beginEdgeDraft(fromId: string, side: EdgeSide, evt: PointerEvent): void {
    const temp = document.createElementNS(SVG_NS, 'path');
    temp.setAttribute('class', 'pa-edge pa-edge-draft');
    this.edgeSvg.appendChild(temp);
    const from = this.getNode(fromId);
    const point = this.screenToBoard(evt.clientX, evt.clientY);
    if (from) temp.setAttribute('d', draftGeometry(from, side, point).d);
    this.root.classList.add('is-drawing-edge');
    this.drag = {
      kind: 'edge',
      from: fromId,
      fromSide: side,
      temp,
      clientX: evt.clientX,
      clientY: evt.clientY,
    };
    this.attachDragListeners();
  }

  private attachDragListeners(): void {
    const move = (evt: PointerEvent): void => this.onDragMove(evt);
    const up = (evt: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.onDragEnd(evt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private onDragMove(evt: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const z = this.viewport.z;

    if (drag.kind === 'pan') {
      const dx = evt.clientX - drag.clientX;
      const dy = evt.clientY - drag.clientY;
      if (Math.hypot(dx, dy) > 2) drag.moved = true;
      this.viewport.x = drag.originX + dx;
      this.viewport.y = drag.originY + dy;
      this.applyTransform();
      return;
    }

    if (drag.kind === 'node') {
      const dx = (evt.clientX - drag.clientX) / z;
      const dy = (evt.clientY - drag.clientY) / z;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;
      for (const [id, origin] of drag.origin) {
        const node = this.getNode(id);
        if (!node) continue;
        node.x = origin.x + dx;
        node.y = origin.y + dy;
        this.updateNodeDom(node);
      }
      this.dragMoved = drag.moved;
      this.updateEdges();
      this.renderGroups();
      return;
    }

    if (drag.kind === 'resize') {
      const dx = (evt.clientX - drag.clientX) / z;
      const dy = (evt.clientY - drag.clientY) / z;
      const node = this.getNode(drag.nodeId);
      if (!node) return;
      node.w = Math.max(MIN_CARD_WIDTH, drag.width + dx);
      node.h = Math.max(MIN_CARD_HEIGHT, drag.height + dy);
      drag.moved = true;
      this.dragMoved = true;
      this.updateNodeDom(node);
      this.updateEdges();
      this.renderGroups();
      return;
    }

    if (drag.kind === 'marquee') {
      const rect = this.stage.getBoundingClientRect();
      drag.x = evt.clientX - rect.left;
      drag.y = evt.clientY - rect.top;
      const left = Math.min(drag.startX, drag.x);
      const top = Math.min(drag.startY, drag.y);
      this.marqueeEl.style.left = `${left}px`;
      this.marqueeEl.style.top = `${top}px`;
      this.marqueeEl.style.width = `${Math.abs(drag.x - drag.startX)}px`;
      this.marqueeEl.style.height = `${Math.abs(drag.y - drag.startY)}px`;
      return;
    }

    if (drag.kind === 'edge') {
      const point = this.screenToBoard(evt.clientX, evt.clientY);
      drag.clientX = evt.clientX;
      drag.clientY = evt.clientY;
      const from = this.getNode(drag.from);
      if (!from) return;
      drag.temp.setAttribute('d', draftGeometry(from, drag.fromSide, point).d);
    }
  }

  private onDragEnd(evt: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;

    if (drag.kind === 'pan') {
      this.saveDebounced();
      return;
    }

    if (drag.kind === 'node' || drag.kind === 'resize') {
      if (drag.moved) {
        this.recordHistory(drag.snapshot);
        this.renderGroups();
        this.saveDebounced();
      }
      this.dragMoved = drag.moved;
      return;
    }

    if (drag.kind === 'marquee') {
      this.marqueeEl.classList.add('is-hidden');
      const left = Math.min(drag.startX, drag.x);
      const top = Math.min(drag.startY, drag.y);
      const right = Math.max(drag.startX, drag.x);
      const bottom = Math.max(drag.startY, drag.y);
      const stageRect = this.stage.getBoundingClientRect();
      const origin = this.screenToBoard(stageRect.left + left, stageRect.top + top);
      const end = this.screenToBoard(stageRect.left + right, stageRect.top + bottom);
      if (Math.abs(right - left) < 4 && Math.abs(bottom - top) < 4) {
        if (!drag.additive) {
          this.selection.clear();
          this.edgeSelection = null;
          this.refreshSelection();
        }
        return;
      }
      for (const node of this.board.nodes) {
        const overlaps =
          node.x < end.x && node.x + node.w > origin.x && node.y < end.y && node.y + node.h > origin.y;
        if (overlaps) this.selection.add(node.id);
      }
      this.refreshSelection();
      return;
    }

    if (drag.kind === 'edge') {
      this.root.classList.remove('is-drawing-edge');
      drag.temp.remove();
      const element = document.elementFromPoint(evt.clientX, evt.clientY);
      const nodeEl = element?.closest('.pa-node') as HTMLElement | null;
      const targetId = nodeEl?.dataset.id;
      if (targetId && targetId !== drag.from) {
        const point = this.screenToBoard(evt.clientX, evt.clientY);
        const target = this.getNode(targetId);
        const toSide = target ? nearestSide(target, point.x, point.y) : undefined;
        this.createEdge(drag.from, targetId, drag.fromSide, toSide);
      }
    }
  }

  private onWheel(evt: WheelEvent): void {
    if (evt.ctrlKey || evt.metaKey) {
      evt.preventDefault();
      const factor = Math.exp(-evt.deltaY * 0.0025);
      this.zoomAt(evt.clientX, evt.clientY, factor);
      return;
    }
    evt.preventDefault();
    this.viewport.x -= evt.deltaX;
    this.viewport.y -= evt.deltaY;
    this.applyTransform();
    this.saveDebounced();
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.stage.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const beforeX = (px - this.viewport.x) / this.viewport.z;
    const beforeY = (py - this.viewport.y) / this.viewport.z;
    const z = clamp(this.viewport.z * factor, MIN_ZOOM, MAX_ZOOM);
    this.viewport.z = z;
    this.viewport.x = px - beforeX * z;
    this.viewport.y = py - beforeY * z;
    this.applyTransform();
    this.saveDebounced();
  }

  private zoomAtCenter(factor: number): void {
    const rect = this.stage.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  // ── node interactions ────────────────────────────────────

  private onNodeDoubleClick(evt: MouseEvent): void {
    const fieldEl = (evt.target as HTMLElement).closest('[data-pa-field]') as HTMLElement | null;
    if (!fieldEl) return;
    const nodeEl = fieldEl.closest('.pa-node') as HTMLElement | null;
    const field = fieldEl.dataset.paField as EditableField | undefined;
    if (!nodeEl?.dataset.id || !field) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.startEdit(nodeEl.dataset.id, field);
  }

  private onNodeClick(evt: MouseEvent): void {
    if (this.dragMoved) return;
    const target = evt.target as HTMLElement;
    const nodeEl = target.closest('.pa-node') as HTMLElement | null;
    if (!nodeEl?.dataset.id) return;

    const wiki = target.closest('.pa-wikilink') as HTMLElement | null;
    if (wiki?.dataset.href) {
      evt.preventDefault();
      const node = this.getNode(nodeEl.dataset.id);
      if (node) void this.app.workspace.openLinkText(wiki.dataset.href, node.paper, true);
      return;
    }

    const actionEl = target.closest('[data-pa-action]') as HTMLElement | null;
    if (!actionEl) return;
    const action = actionEl.dataset.paAction;
    const nodeId = nodeEl.dataset.id;

    if (action === 'open-note') {
      evt.preventDefault();
      const node = this.getNode(nodeId);
      if (node) this.openPaper(node.paper);
      return;
    }
    if (action === 'toggle-under') {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleExpand(nodeId);
      return;
    }
    if (action === 'cover') {
      evt.preventDefault();
      evt.stopPropagation();
      this.openCoverPicker(nodeId);
    }
  }

  private toggleExpand(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    const before = this.snapshot();
    node.expanded = !node.expanded;
    node.h = Math.max(MIN_CARD_HEIGHT, node.h + (node.expanded ? EXPAND_DELTA : -EXPAND_DELTA));
    this.recordHistory(before);
    this.refreshNode(nodeId);
    this.saveDebounced();
  }

  private startEdit(nodeId: string, field: EditableField): void {
    if (this.editing) return;
    const node = this.getNode(nodeId);
    if (!node || !this.nodeEls.get(nodeId)) return;

    const paper = this.index.get(node.paper);
    const model = resolveCard(node, paper, this.palette);
    const value = this.editableValue(model, paper, field);

    // 理解往往很长，用弹窗编辑；行内展开会把卡片撑高，取消后也回不去
    if (field === 'understanding') {
      new TextAreaModal(
        this.app,
        '编辑理解',
        value,
        '写下你对这篇论文的理解……',
        (next) => this.applyEdit(nodeId, 'understanding', next),
      ).open();
      return;
    }

    const target = this.nodeEls.get(nodeId)?.querySelector(`[data-pa-field="${field}"]`) as HTMLElement | null;
    if (!target) return;

    const input = el('input', 'pa-editor');
    input.value = value;
    target.classList.add('is-editing');
    target.replaceChildren(input);
    this.editing = { nodeId, field };

    let done = false;
    const cancel = (): void => {
      if (done) return;
      done = true;
      this.editing = null;
      this.refreshNode(nodeId);
    };
    const commit = (): void => {
      if (done) return;
      done = true;
      this.editing = null;
      this.applyEdit(nodeId, field, input.value);
    };

    input.addEventListener('keydown', (event) => {
      const evt = event as KeyboardEvent;
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        cancel();
      } else if (evt.key === 'Enter') {
        evt.preventDefault();
        commit();
      }
    });
    input.addEventListener('blur', commit);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  private editableValue(model: CardModel, paper: PaperEntry | undefined, field: EditableField): string {
    switch (field) {
      case 'title':
        return model.title;
      case 'date':
        return model.date;
      case 'venue':
        return model.venue;
      case 'authors':
        return model.authors.join(', ');
      case 'institution':
        return model.institution;
      case 'understanding':
        return model.understanding;
      case 'cover':
        return paper?.images.find((image) => image.path)?.path || '';
      default:
        return '';
    }
  }

  private applyEdit(nodeId: string, field: EditableField, rawValue: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    const paper = this.index.get(node.paper);
    if (!paper) {
      this.refreshNode(nodeId);
      return;
    }

    const before = this.snapshot();
    const value = rawValue.trim();
    node.overrides = node.overrides || {};

    if (field === 'authors') {
      const list = value
        .split(/[,;；、]/)
        .map((part) => part.trim())
        .filter(Boolean);
      const same = list.join('\u0000') === paper.authors.join('\u0000');
      if (same) delete node.overrides.authors;
      else node.overrides.authors = list;
    } else {
      const baseline = this.editableValue(resolveCard({ ...node, overrides: undefined }, paper, this.palette), paper, field);
      if (value === baseline) {
        delete node.overrides[field as 'title' | 'date' | 'venue' | 'institution' | 'understanding'];
      } else {
        node.overrides[field as 'title' | 'date' | 'venue' | 'institution' | 'understanding'] = value;
      }
    }

    if (!Object.keys(node.overrides).length) delete node.overrides;
    this.recordHistory(before);
    this.refreshNode(nodeId);
    this.renderSidebarList();
    this.saveDebounced();
  }

  private openCoverPicker(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    const paper = this.index.get(node.paper);
    if (!paper) return;
    const model = resolveCard(node, paper, this.palette);
    new CoverPickerModal(this.app, paper.images, model.cover, (path) => this.coverUrl(path), (picked) => {
      const before = this.snapshot();
      node.overrides = node.overrides || {};
      if (picked) node.overrides.cover = picked;
      else delete node.overrides.cover;
      if (!Object.keys(node.overrides).length) delete node.overrides;
      this.recordHistory(before);
      this.refreshNode(nodeId);
      this.saveDebounced();
    }).open();
  }

  private resetNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    const before = this.snapshot();
    delete node.overrides;
    this.recordHistory(before);
    this.refreshNode(nodeId);
    this.renderSidebarList();
    this.saveDebounced();
    new Notice('已恢复为笔记内容');
  }

  private deleteSelection(): void {
    if (this.edgeSelection) {
      const before = this.snapshot();
      this.board.edges = this.board.edges.filter((edge) => edge.id !== this.edgeSelection);
      this.edgeSelection = null;
      this.recordHistory(before);
      this.renderEdges();
      this.saveDebounced();
      return;
    }
    if (!this.selection.size) return;
    const before = this.snapshot();
    const ids = new Set(this.selection);
    this.board.nodes = this.board.nodes.filter((node) => !ids.has(node.id));
    this.board.edges = this.board.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
    this.selection.clear();
    this.recordHistory(before);
    this.renderAll();
    this.saveDebounced();
  }

  // ── edges ────────────────────────────────────────────────

  private updateEdgeToolbar(): void {
    if (!this.edgeToolbar) return;
    const edge = this.edgeSelection
      ? this.board.edges.find((item) => item.id === this.edgeSelection)
      : undefined;
    const from = edge ? this.getNode(edge.from) : undefined;
    const to = edge ? this.getNode(edge.to) : undefined;
    if (!edge || !from || !to) {
      this.edgeToolbar.classList.add('is-hidden');
      return;
    }
    const geometry = edgeGeometry(from, to, edge.fromSide, edge.toSide);
    this.edgeToolbar.classList.remove('is-hidden');
    this.edgeToolbar.style.left = `${this.viewport.x + geometry.midX * this.viewport.z}px`;
    this.edgeToolbar.style.top = `${this.viewport.y + geometry.midY * this.viewport.z - 16}px`;
  }

  private openEdgeColorMenu(): void {
    const edgeId = this.edgeSelection;
    if (!edgeId || !this.edgeToolbar) return;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('默认颜色').onClick(() => this.setEdgeColor(edgeId, null)));
    menu.addSeparator();
    for (const [name, color] of [
      ['红色', '#e03131'],
      ['橙色', '#e8590c'],
      ['绿色', '#2f9e44'],
      ['蓝色', '#1971c2'],
      ['紫色', '#7048e8'],
      ['灰色', '#868e96'],
    ] as Array<[string, string]>) {
      menu.addItem((item) => item.setTitle(name).onClick(() => this.setEdgeColor(edgeId, color)));
    }
    const rect = this.edgeToolbar.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 });
  }

  private cycleEdgeArrow(): void {
    const edge = this.edgeSelection
      ? this.board.edges.find((item) => item.id === this.edgeSelection)
      : undefined;
    if (!edge) return;
    const order: EdgeArrow[] = ['forward', 'both', 'none'];
    const current = order.indexOf(edge.arrow || 'forward');
    const before = this.snapshot();
    edge.arrow = order[(current + 1) % order.length] as EdgeArrow;
    this.recordHistory(before);
    this.renderEdges();
    this.saveDebounced();
  }

  private focusSelectedEdge(): void {
    const edge = this.edgeSelection
      ? this.board.edges.find((item) => item.id === this.edgeSelection)
      : undefined;
    if (!edge) return;
    const from = this.getNode(edge.from);
    const to = this.getNode(edge.to);
    if (!from || !to) return;
    this.fitNodes([from, to]);
  }

  private createEdge(from: string, to: string, fromSide?: EdgeSide, toSide?: EdgeSide): void {
    const exists = this.board.edges.some(
      (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
    );
    if (exists) {
      new Notice('这两张卡片之间已经有连线了');
      return;
    }
    const before = this.snapshot();
    const edge: AtlasEdge = { id: uid('e'), from, to };
    if (fromSide) edge.fromSide = fromSide;
    if (toSide) edge.toSide = toSide;
    this.board.edges.push(edge);
    this.recordHistory(before);
    this.renderEdges();
    this.saveDebounced();
  }

  private editEdgeLabel(edgeId: string): void {
    const edge = this.board.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    new TextPromptModal(this.app, '关系标签', edge.label || '', '例如：改进 / 对比 / 同一问题', (value) => {
      const before = this.snapshot();
      if (value) edge.label = value;
      else delete edge.label;
      this.recordHistory(before);
      this.renderEdges();
      this.saveDebounced();
    }).open();
  }

  private setEdgeColor(edgeId: string, color: string | null): void {
    const edge = this.board.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const before = this.snapshot();
    if (color) edge.color = color;
    else delete edge.color;
    this.recordHistory(before);
    this.renderEdges();
    this.saveDebounced();
  }

  private deleteEdge(edgeId: string): void {
    const before = this.snapshot();
    this.board.edges = this.board.edges.filter((edge) => edge.id !== edgeId);
    if (this.edgeSelection === edgeId) this.edgeSelection = null;
    this.recordHistory(before);
    this.renderEdges();
    this.saveDebounced();
  }

  // ── menus / commands ─────────────────────────────────────

  private onContextMenu(evt: MouseEvent): void {
    const target = evt.target as HTMLElement;
    if (target.closest('input, textarea')) return;
    evt.preventDefault();
    const edgeHit = target.closest('.pa-edge-hit') as SVGElement | null;
    const edgeLabel = target.closest('.pa-edge-label') as HTMLElement | null;
    const edgeId = edgeHit?.dataset.edge || edgeLabel?.dataset.edge;
    if (edgeId) {
      this.showEdgeMenu(edgeId, evt);
      return;
    }
    const nodeEl = target.closest('.pa-node') as HTMLElement | null;
    if (nodeEl?.dataset.id) {
      if (!this.selection.has(nodeEl.dataset.id)) {
        this.selection.clear();
        this.selection.add(nodeEl.dataset.id);
        this.edgeSelection = null;
        this.refreshSelection();
      }
      this.showNodeMenu(nodeEl.dataset.id, evt);
      return;
    }
    this.showCanvasMenu(evt);
  }

  private showNodeMenu(nodeId: string, evt: MouseEvent): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    const menu = new Menu();
    const edit = (field: EditableField, title: string, icon: string): void => {
      menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(() => this.startEdit(nodeId, field)));
    };
    edit('title', '编辑题目', 'heading');
    edit('date', '编辑时间', 'calendar');
    edit('venue', '编辑会议 / 期刊', 'book');
    edit('authors', '编辑作者', 'users');
    edit('institution', '编辑机构', 'building');
    edit('understanding', '编辑理解', 'lightbulb');
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('更换封面').setIcon('image').onClick(() => this.openCoverPicker(nodeId)));
    menu.addItem((item) =>
      item.setTitle('打开论文笔记').setIcon('file-text').onClick(() => this.openPaper(node.paper)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle('恢复为笔记内容').setIcon('rotate-ccw').onClick(() => this.resetNode(nodeId)),
    );
    menu.addItem((item) => item.setTitle('删除卡片').setIcon('trash').onClick(() => this.deleteSelection()));
    menu.showAtMouseEvent(evt);
  }

  private showEdgeMenu(edgeId: string, evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle('编辑标签').setIcon('tag').onClick(() => this.editEdgeLabel(edgeId)),
    );
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('默认颜色').onClick(() => this.setEdgeColor(edgeId, null)));
    for (const [name, color] of [
      ['红色', '#e03131'],
      ['橙色', '#e8590c'],
      ['绿色', '#2f9e44'],
      ['蓝色', '#1971c2'],
      ['灰色', '#868e96'],
    ] as Array<[string, string]>) {
      menu.addItem((item) => item.setTitle(name).onClick(() => this.setEdgeColor(edgeId, color)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('删除连线').setIcon('trash').onClick(() => this.deleteEdge(edgeId)));
    menu.showAtMouseEvent(evt);
  }

  private showCanvasMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('自动布局').setIcon('layout-grid').onClick(() => this.autoLayoutAll()));
    menu.addItem((item) => item.setTitle('适应视图').setIcon('maximize').onClick(() => this.fitAll()));
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle('铺开全部论文').setIcon('layers').onClick(() => this.spreadAllPapers()),
    );
    menu.addItem((item) => item.setTitle('清空画布').setIcon('trash').onClick(() => this.clearBoard()));
    menu.showAtMouseEvent(evt);
  }

  private onKeyDown(evt: KeyboardEvent): void {
    const target = evt.target as HTMLElement | null;
    const inEditor =
      target != null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (evt.code === 'Space' && !inEditor) {
      this.spaceDown = true;
      evt.preventDefault();
      return;
    }
    if (inEditor) return;

    const mod = evt.ctrlKey || evt.metaKey;
    if (mod && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      if (evt.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && evt.key.toLowerCase() === 'y') {
      evt.preventDefault();
      this.redo();
      return;
    }
    if (mod && evt.key.toLowerCase() === 'a') {
      evt.preventDefault();
      this.selection = new Set(this.board.nodes.map((node) => node.id));
      this.refreshSelection();
      return;
    }
    if (evt.key === 'Delete' || evt.key === 'Backspace') {
      evt.preventDefault();
      this.deleteSelection();
      return;
    }
    if (evt.shiftKey && (evt.key === '!' || evt.code === 'Digit1')) {
      evt.preventDefault();
      this.fitAll();
      return;
    }
    if (evt.key === 'Escape') {
      this.selection.clear();
      this.edgeSelection = null;
      this.refreshSelection();
    }
  }

  // ── history ──────────────────────────────────────────────

  private snapshot(): string {
    return JSON.stringify({ nodes: this.board.nodes, edges: this.board.edges });
  }

  private recordHistory(before: string): void {
    const after = this.snapshot();
    if (before === after) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(after);
    if (this.history.length > 80) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  private restore(snapshot: string): void {
    try {
      const data = JSON.parse(snapshot) as { nodes: AtlasNode[]; edges: AtlasEdge[] };
      this.board.nodes = data.nodes;
      this.board.edges = data.edges;
      this.selection.clear();
      this.edgeSelection = null;
      this.renderAll();
      this.saveDebounced();
    } catch (error) {
      console.error('Paper Atlas: history restore failed', error);
    }
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.restore(this.history[this.historyIndex] as string);
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.restore(this.history[this.historyIndex] as string);
  }

  // ── board mutations ──────────────────────────────────────

  private addPaperAt(path: string, boardX: number, boardY: number): void {
    const paper = this.index.get(path);
    if (!paper) {
      new Notice('找不到这篇论文的笔记');
      return;
    }
    const existing = findNodeByPaper(this.board, path);
    if (existing) {
      this.selection.clear();
      this.selection.add(existing.id);
      this.edgeSelection = null;
      this.refreshSelection();
      this.centerOn(existing);
      new Notice('这篇论文已经在画布上了');
      return;
    }
    const width = this.plugin.settings.cardWidth;
    const height = this.plugin.settings.cardHeight;
    const before = this.snapshot();
    const node: AtlasNode = {
      id: uid('n'),
      paper: path,
      x: Math.round(boardX - width / 2),
      y: Math.round(boardY - height / 2),
      w: width,
      h: height,
    };
    this.board.nodes.push(node);
    this.recordHistory(before);
    const nodeEl = this.createNodeEl(node);
    this.nodeLayer.appendChild(nodeEl);
    this.nodeEls.set(node.id, nodeEl);
    this.selection.clear();
    this.selection.add(node.id);
    this.edgeSelection = null;
    this.refreshSelection();
    this.renderGroups();
    this.renderSidebarList();
    this.updateEmptyHint();
    this.updateLegend();
    this.saveDebounced();
  }

  private openPaper(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf('tab').openFile(file);
    } else {
      new Notice('笔记文件不存在');
    }
  }

  // ── public commands ──────────────────────────────────────

  autoLayoutAll(): void {
    if (!this.board.nodes.length) return;
    const before = this.snapshot();
    autoLayout(this.board.nodes, (node) => this.fieldOf(node));
    this.recordHistory(before);
    this.renderNodes();
    this.renderGroups();
    this.updateEdges();
    this.applyTransform();
    this.saveDebounced();
  }

  spreadAllPapers(): void {
    if (!this.index.size) {
      new Notice('还没有扫描到论文');
      return;
    }
    const before = this.snapshot();
    let added = 0;
    for (const paper of this.index.all) {
      if (findNodeByPaper(this.board, paper.path)) continue;
      this.board.nodes.push({
        id: uid('n'),
        paper: paper.path,
        x: 0,
        y: 0,
        w: this.plugin.settings.cardWidth,
        h: this.plugin.settings.cardHeight,
      });
      added += 1;
    }
    if (!added) {
      new Notice('论文都已经在画布上了');
      return;
    }
    autoLayout(this.board.nodes, (node) => this.fieldOf(node));
    this.recordHistory(before);
    this.renderAll();
    this.fitAll();
    this.saveDebounced();
    new Notice(`已铺开 ${added} 篇论文`);
  }

  clearBoard(): void {
    if (!this.board.nodes.length) return;
    if (!window.confirm('清空画布？可以用 Ctrl+Z 撤销。')) return;
    const before = this.snapshot();
    this.board.nodes = [];
    this.board.edges = [];
    this.selection.clear();
    this.edgeSelection = null;
    this.recordHistory(before);
    this.renderAll();
    this.saveDebounced();
  }

  fitAll(): void {
    this.fitNodes(this.board.nodes);
  }

  private fitNodes(nodes: AtlasNode[]): void {
    const bounds = nodesBounds(nodes);
    const rect = this.stage.getBoundingClientRect();
    if (!bounds || rect.width < 10 || rect.height < 10) return;
    const pad = 120;
    const width = bounds.maxX - bounds.minX + pad * 2;
    const height = bounds.maxY - bounds.minY + pad * 2;
    const z = clamp(Math.min(rect.width / width, rect.height / height), MIN_ZOOM, 1.2);
    this.viewport.z = z;
    this.viewport.x = rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * z;
    this.viewport.y = rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * z;
    this.applyTransform();
    this.saveDebounced();
  }

  async reloadAll(): Promise<void> {
    this.saveDebounced?.cancel();
    await this.saveNow();
    await this.loadAll();
  }

  // ── helpers ──────────────────────────────────────────────

  private getNode(id: string): AtlasNode | undefined {
    return this.board.nodes.find((node) => node.id === id);
  }

  private fieldOf(node: AtlasNode): string {
    return this.index.get(node.paper)?.primaryField || '未分类';
  }

  private coverUrl(path: string): string {
    return this.app.vault.adapter.getResourcePath(path);
  }

  private screenToBoard(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.viewport.x) / this.viewport.z,
      y: (clientY - rect.top - this.viewport.y) / this.viewport.z,
    };
  }

  private viewportCenter(): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return this.screenToBoard(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private centerOn(node: AtlasNode): void {
    const rect = this.stage.getBoundingClientRect();
    this.viewport.x = rect.width / 2 - (node.x + node.w / 2) * this.viewport.z;
    this.viewport.y = rect.height / 2 - (node.y + node.h / 2) * this.viewport.z;
    this.applyTransform();
    this.saveDebounced();
  }

  private updateLegend(): void {
    if (!this.legendEl) return;
    this.legendEl.empty();
    const counts = new Map<string, number>();
    for (const node of this.board.nodes) {
      const field = this.fieldOf(node);
      counts.set(field, (counts.get(field) || 0) + 1);
    }
    const entries = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'),
    );

    const head = el('div', 'pa-legend-head');
    head.append(el('span', 'pa-legend-title', '领域'), el('span', 'pa-legend-total', String(this.board.nodes.length)));
    this.legendEl.appendChild(head);

    for (const [field, count] of entries) {
      const color = paletteFor(this.palette, field);
      const row = el('div', 'pa-legend-row');
      const dot = el('span', 'pa-legend-dot');
      dot.style.background = color.border;
      row.append(dot, el('span', 'pa-legend-name', field), el('span', 'pa-legend-count', String(count)));
      this.legendEl.appendChild(row);
    }
    this.legendEl.classList.toggle('is-empty', entries.length === 0);
  }

  private toggleLegend(): void {
    this.plugin.settings.showLegend = !this.plugin.settings.showLegend;
    this.root.classList.toggle('pa-legend-open', this.plugin.settings.showLegend);
    void this.plugin.saveSettings();
  }

  // ── vault watching & persistence ─────────────────────────

  private onVaultTouch(path: string): void {
    if (path === this.boardPath) return;
    if (/\.pcanvas(\.(tmp|bak))?$/.test(path)) return;
    if (!path.startsWith(`${this.plugin.settings.paperFolder}/`)) return;
    this.rescanDebounced();
  }

  private onVaultRename(path: string, oldPath: string): void {
    // 用户重命名画布文件：跟着改路径
    if (oldPath === this.boardPath) {
      this.boardPath = path;
      this.plugin.settings.boardPath = path;
      void this.plugin.saveSettings();
      return;
    }
    // 我们自己保存时的 tmp -> pcanvas 改名，不触发论文重扫
    if (/\.pcanvas(\.(tmp|bak))?$/.test(path) || /\.pcanvas(\.(tmp|bak))?$/.test(oldPath)) {
      return;
    }
    // 论文从「未阅读」移到「已阅读」时会连文件名一起改，卡片要跟着走
    const affected = this.board.nodes.filter((node) => node.paper === oldPath);
    if (affected.length) {
      for (const node of affected) node.paper = path;
      this.renderAll();
      this.saveDebounced();
    }
    if (path.startsWith(`${this.plugin.settings.paperFolder}/`)) this.rescanDebounced();
  }

  private async refreshPapers(): Promise<void> {
    if (this.drag || this.editing) {
      this.rescanDebounced();
      return;
    }
    await this.index.refresh();
    this.renderNodes();
    this.renderGroups();
    this.renderSidebarList();
    this.updateEdges();
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private saveQueue: Promise<void> = Promise.resolve();

  private saveNow(): Promise<void> {
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() => this.writeBoard());
    return this.saveQueue;
  }

  private async writeBoard(): Promise<void> {
    if (!this.loaded || this.readFailed || !this.boardPath) return;
    const payload = serializeBoard(this.board);
    const adapter = this.app.vault.adapter;
    const backupPath = `${this.boardPath}.bak`;
    const tempPath = `${this.boardPath}.tmp`;
    try {
      const dir = this.boardPath.split('/').slice(0, -1).join('/');
      await this.ensureFolder(dir);

      // 先留一份上一次的完整内容；当前文件解析不了就不要覆盖旧备份
      if (await adapter.exists(this.boardPath)) {
        const current = await adapter.read(this.boardPath);
        if (parseBoard(current)) {
          await adapter.write(backupPath, current);
        }
      }

      // 写临时文件再原子改名，避免读到写了一半的 JSON
      await adapter.write(tempPath, payload);
      try {
        await adapter.rename(tempPath, this.boardPath);
      } catch (renameError) {
        console.warn('Paper Atlas: rename failed, falling back to direct write', renameError);
        await adapter.write(this.boardPath, payload);
        if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
      }
    } catch (error) {
      console.error('Paper Atlas: save failed', error);
      new Notice('Paper Atlas：画布保存失败，请检查文件路径');
    }
  }
}
