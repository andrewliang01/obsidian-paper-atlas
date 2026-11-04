import type {
  AtlasBoard,
  AtlasEdge,
  AtlasNode,
  AtlasViewport,
  CardOverrides,
  EdgeArrow,
  EdgeSide,
  YearLine,
} from '../types';

const BOARD_VERSION = 1;

export function emptyBoard(): AtlasBoard {
  return { version: BOARD_VERSION, viewport: { x: 0, y: 0, z: 1 }, nodes: [], edges: [], years: [] };
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseOverrides(raw: unknown): CardOverrides | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const overrides: CardOverrides = {};
  if (typeof source.title === 'string') overrides.title = source.title;
  if (typeof source.date === 'string') overrides.date = source.date;
  if (typeof source.venue === 'string') overrides.venue = source.venue;
  if (typeof source.institution === 'string') overrides.institution = source.institution;
  if (typeof source.understanding === 'string') overrides.understanding = source.understanding;
  if (typeof source.cover === 'string') overrides.cover = source.cover;
  if (Array.isArray(source.authors)) {
    overrides.authors = source.authors.filter((item): item is string => typeof item === 'string');
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

function parseNode(raw: unknown): AtlasNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== 'string' || typeof source.paper !== 'string') return null;
  return {
    id: source.id,
    paper: source.paper,
    x: num(source.x, 0),
    y: num(source.y, 0),
    w: Math.max(160, num(source.w, 380)),
    h: Math.max(140, num(source.h, 470)),
    overrides: parseOverrides(source.overrides),
    expanded: source.expanded === true,
  };
}

function parseEdge(raw: unknown, nodeIds: Set<string>): AtlasEdge | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== 'string') return null;
  if (typeof source.from !== 'string' || typeof source.to !== 'string') return null;
  if (!nodeIds.has(source.from) || !nodeIds.has(source.to) || source.from === source.to) return null;
  const edge: AtlasEdge = { id: source.id, from: source.from, to: source.to };
  if (typeof source.label === 'string' && source.label.trim()) edge.label = source.label;
  if (typeof source.color === 'string') edge.color = source.color;
  const sides: EdgeSide[] = ['top', 'right', 'bottom', 'left'];
  if (typeof source.fromSide === 'string' && sides.includes(source.fromSide as EdgeSide)) {
    edge.fromSide = source.fromSide as EdgeSide;
  }
  if (typeof source.toSide === 'string' && sides.includes(source.toSide as EdgeSide)) {
    edge.toSide = source.toSide as EdgeSide;
  }
  if (source.arrow === 'both' || source.arrow === 'none') edge.arrow = source.arrow as EdgeArrow;
  return edge;
}

function parseViewport(raw: unknown): AtlasViewport {
  if (!raw || typeof raw !== 'object') return { x: 0, y: 0, z: 1 };
  const source = raw as Record<string, unknown>;
  return {
    x: num(source.x, 0),
    y: num(source.y, 0),
    z: Math.min(4, Math.max(0.05, num(source.z, 1))),
  };
}

/** Returns null when the file is not valid JSON — callers must not overwrite it. */
export function parseBoard(raw: string): AtlasBoard | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const source = data as Record<string, unknown>;

  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = rawNodes.map(parseNode).filter((node): node is AtlasNode => node !== null);
  const nodeIds = new Set(nodes.map((node) => node.id));

  const rawYears = Array.isArray(source.years) ? source.years : [];
  const years: YearLine[] = rawYears
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const item = raw as Record<string, unknown>;
      if (typeof item.year !== 'number' || !Number.isFinite(item.year)) return null;
      if (typeof item.y !== 'number' || !Number.isFinite(item.y)) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `y_${item.year}`,
        year: Math.round(item.year),
        y: item.y,
      };
    })
    .filter((line): line is YearLine => line !== null);

  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edges = rawEdges
    .map((edge) => parseEdge(edge, nodeIds))
    .filter((edge): edge is AtlasEdge => edge !== null);

  return { version: BOARD_VERSION, viewport: parseViewport(source.viewport), nodes, edges, years };
}

export function serializeBoard(board: AtlasBoard): string {
  return `${JSON.stringify(
    {
      version: BOARD_VERSION,
      viewport: {
        x: Math.round(board.viewport.x * 100) / 100,
        y: Math.round(board.viewport.y * 100) / 100,
        z: Math.round(board.viewport.z * 1000) / 1000,
      },
      nodes: board.nodes.map((node) => {
        const out: Record<string, unknown> = {
          id: node.id,
          paper: node.paper,
          x: Math.round(node.x),
          y: Math.round(node.y),
          w: Math.round(node.w),
          h: Math.round(node.h),
        };
        if (node.expanded) out.expanded = true;
        if (node.overrides && Object.keys(node.overrides).length) out.overrides = node.overrides;
        return out;
      }),
      edges: board.edges,
      years: board.years,
    },
    null,
    1,
  )}\n`;
}

/** True when the board has a card for the note. */
export function findNodeByPaper(board: AtlasBoard, paperPath: string): AtlasNode | undefined {
  return board.nodes.find((node) => node.paper === paperPath);
}

export function summarize(board: AtlasBoard): { nodes: number; edges: number } {
  return { nodes: board.nodes.length, edges: board.edges.length };
}
