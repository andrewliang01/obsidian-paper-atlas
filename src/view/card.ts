import type {
  AtlasNode,
  CardOverrides,
  FieldPaletteEntry,
  PaperEntry,
  ReadStatus,
  UnderstandingSource,
} from '../types';
import { STATUS_LABEL } from '../types';
import { paletteFor, type FieldPalette } from '../core/colors';
import { renderLiteMarkdown } from '../core/text';
import { el } from './dom';

export interface CardModel {
  title: string;
  date: string;
  venue: string;
  status: ReadStatus;
  authors: string[];
  institution: string;
  cover: string | null;
  understanding: string;
  understandingSource: UnderstandingSource;
  field: string;
  accent: string;
  tint: string;
  accentText: string;
  missing: boolean;
  hasOverrides: boolean;
}

export function resolveCard(
  node: AtlasNode,
  paper: PaperEntry | undefined,
  palette: FieldPalette,
): CardModel {
  const overrides: CardOverrides = node.overrides || {};
  const field = paper?.primaryField || '未分类';
  const color: FieldPaletteEntry = paletteFor(palette, field);

  const authors = overrides.authors ?? paper?.authors ?? [];
  const institution = overrides.institution ?? paper?.institution ?? '';
  const cover = overrides.cover ?? paper?.images.find((image) => image.path)?.path ?? null;
  const understanding = overrides.understanding ?? paper?.understanding ?? '';
  const understandingSource: UnderstandingSource =
    overrides.understanding != null ? 'heading' : paper?.understandingSource ?? 'none';

  return {
    title: overrides.title ?? paper?.title ?? '笔记已删除',
    date: overrides.date ?? paper?.date ?? '',
    venue: overrides.venue ?? paper?.venue ?? '',
    status: paper?.status ?? 'unread',
    authors,
    institution,
    cover,
    understanding,
    understandingSource,
    field,
    accent: color.border,
    tint: color.bg,
    accentText: color.text,
    missing: !paper,
    hasOverrides: Boolean(node.overrides && Object.keys(node.overrides).length),
  };
}

const SOURCE_LABEL: Record<UnderstandingSource, string> = {
  heading: '',
  notes: '笔记',
  abstract: '摘要',
  none: '',
};

export interface CardElements {
  root: HTMLElement;
  title: HTMLElement;
  date: HTMLElement;
  venue: HTMLElement;
  authors: HTMLElement;
  institution: HTMLElement;
  cover: HTMLElement;
  understanding: HTMLElement;
  understandingBody: HTMLElement;
  source: HTMLElement;
  toggle: HTMLElement;
}

function authorLine(authors: string[]): string {
  if (!authors.length) return '作者未标注';
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')} 等 ${authors.length} 人`;
}

function coverPlaceholder(): HTMLElement {
  const holder = el('div', 'pa-cover-empty');
  holder.append(el('span', 'pa-cover-glyph', '🖼'), el('span', 'pa-cover-text', '无封面图'));
  return holder;
}

export function buildCardElement(
  model: CardModel,
  node: AtlasNode,
  resolveCoverUrl: (path: string) => string,
  renderMarkdown?: (el: HTMLElement, markdown: string, sourcePath: string) => void,
): CardElements {
  const root = el('div', 'pa-card');
  root.style.setProperty('--pa-accent', model.accent);
  root.style.setProperty('--pa-tint', model.tint);
  root.classList.toggle('is-missing', model.missing);
  root.classList.toggle('is-expanded', Boolean(node.expanded));
  root.classList.toggle('has-overrides', model.hasOverrides);
  root.classList.toggle('no-cover', !model.cover);

  root.appendChild(el('div', 'pa-bar'));

  const inner = el('div', 'pa-card-inner');

  const title = el('div', 'pa-title', model.title);
  title.dataset.paField = 'title';
  title.title = model.title;
  inner.appendChild(title);

  const meta = el('div', 'pa-meta');
  const date = el('span', 'pa-date', model.date || '时间未知');
  date.dataset.paField = 'date';
  meta.appendChild(date);

  if (model.venue) {
    meta.appendChild(el('span', 'pa-dot', '·'));
    const venue = el('span', 'pa-venue', model.venue);
    venue.dataset.paField = 'venue';
    meta.appendChild(venue);
  }

  if (model.field) {
    const fieldPill = el('span', 'pa-field-pill', model.field);
    fieldPill.title = model.field;
    meta.appendChild(fieldPill);
  }

  const status = el('span', `pa-status pa-status-${model.status}`, STATUS_LABEL[model.status]);
  meta.appendChild(status);
  inner.appendChild(meta);

  const authors = el('div', 'pa-authors', authorLine(model.authors));
  authors.dataset.paField = 'authors';
  inner.appendChild(authors);

  const institution = el(
    'div',
    `pa-inst${model.institution ? '' : ' is-empty'}`,
    model.institution || '未标注',
  );
  institution.dataset.paField = 'institution';
  if (model.institution) institution.title = model.institution;
  institution.prepend(el('span', 'pa-inst-glyph', '🏛'));
  inner.appendChild(institution);

  const cover = el('div', 'pa-cover');
  cover.dataset.paAction = 'cover';
  if (model.cover) {
    const img = el('img', 'pa-cover-img');
    img.src = resolveCoverUrl(model.cover);
    img.loading = 'lazy';
    img.draggable = false;
    img.alt = '';
    cover.appendChild(img);
    const swap = el('button', 'pa-cover-swap', '更换封面');
    swap.type = 'button';
    swap.dataset.paAction = 'cover';
    cover.appendChild(swap);
  } else {
    cover.appendChild(coverPlaceholder());
  }
  inner.appendChild(cover);

  const understanding = el('div', 'pa-under');
  const head = el('div', 'pa-under-head');
  head.dataset.paAction = 'toggle-under';
  head.append(el('span', 'pa-under-label', '理解'));
  const source = el('span', 'pa-src', SOURCE_LABEL[model.understandingSource]);
  if (!source.textContent) source.classList.add('is-hidden');
  head.appendChild(source);
  const toggle = el('span', 'pa-under-toggle', node.expanded ? '收起' : '展开');
  head.appendChild(toggle);
  understanding.appendChild(head);

  const body = el('div', 'pa-under-body');
  if (model.understanding.trim()) {
    body.innerHTML = renderLiteMarkdown(model.understanding);
    if (renderMarkdown && /[$*_[\]`]|(^|\n)\s*[-*+]\s|(^|\n)#{1,6}\s/.test(model.understanding)) {
      body.innerHTML = '';
      renderMarkdown(body, model.understanding, node.paper);
    }
  } else {
    body.appendChild(el('div', 'pa-under-empty', '暂无理解，双击卡片右上角的 ⋯ 可以补充'));
  }
  body.dataset.paField = 'understanding';
  understanding.appendChild(body);
  inner.appendChild(understanding);

  const foot = el('div', 'pa-foot');
  const openNote = el('span', 'pa-foot-link', '打开笔记');
  openNote.dataset.paAction = 'open-note';
  foot.appendChild(openNote);

  if (model.missing) {
    foot.appendChild(el('span', 'pa-foot-warn', '笔记已删除'));
  }
  inner.appendChild(foot);

  root.appendChild(inner);
  return {
    root,
    title,
    date,
    venue: meta.querySelector('.pa-venue') as HTMLElement,
    authors,
    institution,
    cover,
    understanding,
    understandingBody: body,
    source,
    toggle,
  };
}
