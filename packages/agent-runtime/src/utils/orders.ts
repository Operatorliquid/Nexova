import { Prisma, type Prisma as PrismaNamespace } from '@prisma/client';

export const withVisibleOrders = (where: PrismaNamespace.OrderWhereInput): PrismaNamespace.OrderWhereInput => ({
  AND: [
    where,
    { deletedAt: null },
    { status: { not: 'trashed' } },
    {
      OR: [
        { metadata: { equals: Prisma.AnyNull } },
        { metadata: { path: ['trash', 'isTrashed'], equals: Prisma.AnyNull } },
        { metadata: { path: ['trash', 'isTrashed'], equals: false } },
        { metadata: { path: ['trash', 'isTrashed'], equals: 'false' } },
      ],
    },
  ],
});
