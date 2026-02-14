/**
 * Customers Routes
 * CRUD operations for customer management
 */
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  debtIgnoredStatuses,
  computePaymentScore,
  recalcCustomerFinancials,
} from '../../utils/customer-financials.js';
import { LedgerService, decrypt } from '@nexova/core';
import { EvolutionClient, InfobipClient } from '@nexova/integrations/whatsapp';
import { z } from 'zod';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getMonthlyUsage, recordMonthlyUsage } from '../../utils/monthly-usage.js';
import { COMMERCE_USAGE_METRICS } from '@nexova/shared';

type DebtStats = {
  debt: number;
  paidCount: number;
  unpaidCount: number;
  oldestUnpaidAt?: Date;
};

const normalizePhone = (phone: string): string => {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  return `+${digits}`;
};

const customerQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  sortBy: z.enum(['firstName', 'lastName', 'lastSeenAt', 'orderCount', 'totalSpent', 'createdAt']).default('lastSeenAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const updateCustomerSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  notes: z.string().max(2000).optional(),
  dni: z.string().max(20).optional(),
  cuit: z.string().max(20).optional(),
  businessName: z.string().max(255).optional(),
  fiscalAddress: z.string().max(500).optional(),
  vatCondition: z.string().max(50).optional(),
});

const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(6).max(20),
  dni: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  cuit: z.string().max(20).optional().or(z.literal('')),
  businessName: z.string().max(255).optional().or(z.literal('')),
  fiscalAddress: z.string().max(500).optional().or(z.literal('')),
  vatCondition: z.string().max(50).optional().or(z.literal('')),
});


export const customersRoutes: FastifyPluginAsync = async (fastify) => {
  const ledgerService = new LedgerService(fastify.prisma);

  const resolveWhatsAppApiKey = (number: { apiKeyEnc?: string | null; apiKeyIv?: string | null }): string => {
    const provider = ((number as { provider?: string | null }).provider || 'infobip').toLowerCase();
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

    if (cleaned && cleaned.toLowerCase() !== defaultUrl) {
      return cleaned;
    }
    if (envUrl) {
      return envUrl;
    }
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

  const formatMoney = (cents: number): string =>
    new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const buildDebtReminderMessage = (params: {
    name?: string | null;
    totalDebt: number;
    orders: Array<{ orderNumber: string; pendingAmount: number }>;
  }): string => {
    const { name, totalDebt, orders } = params;
    const greeting = name ? `Hola ${name},` : 'Hola,';
    const orderLines = orders.map((order) => `• Pedido ${order.orderNumber}: $${formatMoney(order.pendingAmount)}`);
    return [
      `${greeting} tenés una deuda pendiente de $${formatMoney(totalDebt)}.`,
      'Corresponde a:',
      ...orderLines,
      '',
      'Si ya pagaste, enviá el comprobante para actualizar tu cuenta.',
    ].join('\n');
  };
  // Get customers list
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = customerQuerySchema.parse(request.query);
      const { search, status, limit, offset, sortBy, sortOrder } = query;

      // Build where clause (exclude soft-deleted)
      const where: any = { workspaceId, deletedAt: null };

      if (status) {
        where.status = status;
      }

      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
          { cuit: { contains: search } },
          { businessName: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Get customers with pagination
      const [customers, total] = await Promise.all([
        fastify.prisma.customer.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: offset,
          take: limit,
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
            status: true,
            orderCount: true,
            totalSpent: true,
            currentBalance: true,
            paymentScore: true,
            debtReminderCount: true,
            firstSeenAt: true,
            lastSeenAt: true,
            metadata: true,
            createdAt: true,
          },
        }),
        fastify.prisma.customer.count({ where }),
      ]);

      const customerIds = customers.map((c) => c.id);
      const orderStatsMap = new Map<string, DebtStats>();
      const now = new Date();

      if (customerIds.length > 0) {
        const orders = await fastify.prisma.order.findMany({
          where: {
            workspaceId,
            customerId: { in: customerIds },
            status: { notIn: [...debtIgnoredStatuses] },
          },
          select: {
            customerId: true,
            total: true,
            paidAmount: true,
            createdAt: true,
          },
        });

	        for (const order of orders) {
	          const current: DebtStats = orderStatsMap.get(order.customerId) || {
	            debt: 0,
	            paidCount: 0,
	            unpaidCount: 0,
	          };
	          const pending = Math.max(0, order.total - (order.paidAmount || 0));
	          if (pending > 0) {
	            current.debt += pending;
	            current.unpaidCount += 1;
	            if (!current.oldestUnpaidAt || order.createdAt < current.oldestUnpaidAt) {
              current.oldestUnpaidAt = order.createdAt;
            }
          } else {
            current.paidCount += 1;
          }
          orderStatsMap.set(order.customerId, current);
        }
      }

      // Format response (convert BigInt to Number for JSON serialization)
      const updates: Promise<any>[] = [];

      const formattedCustomers = customers.map((c) => {
        const metadata = (c.metadata as Record<string, unknown>) || {};
        const stats = orderStatsMap.get(c.id) || { debt: 0, paidCount: 0, unpaidCount: 0 };
        const debtDays = stats.oldestUnpaidAt
          ? Math.floor((now.getTime() - stats.oldestUnpaidAt.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const computedScore = computePaymentScore({
          debt: stats.debt,
          debtReminderCount: c.debtReminderCount || 0,
          orderCount: c.orderCount,
          paidCount: stats.paidCount,
          unpaidCount: stats.unpaidCount,
        });

        if (stats.debt !== c.currentBalance || computedScore !== c.paymentScore) {
          updates.push(
            fastify.prisma.customer.updateMany({
              where: { id: c.id, workspaceId },
              data: {
                currentBalance: stats.debt,
                paymentScore: computedScore,
              },
            })
          );
        }

        return {
          id: c.id,
          phone: c.phone,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          cuit: c.cuit,
          businessName: c.businessName,
          fiscalAddress: c.fiscalAddress,
          vatCondition: c.vatCondition,
          fullName: c.firstName && c.lastName
            ? `${c.firstName} ${c.lastName}`
            : c.firstName || c.lastName || null,
          status: c.status,
          orderCount: c.orderCount,
          totalSpent: Number(c.totalSpent), // BigInt -> Number
          currentBalance: stats.debt, // Debt derived from unpaid orders
          debtDays,
          paymentScore: computedScore,
          dni: metadata.dni as string | undefined,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
          createdAt: c.createdAt,
        };
      });

      if (updates.length > 0) {
        await Promise.all(updates);
      }

      reply.send({
        customers: formattedCustomers,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    }
  );

  // Get unpaid orders for customer
  fastify.get<{ Params: { id: string } }>(
    '/:id/unpaid-orders',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params;
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const orders = await ledgerService.getUnpaidOrders(workspaceId, id);
      return reply.send({ orders });
    }
  );

  // Send debt reminder to a customer
  fastify.post<{ Params: { id: string } }>(
    '/:id/debt-reminder',
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
      if (!planContext.capabilities.showDebtsModule) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de deudas',
        });
      }

      const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planContext.plan);
      const monthlyLimit = limits.debtRemindersPerMonth;
      if (monthlyLimit !== null) {
        const used = await getMonthlyUsage(fastify.prisma, {
          workspaceId,
          metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
        });
        if (used >= BigInt(monthlyLimit)) {
          return reply.code(429).send({
            error: 'PLAN_QUOTA_EXCEEDED',
            message: `Alcanzaste el límite mensual de recordatorios de deuda (${monthlyLimit}).`,
          });
        }
      }

      const { id } = request.params;
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true, phone: true, firstName: true, lastName: true },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const orders = await ledgerService.getUnpaidOrders(workspaceId, id);
      if (orders.length === 0) {
        return reply.code(400).send({ error: 'NO_DEBT', message: 'Customer has no pending debt' });
      }

      const whatsappNumber = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
        select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true, providerConfig: true },
      });

      if (!whatsappNumber) {
        return reply.code(400).send({ error: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp not configured' });
      }

      const apiKey = resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        return reply.code(400).send({ error: 'WHATSAPP_API_KEY_MISSING', message: 'WhatsApp API key missing' });
      }

      const totalDebt = orders.reduce((sum, order) => sum + order.pendingAmount, 0);
      const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || null;
      const message = buildDebtReminderMessage({
        name,
        totalDebt,
        orders: orders.map((o) => ({ orderNumber: o.orderNumber, pendingAmount: o.pendingAmount })),
      });

      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();
      if (provider === 'evolution') {
        const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
        const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
        if (!baseUrl || !instanceName) {
          return reply.code(400).send({ error: 'EVOLUTION_NOT_CONFIGURED', message: 'Evolution not configured' });
        }
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        await client.sendText(normalizePhone(customer.phone), message);
      } else {
        const client = new InfobipClient({
          apiKey,
          baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
          senderNumber: whatsappNumber.phoneNumber,
        });
        await client.sendText(normalizePhone(customer.phone), message);
      }
      await recordMonthlyUsage(fastify.prisma, {
        workspaceId,
        metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
        quantity: 1,
        metadata: { source: 'customers.debt_reminder' },
      });

      await fastify.prisma.customer.updateMany({
        where: { id: customer.id, workspaceId },
        data: {
          debtReminderCount: { increment: 1 },
          lastDebtReminderAt: new Date(),
        },
      });

      return reply.send({ success: true, sent: true, orders: orders.length });
    }
  );

  // Send debt reminders to all debtors
  fastify.post(
    '/debt-reminders/bulk',
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
      if (!planContext.capabilities.showDebtsModule) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de deudas',
        });
      }

      const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planContext.plan);
      const monthlyLimit = limits.debtRemindersPerMonth;
      let remaining = Number.MAX_SAFE_INTEGER;
      if (monthlyLimit !== null) {
        const used = await getMonthlyUsage(fastify.prisma, {
          workspaceId,
          metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
        });
        remaining = Math.max(0, monthlyLimit - Number(used));
        if (remaining <= 0) {
          return reply.code(429).send({
            error: 'PLAN_QUOTA_EXCEEDED',
            message: `Alcanzaste el límite mensual de recordatorios de deuda (${monthlyLimit}).`,
          });
        }
      }

      const whatsappNumber = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
        select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true, providerConfig: true },
      });

      if (!whatsappNumber) {
        return reply.code(400).send({ error: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp not configured' });
      }

      const apiKey = resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        return reply.code(400).send({ error: 'WHATSAPP_API_KEY_MISSING', message: 'WhatsApp API key missing' });
      }

      const customers = await fastify.prisma.customer.findMany({
        where: { workspaceId, deletedAt: null, currentBalance: { gt: 0 } },
        select: { id: true, phone: true, firstName: true, lastName: true },
      });

      if (customers.length === 0) {
        return reply.send({ success: true, sent: 0, failed: 0, total: 0 });
      }

      const customerIds = customers.map((c) => c.id);
      const orders = await fastify.prisma.order.findMany({
        where: {
          workspaceId,
          customerId: { in: customerIds },
          deletedAt: null,
          status: { notIn: ['cancelled', 'draft'] },
          OR: [
            { paidAt: null },
            {
              AND: [{ paidAmount: { lt: fastify.prisma.order.fields.total } }],
            },
          ],
        },
        select: {
          customerId: true,
          orderNumber: true,
          total: true,
          paidAmount: true,
        },
      });

      const ordersByCustomer = new Map<string, Array<{ orderNumber: string; pendingAmount: number }>>();
      orders.forEach((order) => {
        const pending = order.total - order.paidAmount;
        if (pending <= 0) return;
        const list = ordersByCustomer.get(order.customerId) || [];
        list.push({ orderNumber: order.orderNumber, pendingAmount: pending });
        ordersByCustomer.set(order.customerId, list);
      });

      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();
      const sender =
        provider === 'evolution'
          ? (() => {
              const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
              const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
              if (!baseUrl || !instanceName) {
                throw new Error('Evolution not configured (baseUrl/instanceName missing)');
              }
              return new EvolutionClient({ apiKey, baseUrl, instanceName });
            })()
          : new InfobipClient({
              apiKey,
              baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
              senderNumber: whatsappNumber.phoneNumber,
            });

      let sent = 0;
      let failed = 0;
      const updatedIds: string[] = [];

      for (const customer of customers) {
        if (sent >= remaining) break;
        const customerOrders = ordersByCustomer.get(customer.id) || [];
        if (customerOrders.length === 0) continue;
        const totalDebt = customerOrders.reduce((sum, order) => sum + order.pendingAmount, 0);
        const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || null;
        const message = buildDebtReminderMessage({
          name,
          totalDebt,
          orders: customerOrders,
        });

        try {
          await sender.sendText(normalizePhone(customer.phone), message);
          sent += 1;
          updatedIds.push(customer.id);
        } catch (error) {
          failed += 1;
          fastify.log.error(error, 'Failed to send bulk debt reminder');
        }
      }

      if (updatedIds.length > 0) {
        await fastify.prisma.customer.updateMany({
          where: { workspaceId, id: { in: updatedIds } },
          data: {
            debtReminderCount: { increment: 1 },
            lastDebtReminderAt: new Date(),
          },
        });
      }

      if (sent > 0) {
        await recordMonthlyUsage(fastify.prisma, {
          workspaceId,
          metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
          quantity: sent,
          metadata: { source: 'customers.debt_reminders.bulk' },
        });
      }

      return reply.send({ success: true, sent, failed, total: customers.length });
    }
  );

  // Create customer (manual)
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const body = createCustomerSchema.parse(request.body);
      const name = body.name.trim();
      const phone = normalizePhone(body.phone);
      const dni = typeof body.dni === 'string' && body.dni.trim() ? body.dni.trim() : undefined;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : undefined;
      const cuit = typeof body.cuit === 'string' && body.cuit.trim() ? body.cuit.trim() : undefined;
      const businessName = typeof body.businessName === 'string' && body.businessName.trim()
        ? body.businessName.trim()
        : undefined;
      const fiscalAddress = typeof body.fiscalAddress === 'string' && body.fiscalAddress.trim()
        ? body.fiscalAddress.trim()
        : undefined;
      const vatCondition = typeof body.vatCondition === 'string' && body.vatCondition.trim()
        ? body.vatCondition.trim()
        : undefined;

      const nameParts = name.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0]?.slice(0, 100) || null;
      const lastName = nameParts.slice(1).join(' ').slice(0, 100) || null;

	      const metadata: Prisma.InputJsonValue = dni ? { dni } : {};

      let createdCustomer;
      try {
        createdCustomer = await fastify.prisma.customer.create({
          data: {
            workspaceId,
            phone,
            email: email || null,
            firstName,
            lastName,
            cuit: cuit || null,
            businessName: businessName || null,
            fiscalAddress: fiscalAddress || null,
            vatCondition: vatCondition || null,
            status: 'active',
            metadata,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          return reply.code(409).send({ error: 'DUPLICATE_PHONE', message: 'Ese telefono ya existe' });
        }
        throw error;
      }

      try {
        await createNotificationIfEnabled(fastify.prisma, {
          workspaceId,
          type: 'customer.new',
          title: 'Nuevo cliente',
          message: `Cliente ${name} registrado`,
          entityType: 'Customer',
          entityId: createdCustomer.id,
          metadata: {
            customerId: createdCustomer.id,
            phone: createdCustomer.phone,
            name,
            sessionId: null,
          },
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to create customer notification');
      }

      const responseMetadata = (createdCustomer.metadata as Record<string, unknown>) || {};
      reply.send({
        customer: {
          id: createdCustomer.id,
          phone: createdCustomer.phone,
          email: createdCustomer.email,
          firstName: createdCustomer.firstName,
          lastName: createdCustomer.lastName,
          fullName: createdCustomer.firstName && createdCustomer.lastName
            ? `${createdCustomer.firstName} ${createdCustomer.lastName}`
            : createdCustomer.firstName || createdCustomer.lastName || null,
          status: createdCustomer.status,
          orderCount: createdCustomer.orderCount,
          totalSpent: Number(createdCustomer.totalSpent),
          currentBalance: createdCustomer.currentBalance,
          paymentScore: createdCustomer.paymentScore,
          dni: responseMetadata.dni as string | undefined,
          cuit: createdCustomer.cuit || undefined,
          businessName: createdCustomer.businessName || undefined,
          fiscalAddress: createdCustomer.fiscalAddress || undefined,
          vatCondition: createdCustomer.vatCondition || undefined,
          firstSeenAt: createdCustomer.firstSeenAt,
          lastSeenAt: createdCustomer.lastSeenAt,
          createdAt: createdCustomer.createdAt,
        },
      });
    }
  );

  // Get customer stats
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

      const [
        totalCustomers,
        activeCustomers,
        newCustomers,
        aggregates,
        debtAggregates,
        overdueOrders,
        topCustomers,
      ] = await Promise.all([
        // Total customers (exclude deleted)
        fastify.prisma.customer.count({ where: { workspaceId, deletedAt: null } }),

        // Active customers (seen in last 30 days)
        fastify.prisma.customer.count({
          where: {
            workspaceId,
            deletedAt: null,
            status: 'active',
            lastSeenAt: { gte: thirtyDaysAgo },
          },
        }),

        // New customers this month
        fastify.prisma.customer.count({
          where: {
            workspaceId,
            deletedAt: null,
            createdAt: { gte: thirtyDaysAgo },
          },
        }),

        // Aggregates
        fastify.prisma.customer.aggregate({
          where: { workspaceId, deletedAt: null, orderCount: { gt: 0 } },
          _avg: { totalSpent: true },
          _sum: { totalSpent: true, currentBalance: true },
        }),
        fastify.prisma.order.aggregate({
          where: {
            workspaceId,
            deletedAt: null,
            status: { notIn: [...debtIgnoredStatuses] },
          },
          _sum: { total: true, paidAmount: true },
        }),
        fastify.prisma.order.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            status: { notIn: [...debtIgnoredStatuses] },
            createdAt: { lt: thirtyDaysAgo },
            OR: [
              { paidAt: null },
              {
                AND: [{ paidAmount: { lt: fastify.prisma.order.fields.total } }],
              },
            ],
          },
          select: { total: true, paidAmount: true },
        }),

        // Top 5 customers by spending
        fastify.prisma.customer.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: { totalSpent: 'desc' },
          take: 5,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            totalSpent: true,
            orderCount: true,
          },
        }),
      ]);

      reply.send({
        totalCustomers,
        activeCustomers,
        newCustomers,
        averageSpent: aggregates._avg.totalSpent ? Number(aggregates._avg.totalSpent) : 0,
        totalRevenue: aggregates._sum.totalSpent ? Number(aggregates._sum.totalSpent) : 0,
        totalDebt: Math.max(0, (debtAggregates._sum.total || 0) - (debtAggregates._sum.paidAmount || 0)),
        overdueDebt: overdueOrders.reduce((sum, order) => {
          const pending = Math.max(order.total - (order.paidAmount || 0), 0);
          return sum + pending;
        }, 0),
        topCustomers: topCustomers.map((c) => ({
          id: c.id,
          name: c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.phone,
          totalSpent: Number(c.totalSpent),
          orderCount: c.orderCount,
        })),
      });
    }
  );

  // Get single customer
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              total: true,
              createdAt: true,
            },
          },
          agentSessions: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              currentState: true,
              agentActive: true,
              createdAt: true,
              lastActivityAt: true,
            },
          },
        },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const metadata = (customer.metadata as Record<string, unknown>) || {};
      const recalculated = await recalcCustomerFinancials(fastify.prisma, workspaceId, customer.id);

      reply.send({
        customer: {
          id: customer.id,
          phone: customer.phone,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          cuit: customer.cuit,
          businessName: customer.businessName,
          fiscalAddress: customer.fiscalAddress,
          vatCondition: customer.vatCondition,
          fullName: customer.firstName && customer.lastName
            ? `${customer.firstName} ${customer.lastName}`
            : customer.firstName || customer.lastName || null,
          status: customer.status,
          orderCount: recalculated.orderCount,
          totalSpent: recalculated.totalSpent,
          currentBalance: recalculated.debt,
          paymentScore: recalculated.paymentScore,
          dni: metadata.dni as string | undefined,
          notes: metadata.notes as string | undefined,
          preferences: customer.preferences,
          firstSeenAt: customer.firstSeenAt,
          lastSeenAt: customer.lastSeenAt,
          createdAt: customer.createdAt,
          orders: customer.orders,
          sessions: customer.agentSessions,
        },
      });
    }
  );

  // Update customer
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const body = updateCustomerSchema.parse(request.body);

      // Check customer exists
      const existing = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      // Build update data
      const updateData: any = {};
      if (body.firstName !== undefined) updateData.firstName = body.firstName;
      if (body.lastName !== undefined) updateData.lastName = body.lastName;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.phone !== undefined) updateData.phone = normalizePhone(body.phone);
      if (body.status !== undefined) updateData.status = body.status;
      if (body.cuit !== undefined) updateData.cuit = body.cuit;
      if (body.businessName !== undefined) updateData.businessName = body.businessName;
      if (body.fiscalAddress !== undefined) updateData.fiscalAddress = body.fiscalAddress;
      if (body.vatCondition !== undefined) updateData.vatCondition = body.vatCondition;

      // Handle metadata (dni, notes)
      if (body.dni !== undefined || body.notes !== undefined) {
        const currentMetadata = (existing.metadata as Record<string, unknown>) || {};
        updateData.metadata = {
          ...currentMetadata,
          ...(body.dni !== undefined && { dni: body.dni }),
          ...(body.notes !== undefined && { notes: body.notes }),
        };
      }

      await fastify.prisma.customer.updateMany({
        where: { id, workspaceId },
        data: updateData,
      });

      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              total: true,
              createdAt: true,
            },
          },
          agentSessions: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              currentState: true,
              agentActive: true,
              createdAt: true,
              lastActivityAt: true,
            },
          },
        },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const metadata = (customer.metadata as Record<string, unknown>) || {};
      const recalculated = await recalcCustomerFinancials(fastify.prisma, workspaceId, customer.id);

      reply.send({
        customer: {
          id: customer.id,
          phone: customer.phone,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          cuit: customer.cuit,
          businessName: customer.businessName,
          fiscalAddress: customer.fiscalAddress,
          vatCondition: customer.vatCondition,
          fullName: customer.firstName && customer.lastName
            ? `${customer.firstName} ${customer.lastName}`
            : customer.firstName || customer.lastName || null,
          status: customer.status,
          orderCount: recalculated.orderCount,
          totalSpent: recalculated.totalSpent,
          currentBalance: recalculated.debt,
          paymentScore: recalculated.paymentScore,
          dni: metadata.dni as string | undefined,
          notes: metadata.notes as string | undefined,
          preferences: customer.preferences,
          firstSeenAt: customer.firstSeenAt,
          lastSeenAt: customer.lastSeenAt,
          createdAt: customer.createdAt,
          orders: customer.orders,
          sessions: customer.agentSessions,
        },
      });
    }
  );

  // Delete customer (soft delete)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      await fastify.prisma.customer.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: {
          status: 'inactive',
          deletedAt: new Date(),
        },
      });

      reply.send({ success: true });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // CUSTOMER NOTES
  // ═══════════════════════════════════════════════════════════════════════════════

  const createNoteSchema = z.object({
    content: z.string().min(1).max(2000),
  });

  // Get customer notes
  fastify.get(
    '/:id/notes',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      // Verify customer exists and belongs to workspace
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const notes = await fastify.prisma.customerNote.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
      });

      reply.send({ notes });
    }
  );

  // Create customer note
  fastify.post(
    '/:id/notes',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const body = createNoteSchema.parse(request.body);

      // Verify customer exists and belongs to workspace
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const note = await fastify.prisma.customerNote.create({
        data: {
          customerId: id,
          content: body.content,
          createdBy: 'user',
        },
      });

      reply.send({ note });
    }
  );

  // Delete customer note
  fastify.delete(
    '/:id/notes/:noteId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id, noteId } = request.params as { id: string; noteId: string };

      // Verify customer exists and belongs to workspace
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      // Verify note exists and belongs to customer
      const note = await fastify.prisma.customerNote.findFirst({
        where: { id: noteId, customerId: id },
      });

      if (!note) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
      }

      await fastify.prisma.customerNote.delete({
        where: { id: noteId },
      });

      reply.send({ success: true });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // CUSTOMER ORDERS HISTORY
  // ═══════════════════════════════════════════════════════════════════════════════

  const ordersQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
    status: z.enum([
      'draft',
      'awaiting_acceptance',
      'accepted',
      'trashed',
      'pending_payment',
      'partial_payment',
      'confirmed',
      'paid',
      'preparing',
      'ready',
      'delivered',
      'cancelled',
    ]).optional(),
  });

  // Get customer orders
  fastify.get(
    '/:id/orders',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const query = ordersQuerySchema.parse(request.query);

      // Verify customer exists and belongs to workspace
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const paymentFilters = ['pending_payment', 'partial_payment', 'paid'] as const;
      const isPaymentFilter = query.status ? paymentFilters.includes(query.status as any) : false;

      const where: any = { customerId: id, workspaceId, deletedAt: null };
      if (!query.status || isPaymentFilter) {
        where.status = { not: 'trashed' };
      }
      if (query.status && !isPaymentFilter) {
        if (query.status === 'trashed') {
          where.status = 'trashed';
        } else if (query.status === 'awaiting_acceptance') {
          where.status = { in: ['awaiting_acceptance', 'draft'] };
        } else if (query.status === 'accepted') {
          where.status = {
            in: ['accepted', 'processing', 'shipped', 'delivered', 'confirmed', 'preparing', 'ready', 'paid'],
          };
        } else if (query.status === 'cancelled') {
          where.status = { in: ['cancelled', 'returned'] };
        } else {
          where.status = query.status;
        }
      }

      const [orders, total] = await Promise.all([
        fastify.prisma.order.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...(isPaymentFilter ? {} : { take: query.limit, skip: query.offset }),
          include: {
            items: {
              include: {
                product: { select: { name: true } },
              },
            },
          },
        }),
        isPaymentFilter ? Promise.resolve(0) : fastify.prisma.order.count({ where }),
      ]);

      const formattedOrders = orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        paidAmount: o.paidAmount,
        itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        items: o.items.map((i) => ({
          name: i.product?.name || i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
        })),
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
      }));

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

      const filteredOrders = isPaymentFilter && query.status
        ? formattedOrders.filter((o) => matchesPaymentFilter(o, query.status!))
        : formattedOrders;

      const pagedOrders = isPaymentFilter
        ? filteredOrders.slice(query.offset, query.offset + query.limit)
        : filteredOrders;
      const totalCount = isPaymentFilter ? filteredOrders.length : total;

      reply.send({
        orders: pagedOrders,
        pagination: {
          total: totalCount,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + pagedOrders.length < totalCount,
        },
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // AI SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════

  // Get AI-generated customer summary
	  fastify.post(
	    '/:id/summary',
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
	      if (!planContext.capabilities.showCustomerAiSummary) {
	        return reply.code(403).send({
	          error: 'FORBIDDEN_BY_PLAN',
	          message: 'Tu plan actual no incluye resumen IA de clientes',
	        });
	      }

	      const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planContext.plan);
	      const monthlyLimit = limits.aiCustomerSummariesPerMonth;
	      if (monthlyLimit !== null) {
	        const used = await getMonthlyUsage(fastify.prisma, {
	          workspaceId,
	          metric: COMMERCE_USAGE_METRICS.aiCustomerSummary,
	        });
	        if (used >= BigInt(monthlyLimit)) {
	          return reply.code(429).send({
	            error: 'PLAN_QUOTA_EXCEEDED',
	            message: `Alcanzaste el límite mensual de resúmenes IA de clientes (${monthlyLimit}).`,
	          });
	        }
	      }

	      const { id } = request.params as { id: string };

      // Get full customer data
      const customer = await fastify.prisma.customer.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          notes: { orderBy: { createdAt: 'desc' }, take: 10 },
          orders: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              total: true,
              paidAmount: true,
              createdAt: true,
              items: {
                include: { product: { select: { name: true, category: true } } },
              },
            },
          },
        },
      });

      if (!customer) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Customer not found' });
      }

      const recalculated = await recalcCustomerFinancials(fastify.prisma, workspaceId, customer.id);

      // Build context for AI
      const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Sin nombre';
      const totalOrders = recalculated.orderCount;
      const paidOrders = recalculated.paidCount;
      const cancelledOrders = customer.orders.filter((o) => o.status === 'cancelled').length;
      const computedScore = recalculated.paymentScore;

      // Find favorite products
      const productCounts: Record<string, number> = {};
      customer.orders.forEach((order) => {
        order.items.forEach((item) => {
          const name = item.product?.name || item.name || 'Desconocido';
          productCounts[name] = (productCounts[name] || 0) + item.quantity;
        });
      });
      const favoriteProducts = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => `${name} (${count}x)`);

      // Find purchase patterns
      const orderDays = customer.orders.map((o) => new Date(o.createdAt).getDay());
      const dayCounts: Record<number, number> = {};
      orderDays.forEach((day) => {
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      });
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const favoriteDays = Object.entries(dayCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([day]) => dayNames[parseInt(day)]);

      // Get score label
      const scoreLabel = computedScore >= 80 ? 'Excelente pagador' :
                        computedScore >= 60 ? 'Buen pagador' :
                        computedScore >= 40 ? 'Pagador regular' : 'Pagador riesgoso';

      // Build notes summary
      const notesText = customer.notes.map((n) => n.content).join('. ');

      // Generate summary using Claude
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic();

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Genera un resumen conciso y útil sobre este cliente para un comercio. Máximo 3-4 oraciones en español.

DATOS DEL CLIENTE:
- Nombre: ${fullName}
- Teléfono: ${customer.phone}
- Cliente desde: ${new Date(customer.firstSeenAt).toLocaleDateString('es-AR')}
- Total gastado: $${(Number(customer.totalSpent) / 100).toLocaleString('es-AR')}
- Pedidos: ${totalOrders} total, ${paidOrders} pagados, ${cancelledOrders} cancelados
- Deuda actual: $${(recalculated.debt / 100).toLocaleString('es-AR')}
- Score de pago: ${computedScore}/100 (${scoreLabel})
- Productos favoritos: ${favoriteProducts.join(', ') || 'Sin datos'}
- Días preferidos: ${favoriteDays.join(', ') || 'Sin patrón definido'}
- Notas: ${notesText || 'Sin notas'}

El resumen debe ser práctico y destacar lo más relevante para atenderlo mejor.`,
          },
        ],
      });

      const summary = message.content[0].type === 'text' ? message.content[0].text : '';

      await recordMonthlyUsage(fastify.prisma, {
        workspaceId,
        metric: COMMERCE_USAGE_METRICS.aiCustomerSummary,
        quantity: 1,
        metadata: { source: 'customers.summary' },
      });

      reply.send({
        summary,
        stats: {
          totalOrders,
          paidOrders,
          cancelledOrders,
          totalSpent: Number(customer.totalSpent),
          currentDebt: recalculated.debt,
          paymentScore: computedScore,
          favoriteProducts,
          favoriteDays,
        },
      });
    }
  );
};
