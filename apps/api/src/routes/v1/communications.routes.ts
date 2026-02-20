/**
 * Communications Routes
 * Promotions + WhatsApp broadcast campaigns
 */
import { randomUUID } from 'crypto';

import { type Prisma } from '@prisma/client';
import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { COMMERCE_USAGE_METRICS, type CommercePlan } from '@nexova/shared';

import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getMonthlyUsage, recordMonthlyUsage } from '../../utils/monthly-usage.js';
import {
  computePromotionStatus,
  getPromotionValueLabel,
  type PromotionRuleConfig,
  validatePromotionDefinition,
} from '../../utils/promotions.js';

const promotionStatuses = ['draft', 'active', 'paused', 'archived', 'expired'] as const;
const promotionTypes = ['percentage', 'fixed_price', 'second_unit_percentage', 'second_unit_fixed', 'buy_x_pay_y'] as const;
const campaignStatuses = ['draft', 'processing', 'completed', 'partial', 'failed', 'cancelled'] as const;
const promotionRulesSchema = z.object({
  buyQuantity: z.coerce.number().int().min(2).max(100).optional(),
  payQuantity: z.coerce.number().int().min(1).max(99).optional(),
});

const promotionsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(promotionStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const promotionProductsQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const createPromotionSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional(),
  imageUrl: z.string().max(2000).optional().nullable(),
  promoType: z.enum(promotionTypes),
  value: z.coerce.number().int().min(0),
  rules: promotionRulesSchema.optional().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('active'),
});

const updatePromotionSchema = z.object({
  productId: z.string().uuid().optional(),
  name: z.string().min(2).max(150).optional(),
  description: z.string().max(500).optional().nullable(),
  imageUrl: z.string().max(2000).optional().nullable(),
  promoType: z.enum(promotionTypes).optional(),
  value: z.coerce.number().int().min(0).optional(),
  rules: promotionRulesSchema.optional().nullable(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  status: z.enum(promotionStatuses).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'No updates provided',
});

const campaignsQuerySchema = z.object({
  status: z.enum(campaignStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const recipientsQuerySchema = z.object({
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const createCampaignSchema = z.object({
  name: z.string().min(2).max(150),
  message: z.string().min(3).max(3000),
  imageUrl: z.string().url().max(2000).optional().nullable(),
  promotionId: z.string().uuid().optional().nullable(),
  sendToAll: z.coerce.boolean().default(true),
  customerIds: z.array(z.string().uuid()).max(5000).optional(),
});

function getWorkspaceId(headers: Record<string, unknown>): string | null {
  const value = headers['x-workspace-id'];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  return `+${digits}`;
}

function normalizeOptionalImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSupportedImageUrl(value: string): boolean {
  if (value.startsWith('/uploads/products/')) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function readPromotionImageUrl(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).imageUrl;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPromotionRules(metadata: Prisma.JsonValue | null | undefined): PromotionRuleConfig | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).promoRules;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const rules = raw as Record<string, unknown>;
  const buyRaw = rules.buyQuantity;
  const payRaw = rules.payQuantity;
  const buyQuantity =
    typeof buyRaw === 'number' && Number.isFinite(buyRaw)
      ? Math.trunc(buyRaw)
      : typeof buyRaw === 'string' && Number.isFinite(Number(buyRaw))
        ? Math.trunc(Number(buyRaw))
        : null;
  const payQuantity =
    typeof payRaw === 'number' && Number.isFinite(payRaw)
      ? Math.trunc(payRaw)
      : typeof payRaw === 'string' && Number.isFinite(Number(payRaw))
        ? Math.trunc(Number(payRaw))
        : null;

  if (!buyQuantity || !payQuantity) return null;
  return { buyQuantity, payQuantity };
}

type CommunicationsUsageSummary = {
  plan: CommercePlan;
  limit: number | null;
  used: number;
  remaining: number | null;
  percentUsed: number;
  isNearLimit: boolean;
  isExhausted: boolean;
};

export const communicationsRoutes: FastifyPluginAsync = async (fastify) => {
  const resolvePlanForRequest = async (
    workspaceId: string,
    userId?: string | null
  ): Promise<{ plan: CommercePlan; showCommunicationsModule: boolean }> => {
    const membership =
      userId
        ? await fastify.prisma.membership.findFirst({
            where: {
              workspaceId,
              userId,
              status: { in: ['ACTIVE', 'active'] },
            },
            include: { role: { select: { name: true } } },
          })
        : null;

    const planContext = await getWorkspacePlanContext(
      fastify.prisma,
      workspaceId,
      membership?.role?.name
    );

    return {
      plan: planContext.plan,
      showCommunicationsModule: planContext.capabilities.showCommunicationsModule,
    };
  };

  const getCommunicationsUsageSummary = async (
    workspaceId: string,
    plan: CommercePlan
  ): Promise<CommunicationsUsageSummary> => {
    const limits = await getEffectiveCommercePlanLimits(fastify.prisma, plan);
    const limit = limits.communicationsActionsPerMonth;
    const usedRaw = await getMonthlyUsage(fastify.prisma, {
      workspaceId,
      metric: COMMERCE_USAGE_METRICS.communicationsActions,
    });
    const used = Number(usedRaw);

    if (limit === null) {
      return {
        plan,
        limit: null,
        used,
        remaining: null,
        percentUsed: 0,
        isNearLimit: false,
        isExhausted: false,
      };
    }

    const remaining = Math.max(0, limit - used);
    const percentUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
    const warningThreshold = Math.max(1, Math.ceil(limit * 0.8));
    const isExhausted = used >= limit;
    const isNearLimit = !isExhausted && used >= warningThreshold;

    return {
      plan,
      limit,
      used,
      remaining,
      percentUsed,
      isNearLimit,
      isExhausted,
    };
  };

  const ensureCommunicationsEnabled = async (
    workspaceId: string,
    userId?: string | null
  ): Promise<{ plan: CommercePlan; usage: CommunicationsUsageSummary } | null> => {
    const planContext = await resolvePlanForRequest(workspaceId, userId);
    if (!planContext.showCommunicationsModule) {
      return null;
    }
    const usage = await getCommunicationsUsageSummary(workspaceId, planContext.plan);
    return {
      plan: planContext.plan,
      usage,
    };
  };

  fastify.get(
    '/products',
    { preHandler: [fastify.requirePermission('products:update')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }

      const query = promotionProductsQuerySchema.parse(request.query);
      const term = query.search?.trim();
      const where: Prisma.ProductWhereInput = {
        workspaceId,
        deletedAt: null,
        status: { in: ['active', 'draft'] },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { sku: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [products, total] = await Promise.all([
        fastify.prisma.product.findMany({
          where,
          orderBy: [{ name: 'asc' }],
          skip: query.offset,
          take: query.limit,
          select: {
            id: true,
            name: true,
            price: true,
            status: true,
            images: true,
          },
        }),
        fastify.prisma.product.count({ where }),
      ]);

      return reply.send({
        products,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + query.limit < total,
        },
      });
    }
  );

  fastify.get(
    '/promotions',
    { preHandler: [fastify.requirePermission('products:read')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }

      const query = promotionsQuerySchema.parse(request.query);
      const where: Prisma.PromotionWhereInput = {
        workspaceId,
        deletedAt: null,
      };
      const andConditions: Prisma.PromotionWhereInput[] = [];

      if (query.status) {
        if (query.status === 'expired') {
          andConditions.push({
            OR: [{ status: 'expired' }, { status: 'active', endsAt: { lt: new Date() } }],
          });
        } else {
          andConditions.push({ status: query.status });
        }
      }

      if (query.search) {
        const term = query.search.trim();
        if (term.length > 0) {
          andConditions.push({
            OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { product: { name: { contains: term, mode: 'insensitive' } } },
            ],
          });
        }
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      const [promotions, total] = await Promise.all([
        fastify.prisma.promotion.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          skip: query.offset,
          take: query.limit,
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                images: true,
              },
            },
          },
        }),
        fastify.prisma.promotion.count({ where }),
      ]);

      const promotionIds = promotions.map((promotion) => promotion.id);
      const groupedOrders = promotionIds.length
        ? await fastify.prisma.order.groupBy({
          by: ['promotionId'],
          where: {
            workspaceId,
            promotionId: { in: promotionIds },
            deletedAt: null,
            status: { notIn: ['cancelled', 'returned', 'draft', 'trashed'] },
          },
          _count: { _all: true },
          _sum: { total: true, discount: true },
        })
        : [];

      const orderSummaryByPromo = new Map(
        groupedOrders.map((entry) => [
          entry.promotionId || '',
          {
            orderCount: entry._count._all,
            revenue: entry._sum.total ?? 0,
            discountTotal: entry._sum.discount ?? 0,
          },
        ])
      );

      return reply.send({
        promotions: promotions.map((promotion) => {
          const summary = orderSummaryByPromo.get(promotion.id) || {
            orderCount: 0,
            revenue: 0,
            discountTotal: 0,
          };
          return {
            id: promotion.id,
            name: promotion.name,
            description: promotion.description,
            imageUrl: readPromotionImageUrl(promotion.metadata),
            promoType: promotion.promoType,
            value: promotion.value,
            valueLabel: getPromotionValueLabel({
              promoType: promotion.promoType,
              value: promotion.value,
              metadata: promotion.metadata,
            }),
            rules: readPromotionRules(promotion.metadata),
            startsAt: promotion.startsAt,
            endsAt: promotion.endsAt,
            status: promotion.status,
            computedStatus: computePromotionStatus(promotion.status, promotion.startsAt, promotion.endsAt),
            product: {
              id: promotion.product.id,
              name: promotion.product.name,
              price: promotion.product.price,
              images: promotion.product.images,
            },
            metrics: summary,
            createdAt: promotion.createdAt,
            updatedAt: promotion.updatedAt,
          };
        }),
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + query.limit < total,
        },
      });
    }
  );

  fastify.post(
    '/promotions',
    { preHandler: [fastify.requirePermission('products:update')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }
      if (planAccess.usage.isExhausted && planAccess.usage.limit !== null) {
        return reply.code(429).send({
          error: 'PLAN_QUOTA_EXCEEDED',
          message: `Alcanzaste el límite mensual de comunicación (${planAccess.usage.limit}).`,
        });
      }

      const body = createPromotionSchema.parse(request.body);
      const imageUrl = normalizeOptionalImageUrl(body.imageUrl);
      if (imageUrl && !isSupportedImageUrl(imageUrl)) {
        return reply.code(400).send({
          error: 'INVALID_IMAGE_URL',
          message: 'La imagen debe ser una URL http(s) o un archivo subido válido',
        });
      }
      if (body.endsAt <= body.startsAt) {
        return reply.code(400).send({
          error: 'INVALID_DATES',
          message: 'La fecha de finalizacion debe ser mayor a la de inicio',
        });
      }
      const promotionValidation = validatePromotionDefinition({
        promoType: body.promoType,
        value: body.value,
        rules: body.rules || undefined,
      });
      if (!promotionValidation.valid) {
        return reply.code(400).send({
          error: 'INVALID_PROMO_VALUE',
          message: promotionValidation.message,
        });
      }

      const product = await fastify.prisma.product.findFirst({
        where: { id: body.productId, workspaceId, deletedAt: null },
        select: { id: true, name: true, price: true },
      });
      if (!product) {
        return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' });
      }

      const promotionMetadata: Record<string, unknown> = {};
      if (imageUrl) promotionMetadata.imageUrl = imageUrl;
      if (promotionValidation.normalizedRules) {
        promotionMetadata.promoRules = promotionValidation.normalizedRules;
      }
      const promotion = await fastify.prisma.promotion.create({
        data: {
          workspaceId,
          productId: body.productId,
          name: body.name.trim(),
          description: body.description?.trim() || null,
          promoType: body.promoType,
          value: body.value,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          status: body.status,
          createdBy: request.user?.sub || null,
          metadata: promotionMetadata as Prisma.InputJsonObject,
        },
      });

      await recordMonthlyUsage(fastify.prisma, {
        workspaceId,
        metric: COMMERCE_USAGE_METRICS.communicationsActions,
        quantity: 1,
        metadata: { source: 'communications.promotions.create' },
      });

      const usageAfterCreate = planAccess.usage.limit === null
        ? {
            ...planAccess.usage,
            used: planAccess.usage.used + 1,
          }
        : (() => {
            const limit = planAccess.usage.limit;
            const used = planAccess.usage.used + 1;
            const remaining = Math.max(0, limit - used);
            const percentUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
            const warningThreshold = Math.max(1, Math.ceil(limit * 0.8));
            const isExhausted = used >= limit;
            const isNearLimit = !isExhausted && used >= warningThreshold;
            return {
              ...planAccess.usage,
              used,
              remaining,
              percentUsed,
              isNearLimit,
              isExhausted,
            };
          })();

      return reply.code(201).send({
        promotion: {
          ...promotion,
          imageUrl: readPromotionImageUrl(promotion.metadata),
          rules: readPromotionRules(promotion.metadata),
          valueLabel: getPromotionValueLabel({
            promoType: promotion.promoType,
            value: promotion.value,
            metadata: promotion.metadata,
          }),
          product,
          computedStatus: computePromotionStatus(promotion.status, promotion.startsAt, promotion.endsAt),
        },
        usage: {
          communicationsActions: usageAfterCreate,
        },
      });
    }
  );

  fastify.patch(
    '/promotions/:id',
    { preHandler: [fastify.requirePermission('products:update')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }

      const { id } = request.params as { id: string };
      const body = updatePromotionSchema.parse(request.body);
      const nextImageUrl = body.imageUrl !== undefined ? normalizeOptionalImageUrl(body.imageUrl) : undefined;
      if (typeof nextImageUrl === 'string' && !isSupportedImageUrl(nextImageUrl)) {
        return reply.code(400).send({
          error: 'INVALID_IMAGE_URL',
          message: 'La imagen debe ser una URL http(s) o un archivo subido válido',
        });
      }

      const existing = await fastify.prisma.promotion.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Promocion no encontrada' });
      }

      const startsAt = body.startsAt ?? existing.startsAt;
      const endsAt = body.endsAt ?? existing.endsAt;
      if (endsAt <= startsAt) {
        return reply.code(400).send({
          error: 'INVALID_DATES',
          message: 'La fecha de finalizacion debe ser mayor a la de inicio',
        });
      }

      if (body.productId) {
        const product = await fastify.prisma.product.findFirst({
          where: { id: body.productId, workspaceId, deletedAt: null },
          select: { id: true },
        });
        if (!product) {
          return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' });
        }
      }

      let nextMetadata: Prisma.InputJsonObject | undefined;
      const currentMetadata =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? { ...(existing.metadata as Record<string, unknown>) }
          : {};

      const nextPromoType = body.promoType ?? existing.promoType;
      const nextValue = body.value ?? existing.value;
      const nextRulesInput = body.rules !== undefined
        ? (body.rules || undefined)
        : currentMetadata.promoRules;
      const promotionValidation = validatePromotionDefinition({
        promoType: nextPromoType,
        value: nextValue,
        rules: nextRulesInput,
      });
      if (!promotionValidation.valid) {
        return reply.code(400).send({
          error: 'INVALID_PROMO_VALUE',
          message: promotionValidation.message,
        });
      }

      if (body.imageUrl !== undefined || body.rules !== undefined || body.promoType !== undefined) {
        if (body.imageUrl !== undefined) {
          if (nextImageUrl) currentMetadata.imageUrl = nextImageUrl;
          else delete currentMetadata.imageUrl;
        }

        if (promotionValidation.normalizedRules) {
          currentMetadata.promoRules =
            promotionValidation.normalizedRules as unknown as Prisma.InputJsonValue;
        } else {
          delete currentMetadata.promoRules;
        }

        nextMetadata = currentMetadata as Prisma.InputJsonObject;
      }

      const updated = await fastify.prisma.promotion.update({
        where: { id },
        data: {
          ...(body.productId !== undefined ? { productId: body.productId } : {}),
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
          ...(body.promoType !== undefined ? { promoType: body.promoType } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
          ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        include: {
          product: {
            select: { id: true, name: true, price: true, images: true },
          },
        },
      });

      return reply.send({
        promotion: {
          ...updated,
          imageUrl: readPromotionImageUrl(updated.metadata),
          rules: readPromotionRules(updated.metadata),
          valueLabel: getPromotionValueLabel({
            promoType: updated.promoType,
            value: updated.value,
            metadata: updated.metadata,
          }),
          computedStatus: computePromotionStatus(updated.status, updated.startsAt, updated.endsAt),
        },
      });
    }
  );

  fastify.get(
    '/campaigns',
    { preHandler: [fastify.requirePermission('customers:read')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }

      const query = campaignsQuerySchema.parse(request.query);
      const where: Prisma.BroadcastCampaignWhereInput = {
        workspaceId,
        ...(query.status ? { status: query.status } : {}),
      };

      const [campaigns, total] = await Promise.all([
        fastify.prisma.broadcastCampaign.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          skip: query.offset,
          take: query.limit,
          include: {
            promotion: { select: { id: true, name: true, promoType: true, value: true } },
            _count: { select: { recipients: true } },
          },
        }),
        fastify.prisma.broadcastCampaign.count({ where }),
      ]);

      return reply.send({
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          message: campaign.message,
          imageUrl: campaign.imageUrl,
          status: campaign.status,
          targetType: campaign.targetType,
          totalRecipients: campaign.totalRecipients,
          sentCount: campaign.sentCount,
          failedCount: campaign.failedCount,
          startedAt: campaign.startedAt,
          finishedAt: campaign.finishedAt,
          promotion: campaign.promotion,
          recipientsCount: campaign._count.recipients,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
        })),
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + query.limit < total,
        },
      });
    }
  );

  fastify.get(
    '/campaigns/:id/recipients',
    { preHandler: [fastify.requirePermission('customers:read')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }

      const { id } = request.params as { id: string };
      const query = recipientsQuerySchema.parse(request.query);

      const campaign = await fastify.prisma.broadcastCampaign.findFirst({
        where: { id, workspaceId },
        select: { id: true, name: true, status: true },
      });
      if (!campaign) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Campana no encontrada' });
      }

      const where: Prisma.BroadcastRecipientWhereInput = {
        workspaceId,
        campaignId: id,
        ...(query.status ? { status: query.status } : {}),
      };

      const [recipients, total] = await Promise.all([
        fastify.prisma.broadcastRecipient.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }],
          skip: query.offset,
          take: query.limit,
          include: {
            customer: {
              select: {
                id: true,
                phone: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        fastify.prisma.broadcastRecipient.count({ where }),
      ]);

      return reply.send({
        campaign,
        recipients,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + query.limit < total,
        },
      });
    }
  );

  fastify.post(
    '/campaigns',
    { preHandler: [fastify.requirePermission('customers:update')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }
      if (planAccess.usage.isExhausted && planAccess.usage.limit !== null) {
        return reply.code(429).send({
          error: 'PLAN_QUOTA_EXCEEDED',
          message: `Alcanzaste el límite mensual de comunicación (${planAccess.usage.limit}).`,
        });
      }

      const body = createCampaignSchema.parse(request.body);
      const customerIds = body.customerIds || [];
      if (!body.sendToAll && customerIds.length === 0) {
        return reply.code(400).send({
          error: 'MISSING_RECIPIENTS',
          message: 'Debes seleccionar destinatarios para la difusion',
        });
      }

      const activeNumber = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
        select: { provider: true },
      });
      if (!activeNumber) {
        return reply.code(400).send({
          error: 'WHATSAPP_NOT_CONFIGURED',
          message: 'No hay un numero de WhatsApp activo para este workspace',
        });
      }
      if ((activeNumber.provider || '').toLowerCase() !== 'evolution') {
        return reply.code(400).send({
          error: 'EVOLUTION_REQUIRED',
          message: 'La difusion con imagen requiere provider Evolution activo',
        });
      }

      let selectedPromotion: {
        id: string;
        name: string;
        promoType: string;
        value: number;
        startsAt: Date;
        endsAt: Date;
        status: string;
        metadata: Prisma.JsonValue;
        product: { id: string; name: string; price: number };
      } | null = null;

      if (body.promotionId) {
        const promotion = await fastify.prisma.promotion.findFirst({
          where: { id: body.promotionId, workspaceId, deletedAt: null },
          select: {
            id: true,
            name: true,
            promoType: true,
            value: true,
            startsAt: true,
            endsAt: true,
            status: true,
            metadata: true,
            product: { select: { id: true, name: true, price: true } },
          },
        });
        if (!promotion) {
          return reply.code(404).send({
            error: 'PROMOTION_NOT_FOUND',
            message: 'La promocion seleccionada no existe',
          });
        }
        const computedStatus = computePromotionStatus(promotion.status, promotion.startsAt, promotion.endsAt);
        if (computedStatus !== 'active') {
          return reply.code(400).send({
            error: 'PROMOTION_NOT_ACTIVE',
            message: 'La promoción seleccionada debe estar activa para difundirla.',
          });
        }
        selectedPromotion = promotion;
      }

      const customers = await fastify.prisma.customer.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(body.sendToAll ? {} : { id: { in: customerIds } }),
        },
        select: {
          id: true,
          phone: true,
        },
      });

      const seen = new Set<string>();
      const recipients = customers
        .map((customer) => {
          const phone = normalizePhone(customer.phone);
          if (!phone) return null;
          if (seen.has(phone)) return null;
          seen.add(phone);
          return { customerId: customer.id, phone };
        })
        .filter((recipient): recipient is { customerId: string; phone: string } => recipient !== null);

      if (recipients.length === 0) {
        return reply.code(400).send({
          error: 'NO_VALID_RECIPIENTS',
          message: 'No hay clientes con telefono valido para enviar la difusion',
        });
      }

      const now = new Date();
      const campaign = await fastify.prisma.$transaction(async (tx) => {
        const createdCampaign = await tx.broadcastCampaign.create({
          data: {
            workspaceId,
            promotionId: body.promotionId || null,
            name: body.name.trim(),
            message: body.message.trim(),
            imageUrl: body.imageUrl || null,
            targetType: body.sendToAll ? 'all_customers' : 'selected_customers',
            status: 'processing',
            totalRecipients: recipients.length,
            sentCount: 0,
            failedCount: 0,
            startedAt: now,
            createdBy: request.user?.sub || null,
            metadata: selectedPromotion
              ? ({
                  promotionSnapshot: {
                    id: selectedPromotion.id,
                    name: selectedPromotion.name,
                    promoType: selectedPromotion.promoType,
                    value: selectedPromotion.value,
                    valueLabel: getPromotionValueLabel({
                      promoType: selectedPromotion.promoType,
                      value: selectedPromotion.value,
                      metadata: selectedPromotion.metadata,
                    }),
                    rules: readPromotionRules(selectedPromotion.metadata),
                    startsAt: selectedPromotion.startsAt.toISOString(),
                    endsAt: selectedPromotion.endsAt.toISOString(),
                    product: selectedPromotion.product,
                  },
                } as Prisma.InputJsonValue)
              : ({} as Prisma.InputJsonValue),
          },
        });

        await tx.broadcastRecipient.createMany({
          data: recipients.map((recipient) => ({
            workspaceId,
            campaignId: createdCampaign.id,
            customerId: recipient.customerId,
            phone: recipient.phone,
            status: 'pending',
            metadata: {} as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });

        const persistedRecipients = await tx.broadcastRecipient.findMany({
          where: { workspaceId, campaignId: createdCampaign.id },
          select: { id: true, phone: true },
        });

        if (persistedRecipients.length > 0) {
          await tx.eventOutbox.createMany({
            data: persistedRecipients.map((recipient) => ({
              workspaceId,
              eventType: 'communications.broadcast_send',
              aggregateType: 'BroadcastCampaign',
              aggregateId: createdCampaign.id,
              payload: {
                campaignId: createdCampaign.id,
                recipientId: recipient.id,
                to: recipient.phone,
                message: body.message.trim(),
                imageUrl: body.imageUrl || null,
              } as Prisma.InputJsonValue,
              correlationId: randomUUID(),
              status: 'pending',
            })),
          });
        }

        return createdCampaign;
      });

      await recordMonthlyUsage(fastify.prisma, {
        workspaceId,
        metric: COMMERCE_USAGE_METRICS.communicationsActions,
        quantity: 1,
        metadata: { source: 'communications.campaigns.create' },
      });

      const usageAfterCreate = planAccess.usage.limit === null
        ? {
            ...planAccess.usage,
            used: planAccess.usage.used + 1,
          }
        : (() => {
            const limit = planAccess.usage.limit;
            const used = planAccess.usage.used + 1;
            const remaining = Math.max(0, limit - used);
            const percentUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
            const warningThreshold = Math.max(1, Math.ceil(limit * 0.8));
            const isExhausted = used >= limit;
            const isNearLimit = !isExhausted && used >= warningThreshold;
            return {
              ...planAccess.usage,
              used,
              remaining,
              percentUsed,
              isNearLimit,
              isExhausted,
            };
          })();

      return reply.code(201).send({
        campaign,
        usage: {
          communicationsActions: usageAfterCreate,
        },
      });
    }
  );

  fastify.get(
    '/metrics',
    { preHandler: [fastify.requirePermission('analytics:read')] },
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request.headers as Record<string, unknown>);
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }
      const planAccess = await ensureCommunicationsEnabled(workspaceId, request.user?.sub);
      if (!planAccess) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye el módulo de comunicación',
        });
      }

      const orderFilterBase: Prisma.OrderWhereInput = {
        workspaceId,
        deletedAt: null,
        status: { notIn: ['cancelled', 'returned', 'draft', 'trashed'] },
      };

      const [
        promotionsTotal,
        promotionsActive,
        ordersWithPromoCount,
        ordersWithoutPromoCount,
        ordersWithPromoAgg,
        ordersWithoutPromoAgg,
        topPromotionRows,
        topPromotions,
        campaignTotals,
      ] = await Promise.all([
        fastify.prisma.promotion.count({
          where: { workspaceId, deletedAt: null },
        }),
        fastify.prisma.promotion.count({
          where: {
            workspaceId,
            deletedAt: null,
            status: 'active',
            startsAt: { lte: new Date() },
            endsAt: { gte: new Date() },
          },
        }),
        fastify.prisma.order.count({
          where: { ...orderFilterBase, promotionId: { not: null } },
        }),
        fastify.prisma.order.count({
          where: { ...orderFilterBase, promotionId: null },
        }),
        fastify.prisma.order.aggregate({
          where: { ...orderFilterBase, promotionId: { not: null } },
          _sum: { total: true, discount: true },
        }),
        fastify.prisma.order.aggregate({
          where: { ...orderFilterBase, promotionId: null },
          _sum: { total: true },
        }),
        fastify.prisma.order.groupBy({
          by: ['promotionId'],
          where: { ...orderFilterBase, promotionId: { not: null } },
          _count: { _all: true },
          _sum: { total: true, discount: true },
        }),
        fastify.prisma.promotion.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true, name: true, promoType: true, value: true },
        }),
        fastify.prisma.broadcastCampaign.aggregate({
          where: { workspaceId },
          _count: { _all: true },
          _sum: { sentCount: true, failedCount: true, totalRecipients: true },
        }),
      ]);

      const promotionMap = new Map(topPromotions.map((promotion) => [promotion.id, promotion]));
      const topPromotionMetrics = topPromotionRows
        .map((row) => {
          const promotion = row.promotionId ? promotionMap.get(row.promotionId) : null;
          return {
            promotionId: row.promotionId,
            name: promotion?.name || 'Promocion eliminada',
            promoType: promotion?.promoType || null,
            value: promotion?.value || null,
            orderCount: row._count._all,
            revenue: row._sum.total ?? 0,
            discountTotal: row._sum.discount ?? 0,
          };
        })
        .sort((a, b) => b.orderCount - a.orderCount)
        .slice(0, 10);

      const sentTotal = campaignTotals._sum.sentCount ?? 0;
      const failedTotal = campaignTotals._sum.failedCount ?? 0;
      const attemptedTotal = sentTotal + failedTotal;

      return reply.send({
        promotions: {
          total: promotionsTotal,
          active: promotionsActive,
          requested: ordersWithPromoCount,
          topRequested: topPromotionMetrics,
        },
        orders: {
          withPromotion: {
            count: ordersWithPromoCount,
            revenue: ordersWithPromoAgg._sum.total ?? 0,
            discountTotal: ordersWithPromoAgg._sum.discount ?? 0,
          },
          withoutPromotion: {
            count: ordersWithoutPromoCount,
            revenue: ordersWithoutPromoAgg._sum.total ?? 0,
          },
        },
        campaigns: {
          total: campaignTotals._count._all ?? 0,
          totalRecipients: campaignTotals._sum.totalRecipients ?? 0,
          sent: sentTotal,
          failed: failedTotal,
          deliveryRate: attemptedTotal > 0 ? sentTotal / attemptedTotal : 0,
        },
        usage: {
          communicationsActions: planAccess.usage,
        },
      });
    }
  );
};
