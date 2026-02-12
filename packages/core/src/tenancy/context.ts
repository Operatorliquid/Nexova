/**
 * Tenant Context using AsyncLocalStorage
 * Provides request-scoped tenant isolation
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  userId: string;
  workspaceId: string;
  permissions: string[];
  isSuperAdmin: boolean;
  requestId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireContext(): TenantContext {
  const ctx = getContext();
  if (!ctx) {
    throw new Error('No tenant context available');
  }
  return ctx;
}

export function getUserId(): string {
  return requireContext().userId;
}

export function getWorkspaceId(): string {
  return requireContext().workspaceId;
}

export function getPermissions(): string[] {
  return requireContext().permissions;
}

export function isSuperAdmin(): boolean {
  return requireContext().isSuperAdmin;
}

export function getRequestId(): string {
  return requireContext().requestId;
}
