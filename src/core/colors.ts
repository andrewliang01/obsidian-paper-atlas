import { App } from 'obsidian';
import type { FieldPaletteEntry } from '../types';

/** Mirrors the paper manager's default field styles so both plugins look consistent. */
const DEFAULT_PALETTE: Record<string, FieldPaletteEntry> = {
  Locomotion: { bg: '#ffe3e3', border: '#ff6b6b', text: '#c92a2a' },
  'Whole-body Motion': { bg: '#d3f9d8', border: '#38d9a9', text: '#087f5b' },
  Manipulation: { bg: '#ffec99', border: '#fab005', text: '#e67700' },
  Perception: { bg: '#d0ebff', border: '#4dabf7', text: '#1971c2' },
  'Learning Methods': { bg: '#e5dbff', border: '#9775fa', text: '#6741d9' },
  'Robot Tools': { bg: '#ffe8cc', border: '#ff922b', text: '#d9480f' },
  Vision: { bg: '#c5f6fa', border: '#22b8cf', text: '#0c8599' },
  Navigation: { bg: '#f3d9fa', border: '#da77f2', text: '#9c36b5' },
  'Mathematical Representations': { bg: '#e9ecef', border: '#868e96', text: '#495057' },
};

const EXTRA_COLORS = ['#e64980', '#12b886', '#7950f2', '#f76707', '#0ca678', '#4263eb'];

export type FieldPalette = Record<string, FieldPaletteEntry>;

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function hashAccent(name: string): string {
  return EXTRA_COLORS[hashName(name) % EXTRA_COLORS.length] as string;
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1] as string, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (value: number): string =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/**
 * 从领域底色推导一个高饱和的主色，用来画卡片顶条、图例圆点和分组边框。
 * 论文管理器里 borderColor 偶尔和底色不是同一个色系（比如 Whole-body Motion
 * 底色是青色、边框却是红色），直接用会让"颜色 ↔ 领域"对不上。
 */
export function emphasize(color: string, lightness = 45): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 8) return hslToHex(h, s, 42);
  return hslToHex(h, Math.max(s, 42), lightness);
}

export function clonePalette(): FieldPalette {
  return Object.fromEntries(Object.entries(DEFAULT_PALETTE).map(([key, value]) => [key, { ...value }]));
}

/** Read the paper manager's data.json (read-only) and reuse its field colours. */
export async function loadPalette(app: App, inherit: boolean): Promise<FieldPalette> {
  const palette = clonePalette();
  if (!inherit) return palette;

  const configDir = app.vault.configDir;
  const path = `${configDir}/plugins/obsidian-mypaper-plugin/data.json`;
  try {
    if (!(await app.vault.adapter.exists(path))) return palette;
    const raw = await app.vault.adapter.read(path);
    const data = JSON.parse(raw) as { fields?: Array<Record<string, unknown>> };
    const fields = Array.isArray(data.fields) ? data.fields : [];
    for (const field of fields) {
      const name = typeof field.name === 'string' ? field.name : '';
      if (!name) continue;
      const bg = typeof field.backgroundColor === 'string' ? field.backgroundColor : '#e9ecef';
      const entry: FieldPaletteEntry = {
        bg,
        border: emphasize(bg) || (typeof field.borderColor === 'string' ? field.borderColor : '#868e96'),
        text:
          (typeof field.titleTextColor === 'string' && field.titleTextColor) ||
          (typeof field.textColor === 'string' ? field.textColor : '') ||
          '#495057',
      };
      palette[name] = entry;
      const aliases = Array.isArray(field.aliases) ? field.aliases : [];
      for (const alias of aliases) {
        if (typeof alias === 'string' && alias.trim()) palette[alias.trim()] = entry;
      }
    }
  } catch {
    /* keep defaults when the other plugin is absent or unreadable */
  }
  return palette;
}

export function paletteFor(palette: FieldPalette, field: string): FieldPaletteEntry {
  return (
    palette[field] || {
      bg: '#e9ecef',
      border: hashAccent(field || '未分类'),
      text: '#495057',
    }
  );
}
