/**
 * Products Routes
 * CRUD operations for product management
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { createNotificationIfEnabled } from '../../utils/notifications.js';

const productQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['active', 'archived']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  sortBy: z.enum(['name', 'price', 'createdAt', 'updatedAt', 'category']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const productTrashQuerySchema = z.object({
  search: z.string().optional(),
  scope: z.enum(['all', 'archived']).default('all'),
  limit: z.coerce.number().min(1).max(200).default(100),
  offset: z.coerce.number().min(0).default(0),
});

const createProductSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  shortDesc: z.string().max(500).optional(),
  unit: z.enum(['unit', 'kg', 'g', 'l', 'ml', 'm', 'cm']).optional(),
  unitValue: z.union([z.string(), z.number()]).optional(),
  secondaryUnit: z.enum(['pack', 'box', 'bundle', 'dozen']).optional().nullable(),
  secondaryUnitValue: z.union([z.string(), z.number()]).optional().nullable(),
  category: z.string().max(500).optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  price: z.number().int().min(0),
  comparePrice: z.number().int().min(0).optional(),
  images: z.array(z.string().min(1)).optional(),
  attributes: z.record(z.unknown()).optional(),
  keywords: z.array(z.string()).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  initialStock: z.number().int().min(0).optional(),
  lowThreshold: z.number().int().min(0).optional(),
});

const updateProductSchema = z.object({
  sku: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  shortDesc: z.string().max(500).optional().nullable(),
  unit: z.enum(['unit', 'kg', 'g', 'l', 'ml', 'm', 'cm']).optional().nullable(),
  unitValue: z.union([z.string(), z.number()]).optional().nullable(),
  secondaryUnit: z.enum(['pack', 'box', 'bundle', 'dozen']).optional().nullable(),
  secondaryUnitValue: z.union([z.string(), z.number()]).optional().nullable(),
  category: z.string().max(500).optional().nullable(),
  categoryIds: z.array(z.string().uuid()).optional(),
  price: z.number().int().min(0).optional(),
  comparePrice: z.number().int().min(0).optional().nullable(),
  images: z.array(z.string().min(1)).optional(),
  attributes: z.record(z.unknown()).optional(),
  keywords: z.array(z.string()).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

const bulkDeleteSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(100),
});

const updateStockSchema = z.object({
  quantity: z.number().int(),
  reason: z.string().max(500).optional(),
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

const normalizeUnitValue = (value?: string | number | null): string | null => {
  if (value === undefined || value === null) return null;
  const normalized = value.toString().trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeSecondaryUnitValue = (unit?: string | null, value?: string | number | null): string | null => {
  if (!unit) return null;
  if (unit === 'dozen') return '12';
  return normalizeUnitValue(value);
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

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

const normalizeLowStockThreshold = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.trunc(parsed);
    return normalized >= 0 ? normalized : null;
  }
  return null;
};

const getWorkspaceLowStockThreshold = async (
  prisma: PrismaClient,
  workspaceId: string
): Promise<number> => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });
  const settings = (workspace?.settings as Record<string, unknown>) || {};
  const threshold = normalizeLowStockThreshold(settings.lowStockThreshold);
  return threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
};

export const productsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get products list
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = productQuerySchema.parse(request.query);
      const { search, category, categoryId, status, limit, offset, sortBy, sortOrder } = query;

      // Build where clause
      const where: any = { workspaceId };
      const andClauses: any[] = [];

      if (status === 'archived') {
        andClauses.push({
          OR: [
            { status: 'archived' },
            { deletedAt: { not: null } },
          ],
        });
      } else {
        andClauses.push({ deletedAt: null });
        if (status) {
          andClauses.push({ status });
        } else {
          andClauses.push({ status: { not: 'archived' } });
        }
      }

      if (category) {
        andClauses.push({ category: { contains: category, mode: 'insensitive' } });
      }

      // Filter by categoryId (new category model)
      if (categoryId) {
        andClauses.push({
          categoryMappings: {
            some: { categoryId },
          },
        });
      }

      if (search) {
        andClauses.push({
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        });
      }

      if (andClauses.length > 0) {
        where.AND = andClauses;
      }

      // Get products with stock info and categories
      const [products, total] = await Promise.all([
        fastify.prisma.product.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: offset,
          take: limit,
          include: {
            stockItems: {
              select: { quantity: true, reserved: true, lowThreshold: true },
            },
            categoryMappings: {
              include: {
                category: {
                  select: { id: true, name: true, color: true },
                },
              },
            },
          },
        }),
        fastify.prisma.product.count({ where }),
      ]);

      // Format response
      const formattedProducts = products.map((p) => {
        const totalStock = p.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
        const lowThreshold = p.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          description: p.description,
          shortDesc: p.shortDesc,
          unit: p.unit,
          unitValue: p.unitValue,
          secondaryUnit: p.secondaryUnit,
          secondaryUnitValue: p.secondaryUnitValue,
          category: p.category,
          categories: p.categoryMappings
            .filter((m) => m.category)
            .map((m) => ({
              id: m.category.id,
              name: m.category.name,
              color: m.category.color,
            })),
          price: p.price,
          comparePrice: p.comparePrice,
          images: p.images,
          attributes: p.attributes,
          keywords: p.keywords,
          status: p.status,
          deletedAt: p.deletedAt,
          stock: totalStock,
          lowThreshold,
          isLowStock: totalStock > 0 && totalStock <= lowThreshold,
          isOutOfStock: totalStock <= 0,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
      });

      reply.send({
        products: formattedProducts,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    }
  );

  // Get trashed products (paperera)
  fastify.get(
    '/trash',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = productTrashQuerySchema.parse(request.query);
      const { search, scope, limit, offset } = query;

      const scopeClause =
        scope === 'archived'
          ? { OR: [{ status: 'archived' as const }, { deletedAt: { not: null } }] }
          : { OR: [{ status: 'archived' as const }, { deletedAt: { not: null } }] };

      const where: any = {
        workspaceId,
        AND: [scopeClause],
      };

      if (search) {
        where.AND.push({
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        });
      }

      const [products, total] = await Promise.all([
        fastify.prisma.product.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          skip: offset,
          take: limit,
          include: {
            stockItems: {
              select: { quantity: true, reserved: true, lowThreshold: true },
            },
            categoryMappings: {
              include: {
                category: {
                  select: { id: true, name: true, color: true },
                },
              },
            },
          },
        }),
        fastify.prisma.product.count({ where }),
      ]);

      const formattedProducts = products.map((p) => {
        const totalStock = p.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
        const lowThreshold = p.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          description: p.description,
          shortDesc: p.shortDesc,
          unit: p.unit,
          unitValue: p.unitValue,
          secondaryUnit: p.secondaryUnit,
          secondaryUnitValue: p.secondaryUnitValue,
          category: p.category,
          categories: p.categoryMappings
            .filter((m) => m.category)
            .map((m) => ({
              id: m.category.id,
              name: m.category.name,
              color: m.category.color,
            })),
          price: p.price,
          comparePrice: p.comparePrice,
          images: p.images,
          attributes: p.attributes,
          keywords: p.keywords,
          status: p.status,
          deletedAt: p.deletedAt,
          stock: totalStock,
          lowThreshold,
          isLowStock: totalStock > 0 && totalStock <= lowThreshold,
          isOutOfStock: totalStock <= 0,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
      });

      return reply.send({
        products: formattedProducts,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    }
  );

  // Get product stats
  fastify.get(
    '/stats',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const [
        totalProducts,
        activeProducts,
        productsWithStock,
        categories,
      ] = await Promise.all([
        // Total products
        fastify.prisma.product.count({ where: { workspaceId, deletedAt: null, status: { not: 'archived' } } }),

        // Active products
        fastify.prisma.product.count({
          where: { workspaceId, status: 'active', deletedAt: null },
        }),

        // Products with stock info
        fastify.prisma.product.findMany({
          where: { workspaceId, deletedAt: null, status: { not: 'archived' } },
          select: {
            id: true,
            stockItems: {
              select: { quantity: true, reserved: true, lowThreshold: true },
            },
          },
        }),

        // Unique categories
        fastify.prisma.product.groupBy({
          by: ['category'],
          where: { workspaceId, deletedAt: null, status: { not: 'archived' }, category: { not: null } },
          _count: { id: true },
        }),
      ]);

      // Calculate stock stats
      let lowStockCount = 0;
      let outOfStockCount = 0;

      for (const p of productsWithStock) {
        const totalStock = p.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
        const lowThreshold = p.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

        if (totalStock <= 0) {
          outOfStockCount++;
        } else if (totalStock <= lowThreshold) {
          lowStockCount++;
        }
      }

      reply.send({
        totalProducts,
        activeProducts,
        lowStockCount,
        outOfStockCount,
        categories: categories.map((c) => ({
          name: c.category,
          count: c._count.id,
        })),
      });
    }
  );

  // Restore archived product
  fastify.post(
    '/:id/restore',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const product = await fastify.prisma.product.findFirst({
        where: {
          id,
          workspaceId,
          OR: [{ status: 'archived' }, { deletedAt: { not: null } }],
        },
      });

      if (!product) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found in trash' });
      }

      await fastify.prisma.product.updateMany({
        where: { id, workspaceId },
        data: {
          deletedAt: null,
          status: 'active',
        },
      });

      return reply.send({ success: true, productId: id, restored: true });
    }
  );

  // Permanent delete from trash (restricted if product has order history)
  fastify.delete(
    '/:id/permanent',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.product.findFirst({
        where: { id, workspaceId },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      const orderItems = await fastify.prisma.orderItem.count({
        where: { productId: id },
      });

      if (orderItems > 0) {
        return reply.code(409).send({
          error: 'HAS_ORDER_HISTORY',
          message: 'No se puede eliminar permanentemente: el producto tiene historial de pedidos.',
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.stockReservation.deleteMany({ where: { productId: id } });
        await tx.stockPurchaseReceiptItem.updateMany({
          where: { matchedProductId: id },
          data: { matchedProductId: null },
        });
        await tx.stockPurchaseReceiptItem.updateMany({
          where: { createdProductId: id },
          data: { createdProductId: null },
        });
        await tx.product.deleteMany({
          where: { id, workspaceId },
        });
      });

      return reply.send({ success: true, productId: id, hardDeleted: true });
    }
  );

  // Get single product
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const product = await fastify.prisma.product.findFirst({
        where: { id, workspaceId, deletedAt: null, status: { not: 'archived' } },
        include: {
          stockItems: true,
          variants: {
            where: { deletedAt: null },
            include: {
              stockItems: true,
            },
          },
        },
      });

      if (!product) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      const totalStock = product.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);

      reply.send({
        product: {
          ...product,
          stock: totalStock,
        },
      });
    }
  );

  // Create product
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const body = createProductSchema.parse(request.body);
      const workspaceLowThreshold = await getWorkspaceLowStockThreshold(
        fastify.prisma,
        workspaceId
      );
      const secondaryUnit = body.secondaryUnit ?? null;
      const secondaryUnitValue = normalizeSecondaryUnitValue(secondaryUnit, body.secondaryUnitValue);
      if (secondaryUnit && secondaryUnit !== 'dozen' && !secondaryUnitValue) {
        return reply.code(400).send({
          error: 'SECONDARY_UNIT_VALUE_REQUIRED',
          message: 'La segunda unidad requiere un valor (pack, caja o bulto).',
        });
      }

      // Check SKU uniqueness
      const existing = await fastify.prisma.product.findFirst({
        where: { workspaceId, sku: body.sku, deletedAt: null },
      });

      if (existing) {
        return reply.code(409).send({ error: 'SKU_EXISTS', message: 'A product with this SKU already exists' });
      }

      // Create product with optional initial stock
      const product = await fastify.prisma.product.create({
        data: {
          workspaceId,
          sku: body.sku,
          name: body.name,
          description: body.description,
          shortDesc: body.shortDesc,
          unit: body.unit || 'unit',
          unitValue: body.unit && body.unit !== 'unit' ? normalizeUnitValue(body.unitValue) : null,
          secondaryUnit,
          secondaryUnitValue,
          category: body.category,
          price: body.price,
          comparePrice: body.comparePrice,
          images: body.images || [],
          attributes: (body.attributes || {}) as any,
          keywords: body.keywords || [],
          status: body.status,
          stockItems: body.initialStock !== undefined ? {
            create: {
              quantity: body.initialStock,
              lowThreshold: body.lowThreshold ?? workspaceLowThreshold,
            },
          } : undefined,
          categoryMappings: body.categoryIds?.length ? {
            create: body.categoryIds.map((categoryId) => ({ categoryId })),
          } : undefined,
        },
        include: {
          stockItems: true,
          categoryMappings: {
            include: {
              category: {
                select: { id: true, name: true, color: true },
              },
            },
          },
        },
      });

      // Format response with categories
      const responseProduct = {
        ...product,
        categories: product.categoryMappings
          .filter((m) => m.category)
          .map((m) => ({
            id: m.category.id,
            name: m.category.name,
            color: m.category.color,
          })),
      };

      reply.code(201).send({ product: responseProduct });
    }
  );

  // Update product
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const body = updateProductSchema.parse(request.body);

      // Check product exists
      const existing = await fastify.prisma.product.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      // Check SKU uniqueness if changing
      if (body.sku && body.sku !== existing.sku) {
        const skuExists = await fastify.prisma.product.findFirst({
          where: { workspaceId, sku: body.sku, deletedAt: null, id: { not: id } },
        });
        if (skuExists) {
          return reply.code(409).send({ error: 'SKU_EXISTS', message: 'A product with this SKU already exists' });
        }
      }

      // Build update data with proper typing
      const { categoryIds, ...restBody } = body;
      const updateData: any = { ...restBody };
      if (body.attributes) {
        updateData.attributes = body.attributes as any;
      }
      if (body.unit !== undefined) {
        updateData.unit = body.unit ?? 'unit';
        updateData.unitValue = body.unit && body.unit !== 'unit' ? normalizeUnitValue(body.unitValue) : null;
      }
      if (body.unitValue !== undefined && body.unit === undefined) {
        updateData.unitValue = normalizeUnitValue(body.unitValue);
      }
      if (body.secondaryUnit !== undefined) {
        updateData.secondaryUnit = body.secondaryUnit;
        updateData.secondaryUnitValue = normalizeSecondaryUnitValue(body.secondaryUnit ?? null, body.secondaryUnitValue);
        if (body.secondaryUnit && body.secondaryUnit !== 'dozen' && !updateData.secondaryUnitValue) {
          return reply.code(400).send({
            error: 'SECONDARY_UNIT_VALUE_REQUIRED',
            message: 'La segunda unidad requiere un valor (pack, caja o bulto).',
          });
        }
      }
      if (body.secondaryUnitValue !== undefined && body.secondaryUnit === undefined) {
        updateData.secondaryUnitValue = normalizeSecondaryUnitValue(existing.secondaryUnit ?? null, body.secondaryUnitValue);
      }

      // Update product
      await fastify.prisma.product.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: updateData,
      });

      const product = await fastify.prisma.product.findFirst({
        where: { id, workspaceId },
        include: {
          stockItems: true,
          categoryMappings: {
            include: {
              category: {
                select: { id: true, name: true, color: true },
              },
            },
          },
        },
      });
      if (!product) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      // Update category mappings if provided
      if (categoryIds !== undefined) {
        // Remove all existing mappings
        await fastify.prisma.productCategoryMapping.deleteMany({
          where: { productId: id },
        });

        // Create new mappings
        if (categoryIds.length > 0) {
          await fastify.prisma.productCategoryMapping.createMany({
            data: categoryIds.map((categoryId) => ({
              productId: id,
              categoryId,
            })),
          });
        }

        // Refetch with updated categories
        const updatedProduct = await fastify.prisma.product.findFirst({
          where: { id, workspaceId },
          include: {
            stockItems: true,
            categoryMappings: {
              include: {
                category: {
                  select: { id: true, name: true, color: true },
                },
              },
            },
          },
        });

        const responseProduct = updatedProduct
          ? {
              ...updatedProduct,
              categories: updatedProduct.categoryMappings
                .filter((m) => m.category)
                .map((m) => ({
                  id: m.category.id,
                  name: m.category.name,
                  color: m.category.color,
                })),
            }
          : null;

        return reply.send({ product: responseProduct });
      }

      // Format response with categories
      const responseProduct = {
        ...product,
        categories: product.categoryMappings
          .filter((m) => m.category)
          .map((m) => ({
            id: m.category.id,
            name: m.category.name,
            color: m.category.color,
          })),
      };

      reply.send({ product: responseProduct });
    }
  );

  // Update stock
  fastify.patch(
    '/:id/stock',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const body = updateStockSchema.parse(request.body);

      // Check product exists
      const product = await fastify.prisma.product.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: { stockItems: true },
      });

      if (!product) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      // Get or create stock item
      let stockItem = product.stockItems[0];
      const previousQty = stockItem?.quantity || 0;
      const previousReserved = stockItem?.reserved || 0;
      const previousAvailable = previousQty - previousReserved;
      const newQty = previousQty + body.quantity;

      if (newQty < 0) {
        return reply.code(400).send({ error: 'INSUFFICIENT_STOCK', message: 'Cannot reduce stock below zero' });
      }

      if (stockItem) {
        // Update existing
        stockItem = await fastify.prisma.stockItem.update({
          where: { id: stockItem.id },
          data: { quantity: newQty },
        });

        // Record movement
        await fastify.prisma.stockMovement.create({
          data: {
            stockItemId: stockItem.id,
            type: body.quantity > 0 ? 'adjustment' : 'adjustment',
            quantity: body.quantity,
            previousQty,
            newQty,
            reason: body.reason || 'Manual adjustment',
          },
        });
      } else {
        // Create new
        stockItem = await fastify.prisma.stockItem.create({
          data: {
            productId: id,
            quantity: newQty,
            lowThreshold: await getWorkspaceLowStockThreshold(fastify.prisma, workspaceId),
          },
        });

        await fastify.prisma.stockMovement.create({
          data: {
            stockItemId: stockItem.id,
            type: 'adjustment',
            quantity: body.quantity,
            previousQty: 0,
            newQty,
            reason: body.reason || 'Initial stock',
          },
        });
      }

      const lowThreshold = stockItem.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      const availableAfter = newQty - previousReserved;
      if (availableAfter <= lowThreshold && availableAfter !== previousAvailable) {
        const displayName = buildProductDisplayName(product);
        await createNotificationIfEnabled(fastify.prisma, {
          workspaceId,
          type: 'stock.low',
          title: `Stock bajo: ${displayName}`,
          message: `Quedan ${availableAfter} unidades (mínimo ${lowThreshold}).`,
          entityType: 'Product',
          entityId: product.id,
          metadata: {
            productId: product.id,
            productName: displayName,
            available: availableAfter,
            lowThreshold,
            sku: product.sku,
          },
        });
      }

      reply.send({
        stock: {
          productId: id,
          previousQuantity: previousQty,
          adjustment: body.quantity,
          newQuantity: newQty,
        },
      });
    }
  );

  // Delete product (hard delete when safe, otherwise soft delete)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.product.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      const deletedAt = new Date();
      const result = await fastify.prisma.product.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: { deletedAt, status: 'archived' },
      });

      if (result.count === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Product not found' });
      }

      return reply.send({ success: true, hardDeleted: false, reason: 'SOFT_DELETE' });
    }
  );

  // Bulk delete products (always soft delete to keep history and avoid FK conflicts)
  fastify.delete(
    '/bulk',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const body = bulkDeleteSchema.parse(request.body);

      const productIds = body.productIds;
      const deletedAt = new Date();
      const result = await fastify.prisma.product.updateMany({
        where: {
          id: { in: productIds },
          workspaceId,
          deletedAt: null,
        },
        data: { deletedAt, status: 'archived' },
      });

      reply.send({
        success: true,
        deletedCount: result.count,
        hardDeletedCount: 0,
        softDeletedCount: result.count,
      });
    }
  );

  // Get categories
  fastify.get(
    '/categories/list',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const categories = await fastify.prisma.product.groupBy({
        by: ['category'],
        where: { workspaceId, deletedAt: null, category: { not: null } },
        _count: { id: true },
        orderBy: { category: 'asc' },
      });

      reply.send({
        categories: categories
          .filter((c) => c.category)
          .map((c) => ({
            name: c.category,
            productCount: c._count.id,
          })),
      });
    }
  );
};
