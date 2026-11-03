import type { AtlasNode } from '../types';

export interface LayoutOptions {
  gapX?: number;
  gapY?: number;
  padding?: number;
  headerHeight?: number;
  groupGap?: number;
  maxRowWidth?: number;
}

interface GroupPlan {
  field: string;
  nodes: AtlasNode[];
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/**
 * Cluster cards by primary field and pack the clusters into rows.
 * Only x/y are mutated; sizes chosen by the user are respected.
 */
export function autoLayout(
  nodes: AtlasNode[],
  fieldOf: (node: AtlasNode) => string,
  options: LayoutOptions = {},
): void {
  if (!nodes.length) return;

  const gapX = options.gapX ?? 24;
  const gapY = options.gapY ?? 24;
  const padding = options.padding ?? 28;
  const headerHeight = options.headerHeight ?? 46;
  const groupGap = options.groupGap ?? 72;
  const maxRowWidth = options.maxRowWidth ?? 5600;

  const groups = new Map<string, AtlasNode[]>();
  for (const node of nodes) {
    const field = fieldOf(node) || '未分类';
    const list = groups.get(field) || [];
    list.push(node);
    groups.set(field, list);
  }

  const plans: GroupPlan[] = [];
  for (const [field, list] of groups) {
    const cardW = Math.max(...list.map((node) => node.w));
    const cardH = Math.max(...list.map((node) => node.h));
    const cols = Math.max(1, Math.min(8, Math.round(Math.sqrt(list.length * 1.5))));
    const rows = Math.ceil(list.length / cols);
    plans.push({
      field,
      nodes: list,
      cols,
      rows,
      width: padding * 2 + cols * cardW + (cols - 1) * gapX,
      height: headerHeight + padding * 2 + rows * cardH + (rows - 1) * gapY,
    });
  }

  plans.sort((a, b) => b.nodes.length - a.nodes.length || a.field.localeCompare(b.field, 'zh-CN'));

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const plan of plans) {
    if (cursorX > 0 && cursorX + plan.width > maxRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + groupGap;
      rowHeight = 0;
    }

    plan.nodes.forEach((node, index) => {
      const col = index % plan.cols;
      const row = Math.floor(index / plan.cols);
      node.x = cursorX + padding + col * (node.w + gapX);
      node.y = cursorY + headerHeight + padding + row * (node.h + gapY);
    });

    cursorX += plan.width + groupGap;
    rowHeight = Math.max(rowHeight, plan.height);
  }
}

/** Bounding box of all nodes, or null when empty. */
export function nodesBounds(nodes: AtlasNode[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  }
  return { minX, minY, maxX, maxY };
}
