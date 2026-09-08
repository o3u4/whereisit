/* whereisit · visual theme. Persisted to localStorage so it applies before the
 * first fetch; the app server setting is written separately by the caller. The
 * active theme becomes <html data-theme="…"> and CSS keys overrides off it
 * (`:root` holds the default "apple"; `[data-theme="flat"]` layers on top). */

import { create } from 'zustand';

const KEY = 'whereisit.theme';
const THEMES = ['apple', 'flat'] as const;
export type Theme = (typeof THEMES)[number];

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'apple' || v === 'flat') return v;
  } catch {
    /* ignore */
  }
  return 'apple';
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: load(),
  setTheme: (t) => {
    set({ theme: t });
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    apply(t);
  },
}));

// apply immediately on import (before React mounts) so a reload keeps the theme
apply(load());