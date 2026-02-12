/**
 * Authentication Routes
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthService, WorkspaceService } from '@nexova/core';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.prisma);
  const workspaceService = new WorkspaceService(fastify.prisma);
  const cookieSameSiteRaw = (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
  const cookieSameSite: 'lax' | 'strict' | 'none' =
    cookieSameSiteRaw === 'none' || cookieSameSiteRaw === 'strict' || cookieSameSiteRaw === 'lax'
      ? cookieSameSiteRaw
      : 'lax';
  const cookieSecure = process.env.NODE_ENV === 'production' || cookieSameSite === 'none';

  const setAuthCookies = (
    reply: import('fastify').FastifyReply,
    tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date }
  ) => {
    const base = {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: '/',
    };
    reply.setCookie('accessToken', tokens.accessToken, {
      ...base,
      expires: tokens.accessTokenExpiresAt,
    });
    reply.setCookie('refreshToken', tokens.refreshToken, {
      ...base,
      expires: tokens.refreshTokenExpiresAt,
    });
  };

  const clearAuthCookies = (reply: import('fastify').FastifyReply) => {
    reply.clearCookie('accessToken', {
      path: '/',
      secure: cookieSecure,
      sameSite: cookieSameSite,
    });
    reply.clearCookie('refreshToken', {
      path: '/',
      secure: cookieSecure,
      sameSite: cookieSameSite,
    });
  };

  const buildWorkspaceName = (user: { firstName?: string | null; email?: string | null }) => {
    if (user.firstName?.trim()) {
      return user.firstName.trim();
    }
    if (user.email) {
      const prefix = user.email.split('@')[0];
      return prefix || `business-${Date.now()}`;
    }
    return `business-${Date.now()}`;
  };

  const buildWorkspaceSlug = (name: string) => {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return base || 'business';
  };

  const fetchMemberships = async (userId: string) => {
    return fastify.prisma.membership.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            status: true,
            settings: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    });
  };

  const mapWorkspaces = (memberships: Awaited<ReturnType<typeof fetchMemberships>>) => {
    return memberships.map((m) => {
      const settings = (m.workspace.settings as Record<string, unknown>) || {};
      const rawBusinessType = typeof settings.businessType === 'string'
        ? settings.businessType.toLowerCase()
        : '';
      const businessType = rawBusinessType === 'bookings' ? 'bookings' : 'commerce';
      return {
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        plan: m.workspace.plan,
        status: m.workspace.status,
        role: m.role,
        onboardingCompleted: true,
        businessType,
      };
    });
  };

  const ensureWorkspaceForUser = async (user: { id: string; firstName?: string | null; email?: string | null; isSuperAdmin?: boolean }) => {
    let memberships = await fetchMemberships(user.id);

    if (memberships.length === 0 && !user.isSuperAdmin) {
      const workspaceName = buildWorkspaceName(user);
      const workspaceSlug = buildWorkspaceSlug(workspaceName);

      await workspaceService.create({
        name: workspaceName,
        slug: `${workspaceSlug}-${Date.now()}`,
        ownerId: user.id,
      });

      memberships = await fetchMemberships(user.id);
    }

    // Legacy safety for 1 user = 1 workspace model:
    // if the user is the only member in their only workspace, force Owner role.
    if (!user.isSuperAdmin && memberships.length === 1) {
      const [membership] = memberships;
      const isOwner = membership.role.name === 'Owner' || membership.role.permissions.includes('*');
      if (!isOwner) {
        const activeMembers = await fastify.prisma.membership.count({
          where: {
            workspaceId: membership.workspace.id,
            status: { in: ['ACTIVE', 'active'] },
          },
        });

        if (activeMembers <= 1) {
          const ownerRole = await fastify.prisma.role.findFirst({
            where: { workspaceId: membership.workspace.id, name: 'Owner' },
            select: { id: true },
          });

          if (ownerRole) {
            await fastify.prisma.membership.updateMany({
              where: {
                userId: user.id,
                workspaceId: membership.workspace.id,
              },
              data: {
                roleId: ownerRole.id,
                status: 'ACTIVE',
                joinedAt: membership.joinedAt ?? new Date(),
              },
            });
            memberships = await fetchMemberships(user.id);
          }
        }
      }
    }

    return memberships;
  };

  // Register
  fastify.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const result = await authService.register({
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
    });

    const memberships = await ensureWorkspaceForUser(result.user);
    const workspaces = mapWorkspaces(memberships);
    const workspace = workspaces[0] || null;

    if (!workspace) {
      throw new Error('Failed to create workspace membership');
    }

    setAuthCookies(reply, result.tokens);

    reply.code(201).send({
      user: result.user,
      workspace,
      workspaces,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: result.tokens.accessTokenExpiresAt,
    });
  });

  // Login
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const result = await authService.login({
      email: body.email,
      password: body.password,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    const memberships = await ensureWorkspaceForUser(result.user);
    const workspaces = mapWorkspaces(memberships);
    const workspace = workspaces[0] || null;

    setAuthCookies(reply, result.tokens);

    reply.send({
      user: result.user,
      workspace,
      workspaces,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: result.tokens.accessTokenExpiresAt,
    });
  });

  // Refresh token
  fastify.post('/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body || {});
    const cookieRefresh =
      typeof (request as any).cookies?.refreshToken === 'string'
        ? (request as any).cookies.refreshToken
        : undefined;
    const refreshToken = body.refreshToken || cookieRefresh;

    if (!refreshToken) {
      return reply.status(400).send({ error: 'REFRESH_TOKEN_REQUIRED' });
    }

    const result = await authService.refresh(
      refreshToken,
      request.ip,
      request.headers['user-agent']
    );

    setAuthCookies(reply, result.tokens);

    reply.send({
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: result.tokens.accessTokenExpiresAt,
    });
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    const body = refreshSchema.parse(request.body || {});
    const cookieRefresh =
      typeof (request as any).cookies?.refreshToken === 'string'
        ? (request as any).cookies.refreshToken
        : undefined;
    const refreshToken = body.refreshToken || cookieRefresh;

    if (refreshToken) {
      await authService.logout(refreshToken);
    }

    clearAuthCookies(reply);

    reply.send({ success: true });
  });

  // Get current user with workspaces (protected)
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
      config: { allowMissingWorkspace: true, allowSuspendedWorkspace: true },
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      // Get user
      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          isSuperAdmin: true,
          status: true,
        },
      });

      if (!user) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      const memberships = await ensureWorkspaceForUser({
        id: user.id,
        firstName: user.firstName,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
      });
      const workspacesWithSettings = mapWorkspaces(memberships);

      // Get current workspace from header or first available
      const currentWorkspaceId = request.headers['x-workspace-id'] as string;
      const workspace = currentWorkspaceId
        ? workspacesWithSettings.find((w) => w.id === currentWorkspaceId)
        : workspacesWithSettings[0] || null;

      reply.send({ user, workspace, workspaces: workspacesWithSettings });
    }
  );

  // Update profile (protected)
  fastify.patch(
    '/profile',
    {
      preHandler: [fastify.authenticate],
      config: { allowMissingWorkspace: true, allowSuspendedWorkspace: true },
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = z
        .object({
          firstName: z.string().min(1).max(100).optional(),
          lastName: z.string().min(1).max(100).optional(),
          avatarUrl: z.string().url().nullable().optional(),
        })
        .parse(request.body);

      const user = await fastify.prisma.user.update({
        where: { id: userId },
        data: body,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          isSuperAdmin: true,
        },
      });

      reply.send({ user });
    }
  );

  // Logout from all devices (protected)
  fastify.post(
    '/logout-all',
    {
      preHandler: [fastify.authenticate],
      config: { allowMissingWorkspace: true, allowSuspendedWorkspace: true },
    },
    async (request, reply) => {
      await authService.logoutAll(request.user!.sub);
      reply.send({ success: true });
    }
  );
};
