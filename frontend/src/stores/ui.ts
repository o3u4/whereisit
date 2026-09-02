import { create } from 'zustand'

interface UiState {
  selectedId: number | null
  expanded: Set<number>
  select: (id: number | null) => void
  toggle: (id: number) => void
  reveal: (id: number) => void
  expandPath: (ids: number[]) => void
}

export const useUi = create<UiState>((set) => ({
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
}))
