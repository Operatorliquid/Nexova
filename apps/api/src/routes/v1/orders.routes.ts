/**
 * Orders Routes
 * CRUD operations for order management
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrderReceiptPdfService, LedgerService } from '@nexova/core';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { recalcCustomerFinancials } from '../../utils/customer-financials.js';
import { extractReceiptAmountWithClaude, parseAmountInputToCents } from '../../utils/receipt-claude.js';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
const RECEIPTS_DIR = path.join(UPLOAD_DIR, 'receipts');
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

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

const buildSecondarySuffix = (unit?: string | null, value?: string | null) => {
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
}) => {
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

  // Get orders list
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
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

      const query = orderQuerySchema.parse(request.query);
      const { search, status, customerId, limit, offset, sortBy, sortOrder, from, to, includeTrashed } = query;
      const paymentFilters = ['pending_payment', 'partial_payment', 'paid'] as const;
      const isPaymentFilter = status ? paymentFilters.includes(status as any) : false;

      // Build where clause
      const where: any = { workspaceId, deletedAt: null };

      if (!status && !includeTrashed) {
        where.status = { not: 'trashed' };
      }
      if (isPaymentFilter && !includeTrashed) {
        where.status = { not: 'trashed' };
      }

      if (status && !isPaymentFilter) {
        if (status === 'trashed') {
          where.status = 'trashed';
        } else if (status === 'awaiting_acceptance') {
          where.status = { in: ['awaiting_acceptance', 'draft'] };
        } else if (status === 'accepted') {
          where.status = {
            in: [
              'accepted',
              'processing',
              'shipped',
              'delivered',
              'confirmed',
              'preparing',
              'ready',
              'paid',
              'pending_invoicing',
              'invoiced',
              'invoice_cancelled',
            ],
          };
        } else if (status === 'cancelled') {
          where.status = { in: ['cancelled', 'returned'] };
        } else {
          where.status = status;
        }
      }

      if (customerId) {
        where.customerId = customerId;
      }

      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = from;
        if (to) where.createdAt.lte = to;
      }

      if (search) {
        where.OR = [
          { orderNumber: { contains: search, mode: 'insensitive' } },
          { customer: { phone: { contains: search } } },
          { customer: { firstName: { contains: search, mode: 'insensitive' } } },
          { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        ];
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
          },
        }),
        isPaymentFilter ? Promise.resolve(0) : fastify.prisma.order.count({ where }),
      ]);

      // Format response
      const formattedOrders = orders.map((o) => {
        const paymentsSum = o.payments.reduce((sum, p) => sum + p.amount, 0);
        const paidAmount = Math.max(o.paidAmount ?? 0, paymentsSum);
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          customer: {
            id: o.customer.id,
            phone: o.customer.phone,
            name: o.customer.firstName && o.customer.lastName
              ? `${o.customer.firstName} ${o.customer.lastName}`
              : o.customer.firstName || o.customer.lastName || o.customer.phone,
          },
          itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
          subtotal: o.subtotal,
          shipping: o.shipping,
          discount: o.discount,
          total: o.total,
          paidAmount,
          pendingAmount: o.total - paidAmount,
          notes: o.notes,
          items: o.items,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        };
      });

      const matchesPaymentFilter = (order: any, filter: string) => {
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
        ? formattedOrders.filter((o) => matchesPaymentFilter(o, status))
        : formattedOrders;

      const pagedOrders = isPaymentFilter
        ? filteredOrders.slice(offset, offset + limit)
        : filteredOrders;
      const totalCount = isPaymentFilter ? filteredOrders.length : total;

      reply.send({
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
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
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
            status: { notIn: ['cancelled', 'returned'] },
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

      reply.send({
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
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

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
        },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const paymentsSum = order.payments
        .filter((p) => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);
      const paidAmount = Math.max(order.paidAmount ?? 0, paymentsSum);

      reply.send({
        order: {
          ...order,
          paidAmount,
          pendingAmount: order.total - paidAmount,
        },
      });
    }
  );

  // Generate receipt PDF
  fastify.get(
    '/:id/receipt',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

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

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${receipt.filename}"`)
        .send(receipt.buffer);
    }
  );

  // Upload manual receipt and optionally apply to order
  fastify.post(
    '/:id/receipts',
    { preHandler: [fastify.authenticate] },
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

      const { id } = request.params as { id: string };
      const order = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, orderNumber: true, customerId: true, total: true, paidAmount: true },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const normalizePaymentMethod = (raw?: string) => {
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

        let receipt = await fastify.prisma.receipt.create({
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
    { preHandler: [fastify.authenticate] },
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
      const orderItems: any[] = [];
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

      const total = subtotal + body.shipping - body.discount;
      const status = body.status ?? 'draft';
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
                discount: body.discount,
                total,
                paidAmount: safePaidAmount,
                paidAt: safePaidAmount >= total && total > 0 ? new Date() : null,
                notes: body.notes,
                shippingAddress: body.shippingAddress,
                items: {
                  create: orderItems,
                },
                statusHistory: {
                  create: {
                    newStatus: status,
                    changedBy: 'user',
                  },
                },
              },
              include: {
                customer: {
                  select: { id: true, phone: true, firstName: true, lastName: true },
                },
                items: true,
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
        reply.code(400).send({ error: 'ORDER_CREATE_FAILED', message });
        return;
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

      reply.code(201).send({ order });
    }
  );

  // Update order
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const body = updateOrderSchema.parse(request.body);

      // Check order exists
      const existing = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      // Build update data
      const updateData: any = {};
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.internalNotes !== undefined) updateData.internalNotes = body.internalNotes;
      if (body.shippingAddress !== undefined) updateData.shippingAddress = body.shippingAddress;
      if (body.shipping !== undefined) {
        updateData.shipping = body.shipping;
        updateData.total = existing.subtotal + body.shipping - (body.discount ?? existing.discount);
      }
      if (body.discount !== undefined) {
        updateData.discount = body.discount;
        updateData.total = existing.subtotal + (body.shipping ?? existing.shipping) - body.discount;
      }
      const statusChanged = !!body.status && body.status !== existing.status;
      const hasContentEdits = body.notes !== undefined
        || body.internalNotes !== undefined
        || body.shippingAddress !== undefined
        || body.shipping !== undefined
        || body.discount !== undefined;

      // Handle status change
      if (statusChanged && body.status) {
        updateData.status = body.status;

        // Record status history
        await fastify.prisma.orderStatusHistory.create({
          data: {
            orderId: id,
            previousStatus: existing.status,
            newStatus: body.status,
            changedBy: 'user',
          },
        });

        if (body.status === 'trashed') {
          const metadata = (existing.metadata as Record<string, any>) || {};
          updateData.metadata = {
            ...metadata,
            trash: {
              previousStatus: existing.status,
              trashedAt: new Date().toISOString(),
            },
          };
        }

        // Update timestamps based on status
        if (body.status === 'paid') updateData.paidAt = new Date();
        if (body.status === 'shipped') updateData.shippedAt = new Date();
        if (body.status === 'delivered') updateData.deliveredAt = new Date();
        if (body.status === 'cancelled') updateData.cancelledAt = new Date();
      }

      await fastify.prisma.order.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: updateData,
      });

      const order = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          customer: { select: { id: true, phone: true, firstName: true, lastName: true } },
          items: true,
          payments: true,
        },
      });
      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      await recalcCustomerFinancials(fastify.prisma, workspaceId, existing.customerId);

      if (statusChanged && body.status === 'cancelled') {
        try {
          await createNotificationIfEnabled(fastify.prisma, {
            workspaceId,
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
            },
          });
        } catch (error) {
          request.log.error({ error }, 'Failed to create order cancelled notification');
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

      reply.send({ order });
    }
  );

  // Restore order from trash
  fastify.post(
    '/:id/restore',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.order.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const metadata = (existing.metadata as Record<string, any>) || {};
      const previousStatus = metadata?.trash?.previousStatus || 'awaiting_acceptance';

      const updated = await fastify.prisma.order.update({
        where: { id },
        data: {
          status: previousStatus,
          metadata: {
            ...metadata,
            trash: null,
          },
        },
      });

      await fastify.prisma.orderStatusHistory.create({
        data: {
          orderId: id,
          previousStatus: existing.status,
          newStatus: previousStatus,
          changedBy: 'user',
          reason: 'Restaurado desde papelera',
        },
      });

      await recalcCustomerFinancials(fastify.prisma, workspaceId, existing.customerId);

      reply.send({ order: updated });
    }
  );

  // Delete order (soft delete)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

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

      await fastify.prisma.order.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      reply.send({ success: true });
    }
  );

  // Empty trash (hard delete)
  fastify.delete(
    '/trash',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      await fastify.prisma.order.updateMany({
        where: { workspaceId, deletedAt: null, status: 'trashed' },
        data: { deletedAt: new Date() },
      });

      reply.send({ success: true });
    }
  );

  // Get order by number
  fastify.get(
    '/by-number/:orderNumber',
    { preHandler: [fastify.authenticate] },
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
        },
      });

      if (!order) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const paidAmount = order.payments
        .filter((p) => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);

      reply.send({
        order: {
          ...order,
          paidAmount,
          pendingAmount: order.total - paidAmount,
        },
      });
    }
  );
};
