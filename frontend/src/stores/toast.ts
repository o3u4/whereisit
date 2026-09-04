import { create } from 'zustand';

export type ToastTone = 'accent' | 'present' | 'lent' | 'consumed' | 'danger';

export interface ToastItem {
  id: number;
  text: string;
  tone?: ToastTone;
  /** optional inline action (e.g. undo); click dismisses the toast and runs it */
  actionLabel?: string;
  action?: () => void;
}

interface ToastState {
  toasts: ToastItem[];
  push: (text: string, tone?: ToastTone, actionLabel?: string, action?: () => void) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone, actionLabel, action) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone, actionLabel, action }] }));
    setTimeout(() => get().dismiss(id), action ? 5200 : 2600);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
