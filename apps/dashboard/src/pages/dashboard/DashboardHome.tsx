import { useEffect, useMemo, useState } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { ResponsivePie } from '@nivo/pie';
import {
  Bell,
  CalendarDays,
  CreditCard,
  DollarSign,
  MessageSquare,
  Package,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AnimatedPage,
  AnimatedStagger,
  StatCard,
  AnimatedItem,
} from '../../components/ui';
import { ChartTooltip, TooltipLine } from '../../components/ui/chart-tooltip';
import { getNivoTheme } from '../../lib/nivo-theme';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';
import { Link } from 'react-router-dom';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  customer: {
    id: string;
    phone: string;
    name: string;
  };
  itemCount: number;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  createdAt: string;
  items?: OrderItem[];
}

interface ConversationPreview {
  id: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  channelType: string;
  agentActive: boolean;
  currentState: string;
  lastMessage: string | null;
  lastMessageRole: 'user' | 'assistant' | 'system' | null;
  lastActivityAt: string;
}

const RANGE_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
];

const STATUS_COLORS = ['#22c55e', 'hsl(var(--primary))', 'hsl(var(--primary) / 0.8)', '#ef4444', '#64748b'];

const formatCurrency = (amount: number) => `$${(amount / 100).toLocaleString('es-AR')}`;

const resolveRange = (range: string) => {
  const now = new Date();
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  if (range === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return {
      from: startOfDay(yesterday),
      to: endOfDay(yesterday),
      mode: 'hourly',
      label: 'Ayer',
    } as const;
  }

  if (range === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const start = new Date(now);
    start.setDate(now.getDate() + diff);
    return {
      from: startOfDay(start),
      to: now,
      mode: 'daily',
      label: 'Esta semana',
    } as const;
  }

  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from: startOfDay(start),
      to: now,
      mode: 'daily',
      label: 'Este mes',
    } as const;
  }

  return {
    from: startOfDay(now),
    to: now,
    mode: 'hourly',
    label: 'Hoy',
  } as const;
};

const buildDailyBuckets = (from: Date, to: Date) => {
  const buckets: Array<{ key: string; label: string; total: number; orders: number }> = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const key = cursor.toLocaleDateString('en-CA');
    buckets.push({
      key,
      label: new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(cursor),
      total: 0,
      orders: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
};

const buildHourlyBuckets = () => {
  const buckets: Array<{ key: string; label: string; total: number; orders: number }> = [];
  for (let hour = 0; hour < 24; hour += 1) {
    buckets.push({
      key: String(hour).padStart(2, '0'),
      label: `${String(hour).padStart(2, '0')}h`,
      total: 0,
      orders: 0,
    });
  }
  return buckets;
};

const mapStatus = (status: string) => {
  if (['awaiting_acceptance', 'draft'].includes(status)) return 'Esperando aprobación';
  if (['accepted', 'processing', 'shipped', 'delivered', 'confirmed', 'preparing', 'ready'].includes(status)) {
    return 'En curso';
  }
  if (status === 'paid') return 'Pagado';
  if (['cancelled', 'returned'].includes(status)) return 'Cancelado';
  if (status === 'trashed') return 'Papelera';
  return 'Otros';
};

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

const truncateText = (value: string, max = 80) => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
};

export default function DashboardHome() {
  const { user, workspace } = useAuth();
  const [range, setRange] = useState('today');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(true);

  const rangeMeta = useMemo(() => resolveRange(range), [range]);

  useEffect(() => {
    if (!workspace?.id) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          limit: '100',
          offset: '0',
          sortBy: 'createdAt',
          sortOrder: 'desc',
          from: rangeMeta.from.toISOString(),
          to: rangeMeta.to.toISOString(),
          includeTrashed: 'true',
        });

        const response = await apiFetch(`/api/v1/orders?${params}`, {}, workspace.id);
        if (response.ok) {
          const data = await response.json();
          setOrders(data.orders || []);
        } else {
          setOrders([]);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard orders:', error);
        setOrders([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [workspace?.id, rangeMeta.from, rangeMeta.to]);

  useEffect(() => {
    if (!workspace?.id) return;

    const fetchConversations = async () => {
      setIsMessagesLoading(true);
      try {
        const response = await apiFetch('/api/v1/conversations', {}, workspace.id);
        if (response.ok) {
          const data = await response.json();
          setConversations(data.conversations || []);
        } else {
          setConversations([]);
        }
      } catch (error) {
        console.error('Failed to fetch conversations:', error);
        setConversations([]);
      } finally {
        setIsMessagesLoading(false);
      }
    };

    fetchConversations();
  }, [workspace?.id]);

  const summary = useMemo(() => {
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const totalPaid = orders.reduce((sum, order) => sum + order.paidAmount, 0);
    const pendingRevenue = orders.reduce((sum, order) => sum + order.pendingAmount, 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const newOrders = orders.filter((order) => ['awaiting_acceptance', 'draft'].includes(order.status));

    return {
      totalOrders,
      totalRevenue,
      totalPaid,
      pendingRevenue,
      avgOrderValue,
      newOrders,
    };
  }, [orders]);

  const chartData = useMemo(() => {
    const buckets = rangeMeta.mode === 'hourly'
      ? buildHourlyBuckets()
      : buildDailyBuckets(rangeMeta.from, rangeMeta.to);
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

    orders.forEach((order) => {
      const createdAt = new Date(order.createdAt);
      const key = rangeMeta.mode === 'hourly'
        ? String(createdAt.getHours()).padStart(2, '0')
        : createdAt.toLocaleDateString('en-CA');
      const bucket = bucketMap.get(key);
      if (!bucket) return;
      bucket.total += order.total;
      bucket.orders += 1;
    });

    return buckets;
  }, [orders, rangeMeta.from, rangeMeta.to, rangeMeta.mode]);

  const nivoLineData = useMemo(() => [{
    id: 'revenue',
    data: chartData.map((d) => ({ x: d.label, y: d.total, orders: d.orders })),
  }], [chartData]);

  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    orders.forEach((order) => {
      const label = mapStatus(order.status);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
  }, [orders]);

  const nivoPieData = useMemo(
    () =>
      statusBreakdown.map((entry, index) => ({
        id: entry.label,
        label: entry.label,
        value: entry.value,
        color: STATUS_COLORS[index % STATUS_COLORS.length],
      })),
    [statusBreakdown],
  );

  const topProducts = useMemo(() => {
    const totals = new Map<string, { quantity: number; revenue: number }>();
    orders.forEach((order) => {
      order.items?.forEach((item) => {
        const current = totals.get(item.name) || { quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.total;
        totals.set(item.name, current);
      });
    });
    return Array.from(totals.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [orders]);

  const recentMessages = useMemo(() => conversations.slice(0, 6), [conversations]);
  const resolveMessagePrefix = (role: ConversationPreview['lastMessageRole']) => {
    if (role === 'user') return 'Cliente: ';
    if (role === 'assistant') return 'Bot: ';
    return '';
  };

  const nivoTheme = useMemo(() => getNivoTheme(), []);

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Hola, {user?.firstName || 'Usuario'}
            </h1>
            <p className="text-muted-foreground mt-1">
              Resumen general de tu negocio
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Periodo" />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="secondary">
              <Link to="/orders">Ver pedidos</Link>
            </Button>
          </div>
        </div>

        {summary.newOrders.length > 0 && (
          <div className="glass-card rounded-2xl p-4 border border-primary/30 bg-primary/10">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Bell className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-primary">Tenés nuevos pedidos esperando aprobación</p>
                  <p className="text-sm text-foreground font-semibold">
                    {summary.newOrders.length} pedidos en espera
                  </p>
                </div>
              </div>
              <Button asChild size="sm">
                <Link to="/orders?status=awaiting_acceptance">Revisar ahora</Link>
              </Button>
            </div>
          </div>
        )}

        <AnimatedStagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <StatCard label="Ventas" value={formatCurrency(summary.totalRevenue)} icon={DollarSign} color="emerald" isLoading={isLoading} />
          <StatCard label="Pedidos" value={summary.totalOrders.toString()} icon={ShoppingCart} color="primary" isLoading={isLoading} />
          <StatCard label="Nuevos pedidos" value={summary.newOrders.length.toString()} icon={Bell} color="primary" isLoading={isLoading} />
          <StatCard label="Pagado" value={formatCurrency(summary.totalPaid)} icon={CreditCard} color="emerald" isLoading={isLoading} />
          <StatCard label="Pendiente" value={formatCurrency(summary.pendingRevenue)} icon={TrendingUp} color="primary" isLoading={isLoading} />
        </AnimatedStagger>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Ventas en {rangeMeta.label.toLowerCase()}</h3>
                <p className="text-sm text-muted-foreground">Resumen de ingresos y pedidos</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="w-4 h-4" />
                {rangeMeta.label}
              </div>
            </div>
            <div className="p-5 h-72">
              {chartData.length === 0 || summary.totalOrders === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                    <TrendingUp className="w-7 h-7 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground">No hay datos en este periodo</p>
                  <p className="text-sm text-muted-foreground/50 mt-1">Las ventas aparecerán acá</p>
                </div>
              ) : (
                <ResponsiveLine
                  data={nivoLineData}
                  theme={nivoTheme}
                  margin={{ top: 10, right: 12, bottom: 30, left: 12 }}
                  xScale={{ type: 'point' }}
                  yScale={{ type: 'linear', min: 0, max: 'auto' }}
                  curve="monotoneX"
                  enableArea
                  areaOpacity={0.15}
                  colors={['hsl(var(--primary))']}
                  lineWidth={2}
                  pointSize={0}
                  enableGridX={false}
                  enableGridY={false}
                  axisLeft={null}
                  axisBottom={{
                    tickSize: 0,
                    tickPadding: 8,
                    tickRotation: 0,
                  }}
                  defs={[
                    {
                      id: 'areaGradient',
                      type: 'linearGradient',
                      colors: [
                        { offset: 0, color: 'hsl(var(--primary))', opacity: 0.4 },
                        { offset: 100, color: 'hsl(var(--primary))', opacity: 0.05 },
                      ],
                    },
                  ]}
                  fill={[{ match: '*', id: 'areaGradient' }]}
                  tooltip={({ point }) => {
                    const d = point.data as { x: string; y: number; orders?: number };
                    return (
                      <ChartTooltip>
                        <TooltipLine label={String(d.x)} value={formatCurrency(d.y)} />
                        {typeof d.orders === 'number' && (
                          <p className="text-[11px] text-muted-foreground">{d.orders} pedidos</p>
                        )}
                      </ChartTooltip>
                    );
                  }}
                  crosshairType="x"
                  useMesh
                />
              )}
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Pedidos por estado</h3>
              <p className="text-sm text-muted-foreground">Distribución del periodo</p>
            </div>
            <div className="p-5 h-72 flex flex-col">
              {statusBreakdown.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                    <ShoppingCart className="w-7 h-7 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground">Sin pedidos</p>
                  <p className="text-sm text-muted-foreground/50 mt-1">No hay datos en este periodo</p>
                </div>
              ) : (
                <>
                  <div className="h-40">
                    <ResponsivePie
                      data={nivoPieData}
                      theme={nivoTheme}
                      margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                      innerRadius={0.65}
                      padAngle={3}
                      cornerRadius={4}
                      colors={{ datum: 'data.color' }}
                      enableArcLinkLabels={false}
                      enableArcLabels={false}
                      tooltip={({ datum }) => (
                        <ChartTooltip>
                          <TooltipLine
                            color={String(datum.color)}
                            label={datum.label as string}
                            value={String(datum.value)}
                            sub="pedidos"
                          />
                        </ChartTooltip>
                      )}
                    />
                  </div>
                  <div className="space-y-2 mt-2">
                    {statusBreakdown.map((entry, index) => (
                      <div key={entry.label} className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: STATUS_COLORS[index % STATUS_COLORS.length] }}
                          />
                          <span>{entry.label}</span>
                        </div>
                        <span className="text-foreground font-medium">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Pedidos recientes</h3>
              <Link to="/orders" className="text-sm text-primary hover:text-primary/80">
                Ver todos
              </Link>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-12 rounded-xl bg-secondary/60 animate-pulse" />
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                    <Package className="w-7 h-7 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground">No hay pedidos en este periodo</p>
                  <p className="text-sm text-muted-foreground/50 mt-1">
                    Cuando tengas ventas aparecerán acá
                  </p>
                </div>
              ) : (
                <AnimatedStagger className="space-y-3">
                  {orders.slice(0, 6).map((order) => (
                    <AnimatedItem key={order.id}>
                      <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Pedido {order.orderNumber}</p>
                          <p className="text-xs text-muted-foreground">
                            {order.customer.name} · {timeAgo(order.createdAt)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">{formatCurrency(order.total)}</p>
                          <p className="text-xs text-muted-foreground">{order.itemCount} items</p>
                        </div>
                      </div>
                    </AnimatedItem>
                  ))}
                </AnimatedStagger>
              )}
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Top productos</h3>
              <p className="text-sm text-muted-foreground">Lo más vendido en el periodo</p>
            </div>
            <div className="p-5">
              {topProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                    <Package className="w-7 h-7 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground">Sin datos todavía</p>
                  <p className="text-sm text-muted-foreground/50 mt-1">
                    Los productos más vendidos aparecerán aquí
                  </p>
                </div>
              ) : (
                <AnimatedStagger className="space-y-3">
                  {topProducts.map((product, index) => {
                    const maxRevenue = topProducts[0]?.revenue || 1;
                    const pct = Math.round((product.revenue / maxRevenue) * 100);
                    return (
                      <AnimatedItem key={product.name}>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-medium text-muted-foreground w-4 shrink-0">{index + 1}</span>
                              <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                            </div>
                            <span className="text-sm font-semibold text-foreground shrink-0 ml-3">
                              {formatCurrency(product.revenue)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary/60"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-muted-foreground shrink-0">{product.quantity} uds</span>
                          </div>
                        </div>
                      </AnimatedItem>
                    );
                  })}
                </AnimatedStagger>
              )}
            </div>
          </div>
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Últimos mensajes</h3>
            <Link to="/inbox" className="text-sm text-primary hover:text-primary/80">
              Abrir inbox
            </Link>
          </div>
          <div className="p-5">
            {isMessagesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-12 rounded-xl bg-secondary/60 animate-pulse" />
                ))}
              </div>
            ) : recentMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <MessageSquare className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No hay mensajes recientes</p>
                <p className="text-sm text-muted-foreground/50 mt-1">
                  Los mensajes aparecerán aquí
                </p>
              </div>
            ) : (
              <AnimatedStagger className="space-y-3">
                {recentMessages.map((conversation) => (
                  <AnimatedItem key={conversation.id}>
                    <div className="flex items-start justify-between rounded-xl border border-border bg-secondary/50 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{conversation.customerName}</p>
                        <p className="text-xs text-muted-foreground">{conversation.customerPhone}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {truncateText(
                            `${resolveMessagePrefix(conversation.lastMessageRole)}${conversation.lastMessage || 'Sin mensajes'}`,
                            90
                          )}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground">{timeAgo(conversation.lastActivityAt)}</div>
                    </div>
                  </AnimatedItem>
                ))}
              </AnimatedStagger>
            )}
          </div>
        </div>

      </AnimatedPage>
    </div>
  );
}
