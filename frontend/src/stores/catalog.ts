/*
 * whereisit · catalog store (zustand) backed by the real backend API.
 * Holds live items/tree/categories + cross-page state (recent activity, reveal).
 * Writes go through a serialized promise queue so rapid successive writes (e.g.
 * record confirm + refresh) never interleave; reads then reconcile from a refetch.
 * Single-slot undo: mutating actions stash an inverse descriptor; the "撤销"
 * toast action calls undo() to revert the last delete / register / patch.
 * `recent` is client-side only (activity log lands in M4).
 */

import { create } from 'zustand';
import * as api from '../api/client';
import type { SearchModeDTO } from '../api/types';
import type { Category, DirNode, Item, ItemStatus, RecentEntry } from '../lib/types';
import { bumpFreq } from '../lib/tree';
import { useFreq } from './freq';

export interface AddItemInput {
  name: string;
  alias?: string;
  qty: number;
  unit: string;
  cat: string;
  status?: ItemStatus;
  spot: string;
  notes?: string;
}

export interface CommitFields {
  spot?: string;
  qty?: number;
  status?: ItemStatus;
  notes?: string;
}

export interface CommitResult {
  /** surviving lot id (a merge may delete the moved row and return the target) */
  slug: string;
  merged: boolean;
}

type Undo =
  | { kind: 'delete'; item: Item } // inverse: re-register the presence
  | { kind: 'register'; slug: string } // inverse: remove the brand-new lot
  | { kind: 'patch'; slug: string; prev: CommitFields }; // inverse: reverse the patch

interface CatalogState {
  items: Item[];
  tree: DirNode[];
  categories: Category[];
  recent: RecentEntry[];
  /** item slug requested for reveal on /browse (record success "去看看它在哪") */
  reveal: string | null;
  /** last reversible mutation (delete / register-new / non-merge patch) */
  undoInfo: Undo | null;
  ready: boolean;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  /** create one space under parentId (null = a root); resolves to the new space id */
  addSpace: (parentId: number | null, name: string) => Promise<number | null>;
  /** resolve/create a nested path (mkdir -p); resolves to the leaf space id */
  ensurePath: (names: string[], typeTag?: string) => Promise<number | null>;
  moveItem: (slug: string, toId: string) => Promise<void>;
  /** reparent a container subtree under another container (drag & drop on browse) */
  moveDir: (dirId: string, intoId: string) => Promise<void>;
  setStatus: (slug: string, status: ItemStatus) => Promise<void>;
  setQty: (slug: string, qty: number) => Promise<void>;
  /** rename the item type (kind) — every lot of that name changes too */
  renameItem: (slug: string, name: string) => Promise<boolean>;
  /** register a fresh presence; resolves to the surviving lot id (null on failure) */
  addItem: (input: AddItemInput) => Promise<string | null>;
  /** single merged PATCH for record's move/update flow; resolves survivor lot */
  commit: (slug: string, fields: CommitFields) => Promise<CommitResult | null>;
  /** server-side search (read-only, not queued); caller owns async state */
  search: (q: string, mode?: SearchModeDTO, scopeSpaceId?: number) => Promise<api.SearchResult>;
  /** delete a presence (lot); resolves true on success */
  deleteItem: (slug: string) => Promise<boolean>;
  /** edit a presence's note (lot-level) */
  setNotes: (slug: string, notes: string) => Promise<void>;
  /** move an item type (def) to a different category (def-level) */
  changeCategory: (defId: number, categoryId: number) => Promise<boolean>;
  /** upsert a def-level attribute; order = insertion (append when new) */
  setDefAttr: (defId: number, key: string, value: string) => Promise<boolean>;
  removeDefAttr: (defId: number, key: string) => Promise<boolean>;
  /** revert the last reversible mutation; true if something was undone */
  undo: () => Promise<boolean>;
  /** fold one def's presences/aliases/attrs into another (no undo) */
  mergeDefs: (keepId: number, fromId: number) => Promise<boolean>;
  addCategory: (name: string) => Promise<boolean>;
  renameCategory: (id: number, name: string) => Promise<boolean>;
  removeCategory: (id: number, intoId?: number) => Promise<boolean>;
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

export const useCatalog = create<CatalogState>((set, get) => {
  const refreshItems = async (): Promise<void> => {
    set({ items: await api.fetchItems(), error: null });
  };
  const refreshCategories = async (): Promise<void> => {
    set({ categories: await api.fetchCategories(), error: null });
  };

  return {
    items: [],
    tree: [],
    categories: [],
    recent: [],
    reveal: null,
    undoInfo: null,
    ready: false,
    loading: false,
    error: null,

    load: () => {
      if (!boot) {
        boot = (async () => {
          set({ loading: true });
          try {
            const [tree, items, categories] = await Promise.all([
              api.fetchTree(),
              api.fetchItems(),
              api.fetchCategories(),
            ]);
            set({ tree, items, categories, ready: true, loading: false, error: null });
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
          const cur = get().items.find((i) => i.slug === slug);
          await api.patchLot(Number(slug), { space_id: Number(toId) });
          await refreshItems();
          if (cur) set({ undoInfo: { kind: 'patch', slug, prev: { spot: cur.spot } } });
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

    renameItem: (slug, name) =>
      enqueue(async () => {
        try {
          const cur = get().items.find((i) => i.slug === slug);
          if (!cur) return false;
          await api.renameDef(cur.defId, name);
          await refreshItems();
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    addSpace: (parentId, name) =>
      enqueue(async () => {
        try {
          const sp = await api.createSpace({ name, parent_id: parentId });
          set({ tree: await api.fetchTree(), error: null });
          return sp.id;
        } catch (e) {
          set({ error: errText(e) });
          return null;
        }
      }),

    ensurePath: (names, typeTag) =>
      enqueue(async () => {
        try {
          const { id } = await api.ensurePath(names, typeTag);
          set({ tree: await api.fetchTree(), error: null });
          return id;
        } catch (e) {
          set({ error: errText(e) });
          return null;
        }
      }),

    setStatus: (slug, status) =>
      enqueue(async () => {
        try {
          const cur = get().items.find((i) => i.slug === slug);
          await api.patchLot(Number(slug), { status });
          await refreshItems();
          if (cur) set({ undoInfo: { kind: 'patch', slug, prev: { status: cur.status } } });
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    setQty: (slug, qty) =>
      enqueue(async () => {
        try {
          const cur = get().items.find((i) => i.slug === slug);
          await api.patchLot(Number(slug), { qty: Math.max(1, qty) });
          await refreshItems();
          if (cur) set({ undoInfo: { kind: 'patch', slug, prev: { qty: cur.qty } } });
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    setNotes: (slug, notes) =>
      enqueue(async () => {
        try {
          const cur = get().items.find((i) => i.slug === slug);
          await api.patchLot(Number(slug), { notes });
          await refreshItems();
          if (cur) set({ undoInfo: { kind: 'patch', slug, prev: { notes: cur.notes } } });
        } catch (e) {
          set({ error: errText(e) });
        }
      }),

    changeCategory: (defId, categoryId) =>
      enqueue(async () => {
        try {
          await api.patchDefCategory(defId, categoryId);
          await refreshItems();
          await refreshCategories(); // per-category item counts shifted
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    setDefAttr: (defId, key, value) =>
      enqueue(async () => {
        try {
          await api.setDefAttr(defId, key, value);
          await refreshItems();
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    removeDefAttr: (defId, key) =>
      enqueue(async () => {
        try {
          await api.deleteDefAttr(defId, key);
          await refreshItems();
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    addItem: (input) =>
      enqueue(async () => {
        try {
          const { item, merged } = await api.registerItem({
            name: input.name,
            alias: input.alias || undefined,
            category: input.cat || undefined,
            unit: input.unit.trim() || undefined,
            notes: input.notes || undefined,
            qty: Math.max(1, input.qty),
            status: input.status ?? 'present',
            space_id: Number(input.spot),
          });
          await refreshItems();
          if (!merged) set({ undoInfo: { kind: 'register', slug: item.slug } });
          return item.slug;
        } catch (e) {
          set({ error: errText(e) });
          return null;
        }
      }),

    commit: (slug, fields) =>
      enqueue(async () => {
        try {
          const cur = get().items.find((i) => i.slug === slug);
          const patch: api.PatchFields = {};
          if (fields.spot !== undefined) patch.space_id = Number(fields.spot);
          if (fields.qty !== undefined) patch.qty = Math.max(1, fields.qty);
          if (fields.status !== undefined) patch.status = fields.status;
          const { item, merged } = await api.patchLot(Number(slug), patch);
          await refreshItems();
          // merge-on-relocate absorbs into an existing lot (deletes this row) — not worth undoing
          if (!merged && cur) {
            const prev: CommitFields = {};
            if (fields.spot !== undefined) prev.spot = cur.spot;
            if (fields.qty !== undefined) prev.qty = cur.qty;
            if (fields.status !== undefined) prev.status = cur.status;
            set({ undoInfo: { kind: 'patch', slug: item.slug, prev } });
          }
          return { slug: item.slug, merged };
        } catch (e) {
          set({ error: errText(e) });
          return null;
        }
      }),

    search: async (q, mode, scopeSpaceId) => {
      const r = await api.search({ q, mode, scope_space_id: scopeSpaceId });
      if (q.trim() && r.items.length) {
        for (const it of r.items) bumpFreq(it.name);
        useFreq.getState().bump();
      }
      return r;
    },

    deleteItem: (slug) =>
      enqueue(async () => {
        try {
          const cur = get().items.find((i) => i.slug === slug);
          await api.deleteLot(Number(slug));
          await refreshItems();
          if (cur) set({ undoInfo: { kind: 'delete', item: cur } });
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    undo: () =>
      enqueue(async () => {
        const u = get().undoInfo;
        if (!u) return false;
        set({ undoInfo: null });
        try {
          if (u.kind === 'delete') {
            // rebuild the exact separate lot: no_merge avoids absorbing into an
            // existing same-def present lot (that would add qty to the front row)
            await api.registerItem({
              name: u.item.name,
              alias: u.item.alias || undefined,
              category: u.item.cat || undefined,
              unit: u.item.unit || undefined,
              notes: u.item.notes || undefined,
              qty: Math.max(1, u.item.qty),
              status: u.item.status,
              space_id: Number(u.item.spot),
              no_merge: true,
            });
          } else if (u.kind === 'register') {
            await api.deleteLot(Number(u.slug));
          } else {
            const patch: api.PatchFields = {};
            if (u.prev.spot !== undefined) patch.space_id = Number(u.prev.spot);
            if (u.prev.qty !== undefined) patch.qty = Math.max(1, u.prev.qty);
            if (u.prev.status !== undefined) patch.status = u.prev.status;
            if (u.prev.notes !== undefined) patch.notes = u.prev.notes;
            if (Object.keys(patch).length) await api.patchLot(Number(u.slug), patch);
          }
          set({ items: await api.fetchItems(), error: null });
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    mergeDefs: (keepId, fromId) =>
      enqueue(async () => {
        try {
          await api.mergeDefs(keepId, fromId);
          await refreshItems();
          await refreshCategories();
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    addCategory: (name) =>
      enqueue(async () => {
        try {
          await api.createCategory(name);
          await refreshCategories();
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    renameCategory: (id, name) =>
      enqueue(async () => {
        try {
          await api.renameCategory(id, name);
          await refreshCategories();
          await refreshItems(); // category label shown on items changed
          return true;
        } catch (e) {
          set({ error: errText(e) });
          return false;
        }
      }),

    removeCategory: (id, intoId) =>
      enqueue(async () => {
        try {
          await api.deleteCategory(id, intoId);
          await refreshCategories();
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