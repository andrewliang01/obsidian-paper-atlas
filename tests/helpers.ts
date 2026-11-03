import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Frontmatter = Record<string, unknown>;

/** Minimal YAML subset used by this vault's paper notes (test helper only). */
export function parseFrontmatter(content: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const lines = (match[1] as string).split(/\r?\n/);
  const out: Frontmatter = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    const block = /^\s*-\s+(.*)$/.exec(line);
    if (block && currentKey) {
      const list = (out[currentKey] as string[]) || [];
      list.push(String(block[1]).replace(/^["']|["']$/g, '').trim());
      out[currentKey] = list;
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    currentKey = pair[1] as string;
    const raw = (pair[2] as string).trim();
    if (!raw) continue;
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const body = raw.slice(1, -1).trim();
      out[currentKey] = body
        ? body.split(',').map((part) => part.trim().replace(/^["']|["']$/g, ''))
        : [];
    } else {
      out[currentKey] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

export function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function readUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}
