/**
 * RBAC Permission Service
 * Handles permission checking with wildcard support
 */
import { PrismaClient } from '@prisma/client';

export type Permission = string;

/**
 * Check if a granted permission matches a required permission
 * Supports wildcards: '*' matches all, 'resource:*' matches all actions on resource
 */
export function permissionMatches(
  required: Permission,
  granted: Permission
): boolean {
  // Global wildcard matches everything
  if (granted === '*') return true;

  // Exact match
  if (required === granted) return true;

  // Resource wildcard (e.g., 'orders:*' matches 'orders:read')
  const [requiredResource] = required.split(':');
  const [grantedResource, grantedAction] = granted.split(':');

  if (requiredResource === grantedResource && grantedAction === '*') {
    return true;
  }

  return false;
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(
  userPermissions: Permission[],
  required: Permission
): boolean {
  return userPermissions.some((granted) => permissionMatches(required, granted));
}

/**
 * Check if user has all required permissions
 */
export function hasAllPermissions(
  userPermissions: Permission[],
  required: Permission[]
): boolean {
  return required.every((perm) => hasPermission(userPermissions, perm));
}

/**
 * Check if user has any of the required permissions
 */
export function hasAnyPermission(
  userPermissions: Permission[],
  required: Permission[]
): boolean {
  return required.some((perm) => hasPermission(userPermissions, perm));
}

export class PermissionService {
  constructor(private prisma: PrismaClient) {}
  private isActiveStatus(status?: string | null): boolean {
    return (status || '').toLowerCase() === 'active';
  }

  /**
   * Get all permissions for a user in a specific workspace
   */
  async getUserPermissions(
    userId: string,
    workspaceId: string
  ): Promise<Permission[]> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
      include: {
        role: true,
      },
    });

    if (!membership || !this.isActiveStatus(membership.status)) {
      return [];
    }

    return membership.role.permissions;
  }

  /**
   * Check if user has permission in workspace
   */
  async checkPermission(
    userId: string,
    workspaceId: string,
    required: Permission
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId, workspaceId);
    return hasPermission(permissions, required);
  }

  /**
   * Check if user is a member of workspace
   */
  async isMember(userId: string, workspaceId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
    });

    return this.isActiveStatus(membership?.status);
  }

  /**
   * Get user's role in a workspace
   */
  async getUserRole(
    userId: string,
    workspaceId: string
  ): Promise<{ id: string; name: string; permissions: string[] } | null> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
      include: {
        role: true,
      },
    });

    if (!membership || !this.isActiveStatus(membership.status)) {
      return null;
    }

    return {
      id: membership.role.id,
      name: membership.role.name,
      permissions: membership.role.permissions,
    };
  }
}
