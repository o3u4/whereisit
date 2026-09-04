/*
 * whereisit · catalog store (zustand) backed by the real backend API.
 * Holds live items/tree + cross-page state (recent activity, reveal request).
 * Writes go through a serialized promise queue so rapid successive writes (e.g.
 * record confirm + refresh) never interleave; reads then reconcile from a refetch.
 * `recent` is client-side only (activity log lands in M4).
 */

import { create } from 'zustand';
import * as api from '../api/client';
import type { SearchModeDTO } from '../api/types';
import type { DirNode, Item, ItemStatus, RecentEntry } from '../lib/types';

export interface AddItemInput {
  name: string;
  alias?: string;
  qty: number;
  unit: string;
  cat: string;
  status?: ItemStatus;
  spot: string;
}

export interface CommitFields {
  spot?: string;
  qty?: number;
  status?: ItemStatus;
}

export interface CommitResult {
  /** surviving lot id (a merge may delete the moved row and return the target) */
  slug: string;
  merged: boolean;
}

interface CatalogState {
  items: Item[];
  tree: DirNode[];
  recent: RecentEntry[];
  /** item slug requested for reveal on /browse (record success "去看看它在哪") */
  reveal: string | null;
  ready: boolean;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  moveItem: (slug: string, toId: string) => Promise<void>;
  /** reparent a container subtree under another container (drag & drop on browse) */
  moveDir: (dirId: string, intoId: string) => Promise<void>;
  setStatus: (slug: string, status: ItemStatus) => Promise<void>;
  setQty: (slug: string, qty: number) => Promise<void>;
  /** register a fresh presence; resolves to the surviving lot id (null on failure) */
  addItem: (input: AddItemInput) => Promise<string | null>;
  /** single merged PATCH for record's move/update flow; resolves survivor lot */
  commit: (slug: string, fields: CommitFields) => Promise<CommitResult | null>;
  /** server-side search (read-only, not queued); caller owns async state */
  search: (q: string, mode?: SearchModeDTO, scopeSpaceId?: number) => Promise<api.SearchResult>;
  /** delete a presence (lot); resolves true on success */
  deleteItem: (slug: string) => Promise<boolean>;
  pushRecent: (entry: RecentEntry) => void;
  setReveal: (slug: string | null) => void;
}

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** dedupes concurrent load() calls (StrictMode double-mount / repeated effects) */
let boot: Promise<void> | null = null;

export const useCatalog = create<CatalogState>((set) => {
  const refreshItems = async (): Promise<void> => {
    set({ items: await api.fetchItems(), error: null });
  };

  return {
    items: [],
    tree: [],
    recent: [],
    reveal: null,
    ready: false,
    loading: false,
    error: null,

    load: () => {
      if (!boot) {
        boot = (async () => {
          set({ loading: true });
          try {
            const [tree, items] = await Promise.all([api.fetchTree(), api.fetchItems()]);
            set({ tree, items, ready: true, loading: false, error: null });
          } catch (e) {
            set({ ready: true, loading: false, error: errText(e) });
          } finally {
            boot = null;
          }
        })();
      }
      return boot;
    },

    moveItem: (slug, toId) =>
      enqueue(async () => {
        try {
          await api.patchLot(Number(slug), { space_id: Number(toId) });
          await refreshItems();
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    moveDir: (dirId, intoId) =>
      enqueue(async () => {
        try {
          await api.moveSpace(Number(dirId), Number(intoId));
          set({ tree: await api.fetchTree(), error: null });
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    setStatus: (slug, status) =>
      enqueue(async () => {
        try {
          await api.patchLot(Number(slug), { status });
          await refreshItems();
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    setQty: (slug, qty) =>
      enqueue(async () => {
        try {
          await api.patchLot(Number(slug), { qty: Math.max(1, qty) });
          await refreshItems();
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    addItem: (input) =>
      enqueue(async () => {
        try {
          const { item } = await api.registerItem({
            name: input.name,
            alias: input.alias || undefined,
            category: input.cat || undefined,
            unit: input.unit.trim() || undefined,
            qty: Math.max(1, input.qty),
            status: input.status ?? 'present',
            space_id: Number(input.spot),
          });
          await refreshItems();
          return item.slug;
        } catch (e) {
          set({ error: errText(e) });
          return null;
        }
      }),

    commit: (slug, fields) =>
      enqueue(async () => {
        try {
          const patch: api.PatchFields = {};
          if (fields.spot !== undefined) patch.space_id = Number(fields.spot);
          if (fields.qty !== undefined) patch.qty = Math.max(1, fields.qty);
          if (fields.status !== undefined) patch.status = fields.status;
          const { item, merged } = await api.patchLot(Number(slug), patch);
          await refreshItems();
          return { slug: item.slug, merged };
        } catch (e) {
          set({ error: errText(e) });
          return null;
        }
      }),

    search: (q, mode, scopeSpaceId) =>
      api.search({ q, mode, scope_space_id: scopeSpaceId }),

    deleteItem: (slug) =>
      enqueue(async () => {
        try {
          await api.deleteLot(Number(slug));
          await refreshItems();
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    pushRecent: (entry) => set((s) => ({ recent: [entry, ...s.recent].slice(0, 12) })),

    setReveal: (slug) => set({ reveal: slug }),
  };
});
