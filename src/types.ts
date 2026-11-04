/** Paper Atlas — shared types */

export type ReadStatus = 'unread' | 'skimmed' | 'intensive' | 'read';

export type UnderstandingSource = 'heading' | 'notes' | 'abstract' | 'none';

export interface PaperImage {
  /** raw link text as it appears in the note */
  link: string;
  /** resolved vault path; empty when the link cannot be resolved */
  path: string;
}

export interface PaperEntry {
  /** vault path of the paper note */
  path: string;
  basename: string;
  title: string;
  /** display date, normalised to YYYY-MM-DD when possible */
  date: string;
  /** sortable timestamp; 0 when unknown */
  dateSort: number;
  authors: string[];
  /** joined institution string; empty string means 未标注 */
  institution: string;
  fields: string[];
  primaryField: string;
  venue: string;
  status: ReadStatus;
  images: PaperImage[];
  understanding: string;
  understandingSource: UnderstandingSource;
  abstract: string;
  url?: string;
  arxivId?: string;
  /** true when the backing note disappeared but a card still references it */
  missing?: boolean;
}

export type EditableField =
  | 'title'
  | 'date'
  | 'venue'
  | 'authors'
  | 'institution'
  | 'understanding'
  | 'cover';

/** Only the keys the user overrode on the card; every other key falls back to the note. */
export interface CardOverrides {
  title?: string;
  date?: string;
  venue?: string;
  authors?: string[];
  institution?: string;
  understanding?: string;
  cover?: string;
}

export interface AtlasNode {
  id: string;
  /** vault path of the paper note */
  paper: string;
  x: number;
  y: number;
  w: number;
  h: number;
  overrides?: CardOverrides;
  /** whether the 理解 block is expanded */
  expanded?: boolean;
  /** card height before expanding, restored on collapse */
  baseHeight?: number;
  /** natural cover aspect ratio (height / width), used to size the card */
  coverAspect?: number;
}

export interface YearLine {
  id: string;
  year: number;
  /** board-space y of the divider (top edge of that year's band) */
  y: number;
}

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgeArrow = 'forward' | 'both' | 'none';

export interface AtlasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  fromSide?: EdgeSide;
  toSide?: EdgeSide;
  arrow?: EdgeArrow;
}

export interface AtlasViewport {
  x: number;
  y: number;
  z: number;
}

export interface AtlasBoard {
  version: 1;
  viewport: AtlasViewport;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  years: YearLine[];
}

export interface FieldPaletteEntry {
  bg: string;
  border: string;
  text: string;
}

export const CARD_WIDTH = 380;
export const CARD_HEIGHT = 470;
export const MIN_CARD_WIDTH = 260;
export const MIN_CARD_HEIGHT = 200;

export const STATUS_LABEL: Record<ReadStatus, string> = {
  unread: '未读',
  skimmed: '粗读',
  intensive: '精读',
  read: '已读',
};

export const STATUS_ORDER: ReadStatus[] = ['unread', 'skimmed', 'intensive', 'read'];
