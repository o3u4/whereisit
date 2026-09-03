/*
 * whereisit · reactive demo catalog (zustand).
 * Holds the live items/tree plus cross-page state (recent activity, reveal request).
 * Browse-page concerns (cur container, view seg, expanded nodes) stay local to that page,
 * mirroring the prototype's per-screen isolation.
 */

import { create } from 'zustand';
import type { Item, ItemStatus, RecentEntry, DirNode } from '../mock/data';
import { INITIAL_ITEMS, INITIAL_RECENT, TREE, cutDir, attachDir, dirById } from '../mock/data';

export interface AddItemInput {
  slug: string;
  name: string;
  alias?: string;
  qty: number;
  unit: string;
  cat: string;
  status?: ItemStatus;
  spot: string;
}

interface CatalogState {
  items: Item[];
  tree: DirNode[];
  recent: RecentEntry[];
  /** item slug requested for reveal on /browse (record success "去看看它在哪") */
  reveal: string | null;

  moveItem: (slug: string, toId: string) => void;
  /** reparent a container subtree under another container (drag & drop on browse) */
  moveDir: (dirId: string, intoId: string) => void;
  setStatus: (slug: string, status: ItemStatus) => void;
  setQty: (slug: string, qty: number) => void;
  addItem: (input: AddItemInput) => void;
  pushRecent: (entry: RecentEntry) => void;
  setReveal: (slug: string | null) => void;
}

const patchItem = (items: Item[], slug: string, patch: Partial<Pick<Item, 'spot' | 'status' | 'qty'>>): Item[] =>
  items.map((it) => (it.slug === slug ? { ...it, ...patch } : it));

export const useCatalog = create<CatalogState>((set) => ({
  items: INITIAL_ITEMS,
  tree: TREE,
  recent: INITIAL_RECENT,
  reveal: null,

  moveItem: (slug, toId) =>
    set((s) => ({ items: patchItem(s.items, slug, { spot: toId }) })),

  moveDir: (dirId, intoId) =>
    set((s) => {
      if (dirId === intoId) return s;
      const { nodes, node } = cutDir(s.tree, dirId);
      if (!node || !dirById(nodes, intoId) || dirById([node], intoId)) return s;
      return { tree: attachDir(nodes, intoId, node) };
    }),

  setStatus: (slug, status) =>
    set((s) => ({ items: patchItem(s.items, slug, { status }) })),

  setQty: (slug, qty) =>
    set((s) => ({
      items: patchItem(s.items, slug, { qty: Math.max(0, qty) }),
    })),

  addItem: (input) =>
    set((s) => {
      const already = s.items.some((it) => it.slug === input.slug);
      if (already) return s; // slug collision guard
      const item: Item = {
        slug: input.slug,
        name: input.name,
        alias: input.alias || input.name,
        qty: Math.max(1, input.qty),
        unit: input.unit,
        cat: input.cat,
        status: input.status || 'present',
        attrs: [],
        spot: input.spot,
      };
      return { items: [...s.items, item] };
    }),

  pushRecent: (entry) =>
    set((s) => ({ recent: [entry, ...s.recent].slice(0, 12) })),

  setReveal: (slug) => set({ reveal: slug }),
}));
