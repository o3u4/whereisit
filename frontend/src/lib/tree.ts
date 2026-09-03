/* whereisit · pure space-tree helpers (take nodes as a param, no mutation) plus
 * the adapters that turn backend space DTOs into UI DirNodes/scenes. */

import type { SpaceNodeDTO } from '../api/types';
import type { DirNode, DirType, Item, Scene, SceneLayout } from './types';

const KNOWN_TYPES: ReadonlySet<string> = new Set(['room', 'wardrobe', 'desk', 'drawer', 'shelf', 'box']);

export function mapTypeTag(tag: string): DirType {
  return (KNOWN_TYPES.has(tag) ? tag : 'generic') as DirType;
}

/** safe parse of a space's layout_json; malformed/absent -> undefined (caller falls back) */
export function parseLayout(raw: string | null | undefined): SceneLayout | undefined {
  if (!raw) return undefined;
  try {
    const o: unknown = JSON.parse(raw);
    if (o && typeof o === 'object') {
      const { group, tintA, tintB } = o as Partial<SceneLayout>;
      if (typeof tintA === 'string' && typeof tintB === 'string') {
        return { group: typeof group === 'string' ? group : '', tintA, tintB };
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

/** root containers as hub scene cards (tints from layout_json with a neutral fallback) */
export function scenesFromTree(nodes: DirNode[]): Scene[] {
  return nodes.map((n) => ({
    slug: n.id,
    name: n.name,
    parent: n.layout?.group ?? '',
    type: n.type,
    tintA: n.layout?.tintA ?? 'oklch(50% .05 205)',
    tintB: n.layout?.tintB ?? 'oklch(80% .04 195)',
    kids: n.kids,
  }));
}
