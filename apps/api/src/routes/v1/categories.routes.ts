/**
 * Categories Routes
 * CRUD operations for product category management
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const categoryQuerySchema = z.object({
  includeProductCount: z.coerce.boolean().default(true),
  includeDeleted: z.coerce.boolean().default(false),
});

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

const assignProductsSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1),
});

export const categoriesRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all categories
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = categoryQuerySchema.parse(request.query);
      const { includeProductCount, includeDeleted } = query;

      const where: any = { workspaceId };
      if (!includeDeleted) {
        where.deletedAt = null;
      }

      const categories = await fastify.prisma.productCategory.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: includeProductCount ? {
          products: {
            where: {
              product: { deletedAt: null },
            },
            select: { id: true },
          },
        } : undefined,
      });

      const formattedCategories = categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        color: c.color,
        sortOrder: c.sortOrder,
        productCount: includeProductCount ? (c as any).products?.length || 0 : undefined,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));

      reply.send({ categories: formattedCategories });
    }
  );

  // Get single category
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const category = await fastify.prisma.productCategory.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: {
          products: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  price: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      if (!category) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Category not found' });
      }

      reply.send({
        category: {
          id: category.id,
          name: category.name,
          description: category.description,
          color: category.color,
          sortOrder: category.sortOrder,
          products: category.products.map((p) => p.product),
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        },
      });
    }
  );

  // Create category
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const body = createCategorySchema.parse(request.body);

      // Check name uniqueness within workspace
      const existing = await fastify.prisma.productCategory.findFirst({
        where: { workspaceId, name: body.name, deletedAt: null },
      });

      if (existing) {
        return reply.code(409).send({ error: 'NAME_EXISTS', message: 'A category with this name already exists' });
      }

      const category = await fastify.prisma.productCategory.create({
        data: {
          workspaceId,
          name: body.name,
          description: body.description,
          color: body.color,
          sortOrder: body.sortOrder || 0,
        },
      });

      reply.code(201).send({ category });
    }
  );

  // Update category
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };
      const body = updateCategorySchema.parse(request.body);

      // Check category exists
      const existing = await fastify.prisma.productCategory.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Category not found' });
      }

      // Check name uniqueness if changing
      if (body.name && body.name !== existing.name) {
        const nameExists = await fastify.prisma.productCategory.findFirst({
          where: { workspaceId, name: body.name, deletedAt: null, id: { not: id } },
        });
        if (nameExists) {
          return reply.code(409).send({ error: 'NAME_EXISTS', message: 'A category with this name already exists' });
        }
      }

      await fastify.prisma.productCategory.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: body,
      });

      const category = await fastify.prisma.productCategory.findFirst({
        where: { id, workspaceId },
      });

      reply.send({ category });
    }
  );

  // Delete category (soft delete)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params as { id: string };

      const existing = await fastify.prisma.productCategory.findFirst({
        where: { id, workspaceId, deletedAt: null },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Category not found' });
      }

      // Soft delete the category (mappings will remain but category won't show)
      await fastify.prisma.productCategory.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      // Also remove all product-category mappings for this category
      await fastify.prisma.productCategoryMapping.deleteMany({
        where: { categoryId: id },
      });

      reply.send({ success: true });
    }
  );

  // Assign products to category
  fastify.post(
    '/:id/products',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id: categoryId } = request.params as { id: string };
      const body = assignProductsSchema.parse(request.body);

      // Check category exists
      const category = await fastify.prisma.productCategory.findFirst({
        where: { id: categoryId, workspaceId, deletedAt: null },
      });

      if (!category) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Category not found' });
      }

      // Verify all products belong to the workspace
      const products = await fastify.prisma.product.findMany({
        where: { id: { in: body.productIds }, workspaceId, deletedAt: null },
        select: { id: true },
      });

      const validProductIds = products.map((p) => p.id);
      const invalidProductIds = body.productIds.filter((id) => !validProductIds.includes(id));

      if (invalidProductIds.length > 0) {
        return reply.code(400).send({
          error: 'INVALID_PRODUCTS',
          message: 'Some products were not found',
          invalidProductIds,
        });
      }

      // Create mappings (upsert to avoid duplicates)
      const mappings = await Promise.all(
        validProductIds.map((productId) =>
          fastify.prisma.productCategoryMapping.upsert({
            where: { productId_categoryId: { productId, categoryId } },
            create: { productId, categoryId },
            update: {},
          })
        )
      );

      reply.send({
        success: true,
        assignedCount: mappings.length,
      });
    }
  );

  // Remove product from category
  fastify.delete(
    '/:id/products/:productId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id: categoryId, productId } = request.params as { id: string; productId: string };

      // Verify category belongs to workspace
      const category = await fastify.prisma.productCategory.findFirst({
        where: { id: categoryId, workspaceId, deletedAt: null },
      });

      if (!category) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Category not found' });
      }

      // Delete the mapping
      await fastify.prisma.productCategoryMapping.deleteMany({
        where: { productId, categoryId },
      });

      reply.send({ success: true });
    }
  );
};
