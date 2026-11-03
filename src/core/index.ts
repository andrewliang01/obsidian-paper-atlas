import { App, TFile } from 'obsidian';
import type { PaperEntry } from '../types';
import { buildPaper } from './paper';

function isUnder(path: string, folder: string): boolean {
  const root = folder.replace(/\/+$/, '');
  if (!root) return true;
  return path === root || path.startsWith(`${root}/`);
}

export class PaperIndex {
  private entries: PaperEntry[] = [];
  private byPath = new Map<string, PaperEntry>();

  constructor(
    private readonly app: App,
    private readonly folder: string,
  ) {}

  get all(): PaperEntry[] {
    return this.entries;
  }

  get(path: string): PaperEntry | undefined {
    return this.byPath.get(path);
  }

  get size(): number {
    return this.entries.length;
  }

  fields(): string[] {
    const set = new Set<string>();
    for (const entry of this.entries) for (const field of entry.fields) set.add(field);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  /** All images referenced by the note, best-effort resolution. */
  imagesFor(path: string): PaperEntry['images'] {
    return this.byPath.get(path)?.images ?? [];
  }

  async refresh(): Promise<void> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => isUnder(file.path, this.folder))
      .sort((a, b) => a.path.localeCompare(b.path));

    const entries: PaperEntry[] = [];
    for (const file of files) {
      const entry = await this.readPaper(file);
      if (entry) entries.push(entry);
    }

    entries.sort((a, b) => b.dateSort - a.dateSort || a.title.localeCompare(b.title, 'zh-CN'));
    this.entries = entries;
    this.byPath = new Map(entries.map((entry) => [entry.path, entry]));
  }

  async readPaper(file: TFile): Promise<PaperEntry | null> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!frontmatter?.title && !frontmatter?.authors && !frontmatter?.author) return null;

    const content = await this.app.vault.cachedRead(file);
    return buildPaper({
      path: file.path,
      basename: file.basename,
      frontmatter,
      content,
      resolve: (link) => this.resolveLink(link, file.path),
    });
  }

  resolveLink(link: string, sourcePath: string): string | null {
    const clean = link.split('#')[0]?.trim() || '';
    if (!clean) return null;
    const direct = this.app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
    if (direct) return direct.path;
    const file = this.app.vault.getAbstractFileByPath(clean);
    return file instanceof TFile ? file.path : null;
  }
}
