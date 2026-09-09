/* whereisit · search-frequency tick. localStorage holds the counts (lib/tree
 * bumpFreq); this tiny store only signals "a count changed" so the frequent list
 * recomputes immediately after a search. */

import { create } from 'zustand';

interface FreqState {
  tick: number;
  bump: () => void;
}

export const useFreq = create<FreqState>((set) => ({
  tick: 0,
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));