/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PERMISSIONS & ROLES
 * RBAC permission definitions for the dashboard
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PERMISSION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  ALL: '*',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCE PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_READ: 'dashboard:read',

  // Sessions / Inbox
  SESSIONS_READ: 'sessions:read',
  SESSIONS_TAKEOVER: 'sessions:takeover',
  SESSIONS_MESSAGE: 'sessions:message',
  SESSIONS_RELEASE: 'sessions:release',

  // Handoffs
  HANDOFFS_READ: 'handoffs:read',
  HANDOFFS_CLAIM: 'handoffs:claim',
  HANDOFFS_RESOLVE: 'handoffs:resolve',

  // Orders
  ORDERS_READ: 'orders:read',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_CANCEL: 'orders:cancel',
  ORDERS_ALL: 'orders:*',

  // Products
  PRODUCTS_READ: 'products:read',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_ALL: 'products:*',

  // Stock
  STOCK_READ: 'stock:read',
  STOCK_ADJUST: 'stock:adjust',
  STOCK_ALL: 'stock:*',

  // Customers
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_DELETE: 'customers:delete',
  CUSTOMERS_ALL: 'customers:*',

  // Payments
  PAYMENTS_READ: 'payments:read',
  PAYMENTS_CREATE: 'payments:create',
  PAYMENTS_UPDATE: 'payments:update',
  PAYMENTS_REFUND: 'payments:refund',
  PAYMENTS_ALL: 'payments:*',

  // Analytics
  ANALYTICS_READ: 'analytics:read',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',

  // Members
  MEMBERS_READ: 'members:read',
  MEMBERS_CREATE: 'members:create',
  MEMBERS_UPDATE: 'members:update',
  MEMBERS_DELETE: 'members:delete',
  MEMBERS_ALL: 'members:*',

  // Roles
  ROLES_READ: 'roles:read',
  ROLES_CREATE: 'roles:create',
  ROLES_UPDATE: 'roles:update',
  ROLES_DELETE: 'roles:delete',
  ROLES_ALL: 'roles:*',

  // Connections
  CONNECTIONS_READ: 'connections:read',
  CONNECTIONS_CREATE: 'connections:create',
  CONNECTIONS_UPDATE: 'connections:update',
  CONNECTIONS_DELETE: 'connections:delete',
  CONNECTIONS_ALL: 'connections:*',

  // Billing
  BILLING_READ: 'billing:read',
  BILLING_UPDATE: 'billing:update',
  BILLING_ALL: 'billing:*',

  // Audit
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // Workspaces
  WORKSPACES_READ: 'workspaces:read',
  WORKSPACES_CREATE: 'workspaces:create',
  WORKSPACES_UPDATE: 'workspaces:update',
  WORKSPACES_DELETE: 'workspaces:delete',

  // Wildcard
  ALL: '*',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ═══════════════════════════════════════════════════════════════════════════════
// PREDEFINED ROLES
// ═══════════════════════════════════════════════════════════════════════════════

export interface RoleDefinition {
  name: string;
  description: string;
  isSystem: boolean;
  permissions: Permission[];
}

export const SYSTEM_ROLES: Record<string, RoleDefinition> = {
  OWNER: {
    name: 'Owner',
    description: 'Full access to all workspace features including billing and deletion',
    isSystem: true,
    permissions: [PERMISSIONS.ALL],
  },

  ADMIN: {
    name: 'Admin',
    description: 'Full access to all features except billing and workspace deletion',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_READ,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.SESSIONS_TAKEOVER,
      PERMISSIONS.SESSIONS_MESSAGE,
      PERMISSIONS.SESSIONS_RELEASE,
      PERMISSIONS.HANDOFFS_READ,
      PERMISSIONS.HANDOFFS_CLAIM,
      PERMISSIONS.HANDOFFS_RESOLVE,
      PERMISSIONS.ORDERS_ALL,
      PERMISSIONS.PRODUCTS_ALL,
      PERMISSIONS.STOCK_ALL,
      PERMISSIONS.CUSTOMERS_ALL,
      PERMISSIONS.PAYMENTS_ALL,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_UPDATE,
      PERMISSIONS.MEMBERS_ALL,
      PERMISSIONS.CONNECTIONS_ALL,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.AUDIT_EXPORT,
    ],
  },
};

export const DEFAULT_ROLES: Record<string, RoleDefinition> = {
  BASIC: {
    name: 'Basic',
    description: 'Plan basico de comercio con acceso de lectura',
    isSystem: false,
    permissions: [
      PERMISSIONS.DASHBOARD_READ,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.ORDERS_READ,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.STOCK_READ,
      PERMISSIONS.CUSTOMERS_READ,
      PERMISSIONS.PAYMENTS_READ,
      PERMISSIONS.ANALYTICS_READ,
    ],
  },

  STANDARD: {
    name: 'Standard',
    description: 'Plan standard de comercio con operacion diaria',
    isSystem: false,
    permissions: [
      PERMISSIONS.DASHBOARD_READ,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.SESSIONS_TAKEOVER,
      PERMISSIONS.SESSIONS_MESSAGE,
      PERMISSIONS.SESSIONS_RELEASE,
      PERMISSIONS.HANDOFFS_READ,
      PERMISSIONS.HANDOFFS_CLAIM,
      PERMISSIONS.HANDOFFS_RESOLVE,
      PERMISSIONS.ORDERS_READ,
      PERMISSIONS.ORDERS_CREATE,
      PERMISSIONS.ORDERS_UPDATE,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.STOCK_READ,
      PERMISSIONS.CUSTOMERS_READ,
      PERMISSIONS.CUSTOMERS_UPDATE,
      PERMISSIONS.PAYMENTS_READ,
      PERMISSIONS.PAYMENTS_CREATE,
      PERMISSIONS.ANALYTICS_READ,
    ],
  },

  PRO: {
    name: 'Pro',
    description: 'Plan pro de comercio con gestion avanzada',
    isSystem: false,
    permissions: [
      PERMISSIONS.DASHBOARD_READ,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.SESSIONS_TAKEOVER,
      PERMISSIONS.SESSIONS_MESSAGE,
      PERMISSIONS.SESSIONS_RELEASE,
      PERMISSIONS.HANDOFFS_READ,
      PERMISSIONS.HANDOFFS_CLAIM,
      PERMISSIONS.HANDOFFS_RESOLVE,
      PERMISSIONS.ORDERS_ALL,
      PERMISSIONS.PRODUCTS_ALL,
      PERMISSIONS.STOCK_ALL,
      PERMISSIONS.CUSTOMERS_ALL,
      PERMISSIONS.PAYMENTS_ALL,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.SETTINGS_READ,
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const SCREEN_PERMISSIONS: Record<string, Permission[]> = {
  // Public (no auth required)
  '/login': [],
  '/register': [],
  '/forgot-password': [],
  '/reset-password': [],
  '/verify-email': [],
  '/invite': [],

  // Authenticated (any logged in user)
  '/onboarding': [],
  '/workspaces': [],
  '/profile': [],
  '/profile/security': [],

  // Dashboard
  '/': [PERMISSIONS.DASHBOARD_READ],

  // Inbox
  '/inbox': [PERMISSIONS.SESSIONS_READ],
  '/inbox/:sessionId': [PERMISSIONS.SESSIONS_READ],

  // Orders
  '/orders': [PERMISSIONS.ORDERS_READ],
  '/orders/new': [PERMISSIONS.ORDERS_CREATE],
  '/orders/:id': [PERMISSIONS.ORDERS_READ],

  // Stock
  '/stock': [PERMISSIONS.STOCK_READ],
  '/stock/movements': [PERMISSIONS.STOCK_READ],
  '/stock/adjust': [PERMISSIONS.STOCK_ADJUST],

  // Customers
  '/customers': [PERMISSIONS.CUSTOMERS_READ],
  '/customers/:id': [PERMISSIONS.CUSTOMERS_READ],

  // Payments
  '/payments': [PERMISSIONS.PAYMENTS_READ],
  '/payments/:id': [PERMISSIONS.PAYMENTS_READ],

  // Analytics
  '/analytics': [PERMISSIONS.ANALYTICS_READ],

  // Settings
  '/settings': [PERMISSIONS.SETTINGS_READ],
  '/settings/workspace': [PERMISSIONS.SETTINGS_READ],
  '/settings/team': [PERMISSIONS.MEMBERS_READ],
  '/settings/team/invite': [PERMISSIONS.MEMBERS_CREATE],
  '/settings/roles': [PERMISSIONS.ROLES_READ],
  '/settings/roles/new': [PERMISSIONS.ROLES_CREATE],
  '/settings/roles/:id': [PERMISSIONS.ROLES_READ],
  '/settings/connections': [PERMISSIONS.CONNECTIONS_READ],
  '/settings/connections/new': [PERMISSIONS.CONNECTIONS_CREATE],
  '/settings/connections/:id': [PERMISSIONS.CONNECTIONS_READ],
  '/settings/billing': [PERMISSIONS.BILLING_READ],
  '/settings/notifications': [PERMISSIONS.SETTINGS_READ],

  // Audit
  '/audit': [PERMISSIONS.AUDIT_READ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// PERMISSION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a permission matches (including wildcards)
 */
export function permissionMatches(
  required: Permission,
  granted: Permission
): boolean {
  // Wildcard matches everything
  if (granted === '*') return true;

  // Exact match
  if (required === granted) return true;

  // Resource wildcard (e.g., 'orders:*' matches 'orders:read')
  const [requiredResource, _requiredAction] = required.split(':');
  const [grantedResource, grantedAction] = granted.split(':');

  if (requiredResource === grantedResource && grantedAction === '*') {
    return true;
  }

  return false;
}

/**
 * Check if user has required permission
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
