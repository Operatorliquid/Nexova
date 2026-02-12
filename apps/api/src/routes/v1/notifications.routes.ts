/**
 * Notifications Routes
 * Provides workspace notifications for dashboard
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const listNotificationsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  unread: z.string().optional(),
});

const parseUnread = (value?: string) => {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
};

export const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get notifications list
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string | undefined;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = listNotificationsSchema.parse(request.query);
      const unreadFilter = parseUnread(query.unread);
      const readCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const where: any = { workspaceId };
      if (unreadFilter === true) {
        where.readAt = null;
      } else if (unreadFilter === false) {
        where.readAt = { not: null, gte: readCutoff };
      } else {
        where.OR = [{ readAt: null }, { readAt: { gte: readCutoff } }];
      }

      const [notifications, unreadCount, total] = await Promise.all([
        fastify.prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: query.offset,
          take: query.limit,
        }),
        fastify.prisma.notification.count({
          where: { workspaceId, readAt: null },
        }),
        fastify.prisma.notification.count({ where }),
      ]);

      reply.send({
        notifications,
        unreadCount,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + query.limit < total,
        },
      });
    }
  );

  // Mark notification as read
  fastify.patch<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string | undefined;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const { id } = request.params;
      const result = await fastify.prisma.notification.updateMany({
        where: { id, workspaceId, readAt: null },
        data: { readAt: new Date() },
      });

      reply.send({ success: true, updated: result.count > 0 });
    }
  );

  // Mark all notifications as read
  fastify.post(
    '/read-all',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string | undefined;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const result = await fastify.prisma.notification.updateMany({
        where: { workspaceId, readAt: null },
        data: { readAt: new Date() },
      });

      reply.send({ success: true, updated: result.count });
    }
  );
};
