import { CARD_HEIGHT, CARD_WIDTH } from './types';

export interface AtlasSettings {
  /** folder that holds the paper notes */
  paperFolder: string;
  /** board file, relative to the vault */
  boardPath: string;
  cardWidth: number;
  cardHeight: number;
  sidebarOpen: boolean;
  /** reuse the field colours of obsidian-mypaper-plugin */
  inheritPalette: boolean;
  /** bottom-left field colour legend */
  showLegend: boolean;
}

export const DEFAULT_SETTINGS: AtlasSettings = {
  paperFolder: '30_References/Paper/manager',
  boardPath: '30_References/Paper/manager/论文图谱.pcanvas',
  cardWidth: CARD_WIDTH,
  cardHeight: CARD_HEIGHT,
  sidebarOpen: true,
  inheritPalette: true,
  showLegend: true,
};

export function normalizeSettings(raw: Partial<AtlasSettings> | undefined): AtlasSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  return {
    paperFolder: typeof merged.paperFolder === 'string' ? merged.paperFolder.replace(/^\/+|\/+$/g, '') : DEFAULT_SETTINGS.paperFolder,
    boardPath: typeof merged.boardPath === 'string' && merged.boardPath.trim() ? merged.boardPath.trim() : DEFAULT_SETTINGS.boardPath,
    cardWidth: clamp(Number(merged.cardWidth) || CARD_WIDTH, 260, 560),
    cardHeight: clamp(Number(merged.cardHeight) || CARD_HEIGHT, 300, 700),
    sidebarOpen: merged.sidebarOpen !== false,
    inheritPalette: merged.inheritPalette !== false,
    showLegend: merged.showLegend !== false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
