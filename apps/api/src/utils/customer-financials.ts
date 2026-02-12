import type { PrismaClient } from '@prisma/client';

export const debtIgnoredStatuses = ['cancelled', 'draft', 'returned'] as const;

export type DebtStats = {
  debt: number;
  paidCount: number;
  unpaidCount: number;
};

export const computeDebtStats = (
  orders: Array<{ total: number; paidAmount: number | null }>
): DebtStats => {
  let debt = 0;
  let paidCount = 0;
  let unpaidCount = 0;

  for (const order of orders) {
    const total = order.total ?? 0;
    const paid = order.paidAmount ?? 0;
    const pending = Math.max(0, total - paid);

    if (pending > 0) {
      debt += pending;
      unpaidCount += 1;
    } else {
      paidCount += 1;
    }
  }

  return { debt, paidCount, unpaidCount };
};

export const computePaymentScore = (input: {
  debt: number;
  debtReminderCount: number;
  orderCount: number;
  paidCount: number;
  unpaidCount: number;
}): number => {
  let score = 100;
  const totalOrders = input.paidCount + input.unpaidCount;
  const effectiveOrderCount = Math.max(input.orderCount, totalOrders);

  if (input.debt > 0) {
    const debtPenalty = Math.min(30, Math.floor(input.debt / 50000));
    score -= debtPenalty;
  }

  score -= Math.min(30, input.debtReminderCount * 10);

  if (totalOrders > 0) {
    const paidRatio = input.paidCount / totalOrders;
    const historyPenalty = Math.floor((1 - paidRatio) * 20);
    score -= historyPenalty;
  }

  if (effectiveOrderCount >= 10 && input.debt <= 0) {
    score = Math.min(100, score + 10);
  }

  return Math.max(0, Math.min(100, score));
};

export const recalcCustomerFinancials = async (
  prisma: PrismaClient,
  workspaceId: string,
  customerId: string
): Promise<{
  debt: number;
  paymentScore: number;
  paidCount: number;
  unpaidCount: number;
  totalSpent: number;
  orderCount: number;
}> => {
  const [customer, orders] = await prisma.$transaction([
    prisma.customer.findFirst({
      where: { id: customerId, workspaceId },
      select: {
        id: true,
        orderCount: true,
        debtReminderCount: true,
      },
    }),
    prisma.order.findMany({
      where: {
        workspaceId,
        customerId,
        status: { notIn: [...debtIgnoredStatuses] },
      },
      select: { total: true, paidAmount: true, createdAt: true },
    }),
  ]);

  if (!customer) {
    return { debt: 0, paymentScore: 100, paidCount: 0, unpaidCount: 0, totalSpent: 0, orderCount: 0 };
  }

  const stats = computeDebtStats(orders);
  const orderCount = orders.length;
  const paymentScore = computePaymentScore({
    debt: stats.debt,
    debtReminderCount: customer.debtReminderCount || 0,
    orderCount,
    paidCount: stats.paidCount,
    unpaidCount: stats.unpaidCount,
  });
  const totalSpent = orders.reduce((sum, order) => sum + (order.total ?? 0), 0);
  const lastOrderAt = orders.reduce<Date | null>((latest, order) => {
    if (!order.createdAt) return latest;
    if (!latest || order.createdAt > latest) return order.createdAt;
    return latest;
  }, null);

  await prisma.customer.updateMany({
    where: { id: customerId, workspaceId },
    data: {
      currentBalance: stats.debt,
      paymentScore,
      orderCount,
      totalSpent: BigInt(totalSpent),
      lastOrderAt,
    },
  });

  return {
    debt: stats.debt,
    paymentScore,
    paidCount: stats.paidCount,
    unpaidCount: stats.unpaidCount,
    totalSpent,
    orderCount,
  };
};
