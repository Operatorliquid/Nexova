/**
 * Prisma tenant isolation middleware
 * Enforces workspace scoping based on AsyncLocalStorage context.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { getContext } from './context.js';

const TENANT_MIDDLEWARE_KEY = '__nexovaTenantPrismaMiddleware';

const workspaceScopedModels = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'workspaceId'))
    .map((model) => model.name)
);

function collectWorkspaceIds(value: unknown, collector: Set<unknown>): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectWorkspaceIds(item, collector);
    }
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'workspaceId') {
      collector.add(nested);
    } else {
      collectWorkspaceIds(nested, collector);
    }
  }
}

function hasWorkspaceFilter(where: unknown): boolean {
  const values = new Set<unknown>();
  collectWorkspaceIds(where, values);
  return values.size > 0;
}

function validateWorkspaceFilter(where: unknown, workspaceId: string): void {
  const values = new Set<unknown>();
  collectWorkspaceIds(where, values);
  if (values.size === 0) return;

  const invalid = [...values].some(
    (value) => value !== workspaceId && value !== null
  );
  if (invalid) {
    throw new Error('Workspace filter mismatch');
  }
}

function attachWorkspaceId(data: unknown, workspaceId: string): unknown {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => attachWorkspaceId(item, workspaceId));
  }

  const record = data as Record<string, unknown>;
  if ('workspaceId' in record) {
    const current = record.workspaceId;
    if (current !== undefined && current !== workspaceId) {
      throw new Error('Workspace assignment mismatch');
    }
    record.workspaceId = workspaceId;
    return record;
  }

  return { ...record, workspaceId };
}

export function applyTenantPrismaMiddleware(prisma: PrismaClient): void {
  const prismaAny = prisma as PrismaClient & { [TENANT_MIDDLEWARE_KEY]?: boolean };
  if (prismaAny[TENANT_MIDDLEWARE_KEY]) return;
  prismaAny[TENANT_MIDDLEWARE_KEY] = true;

  prisma.$use(async (params, next) => {
    const ctx = getContext();
    const workspaceId = ctx?.workspaceId;

    if (!workspaceId) {
      return next(params);
    }

    if (!params.model || !workspaceScopedModels.has(params.model)) {
      return next(params);
    }

    const action = params.action;
    const args = params.args ?? {};

    const hasFilter = hasWorkspaceFilter(args.where);

    validateWorkspaceFilter(args.where, workspaceId);

    if (action === 'findUnique' || action === 'findUniqueOrThrow') {
      params.action = action === 'findUniqueOrThrow' ? 'findFirstOrThrow' : 'findFirst';
      params.args = {
        ...args,
        where: hasFilter ? args.where : { ...(args.where ?? {}), workspaceId },
      };
      return next(params);
    }

    if (
      action === 'findFirst' ||
      action === 'findFirstOrThrow' ||
      action === 'findMany' ||
      action === 'count' ||
      action === 'aggregate' ||
      action === 'groupBy'
    ) {
      if (!hasFilter) {
        params.args = {
          ...args,
          where: { ...(args.where ?? {}), workspaceId },
        };
      }
      return next(params);
    }

    if (action === 'create' || action === 'createMany' || action === 'createManyAndReturn') {
      params.args = {
        ...args,
        data: attachWorkspaceId(args.data, workspaceId),
      };
      return next(params);
    }

    if (action === 'update' || action === 'delete' || action === 'upsert') {
      if (!hasFilter) {
        throw new Error('Missing workspaceId filter');
      }
      return next(params);
    }

    if (action === 'updateMany' || action === 'deleteMany') {
      if (!hasFilter) {
        params.args = {
          ...args,
          where: { ...(args.where ?? {}), workspaceId },
        };
      }
      return next(params);
    }

    return next(params);
  });
}
