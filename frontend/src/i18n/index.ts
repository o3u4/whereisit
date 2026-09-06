/* whereisit · i18n: language store (persisted to localStorage) + translation
 * accessors. Components subscribe via useTr(); non-component modules use intl. */

import { create } from 'zustand';
import { dict, type Lang, type Vars } from './dict';

const STORE_KEY = 'whereisit.lang';

function initialLang(): Lang {
  try {
    return localStorage.getItem(STORE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useI18n = create<I18nState>((set) => ({
  lang: initialLang(),
  setLang: (l) => {
    try {
      localStorage.setItem(STORE_KEY, l);
    } catch {
      /* private mode: non-persistent */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = l === 'en' ? 'en' : 'zh';
    set({ lang: l });
  },
}));

function interpolate(key: string, vars: Vars, lang: Lang): string {
  let s = dict[lang][key] ?? dict.zh[key] ?? key;
  for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** reactive hook for components: { lang, setLang, t, fmt } */
export function useTr() {
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const t = (key: string) => dict[lang][key] ?? dict.zh[key] ?? key;
  const fmt = (key: string, vars: Vars) => interpolate(key, vars, lang);
  return { lang, setLang, t, fmt };
}

/** non-reactive accessors for modules that can't call hooks (lib/meta, toasts) */
export const intl = {
  get lang(): Lang {
    return useI18n.getState().lang;
  },
  t: (key: string) => dict[useI18n.getState().lang][key] ?? dict.zh[key] ?? key,
  fmt: (key: string, vars: Vars) => interpolate(key, vars, useI18n.getState().lang),
};