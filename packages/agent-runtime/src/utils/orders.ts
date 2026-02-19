import type { Prisma } from '@prisma/client';

export const withVisibleOrders = (where: Prisma.OrderWhereInput): Prisma.OrderWhereInput => ({
  AND: [
    where,
    { deletedAt: null },
    { status: { not: 'trashed' } },
    { NOT: { metadata: { path: ['trash', 'isTrashed'], equals: true } } },
  ],
});
