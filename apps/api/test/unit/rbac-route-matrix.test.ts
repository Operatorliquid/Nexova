import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

type PermissionExpectation = {
  file: string;
  routePath: string;
  permission: string;
  method: 'get' | 'post' | 'patch' | 'delete';
};

function readRouteFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectRoutePermission(params: PermissionExpectation): void {
  const source = readRouteFile(params.file);
  const method = escapeForRegex(params.method);
  const routePath = escapeForRegex(params.routePath);
  const permission = escapeForRegex(params.permission);
  const pattern = new RegExp(
    `${method}[\\s\\S]{0,300}?['"]${routePath}['"][\\s\\S]{0,8000}?requirePermission\\('${permission}'\\)`,
    'm'
  );
  expect(source).toMatch(pattern);
}

function expectRouteSectionContains(params: {
  file: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  routePath: string;
  snippets: string[];
}): void {
  const source = readRouteFile(params.file);
  const method = escapeForRegex(params.method);
  const routePath = escapeForRegex(params.routePath);
  const routeStartPattern = new RegExp(`${method}[\\s\\S]{0,300}?['"]${routePath}['"]`, 'm');
  const match = source.match(routeStartPattern);
  expect(match).toBeTruthy();
  const startIndex = match ? source.indexOf(match[0]) : -1;
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const section = source.slice(startIndex, startIndex + 22000);

  for (const snippet of params.snippets) {
    expect(section).toContain(snippet);
  }
}

describe('RBAC route permission matrix (regression guard)', () => {
  it('enforces conversation permissions', () => {
    expectRoutePermission({
      file: 'src/routes/v1/conversations.routes.ts',
      method: 'get',
      routePath: '/',
      permission: 'sessions:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/conversations.routes.ts',
      method: 'get',
      routePath: '/:sessionId/messages',
      permission: 'sessions:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/conversations.routes.ts',
      method: 'post',
      routePath: '/:sessionId/messages',
      permission: 'sessions:message',
    });
    expectRoutePermission({
      file: 'src/routes/v1/conversations.routes.ts',
      method: 'patch',
      routePath: '/:sessionId/agent',
      permission: 'sessions:takeover',
    });
    expectRoutePermission({
      file: 'src/routes/v1/conversations.routes.ts',
      method: 'delete',
      routePath: '/:sessionId',
      permission: 'sessions:release',
    });
  });

  it('enforces quick-actions and notifications dashboard permissions', () => {
    expectRoutePermission({
      file: 'src/routes/v1/quick-actions.routes.ts',
      method: 'post',
      routePath: '/execute',
      permission: 'dashboard:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/quick-actions.routes.ts',
      method: 'post',
      routePath: '/confirm',
      permission: 'dashboard:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/quick-actions.routes.ts',
      method: 'get',
      routePath: '/history',
      permission: 'dashboard:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/quick-actions.routes.ts',
      method: 'post',
      routePath: '/:id/rerun',
      permission: 'dashboard:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/quick-actions.routes.ts',
      method: 'get',
      routePath: '/suggestions',
      permission: 'dashboard:read',
    });

    expectRoutePermission({
      file: 'src/routes/v1/notifications.routes.ts',
      method: 'get',
      routePath: '/',
      permission: 'dashboard:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/notifications.routes.ts',
      method: 'patch',
      routePath: '/:id/read',
      permission: 'dashboard:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/notifications.routes.ts',
      method: 'post',
      routePath: '/read-all',
      permission: 'dashboard:read',
    });
  });

  it('enforces audio-transcriptions and workspace critical permissions', () => {
    expectRoutePermission({
      file: 'src/routes/v1/audio-transcriptions.routes.ts',
      method: 'post',
      routePath: '/:workspaceId/audio/transcriptions',
      permission: 'sessions:takeover',
    });
    expectRoutePermission({
      file: 'src/routes/v1/audio-transcriptions.routes.ts',
      method: 'get',
      routePath: '/:workspaceId/audio/transcriptions/:id',
      permission: 'sessions:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/audio-transcriptions.routes.ts',
      method: 'post',
      routePath: '/:workspaceId/audio/transcriptions/:id/retry',
      permission: 'sessions:takeover',
    });

    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'get',
      routePath: '/:id',
      permission: 'settings:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'get',
      routePath: '/:id/roles',
      permission: 'members:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'get',
      routePath: '/:id/whatsapp-numbers/available',
      permission: 'connections:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'get',
      routePath: '/:id/whatsapp-numbers',
      permission: 'connections:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'post',
      routePath: '/:id/whatsapp-numbers/:numberId/claim',
      permission: 'connections:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'post',
      routePath: '/:id/whatsapp-numbers/release',
      permission: 'connections:delete',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'get',
      routePath: '/:id/whatsapp/providers',
      permission: 'connections:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'post',
      routePath: '/:id/whatsapp/evolution/connect',
      permission: 'connections:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'get',
      routePath: '/:id/whatsapp/evolution/status',
      permission: 'connections:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'post',
      routePath: '/:id/whatsapp/evolution/disconnect',
      permission: 'connections:delete',
    });

    expectRouteSectionContains({
      file: 'src/routes/v1/workspace.routes.ts',
      method: 'patch',
      routePath: '/:id/settings',
      snippets: ["requirePermission('settings:update')", "requirePermission('payments:update')", "requirePermission('sessions:takeover')"],
    });
  });

  it('enforces core business permissions in orders/customers/integrations/stock/analytics/uploads', () => {
    expectRoutePermission({
      file: 'src/routes/v1/orders.routes.ts',
      method: 'get',
      routePath: '/',
      permission: 'orders:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/orders.routes.ts',
      method: 'post',
      routePath: '/:id/receipts',
      permission: 'payments:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/orders.routes.ts',
      method: 'post',
      routePath: '/',
      permission: 'orders:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/orders.routes.ts',
      method: 'patch',
      routePath: '/:id',
      permission: 'orders:update',
    });
    expectRoutePermission({
      file: 'src/routes/v1/orders.routes.ts',
      method: 'delete',
      routePath: '/:id',
      permission: 'orders:cancel',
    });

    expectRoutePermission({
      file: 'src/routes/v1/customers.routes.ts',
      method: 'get',
      routePath: '/',
      permission: 'customers:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/customers.routes.ts',
      method: 'post',
      routePath: '/',
      permission: 'customers:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/customers.routes.ts',
      method: 'patch',
      routePath: '/:id',
      permission: 'customers:update',
    });
    expectRoutePermission({
      file: 'src/routes/v1/customers.routes.ts',
      method: 'delete',
      routePath: '/:id',
      permission: 'customers:delete',
    });
    expectRoutePermission({
      file: 'src/routes/v1/customers.routes.ts',
      method: 'post',
      routePath: '/:id/notes',
      permission: 'customers:update',
    });
    expectRoutePermission({
      file: 'src/routes/v1/customers.routes.ts',
      method: 'post',
      routePath: '/debt-reminders/bulk',
      permission: 'payments:update',
    });

    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'get',
      routePath: '/mercadopago/auth-url',
      permission: 'connections:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'get',
      routePath: '/mercadopago/status',
      permission: 'connections:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'delete',
      routePath: '/mercadopago',
      permission: 'connections:delete',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'post',
      routePath: '/arca/invoices',
      permission: 'payments:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'post',
      routePath: '/payments/create-link',
      permission: 'payments:create',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'get',
      routePath: '/receipts',
      permission: 'payments:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'get',
      routePath: '/receipts/:id/file',
      permission: 'payments:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'post',
      routePath: '/receipts/:id/apply',
      permission: 'payments:update',
    });
    expectRoutePermission({
      file: 'src/routes/v1/integrations.routes.ts',
      method: 'get',
      routePath: '/customers/:id/balance',
      permission: 'payments:read',
    });

    expectRoutePermission({
      file: 'src/routes/v1/stock-receipts.routes.ts',
      method: 'post',
      routePath: '/preview',
      permission: 'stock:adjust',
    });
    expectRoutePermission({
      file: 'src/routes/v1/stock-receipts.routes.ts',
      method: 'post',
      routePath: '/:id/apply',
      permission: 'stock:adjust',
    });

    expectRoutePermission({
      file: 'src/routes/v1/analytics.routes.ts',
      method: 'get',
      routePath: '/metrics',
      permission: 'analytics:read',
    });
    expectRoutePermission({
      file: 'src/routes/v1/analytics.routes.ts',
      method: 'get',
      routePath: '/insights',
      permission: 'analytics:read',
    });

    expectRouteSectionContains({
      file: 'src/routes/v1/uploads.routes.ts',
      method: 'post',
      routePath: '/product-image',
      snippets: ['products:create', 'products:update'],
    });
  });
});
