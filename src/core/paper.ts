import type { PaperEntry, PaperImage, ReadStatus, UnderstandingSource } from '../types';
import { cleanNoteText, excerpt, firstString, normalizeDate, toStringList } from './text';

export interface BuildPaperInput {
  path: string;
  basename: string;
  frontmatter?: Record<string, unknown>;
  content: string;
  /** Resolve an embed target ("a.png", "folder/b.png") to a vault path. */
  resolve: (link: string) => string | null;
}

const TITLE_PREFIX = /^(?:【[^】]*】\s*[-—_]\s*)/;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Body of the first `## title` section (until the next H1/H2). */
export function extractSection(content: string, title: string): string | null {
  const re = new RegExp(`^##[ \\t]+${escapeRegex(title)}[ \\t]*$`, 'm');
  const match = re.exec(content);
  if (!match) return null;
  const rest = content.slice(match.index + match[0].length);
  const next = /^#{1,2}[ \t]+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Raw embed targets in reading order, ignoring code fences. */
export function extractImageLinks(content: string): string[] {
  const body = content.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
  const links: string[] = [];
  const wiki = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const md = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(body)) !== null) links.push((match[1] as string).trim());
  while ((match = md.exec(body)) !== null) links.push((match[1] as string).trim());
  return links;
}

export function deriveStatus(path: string, frontmatter?: Record<string, unknown>): ReadStatus {
  if (/已阅读/.test(path)) {
    if (/【精读】/.test(path)) return 'intensive';
    if (/【粗读】/.test(path)) return 'skimmed';
    return 'read';
  }
  if (/未阅读/.test(path)) return 'unread';

  const raw = firstString(frontmatter?.reading_status).toLowerCase();
  if (raw === 'skimmed' || raw === '粗读') return 'skimmed';
  if (raw === 'intensive' || raw === '精读') return 'intensive';
  if (raw === 'read' || raw === '已读') return 'read';
  return 'unread';
}

function resolveImages(
  links: string[],
  resolve: (link: string) => string | null,
): PaperImage[] {
  const seen = new Set<string>();
  const images: PaperImage[] = [];
  for (const link of links) {
    const path = resolve(link);
    const key = path || link;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({ link, path: path || '' });
  }
  return images;
}

function firstParagraph(text: string): string {
  const clean = cleanNoteText(text);
  const paragraph = clean.split(/\n\s*\n/).find((part) => part.trim().length > 0) || '';
  return paragraph.trim();
}

/** Strip the callout scaffolding that wraps translated abstracts. */
function cleanAbstract(raw: string): string {
  return cleanNoteText(raw)
    .split('\n')
    .filter((line) => !/^\[!.*?\]-?$/.test(line.trim()))
    .join('\n')
    .trim();
}

export function buildPaper(input: BuildPaperInput): PaperEntry {
  const fm = input.frontmatter || {};
  const content = input.content;

  const h1 = /^#[ \t]+(.+)$/m.exec(content);
  const fallbackTitle = input.basename.replace(TITLE_PREFIX, '').replace(/\.md$/i, '');
  const title = firstString(fm.title) || (h1 ? (h1[1] as string).trim() : '') || fallbackTitle;

  const authors = toStringList(fm.authors ?? fm.author);
  const fields = toStringList(fm.fields);
  const primaryField = fields[0] || firstString(fm.field) || '未分类';
  if (!fields.length && primaryField) fields.push(primaryField);

  const rawDate = firstString(fm.date ?? fm.publishDate ?? fm.year ?? fm.added_at);
  const date = normalizeDate(rawDate);

  const institution = toStringList(fm.institutions ?? fm.affiliations ?? fm.institution).join(' · ');

  const coverHint = firstString(fm.cover);
  const imageLinks = extractImageLinks(content);
  if (coverHint) imageLinks.unshift(coverHint);
  const images = resolveImages(imageLinks, input.resolve);

  const understandingSection = extractSection(content, '理解');
  const notesSection = extractSection(content, '笔记');
  const abstractSection = extractSection(content, '摘要');

  let understanding = understandingSection ? cleanNoteText(understandingSection) : '';
  let understandingSource: UnderstandingSource = understanding ? 'heading' : 'none';
  if (!understanding && notesSection) {
    understanding = firstParagraph(notesSection);
    understandingSource = understanding ? 'notes' : 'none';
  }

  const abstract = cleanAbstract(firstString(fm.abstract) || abstractSection || '');
  if (!understanding && abstract) {
    understanding = excerpt(abstract, 140);
    understandingSource = 'abstract';
  }

  return {
    path: input.path,
    basename: input.basename,
    title,
    date: date.display,
    dateSort: date.sort,
    authors,
    institution,
    fields,
    primaryField,
    venue: firstString(fm.journal ?? fm.venue),
    status: deriveStatus(input.path, fm),
    images,
    understanding,
    understandingSource,
    abstract: excerpt(abstract, 600),
    url: firstString(fm.url),
    arxivId: firstString(fm.arxivId ?? fm.arxiv_id),
  };
}
