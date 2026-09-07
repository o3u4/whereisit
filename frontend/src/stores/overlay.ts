/* whereisit · global search overlay + cross-page item detail.
 * Owns whether the ⌘K spotlight is open and which item the global item sheet
 * shows, so search works from any page (Hub / Browse / Record). */

import { create } from 'zustand';

interface OverlayState {
  spot: boolean;
  initialQ: string;
  itemSlug: string | null;
  openSpot: (initial?: string) => void;
  closeSpot: () => void;
  openItem: (slug: string) => void;
  closeItem: () => void;
}

export const useOverlay = create<OverlayState>((set) => ({
  spot: false,
  initialQ: '',
  itemSlug: null,
  openSpot: (initial) => set({ spot: true, initialQ: initial ?? '' }),
  closeSpot: () => set({ spot: false }),
  openItem: (slug) => set({ itemSlug: slug, spot: false }),
  closeItem: () => set({ itemSlug: null }),
}));