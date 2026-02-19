/**
 * Orders Routes
 * CRUD operations for order management
 */
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

import { Prisma } from '@prisma/client';
import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { OrderReceiptPdfService, LedgerService, decrypt } from '@nexova/core';
import { EvolutionClient, InfobipClient } from '@nexova/integrations/whatsapp';

import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { recalcCustomerFinancials } from '../../utils/customer-financials.js';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { calculatePromotionDiscount, promotionIsUsable } from '../../utils/promotions.js';
import { extractReceiptAmountWithClaude, parseAmountInputToCents } from '../../utils/receipt-claude.js';
import { resolveUploadDir } from '../../utils/upload-dir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = resolveUploadDir(__dirname);
const RECEIPTS_DIR = path.join(UPLOAD_DIR, 'receipts');
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

type OrderMetadataRecord = Record<string, unknown>;
type OrderTrashMetadata = {
  isTrashed: boolean;
  previousStatus: string | null;
  trashedAt: string | null;
  reason: string | null;
};

const ORDER_TRASH_STATUS = 'trashed';

const asOrderMetadataRecord = (value: Prisma.JsonValue | null | undefined): OrderMetadataRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as OrderMetadataRecord;
};

const parseOrderTrashMetadata = (metadata: Prisma.JsonValue | null | undefined): OrderTrashMetadata | null => {
  const record = asOrderMetadataRecord(metadata);
  const trash = record.trash;
  if (!trash || typeof trash !== 'object' || Array.isArray(trash)) return null;
  const trashRecord = trash as Record<string, unknown>;
  if (trashRecord.isTrashed !== true) return null;

  const previousStatus = typeof trashRecord.previousStatus === 'string' ? trashRecord.previousStatus : null;
  const trashedAt = typeof trashRecord.trashedAt === 'string' ? trashRecord.trashedAt : null;
  const reason = typeof trashRecord.reason === 'string' ? trashRecord.reason : null;

  return {
    isTrashed: true,
    previousStatus,
    trashedAt,
    reason,
  };
};

const orderIsInTrash = (status: string, metadata: Prisma.JsonValue | null | undefined): boolean =>
  status === ORDER_TRASH_STATUS || parseOrderTrashMetadata(metadata)?.isTrashed === true;

const resolveTrashReason = (
  cancelReason: string | null | undefined,
  metadata: Prisma.JsonValue | null | undefined
): string | null => {
  const trashReason = parseOrderTrashMetadata(metadata)?.reason;
  if (trashReason && trashReason.trim().length > 0) return trashReason.trim();
  if (typeof cancelReason === 'string' && cancelReason.trim().length > 0) return cancelReason.trim();
  return null;
};

const buildNotTrashedWhere = (): Prisma.OrderWhereInput => ({
  AND: [
    { status: { not: ORDER_TRASH_STATUS } },
    {
      OR: [
        { metadata: { equals: Prisma.AnyNull } },
        { metadata: { path: ['trash', 'isTrashed'], equals: Prisma.AnyNull } },
        { metadata: { path: ['trash', 'isTrashed'], equals: false } },
        { metadata: { path: ['trash', 'isTrashed'], equals: 'false' } },
      ],
    },
  ],
});

const buildOnlyTrashedWhere = (): Prisma.OrderWhereInput => ({
  OR: [
    { status: ORDER_TRASH_STATUS },
    { metadata: { path: ['trash', 'isTrashed'], equals: true } },
    { metadata: { path: ['trash', 'isTrashed'], equals: 'true' } },
  ],
});

type CustomerMetadataRecord = Record<string, unknown>;

const asCustomerMetadataRecord = (value: Prisma.JsonValue | null | undefined): CustomerMetadataRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as CustomerMetadataRecord;
};

const readMetadataString = (metadata: CustomerMetadataRecord, key: string): string | null => {
  const raw = metadata[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const withFiscalFallback = (input: {
  cuit?: string | null;
  businessName?: string | null;
  fiscalAddress?: string | null;
  vatCondition?: string | null;
  metadata?: Prisma.JsonValue | null;
}): {
  dni: string | null;
  cuit: string | null;
  businessName: string | null;
  fiscalAddress: string | null;
  vatCondition: string | null;
} => {
  const metadata = asCustomerMetadataRecord(input.metadata);

  return {
    dni: readMetadataString(metadata, 'dni'),
    cuit: input.cuit || readMetadataString(metadata, 'cuit'),
    businessName:
      input.businessName ||
      readMetadataString(metadata, 'businessName') ||
      readMetadataString(metadata, 'razonSocial'),
    fiscalAddress:
      input.fiscalAddress ||
      readMetadataString(metadata, 'fiscalAddress') ||
      readMetadataString(metadata, 'domicilioFiscal'),
    vatCondition: input.vatCondition || readMetadataString(metadata, 'vatCondition'),
  };
};

const normalizePhone = (phone: string): string => {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  return `+${digits}`;
};

const resolveWhatsAppApiKey = (number: {
  apiKeyEnc?: string | null;
  apiKeyIv?: string | null;
  provider?: string | null;
}): string => {
  const provider = (number.provider || 'infobip').toLowerCase();
  if (provider === 'infobip') {
    const envKey = (process.env.INFOBIP_API_KEY || '').trim();
    if (envKey) return envKey;
    if (number.apiKeyEnc && number.apiKeyIv) {
      return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
    }
    return '';
  }
  if (provider === 'evolution') {
    const envKey = (process.env.EVOLUTION_API_KEY || '').trim();
    if (envKey) return envKey;
    if (number.apiKeyEnc && number.apiKeyIv) {
      return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
    }
    return '';
  }
  if (number.apiKeyEnc && number.apiKeyIv) {
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }
  return '';
};

const resolveInfobipBaseUrl = (apiUrl?: string | null): string => {
  const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
  const envUrl = (process.env.INFOBIP_BASE_URL || '').trim().replace(/\/$/, '');
  const defaultUrl = 'https://api.infobip.com';
  if (cleaned && cleaned.toLowerCase() !== defaultUrl) return cleaned;
  if (envUrl) return envUrl;
  return cleaned || defaultUrl;
};

const resolveEvolutionBaseUrl = (apiUrl?: string | null): string => {
  const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
  const envUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/$/, '');
  return cleaned || envUrl;
};

const getEvolutionInstanceName = (providerConfig: unknown): string => {
  if (!providerConfig || typeof providerConfig !== 'object') return '';
  const cfg = providerConfig as Record<string, unknown>;
  const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
  return typeof value === 'string' ? value.trim() : '';
};

const buildOrderCancelledCustomerMessage = (orderNumber: string, reason: string): string =>
  [
    `Tu pedido #${orderNumber} fue cancelado.`,
    `Motivo: ${reason}.`,
    'Si querés, podés escribirnos y te ayudamos a generar uno nuevo.',
  ].join('\n');

const orderQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum([
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
  ]).optional(),
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  sortBy: z.enum(['orderNumber', 'total', 'createdAt', 'updatedAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  includeTrashed: z.coerce.boolean().optional(),
  promotion: z.enum(['with', 'without']).optional(),
});

const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().int().min(0).optional(),
    notes: z.string().max(500).optional(),
  })).min(1),
  status: z.enum([
    'draft',
    'awaiting_acceptance',
    'accepted',
    'pending_invoicing',
    'invoiced',
    'invoice_cancelled',
    'cancelled',
    'trashed',
  ]).optional(),
  paidAmount: z.number().int().min(0).optional(),
  paymentMethod: z.enum(['cash', 'transfer', 'mercadopago', 'credit_card', 'debit_card', 'other']).optional(),
  notes: z.string().max(2000).optional(),
  shippingAddress: z.object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().default('AR'),
  }).optional(),
  shipping: z.number().int().min(0).default(0),
  discount: z.number().int().min(0).default(0),
  promotionId: z.string().uuid().optional().nullable(),
});

const UNIT_SHORT_LABELS: Record<string, string> = {
  unit: 'uds',
  kg: 'kg',
  g: 'g',
  l: 'lts',
  ml: 'ml',
  m: 'm',
  cm: 'cm',
  pack: 'pack',
  dozen: 'doc',
  box: 'caja',
};

const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

const buildSecondarySuffix = (unit?: string | null, value?: string | null): string => {
  if (!unit) return '';
  const label = SECONDARY_UNIT_LABELS[unit] || unit;
  if (value) {
    return `${label} ${value}`.trim();
  }
  return label;
};

const buildProductDisplayName = (product: {
  name: string;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
}): string => {
  const unit = product.unit || 'unit';
  const unitValue = product.unitValue?.toString().trim();
  const primarySuffix = unit !== 'unit' && unitValue ? `${unitValue} ${UNIT_SHORT_LABELS[unit] || unit}` : '';
  const secondarySuffix = buildSecondarySuffix(product.secondaryUnit, product.secondaryUnitValue || undefined);

  return [product.name, primarySuffix, secondarySuffix].filter(Boolean).join(' ').trim();
};

const updateOrderSchema = z.object({
  status: z.enum([
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
  ]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  internalNotes: z.string().max(2000).optional().nullable(),
  shippingAddress: z.object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().default('AR'),
  }).optional(),
  shipping: z.number().int().min(0).optional(),
  discount: z.number().int().min(0).optional(),
  promotionId: z.string().uuid().optional().nullable(),
  cancelReason: z.string().max(500).optional().nullable(),
});

const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  const ledgerService = new LedgerService(fastify.prisma);
  // Helper to generate order number
  const generateOrderNumber = async (workspaceId: string): Promise<string> => {
    const today = new Date();
    const prefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const lastOrder = await fastify.prisma.order.findFirst({
      where: { workspaceId, orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSeq = parseInt(lastOrder.orderNumber.slice(-4), 10);
      sequence = lastSeq + 1;
    }

    return `${prefix}${String(sequence).padStart(4, '0')}`;
  };

  const notifyCustomerOrderCancelled = async (params: {
    workspaceId: string;
    customerPhone: string;
    orderNumber: string;
    reason: string;
  }): Promise<void> => {
    const whatsappNumber = await fastify.prisma.whatsAppNumber.findFirst({
      where: { workspaceId: params.workspaceId, isActive: true },
      select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true, providerConfig: true },
    });

    if (!whatsappNumber) {
      throw new Error('WHATSAPP_NOT_CONFIGURED');
    }

    const apiKey = resolveWhatsAppApiKey(whatsappNumber);
    if (!apiKey) {
      throw new Error('WHATSAPP_API_KEY_MISSING');
    }

    const message = buildOrderCancelledCustomerMessage(params.orderNumber, params.reason);
    const provider = (whatsappNumber.provider || 'infobip').toLowerCase();
    if (provider === 'evolution') {
      const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
      const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
      if (!baseUrl || !instanceName) {
        throw new Error('EVOLUTION_NOT_CONFIGURED');
      }
      const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
      await client.sendText(normalizePhone(params.customerPhone), message);
      return;
    }

    const client = new InfobipClient({
      apiKey,
      baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
      senderNumber: whatsappNumber.phoneNumber,
    });
    await client.sendText(normalizePhone(params.customerPhone), message);
  };

  // Get orders list
  fastify.get(
    '/',
    { preHandler: [fastify.requirePermission('orders:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const query = orderQuerySchema.parse(request.query);
      const {
        search,
        status,
        customerId,
        limit,
        offset,
        sortBy,
        sortOrder,
        from,
        to,
        includeTrashed,
        promotion,
      } = query;
      const paymentFilters = ['pending_payment', 'partial_payment', 'paid'] as const;
      const paymentFilterSet = new Set<string>(paymentFilters);
      const isPaymentFilter = typeof status === 'string' && paymentFilterSet.has(status);

      // Build where clause
      const where: Prisma.OrderWhereInput = { workspaceId, deletedAt: null };
      const andConditions: Prisma.OrderWhereInput[] = [];
      const showOnlyTrashed = status === 'trashed';
      const shouldExcludeTrashed = !showOnlyTrashed && !includeTrashed;

      if (showOnlyTrashed) {
        andConditions.push(buildOnlyTrashedWhere());
      } else if (shouldExcludeTrashed) {
        andConditions.push(buildNotTrashedWhere());
      }

      if (status && !isPaymentFilter && status !== 'trashed') {
        if (status === 'awaiting_acceptance') {
          andConditions.push({ status: { in: ['awaiting_acceptance', 'draft', 'pending_invoicing'] } });
        } else if (status === 'accepted') {
          andConditions.push({
            status: {
              in: [
                'accepted',
                'processing',
                'shipped',
                'delivered',
                'confirmed',
                'preparing',
                'ready',
                'paid',
                'invoiced',
                'invoice_cancelled',
              ],
            },
          });
        } else if (status === 'cancelled') {
          andConditions.push({ status: { in: ['cancelled', 'returned'] } });
        } else {
          andConditions.push({ status });
        }
      }

      if (customerId) {
        where.customerId = customerId;
      }

      if (promotion === 'with') {
        where.promotionId = { not: null };
      } else if (promotion === 'without') {
        where.promotionId = null;
      }

      if (from || to) {
        const createdAtFilter: Prisma.DateTimeFilter = {};
        if (from) createdAtFilter.gte = from;
        if (to) createdAtFilter.lte = to;
        andConditions.push({ createdAt: createdAtFilter });
      }

      if (search) {
        andConditions.push({
          OR: [
            { orderNumber: { contains: search, mode: 'insensitive' } },
            { customer: { phone: { contains: search } } },
            { customer: { firstName: { contains: search, mode: 'insensitive' } } },
            { customer: { lastName: { contains: search, mode: 'insensitive' } } },
          ],
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      // Get orders with customer and items
      const [orders, total] = await Promise.all([
        fastify.prisma.order.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          ...(isPaymentFilter ? {} : { skip: offset, take: limit }),
          include: {
            customer: {
              select: {
                id: true,
                phone: true,
                firstName: true,
                lastName: true,
                cuit: true,
                businessName: true,
                fiscalAddress: true,
                vatCondition: true,
                metadata: true,
              },
            },
            items: {
              select: {
                id: true,
                name: true,
                quantity: true,
                unitPrice: true,
                total: true,
              },
            },
            payments: {
              where: { status: 'completed' },
              select: { amount: true },
            },
            promotion: {
              select: {
                id: true,
                name: true,
                promoType: true,
                value: true,
              },
            },
          },
        }),
        isPaymentFilter ? Promise.resolve(0) : fastify.prisma.order.count({ where }),
      ]);

      // Format response
      const formattedOrders = orders.map((o) => {
        const paymentsSum = o.payments.reduce((sum, p) => sum + p.amount, 0);
        const paidAmount = Math.max(o.paidAmount ?? 0, paymentsSum);
        const fiscal = withFiscalFallback(o.customer);
        const trash = parseOrderTrashMetadata(o.metadata);
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          customer: {
            id: o.customer.id,
            phone: o.customer.phone,
            firstName: o.customer.firstName,
            lastName: o.customer.lastName,
            name: o.customer.firstName && o.customer.lastName
              ? `${o.customer.firstName} ${o.customer.lastName}`
              : o.customer.firstName || o.customer.lastName || o.customer.phone,
            dni: fiscal.dni,
            cuit: fiscal.cuit,
            businessName: fiscal.businessName,
            fiscalAddress: fiscal.fiscalAddress,
            vatCondition: fiscal.vatCondition,
          },
          itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
          subtotal: o.subtotal,
          shipping: o.shipping,
          discount: o.discount,
          total: o.total,
          paidAmount,
          pendingAmount: o.total - paidAmount,
          notes: o.notes,
          cancelReason: o.cancelReason,
          isTrashed: orderIsInTrash(o.status, o.metadata),
          trashReason: resolveTrashReason(o.cancelReason, o.metadata),
          trash,
          items: o.items,
          hasPromotion: !!o.promotionId,
          promotion: o.promotion
            ? {
              id: o.promotion.id,
              name: o.promotion.name,
              promoType: o.promotion.promoType,
              value: o.promotion.value,
            }
            : null,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        };
      });

      const matchesPaymentFilter = (
        order: { total: number; paidAmount: number },
        filter: 'pending_payment' | 'partial_payment' | 'paid'
      ): boolean => {
        if (filter === 'paid') {
          return order.total <= 0 || order.paidAmount >= order.total;
        }
        if (filter === 'partial_payment') {
          return order.paidAmount > 0 && order.paidAmount < order.total;
        }
        if (filter === 'pending_payment') {
          return order.total > 0 && order.paidAmount <= 0;
        }
        return true;
      };

      const filteredOrders = isPaymentFilter && status
        ? formattedOrders.filter((o) => {
            const paymentStatus =
              status === 'pending_payment' || status === 'partial_payment' || status === 'paid'
                ? status
                : null;
            return paymentStatus ? matchesPaymentFilter(o, paymentStatus) : true;
          })
        : formattedOrders;

      const pagedOrders = isPaymentFilter
        ? filteredOrders.slice(offset, offset + limit)
        : filteredOrders;
      const totalCount = isPaymentFilter ? filteredOrders.length : total;

      return reply.send({
        orders: pagedOrders,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      });
    }
  );

  // Get order stats
  fastify.get(
    '/stats',
    { preHandler: [fastify.requirePermission('orders:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfUtcMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
      );
      const endOfUtcMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)
      );

      const membership = await fastify.prisma.membership.findFirst({
        where: {
          workspaceId,
          userId: request.user!.sub,
          status: { in: ['ACTIVE', 'active'] },
        },
        include: { role: { select: { name: true } } },
      });
      const planContext = await getWorkspacePlanContext(
        fastify.prisma,
        workspaceId,
        membership?.role?.name
      );
      const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planContext.plan);
      const monthlyOrdersQuotaLimit = limits.ordersPerMonth;

      const [
        totalOrders,
        pendingOrders,
        monthlyOrders,
        monthlyOrdersUsedForLimit,
        aggregates,
        statusBreakdown,
      ] = await Promise.all([
        // Total orders
        fastify.prisma.order.count({ where: { workspaceId, deletedAt: null } }),

        // Pending approval orders
        fastify.prisma.order.count({
          where: {
            workspaceId,
            deletedAt: null,
            status: { in: ['awaiting_acceptance', 'draft'] },
          },
        }),

        // Orders this month
        fastify.prisma.order.count({
          where: {
            workspaceId,
            deletedAt: null,
            createdAt: { gte: startOfMonth },
          },
        }),

        // Orders count used for plan quota (UTC month, same rule as POST /orders)
        fastify.prisma.order.count({
          where: {
            workspaceId,
            createdAt: { gte: startOfUtcMonth, lte: endOfUtcMonth },
          },
        }),

        // Revenue aggregates
        fastify.prisma.order.aggregate({
          where: {
            workspaceId,
            deletedAt: null,
            status: { notIn: ['cancelled', 'returned', 'trashed'] },
          },
          _sum: { total: true, paidAmount: true },
          _avg: { total: true },
        }),

        // Status breakdown
        fastify.prisma.order.groupBy({
          by: ['status'],
          where: { workspaceId, deletedAt: null },
          _count: { id: true },
        }),
      ]);

      const totalRevenue = aggregates._sum.total || 0;
      const totalPaid = aggregates._sum.paidAmount || 0;
      const avgOrderValue = aggregates._avg.total || 0;
      const monthlyOrdersLimitReached =
        monthlyOrdersQuotaLimit !== null && monthlyOrdersUsedForLimit >= monthlyOrdersQuotaLimit;

      return reply.send({
        totalOrders,
        pendingOrders,
        monthlyOrders,
        monthlyOrdersQuotaLimit,
        monthlyOrdersUsedForLimit,
        monthlyOrdersLimitReached,
        totalRevenue,
        totalPaid,
        pendingRevenue: totalRevenue - totalPaid,
        avgOrderValue: Math.round(avgOrderValue),
        statusBreakdown: statusBreakdown.map((s) => ({
          status: s.status,
          count: s._count.id,
        })),
      });
    }
  );

  // Get single order
  fastify.get(
    '/:id',
    { preHandler: [fastify.requirePermission('orders:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = orderIdParamsSchema.parse(request.params);

      const order = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          customer: {
            select: {
              id: true,
              phone: true,
              email: true,
              firstName: true,
              lastName: true,
              cuit: true,
              businessName: true,
              fiscalAddress: true,
              vatCondition: true,
              currentBalance: true,
              metadata: true,
            },
          },
          items: {
            include: {
              product: {
                select: { id: true, name: true, images: true },
              },
            },
          },
          receipts: {
            orderBy: { uploadedAt: 'desc' },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
          },
          statusHistory: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          promotion: {
            select: {
              id: true,
              name: true,
              promoType: true,
              value: true,
              startsAt: true,
              endsAt: true,
              status: true,
            },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const paymentsSum = order.payments
        .filter((p) => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);
      const paidAmount = Math.max(order.paidAmount ?? 0, paymentsSum);
      const customerFiscal = withFiscalFallback(order.customer);
      const trash = parseOrderTrashMetadata(order.metadata);
      const customerWithoutMetadata = {
        id: order.customer.id,
        phone: order.customer.phone,
        email: order.customer.email,
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        currentBalance: order.customer.currentBalance,
      };

      return reply.send({
        order: {
          ...order,
          customer: {
            ...customerWithoutMetadata,
            dni: customerFiscal.dni,
            cuit: customerFiscal.cuit,
            businessName: customerFiscal.businessName,
            fiscalAddress: customerFiscal.fiscalAddress,
            vatCondition: customerFiscal.vatCondition,
          },
          hasPromotion: !!order.promotionId,
          paidAmount,
          pendingAmount: order.total - paidAmount,
          isTrashed: orderIsInTrash(order.status, order.metadata),
          trashReason: resolveTrashReason(order.cancelReason, order.metadata),
          trash,
        },
      });
    }
  );

  // Generate receipt PDF
  fastify.get(
    '/:id/receipt',
    { preHandler: [fastify.requirePermission('orders:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = orderIdParamsSchema.parse(request.params);

      const order = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          customer: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          items: {
            select: {
              name: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
          payments: {
            where: { status: 'completed' },
            select: { amount: true },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const receiptService = new OrderReceiptPdfService(fastify.prisma);
      const paidAmount = order.payments.reduce((sum, p) => sum + p.amount, 0);

      const receipt = await receiptService.generateReceipt(workspaceId, {
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        status: order.status,
        subtotal: order.subtotal,
        shipping: order.shipping,
        discount: order.discount,
        total: order.total,
        paidAmount,
        notes: order.notes,
        customer: order.customer,
        items: order.items,
      });

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${receipt.filename}"`)
        .send(receipt.buffer);
    }
  );

  // Upload manual receipt and optionally apply to order
  fastify.post(
    '/:id/receipts',
    { preHandler: [fastify.requirePermission('payments:create')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const membership = await fastify.prisma.membership.findFirst({
        where: {
          workspaceId,
          userId: request.user!.sub,
          status: { in: ['ACTIVE', 'active'] },
        },
        include: { role: { select: { name: true } } },
      });
      const planContext = await getWorkspacePlanContext(
        fastify.prisma,
        workspaceId,
        membership?.role?.name
      );
      const canAutoDetectManualReceiptAmount = planContext.capabilities.autoDetectManualReceiptAmount;
      const canUsePaymentLinks = planContext.capabilities.showMercadoPagoIntegration;

      const { id } = orderIdParamsSchema.parse(request.params);
      const order = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, orderNumber: true, customerId: true, total: true, paidAmount: true },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const normalizePaymentMethod = (raw?: string): 'cash' | 'transfer' | 'link' => {
        const value = (raw || '').toLowerCase().trim();
        if (!value) return 'transfer';
        if (['cash', 'efectivo'].includes(value)) return 'cash';
        if (['transfer', 'transferencia', 'bank', 'bank_transfer'].includes(value)) return 'transfer';
        if (['link', 'mercadopago', 'mp', 'mp_link', 'payment_link'].includes(value)) return 'link';
        return 'transfer';
      };

      const getFieldValue = (field: unknown): string | undefined => {
        if (!field) return undefined;
        if (typeof field === 'string') return field;
        if (typeof field === 'number') return String(field);
        if (typeof field === 'object' && 'value' in field) {
          const value = (field as { value?: unknown }).value;
          if (typeof value === 'string') return value;
          if (typeof value === 'number') return String(value);
        }
        return undefined;
      };

      const isMultipart = typeof (request as typeof request & { isMultipart?: () => boolean }).isMultipart === 'function'
        ? (request as typeof request & { isMultipart?: () => boolean }).isMultipart?.() === true
        : false;

      const rawBody = request.body as Record<string, unknown> | undefined;
      const rawPaymentMethod = isMultipart ? undefined : getFieldValue(rawBody?.paymentMethod ?? rawBody?.method);
      const paymentMethod = normalizePaymentMethod(rawPaymentMethod);

      if (paymentMethod === 'link' && !canUsePaymentLinks) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye link de pago',
        });
      }

      if (!isMultipart && paymentMethod !== 'cash') {
        return reply.code(400).send({
          error: 'FILE_REQUIRED',
          message: 'El comprobante es obligatorio para transferencias o link de pago.',
        });
      }

      if (!isMultipart && paymentMethod === 'cash') {
        const amountRaw = getFieldValue(rawBody?.amount);
        const declaredAmount = parseAmountInputToCents(amountRaw);
        if (!declaredAmount) {
          return reply.code(400).send({ error: 'INVALID_AMOUNT', message: 'Monto inválido' });
        }

        const receipt = await fastify.prisma.receipt.create({
          data: {
            workspaceId,
            customerId: order.customerId,
            orderId: order.id,
            fileRef: null,
            fileType: 'manual',
            declaredAmount,
            appliedAmount: null,
            status: 'pending_review',
            appliedAt: null,
            appliedBy: null,
            paymentMethod,
          },
        });

        // Manual receipts added from the dashboard should not trigger "new receipt" notifications.

        try {
          await ledgerService.applyPaymentToOrder(
            workspaceId,
            order.customerId,
            order.id,
            declaredAmount,
            'Receipt',
            receipt.id,
            request.user?.sub
          );

          await fastify.prisma.payment.create({
            data: {
              orderId: order.id,
              provider: 'receipt',
              externalId: receipt.id,
              method: paymentMethod,
              status: 'completed',
              amount: declaredAmount,
              currency: 'ARS',
              netAmount: declaredAmount,
              completedAt: new Date(),
              providerData: { receiptId: receipt.id, source: 'manual' },
            },
          });

          await fastify.prisma.receipt.updateMany({
            where: { id: receipt.id, workspaceId },
            data: {
              status: 'applied',
              appliedAmount: declaredAmount,
              appliedAt: new Date(),
              appliedBy: request.user?.sub,
            },
          });
        } catch (error) {
          request.log.error({ error }, 'Failed to apply cash receipt');
          return reply.code(500).send({
            error: 'RECEIPT_APPLY_FAILED',
            message: 'No se pudo aplicar el comprobante',
            receiptId: receipt.id,
          });
        }

        await recalcCustomerFinancials(fastify.prisma, workspaceId, order.customerId);

        const refreshedOrder = await fastify.prisma.order.findFirst({
          where: { id: order.id, workspaceId, deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            paidAmount: true,
            payments: {
              where: { status: 'completed' },
              select: { amount: true },
            },
          },
        });

        const orderSummary = refreshedOrder
          ? (() => {
              const paymentsSum = refreshedOrder.payments.reduce((sum, p) => sum + p.amount, 0);
              const paidAmount = Math.max(refreshedOrder.paidAmount ?? 0, paymentsSum);
              return {
                id: refreshedOrder.id,
                orderNumber: refreshedOrder.orderNumber,
                status: refreshedOrder.status,
                total: refreshedOrder.total,
                paidAmount,
                pendingAmount: Math.max(refreshedOrder.total - paidAmount, 0),
              };
            })()
          : null;

        return reply.send({
          success: true,
          applied: true,
          receiptId: receipt.id,
          order: orderSummary,
        });
      }

      const data = await request.file({
        limits: { fileSize: 5 * 1024 * 1024 },
      });

      if (!data) {
        return reply.code(400).send({ error: 'NO_FILE', message: 'No file uploaded' });
      }

      const allowedTypes = new Set([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
      ]);

      if (!allowedTypes.has(data.mimetype)) {
        return reply.code(400).send({
          error: 'INVALID_FILE',
          message: 'Tipo de archivo no permitido. Use JPG, PNG, WebP, GIF o PDF.',
        });
      }

      if (!existsSync(RECEIPTS_DIR)) {
        mkdirSync(RECEIPTS_DIR, { recursive: true });
      }

      const fileType = data.mimetype === 'application/pdf' ? 'pdf' : 'image';
      const ext = data.filename.split('.').pop() || (fileType === 'pdf' ? 'pdf' : 'jpg');
      const filename = `${workspaceId}-${randomUUID()}.${ext}`;
      const filepath = path.join(RECEIPTS_DIR, filename);

      await pipeline(data.file, createWriteStream(filepath));
      const stats = await fs.stat(filepath);
      const buffer = await fs.readFile(filepath);
      const fileHash = createHash('sha256').update(buffer).digest('hex');

      const existingReceipt = await fastify.prisma.receipt.findFirst({
        where: { customerId: order.customerId, fileHash },
        select: { id: true },
      });

      if (existingReceipt) {
        try {
          await fs.unlink(filepath);
        } catch {
          // ignore cleanup errors
        }
        return reply.code(409).send({
          error: 'DUPLICATE_RECEIPT',
          message: 'Este comprobante ya fue cargado.',
          receiptId: existingReceipt.id,
        });
      }

      const candidateReceipts = await fastify.prisma.receipt.findMany({
        where: {
          customerId: order.customerId,
          fileHash: null,
          fileSizeBytes: stats.size,
        },
        select: { id: true, fileRef: true },
        orderBy: { uploadedAt: 'desc' },
        take: 10,
      });

      const resolveLocalReceiptPath = (fileRef: string): string | null => {
        if (fileRef.startsWith('/uploads/')) {
          return path.join(UPLOAD_DIR, fileRef.replace(/^\/uploads\//, ''));
        }
        if (fileRef.startsWith('uploads/')) {
          return path.join(UPLOAD_DIR, fileRef.replace(/^uploads\//, ''));
        }
        try {
          const parsed = new URL(fileRef);
          if (parsed.pathname.startsWith('/uploads/')) {
            return path.join(UPLOAD_DIR, parsed.pathname.replace(/^\/uploads\//, ''));
          }
          const signedMatch = parsed.pathname.match(/^\/api\/v1\/uploads\/file\/([^/]+)\/([^/]+)$/i);
          if (signedMatch) {
            const category = decodeURIComponent(signedMatch[1]).replace(/[^a-z0-9-]/gi, '').toLowerCase();
            const filename = decodeURIComponent(signedMatch[2]).replace(/[^a-zA-Z0-9._-]/g, '');
            if (category && filename) {
              return path.join(UPLOAD_DIR, category, filename);
            }
          }
        } catch {
          // ignore invalid URLs
        }
        return null;
      };

      for (const candidate of candidateReceipts) {
        if (!candidate.fileRef) continue;
        const candidatePath = resolveLocalReceiptPath(candidate.fileRef);
        if (!candidatePath) continue;
        try {
          const candidateBuffer = await fs.readFile(candidatePath);
          const candidateHash = createHash('sha256').update(candidateBuffer).digest('hex');
          if (candidateHash === fileHash) {
            await fastify.prisma.receipt.updateMany({
              where: { id: candidate.id, customerId: order.customerId },
              data: { fileHash: candidateHash },
            });
            try {
              await fs.unlink(filepath);
            } catch {
              // ignore cleanup errors
            }
            return reply.code(409).send({
              error: 'DUPLICATE_RECEIPT',
              message: 'Este comprobante ya fue cargado.',
              receiptId: candidate.id,
            });
          }
        } catch {
          // ignore candidate read errors
        }
      }

      const autoDetectRaw = getFieldValue(data.fields?.autoDetect);
      const autoDetectRequested = autoDetectRaw ? autoDetectRaw === 'true' : true;
      const autoDetect = canAutoDetectManualReceiptAmount && autoDetectRequested;
      const declaredAmountRaw = getFieldValue(data.fields?.amount);
      const paymentMethodFromField = normalizePaymentMethod(getFieldValue(data.fields?.paymentMethod ?? data.fields?.method));
      const declaredAmount = parseAmountInputToCents(declaredAmountRaw);
      if (declaredAmountRaw && !declaredAmount) {
        return reply.code(400).send({
          error: 'INVALID_AMOUNT',
          message: 'Monto inválido',
        });
      }

      let extractedAmount: number | undefined;
      let extractedConfidence: number | undefined;
      let extractedText: string | undefined;

      if (autoDetect) {
        try {
          const expectedAmount = Math.max((order.total ?? 0) - (order.paidAmount ?? 0), 0);
          const extracted = await extractReceiptAmountWithClaude({
            buffer,
            mediaType: data.mimetype,
            expectedAmount: expectedAmount > 0 ? expectedAmount : undefined,
          });
          extractedAmount = extracted.amountCents;
          extractedConfidence = extracted.confidence;
          extractedText = extracted.extractedText;
        } catch (error) {
          request.log.warn({ error }, 'Failed to detect receipt amount');
        }
      }

      const amountToApply = declaredAmount ?? extractedAmount;

      let receipt;
      try {
        receipt = await fastify.prisma.receipt.create({
          data: {
            workspaceId,
            customerId: order.customerId,
            orderId: order.id,
            fileRef: `/uploads/receipts/${filename}`,
            fileHash,
            fileType,
            fileSizeBytes: stats.size,
            extractedAmount: extractedAmount ?? null,
            extractedConfidence: extractedConfidence ?? null,
            extractedRawText: extractedText ?? null,
            declaredAmount: declaredAmount ?? null,
            status: 'pending_review',
            paymentMethod: paymentMethodFromField,
          },
        });
        // Manual receipts added from the dashboard should not trigger "new receipt" notifications.
      } catch (error) {
        const errorCode =
          typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined;
        if (errorCode === 'P2002') {
          try {
            await fs.unlink(filepath);
          } catch {
            // ignore cleanup errors
          }
          return reply.code(409).send({
            error: 'DUPLICATE_RECEIPT',
            message: 'Este comprobante ya fue cargado.',
          });
        }
        throw error;
      }

      if (!amountToApply) {
        return reply.send({
          success: true,
          applied: false,
          needsAmount: true,
          receiptId: receipt.id,
          extractedAmount: extractedAmount ?? null,
        });
      }

      try {
        await ledgerService.applyPaymentToOrder(
          workspaceId,
          order.customerId,
          order.id,
          amountToApply,
          'Receipt',
          receipt.id,
          request.user?.sub
        );

        await fastify.prisma.receipt.updateMany({
          where: { id: receipt.id, workspaceId },
          data: {
            status: 'applied',
            appliedAmount: amountToApply,
            appliedAt: new Date(),
            appliedBy: request.user?.sub,
          },
        });

        await fastify.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: 'receipt',
            externalId: receipt.id,
            method: paymentMethodFromField || 'transfer',
            status: 'completed',
            amount: amountToApply,
            currency: 'ARS',
            netAmount: amountToApply,
            completedAt: new Date(),
            providerData: { receiptId: receipt.id, source: 'manual' },
          },
        });

        await recalcCustomerFinancials(fastify.prisma, workspaceId, order.customerId);

        const refreshedOrder = await fastify.prisma.order.findFirst({
          where: { id: order.id, workspaceId, deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            paidAmount: true,
            payments: {
              where: { status: 'completed' },
              select: { amount: true },
            },
          },
        });

        const orderSummary = refreshedOrder
          ? (() => {
              const paymentsSum = refreshedOrder.payments.reduce((sum, p) => sum + p.amount, 0);
              const paidAmount = Math.max(refreshedOrder.paidAmount ?? 0, paymentsSum);
              return {
                id: refreshedOrder.id,
                orderNumber: refreshedOrder.orderNumber,
                status: refreshedOrder.status,
                total: refreshedOrder.total,
                paidAmount,
                pendingAmount: Math.max(refreshedOrder.total - paidAmount, 0),
              };
            })()
          : null;

        return reply.send({
          success: true,
          applied: true,
          receiptId: receipt.id,
          extractedAmount: extractedAmount ?? null,
          order: orderSummary,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to apply receipt');
        return reply.code(500).send({
          error: 'RECEIPT_APPLY_FAILED',
          message: 'No se pudo aplicar el comprobante',
          receiptId: receipt.id,
        });
      }
    }
  );

  // Create order
  fastify.post(
    '/',
    { preHandler: [fastify.requirePermission('orders:create')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const membership = await fastify.prisma.membership.findFirst({
        where: {
          workspaceId,
          userId: request.user!.sub,
          status: { in: ['ACTIVE', 'active'] },
        },
        include: { role: { select: { name: true } } },
      });
      const planContext = await getWorkspacePlanContext(fastify.prisma, workspaceId, membership?.role?.name);
      const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planContext.plan);
      const monthlyLimit = limits.ordersPerMonth;
      if (monthlyLimit !== null) {
        const now = new Date();
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        const createdThisMonth = await fastify.prisma.order.count({
          where: {
            workspaceId,
            createdAt: { gte: start, lte: end },
          },
        });
        if (createdThisMonth >= monthlyLimit) {
          return reply.code(429).send({
            error: 'PLAN_QUOTA_EXCEEDED',
            message: `Alcanzaste el límite mensual de pedidos (${monthlyLimit}).`,
          });
        }
      }

      const body = createOrderSchema.parse(request.body);

      // Verify customer exists
      const customer = await fastify.prisma.customer.findFirst({
        where: { id: body.customerId, workspaceId },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
      }

      // Get products and calculate totals
      const productIds = body.items.map((i) => i.productId);
      const products = await fastify.prisma.product.findMany({
        where: {
          id: { in: productIds },
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
        },
        include: { stockItems: true },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Validate items and calculate totals
      type DraftOrderItem = {
        productId: string;
        variantId?: string;
        sku: string;
        name: string;
        quantity: number;
        unitPrice: number;
        total: number;
        notes?: string;
      };
      const orderItems: DraftOrderItem[] = [];
      let subtotal = 0;

      for (const item of body.items) {
        const product = productMap.get(item.productId);
        if (!product) {
          return reply.code(404).send({
            error: 'PRODUCT_NOT_FOUND',
            message: `Product ${item.productId} not found`,
          });
        }

        const unitPrice = item.unitPrice ?? product.price;
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;
        const displayName = buildProductDisplayName(product);

        orderItems.push({
          productId: product.id,
          variantId: item.variantId,
          sku: product.sku,
          name: displayName,
          quantity: item.quantity,
          unitPrice,
          total: lineTotal,
          notes: item.notes,
        });
      }

      let appliedPromotion: {
        id: string;
        name: string;
        promoType: string;
        value: number;
        startsAt: Date;
        endsAt: Date;
        status: string;
        productId: string;
      } | null = null;
      let finalDiscount = body.discount;
      let promotionMetadata: Record<string, unknown> | null = null;

      if (body.promotionId) {
        const promotion = await fastify.prisma.promotion.findFirst({
          where: {
            id: body.promotionId,
            workspaceId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            promoType: true,
            value: true,
            startsAt: true,
            endsAt: true,
            status: true,
            productId: true,
          },
        });

        if (!promotion) {
          return reply.code(404).send({
            error: 'PROMOTION_NOT_FOUND',
            message: 'La promocion seleccionada no existe',
          });
        }

        if (!promotionIsUsable(promotion)) {
          return reply.code(400).send({
            error: 'PROMOTION_NOT_ACTIVE',
            message: 'La promocion seleccionada no esta activa en este momento',
          });
        }

        const promotionDiscount = calculatePromotionDiscount({
          promotion,
          items: orderItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        });

        if (promotionDiscount.matchedSubtotal <= 0) {
          return reply.code(400).send({
            error: 'PROMOTION_NOT_APPLICABLE',
            message: 'La promocion no aplica a los productos del pedido',
          });
        }

        appliedPromotion = promotion;
        finalDiscount = promotionDiscount.discount;
        promotionMetadata = {
          id: promotion.id,
          name: promotion.name,
          promoType: promotion.promoType,
          value: promotion.value,
          matchedSubtotal: promotionDiscount.matchedSubtotal,
          discountAmount: promotionDiscount.discount,
          appliedAt: new Date().toISOString(),
        };
      }

      const total = subtotal + body.shipping - finalDiscount;
      const requestedStatus = body.status ?? 'draft';
      const status = requestedStatus === ORDER_TRASH_STATUS ? 'cancelled' : requestedStatus;
      const isCancelledOnCreate = status === 'cancelled';
      const createdInTrashReason =
        requestedStatus === ORDER_TRASH_STATUS ? 'Creado directamente en papelera' : null;
      const metadataForCreate: Record<string, unknown> = {};
      if (promotionMetadata) {
        metadataForCreate.promotion = promotionMetadata;
      }
      if (requestedStatus === ORDER_TRASH_STATUS) {
        metadataForCreate.trash = {
          isTrashed: true,
          previousStatus: null,
          trashedAt: new Date().toISOString(),
          reason: createdInTrashReason,
          ...(request.user?.sub ? { trashedBy: request.user.sub } : {}),
        };
      }
      const safePaidAmount = Math.max(0, Math.min(body.paidAmount ?? 0, total));
      const maxAttempts = 3;
      let order;
      let lastError: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const orderNumber = await generateOrderNumber(workspaceId);
        try {
          order = await fastify.prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
              data: {
                workspaceId,
                customerId: body.customerId,
                orderNumber,
                status,
                subtotal,
                shipping: body.shipping,
                discount: finalDiscount,
                total,
                promotionId: appliedPromotion?.id ?? null,
                paidAmount: safePaidAmount,
                paidAt: safePaidAmount >= total && total > 0 ? new Date() : null,
                cancelledAt: isCancelledOnCreate ? new Date() : null,
                cancelReason: createdInTrashReason,
                notes: body.notes,
                shippingAddress: body.shippingAddress,
                metadata: metadataForCreate as Prisma.InputJsonValue,
                items: {
                  create: orderItems,
                },
                statusHistory: {
                  create: {
                    newStatus: status,
                    changedBy: 'user',
                    reason: createdInTrashReason,
                  },
                },
              },
              include: {
                customer: {
                  select: { id: true, phone: true, firstName: true, lastName: true },
                },
                items: true,
                promotion: {
                  select: {
                    id: true,
                    name: true,
                    promoType: true,
                    value: true,
                  },
                },
              },
            });

            if (status !== 'cancelled') {
              for (const item of orderItems) {
                const stockItem = await tx.stockItem.findFirst({
                  where: {
                    productId: item.productId,
                    variantId: item.variantId ?? null,
                  },
                });

                if (!stockItem) {
                  throw new Error(`Stock no encontrado para ${item.name}`);
                }

                const available = stockItem.quantity - stockItem.reserved;
                if (available < item.quantity) {
                  throw new Error(
                    `Stock insuficiente para ${item.name}. Disponible: ${available}, solicitado: ${item.quantity}`
                  );
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
                    previousQty: available,
                    newQty: available - item.quantity,
                    reason: `Reserva para orden ${orderNumber}`,
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

                const lowThreshold = stockItem.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
                const availableAfter = available - item.quantity;
                if (availableAfter <= lowThreshold && availableAfter !== available) {
                  const product = productMap.get(item.productId);
                  const displayName = product ? buildProductDisplayName(product) : item.name;
                  await createNotificationIfEnabled(tx, {
                    workspaceId,
                    type: 'stock.low',
                    title: `Stock bajo: ${displayName}`,
                    message: `Quedan ${availableAfter} unidades (mínimo ${lowThreshold}).`,
                    entityType: 'Product',
                    entityId: item.productId,
                    metadata: {
                      productId: item.productId,
                      productName: displayName,
                      available: availableAfter,
                      lowThreshold,
                    },
                  });
                }
              }
            }

            if (safePaidAmount > 0) {
              await tx.payment.create({
                data: {
                  orderId: newOrder.id,
                  provider: 'manual',
                  method: body.paymentMethod ?? 'cash',
                  status: 'completed',
                  amount: safePaidAmount,
                  currency: 'ARS',
                  initiatedAt: new Date(),
                  completedAt: new Date(),
                },
              });
            }

            return newOrder;
          });
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const target = error.meta?.target;
            const isOrderNumberCollision =
              (Array.isArray(target) && target.includes('orderNumber')) || target === 'orderNumber';
            if (isOrderNumberCollision && attempt < maxAttempts - 1) {
              continue;
            }
          }
          throw error;
        }
      }

      if (!order) {
        const message = lastError instanceof Error ? lastError.message : 'Error al crear el pedido';
        return reply.code(400).send({ error: 'ORDER_CREATE_FAILED', message });
      }

      await recalcCustomerFinancials(fastify.prisma, workspaceId, body.customerId);

      try {
        await createNotificationIfEnabled(fastify.prisma, {
          workspaceId,
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
      } catch (error) {
        request.log.error({ error }, 'Failed to create order notification');
      }

      return reply.code(201).send({
        order: {
          ...order,
          hasPromotion: !!order.promotionId,
          isTrashed: orderIsInTrash(order.status, order.metadata),
          trashReason: resolveTrashReason(order.cancelReason, order.metadata),
          trash: parseOrderTrashMetadata(order.metadata),
        },
      });
    }
  );

  // Update order
  fastify.patch(
    '/:id',
    { preHandler: [fastify.requirePermission('orders:update')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = orderIdParamsSchema.parse(request.params);
      const body = updateOrderSchema.parse(request.body);

      // Check order exists
      const existing = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          items: {
            select: {
              productId: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const baseMetadata = asOrderMetadataRecord(existing.metadata);
      let mergedMetadata: Record<string, unknown> | null = null;
      let finalDiscount = body.discount ?? existing.discount;
      let promotionIdForOrder = body.promotionId !== undefined ? body.promotionId : existing.promotionId;
      let promotionSnapshot: Record<string, unknown> | null = null;

      if (body.promotionId !== undefined) {
        if (body.promotionId === null) {
          if (body.discount === undefined) {
            finalDiscount = 0;
          }
          promotionIdForOrder = null;
          promotionSnapshot = null;
        } else {
          const promotion = await fastify.prisma.promotion.findFirst({
            where: {
              id: body.promotionId,
              workspaceId,
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
              promoType: true,
              value: true,
              startsAt: true,
              endsAt: true,
              status: true,
              productId: true,
            },
          });

          if (!promotion) {
            return reply.code(404).send({
              error: 'PROMOTION_NOT_FOUND',
              message: 'La promocion seleccionada no existe',
            });
          }

          if (!promotionIsUsable(promotion)) {
            return reply.code(400).send({
              error: 'PROMOTION_NOT_ACTIVE',
              message: 'La promocion seleccionada no esta activa en este momento',
            });
          }

          const promoDiscount = calculatePromotionDiscount({
            promotion,
            items: existing.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          });

          if (promoDiscount.matchedSubtotal <= 0) {
            return reply.code(400).send({
              error: 'PROMOTION_NOT_APPLICABLE',
              message: 'La promocion no aplica a los productos del pedido',
            });
          }

          finalDiscount = promoDiscount.discount;
          promotionIdForOrder = promotion.id;
          promotionSnapshot = {
            id: promotion.id,
            name: promotion.name,
            promoType: promotion.promoType,
            value: promotion.value,
            matchedSubtotal: promoDiscount.matchedSubtotal,
            discountAmount: promoDiscount.discount,
            appliedAt: new Date().toISOString(),
          };
        }
      }

      // Build update data
      const updateData: Prisma.OrderUncheckedUpdateInput = {};
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.internalNotes !== undefined) updateData.internalNotes = body.internalNotes;
      if (body.shippingAddress !== undefined) {
        updateData.shippingAddress = body.shippingAddress as Prisma.InputJsonValue;
      }
      const nextShipping = body.shipping ?? existing.shipping;
      const shippingChanged = body.shipping !== undefined && body.shipping !== existing.shipping;
      const discountChanged = body.discount !== undefined || body.promotionId !== undefined;
      if (shippingChanged) {
        updateData.shipping = nextShipping;
      }
      if (discountChanged) {
        updateData.discount = finalDiscount;
      }
      if (body.promotionId !== undefined) {
        updateData.promotionId = promotionIdForOrder;
        mergedMetadata = {
          ...baseMetadata,
          promotion: promotionSnapshot,
        };
      }
      if (shippingChanged || discountChanged) {
        updateData.total = existing.subtotal + nextShipping - finalDiscount;
      }
      const normalizedCancelReason =
        typeof body.cancelReason === 'string' ? body.cancelReason.trim() : '';
      const cancelReasonInput =
        body.cancelReason !== undefined ? (normalizedCancelReason.length > 0 ? normalizedCancelReason : null) : undefined;
      const isTrashAction = body.status === ORDER_TRASH_STATUS;
      const statusTarget = body.status ? (isTrashAction ? 'cancelled' : body.status) : null;
      const statusChanged = !!statusTarget && statusTarget !== existing.status;
      const hasContentEdits = body.notes !== undefined
        || body.internalNotes !== undefined
        || body.shippingAddress !== undefined
        || body.shipping !== undefined
        || body.discount !== undefined
        || body.promotionId !== undefined
        || body.cancelReason !== undefined;

      if (body.cancelReason !== undefined && !isTrashAction) {
        updateData.cancelReason = cancelReasonInput;
      }

      if (isTrashAction) {
        const trashReason = cancelReasonInput;
        if (!trashReason || trashReason.trim().length < 3) {
          return reply.code(400).send({
            error: 'MISSING_TRASH_REASON',
            message: 'Debes indicar un motivo para cancelar y enviar el pedido a la papelera',
          });
        }

        const metadataBase = mergedMetadata || baseMetadata;
        mergedMetadata = {
          ...metadataBase,
          trash: {
            isTrashed: true,
            previousStatus: existing.status,
            trashedAt: new Date().toISOString(),
            reason: trashReason,
            ...(request.user?.sub ? { trashedBy: request.user.sub } : {}),
          },
        };

        updateData.status = 'cancelled';
        updateData.cancelReason = trashReason;
        if (!existing.cancelledAt) {
          updateData.cancelledAt = new Date();
        }

        await fastify.prisma.orderStatusHistory.create({
          data: {
            orderId: id,
            previousStatus: existing.status,
            newStatus: 'cancelled',
            changedBy: 'user',
            reason: `Enviado a papelera: ${trashReason}`,
          },
        });
      } else if (statusChanged && statusTarget) {
        updateData.status = statusTarget;

        await fastify.prisma.orderStatusHistory.create({
          data: {
            orderId: id,
            previousStatus: existing.status,
            newStatus: statusTarget,
            changedBy: 'user',
            reason: cancelReasonInput ?? null,
          },
        });

        if (statusTarget === 'paid') updateData.paidAt = new Date();
        if (statusTarget === 'shipped') updateData.shippedAt = new Date();
        if (statusTarget === 'delivered') updateData.deliveredAt = new Date();
        if (statusTarget === 'cancelled') {
          updateData.cancelledAt = new Date();
          if (cancelReasonInput !== undefined) {
            updateData.cancelReason = cancelReasonInput;
          }
        }
      }

      if (mergedMetadata) {
        updateData.metadata = mergedMetadata as Prisma.InputJsonValue;
      }

      await fastify.prisma.order.update({
        where: { id },
        data: updateData,
      });

      const order = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          customer: { select: { id: true, phone: true, firstName: true, lastName: true } },
          items: true,
          payments: true,
          promotion: {
            select: {
              id: true,
              name: true,
              promoType: true,
              value: true,
            },
          },
        },
      });
      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      await recalcCustomerFinancials(fastify.prisma, workspaceId, existing.customerId);

      const cancelReasonForNotifications = resolveTrashReason(order.cancelReason, order.metadata);
      const orderWasCancelled = isTrashAction || (statusChanged && statusTarget === 'cancelled');
      let customerNotificationSent = false;
      let customerNotificationError: string | null = null;

      if (orderWasCancelled) {
        try {
          await createNotificationIfEnabled(fastify.prisma, {
            workspaceId,
            type: 'order.cancelled',
            title: 'Pedido cancelado',
            message: cancelReasonForNotifications
              ? `Pedido ${order.orderNumber} cancelado. Motivo: ${cancelReasonForNotifications}`
              : `Pedido ${order.orderNumber} cancelado`,
            entityType: 'Order',
            entityId: order.id,
            metadata: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              sessionId: null,
              reason: cancelReasonForNotifications,
            },
          });
        } catch (error) {
          request.log.error({ error }, 'Failed to create order cancelled notification');
        }

        if (isTrashAction && order.customer?.phone && cancelReasonForNotifications) {
          try {
            await notifyCustomerOrderCancelled({
              workspaceId,
              customerPhone: order.customer.phone,
              orderNumber: order.orderNumber,
              reason: cancelReasonForNotifications,
            });
            customerNotificationSent = true;
          } catch (error) {
            customerNotificationError = error instanceof Error ? error.message : 'NOTIFICATION_SEND_FAILED';
            request.log.warn(
              { error, workspaceId, orderId: order.id, customerId: order.customerId },
              'Failed to notify customer about order cancellation'
            );
          }
        }
      } else if (hasContentEdits) {
        try {
          await createNotificationIfEnabled(fastify.prisma, {
            workspaceId,
            type: 'order.edited',
            title: 'Pedido editado',
            message: `Pedido ${order.orderNumber} actualizado`,
            entityType: 'Order',
            entityId: order.id,
            metadata: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              sessionId: null,
            },
          });
        } catch (error) {
          request.log.error({ error }, 'Failed to create order edited notification');
        }
      }

      const trash = parseOrderTrashMetadata(order.metadata);
      return reply.send({
        order: {
          ...order,
          hasPromotion: !!order.promotionId,
          isTrashed: orderIsInTrash(order.status, order.metadata),
          trashReason: resolveTrashReason(order.cancelReason, order.metadata),
          trash,
        },
        customerNotification: isTrashAction
          ? {
              attempted: true,
              sent: customerNotificationSent,
              error: customerNotificationError,
            }
          : null,
      });
    }
  );

  // Restore order from trash
  fastify.post(
    '/:id/restore',
    { preHandler: [fastify.requirePermission('orders:update')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = orderIdParamsSchema.parse(request.params);

      const existing = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const isCurrentlyTrashed = orderIsInTrash(existing.status, existing.metadata);
      if (!isCurrentlyTrashed) {
        return reply.code(400).send({
          error: 'ORDER_NOT_IN_TRASH',
          message: 'El pedido no está en la papelera',
        });
      }

      const metadata = asOrderMetadataRecord(existing.metadata);
      const trashMetadata = parseOrderTrashMetadata(existing.metadata);
      const nextMetadata: Record<string, unknown> = { ...metadata };
      delete nextMetadata.trash;
      const restoredReason = resolveTrashReason(existing.cancelReason, existing.metadata);

      const updated = await fastify.prisma.order.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: existing.cancelledAt ?? new Date(),
          cancelReason: restoredReason,
          metadata: nextMetadata as Prisma.InputJsonValue,
        },
      });

      await fastify.prisma.orderStatusHistory.create({
        data: {
          orderId: id,
          previousStatus: existing.status,
          newStatus: 'cancelled',
          changedBy: 'user',
          reason: trashMetadata?.reason
            ? `Restaurado desde papelera (motivo original: ${trashMetadata.reason})`
            : 'Restaurado desde papelera',
        },
      });

      await recalcCustomerFinancials(fastify.prisma, workspaceId, existing.customerId);

      return reply.send({
        order: {
          ...updated,
          isTrashed: false,
          trashReason: null,
          trash: null,
        },
      });
    }
  );

  // Delete order (soft delete)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.requirePermission('orders:cancel')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = orderIdParamsSchema.parse(request.params);

      const existing = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      // Only allow deletion of draft/cancelled orders
      if (!['draft', 'cancelled'].includes(existing.status)) {
        return reply.code(400).send({
          error: 'CANNOT_DELETE',
          message: 'Only draft or cancelled orders can be deleted',
        });
      }

      await fastify.prisma.order.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return reply.send({ success: true });
    }
  );

  // Empty trash disabled: orders are no longer hard-deleted from trash.
  fastify.delete(
    '/trash',
    { preHandler: [fastify.requirePermission('orders:cancel')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      return reply.code(410).send({
        error: 'TRASH_HARD_DELETE_DISABLED',
        message: 'Vaciar papelera fue deshabilitado. Los pedidos en papelera se conservan como cancelados.',
      });
    }
  );

  // Get order by number
  fastify.get(
    '/by-number/:orderNumber',
    { preHandler: [fastify.requirePermission('orders:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { orderNumber } = request.params as { orderNumber: string };

      const order = await fastify.prisma.order.findFirst({
        where: { orderNumber, workspaceId, deletedAt: null },
        include: {
          customer: {
            select: { id: true, phone: true, firstName: true, lastName: true },
          },
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
          promotion: {
            select: {
              id: true,
              name: true,
              promoType: true,
              value: true,
              startsAt: true,
              endsAt: true,
              status: true,
            },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const paidAmount = order.payments
        .filter((p) => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);

      return reply.send({
        order: {
          ...order,
          hasPromotion: !!order.promotionId,
          paidAmount,
          pendingAmount: order.total - paidAmount,
          isTrashed: orderIsInTrash(order.status, order.metadata),
          trashReason: resolveTrashReason(order.cancelReason, order.metadata),
          trash: parseOrderTrashMetadata(order.metadata),
        },
      });
    }
  );
};
