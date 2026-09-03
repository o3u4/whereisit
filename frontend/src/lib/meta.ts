/* whereisit · category/type/status display metadata.
 * Categories round-trip as their DB label; a label that isn't one of the four demo
 * categories (user-created later) falls back to a neutral generic style. */

import type { IconName } from '../components/icons';
import type { DirType, ItemStatus } from './types';

export interface CatMeta {
  label: string;
  tint: string;
  icon: IconName;
}

const KNOWN: Record<string, CatMeta> = {
  电子配件: { label: '电子配件', tint: 'oklch(60% .11 252)', icon: 'bolt' },
  证照文档: { label: '证照文档', tint: 'oklch(66% .12 72)', icon: 'doc' },
  工具: { label: '工具', tint: 'oklch(60% .13 28)', icon: 'scissor' },
  日用: { label: '日用', tint: 'oklch(56% .09 158)', icon: 'key' },
};

/** the four built-in category labels, in picker order */
export const KNOWN_CAT_LABELS: string[] = Object.keys(KNOWN);

export function catMeta(label: string | null | undefined): CatMeta {
  if (label) {
    const known = KNOWN[label];
    if (known) return known;
    return { label, tint: 'var(--accent)', icon: 'tag' };
  }
  return { label: '', tint: 'var(--accent)', icon: 'tag' };
}

export const STATUS: Record<ItemStatus, { label: string }> = {
  present: { label: '在' },
  lent: { label: '借出' },
  consumed: { label: '用完' },
};

/** tint per container type (tree glyph / type chips / folder tiles) */
export const TYPE_TINT: Record<DirType, string> = {
  room: 'oklch(49.5% .066 187)',
  wardrobe: 'oklch(52% .05 208)',
  desk: 'oklch(49% .05 162)',
  drawer: 'oklch(50% .06 232)',
  shelf: 'oklch(50% .045 196)',
  box: 'oklch(50% .07 82)',
  generic: 'oklch(50% .04 205)',
};
