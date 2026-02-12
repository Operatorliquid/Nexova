/**
 * Workspace Service
 * Handles workspace (tenant) CRUD operations
 */
import { PrismaClient, Workspace, Membership, Prisma } from '@prisma/client';
import { SYSTEM_ROLES, DEFAULT_ROLES } from '@nexova/shared';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  ownerId: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  phone?: string;
  settings?: Prisma.InputJsonValue;
}

export class WorkspaceService {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    // Validate slug uniqueness
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: input.slug },
    });

    if (existing) {
      throw new WorkspaceError('SLUG_EXISTS', 'Workspace slug already exists');
    }

    // Create workspace with default roles in a transaction
    const workspace = await this.prisma.$transaction(async (tx) => {
      // Create workspace
      const ws = await tx.workspace.create({
        data: {
          name: input.name,
          slug: input.slug.toLowerCase(),
          settings: {
            currency: 'ARS',
            timezone: 'America/Argentina/Buenos_Aires',
            language: 'es',
            businessType: 'commerce',
            tools: ['products', 'stock', 'orders', 'customers', 'payments'],
          },
        },
      });

      // Create Owner role (system)
      const ownerRole = await tx.role.create({
        data: {
          workspaceId: ws.id,
          name: 'Owner',
          description: SYSTEM_ROLES.OWNER.description,
          isSystem: true,
          permissions: SYSTEM_ROLES.OWNER.permissions,
        },
      });

      // Create Admin role (system)
      await tx.role.create({
        data: {
          workspaceId: ws.id,
          name: 'Admin',
          description: SYSTEM_ROLES.ADMIN.description,
          isSystem: true,
          permissions: SYSTEM_ROLES.ADMIN.permissions,
        },
      });

      // Create default roles
      for (const [_key, role] of Object.entries(DEFAULT_ROLES)) {
        await tx.role.create({
          data: {
            workspaceId: ws.id,
            name: role.name,
            description: role.description,
            isSystem: false,
            permissions: role.permissions,
          },
        });
      }

      // Add owner as member with Owner role
      await tx.membership.create({
        data: {
          userId: input.ownerId,
          workspaceId: ws.id,
          roleId: ownerRole.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      return ws;
    });

    return workspace;
  }

  async getById(id: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({
      where: { id },
    });
  }

  async getBySlug(slug: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({
      where: { slug },
    });
  }

  async getUserWorkspaces(userId: string): Promise<(Workspace & { membership: Membership })[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: {
        workspace: true,
      },
    });

    return memberships.map((m) => ({
      ...m.workspace,
      membership: m,
    }));
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    return this.prisma.workspace.update({
      where: { id },
      data: input,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.workspace.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  async getMembers(workspaceId: string) {
    return this.prisma.membership.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            status: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async inviteMember(
    workspaceId: string,
    email: string,
    roleId: string,
    _invitedBy: string
  ): Promise<Membership> {
    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Create placeholder user (will set password on first login)
      user = await this.prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash: '', // Will be set when user accepts invite
          status: 'pending_verification',
        },
      });
    }

    // Check if already a member
    const existing = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId,
        },
      },
    });

    if (existing) {
      throw new WorkspaceError('ALREADY_MEMBER', 'User is already a member of this workspace');
    }

    // Create invite token
    const inviteToken = crypto.randomUUID();

    return this.prisma.membership.create({
      data: {
        userId: user.id,
        workspaceId,
        roleId,
        status: 'invited',
        inviteToken,
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.prisma.membership.delete({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
    });
  }
}

export class WorkspaceError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}
