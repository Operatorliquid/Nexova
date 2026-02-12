/**
 * Quick Actions Routes
 * API endpoints for executing quick actions from the dashboard
 */
import { FastifyInstance } from 'fastify';
import { QuickActionService, COMMAND_SUGGESTIONS } from '../../services/quick-action/index.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';

export async function quickActionsRoutes(app: FastifyInstance): Promise<void> {
  const quickActionService = new QuickActionService(app.prisma);

  /**
   * Get user role in workspace
   */
  async function getUserRole(workspaceId: string, userId: string): Promise<string | null> {
    const membership = await app.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: {
        role: { select: { name: true } },
      },
    });

    return membership?.role?.name?.toLowerCase() || null;
  }

  async function isCommerceWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const settings = (workspace?.settings as Record<string, unknown>) || {};
    const businessType = (settings.businessType as string) || 'commerce';
    return businessType === 'commerce';
  }

  async function quickActionsEnabledForContext(
    workspaceId: string,
    roleName?: string | null
  ): Promise<boolean> {
    const context = await getWorkspacePlanContext(app.prisma, workspaceId, roleName);
    return context.capabilities.showQuickActions;
  }

  /**
   * POST /quick-actions/execute
   * Execute a quick action command
   */
  app.post<{
    Body: {
      command: string;
      confirmationToken?: string;
      skipConfirmation?: boolean;
    };
  }>('/execute', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1, maxLength: 500 },
          confirmationToken: { type: 'string' },
          skipConfirmation: { type: 'boolean' },
        },
        required: ['command'],
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      const userId = request.user?.sub;

      if (!workspaceId || !userId) {
        return reply.status(400).send({ error: 'Workspace and user required' });
      }

      if (!(await isCommerceWorkspace(workspaceId))) {
        return reply.status(403).send({ error: 'Quick Actions solo está disponible para comercios' });
      }

      // Get user role from workspace membership
      const role = await getUserRole(workspaceId, userId);

      if (!role) {
        return reply.status(403).send({ error: 'No sos miembro de este workspace' });
      }

      if (!(await quickActionsEnabledForContext(workspaceId, role))) {
        return reply.status(403).send({ error: 'No tenés permiso para usar Quick Actions' });
      }

      const result = await quickActionService.execute(
        {
          command: request.body.command,
          workspaceId,
          userId,
          confirmationToken: request.body.confirmationToken,
          skipConfirmation: request.body.skipConfirmation,
        },
        role
      );

      return reply.send(result);
    },
  });

  /**
   * POST /quick-actions/confirm
   * Confirm a pending dangerous action
   */
  app.post<{
    Body: {
      token: string;
    };
  }>('/confirm', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
        required: ['token'],
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      const userId = request.user?.sub;

      if (!workspaceId || !userId) {
        return reply.status(400).send({ error: 'Workspace and user required' });
      }

      if (!(await isCommerceWorkspace(workspaceId))) {
        return reply.status(403).send({ error: 'Quick Actions solo está disponible para comercios' });
      }

      const role = await getUserRole(workspaceId, userId);

      if (!role) {
        return reply.status(403).send({ error: 'No sos miembro de este workspace' });
      }

      if (!(await quickActionsEnabledForContext(workspaceId, role))) {
        return reply.status(403).send({ error: 'No tenés permiso para usar Quick Actions' });
      }

      const result = await quickActionService.execute(
        {
          command: '', // Will be retrieved from pending confirmation
          workspaceId,
          userId,
          confirmationToken: request.body.token,
        },
        role
      );

      return reply.send(result);
    },
  });

  /**
   * GET /quick-actions/history
   * Get quick action history
   */
  app.get<{
    Querystring: { limit?: number };
  }>('/history', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;

      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      if (!(await isCommerceWorkspace(workspaceId))) {
        return reply.status(403).send({ error: 'Quick Actions solo está disponible para comercios' });
      }

      const role = await getUserRole(workspaceId, request.user!.sub);
      if (!role) {
        return reply.status(403).send({ error: 'No sos miembro de este workspace' });
      }
      if (!(await quickActionsEnabledForContext(workspaceId, role))) {
        return reply.status(403).send({ error: 'No tenés permiso para usar Quick Actions' });
      }

      const history = await quickActionService.getHistory(
        workspaceId,
        request.query.limit || 50
      );

      return reply.send({ history });
    },
  });

  /**
   * POST /quick-actions/:id/rerun
   * Re-run a previous action
   */
  app.post<{
    Params: { id: string };
  }>('/:id/rerun', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      const userId = request.user?.sub;

      if (!workspaceId || !userId) {
        return reply.status(400).send({ error: 'Workspace and user required' });
      }

      if (!(await isCommerceWorkspace(workspaceId))) {
        return reply.status(403).send({ error: 'Quick Actions solo está disponible para comercios' });
      }

      const role = await getUserRole(workspaceId, userId);

      if (!role) {
        return reply.status(403).send({ error: 'No sos miembro de este workspace' });
      }

      if (!(await quickActionsEnabledForContext(workspaceId, role))) {
        return reply.status(403).send({ error: 'No tenés permiso para usar Quick Actions' });
      }

      try {
        const result = await quickActionService.rerun(
          request.params.id,
          userId,
          role,
          workspaceId
        );
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return reply.status(400).send({ error: message });
      }
    },
  });

  /**
   * GET /quick-actions/suggestions
   * Get command suggestions for autocomplete
   */
  app.get('/suggestions', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (workspaceId && !(await isCommerceWorkspace(workspaceId))) {
        return reply.status(403).send({ error: 'Quick Actions solo está disponible para comercios' });
      }
      if (workspaceId) {
        const role = await getUserRole(workspaceId, request.user!.sub);
        if (!role) {
          return reply.status(403).send({ error: 'No sos miembro de este workspace' });
        }
        if (!(await quickActionsEnabledForContext(workspaceId, role))) {
          return reply.status(403).send({ error: 'No tenés permiso para usar Quick Actions' });
        }
      }
      return reply.send({ suggestions: COMMAND_SUGGESTIONS });
    },
  });
}
