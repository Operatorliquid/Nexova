import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  FileText,
  Package,
  Pencil,
  ShoppingCart,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useToastStore, type Toast, type ToastType } from '../../stores/toast.store';

const icons = {
  success: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

const styles = {
  success: {
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    icon: 'bg-emerald-500/20 text-emerald-400',
    text: 'text-emerald-100',
  },
  error: {
    bg: 'bg-red-500/10 border-red-500/30',
    icon: 'bg-red-500/20 text-red-400',
    text: 'text-red-100',
  },
  warning: {
    bg: 'bg-primary/10 border-primary/30',
    icon: 'bg-primary/20 text-primary',
    text: 'text-primary/90',
  },
  info: {
    bg: 'bg-blue-500/10 border-blue-500/30',
    icon: 'bg-blue-500/20 text-blue-400',
    text: 'text-blue-100',
  },
};

const notificationStyles = {
  success: {
    bg: 'bg-emerald-500/15 border-emerald-500/30',
    accent: 'bg-emerald-400',
    text: 'text-foreground',
  },
  error: {
    bg: 'bg-red-500/15 border-red-500/30',
    accent: 'bg-red-400',
    text: 'text-foreground',
  },
  warning: {
    bg: 'bg-primary/15 border-primary/30',
    accent: 'bg-primary',
    text: 'text-foreground',
  },
  info: {
    bg: 'bg-sky-500/15 border-sky-500/30',
    accent: 'bg-sky-400',
    text: 'text-foreground',
  },
};

const notificationTypeStyles: Record<string, { bg: string; accent: string; text: string; icon: string }> = {
  'order.new': {
    bg: 'bg-emerald-500/15 border-emerald-500/30',
    accent: 'bg-emerald-400',
    text: 'text-emerald-100',
    icon: 'text-emerald-400',
  },
  'order.cancelled': {
    bg: 'bg-red-500/15 border-red-500/30',
    accent: 'bg-red-400',
    text: 'text-red-100',
    icon: 'text-red-400',
  },
  'order.edited': {
    bg: 'bg-sky-500/15 border-sky-500/30',
    accent: 'bg-sky-400',
    text: 'text-sky-100',
    icon: 'text-sky-400',
  },
  'customer.new': {
    bg: 'bg-indigo-500/15 border-indigo-500/30',
    accent: 'bg-indigo-400',
    text: 'text-indigo-100',
    icon: 'text-indigo-400',
  },
  'receipt.new': {
    bg: 'bg-primary/15 border-primary/30',
    accent: 'bg-primary',
    text: 'text-primary',
    icon: 'text-primary',
  },
  'handoff.requested': {
    bg: 'bg-amber-500/15 border-amber-500/30',
    accent: 'bg-amber-400',
    text: 'text-amber-100',
    icon: 'text-amber-400',
  },
  'stock.low': {
    bg: 'bg-destructive/15 border-destructive/30',
    accent: 'bg-destructive',
    text: 'text-destructive-foreground',
    icon: 'text-destructive',
  },
};

const resolveNotificationToastStyle = (notificationType?: string, toastType?: ToastType) => {
  if (notificationType && notificationTypeStyles[notificationType]) {
    return notificationTypeStyles[notificationType];
  }
  const fallback = notificationStyles[toastType || 'info'];
  return { ...fallback, icon: 'text-foreground' };
};

const resolveNotificationIcon = (notificationType?: string) => {
  switch (notificationType) {
    case 'order.new':
      return ShoppingCart;
    case 'order.cancelled':
      return XCircle;
    case 'order.edited':
      return Pencil;
    case 'customer.new':
      return UserPlus;
    case 'receipt.new':
      return FileText;
    case 'handoff.requested':
      return AlertTriangle;
    case 'stock.low':
      return Package;
    default:
      return Bell;
  }
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const style = styles[toast.type];

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Start exit animation before removal
    const duration = toast.duration ?? 4000;
    const exitTimer = setTimeout(() => {
      setIsLeaving(true);
    }, duration - 300);

    return () => clearTimeout(exitTimer);
  }, [toast.duration]);

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg
        ${style.bg}
        transition-all duration-300 ease-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className={`p-1.5 rounded-lg ${style.icon}`}>
        {icons[toast.type]}
      </div>
      <p className={`text-sm font-medium ${style.text}`}>{toast.message}</p>
      <button
        onClick={onRemove}
        className="ml-2 p-1 rounded-lg hover:bg-white/10 transition-colors"
      >
        <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function NotificationToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const style = resolveNotificationToastStyle(toast.notificationType, toast.type);
  const Icon = resolveNotificationIcon(toast.notificationType);

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    const duration = toast.duration ?? 6000;
    const exitTimer = setTimeout(() => {
      setIsLeaving(true);
    }, duration - 300);

    return () => clearTimeout(exitTimer);
  }, [toast.duration]);

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md
        ${style.bg}
        transition-all duration-300 ease-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className={`w-1.5 h-full rounded-full ${style.accent}`} />
      <div className="w-9 h-9 rounded-xl bg-background/60 border border-border flex items-center justify-center">
        <Icon className={`w-4 h-4 ${style.icon || 'text-foreground'}`} />
      </div>
      <div className="flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Notificación</p>
        <p className={`text-sm font-semibold ${style.text}`}>{toast.message}</p>
      </div>
      <button
        onClick={onRemove}
        className="ml-2 p-1 rounded-lg hover:bg-white/10 transition-colors"
      >
        <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  const actionToasts = toasts.filter((toast) => toast.channel !== 'notification');
  const notificationToasts = toasts.filter((toast) => toast.channel === 'notification');

  if (toasts.length === 0) return null;

  return (
    <>
      {actionToasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
          {actionToasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onRemove={() => removeToast(toast.id)}
            />
          ))}
        </div>
      )}
      {notificationToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
          {notificationToasts.map((toast) => (
            <NotificationToastItem
              key={toast.id}
              toast={toast}
              onRemove={() => removeToast(toast.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}
