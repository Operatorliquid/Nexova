import { useEffect, useMemo, useState } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsivePie } from '@nivo/pie';
import { DollarSign, ShoppingCart, TrendingUp, CreditCard, Users, Package, CalendarDays, BarChart3, Sparkles, ReceiptText } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AnimatedPage,
  AnimatedStagger,
  AnimatedCard,
  AnimatedItem,
} from '../../components/ui';
import { ChartTooltip, TooltipLine } from '../../components/ui/chart-tooltip';
import { getNivoTheme } from '../../lib/nivo-theme';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';

interface MetricsSummary {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  totalPaid: number;
  pendingRevenue: number;
  paidRate: number;
  totalStockPurchases: number;
  stockReceiptCount: number;
}

interface MetricsCustomer {
  id: string;
  name: string;
  phone: string;
  orderCount: number;
  totalSpent: number;
}

interface MetricsProduct {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
}

interface MetricsSeriesPoint {
  key: string;
  label: string;
  total: number;
  orders?: number;
}

interface MetricsResponse {
  range: {
    from: string | null;
    to: string;
    label: string;
  };
  summary: MetricsSummary;
  topCustomers: MetricsCustomer[];
  topProducts: MetricsProduct[];
  salesByDay: MetricsSeriesPoint[];
  salesByWeekday: MetricsSeriesPoint[];
  salesByMonth: MetricsSeriesPoint[];
  stockPurchasesByMonth: MetricsSeriesPoint[];
  paymentsByMethod: Array<{ method: string; total: number; count: number }>;
}

interface GeneratedInsights {
  headline: string;
  summary: string;
  strengths: string[];
  risks: string[];
  opportunities: string[];
  actions: Array<{ title: string; detail: string; priority: 'alta' | 'media' | 'baja' }>;
}

const RANGE_OPTIONS = [
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: 'all', label: 'Todo el historial' },
];

const formatCurrency = (amount: number) => `$${(amount / 100).toLocaleString('es-AR')}`;
const formatCompact = (amount: number) =>
  amount >= 100000
    ? `$${(amount / 100 / 1000).toFixed(1).replace('.0', '')}k`
    : formatCurrency(amount);
const getPriorityStyle = (priority: 'alta' | 'media' | 'baja') => {
  if (priority === 'alta') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (priority === 'media') return 'border-primary/30 bg-primary/10 text-primary/80';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
};

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-secondary ${className ?? ''}`} />;
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center py-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/50 mt-1">{subtitle}</p>
    </div>
  );
}

export default function MetricsPage() {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const [range, setRange] = useState('90d');
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [insights, setInsights] = useState<GeneratedInsights | null>(null);
  const [isInsightsLoading, setIsInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');

  useEffect(() => {
    if (!workspace?.id) return;
    const loadMetrics = async () => {
      setIsLoading(true);
      try {
        const response = await apiFetch(`/api/v1/analytics/metrics?range=${range}`, {}, workspace.id);
        if (response.ok) {
          const data = await response.json();
          setMetrics(data);
        }
      } catch (error) {
        console.error('Failed to load metrics:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMetrics();
  }, [workspace?.id, range]);

  const summaryCards = useMemo(() => {
    const summary = metrics?.summary;
    return [
      {
        label: 'Ventas totales',
        value: summary?.totalRevenue ?? 0,
        highlight: 'text-emerald-400',
        icon: DollarSign,
        iconBg: 'bg-emerald-500/10',
        iconColor: 'text-emerald-400',
      },
      {
        label: 'Pedidos',
        value: summary?.totalOrders ?? 0,
        highlight: 'text-foreground',
        isCurrency: false,
        icon: ShoppingCart,
        iconBg: 'bg-blue-500/10',
        iconColor: 'text-blue-400',
      },
      {
        label: 'Ticket promedio',
        value: summary?.avgOrderValue ?? 0,
        highlight: 'text-emerald-400',
        icon: TrendingUp,
        iconBg: 'bg-emerald-500/10',
        iconColor: 'text-emerald-400',
      },
      {
        label: 'Cobrado',
        value: summary?.totalPaid ?? 0,
        highlight: 'text-cyan-400',
        icon: CreditCard,
        iconBg: 'bg-cyan-500/10',
        iconColor: 'text-cyan-400',
      },
    ];
  }, [metrics]);

  const pendingRevenue = metrics?.summary.pendingRevenue ?? 0;
  const paidRate = metrics?.summary.paidRate ?? 0;
  const pendingRate = Math.max(0, 1 - paidRate);

  const salesByDay = metrics?.salesByDay ?? [];
  const salesByWeekday = metrics?.salesByWeekday ?? [];
  const salesByMonth = metrics?.salesByMonth ?? [];
  const stockPurchasesByMonth = metrics?.stockPurchasesByMonth ?? [];
  const paymentsByMethod = metrics?.paymentsByMethod ?? [];

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Efectivo',
    transfer: 'Transferencia',
    link: 'Link de pago',
    other: 'Otros',
  };

  const paymentMethodColors: Record<string, string> = {
    cash: '#22c55e',
    transfer: '#38bdf8',
    link: 'hsl(var(--primary))',
    other: '#94a3b8',
  };

  const paymentMethodTotals = useMemo(() => {
    const total = paymentsByMethod.reduce((sum, entry) => sum + entry.total, 0);
    const items = paymentsByMethod
      .filter((entry) => entry.total > 0)
      .map((entry) => ({
        ...entry,
        label: paymentMethodLabels[entry.method] || entry.method,
        color: paymentMethodColors[entry.method] || paymentMethodColors.other,
      }))
      .sort((a, b) => b.total - a.total);
    return { total, items };
  }, [paymentsByMethod]);

  // Nivo data transforms
  const nivoSalesByDay = useMemo(() => [{
    id: 'ventas',
    data: salesByDay.map((d) => ({ x: d.label, y: d.total, orders: d.orders })),
  }], [salesByDay]);

  const nivoSalesByWeekday = useMemo(
    () => salesByWeekday.map((d) => ({ day: d.label, total: d.total, orders: d.orders ?? 0 })),
    [salesByWeekday],
  );

  const nivoSalesByMonth = useMemo(
    () => salesByMonth.map((d) => ({ month: d.label, total: d.total, orders: d.orders ?? 0 })),
    [salesByMonth],
  );

  const nivoStockSparkline = useMemo(() => [{
    id: 'stock',
    data: stockPurchasesByMonth.map((d) => ({ x: d.label, y: d.total })),
  }], [stockPurchasesByMonth]);

  const nivoPiePayments = useMemo(
    () =>
      paymentMethodTotals.items.map((entry) => ({
        id: entry.label,
        label: entry.label,
        value: entry.total,
        color: entry.color,
        count: entry.count,
      })),
    [paymentMethodTotals.items],
  );

  const nivoTheme = useMemo(() => getNivoTheme(), []);

  useEffect(() => {
    if (!capabilities.showMetricsAiInsights || !isInsightsOpen || !workspace?.id) return;
    const loadInsights = async () => {
      setInsightsError('');
      setIsInsightsLoading(true);
      try {
        const response = await apiFetch(`/api/v1/analytics/insights?range=${range}`, {}, workspace.id);
        if (!response.ok) {
          throw new Error('No se pudo generar el resumen');
        }
        const data = await response.json();
        setInsights(data.insights);
      } catch (error) {
        setInsights(null);
        setInsightsError(error instanceof Error ? error.message : 'No se pudo generar el resumen');
      } finally {
        setIsInsightsLoading(false);
      }
    };

    loadInsights();
  }, [capabilities.showMetricsAiInsights, isInsightsOpen, range, workspace?.id]);

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Métricas del negocio</h1>
            <p className="text-sm text-muted-foreground">
              {metrics?.range.label || 'Resumen de ventas y clientes'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <div className="w-full md:w-56">
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Rango" />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {capabilities.showMetricsAiInsights && (
              <Button
                variant="secondary"
                className="w-full md:w-auto"
                onClick={() => setIsInsightsOpen(true)}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Consejos IA
              </Button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <AnimatedStagger className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {summaryCards.map((card, index) => (
            <AnimatedCard key={index}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  {isLoading ? (
                    <SkeletonPulse className="h-7 w-24 mt-1" />
                  ) : (
                    <p className={`text-2xl font-semibold mt-1 ${card.highlight}`}>
                      {card.isCurrency === false
                        ? card.value.toString()
                        : formatCurrency(card.value)}
                    </p>
                  )}
                </div>
                <div className={`w-10 h-10 rounded-xl ${card.iconBg} flex items-center justify-center`}>
                  <card.icon className={`w-5 h-5 ${card.iconColor}`} />
                </div>
              </div>
            </AnimatedCard>
          ))}
        </AnimatedStagger>

        {/* Sales by day + top customers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Ventas por día</h3>
                <p className="text-xs text-muted-foreground">Evolución de ingresos</p>
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                {formatCurrency(metrics?.summary.totalRevenue ?? 0)}
              </span>
            </div>
            <div className="p-5">
              <div className="h-64">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <SkeletonPulse className="w-full h-full" />
                  </div>
                ) : salesByDay.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title="Sin ventas en este período"
                    subtitle="Los datos aparecerán cuando registres pedidos"
                  />
                ) : (
                  <ResponsiveLine
                    data={nivoSalesByDay}
                    theme={nivoTheme}
                    margin={{ top: 10, right: 12, bottom: 30, left: 50 }}
                    xScale={{ type: 'point' }}
                    yScale={{ type: 'linear', min: 0, max: 'auto' }}
                    curve="monotoneX"
                    enableArea
                    areaOpacity={0.15}
                    colors={['hsl(var(--primary))']}
                    lineWidth={2}
                    pointSize={0}
                    enableGridX={false}
                    axisLeft={{
                      tickSize: 0,
                      tickPadding: 8,
                      format: (v) => formatCompact(v as number),
                    }}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 8,
                      tickRotation: 0,
                      tickValues: salesByDay.length > 10
                        ? salesByDay.filter((_, i) => i % Math.floor(salesByDay.length / 6) === 0).map((d) => d.label)
                        : undefined,
                    }}
                    defs={[
                      {
                        id: 'salesGradient',
                        type: 'linearGradient',
                        colors: [
                          { offset: 0, color: 'hsl(var(--primary))', opacity: 0.4 },
                          { offset: 100, color: 'hsl(var(--primary))', opacity: 0.05 },
                        ],
                      },
                    ]}
                    fill={[{ match: '*', id: 'salesGradient' }]}
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
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Mejores clientes</h3>
              <p className="text-xs text-muted-foreground">Top por monto total</p>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonPulse key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : (metrics?.topCustomers.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Sin clientes destacados"
                  subtitle="Aparecerán cuando registres ventas"
                />
              ) : (
                <AnimatedStagger className="space-y-3">
                  {metrics?.topCustomers.map((customer, index) => (
                    <AnimatedItem key={customer.id}>
                      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/40 border border-border">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {customer.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {customer.orderCount} pedidos
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-emerald-400 flex-shrink-0">
                          {formatCurrency(customer.totalSpent)}
                        </span>
                      </div>
                    </AnimatedItem>
                  ))}
                </AnimatedStagger>
              )}
            </div>
          </div>
        </div>

        {/* Sales by weekday + top products + sales by month */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Ventas por día de la semana</h3>
              <p className="text-xs text-muted-foreground">Dónde se mueve más el negocio</p>
            </div>
            <div className="p-5">
              <div className="h-56">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <SkeletonPulse className="w-full h-full" />
                  </div>
                ) : salesByWeekday.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title="Sin datos aún"
                    subtitle="Se llenará con tus primeras ventas"
                  />
                ) : (
                  <ResponsiveBar
                    data={nivoSalesByWeekday}
                    keys={['total']}
                    indexBy="day"
                    theme={nivoTheme}
                    margin={{ top: 10, right: 12, bottom: 30, left: 50 }}
                    padding={0.35}
                    borderRadius={6}
                    colors={['hsl(var(--primary))']}
                    enableGridY
                    enableLabel={false}
                    axisLeft={{
                      tickSize: 0,
                      tickPadding: 8,
                      format: (v) => formatCompact(v as number),
                    }}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 8,
                    }}
                    tooltip={({ data }) => (
                      <ChartTooltip>
                        <TooltipLine
                          label={data.day as string}
                          value={formatCurrency(data.total as number)}
                          sub={typeof data.orders === 'number' ? `${data.orders} pedidos` : undefined}
                        />
                      </ChartTooltip>
                    )}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Producto más vendido</h3>
              <p className="text-xs text-muted-foreground">Top por unidades</p>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonPulse key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : (metrics?.topProducts.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Package}
                  title="Sin productos vendidos"
                  subtitle="Aparecerán cuando registres ventas"
                />
              ) : (
                <AnimatedStagger className="space-y-3">
                  {metrics?.topProducts.map((product, index) => (
                    <AnimatedItem key={product.id}>
                      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/40 border border-border">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold flex items-center justify-center">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {product.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {product.quantity} unidades · {formatCurrency(product.revenue)}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-primary flex-shrink-0">
                          {product.quantity}u
                        </span>
                      </div>
                    </AnimatedItem>
                  ))}
                </AnimatedStagger>
              )}
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Ventas por mes</h3>
              <p className="text-xs text-muted-foreground">Tendencia mensual</p>
            </div>
            <div className="p-5">
              <div className="h-56">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <SkeletonPulse className="w-full h-full" />
                  </div>
                ) : salesByMonth.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title="Sin datos aún"
                    subtitle="Se llenará con tus primeras ventas"
                  />
                ) : (
                  <ResponsiveBar
                    data={nivoSalesByMonth}
                    keys={['total']}
                    indexBy="month"
                    theme={nivoTheme}
                    margin={{ top: 10, right: 12, bottom: 30, left: 50 }}
                    padding={0.35}
                    borderRadius={6}
                    colors={['hsl(var(--primary))']}
                    enableGridY
                    enableLabel={false}
                    axisLeft={{
                      tickSize: 0,
                      tickPadding: 8,
                      format: (v) => formatCompact(v as number),
                    }}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 8,
                      tickValues: salesByMonth.length > 10
                        ? salesByMonth.filter((_, i) => i % Math.floor(salesByMonth.length / 6) === 0).map((d) => d.label)
                        : undefined,
                    }}
                    tooltip={({ data }) => (
                      <ChartTooltip>
                        <TooltipLine
                          label={data.month as string}
                          value={formatCurrency(data.total as number)}
                          sub={typeof data.orders === 'number' ? `${data.orders} pedidos` : undefined}
                        />
                      </ChartTooltip>
                    )}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Payment methods */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold text-foreground">Cobros por método</h3>
            <p className="text-xs text-muted-foreground">Distribución de ingresos por forma de pago</p>
          </div>
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-56">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <SkeletonPulse className="w-full h-full" />
                </div>
              ) : paymentMethodTotals.items.length === 0 ? (
                <EmptyState
                  icon={CreditCard}
                  title="Sin cobros registrados"
                  subtitle="Se verá cuando tengas pagos completados"
                />
              ) : (
                <ResponsivePie
                  data={nivoPiePayments}
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
                        value={formatCurrency(datum.value)}
                        sub={`${(datum.data as { count?: number }).count ?? 0} pagos`}
                      />
                    </ChartTooltip>
                  )}
                />
              )}
            </div>
            <div className="space-y-3">
              {paymentMethodTotals.items.map((entry) => {
                const share = paymentMethodTotals.total
                  ? Math.round((entry.total / paymentMethodTotals.total) * 100)
                  : 0;
                return (
                  <div
                    key={entry.method}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/40 border border-border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{entry.label}</p>
                        <p className="text-[11px] text-muted-foreground">{entry.count} pagos</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(entry.total)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{share}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Payment status + Stock purchases */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Estado de cobros</h3>
                <p className="text-xs text-muted-foreground">
                  Pendiente por cobrar y tasa de pagos
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-sm text-muted-foreground">Cobrado</span>
                  <span className="text-sm font-semibold text-emerald-400">
                    {formatCurrency(metrics?.summary.totalPaid ?? 0)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-sm text-muted-foreground">Pendiente</span>
                  <span className="text-sm font-semibold text-amber-400">{formatCurrency(pendingRevenue)}</span>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex-1 h-3 rounded-full bg-secondary overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.round(paidRate * 100)}%` }}
                  />
                  <div
                    className="h-full bg-gradient-to-r from-amber-600 to-amber-500 transition-all duration-500"
                    style={{ width: `${Math.round(pendingRate * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground min-w-[4rem] text-right">
                  {Math.round(paidRate * 100)}%
                </span>
              </div>
            </div>
          </div>

          {capabilities.showMetricsStockExpenseCard && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-border">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">Gasto en stock</h3>
                    <p className="text-xs text-muted-foreground">Compras por boletas</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <ReceiptText className="w-5 h-5 text-amber-400" />
                  </div>
                </div>
                <div className="mt-3">
                  {isLoading ? (
                    <SkeletonPulse className="h-8 w-32" />
                  ) : (
                    <p className="text-2xl font-semibold text-amber-400">
                      {formatCurrency(metrics?.summary.totalStockPurchases ?? 0)}
                    </p>
                  )}
                  {!isLoading && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {metrics?.summary.stockReceiptCount ?? 0} boletas procesadas
                    </p>
                  )}
                </div>
              </div>
              <div className="p-5">
                <div className="h-24">
                  {isLoading ? (
                    <SkeletonPulse className="w-full h-full" />
                  ) : stockPurchasesByMonth.length === 0 || stockPurchasesByMonth.every((p) => p.total === 0) ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-xs text-muted-foreground/50">Sin datos de compras</p>
                    </div>
                  ) : (
                    <ResponsiveLine
                      data={nivoStockSparkline}
                      theme={nivoTheme}
                      margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
                      xScale={{ type: 'point' }}
                      yScale={{ type: 'linear', min: 0, max: 'auto' }}
                      curve="monotoneX"
                      colors={['#f59e0b']}
                      lineWidth={2}
                      pointSize={0}
                      enableGridX={false}
                      enableGridY={false}
                      axisLeft={null}
                      axisBottom={null}
                      enableCrosshair={false}
                      tooltip={({ point }) => {
                        const d = point.data as { x: string; y: number };
                        return (
                          <ChartTooltip>
                            <TooltipLine label={String(d.x)} value={formatCurrency(d.y)} />
                          </ChartTooltip>
                        );
                      }}
                      useMesh
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </AnimatedPage>

      {capabilities.showMetricsAiInsights && (
        <Dialog open={isInsightsOpen} onOpenChange={setIsInsightsOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <DialogTitle>Consejos IA</DialogTitle>
                  <DialogDescription>
                    Ideas basadas en tu rendimiento actual para mejorar ventas y cobros.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="pt-4 flex-1 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Ventas</p>
                    <p className="text-lg font-semibold text-foreground">
                      {isLoading ? '--' : formatCurrency(metrics?.summary.totalRevenue ?? 0)}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-primary" />
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Pedidos</p>
                    <p className="text-lg font-semibold text-foreground">
                      {isLoading ? '--' : (metrics?.summary.totalOrders ?? 0)}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-blue-400" />
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Cobrado</p>
                    <p className="text-lg font-semibold text-emerald-400">
                      {isLoading ? '--' : `${Math.round(paidRate * 100)}%`}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-cyan-400" />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {isInsightsLoading && (
                <div className="space-y-3">
                  <SkeletonPulse className="h-6 w-1/2" />
                  <SkeletonPulse className="h-20 w-full" />
                  <SkeletonPulse className="h-20 w-full" />
                </div>
              )}

              {!isInsightsLoading && insightsError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                  {insightsError}
                </div>
              )}

              {!isInsightsLoading && insights && (
                <>
                  <div className="rounded-xl border border-border bg-secondary/40 p-4">
                    <p className="text-sm font-semibold text-foreground">{insights.headline}</p>
                    <p className="text-sm text-muted-foreground mt-2">{insights.summary}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <p className="text-xs text-muted-foreground mb-2">Fortalezas</p>
                      <ul className="text-sm text-foreground space-y-1">
                        {insights.strengths.map((item, index) => (
                          <li key={`strength-${index}`}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <p className="text-xs text-muted-foreground mb-2">Riesgos</p>
                      <ul className="text-sm text-foreground space-y-1">
                        {insights.risks.map((item, index) => (
                          <li key={`risk-${index}`}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <p className="text-xs text-muted-foreground mb-2">Oportunidades</p>
                      <ul className="text-sm text-foreground space-y-1">
                        {insights.opportunities.map((item, index) => (
                          <li key={`opportunity-${index}`}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-foreground">Plan de acción</p>
                    {insights.actions.map((action, index) => (
                      <div
                        key={`action-${index}`}
                        className={`rounded-xl border p-4 ${getPriorityStyle(action.priority)}`}
                      >
                        <p className="text-sm font-semibold">
                          {action.title}
                          <span className="ml-2 text-xs uppercase opacity-70">{action.priority}</span>
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">{action.detail}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
