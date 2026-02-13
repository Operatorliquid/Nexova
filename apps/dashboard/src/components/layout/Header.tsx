import { useEffect, useRef, useState } from 'react';
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
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../stores/toast.store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface HeaderProps {
  title?: string;
}

type WorkspaceWhatsAppNumber = {
  id: string;
  phoneNumber: string;
  displayName?: string | null;
  status?: string | null;
  healthStatus?: string | null;
};

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt: string;
}

export function Header({ title }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { workspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(true);
  const [whatsappNumber, setWhatsappNumber] = useState<WorkspaceWhatsAppNumber | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const timeAgo = (value: string) => {
    const date = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `hace ${diffMins}m`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    return `hace ${diffDays}d`;
  };

  const resolveNotificationStyle = (type: string) => {
    switch (type) {
      case 'order.new':
        return { icon: ShoppingCart, tone: 'text-emerald-400', bg: 'bg-emerald-500/15' };
      case 'order.cancelled':
        return { icon: XCircle, tone: 'text-red-400', bg: 'bg-red-500/15' };
      case 'order.edited':
        return { icon: Pencil, tone: 'text-sky-400', bg: 'bg-sky-500/15' };
      case 'customer.new':
        return { icon: UserPlus, tone: 'text-indigo-400', bg: 'bg-indigo-500/15' };
      case 'receipt.new':
        return { icon: FileText, tone: 'text-primary', bg: 'bg-primary/15' };
      case 'handoff.requested':
        return { icon: AlertTriangle, tone: 'text-amber-400', bg: 'bg-amber-500/15' };
      case 'stock.low':
        return { icon: Package, tone: 'text-destructive', bg: 'bg-destructive/15' };
      default:
        return { icon: Bell, tone: 'text-muted-foreground', bg: 'bg-secondary' };
    }
  };

  const showToastForNotification = (notification: NotificationItem) => {
    if (notification.type === 'order.new') return toast.notify(notification.title, 'success', notification.type);
    if (notification.type === 'order.cancelled') return toast.notify(notification.title, 'warning', notification.type);
    if (notification.type === 'handoff.requested') return toast.notify(notification.title, 'warning', notification.type);
    if (notification.type === 'receipt.new') return toast.notify(notification.title, 'info', notification.type);
    if (notification.type === 'order.edited') return toast.notify(notification.title, 'info', notification.type);
    if (notification.type === 'customer.new') return toast.notify(notification.title, 'info', notification.type);
    if (notification.type === 'stock.low') return toast.notify(notification.title, 'warning', notification.type);
    return toast.notify(notification.title, 'info', notification.type);
  };

  useEffect(() => {
    if (!workspace?.id) return;

    const fetchNotifications = async () => {
      if (!initializedRef.current) {
        setIsNotificationsLoading(true);
      }
      try {
        const params = new URLSearchParams({ limit: '12', offset: '0' });
        const response = await apiFetch(`/api/v1/notifications?${params}`, {}, workspace.id);
        if (!response.ok) {
          setIsNotificationsLoading(false);
          return;
        }
        const data = await response.json();
        const nextNotifications: NotificationItem[] = data.notifications || [];
        setNotifications(nextNotifications);
        setUnreadCount(data.unreadCount ?? 0);

        const currentIds = new Set(nextNotifications.map((item) => item.id));
        if (!initializedRef.current) {
          seenIdsRef.current = currentIds;
          initializedRef.current = true;
          setIsNotificationsLoading(false);
          return;
        }

        const newOnes = nextNotifications.filter((item) => !seenIdsRef.current.has(item.id));
        if (newOnes.length > 0) {
          newOnes.reverse().forEach(showToastForNotification);
          newOnes.forEach((item) => seenIdsRef.current.add(item.id));
        }
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
      } finally {
        setIsNotificationsLoading(false);
      }
    };

    const fetchWhatsAppNumber = async () => {
      try {
        const response = await apiFetch(`/api/v1/workspace/${workspace.id}/whatsapp-numbers`, {}, workspace.id);
        if (!response.ok) {
          setWhatsappNumber(null);
          return;
        }
        const data = await response.json().catch(() => ({}));
        setWhatsappNumber((data?.number as WorkspaceWhatsAppNumber | null) || null);
      } catch (error) {
        console.error('Failed to fetch WhatsApp number:', error);
        setWhatsappNumber(null);
      }
    };

    const fetchAll = async () => {
      await Promise.all([fetchNotifications(), fetchWhatsAppNumber()]);
    };

    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [workspace?.id]);

  const markAsRead = async (notification: NotificationItem) => {
    if (!workspace?.id || notification.readAt) return;
    try {
      await apiFetch(`/api/v1/notifications/${notification.id}/read`, { method: 'PATCH' }, workspace.id);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const navigateTo = (path: string) => {
    setTimeout(() => {
      navigate(path);
    }, 0);
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    await markAsRead(notification);
    const metadata = notification.metadata || {};

    if (notification.type === 'handoff.requested') {
      const sessionId = (metadata.sessionId as string | undefined) || (metadata.conversationId as string | undefined);
      if (sessionId) {
        navigateTo(`/inbox?sessionId=${sessionId}`);
        return;
      }
      const customerId = metadata.customerId as string | undefined;
      if (customerId && workspace?.id) {
        try {
          const response = await apiFetch('/api/v1/conversations', {}, workspace.id);
          if (response.ok) {
            const data = await response.json();
            const conversation = (data.conversations || []).find(
              (item: { customerId?: string }) => item.customerId === customerId
            );
            if (conversation?.id) {
              navigateTo(`/inbox?sessionId=${conversation.id}`);
              return;
            }
          }
        } catch (error) {
          console.error('Failed to resolve handoff conversation:', error);
        }
      }
      navigateTo('/inbox');
      return;
    }

    if (notification.type === 'receipt.new') {
      const orderId = metadata.orderId as string | undefined;
      if (orderId) {
        navigateTo(`/orders?orderId=${orderId}`);
        return;
      }
      const orderNumber = metadata.orderNumber as string | undefined;
      if (orderNumber) {
        navigateTo(`/orders?orderNumber=${orderNumber}`);
        return;
      }
      navigateTo('/orders');
      return;
    }

    if (notification.type === 'stock.low') {
      const productId = notification.entityId || (metadata.productId as string | undefined);
      if (productId) {
        navigateTo(`/stock?productId=${productId}`);
        return;
      }
      navigateTo('/stock');
      return;
    }

    const orderId = notification.entityId || (metadata.orderId as string | undefined);
    if (notification.entityType === 'Order' && orderId) {
      navigateTo(`/orders?orderId=${orderId}`);
      return;
    }
    if (notification.entityType === 'Order') {
      const orderNumber = metadata.orderNumber as string | undefined;
      if (orderNumber) {
        navigateTo(`/orders?orderNumber=${orderNumber}`);
        return;
      }
    }

    const customerId = notification.entityId || (metadata.customerId as string | undefined);
    if (notification.entityType === 'Customer' && customerId) {
      navigateTo(`/customers?customerId=${customerId}`);
      return;
    }
    if (notification.entityType === 'Customer') {
      const customerPhone = metadata.phone as string | undefined;
      if (customerPhone) {
        navigateTo(`/customers?customerPhone=${encodeURIComponent(customerPhone)}`);
        return;
      }
    }

    if (notification.type.startsWith('order.')) {
      navigateTo('/orders');
      return;
    }

    if (notification.type.startsWith('customer.')) {
      navigateTo('/customers');
      return;
    }

    if (notification.type.startsWith('stock.')) {
      navigateTo('/stock');
      return;
    }
  };

  const markAllRead = async () => {
    if (!workspace?.id || unreadCount === 0) return;
    try {
      await apiFetch('/api/v1/notifications/read-all', { method: 'POST' }, workspace.id);
      setNotifications((prev) =>
        prev.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  return (
    <header className="h-16 flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="flex items-center justify-between h-full px-6">
        {/* Left side */}
        <div className="flex items-center gap-4">
          {title && (
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="theme-switch"
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            <span
              className={`theme-switch-thumb flex items-center justify-center ${
                theme === 'dark' ? 'translate-x-1' : 'translate-x-6'
              }`}
            >
              {theme === 'dark' ? (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </span>
          </button>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative p-2 rounded-xl hover:bg-secondary transition-colors">
                <Bell className="w-5 h-5 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] text-white flex items-center justify-center shadow-lg shadow-primary/40">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-96 p-0">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <DropdownMenuLabel className="px-0 py-0 text-sm">Notificaciones</DropdownMenuLabel>
                  <p className="text-xs text-muted-foreground">
                    {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al día'}
                  </p>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs text-primary hover:text-primary/80"
                  >
                    Marcar todo como leído
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto p-2 space-y-2">
                {isNotificationsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-12 rounded-xl bg-secondary/60 animate-pulse" />
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No hay notificaciones todavía
                  </div>
                ) : (
                  notifications.map((notification) => {
                    const { icon: Icon, tone, bg } = resolveNotificationStyle(notification.type);
                    const isHandoff = notification.type === 'handoff.requested';
                    return (
                      <DropdownMenuItem
                        key={notification.id}
                        onSelect={() => handleNotificationClick(notification)}
                        className="p-0 focus:bg-transparent"
                      >
                        <div
                          className={`w-full text-left flex gap-3 rounded-xl border px-3 py-2 transition-colors ${
                            isHandoff && !notification.readAt ? 'border-amber-500/40 bg-amber-500/10' : 'border-border'
                          } ${notification.readAt ? 'bg-secondary/30' : isHandoff ? 'bg-amber-500/15' : 'bg-secondary/60'} hover:bg-secondary`}
                        >
                          <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
                            <Icon className={`w-5 h-5 ${tone}`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">{notification.title}</p>
                              {!notification.readAt && (
                                <span className="w-2 h-2 rounded-full bg-primary shadow-sm" />
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{notification.message}</p>
                            <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(notification.createdAt)}</p>
                          </div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </div>
              <DropdownMenuSeparator />
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Agent status */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${
              whatsappNumber
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-zinc-500/10 border-zinc-500/20'
            }`}
            title={whatsappNumber ? undefined : 'Conectá un número de WhatsApp para comenzar.'}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                whatsappNumber
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                  : 'bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.35)]'
              }`}
            />
            <span
              className={`text-xs font-medium ${
                whatsappNumber ? 'text-emerald-400' : 'text-zinc-300'
              }`}
            >
              {whatsappNumber ? 'Agente activo' : 'Agente inactivo'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
