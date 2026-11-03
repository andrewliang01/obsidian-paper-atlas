import type { AtlasNode, EdgeSide } from '../types';

export interface EdgeGeometry {
  d: string;
  midX: number;
  midY: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

const NORMALS: Record<EdgeSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function sidePoint(node: AtlasNode, side: EdgeSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.w / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.w / 2, y: node.y + node.h };
    case 'left':
      return { x: node.x, y: node.y + node.h / 2 };
    default:
      return { x: node.x + node.w, y: node.y + node.h / 2 };
  }
}

/** Which side of the card is closest to a board-space point. */
export function nearestSide(node: AtlasNode, x: number, y: number): EdgeSide {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = (x - cx) / Math.max(1, node.w / 2);
  const dy = (y - cy) / Math.max(1, node.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function autoSides(from: AtlasNode, to: AtlasNode): [EdgeSide, EdgeSide] {
  return to.x + to.w / 2 >= from.x + from.w / 2 ? ['right', 'left'] : ['left', 'right'];
}

/** Cubic bezier between the requested card sides (auto-facing when omitted). */
export function edgeGeometry(
  from: AtlasNode,
  to: AtlasNode,
  fromSide?: EdgeSide,
  toSide?: EdgeSide,
): EdgeGeometry {
  let startSide = fromSide;
  let endSide = toSide;
  if (!startSide || !endSide) {
    const auto = autoSides(from, to);
    startSide = startSide || auto[0];
    endSide = endSide || auto[1];
  }

  const start = sidePoint(from, startSide);
  const end = sidePoint(to, endSide);
  const n0 = NORMALS[startSide];
  const n1 = NORMALS[endSide];
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const reach = Math.max(48, Math.min(240, distance * 0.42));
  const c1x = start.x + n0.x * reach;
  const c1y = start.y + n0.y * reach;
  const c2x = end.x + n1.x * reach;
  const c2y = end.y + n1.y * reach;

  const midX = (start.x + 3 * c1x + 3 * c2x + end.x) / 8;
  const midY = (start.y + 3 * c1y + 3 * c2y + end.y) / 8;

  return {
    d: `M ${round(start.x)} ${round(start.y)} C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(end.x)} ${round(end.y)}`,
    midX,
    midY,
    sx: start.x,
    sy: start.y,
    tx: end.x,
    ty: end.y,
  };
}

/** Path used while the pointer is still dragging a new connection. */
export function draftGeometry(
  from: AtlasNode,
  side: EdgeSide,
  pointer: { x: number; y: number },
): { d: string } {
  const start = sidePoint(from, side);
  const normal = NORMALS[side];
  const reach = Math.max(40, Math.hypot(pointer.x - start.x, pointer.y - start.y) * 0.4);
  const c1x = start.x + normal.x * reach;
  const c1y = start.y + normal.y * reach;
  return {
    d: `M ${round(start.x)} ${round(start.y)} C ${round(c1x)} ${round(c1y)}, ${round(pointer.x)} ${round(pointer.y)}, ${round(pointer.x)} ${round(pointer.y)}`,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
