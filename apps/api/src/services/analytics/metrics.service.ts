import { PrismaClient } from '@prisma/client';

export type MetricsRange = 'today' | 'week' | 'month' | '30d' | '90d' | '12m' | 'all';
export type MetricsRangeInput = MetricsRange | { from: Date; to?: Date; label: string };

export interface MetricsSummary {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  totalPaid: number;
  pendingRevenue: number;
  paidRate: number;
  totalStockPurchases: number;
  stockReceiptCount: number;
}

export interface MetricsCustomer {
  id: string;
  name: string;
  phone: string;
  orderCount: number;
  totalSpent: number;
}

export interface MetricsProduct {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface MetricsSeriesPoint {
  key: string;
  label: string;
  total: number;
  orders?: number;
}

export interface MetricsPaymentsByMethod {
  method: string;
  total: number;
  count: number;
}

export interface MetricsResponse {
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
  paymentsByMethod: MetricsPaymentsByMethod[];
}

const EXCLUDED_STATUSES = ['cancelled', 'returned', 'draft'];

export function normalizeRange(range?: string): MetricsRange {
  if (
    range === 'today' ||
    range === 'week' ||
    range === 'month' ||
    range === '30d' ||
    range === '90d' ||
    range === '12m' ||
    range === 'all'
  ) {
    return range;
  }
  return '90d';
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function formatDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(date);
}

function formatMonthLabel(date: Date): string {
  const base = new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(date);
  const year = String(date.getFullYear()).slice(-2);
  return `${base} ${year}`;
}

function buildDailySeries(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    days.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildMonthlySeries(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export async function buildMetrics(
  prisma: PrismaClient,
  workspaceId: string,
  rangeInput?: MetricsRangeInput
): Promise<MetricsResponse> {
  const now = new Date();
  const labelMap: Record<MetricsRange, string> = {
    today: 'Hoy',
    week: 'Esta semana',
    month: 'Este mes',
    '30d': 'Últimos 30 días',
    '90d': 'Últimos 90 días',
    '12m': 'Últimos 12 meses',
    all: 'Todo el historial',
  };

  let from: Date | null = null;
  let to = endOfDay(now);
  let rangeLabel: string | undefined;
  let range: MetricsRange | null = null;

  if (rangeInput && typeof rangeInput === 'object' && 'from' in rangeInput) {
    from = startOfDay(new Date(rangeInput.from));
    to = rangeInput.to ? endOfDay(new Date(rangeInput.to)) : endOfDay(now);
    rangeLabel = rangeInput.label;
  } else {
    range = normalizeRange(rangeInput);
  }

  if (!rangeLabel && range) {
    if (range === 'today') {
      from = startOfDay(now);
    } else if (range === 'week') {
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const start = new Date(now);
      start.setDate(now.getDate() + diff);
      from = startOfDay(start);
    } else if (range === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === '30d') {
      from = new Date(now);
      from.setDate(from.getDate() - 30);
    } else if (range === '90d') {
      from = new Date(now);
      from.setDate(from.getDate() - 90);
    } else if (range === '12m') {
      from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
    }
    rangeLabel = labelMap[range];
  }

  const baseWhere = {
    workspaceId,
    deletedAt: null,
    status: { notIn: EXCLUDED_STATUSES },
  } as const;

  if (range === 'all') {
    const earliest = await prisma.order.findFirst({
      where: baseWhere,
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    from = earliest ? startOfDay(earliest.createdAt) : null;
    rangeLabel = labelMap.all;
  }

  if (!rangeLabel && range) {
    rangeLabel = labelMap[range];
  }

  const createdAtFilter = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };

  const orderWhere = {
    ...baseWhere,
    ...((from || to) ? { createdAt: createdAtFilter } : {}),
  };

  const orders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true,
      total: true,
      paidAmount: true,
      createdAt: true,
      customerId: true,
    },
  });

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
  const totalPaid = orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const pendingRevenue = Math.max(totalRevenue - totalPaid, 0);
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const paidRate = totalRevenue > 0 ? totalPaid / totalRevenue : 0;

  const receiptsAgg = await prisma.stockPurchaseReceipt.aggregate({
    where: {
      workspaceId,
      status: 'applied',
      ...((from || to) ? { createdAt: createdAtFilter } : {}),
    },
    _sum: { total: true },
    _count: { _all: true },
  });
  const totalStockPurchases = receiptsAgg._sum.total ?? 0;
  const stockReceiptCount = receiptsAgg._count._all ?? 0;

  // Stock purchases by month (for sparkline)
  const stockReceipts = await prisma.stockPurchaseReceipt.findMany({
    where: {
      workspaceId,
      status: 'applied',
      ...((from || to) ? { createdAt: createdAtFilter } : {}),
    },
    select: { total: true, createdAt: true },
  });

  const stockMonthlyTotals = new Map<string, number>();
  stockReceipts.forEach((receipt) => {
    const monthKey = `${receipt.createdAt.getFullYear()}-${String(receipt.createdAt.getMonth() + 1).padStart(2, '0')}`;
    stockMonthlyTotals.set(monthKey, (stockMonthlyTotals.get(monthKey) || 0) + receipt.total);
  });

  const customerTotals = new Map<string, { totalSpent: number; orderCount: number }>();
  const dayTotals = new Map<string, { total: number; orders: number }>();
  const weekdayTotals = Array.from({ length: 7 }, () => ({ total: 0, orders: 0 }));

  orders.forEach((order) => {
    const current = customerTotals.get(order.customerId) || { totalSpent: 0, orderCount: 0 };
    current.totalSpent += order.total;
    current.orderCount += 1;
    customerTotals.set(order.customerId, current);

    const dayKey = formatDateKey(order.createdAt);
    const day = dayTotals.get(dayKey) || { total: 0, orders: 0 };
    day.total += order.total;
    day.orders += 1;
    dayTotals.set(dayKey, day);

    const weekday = order.createdAt.getDay();
    weekdayTotals[weekday].total += order.total;
    weekdayTotals[weekday].orders += 1;
  });

  const sortedCustomers = [...customerTotals.entries()]
    .map(([id, stats]) => ({ id, ...stats }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 5);

  const customers = sortedCustomers.length
    ? await prisma.customer.findMany({
      where: { id: { in: sortedCustomers.map((c) => c.id) }, workspaceId },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })
    : [];
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const topCustomers: MetricsCustomer[] = sortedCustomers.map((entry) => {
    const customer = customerMap.get(entry.id);
    const name = customer
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.phone
      : entry.id;
    return {
      id: entry.id,
      name,
      phone: customer?.phone || '',
      orderCount: entry.orderCount,
      totalSpent: entry.totalSpent,
    };
  });

  const orderIds = orders.map((order) => order.id);
  const orderItems = orderIds.length
    ? await prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { productId: true, name: true, quantity: true, total: true },
    })
    : [];

  const productTotals = new Map<string, MetricsProduct>();
  orderItems.forEach((item) => {
    const current = productTotals.get(item.productId) || {
      id: item.productId,
      name: item.name,
      quantity: 0,
      revenue: 0,
    };
    current.quantity += item.quantity;
    current.revenue += item.total;
    productTotals.set(item.productId, current);
  });

  const topProducts = [...productTotals.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const rangeStart = from || (orders[0]?.createdAt ? startOfDay(orders[0].createdAt) : startOfDay(to));
  const dailyKeys = buildDailySeries(rangeStart, to);
  const salesByDay: MetricsSeriesPoint[] = dailyKeys.map((key) => {
    const entry = dayTotals.get(key);
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return {
      key,
      label: formatDayLabel(date),
      total: entry?.total || 0,
      orders: entry?.orders || 0,
    };
  });

  const weekdayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const salesByWeekday: MetricsSeriesPoint[] = weekdayTotals.map((entry, index) => ({
    key: String(index),
    label: weekdayLabels[index],
    total: entry.total,
    orders: entry.orders,
  }));

  const months = buildMonthlySeries(rangeStart, to);
  const monthlyTotals = new Map<string, { total: number; orders: number }>();
  orders.forEach((order) => {
    const monthKey = `${order.createdAt.getFullYear()}-${String(order.createdAt.getMonth() + 1).padStart(2, '0')}`;
    const current = monthlyTotals.get(monthKey) || { total: 0, orders: 0 };
    current.total += order.total;
    current.orders += 1;
    monthlyTotals.set(monthKey, current);
  });

  const salesByMonth: MetricsSeriesPoint[] = months.map((month) => {
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const entry = monthlyTotals.get(key);
    return {
      key,
      label: formatMonthLabel(month),
      total: entry?.total || 0,
      orders: entry?.orders || 0,
    };
  });

  const stockPurchasesByMonth: MetricsSeriesPoint[] = months.map((month) => {
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    return {
      key,
      label: formatMonthLabel(month),
      total: stockMonthlyTotals.get(key) || 0,
    };
  });

  const normalizePaymentMethod = (method: string | null, provider: string | null) => {
    const value = (method || '').toLowerCase();
    if (['cash', 'efectivo'].includes(value)) return 'cash';
    if (['transfer', 'transferencia', 'bank_transfer'].includes(value)) return 'transfer';
    if (['link', 'mercadopago', 'mp_link', 'payment_link'].includes(value)) return 'link';
    if (provider === 'mercadopago') return 'link';
    return 'other';
  };

  const payments = await prisma.payment.findMany({
    where: {
      status: 'completed',
      ...((from || to) ? { createdAt: createdAtFilter } : {}),
      order: {
        workspaceId,
        deletedAt: null,
        status: { notIn: EXCLUDED_STATUSES },
      },
    },
    select: {
      amount: true,
      method: true,
      provider: true,
    },
  });

  const paymentsByMethodMap = new Map<string, { total: number; count: number }>();
  payments.forEach((payment) => {
    const key = normalizePaymentMethod(payment.method, payment.provider);
    const current = paymentsByMethodMap.get(key) || { total: 0, count: 0 };
    current.total += payment.amount;
    current.count += 1;
    paymentsByMethodMap.set(key, current);
  });

  const paymentsByMethod: MetricsPaymentsByMethod[] = Array.from(paymentsByMethodMap.entries()).map(
    ([method, data]) => ({
      method,
      total: data.total,
      count: data.count,
    })
  );

  return {
    range: {
      from: from ? from.toISOString() : null,
      to: to.toISOString(),
      label: rangeLabel || 'Rango',
    },
    summary: {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      totalPaid,
      pendingRevenue,
      paidRate,
      totalStockPurchases,
      stockReceiptCount,
    },
    topCustomers,
    topProducts,
    salesByDay,
    salesByWeekday,
    salesByMonth,
    stockPurchasesByMonth,
    paymentsByMethod,
  };
}
