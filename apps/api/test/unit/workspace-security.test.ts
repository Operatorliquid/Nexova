import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { workspaceRoutes } from '../../src/routes/v1/workspace.routes.js';

type MembershipMock = {
  id: string;
  status: string;
  inviteExpiresAt: Date | null;
  workspace: { id: string; name: string; slug: string };
  role: { id: string; name: string };
};

function buildWorkspaceTestApp(prisma: {
  membership: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}) {
  const app = Fastify({ logger: false });
  const appAny = app as any;

  appAny.decorate('prisma', prisma);
  appAny.decorate('authenticate', async (request: any) => {
    request.user = {
      sub: (request.headers['x-user-id'] as string) || 'user-test',
      isSuperAdmin: false,
    };
    request.workspaceId = (request.headers['x-workspace-id'] as string) || undefined;
  });
  appAny.decorate('requirePermission', () => {
    return async (request: any, _reply: any) => {
      request.user = {
        sub: (request.headers['x-user-id'] as string) || 'user-test',
        isSuperAdmin: false,
      };
      request.workspaceId = (request.headers['x-workspace-id'] as string) || undefined;
    };
  });

  app.register(workspaceRoutes, { prefix: '/workspaces' });
  return app;
}

describe('workspace security routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists only pending invitations for the authenticated user', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'mem-1',
        status: 'INVITED',
        inviteExpiresAt: null,
        workspace: { id: 'ws-1', name: 'Workspace 1', slug: 'workspace-1' },
        role: { id: 'role-1', name: 'viewer' },
      } satisfies MembershipMock,
    ]);
    const app = buildWorkspaceTestApp({
      membership: {
        findMany,
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/workspaces/available',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspaces: [
        {
          id: 'ws-1',
          name: 'Workspace 1',
          slug: 'workspace-1',
          role: { id: 'role-1', name: 'viewer' },
          inviteExpiresAt: null,
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-123',
          status: { in: ['invited', 'INVITED'] },
        }),
      })
    );

    await app.close();
  });

  it('rejects join without invitation', async () => {
    const app = buildWorkspaceTestApp({
      membership: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/workspaces/ws-1/join',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'INVITE_REQUIRED' });

    await app.close();
  });

  it('rejects expired invitation on join', async () => {
    const invitedMembership: MembershipMock = {
      id: 'mem-1',
      status: 'INVITED',
      inviteExpiresAt: new Date(Date.now() - 60_000),
      workspace: { id: 'ws-1', name: 'Workspace 1', slug: 'workspace-1' },
      role: { id: 'role-1', name: 'viewer' },
    };
    const app = buildWorkspaceTestApp({
      membership: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(invitedMembership),
        update: vi.fn(),
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/workspaces/ws-1/join',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: 'INVITE_EXPIRED' });

    await app.close();
  });

  it('accepts valid invitation and activates membership', async () => {
    const invitedMembership: MembershipMock = {
      id: 'mem-1',
      status: 'invited',
      inviteExpiresAt: new Date(Date.now() + 60_000),
      workspace: { id: 'ws-1', name: 'Workspace 1', slug: 'workspace-1' },
      role: { id: 'role-1', name: 'viewer' },
    };
    const update = vi.fn().mockResolvedValue({
      ...invitedMembership,
      status: 'ACTIVE',
      joinedAt: new Date(),
      inviteToken: null,
      inviteExpiresAt: null,
    });
    const app = buildWorkspaceTestApp({
      membership: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(invitedMembership),
        update,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/workspaces/ws-1/join',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem-1' },
        data: expect.objectContaining({ status: 'ACTIVE', inviteToken: null }),
      })
    );

    await app.close();
  });

  it('blocks self role change even with permission prehandler', async () => {
    const app = buildWorkspaceTestApp({
      membership: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'PATCH',
      url: '/workspaces/ws-1/members/me/role',
      headers: {
        'x-user-id': 'user-123',
        'x-workspace-id': 'ws-1',
      },
      payload: { roleId: 'role-2' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'SELF_ROLE_CHANGE_DISABLED' });

    await app.close();
  });
});
