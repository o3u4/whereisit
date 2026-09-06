/* whereisit · access-token store. Token lives in sessionStorage (session-scoped),
 * attached as `Authorization: Bearer` by api/client. `unauthorized` flips when
 * a guarded request returns 401 so App can show the token gate. */

import { create } from 'zustand';

const KEY = 'whereisit.token';

function loadToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  unauthorized: boolean;
  setToken: (t: string) => void;
  clearToken: () => void;
  setUnauthorized: (b: boolean) => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: loadToken(),
  unauthorized: false,
  setToken: (t) => {
    try {
      sessionStorage.setItem(KEY, t);
    } catch {
      /* private mode */
    }
    set({ token: t, unauthorized: false });
  },
  clearToken: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    set({ token: null, unauthorized: false });
  },
  setUnauthorized: (b) => set({ unauthorized: b }),
}));

export const getToken = () => useAuth.getState().token;