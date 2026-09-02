import { create } from 'zustand'

export type AppView = 'board' | 'browse'

interface UiState {
  view: AppView
  selectedId: number | null
  expanded: Set<number>
  select: (id: number | null) => void
  toggle: (id: number) => void
  reveal: (id: number) => void
  expandPath: (ids: number[]) => void
  /** 看板 → 浏览:选定空间并切走看板页 */
  openSpace: (id: number) => void
  /** 回到独立看板首页 */
  goBoard: () => void
}

export const useUi = create<UiState>((set) => ({
  view: 'board',
  selectedId: null,
  expanded: new Set<number>(),
  select: (id) => set({ selectedId: id }),
  toggle: (id) =>
    set((s) => {
      const expanded = new Set(s.expanded)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      return { expanded }
    }),
  reveal: (id) =>
    set((s) => {
      const expanded = new Set(s.expanded)
      expanded.add(id)
      return { expanded }
    }),
  expandPath: (ids) =>
    set((s) => {
      const expanded = new Set(s.expanded)
      for (const id of ids) expanded.add(id)
      return { expanded }
    }),
  openSpace: (id) => set({ view: 'browse', selectedId: id }),
  goBoard: () => set({ view: 'board' }),
}))
