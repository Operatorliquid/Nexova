/**
 * Admin/Owner Tools (Paid Add-on)
 * Owner-only tools intended for the workspace owner/operator.
 *
 * NOTE: These tools MUST NOT be exposed to normal customer chats.
 * They can read or mutate business data, send messages, etc.
 */
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import { BaseTool } from '../base.js';
import { LedgerService, DEFAULT_DEBT_SETTINGS, StockPurchaseReceiptService, decrypt } from '@nexova/core';
import { COMMERCE_USAGE_METRICS, getCommercePlanCapabilities, QUEUES, MessageSendPayload } from '@nexova/shared';
import { ToolCategory, type ToolContext, type ToolResult } from '../../types/index.js';
import { withVisibleOrders } from '../../utils/orders.js';
import { buildProductDisplayName } from './product-utils.js';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { extractStockReceiptWithClaude } from '../../utils/stock-receipt-claude.js';
import { getEffectivePlanLimits, resolveWorkspacePlan } from '../../utils/commerce-plan-limits.js';
import { getMonthlyUsage, recordMonthlyUsage } from '../../utils/monthly-usage.js';
import path from 'path';

const OWNER_PERIOD = z
  .enum(['today', 'yesterday', 'last_7_days', 'last_30_days'])
  .default('today')
  .describe('Periodo relativo para consultas del dashboard.');

const AdminOrdersKpisInput = z.object({
  period: OWNER_PERIOD,
  includeTrashed: z.boolean().optional().default(false),
});

const AdminListOrdersInput = z.object({
  period: OWNER_PERIOD.optional(),
  includeTrashed: z.boolean().optional().default(false),
  statuses: z
    .array(z.string())
    .optional()
    .describe(
      'Filtrar por estados (ej: ["awaiting_acceptance","paid"]). Alias comunes: pending_approval -> awaiting_acceptance.'
    ),
  search: z.string().optional().describe('Buscar por número de pedido o datos del cliente.'),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

const AdminOrderDetailsInput = z.object({
  orderNumber: z.string().min(1).max(50),
  includeTrashed: z.boolean().optional().default(false),
});

const PHONE_INPUT = z
  .string()
  .min(6)
  .max(32)
  .describe('Teléfono (E.164 o sin +). Se normaliza a +<dígitos>.');

const AdminGetOrCreateCustomerInput = z.object({
  phone: PHONE_INPUT,
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  businessName: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
});

const AdminSendCustomerMessageInput = z
  .object({
    customerId: z.string().uuid().optional(),
    phone: PHONE_INPUT.optional(),
    orderNumber: z.string().min(1).max(50).optional().describe('Número de pedido para inferir el cliente'),
    content: z.string().min(1).max(2000).describe('Mensaje de texto a enviar'),
  })
  .refine((d) => d.customerId || d.phone || d.orderNumber, {
    message: 'Debe proporcionar customerId, phone u orderNumber',
  });

const ORDER_STATUS = z.enum([
  'draft',
  'awaiting_acceptance',
  'accepted',
  'pending_invoicing',
  'invoiced',
  'invoice_cancelled',
  'trashed',
  'pending_payment',
  'partial_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
]);

const AdminUpdateOrderStatusInput = z
  .object({
    orderId: z.string().uuid().optional(),
    orderNumber: z.string().min(1).max(50).optional(),
    status: z.string().min(2).max(40).describe('Nuevo estado (ej: paid, accepted, trashed, invoice_cancelled)'),
    reason: z.string().min(3).max(500).optional().describe('Motivo del cambio'),
  })
  .refine((d) => d.orderId || d.orderNumber, {
    message: 'Debe proporcionar orderId u orderNumber',
  });

const AdminCancelOrderInput = z
  .object({
    orderId: z.string().uuid().optional(),
    orderNumber: z.string().min(1).max(50).optional(),
    reason: z.string().min(3).max(500).describe('Razón de la cancelación'),
  })
  .refine((d) => d.orderId || d.orderNumber, {
    message: 'Debe proporcionar orderId u orderNumber',
  });

const AdminCreateOrderInput = z
  .object({
    customerId: z.string().uuid().optional(),
    customerPhone: PHONE_INPUT.optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid().describe('ID del producto'),
          variantId: z.string().uuid().optional().describe('ID de la variante (si aplica)'),
          quantity: z.number().int().min(1).max(9999).describe('Cantidad'),
        })
      )
      .min(1)
      .max(50),
    notes: z.string().max(2000).optional(),
    shippingCents: z.number().int().min(0).optional().default(0),
    discountCents: z.number().int().min(0).optional().default(0),
  })
  .refine((d) => d.customerId || d.customerPhone, {
    message: 'Debe proporcionar customerId o customerPhone',
  });

const AdminSendDebtReminderInput = z
  .object({
    customerId: z.string().uuid().optional(),
    phone: PHONE_INPUT.optional(),
    orderNumber: z.string().min(1).max(50).optional(),
  })
  .refine((d) => d.customerId || d.phone || d.orderNumber, {
    message: 'Debe proporcionar customerId, phone u orderNumber',
  });

const AdminProcessStockReceiptInput = z.object({
  fileRef: z.string().min(1).describe('Referencia (URL) al archivo adjunto (image/pdf)'),
  fileType: z.enum(['image', 'pdf']).default('image').describe('Tipo de archivo adjunto'),
});

const AdminAdjustPricesPercentInput = z
  .object({
    percent: z.number().min(-500).max(500).optional().describe('Porcentaje de ajuste. Positivo sube, negativo baja.'),
    amount: z.number().min(-10000000).max(10000000).optional().describe('Monto de ajuste en pesos. Positivo sube, negativo baja.'),
    categoryId: z.string().uuid().optional(),
    categoryName: z.string().min(1).max(120).optional(),
    productId: z.string().uuid().optional(),
    sku: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(255).optional().describe('Nombre de un producto'),
    productIds: z.array(z.string().uuid()).max(200).optional(),
    skus: z.array(z.string().min(1).max(100)).max(200).optional(),
    productNames: z.array(z.string().min(1).max(255)).max(200).optional(),
    query: z.string().min(1).max(255).optional().describe('Filtro parcial por nombre o SKU'),
  })
  .refine((d) => d.percent !== undefined || d.amount !== undefined, {
    message: 'Debe indicar porcentaje o monto',
  })
  .refine((d) => (d.percent ?? 0) !== 0 || (d.amount ?? 0) !== 0, {
    message: 'El ajuste no puede ser 0',
  })
  .refine(
    (d) =>
      Boolean(
        d.categoryId ||
        d.categoryName ||
        d.productId ||
        d.sku ||
        d.name ||
        (d.productIds && d.productIds.length > 0) ||
        (d.skus && d.skus.length > 0) ||
        (d.productNames && d.productNames.length > 0) ||
        d.query
      ),
    {
      message: 'Debe indicar al menos un producto, una categoría o un filtro query.',
    }
  );

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ORDER_STATUS_ALIASES: Record<string, string> = {
  // Awaiting acceptance (pending approval)
  pending_approval: 'awaiting_acceptance',
  pending_approval_order: 'awaiting_acceptance',
  awaiting_approval: 'awaiting_acceptance',
  pending_acceptance: 'awaiting_acceptance',
  esperando_aprobacion: 'awaiting_acceptance',
  pendiente_aprobacion: 'awaiting_acceptance',
  pendientes_aprobacion: 'awaiting_acceptance',
  esperando_aceptacion: 'awaiting_acceptance',
  pendiente_aceptacion: 'awaiting_acceptance',

  // Accepted
  aceptado: 'accepted',
  aprobado: 'accepted',

  // Paid
  pagado: 'paid',

  // Pending payment
  pendiente_pago: 'pending_payment',
  pending_pay: 'pending_payment',

  // Partial payment
  pago_parcial: 'partial_payment',

  // Invoicing
  pendiente_facturacion: 'pending_invoicing',
  pending_invoicing: 'pending_invoicing',
  facturado: 'invoiced',
  factura_emitida: 'invoiced',
  invoiced: 'invoiced',
  factura_cancelada: 'invoice_cancelled',
  invoice_cancelled: 'invoice_cancelled',

  // Fulfillment
  procesando: 'processing',
  processing: 'processing',
  enviado: 'shipped',
  despachado: 'shipped',
  shipped: 'shipped',
  entregado: 'delivered',
  delivered: 'delivered',

  // Returned
  devuelto: 'returned',
  returned: 'returned',

  // Cancelled
  cancelado: 'cancelled',

  // Trashed
  papelera: 'trashed',
  eliminado: 'trashed',
  borrado: 'trashed',
};

function normalizeStatusToken(value: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function mapOrderStatuses(statuses: string[]): string[] {
  const mapped = new Set<string>();
  for (const status of statuses) {
    const token = normalizeStatusToken(status);
    if (!token) continue;
    mapped.add(ORDER_STATUS_ALIASES[token] || token);
  }
  return Array.from(mapped);
}

function mapSingleOrderStatus(status: string): z.infer<typeof ORDER_STATUS> | null {
  const token = normalizeStatusToken(status);
  if (!token) return null;
  const mapped = ORDER_STATUS_ALIASES[token] || token;
  const parsed = ORDER_STATUS.safeParse(mapped);
  return parsed.success ? parsed.data : null;
}

function normalizePhoneE164(value: string): string {
  const trimmed = (value || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function toPhoneDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

function phonesMatch(a: string, b: string): boolean {
  const aDigits = toPhoneDigits(a);
  const bDigits = toPhoneDigits(b);
  if (!aDigits || !bDigits) return false;
  if (aDigits === bDigits) return true;

  const MIN_SUFFIX_MATCH_DIGITS = 8;
  if (aDigits.length < MIN_SUFFIX_MATCH_DIGITS || bDigits.length < MIN_SUFFIX_MATCH_DIGITS) {
    return false;
  }
  return aDigits.endsWith(bDigits) || bDigits.endsWith(aDigits);
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));

  const year = Number(map.get('year'));
  const month = Number(map.get('month'));
  const day = Number(map.get('day'));
  const hour = Number(map.get('hour'));
  const minute = Number(map.get('minute'));
  const second = Number(map.get('second'));

  // Treat the formatted time (in target TZ) as if it were UTC to derive the offset.
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  return (asUTC - date.getTime()) / 60000;
}

function getZonedYmd(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
  };
}

function startOfZonedDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getZonedYmd(date, timeZone);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  const offset = getTimeZoneOffsetMinutes(utcMidnight, timeZone);
  let start = new Date(utcMidnight.getTime() - offset * 60 * 1000);

  // Recalculate offset at the adjusted time to handle DST transitions.
  const offset2 = getTimeZoneOffsetMinutes(start, timeZone);
  if (offset2 !== offset) {
    start = new Date(utcMidnight.getTime() - offset2 * 60 * 1000);
  }

  return start;
}

function resolvePeriodRange(now: Date, period: z.infer<typeof OWNER_PERIOD>, timeZone: string): { start: Date; end: Date } {
  if (period === 'today') {
    const start = startOfZonedDay(now, timeZone);
    const end = new Date(startOfZonedDay(new Date(now.getTime() + MS_PER_DAY), timeZone).getTime() - 1);
    return { start, end };
  }

  if (period === 'yesterday') {
    const yesterday = new Date(now.getTime() - MS_PER_DAY);
    const start = startOfZonedDay(yesterday, timeZone);
    const end = new Date(startOfZonedDay(now, timeZone).getTime() - 1);
    return { start, end };
  }

  if (period === 'last_7_days') {
    const startDate = new Date(now.getTime() - 6 * MS_PER_DAY);
    const start = startOfZonedDay(startDate, timeZone);
    const end = new Date(startOfZonedDay(new Date(now.getTime() + MS_PER_DAY), timeZone).getTime() - 1);
    return { start, end };
  }

  // last_30_days
  const startDate = new Date(now.getTime() - 29 * MS_PER_DAY);
  const start = startOfZonedDay(startDate, timeZone);
  const end = new Date(startOfZonedDay(new Date(now.getTime() + MS_PER_DAY), timeZone).getTime() - 1);
  return { start, end };
}

async function resolveWorkspaceTimeZone(prisma: PrismaClient, workspaceId: string): Promise<string> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const settings = (workspace?.settings as Record<string, unknown>) || {};
    const tz = typeof settings.timezone === 'string' ? settings.timezone.trim() : '';
    return tz || 'UTC';
  } catch {
    return 'UTC';
  }
}

function assertOwnerContext(context: ToolContext): ToolResult | null {
  if (!context.isOwner) {
    return { success: false, error: 'No autorizado: tool solo disponible para el dueño.' };
  }
  return null;
}

export class AdminGetOrdersKpisTool extends BaseTool<typeof AdminOrdersKpisInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_get_orders_kpis',
      description:
        'Devuelve métricas de pedidos del workspace (conteos por estado y totales) para un periodo.',
      category: ToolCategory.QUERY,
      inputSchema: AdminOrdersKpisInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof AdminOrdersKpisInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const timeZone = await resolveWorkspaceTimeZone(this.prisma, context.workspaceId);
    const { start, end } = resolvePeriodRange(new Date(), input.period, timeZone);

    const baseWhere: Prisma.OrderWhereInput = {
      workspaceId: context.workspaceId,
      createdAt: { gte: start, lte: end },
    };
    const where = input.includeTrashed ? baseWhere : withVisibleOrders(baseWhere);

    const [counts, totals] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where,
        _sum: { total: true, paidAmount: true },
        _count: { _all: true },
      }),
    ]);

    const countsByStatus: Record<string, number> = {};
    for (const row of counts) {
      countsByStatus[row.status] = row._count._all;
    }

    const totalCents = totals._sum.total ?? 0;
    const paidCents = totals._sum.paidAmount ?? 0;
    const pendingCents = Math.max(0, totalCents - paidCents);

    return {
      success: true,
      data: {
        period: input.period,
        includeTrashed: input.includeTrashed,
        timeZone,
        range: { start: start.toISOString(), end: end.toISOString() },
        totals: {
          orders: totals._count._all,
          totalCents,
          paidCents,
          pendingCents,
        },
        countsByStatus,
      },
    };
  }
}

export class AdminListOrdersTool extends BaseTool<typeof AdminListOrdersInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_list_orders',
      description:
        'Lista pedidos del workspace (para dueño). Permite filtrar por periodo, estados y búsqueda.',
      category: ToolCategory.QUERY,
      inputSchema: AdminListOrdersInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof AdminListOrdersInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const where: Prisma.OrderWhereInput = {
      workspaceId: context.workspaceId,
    };

    if (input.period) {
      const timeZone = await resolveWorkspaceTimeZone(this.prisma, context.workspaceId);
      const { start, end } = resolvePeriodRange(new Date(), input.period, timeZone);
      where.createdAt = { gte: start, lte: end };
    }

    if (input.statuses && input.statuses.length > 0) {
      const statuses = mapOrderStatuses(input.statuses);
      if (statuses.length > 0) {
        where.status = { in: statuses };
      }
    }

    if (input.search && input.search.trim()) {
      const q = input.search.trim();
      const qDigits = q.replace(/\D/g, '');
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        ...(qDigits
          ? [{ customer: { phone: { contains: qDigits } } }, { customer: { phone: { contains: `+${qDigits}` } } }]
          : []),
        { customer: { firstName: { contains: q, mode: 'insensitive' } } },
        { customer: { lastName: { contains: q, mode: 'insensitive' } } },
        { customer: { businessName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const effectiveWhere = input.includeTrashed ? where : withVisibleOrders(where);

    const orders = await this.prisma.order.findMany({
      where: effectiveWhere,
      orderBy: { createdAt: 'desc' },
      skip: input.offset,
      take: input.limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        paidAmount: true,
        createdAt: true,
        deletedAt: true,
        customer: {
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            businessName: true,
          },
        },
      },
    });

    return {
      success: true,
      data: {
        includeTrashed: input.includeTrashed,
        limit: input.limit,
        offset: input.offset,
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          totalCents: o.total,
          paidCents: o.paidAmount,
          pendingCents: Math.max(0, (o.total ?? 0) - (o.paidAmount ?? 0)),
          createdAt: o.createdAt.toISOString(),
          deletedAt: o.deletedAt ? o.deletedAt.toISOString() : null,
          customer: {
            id: o.customer.id,
            phone: o.customer.phone,
            firstName: o.customer.firstName,
            lastName: o.customer.lastName,
            businessName: o.customer.businessName,
          },
        })),
      },
    };
  }
}

export class AdminGetOrderDetailsTool extends BaseTool<typeof AdminOrderDetailsInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_get_order_details',
      description: 'Obtiene el detalle completo de un pedido por número (solo dueño).',
      category: ToolCategory.QUERY,
      inputSchema: AdminOrderDetailsInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof AdminOrderDetailsInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const baseWhere: Prisma.OrderWhereInput = {
      workspaceId: context.workspaceId,
      orderNumber: input.orderNumber,
    };
    const where = input.includeTrashed ? baseWhere : withVisibleOrders(baseWhere);

    const order = await this.prisma.order.findFirst({
      where,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        subtotal: true,
        tax: true,
        discount: true,
        shipping: true,
        total: true,
        paidAmount: true,
        currency: true,
        notes: true,
        internalNotes: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        customer: {
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            businessName: true,
            cuit: true,
            fiscalAddress: true,
            vatCondition: true,
            metadata: true,
          },
        },
        items: {
          select: {
            productId: true,
            variantId: true,
            sku: true,
            name: true,
            quantity: true,
            unitPrice: true,
            total: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!order) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    const customerMetadata = (order.customer.metadata as Record<string, unknown>) || {};

    return {
      success: true,
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        subtotalCents: order.subtotal,
        taxCents: order.tax,
        discountCents: order.discount,
        shippingCents: order.shipping,
        totalCents: order.total,
        paidCents: order.paidAmount,
        pendingCents: Math.max(0, (order.total ?? 0) - (order.paidAmount ?? 0)),
        notes: order.notes,
        internalNotes: order.internalNotes,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        deletedAt: order.deletedAt ? order.deletedAt.toISOString() : null,
        customer: {
          id: order.customer.id,
          phone: order.customer.phone,
          firstName: order.customer.firstName,
          lastName: order.customer.lastName,
          businessName: order.customer.businessName,
          cuit: order.customer.cuit,
          fiscalAddress: order.customer.fiscalAddress,
          vatCondition: order.customer.vatCondition,
          dni: typeof customerMetadata.dni === 'string' ? customerMetadata.dni : null,
        },
        items: order.items,
      },
    };
  }
}

const ADMIN_ORDER_PROCESSED_STATUSES = new Set([
  'accepted',
  'processing',
  'shipped',
  'delivered',
  'invoiced',
]);

function normalizePhoneCandidates(phone: string): string[] {
  const normalized = normalizePhoneE164(phone);
  const candidates = new Set<string>();
  if (phone) candidates.add(phone);
  if (normalized) candidates.add(normalized);
  if (normalized.startsWith('+')) candidates.add(normalized.slice(1));
  return Array.from(candidates);
}

async function resolveCustomerByPhone(
  prisma: PrismaClient,
  workspaceId: string,
  phone: string
): Promise<{
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  email: string | null;
} | null> {
  const candidates = normalizePhoneCandidates(phone);

  let customer = await prisma.customer.findFirst({
    where: {
      workspaceId,
      OR: candidates.map((value) => ({ phone: value })),
      deletedAt: null,
    },
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
    },
  });

  const normalized = normalizePhoneE164(phone);
  const normalizedDigits = toPhoneDigits(normalized);

  if (!customer && normalizedDigits) {
    const suffixLength = Math.min(7, normalizedDigits.length);
    const suffix = normalizedDigits.slice(-suffixLength);
    const fuzzyCandidates = await prisma.customer.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        phone: { endsWith: suffix },
      },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        businessName: true,
        email: true,
      },
      take: 10,
    });
    customer =
      fuzzyCandidates.find((c) => toPhoneDigits(c.phone) === normalizedDigits) || null;
  }

  if (customer && normalized && customer.phone !== normalized) {
    const existingNormalized = await prisma.customer.findFirst({
      where: { workspaceId, deletedAt: null, phone: normalized },
      select: { id: true },
    });
    if (!existingNormalized || existingNormalized.id === customer.id) {
      await prisma.customer.updateMany({
        where: { id: customer.id, workspaceId },
        data: { phone: normalized },
      });
      customer = { ...customer, phone: normalized };
    }
  }

  return customer;
}

async function getOrCreateCustomerByPhone(
  prisma: PrismaClient,
  workspaceId: string,
  input: {
    phone: string;
    firstName?: string;
    lastName?: string;
    businessName?: string;
    email?: string;
  }
): Promise<{
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  email: string | null;
  created: boolean;
}> {
  const normalizedPhone = normalizePhoneE164(input.phone);
  let customer = await resolveCustomerByPhone(prisma, workspaceId, normalizedPhone);

  if (!customer) {
    const created = await prisma.customer.create({
      data: {
        workspaceId,
        phone: normalizedPhone,
        status: 'active',
        firstName: input.firstName?.trim() || null,
        lastName: input.lastName?.trim() || null,
        businessName: input.businessName?.trim() || null,
        email: input.email?.trim() || null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        businessName: true,
        email: true,
      },
    });
    return { ...created, created: true };
  }

  const patch: Record<string, unknown> = { lastSeenAt: new Date() };
  let changed = false;

  if (input.firstName && !customer.firstName) {
    patch.firstName = input.firstName.trim();
    changed = true;
  }
  if (input.lastName && !customer.lastName) {
    patch.lastName = input.lastName.trim();
    changed = true;
  }
  if (input.businessName && !customer.businessName) {
    patch.businessName = input.businessName.trim();
    changed = true;
  }
  if (input.email && !customer.email) {
    patch.email = input.email.trim();
    changed = true;
  }

  if (changed) {
    await prisma.customer.updateMany({
      where: { id: customer.id, workspaceId },
      data: patch,
    });
  } else {
    await prisma.customer.updateMany({
      where: { id: customer.id, workspaceId },
      data: { lastSeenAt: new Date() },
    });
  }

  return { ...customer, created: false };
}

async function resolveOrderForAdmin(
  prisma: PrismaClient,
  workspaceId: string,
  input: { orderId?: string; orderNumber?: string },
  options?: { includeTrashed?: boolean }
): Promise<{ id: string; orderNumber: string; status: string; customerId: string; total: number } | null> {
  const baseWhere: Prisma.OrderWhereInput = {
    workspaceId,
    deletedAt: null,
    ...(input.orderId ? { id: input.orderId } : {}),
    ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
  };

  const where = options?.includeTrashed ? baseWhere : withVisibleOrders(baseWhere);

  return prisma.order.findFirst({
    where,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerId: true,
      total: true,
    },
  });
}

function generateCreateOrderIdempotencyKey(input: Record<string, unknown>): string {
  const customerId = typeof input.customerId === 'string' ? input.customerId : '';
  const customerPhone = typeof input.customerPhone === 'string' ? toPhoneDigits(input.customerPhone) : '';
  const items = Array.isArray(input.items) ? input.items : [];
  const normalizedItems = items
    .map((item) => {
      const productId = item && typeof item.productId === 'string' ? item.productId : '';
      const variantId = item && typeof item.variantId === 'string' ? item.variantId : '';
      const quantity = item && typeof item.quantity === 'number' ? item.quantity : 0;
      return `${productId}:${variantId}:${quantity}`;
    })
    .sort()
    .join('|');
  const hash = createHash('sha256').update(normalizedItems).digest('hex').slice(0, 16);
  const target = customerId || customerPhone || 'unknown';
  return `admin_create_order:${target}:${hash}`;
}

export class AdminGetOrCreateCustomerTool extends BaseTool<typeof AdminGetOrCreateCustomerInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_get_or_create_customer',
      description: 'Busca o crea un cliente por teléfono (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminGetOrCreateCustomerInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof AdminGetOrCreateCustomerInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const customer = await getOrCreateCustomerByPhone(this.prisma, context.workspaceId, input);

    return {
      success: true,
      data: {
        customerId: customer.id,
        phone: customer.phone,
        firstName: customer.firstName,
        lastName: customer.lastName,
        businessName: customer.businessName,
        email: customer.email,
        created: customer.created,
        message: customer.created
          ? `Cliente creado: ${customer.phone}`
          : `Cliente encontrado: ${customer.phone}`,
      },
    };
  }
}

export class AdminUpdateOrderStatusTool extends BaseTool<typeof AdminUpdateOrderStatusInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_update_order_status',
      description: 'Cambia el estado de un pedido (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminUpdateOrderStatusInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof AdminUpdateOrderStatusInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const newStatus = mapSingleOrderStatus(input.status);
    if (!newStatus) {
      return { success: false, error: `Estado inválido: ${input.status}` };
    }

    const order = await this.prisma.order.findFirst({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        ...(input.orderId ? { id: input.orderId } : {}),
        ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
      },
      select: { id: true, orderNumber: true, status: true, metadata: true },
    });

    if (!order) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    if (order.status === newStatus) {
      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          message: `El pedido ${order.orderNumber} ya está en estado "${order.status}".`,
          unchanged: true,
        },
      };
    }

    const updateData: Prisma.OrderUpdateManyMutationInput = {
      status: newStatus,
    };

    if (newStatus === 'paid') updateData.paidAt = new Date();
    if (newStatus === 'shipped') updateData.shippedAt = new Date();
    if (newStatus === 'delivered') updateData.deliveredAt = new Date();
    if (newStatus === 'cancelled') {
      updateData.cancelledAt = new Date();
      if (input.reason) updateData.cancelReason = input.reason;
    }

    if (newStatus === 'trashed') {
      const metadata = (order.metadata as Record<string, unknown>) || {};
      updateData.metadata = {
        ...metadata,
        trash: {
          previousStatus: order.status,
          trashedAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: order.id, workspaceId: context.workspaceId },
        data: updateData,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          previousStatus: order.status,
          newStatus,
          reason: input.reason || null,
          changedBy: 'owner_agent',
        },
      });
    });

    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        previousStatus: order.status,
        newStatus,
        message: `Pedido ${order.orderNumber}: "${order.status}" -> "${newStatus}".`,
      },
    };
  }
}

export class AdminCancelOrderTool extends BaseTool<typeof AdminCancelOrderInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_cancel_order',
      description: 'Cancela un pedido y revierte reservas de stock si corresponde (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminCancelOrderInput,
      requiresConfirmation: true,
      idempotencyKey: (input) => `admin_cancel_order:${(input.orderId || input.orderNumber) as string}`,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof AdminCancelOrderInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const order = await this.prisma.order.findFirst({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        ...(input.orderId ? { id: input.orderId } : {}),
        ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
      },
      include: { items: true },
    });

    if (!order) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    if (order.status === 'cancelled') {
      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          message: 'El pedido ya está cancelado.',
          alreadyCancelled: true,
        },
      };
    }

    if (ADMIN_ORDER_PROCESSED_STATUSES.has(order.status)) {
      return {
        success: false,
        error: `El pedido está en estado "${order.status}" y no se cancela automáticamente (evita inconsistencias de stock).`,
      };
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.order.updateMany({
            where: { id: order.id, workspaceId: context.workspaceId },
            data: {
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelReason: input.reason,
            },
          });

          const reservations = await tx.stockReservation.findMany({
            where: { orderId: order.id, status: 'active' },
          });

          for (const reservation of reservations) {
            await tx.stockReservation.update({
              where: { id: reservation.id },
              data: { status: 'released', releasedAt: new Date() },
            });

            const stockItem = await tx.stockItem.findFirst({
              where: {
                productId: reservation.productId,
                variantId: reservation.variantId ?? null,
              },
            });

            if (stockItem) {
              const currentAvailable = stockItem.quantity - stockItem.reserved;
              await tx.stockItem.update({
                where: { id: stockItem.id },
                data: { reserved: { decrement: reservation.quantity } },
              });

              await tx.stockMovement.create({
                data: {
                  stockItemId: stockItem.id,
                  type: 'reversal',
                  quantity: reservation.quantity,
                  previousQty: currentAvailable,
                  newQty: currentAvailable + reservation.quantity,
                  reason: `Cancelación de orden ${order.orderNumber}: ${input.reason}`,
                  referenceType: 'Order',
                  referenceId: order.id,
                },
              });
            }
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              previousStatus: order.status,
              newStatus: 'cancelled',
              reason: input.reason,
              changedBy: 'owner_agent',
            },
          });

          await tx.customer.updateMany({
            where: { id: order.customerId, workspaceId: context.workspaceId },
            data: {
              orderCount: { decrement: 1 },
              totalSpent: { decrement: BigInt(order.total) },
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        }
      );

      try {
        await createNotificationIfEnabled(this.prisma, {
          workspaceId: context.workspaceId,
          type: 'order.cancelled',
          title: 'Pedido cancelado',
          message: `Pedido ${order.orderNumber} cancelado`,
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            sessionId: null,
            reason: input.reason,
          },
        });
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          message: `Pedido ${order.orderNumber} cancelado. El stock reservado fue devuelto.`,
        },
      };
    } catch (error) {
      console.error('[AdminCancelOrder] Transaction failed:', error);
      return { success: false, error: 'Error al cancelar el pedido. Intentá de nuevo.' };
    }
  }
}

export class AdminCreateOrderTool extends BaseTool<typeof AdminCreateOrderInput> {
  private prisma: PrismaClient;

  private async generateOrderNumber(workspaceId: string): Promise<string> {
    const lastOrder = await this.prisma.order.findFirst({
      where: { workspaceId, orderNumber: { startsWith: 'ORD-' } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });

    let sequence = 1;
    if (lastOrder?.orderNumber) {
      const match = lastOrder.orderNumber.match(/ORD-(\d+)/i);
      if (match) {
        const lastSeq = Number(match[1]);
        if (Number.isFinite(lastSeq)) {
          sequence = lastSeq + 1;
        }
      }
    }

    return `ORD-${String(sequence).padStart(5, '0')}`;
  }

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_create_order',
      description: 'Crea un pedido manual para un cliente, reservando stock (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminCreateOrderInput,
      requiresConfirmation: true,
      idempotencyKey: generateCreateOrderIdempotencyKey,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof AdminCreateOrderInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const plan = await resolveWorkspacePlan(this.prisma, context.workspaceId);
    const planLimits = await getEffectivePlanLimits(this.prisma, plan);
    const monthlyLimit = planLimits.ordersPerMonth;
    if (monthlyLimit !== null) {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      const createdThisMonth = await this.prisma.order.count({
        where: {
          workspaceId: context.workspaceId,
          createdAt: { gte: start, lte: end },
        },
      });
      if (createdThisMonth >= monthlyLimit) {
        return {
          success: false,
          error: `Alcanzaste el límite mensual de pedidos (${monthlyLimit}).`,
        };
      }
    }

    const customer = input.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: input.customerId, workspaceId: context.workspaceId, deletedAt: null },
          select: { id: true, phone: true, firstName: true, lastName: true },
        })
      : await getOrCreateCustomerByPhone(this.prisma, context.workspaceId, { phone: input.customerPhone || '' });

    if (!customer) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
    const products = await this.prisma.product.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        status: { not: 'archived' },
        id: { in: productIds },
      },
      include: {
        variants: true,
      },
    });

    const productById = new Map(products.map((p) => [p.id, p]));
    const lineItems = input.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) {
        return { kind: 'error' as const, message: `Producto no encontrado: ${item.productId}` };
      }
      const variant = item.variantId ? product.variants.find((v) => v.id === item.variantId) || null : null;
      const unitPrice = variant?.price ?? product.price;
      const name = buildProductDisplayName(product, variant);
      const sku = variant?.sku || product.sku;
      return {
        kind: 'ok' as const,
        product,
        variant,
        productId: product.id,
        variantId: variant?.id || null,
        sku,
        name,
        quantity: item.quantity,
        unitPrice,
        total: unitPrice * item.quantity,
      };
    });

    const firstError = lineItems.find((l) => l.kind === 'error');
    if (firstError && firstError.kind === 'error') {
      return { success: false, error: firstError.message };
    }

    const resolvedItems = lineItems.filter((l) => l.kind === 'ok') as Array<{
      productId: string;
      variantId: string | null;
      sku: string;
      name: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;

    const subtotal = resolvedItems.reduce((sum, i) => sum + i.total, 0);
    const shipping = input.shippingCents ?? 0;
    const discount = input.discountCents ?? 0;
    const total = Math.max(0, subtotal + shipping - discount);

    let orderNumber = await this.generateOrderNumber(context.workspaceId);
    let order: { id: string; orderNumber: string; total: number; status: string; customerId: string } | null = null;
    const maxAttempts = 5;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          order = await this.prisma.$transaction(
            async (tx) => {
              const newOrder = await tx.order.create({
                data: {
                  workspaceId: context.workspaceId,
                  customerId: customer.id,
                  sessionId: null,
                  orderNumber,
                  status: 'awaiting_acceptance',
                  subtotal,
                  shipping,
                  discount,
                  total,
                  notes: input.notes || null,
                },
                select: { id: true, orderNumber: true, total: true, status: true, customerId: true },
              });

              await tx.orderItem.createMany({
                data: resolvedItems.map((i) => ({
                  orderId: newOrder.id,
                  productId: i.productId,
                  variantId: i.variantId,
                  sku: i.sku,
                  name: i.name,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  total: i.total,
                })),
              });

              for (const item of resolvedItems) {
                const stockItem = await tx.stockItem.findFirst({
                  where: { productId: item.productId, variantId: item.variantId ?? null },
                });

                if (!stockItem) {
                  throw new Error(`Stock no encontrado para ${item.name}`);
                }

                const availableInTx = stockItem.quantity - stockItem.reserved;
                if (availableInTx < item.quantity) {
                  throw new Error(`Stock insuficiente para ${item.name}. Disponible: ${availableInTx}`);
                }

                await tx.stockItem.update({
                  where: { id: stockItem.id },
                  data: { reserved: { increment: item.quantity } },
                });

                await tx.stockMovement.create({
                  data: {
                    stockItemId: stockItem.id,
                    type: 'reservation',
                    quantity: -item.quantity,
                    previousQty: availableInTx,
                    newQty: availableInTx - item.quantity,
                    reason: `Reserva para orden ${orderNumber} (owner)`,
                    referenceType: 'Order',
                    referenceId: newOrder.id,
                  },
                });

                await tx.stockReservation.create({
                  data: {
                    orderId: newOrder.id,
                    productId: item.productId,
                    variantId: item.variantId ?? null,
                    quantity: item.quantity,
                    status: 'active',
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                });
              }

              await tx.orderStatusHistory.create({
                data: {
                  orderId: newOrder.id,
                  previousStatus: null,
                  newStatus: 'awaiting_acceptance',
                  reason: 'Pedido creado por dueño via WhatsApp',
                  changedBy: 'owner_agent',
                },
              });

              await tx.customer.updateMany({
                where: { id: customer.id, workspaceId: context.workspaceId },
                data: {
                  orderCount: { increment: 1 },
                  totalSpent: { increment: BigInt(total) },
                  lastOrderAt: new Date(),
                },
              });

              return newOrder;
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 15000,
            }
          );
          break;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            orderNumber = await this.generateOrderNumber(context.workspaceId);
            continue;
          }
          throw error;
        }
      }

      if (!order) {
        throw new Error('No se pudo generar un número de pedido');
      }

      try {
        await createNotificationIfEnabled(this.prisma, {
          workspaceId: context.workspaceId,
          type: 'order.new',
          title: 'Nuevo pedido',
          message: `Pedido ${order.orderNumber} creado`,
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            customerId: order.customerId,
            sessionId: null,
          },
        });
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalCents: order.total,
          itemCount: resolvedItems.length,
          customerId: customer.id,
          message: `Pedido ${order.orderNumber} creado.`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al crear el pedido';
      return { success: false, error: message };
    }
  }
}

export class AdminSendCustomerMessageTool extends BaseTool<typeof AdminSendCustomerMessageInput> {
  private prisma: PrismaClient;
  private messageQueue: Queue<MessageSendPayload> | null;

  constructor(prisma: PrismaClient, messageQueue?: Queue<MessageSendPayload> | null) {
    super({
      name: 'admin_send_customer_message',
      description: 'Envia un mensaje de WhatsApp a un cliente (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminSendCustomerMessageInput,
    });
    this.prisma = prisma;
    this.messageQueue = messageQueue ?? null;
  }

  async execute(input: z.infer<typeof AdminSendCustomerMessageInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;
    if (!this.messageQueue) {
      return { success: false, error: 'No hay cola de mensajes configurada en este entorno.' };
    }

    let customerId: string | null = input.customerId || null;
    let phone: string | null = input.phone ? normalizePhoneE164(input.phone) : null;

    if (!customerId && input.orderNumber) {
      const order = await this.prisma.order.findFirst({
        where: { workspaceId: context.workspaceId, deletedAt: null, orderNumber: input.orderNumber },
        select: { customerId: true, customer: { select: { phone: true } } },
      });
      if (!order) {
        return { success: false, error: 'Pedido no encontrado' };
      }
      customerId = order.customerId;
      phone = normalizePhoneE164(order.customer.phone);
    }

    if (!customerId) {
      if (!phone) {
        return { success: false, error: 'Falta customerId o phone.' };
      }
      const customer = await getOrCreateCustomerByPhone(this.prisma, context.workspaceId, { phone });
      customerId = customer.id;
      phone = customer.phone;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!customer?.phone) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    const normalizedTo = normalizePhoneE164(phone || customer.phone);

    // Ensure a session exists so the message appears in the inbox/history.
    const channelIds = normalizePhoneCandidates(normalizedTo);
    const existingSession = await this.prisma.agentSession.findFirst({
      where: {
        workspaceId: context.workspaceId,
        channelType: 'whatsapp',
        OR: channelIds.map((id) => ({ channelId: id })),
      },
      select: { id: true },
    });

    const sessionId = existingSession
      ? existingSession.id
      : (
        await this.prisma.agentSession.create({
          data: {
            workspaceId: context.workspaceId,
            customerId: customer.id,
            channelId: normalizedTo,
            channelType: 'whatsapp',
            currentState: 'IDLE',
            agentActive: false,
            metadata: { internalActor: 'owner_agent', contextStartAt: new Date().toISOString() } as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
      ).id;

    try {
      await this.prisma.agentMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: input.content,
          metadata: { internalActor: 'owner_agent' } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Non-fatal
    }

    await this.messageQueue.add(
      `owner-msg-${randomUUID().slice(0, 8)}`,
      {
        workspaceId: context.workspaceId,
        sessionId,
        to: normalizedTo,
        messageType: 'text',
        content: { text: input.content },
        correlationId: context.correlationId,
      },
      {
        attempts: QUEUES.MESSAGE_SEND.attempts,
        backoff: QUEUES.MESSAGE_SEND.backoff,
      }
    );

    return {
      success: true,
      data: {
        to: normalizedTo,
        sessionId,
        message: 'Mensaje encolado para envío.',
      },
    };
  }
}

function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || `{${key}}`);
}

function formatMoneyNumber(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export class AdminSendDebtReminderTool extends BaseTool<typeof AdminSendDebtReminderInput> {
  private prisma: PrismaClient;
  private ledger: LedgerService;
  private messageQueue: Queue<MessageSendPayload> | null;

  constructor(prisma: PrismaClient, messageQueue?: Queue<MessageSendPayload> | null) {
    super({
      name: 'admin_send_debt_reminder',
      description: 'Envía un recordatorio de deuda a un cliente (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminSendDebtReminderInput,
    });
    this.prisma = prisma;
    this.ledger = new LedgerService(prisma);
    this.messageQueue = messageQueue ?? null;
  }

  async execute(input: z.infer<typeof AdminSendDebtReminderInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;
    if (!this.messageQueue) {
      return { success: false, error: 'No hay cola de mensajes configurada en este entorno.' };
    }

    const plan = await resolveWorkspacePlan(this.prisma, context.workspaceId);
    const capabilities = getCommercePlanCapabilities(plan);
    if (!capabilities.showDebtsModule) {
      return { success: false, error: 'Tu plan actual no incluye el módulo de deudas.' };
    }

    const planLimits = await getEffectivePlanLimits(this.prisma, plan);
    const monthlyLimit = planLimits.debtRemindersPerMonth;
    if (monthlyLimit !== null) {
      const used = await getMonthlyUsage(this.prisma, {
        workspaceId: context.workspaceId,
        metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
      });
      if (used >= BigInt(monthlyLimit)) {
        return {
          success: false,
          error: `Alcanzaste el límite mensual de recordatorios de deuda (${monthlyLimit}).`,
        };
      }
    }

    let customerId: string | null = input.customerId || null;
    let phone: string | null = input.phone ? normalizePhoneE164(input.phone) : null;

    if (!customerId && input.orderNumber) {
      const order = await this.prisma.order.findFirst({
        where: { workspaceId: context.workspaceId, deletedAt: null, orderNumber: input.orderNumber },
        select: { customerId: true, customer: { select: { phone: true } } },
      });
      if (!order) {
        return { success: false, error: 'Pedido no encontrado' };
      }
      customerId = order.customerId;
      phone = normalizePhoneE164(order.customer.phone);
    }

    if (!customerId) {
      if (!phone) return { success: false, error: 'Falta customerId o phone.' };
      const customer = await resolveCustomerByPhone(this.prisma, context.workspaceId, phone);
      if (!customer) return { success: false, error: 'Cliente no encontrado' };
      customerId = customer.id;
      phone = customer.phone;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, phone: true, firstName: true, lastName: true, businessName: true },
    });
    if (!customer) return { success: false, error: 'Cliente no encontrado' };

    const unpaidOrders = await this.ledger.getUnpaidOrders(context.workspaceId, customer.id);
    if (unpaidOrders.length === 0) {
      return { success: false, error: 'El cliente no tiene deuda pendiente' };
    }

    const totalDebt = unpaidOrders.reduce((sum, o) => sum + o.pendingAmount, 0);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: { name: true, settings: true },
    });
    const settings = (workspace?.settings as Record<string, unknown>) || {};
    const debtSettings = {
      ...DEFAULT_DEBT_SETTINGS.debtReminders,
      ...((settings.debtReminders as Record<string, unknown>) || {}),
    } as Record<string, unknown>;

    const template = (debtSettings.messageTemplate as string) || DEFAULT_DEBT_SETTINGS.debtReminders.messageTemplate;
    const customerName =
      customer.firstName || customer.lastName
        ? [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()
        : customer.businessName || 'cliente';

    const message = interpolateTemplate(template, {
      customerName,
      totalDebt: formatMoneyNumber(totalDebt),
      orderCount: String(unpaidOrders.length),
      workspaceName: workspace?.name || 'tu comercio',
    });

    const normalizedTo = normalizePhoneE164(phone || customer.phone);
    const channelIds = normalizePhoneCandidates(normalizedTo);
    const session = await this.prisma.agentSession.findFirst({
      where: {
        workspaceId: context.workspaceId,
        channelType: 'whatsapp',
        OR: channelIds.map((id) => ({ channelId: id })),
      },
      select: { id: true },
    });

    const sessionId = session
      ? session.id
      : (
        await this.prisma.agentSession.create({
          data: {
            workspaceId: context.workspaceId,
            customerId: customer.id,
            channelId: normalizedTo,
            channelType: 'whatsapp',
            currentState: 'IDLE',
            agentActive: false,
            metadata: { internalActor: 'owner_agent', contextStartAt: new Date().toISOString() } as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
      ).id;

    try {
      await this.prisma.agentMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: message,
          metadata: { internalActor: 'owner_agent', kind: 'debt_reminder' } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Non-fatal
    }

    await this.messageQueue.add(
      `debt-reminder-${customer.id}-${randomUUID().slice(0, 8)}`,
      {
        workspaceId: context.workspaceId,
        sessionId,
        to: normalizedTo,
        messageType: 'text',
        content: { text: message },
        correlationId: context.correlationId,
      },
      {
        attempts: QUEUES.MESSAGE_SEND.attempts,
        backoff: QUEUES.MESSAGE_SEND.backoff,
      }
    );

    await recordMonthlyUsage(this.prisma, {
      workspaceId: context.workspaceId,
      metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
      quantity: 1,
      metadata: { source: 'owner.admin_send_debt_reminder' },
    });

    await this.prisma.customer.updateMany({
      where: { id: customer.id, workspaceId: context.workspaceId },
      data: {
        debtReminderCount: { increment: 1 },
        lastDebtReminderAt: new Date(),
      },
    });

    return {
      success: true,
      data: {
        customerId: customer.id,
        phone: normalizedTo,
        totalDebtCents: totalDebt,
        message: 'Recordatorio encolado para envío.',
      },
    };
  }
}

export class AdminAdjustPricesPercentTool extends BaseTool<typeof AdminAdjustPricesPercentInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_adjust_prices_percent',
      description: 'Ajusta precios por porcentaje o monto (pesos) por producto, lista o categoría (solo owner).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminAdjustPricesPercentInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildSelect() {
    return {
      id: true,
      name: true,
      sku: true,
      price: true,
      unit: true,
      unitValue: true,
      secondaryUnit: true,
      secondaryUnitValue: true,
    } as const;
  }

  private cleanCategoryName(value: string): string | null {
    let cleaned = (value || '').trim();
    cleaned = cleaned.replace(/\b(productos?|articulos?|artículos?|items?|referencias?)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(de|del|la|el|los|las)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(todo|toda|todos|todas)\b/gi, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned.length > 1 ? cleaned : null;
  }

  private extractCategoryFromAllPhrase(value: string): string | null {
    const raw = (value || '').trim();
    if (!raw) return null;
    const patterns: RegExp[] = [
      /^(?:todas?|todos?)\s+(?:las|los)\s+(.+)$/i,
      /^(?:todas?|todos?)\s+(.+)$/i,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (!match?.[1]) continue;
      const categoryName = this.cleanCategoryName(match[1]);
      if (categoryName) return categoryName;
    }
    return null;
  }

  private async resolveCategory(
    workspaceId: string,
    input: { categoryId?: string; categoryName?: string }
  ): Promise<{ id: string; name: string }> {
    if (input.categoryId) {
      const category = await this.prisma.productCategory.findFirst({
        where: { id: input.categoryId, workspaceId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!category) {
        throw new Error('Categoría no encontrada');
      }
      return category;
    }

    const name = (input.categoryName || '').trim();
    if (!name) {
      throw new Error('Nombre de categoría inválido');
    }

    const candidates = await this.prisma.productCategory.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        name: { contains: name, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      take: 5,
      orderBy: { sortOrder: 'asc' },
    });

    if (candidates.length === 0) {
      throw new Error(`No encontré la categoría "${name}".`);
    }
    if (candidates.length > 1) {
      const list = candidates.map((c) => c.name).join(', ');
      throw new Error(`Encontré varias categorías: ${list}. Especificá mejor.`);
    }
    return candidates[0];
  }

  private async resolveProduct(
    workspaceId: string,
    input: { productId?: string; sku?: string; name?: string }
  ): Promise<{
    id: string;
    name: string;
    sku: string;
    price: number;
    unit: string | null;
    unitValue: string | null;
    secondaryUnit: string | null;
    secondaryUnitValue: string | null;
  }> {
    const select = this.buildSelect();

    if (input.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: input.productId,
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
        },
        select,
      });
      if (!product) {
        throw new Error('Producto no encontrado');
      }
      return product;
    }

    const sku = (input.sku || '').trim();
    if (sku) {
      const exact = await this.prisma.product.findFirst({
        where: {
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          sku: { equals: sku, mode: 'insensitive' },
        },
        select,
      });
      if (exact) return exact;

      const candidates = await this.prisma.product.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          sku: { contains: sku, mode: 'insensitive' },
        },
        select,
        take: 5,
      });

      if (candidates.length === 0) {
        throw new Error(`No encontré producto con SKU "${sku}".`);
      }
      if (candidates.length > 1) {
        const list = candidates.map((p) => `${buildProductDisplayName(p)} (${p.sku})`).join(', ');
        throw new Error(`Encontré varios productos para SKU "${sku}": ${list}.`);
      }
      return candidates[0];
    }

    const name = (input.name || '').trim();
    if (!name) {
      throw new Error('Necesito un producto (id, sku o nombre).');
    }

    const candidates = await this.prisma.product.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: { not: 'archived' },
        name: { contains: name, mode: 'insensitive' },
      },
      select,
      take: 8,
    });

    if (candidates.length === 0) {
      throw new Error(`No encontré producto para "${name}".`);
    }

    const normalizedName = this.normalizeText(name);
    const exactMatches = candidates.filter((candidate) => this.normalizeText(candidate.name) === normalizedName);
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }

    const source = exactMatches.length > 1 ? exactMatches : candidates;
    if (source.length > 1) {
      const list = source.slice(0, 5).map((p) => buildProductDisplayName(p)).join(', ');
      throw new Error(`Encontré varios productos para "${name}": ${list}. Especificá mejor.`);
    }

    return source[0];
  }

  async execute(input: z.infer<typeof AdminAdjustPricesPercentInput>, context: ToolContext): Promise<ToolResult> {
    const guard = assertOwnerContext(context);
    if (guard) return guard;

    const hasPercent = typeof input.percent === 'number' && Number.isFinite(input.percent);
    const hasAmount = typeof input.amount === 'number' && Number.isFinite(input.amount);
    if (!hasPercent && !hasAmount) {
      return { success: false, error: 'Indicá porcentaje o monto para ajustar precios.' };
    }

    const mode: 'percent' | 'amount' = hasPercent ? 'percent' : 'amount';
    const percent = mode === 'percent' ? Number(input.percent) : null;
    const amount = mode === 'amount' ? Number(input.amount) : null;
    const factor = mode === 'percent' ? 1 + (percent as number) / 100 : null;
    const amountCents = mode === 'amount' ? Math.round((amount as number) * 100) : null;

    if (mode === 'percent' && (factor as number) <= 0) {
      return { success: false, error: 'El ajuste deja precios en cero o negativo.' };
    }

    const select = this.buildSelect();
    const selected = new Map<
      string,
      {
        id: string;
        name: string;
        sku: string;
        price: number;
        unit: string | null;
        unitValue: string | null;
        secondaryUnit: string | null;
        secondaryUnitValue: string | null;
      }
    >();
    const addProducts = (products: Array<{
      id: string;
      name: string;
      sku: string;
      price: number;
      unit: string | null;
      unitValue: string | null;
      secondaryUnit: string | null;
      secondaryUnitValue: string | null;
    }>) => {
      for (const product of products) {
        selected.set(product.id, product);
      }
    };

    let resolvedCategoryName: string | null = null;
    const inferredCategoryFromName =
      !input.categoryId && !input.categoryName
        ? this.extractCategoryFromAllPhrase(input.name || input.query || '')
        : null;

    if (input.categoryId || input.categoryName || inferredCategoryFromName) {
      const category = await this.resolveCategory(context.workspaceId, {
        categoryId: input.categoryId,
        categoryName: input.categoryName || inferredCategoryFromName || undefined,
      });
      resolvedCategoryName = category.name;
      const categoryProducts = await this.prisma.product.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          OR: [
            { categoryMappings: { some: { categoryId: category.id } } },
            { category: { contains: category.name, mode: 'insensitive' } },
          ],
        },
        select,
      });
      addProducts(categoryProducts);
      if (categoryProducts.length === 0) {
        return { success: false, error: `No encontré productos en la categoría "${category.name}".` };
      }
    }

    if (input.productIds?.length) {
      const uniqueIds = Array.from(new Set(input.productIds));
      const productsByIds = await this.prisma.product.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          id: { in: uniqueIds },
        },
        select,
      });
      addProducts(productsByIds);
      if (productsByIds.length !== uniqueIds.length) {
        return { success: false, error: 'Uno o más productIds no existen o están archivados.' };
      }
    }

    if (input.skus?.length) {
      for (const sku of input.skus) {
        const product = await this.resolveProduct(context.workspaceId, { sku });
        addProducts([product]);
      }
    }

    if (input.productNames?.length) {
      for (const productName of input.productNames) {
        const product = await this.resolveProduct(context.workspaceId, { name: productName });
        addProducts([product]);
      }
    }

    if (input.productId || input.sku || input.name) {
      const product = await this.resolveProduct(context.workspaceId, {
        productId: input.productId,
        sku: input.sku,
        name: input.name,
      });
      addProducts([product]);
    }

    if (input.query) {
      const query = input.query.trim();
      const queriedProducts = await this.prisma.product.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { sku: { contains: query, mode: 'insensitive' } },
          ],
        },
        select,
        take: 200,
      });
      if (queriedProducts.length === 0) {
        return { success: false, error: `No encontré productos para "${query}".` };
      }
      addProducts(queriedProducts);
    }

    const targets = Array.from(selected.values());
    if (targets.length === 0) {
      return { success: false, error: 'No encontré productos para ajustar.' };
    }

    const invalid = targets.filter((product) => {
      const nextPrice = mode === 'percent'
        ? Math.round(product.price * (factor as number))
        : product.price + (amountCents as number);
      return nextPrice <= 0;
    });
    if (invalid.length > 0) {
      const list = invalid.slice(0, 3).map((p) => buildProductDisplayName(p)).join(', ');
      return { success: false, error: `El ajuste deja precio inválido para: ${list}.` };
    }

    const updated: Array<{
      productId: string;
      productName: string;
      previousPriceCents: number;
      newPriceCents: number;
      deltaCents: number;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const product of targets) {
        const newPrice = mode === 'percent'
          ? Math.round(product.price * (factor as number))
          : product.price + (amountCents as number);
        if (newPrice === product.price) continue;

        await tx.product.updateMany({
          where: { id: product.id, workspaceId: context.workspaceId, deletedAt: null },
          data: { price: newPrice },
        });

        updated.push({
          productId: product.id,
          productName: buildProductDisplayName(product),
          previousPriceCents: product.price,
          newPriceCents: newPrice,
          deltaCents: newPrice - product.price,
        });
      }
    });

    const updatedCount = updated.length;
    const unchangedCount = Math.max(0, targets.length - updatedCount);
    const direction = (mode === 'percent' ? (percent as number) : (amount as number)) >= 0 ? 'subidos' : 'bajados';
    const scope = resolvedCategoryName ? ` de la categoría ${resolvedCategoryName}` : '';
    const changeLabel =
      mode === 'percent'
        ? `${Math.abs(percent as number)}%`
        : `$${Math.abs(amount as number).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

    return {
      success: true,
      data: {
        mode,
        percent,
        amount,
        amountCents,
        factor: mode === 'percent' ? factor : null,
        totalProducts: targets.length,
        updatedCount,
        unchangedCount,
        categoryName: resolvedCategoryName,
        sample: updated.slice(0, 10),
        message: `Precios ${direction} ${changeLabel} en ${updatedCount} producto(s)${scope}.`,
      },
    };
  }
}

export interface AdminToolsDependencies {
  messageQueue?: Queue<MessageSendPayload> | null;
}

type AdminProcessStockReceiptResult = {
  success: boolean;
  duplicate?: boolean;
  receiptId?: string;
  totalCents?: number;
  vendorName?: string | null;
  createdProducts?: Array<{ id: string; name: string; sku: string }>;
  stockAdjustments?: Array<{ productId: string; productName: string; delta: number }>;
  message: string;
};

export class AdminProcessStockReceiptTool extends BaseTool<typeof AdminProcessStockReceiptInput, AdminProcessStockReceiptResult> {
  private prisma: PrismaClient;
  private receiptService: StockPurchaseReceiptService;

  constructor(prisma: PrismaClient) {
    super({
      name: 'admin_process_stock_receipt',
      description:
        'Procesa una boleta/factura de compra (proveedor) para actualizar el stock (crea productos si no existen).',
      category: ToolCategory.MUTATION,
      inputSchema: AdminProcessStockReceiptInput,
    });
    this.prisma = prisma;
    this.receiptService = new StockPurchaseReceiptService();
  }

  private resolveWhatsAppApiKey(number: { apiKeyEnc?: string | null; apiKeyIv?: string | null }): string {
    if (!number.apiKeyEnc || !number.apiKeyIv) return '';
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }

  private inferMediaType(fileRef: string, fileType: 'image' | 'pdf', contentType?: string): string {
    const cleaned = (contentType || '').split(';')[0]?.trim();
    if (cleaned) return cleaned;
    if (fileType === 'pdf') return 'application/pdf';
    const lower = (fileRef || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'image/jpeg';
  }

  private sanitizeFilename(name: string): string {
    return (name || 'boleta')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
  }

  private findRepoRoot(startDir: string): string | null {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(path.join(current, 'pnpm-workspace.yaml')) || existsSync(path.join(current, 'turbo.json'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private getUploadDir(): string {
    if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR;
    const repoRoot = this.findRepoRoot(process.cwd()) || process.cwd();
    return path.join(repoRoot, 'apps', 'api', 'uploads');
  }

  private async fetchBuffer(fileRef: string, apiKey?: string): Promise<{ buffer: Buffer; contentType?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers.Authorization = `App ${apiKey}`;
      }

      const response = await fetch(fileRef, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`No pude descargar la boleta (HTTP ${response.status})`);
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || undefined;
      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), contentType };
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseIssuedAt(value?: string | null): Date | null {
    const raw = (value || '').trim();
    const match = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
    if (!match) return null;
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  async execute(
    input: z.infer<typeof AdminProcessStockReceiptInput>,
    context: ToolContext
  ): Promise<ToolResult<AdminProcessStockReceiptResult>> {
    const fileRef = (input.fileRef || '').trim();
    if (!fileRef) {
      return { success: false, error: 'fileRef requerido' };
    }

    const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
      where: { workspaceId: context.workspaceId, isActive: true },
      select: { apiKeyEnc: true, apiKeyIv: true },
    });

    const apiKey =
      (whatsappNumber ? this.resolveWhatsAppApiKey(whatsappNumber) : '') ||
      process.env.INFOBIP_API_KEY ||
      '';

    const { buffer, contentType } = await this.fetchBuffer(fileRef, apiKey);
    const mediaType = this.inferMediaType(fileRef, input.fileType, contentType);
    const fileHash = createHash('sha256').update(buffer).digest('hex');

    const duplicate = await this.receiptService.findDuplicate(this.prisma, context.workspaceId, fileHash);
    if (duplicate) {
      if (duplicate.status === 'draft') {
        const applied = await this.receiptService.apply(this.prisma, {
          workspaceId: context.workspaceId,
          receiptId: duplicate.id,
          source: 'owner_whatsapp',
        });

        const total = applied.receipt.total || 0;
        const adjustments = applied.stockAdjustments.slice(0, 12).map((a) => `• ${a.productName}: +${a.delta}`);
        const created = applied.createdProducts.slice(0, 12).map((p) => `• ${p.name} (SKU ${p.sku})`);

        const messageParts = [
          `Listo. Apliqué una boleta pendiente${applied.receipt.vendorName ? ` de ${applied.receipt.vendorName}` : ''}.`,
          total > 0 ? `Total: $${(total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : null,
          adjustments.length ? `Ajustes de stock:\n${adjustments.join('\n')}` : null,
          created.length
            ? `Productos creados:\n${created.join('\n')}\nNo te olvides de completar categoría, unidades y precio de venta.`
            : null,
        ].filter(Boolean) as string[];

        return {
          success: true,
          data: {
            success: true,
            duplicate: false,
            receiptId: applied.receipt.id,
            totalCents: applied.receipt.total,
            vendorName: applied.receipt.vendorName,
            createdProducts: applied.createdProducts,
            stockAdjustments: applied.stockAdjustments.map((a) => ({
              productId: a.productId,
              productName: a.productName,
              delta: a.delta,
            })),
            message: messageParts.join('\n\n'),
          },
        };
      }

      return {
        success: true,
        data: {
          success: true,
          duplicate: true,
          receiptId: duplicate.id,
          totalCents: duplicate.total,
          vendorName: duplicate.vendorName,
          message: 'Esta boleta ya fue procesada anteriormente. No apliqué cambios al stock.',
        },
      };
    }

    const uploadDir = this.getUploadDir();
    const receiptsDir = path.join(uploadDir, 'stock-receipts');
    await fs.mkdir(receiptsDir, { recursive: true });

    const ext = mediaType === 'application/pdf' ? 'pdf' : 'jpg';
    const uniqueName = `${context.workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${this.sanitizeFilename('boleta')}.${ext}`;
    const localPath = path.join(receiptsDir, uniqueName);
    await fs.writeFile(localPath, buffer);
    const localFileRef = `/uploads/stock-receipts/${uniqueName}`;

    const products = await this.prisma.product.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null, status: { not: 'archived' } },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        unitValue: true,
        secondaryUnit: true,
        secondaryUnitValue: true,
        category: true,
      },
      take: 300,
    });

    const extracted = await extractStockReceiptWithClaude({
      buffer,
      mediaType,
      products,
    });

    if (!extracted.parsed) {
      try {
        await fs.unlink(localPath);
      } catch {
        // ignore cleanup errors
      }
      return {
        success: false,
        error: process.env.ANTHROPIC_API_KEY ? 'No pude leer la boleta.' : 'LLM no configurado.',
      };
    }

    const parsed = extracted.parsed;
    const draft = await this.receiptService.createDraft(this.prisma, {
      workspaceId: context.workspaceId,
      fileRef: localFileRef,
      fileHash,
      mediaType,
      vendorName: parsed.vendor ?? null,
      issuedAt: this.parseIssuedAt(parsed.issued_at ?? null),
      totalCents: parsed.total_cents ?? null,
      currency: parsed.currency ?? 'ARS',
      extractedData: {
        rawText: extracted.rawText,
        parsed,
        source: 'owner_whatsapp',
        originalFileRef: fileRef,
      },
      items: (parsed.items || []).map((item) => ({
        rawDescription: item.description,
        quantity: item.quantity,
        isPack: item.is_pack === true,
        unitsPerPack: item.units_per_pack ?? null,
        matchedProductId: item.match?.product_id ?? null,
        matchConfidence: item.match?.confidence ?? null,
        unitPriceCents: item.unit_price_cents ?? null,
        lineTotalCents: item.line_total_cents ?? null,
        suggestedProduct: item.new_product
          ? {
              name: item.new_product.name,
              unit: item.new_product.unit ?? null,
              unitValue: item.new_product.unit_value ?? null,
              secondaryUnit: item.new_product.secondary_unit ?? null,
              secondaryUnitValue: item.new_product.secondary_unit_value ?? null,
            }
          : null,
        metadata: item.match?.reason ? { matchReason: item.match.reason } : undefined,
      })),
    });

    const applied = await this.receiptService.apply(this.prisma, {
      workspaceId: context.workspaceId,
      receiptId: draft.id,
      source: 'owner_whatsapp',
    });

    const total = applied.receipt.total || 0;
    const adjustments = applied.stockAdjustments.slice(0, 12).map((a) => `• ${a.productName}: +${a.delta}`);
    const created = applied.createdProducts.slice(0, 12).map((p) => `• ${p.name} (SKU ${p.sku})`);

    const messageParts = [
      `Listo. Procesé la boleta${applied.receipt.vendorName ? ` de ${applied.receipt.vendorName}` : ''}.`,
      total > 0 ? `Total: $${(total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : null,
      adjustments.length ? `Ajustes de stock:\\n${adjustments.join('\\n')}` : null,
      created.length
        ? `Productos creados:\\n${created.join('\\n')}\\nNo te olvides de completar categoría, unidades y precio de venta.`
        : null,
    ].filter(Boolean) as string[];

    return {
      success: true,
      data: {
        success: true,
        duplicate: false,
        receiptId: applied.receipt.id,
        totalCents: applied.receipt.total,
        vendorName: applied.receipt.vendorName,
        createdProducts: applied.createdProducts,
        stockAdjustments: applied.stockAdjustments.map((a) => ({
          productId: a.productId,
          productName: a.productName,
          delta: a.delta,
        })),
        message: messageParts.join('\\n\\n'),
      },
    };
  }
}

export function createAdminTools(prisma: PrismaClient, deps: AdminToolsDependencies = {}): BaseTool<any, any>[] {
  return [
    new AdminGetOrdersKpisTool(prisma),
    new AdminListOrdersTool(prisma),
    new AdminGetOrderDetailsTool(prisma),
    new AdminGetOrCreateCustomerTool(prisma),
    new AdminUpdateOrderStatusTool(prisma),
    new AdminCancelOrderTool(prisma),
    new AdminCreateOrderTool(prisma),
    new AdminSendCustomerMessageTool(prisma, deps.messageQueue),
    new AdminSendDebtReminderTool(prisma, deps.messageQueue),
    new AdminAdjustPricesPercentTool(prisma),
    new AdminProcessStockReceiptTool(prisma),
  ];
}
