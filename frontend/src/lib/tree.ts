/* whereisit · pure space-tree helpers (take nodes as a param, no mutation) plus
 * the adapters that turn backend space DTOs into UI DirNodes/scenes. */

import type { SpaceNodeDTO } from '../api/types';
import type { DirNode, DirType, Item, Scene, SceneLayout } from './types';

const KNOWN_TYPES: ReadonlySet<string> = new Set(['room', 'wardrobe', 'desk', 'drawer', 'shelf', 'box']);

export function mapTypeTag(tag: string): DirType {
  return (KNOWN_TYPES.has(tag) ? tag : 'generic') as DirType;
}

/** scene-gradient palette, cycled by index when a root has no custom tints, so
 * freshly-created top-level scenes each get a distinct card color. */
export const SCENE_GRADIENTS: { a: string; b: string }[] = [
  { a: 'oklch(82% .07 100)', b: 'oklch(52% .11 45)' }, // amber
  { a: 'oklch(84% .06 210)', b: 'oklch(54% .09 205)' }, // teal
  { a: 'oklch(83% .05 260)', b: 'oklch(52% .10 250)' }, // indigo
  { a: 'oklch(82% .06 150)', b: 'oklch(50% .09 158)' }, // green
  { a: 'oklch(82% .06 320)', b: 'oklch(52% .09 320)' }, // pink
  { a: 'oklch(83% .05 60)', b: 'oklch(55% .09 78)' }, // lime/olive
];

/** deterministic gradient for the i-th root scene (cycles the palette) */
export function sceneTint(i: number): { a: string; b: string } {
  return SCENE_GRADIENTS[i % SCENE_GRADIENTS.length];
}

/** safe parse of a space's layout_json; malformed/absent -> undefined. Tints are
 * optional and only returned when actually present (a group-only layout parses
 * fine and the card picks an auto gradient). */
export function parseLayout(raw: string | null | undefined): SceneLayout | undefined {
  if (!raw) return undefined;
  try {
    const o: unknown = JSON.parse(raw);
    if (o && typeof o === 'object') {
      const { group, tintA, tintB } = o as Partial<SceneLayout>;
      if (typeof group === 'string' || typeof tintA === 'string' || typeof tintB === 'string') {
        const out: SceneLayout = { group: typeof group === 'string' ? group : '' };
        if (typeof tintA === 'string') out.tintA = tintA;
        if (typeof tintB === 'string') out.tintB = tintB;
        return out;
      }
    }
  } catch {
    /* bad layout json -> ignore */
  }
  return undefined;
}

export function spaceToDir(dto: SpaceNodeDTO): DirNode {
  return {
    id: String(dto.id),
    name: dto.name,
    type: mapTypeTag(dto.type_tag),
    kids: (dto.children ?? []).map(spaceToDir),
    layout: parseLayout(dto.layout_json),
  };
}

export function dirById(nodes: DirNode[], id: string): DirNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kids.length) {
      const hit = dirById(n.kids, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** ancestors incl. self, root first */
export function chainOf(nodes: DirNode[], id: string): DirNode[] {
  const n = dirById(nodes, id);
  if (!n) return [];
  const out: DirNode[] = [];
  const walk = (list: DirNode[], node: DirNode): boolean => {
    for (const c of list) {
      if (c === node) {
        out.push(c);
        return true;
      }
      if (c.kids.length) {
        out.push(c);
        if (walk(c.kids, node)) return true;
        out.pop();
      }
    }
    return false;
  };
  walk(nodes, n);
  return out;
}

/** item-less ancestor names, root first: e.g. 书房 / 书桌 / 左侧抽屉 */
export function pathNames(nodes: DirNode[], id: string): string[] {
  return chainOf(nodes, id).map((n) => n.name);
}

export function descIdsOf(nodes: DirNode[], id: string): string[] {
  const n = dirById(nodes, id);
  if (!n) return [];
  const out: string[] = [];
  const walk = (node: DirNode): void => {
    out.push(node.id);
    for (const k of node.kids) walk(k);
  };
  walk(n);
  return out;
}

/** how many items (by .spot) sit inside the container incl. sub-containers */
export function countItemsIn(nodes: DirNode[], items: Item[], id: string): number {
  const ids = descIdsOf(nodes, id);
  return items.filter((it) => ids.includes(it.spot)).length;
}

/** items directly inside a container (their .spot === id) */
export function directItemsIn(items: Item[], id: string): Item[] {
  return items.filter((it) => it.spot === id);
}

/** top `n` item names by total quantity across all presences — the "frequent" or
 * "常找" quick list. Computed from real data so a chip always finds something. */
export function frequentItemNames(items: Item[], n = 4): string[] {
  const tally = new Map<string, number>();
  for (const it of items) tally.set(it.name, (tally.get(it.name) ?? 0) + it.qty);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name);
}

/** root containers as hub scene cards (custom tints win; otherwise a distinct
 * auto gradient per card so new scenes aren't all one color) */
export function scenesFromTree(nodes: DirNode[]): Scene[] {
  return nodes.map((n, i) => {
    const tint = sceneTint(i);
    return {
      slug: n.id,
      name: n.name,
      parent: n.layout?.group ?? '',
      type: n.type,
      tintA: n.layout?.tintA ?? tint.a,
      tintB: n.layout?.tintB ?? tint.b,
      kids: n.kids,
    };
  });
}
