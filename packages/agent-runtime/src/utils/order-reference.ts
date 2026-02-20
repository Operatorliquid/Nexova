import { Prisma, type PrismaClient } from '@prisma/client';

import { withVisibleOrders } from './orders.js';

export interface ResolvedOrderReference {
  id: string;
  orderNumber: string;
}

export interface AmbiguousOrderReference {
  ambiguous: true;
  matches: string[];
}

export type OrderReferenceResolution = ResolvedOrderReference | AmbiguousOrderReference | null;

interface ResolveOrderReferenceParams {
  prisma: PrismaClient;
  workspaceId: string;
  customerId?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  includeTrashed?: boolean;
  requireNotDeleted?: boolean;
}

export function normalizeOrderReference(value: string): string {
  const trimmed = (value || '').trim().toUpperCase();
  if (!trimmed) return '';

  const compact = trimmed.replace(/\s+/g, ' ');
  const ordMatch = compact.match(/^ORD[\s\-#:]*(\d{1,20})$/i);
  if (ordMatch?.[1]) {
    return `ORD-${ordMatch[1]}`;
  }

  const digitsOnly = compact.replace(/\D/g, '');
  if (digitsOnly && /^#?\d{1,20}$/.test(compact)) {
    return `ORD-${digitsOnly}`;
  }

  return compact;
}

export function extractOrderReferenceDigits(value: string): string | null {
  const normalized = normalizeOrderReference(value);
  const digits = normalized.replace(/\D/g, '');
  return digits ? digits : null;
}

function applyVisibilityFilter(
  where: Prisma.OrderWhereInput,
  includeTrashed: boolean
): Prisma.OrderWhereInput {
  return includeTrashed ? where : withVisibleOrders(where);
}

export async function resolveOrderReference(
  params: ResolveOrderReferenceParams
): Promise<OrderReferenceResolution> {
  const {
    prisma,
    workspaceId,
    customerId,
    orderId,
    orderNumber,
    includeTrashed = false,
    requireNotDeleted = false,
  } = params;

  const baseWhere: Prisma.OrderWhereInput = {
    workspaceId,
    ...(customerId ? { customerId } : {}),
    ...(requireNotDeleted ? { deletedAt: null } : {}),
  };

  if (orderId) {
    const byId = await prisma.order.findFirst({
      where: applyVisibilityFilter(
        {
          ...baseWhere,
          id: orderId,
        },
        includeTrashed
      ),
      select: { id: true, orderNumber: true },
    });
    return byId ? { id: byId.id, orderNumber: byId.orderNumber } : null;
  }

  if (!orderNumber) {
    return null;
  }

  const normalizedReference = normalizeOrderReference(orderNumber);
  if (!normalizedReference) return null;

  const exact = await prisma.order.findFirst({
    where: applyVisibilityFilter(
      {
        ...baseWhere,
        orderNumber: {
          equals: normalizedReference,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      includeTrashed
    ),
    select: { id: true, orderNumber: true },
  });
  if (exact) {
    return { id: exact.id, orderNumber: exact.orderNumber };
  }

  const digits = extractOrderReferenceDigits(orderNumber);
  if (!digits) return null;

  const candidates = await prisma.order.findMany({
    where: applyVisibilityFilter(
      {
        ...baseWhere,
        orderNumber: {
          endsWith: digits,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      includeTrashed
    ),
    orderBy: { createdAt: 'desc' },
    select: { id: true, orderNumber: true },
    take: 5,
  });

  if (candidates.length === 1) {
    return { id: candidates[0].id, orderNumber: candidates[0].orderNumber };
  }

  if (candidates.length > 1) {
    return {
      ambiguous: true,
      matches: candidates.map((candidate) => candidate.orderNumber),
    };
  }

  return null;
}
