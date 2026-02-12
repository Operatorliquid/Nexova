/**
 * Auth Plugin for Fastify
 * Handles JWT verification and tenant context
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  verifyAccessToken,
  AccessTokenPayload,
  PermissionService,
  TenantContext,
  runWithContext,
} from '@nexova/core';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessTokenPayload;
    workspaceId?: string;
    permissions?: string[];
    tenantContext?: TenantContext;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: string
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPluginCallback: FastifyPluginAsync = async (fastify) => {
  const permissionService = new PermissionService(fastify.prisma);

  // Authentication decorator
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const authHeader = request.headers.authorization;
      const cookieToken =
        typeof (request as any).cookies?.accessToken === 'string'
          ? (request as any).cookies.accessToken
          : undefined;

      if (!authHeader?.startsWith('Bearer ') && !cookieToken) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Missing or invalid authorization header',
        });
      }

      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : cookieToken!;

      try {
        const payload = verifyAccessToken(token);
        request.user = payload;

        const allowMissingWorkspace =
          request.routeOptions?.config &&
          (request.routeOptions.config as { allowMissingWorkspace?: boolean })
            .allowMissingWorkspace === true;
        const allowSuspendedWorkspace =
          request.routeOptions?.config &&
          (request.routeOptions.config as { allowSuspendedWorkspace?: boolean })
            .allowSuspendedWorkspace === true;

        // If workspace header is present, load permissions
        const workspaceId = request.headers['x-workspace-id'] as string | undefined;

        if (!workspaceId) {
          if (!payload.isSuperAdmin && !allowMissingWorkspace) {
            return reply.code(400).send({
              error: 'BAD_REQUEST',
              message: 'x-workspace-id header is required',
            });
          }
          return;
        }

        request.workspaceId = workspaceId;

        // Super admin has all permissions
        if (payload.isSuperAdmin) {
          request.permissions = ['*'];
        } else {
          request.permissions = await permissionService.getUserPermissions(
            payload.sub,
            workspaceId
          );

          // Verify user is a member of the workspace
          if (request.permissions.length === 0) {
            return reply.code(403).send({
              error: 'FORBIDDEN',
              message: 'You are not a member of this workspace',
            });
          }
        }

        // Paywall: block access when the workspace is not active, unless a route explicitly opts out.
        if (!payload.isSuperAdmin && !allowSuspendedWorkspace) {
          const workspace = await fastify.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { status: true },
          });

          if (!workspace) {
            return reply.code(404).send({
              error: 'NOT_FOUND',
              message: 'Workspace not found',
            });
          }

          const status = (workspace.status || '').toLowerCase();
          if (status && status !== 'active') {
            const message =
              status === 'suspended'
                ? 'Tu suscripcion esta suspendida. Para reactivar el acceso, regulariza el pago.'
                : status === 'cancelled' || status === 'canceled'
                  ? 'Tu suscripcion esta cancelada. Para reactivar el acceso, elegi un plan nuevamente.'
                  : 'Tu suscripcion no esta activa. Para reactivar el acceso, regulariza el pago.';

            return reply.code(402).send({
              error: 'PAYMENT_REQUIRED',
              message,
              workspaceStatus: workspace.status,
            });
          }
        }
      } catch (err) {
        return reply.code(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired access token',
        });
      }
    }
  );

  // Super admin check decorator
  fastify.decorate(
    'requireSuperAdmin',
    async function (request: FastifyRequest, reply: FastifyReply) {
      await fastify.authenticate(request, reply);

      if (!request.user?.isSuperAdmin) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Super admin access required',
        });
      }
    }
  );

  // Permission check decorator factory
  fastify.decorate('requirePermission', function (permission: string) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      await fastify.authenticate(request, reply);

      if (!request.workspaceId) {
        return reply.code(400).send({
          error: 'BAD_REQUEST',
          message: 'x-workspace-id header is required',
        });
      }

      // Super admin bypasses permission check
      if (request.user?.isSuperAdmin) {
        return;
      }

      const hasPermission = request.permissions?.some((p) => {
        if (p === '*') return true;
        if (p === permission) return true;
        const [resource] = permission.split(':');
        const [grantedResource, grantedAction] = p.split(':');
        return resource === grantedResource && grantedAction === '*';
      });

      if (!hasPermission) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: `Permission '${permission}' required`,
        });
      }
    };
  });

  // Hook to set up tenant context for authenticated requests
  fastify.addHook('preHandler', (request, _reply, done) => {
    if (request.user && request.workspaceId) {
      request.tenantContext = {
        userId: request.user.sub,
        workspaceId: request.workspaceId,
        permissions: request.permissions || [],
        isSuperAdmin: request.user.isSuperAdmin,
        requestId: request.id,
      };
      return runWithContext(request.tenantContext, done);
    }
    return done();
  });
};

export const authPlugin = fp(authPluginCallback, {
  name: 'auth',
  dependencies: ['prisma'],
});
