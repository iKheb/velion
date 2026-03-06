import { create } from "zustand";

type ToastTone = "info" | "success" | "error";

export interface AppToast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastStore {
  toasts: AppToast[];
  pushToast: (toast: Omit<AppToast, "id">) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  pushToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }].slice(-4),
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));

export const toast = {
  info: (title: string, description?: string) => useToastStore.getState().pushToast({ title, description, tone: "info" }),
  success: (title: string, description?: string) => useToastStore.getState().pushToast({ title, description, tone: "success" }),
  error: (title: string, description?: string) => useToastStore.getState().pushToast({ title, description, tone: "error" }),
};
