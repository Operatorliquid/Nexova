import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastChannel = 'action' | 'notification';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  channel?: ToastChannel;
  notificationType?: string;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  notify: (message: string, type?: ToastType, notificationType?: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    const channel = toast.channel ?? 'action';
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id, channel }],
    }));

    // Auto remove after duration
    const duration = toast.duration ?? 4000;
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  success: (message) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'success', message, channel: 'action' }],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  error: (message) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'error', message, channel: 'action' }],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },

  info: (message) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'info', message, channel: 'action' }],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  warning: (message) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, type: 'warning', message, channel: 'action' }],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },

  notify: (message, type = 'info', notificationType) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, channel: 'notification', notificationType }],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 6000);
  },
}));

// Hook helper for easy access
export const useToast = () => {
  const { success, error, info, warning, notify } = useToastStore();
  return { success, error, info, warning, notify };
};
