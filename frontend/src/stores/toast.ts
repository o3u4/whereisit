import { create } from 'zustand';

export type ToastTone = 'accent' | 'present' | 'lent' | 'consumed' | 'danger';

export interface ToastItem {
  id: number;
  text: string;
  tone?: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (text: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismiss(id), 2600);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
