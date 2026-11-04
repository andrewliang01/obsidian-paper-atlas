/**
 * Standalone smoke tests: run with `node tests/run.cjs` after
 * `npx esbuild tests/run.ts --bundle --platform=node --format=cjs --outfile=tests/run.cjs`.
 * These exercise the pure core modules against the real vault notes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildPaper, extractImageLinks, extractSection } from '../src/core/paper';
import { autoLayout, nodesBounds } from '../src/core/layout';
import { emptyBoard, parseBoard, serializeBoard } from '../src/core/board';
import { cleanNoteText, normalizeDate, renderLiteMarkdown } from '../src/core/text';
import type { AtlasNode } from '../src/types';

const VAULT = '/home/andew/Nutstore Files/我的坚果云/Obsidian';
const PAPERS = join(VAULT, '30_References/Paper/manager');

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

// ── tiny frontmatter parser (the plugin uses Obsidian's metadata cache) ──

type Frontmatter = Record<string, unknown>;

function parseFrontmatter(content: string): Frontmatter {
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

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

function buildFromFile(path: string) {
  const content = readFileSync(path, 'utf8');
  const relative = path.slice(VAULT.length + 1);
  const basename = relative.split('/').pop()!.replace(/\.md$/, '');
  return buildPaper({
    path: relative,
    basename,
    frontmatter: parseFrontmatter(content),
    content,
    resolve: (link) => link,
  });
}

// ── tests ─────────────────────────────────────────────────

console.log('\n[1] 日期与文本清洗');
check('2025/08/11 -> 2025-08-11', normalizeDate('2025/08/11').display === '2025-08-11');
check('2025-8-1 -> 2025-08-01', normalizeDate('2025-8-1').display === '2025-08-01');
check('年份排序可比较', normalizeDate('2024').sort > 0);

const dirty = [
  '## 理解',
  '%% AI:BEGIN demo %%',
  '<!-- 注释 -->',
  '这是==重点==内容。',
  '最后一句✦',
  '〔AI 生成 · 2026-01-01〕',
  '%% AI:END demo %%',
].join('\n');
const cleaned = cleanNoteText(dirty);
check('保留标记内的内容', cleaned.includes('这是重点内容。'));
check('移除 AI 标记', !cleaned.includes('AI:BEGIN') && !cleaned.includes('AI:END'));
check('移除 HTML 注释与高亮符号', !cleaned.includes('<!--') && !cleaned.includes('=='));
check('移除段尾 ✦ 与 AI 署名', !cleaned.includes('✦') && !cleaned.includes('AI 生成'));

check('标题层级取 ## 理解', extractSection('# A\n## 理解\n正文\n## 摘要\n其他', '理解')?.trim() === '正文');
check('图片按出现顺序提取', extractImageLinks('a\n![[x.png]]\n![](y.png)').join(',') === 'x.png,y.png');

console.log('\n[2] 轻量 Markdown 渲染');
const html = renderLiteMarkdown('**粗** 与 ==高亮== <script>alert(1)</script>');
check('粗体渲染', html.includes('<strong>粗</strong>'));
check('高亮渲染', html.includes('<mark'));
check('HTML 注入被转义', html.includes('&lt;script&gt;') && !html.includes('<script>'));

console.log('\n[3] 真实论文笔记解析');
const files = listMarkdown(PAPERS);
console.log(`  扫描到 ${files.length} 篇笔记`);
check('笔记数量 >= 90', files.length >= 90, String(files.length));

const papers = files.map(buildFromFile);
const withTitle = papers.filter((paper) => paper.title.trim().length > 0).length;
const withDate = papers.filter((paper) => paper.date.trim().length > 0).length;
const withAuthors = papers.filter((paper) => paper.authors.length > 0).length;
const withImages = papers.filter((paper) => paper.images.length > 0).length;
const withUnderstanding = papers.filter((paper) => paper.understandingSource === 'heading').length;
const withInstitution = papers.filter((paper) => paper.institution.length > 0).length;
console.log(`  题目 ${withTitle} / 日期 ${withDate} / 作者 ${withAuthors} / 图片 ${withImages} / 理解 ${withUnderstanding} / 机构 ${withInstitution}`);
check('全部有题目', withTitle === papers.length);
check('全部有日期', withDate === papers.length);
check('全部有作者', withAuthors === papers.length);
check('机构字段已回填大部分论文', withInstitution >= 80, `实际 ${withInstitution}`);
check('图片覆盖率约 37 篇', withImages >= 30 && withImages <= 45, String(withImages));

const beyond = papers.find((paper) => paper.title.startsWith('BeyondMimic'));
check('BeyondMimic 找到', Boolean(beyond));
if (beyond) {
  check('BeyondMimic 时间', beyond.date === '2025-08-11', beyond.date);
  check('BeyondMimic 作者数 7', beyond.authors.length === 7, String(beyond.authors.length));
  check('BeyondMimic 领域', beyond.primaryField === 'Whole-body Motion', beyond.primaryField);
}

const watch = papers.find((paper) => paper.title.includes('Watch Your Step'));
check('Watch Your Step 找到', Boolean(watch));
if (watch) {
  check('理解来自二级标题', watch.understandingSource === 'heading', watch.understandingSource);
  check('理解内容非空', watch.understanding.length > 50, String(watch.understanding.length));
  check('理解残留 AI 标记已清洗', !/%%|==|<!--|〔AI|✦/.test(watch.understanding), watch.understanding.slice(0, 60));
}

const gmt = papers.find((paper) => paper.title.startsWith('GMT'));
check('GMT 找到', Boolean(gmt));
if (gmt) {
  check('GMT 理解有回退内容', gmt.understanding.length > 0);
  check('GMT 图片已解析', gmt.images.length > 0);
}

console.log('\n[4] 画布数据层');
const board = emptyBoard();
const nodes: AtlasNode[] = [
  { id: 'a', paper: 'p1.md', x: 0, y: 0, w: 380, h: 470 },
  { id: 'b', paper: 'p2.md', x: 0, y: 0, w: 380, h: 470, overrides: { title: '自定义' } },
  { id: 'c', paper: 'p3.md', x: 0, y: 0, w: 380, h: 470 },
];
board.nodes = nodes;
board.edges = [
  { id: 'e1', from: 'a', to: 'b', label: '改进' },
  { id: 'e2', from: 'b', to: 'ghost' },
];
board.years = [
  { id: 'y1', year: 2025, y: 100 },
  { id: 'y2', year: 2024, y: 820 },
];
const raw = serializeBoard(board);
const parsed = parseBoard(raw);
check('节点数量保持', parsed?.nodes.length === 3);
check('覆盖值保持', parsed?.nodes[1]?.overrides?.title === '自定义');
check('悬空连线被丢弃', parsed?.edges.length === 1);
check('年份横线保持', parsed?.years.length === 2 && parsed?.years[0]?.year === 2025,
  JSON.stringify(parsed?.years));
check('连线标签保持', parsed?.edges[0]?.label === '改进');
check('坏 JSON 不会被当成空画布', parseBoard('{oops') === null);
check('视口被夹紧', (parseBoard('{"viewport":{"z":999}}')?.viewport.z ?? 99) <= 4);

console.log('\n[5] 自动布局');
autoLayout(nodes, (node) => (node.id === 'a' ? 'A 领域' : 'B 领域'));
const bounds = nodesBounds(nodes);
check('所有节点都分配了坐标', nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
check('布局范围合理', Boolean(bounds) && bounds!.maxX - bounds!.minX > 700, String(bounds?.maxX));
const sameGroup = nodes.filter((node) => node.id !== 'a');
check('同组卡片不重叠', sameGroup[0]!.x !== sameGroup[1]!.x);

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed > 0) process.exit(1);
