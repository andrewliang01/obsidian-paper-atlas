/** Text helpers: date normalisation, list coercion, cleanup of AI markers, tiny markdown renderer. */

const AI_BEGIN = /^%%\s*AI:\s*(BEGIN|END)\b.*%%$/i;
const HTML_COMMENT_ONLY = /^<!--[\s\S]*-->$/;
const AI_NOTE_LINE = /^[〔【]\s*AI\s*生成.*[〕】]$/;
const INLINE_AI_COMMENT = /%%.*?%%/g;

/** Turn `2025/08/11`, `2025-8-11`, `2025` or an ISO timestamp into a display date + sort key. */
export function normalizeDate(raw: string): { display: string; sort: number } {
  const text = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!text) return { display: '', sort: 0 };

  const full = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    const display = `${full[1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { display, sort: Date.UTC(y, m - 1, d) };
  }

  const yearOnly = /^(\d{4})$/.exec(text);
  if (yearOnly) {
    return { display: yearOnly[1] as string, sort: Date.UTC(Number(yearOnly[1]), 0, 1) };
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const display = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dt.getUTCDate(),
    ).padStart(2, '0')}`;
    return { display, sort: parsed };
  }

  return { display: text, sort: 0 };
}

/** Coerce a frontmatter value into a clean string list. */
export function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : typeof item === 'number' ? String(item) : ''))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') {
    return value
      .split(/[;；]|\s*,\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return toStringList(value)[0] || '';
  return '';
}

/**
 * Remove the artifacts that the paper-reading skill leaves in notes: AI block markers,
 * HTML comments, highlight marks, trailing ✦ and the "AI 生成" footer.
 * The marker lines themselves are dropped, the content inside them is kept.
 */
export function cleanNoteText(raw: string): string {
  if (!raw) return '';
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push('');
      continue;
    }
    if (AI_BEGIN.test(trimmed)) continue;
    if (HTML_COMMENT_ONLY.test(trimmed)) continue;
    if (AI_NOTE_LINE.test(trimmed)) continue;
    if (/^`{3,}/.test(trimmed)) {
      kept.push('');
      continue;
    }

    let text = line
      .replace(INLINE_AI_COMMENT, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/==/g, '')
      .replace(/[✦✧]\s*$/u, '')
      .replace(/!\[\[[^\]]*\]\]/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .trimEnd();

    if (/^\s*```/.test(text)) continue;
    text = text.replace(/^\s{0,3}>\s?/, '');
    kept.push(text);
  }

  return kept
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function excerpt(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit).trimEnd()}…`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface InlineRule {
  re: RegExp;
  render: (groups: string[]) => string;
}

const INLINE_RULES: InlineRule[] = [
  {
    re: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    render: (g) => {
      const target = g[0] || '';
      const alias = g[1] || target;
      return `<span class="pa-wikilink" data-href="${escapeHtml(target)}">${escapeHtml(alias)}</span>`;
    },
  },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/g,
    render: (g) =>
      `<a class="pa-extlink" href="${escapeHtml(g[1] || '')}" target="_blank" rel="noreferrer">${escapeHtml(
        g[0] || '',
      )}</a>`,
  },
  { re: /\*\*([^*]+)\*\*/g, render: (g) => `<strong>${escapeHtml(g[0] || '')}</strong>` },
  { re: /==([^=]+)==/g, render: (g) => `<mark class="pa-mark">${escapeHtml(g[0] || '')}</mark>` },
  { re: /`([^`]+)`/g, render: (g) => `<code>${escapeHtml(g[0] || '')}</code>` },
  {
    re: /(^|[^*])\*([^*\n]+)\*/g,
    render: (g) => `${g[0] || ''}<em>${escapeHtml(g[1] || '')}</em>`,
  },
];

function renderInline(text: string): string {
  let html = escapeHtml(text);
  for (const rule of INLINE_RULES) {
    html = html.replace(rule.re, (_match: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2).map((value) => (value == null ? '' : String(value)));
      return rule.render(groups);
    });
  }
  return html;
}

/** Minimal block renderer: paragraphs, list items, quotes, h4 for `###`. */
export function renderLiteMarkdown(text: string): string {
  if (!text.trim()) return '';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list.length) {
      out.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };
  const flushQuote = (): void => {
    if (quote.length) {
      out.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }
    const listMatch = /^[-*+]\s+(.*)$/.exec(trimmed) || /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      list.push(listMatch[1] as string);
      continue;
    }
    const quoteMatch = /^>\s?(.*)$/.exec(trimmed);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1] as string);
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushAll();
      const level = Math.min(6, (headingMatch[1] as string).length + 2);
      out.push(`<h${level}>${renderInline(headingMatch[2] as string)}</h${level}>`);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }
  flushAll();
  return out.join('');
}
