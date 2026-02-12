import type { Prisma, PrismaClient } from '@prisma/client';

function getUtcMonthPeriod(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  // Day 0 of next month is last day of this month.
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function normalizeUsageQuantity(quantity: number | bigint): bigint {
  if (typeof quantity === 'bigint') return quantity;
  if (!Number.isFinite(quantity)) return 0n;
  const normalized = Math.floor(quantity);
  if (normalized <= 0) return 0n;
  return BigInt(normalized);
}

export async function getMonthlyUsage(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    metric: string;
    occurredAt?: Date;
  }
): Promise<bigint> {
  const { start, end } = getUtcMonthPeriod(params.occurredAt ?? new Date());

  const agg = await prisma.usageRecord.aggregate({
    where: {
      workspaceId: params.workspaceId,
      metric: params.metric,
      periodStart: start,
      periodEnd: end,
    },
    _sum: { quantity: true },
  });

  return (agg._sum.quantity ?? 0n) as bigint;
}

export async function recordMonthlyUsage(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    metric: string;
    quantity: number | bigint;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
  }
): Promise<void> {
  const amount = normalizeUsageQuantity(params.quantity);
  if (amount <= 0n) return;

  const { start, end } = getUtcMonthPeriod(params.occurredAt ?? new Date());

  try {
    const existing = await prisma.usageRecord.findFirst({
      where: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        periodStart: start,
        periodEnd: end,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing?.id) {
      await prisma.usageRecord.updateMany({
        where: { id: existing.id, workspaceId: params.workspaceId },
        data: { quantity: { increment: amount } },
      });
      return;
    }

    await prisma.usageRecord.create({
      data: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        quantity: amount,
        periodStart: start,
        periodEnd: end,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Non-fatal
  }
}

