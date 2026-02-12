/**
 * Scheduled Jobs Processor
 */
import { Job } from 'bullmq';
import { PrismaClient, Prisma } from '@prisma/client';
import { BUSINESS_RULES, ScheduledJobPayload, ScheduledJobType } from '@nexova/shared';

interface ScheduledJobResult {
  jobType: ScheduledJobType;
  processed?: number;
  details?: Record<string, unknown>;
}

export function createScheduledProcessor(prisma: PrismaClient) {
  return async (job: Job<ScheduledJobPayload>): Promise<ScheduledJobResult> => {
    const { jobType, workspaceId } = job.data;

    switch (jobType) {
      case 'session:cleanup':
        return handleSessionCleanup(prisma, workspaceId);
      case 'reservation:expire':
        return handleReservationExpire(prisma, workspaceId);
      case 'draft:expire':
        return handleDraftExpire(prisma, workspaceId);
      case 'memory:prune':
        return handleMemoryPrune(prisma);
      case 'usage:aggregate':
        return handleUsageAggregate(prisma, workspaceId);
      case 'connection:health':
        return handleConnectionHealth(prisma, workspaceId);
      case 'audit:archive':
        return handleAuditArchive(prisma);
      case 'stock:reorder-check':
        return handleStockReorderCheck(prisma, workspaceId);
      default:
        return { jobType: jobType as ScheduledJobType, processed: 0 };
    }
  };
}

export async function scheduleDefaultJobs(queue: { add: Function }) {
  await queue.add('session-cleanup', { jobType: 'session:cleanup' }, {
    repeat: { every: 60 * 60 * 1000 },
    jobId: 'session-cleanup',
  });

  await queue.add('reservation-expire', { jobType: 'reservation:expire' }, {
    repeat: { every: 10 * 60 * 1000 },
    jobId: 'reservation-expire',
  });

  await queue.add('draft-expire', { jobType: 'draft:expire' }, {
    repeat: { every: 30 * 60 * 1000 },
    jobId: 'draft-expire',
  });

  await queue.add('memory-prune', { jobType: 'memory:prune' }, {
    repeat: { every: 6 * 60 * 60 * 1000 },
    jobId: 'memory-prune',
  });

  await queue.add('usage-aggregate', { jobType: 'usage:aggregate' }, {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: 'usage-aggregate',
  });

  await queue.add('connection-health', { jobType: 'connection:health' }, {
    repeat: { every: 6 * 60 * 60 * 1000 },
    jobId: 'connection-health',
  });

  await queue.add('stock-reorder-check', { jobType: 'stock:reorder-check' }, {
    repeat: { every: 6 * 60 * 60 * 1000 },
    jobId: 'stock-reorder-check',
  });
}

async function handleSessionCleanup(
  prisma: PrismaClient,
  workspaceId?: string
): Promise<ScheduledJobResult> {
  const timeoutMinutes = Number(process.env.SESSION_TIMEOUT_MINUTES || 60 * 24 * 7);
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const result = await prisma.agentSession.updateMany({
    where: {
      endedAt: null,
      lastActivityAt: { lt: cutoff },
      ...(workspaceId ? { workspaceId } : {}),
    },
    data: {
      endedAt: new Date(),
      currentState: 'IDLE',
    },
  });

  return { jobType: 'session:cleanup', processed: result.count };
}

async function handleReservationExpire(
  prisma: PrismaClient,
  workspaceId?: string
): Promise<ScheduledJobResult> {
  const now = new Date();

  const reservations = await prisma.stockReservation.findMany({
    where: {
      status: 'active',
      expiresAt: { lt: now },
      ...(workspaceId ? { order: { workspaceId } } : {}),
    },
    include: {
      order: { select: { id: true, orderNumber: true, workspaceId: true } },
    },
  });

  let processed = 0;

  for (const reservation of reservations) {
    await prisma.$transaction(async (tx) => {
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'expired', releasedAt: now },
      });

      const stockItem = await tx.stockItem.findFirst({
        where: {
          productId: reservation.productId,
          variantId: reservation.variantId ?? null,
        },
      });

      if (stockItem) {
        const currentAvailable = stockItem.quantity - stockItem.reserved;

        await tx.stockItem.update({
          where: { id: stockItem.id },
          data: { reserved: { decrement: reservation.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            stockItemId: stockItem.id,
            type: 'release',
            quantity: reservation.quantity,
            previousQty: currentAvailable,
            newQty: currentAvailable + reservation.quantity,
            reason: `Reserva expirada orden ${reservation.order.orderNumber}`,
            referenceType: 'StockReservation',
            referenceId: reservation.id,
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    processed++;
  }

  return { jobType: 'reservation:expire', processed };
}

async function handleDraftExpire(
  prisma: PrismaClient,
  workspaceId?: string
): Promise<ScheduledJobResult> {
  const now = new Date();
  const cutoff = new Date(Date.now() - BUSINESS_RULES.DRAFT_EXPIRY_MINUTES * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      status: 'draft',
      updatedAt: { lt: cutoff },
      ...(workspaceId ? { workspaceId } : {}),
    },
    select: { id: true, orderNumber: true, status: true, workspaceId: true },
  });

  let processed = 0;

  for (const order of orders) {
    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: order.id, workspaceId: order.workspaceId },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: 'draft_expired',
        },
      });

      const reservations = await tx.stockReservation.findMany({
        where: { orderId: order.id, status: 'active' },
      });

      for (const reservation of reservations) {
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'expired', releasedAt: now },
        });

        const stockItem = await tx.stockItem.findFirst({
          where: {
            productId: reservation.productId,
            variantId: reservation.variantId ?? null,
          },
        });

        if (stockItem) {
          const currentAvailable = stockItem.quantity - stockItem.reserved;

          await tx.stockItem.update({
            where: { id: stockItem.id },
            data: { reserved: { decrement: reservation.quantity } },
          });

          await tx.stockMovement.create({
            data: {
              stockItemId: stockItem.id,
              type: 'release',
              quantity: reservation.quantity,
              previousQty: currentAvailable,
              newQty: currentAvailable + reservation.quantity,
              reason: `Reserva expirada orden ${order.orderNumber}`,
              referenceType: 'Order',
              referenceId: order.id,
            },
          });
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          previousStatus: order.status,
          newStatus: 'cancelled',
          reason: 'Borrador expirado',
          changedBy: 'system',
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    processed++;
  }

  return { jobType: 'draft:expire', processed };
}

async function handleMemoryPrune(prisma: PrismaClient): Promise<ScheduledJobResult> {
  const now = new Date();
  const result = await prisma.agentMemory.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });

  const confirmations = await prisma.quickActionConfirmation.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });

  return {
    jobType: 'memory:prune',
    processed: result.count + confirmations.count,
    details: {
      memories: result.count,
      confirmations: confirmations.count,
    },
  };
}

async function handleUsageAggregate(
  prisma: PrismaClient,
  workspaceId?: string
): Promise<ScheduledJobResult> {
  const groups = await prisma.usageRecord.groupBy({
    by: ['workspaceId', 'metric', 'periodStart', 'periodEnd'],
    _count: { _all: true },
    _sum: { quantity: true },
    ...(workspaceId ? { where: { workspaceId } } : {}),
  });

  let processed = 0;

  for (const group of groups) {
    if (group._count._all <= 1) continue;

    const records = await prisma.usageRecord.findMany({
      where: {
        workspaceId: group.workspaceId,
        metric: group.metric,
        periodStart: group.periodStart,
        periodEnd: group.periodEnd,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (records.length <= 1) continue;

    const [keep, ...remove] = records;
    const total = group._sum.quantity ?? 0n;

    await prisma.usageRecord.update({
      where: { id: keep.id },
      data: { quantity: total },
    });

    await prisma.usageRecord.deleteMany({
      where: { id: { in: remove.map((r) => r.id) } },
    });

    processed += remove.length;
  }

  return {
    jobType: 'usage:aggregate',
    processed,
    details: { mergedDuplicates: processed },
  };
}

async function handleConnectionHealth(
  prisma: PrismaClient,
  workspaceId?: string
): Promise<ScheduledJobResult> {
  const badNumbers = await prisma.whatsAppNumber.findMany({
    where: {
      isActive: true,
      ...(workspaceId ? { workspaceId } : {}),
      OR: [{ apiKeyEnc: null }, { apiKeyIv: null }],
    },
    select: { id: true, workspaceId: true, phoneNumber: true },
  });

  const now = new Date();
  let processed = 0;

  for (const number of badNumbers) {
    if (!number.workspaceId) continue;
    const workspaceId = number.workspaceId;

    const existing = await prisma.notification.findFirst({
      where: {
        workspaceId,
        type: 'integration.warning',
        entityType: 'WhatsAppNumber',
        entityId: number.id,
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    if (existing) continue;

    await prisma.notification.create({
      data: {
        workspaceId,
        type: 'integration.warning',
        title: 'WhatsApp sin credenciales',
        message: `El número ${number.phoneNumber} no tiene API key configurada.`,
        entityType: 'WhatsAppNumber',
        entityId: number.id,
        metadata: { phoneNumber: number.phoneNumber },
      },
    });
    processed += 1;
  }

  return {
    jobType: 'connection:health',
    processed,
    details: { missingApiKeys: processed },
  };
}

async function handleAuditArchive(prisma: PrismaClient): Promise<ScheduledJobResult> {
  const retentionDays = Number.parseInt(process.env.AUDIT_ARCHIVE_DAYS || '180', 10);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { jobType: 'audit:archive', processed: 0, details: { skipped: true } };
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return {
    jobType: 'audit:archive',
    processed: result.count,
    details: { cutoff: cutoff.toISOString() },
  };
}

async function handleStockReorderCheck(
  prisma: PrismaClient,
  workspaceId?: string
): Promise<ScheduledJobResult> {
  const stockItems = await prisma.stockItem.findMany({
    where: {
      ...(workspaceId ? { product: { workspaceId } } : {}),
    },
    select: {
      id: true,
      quantity: true,
      reserved: true,
      lowThreshold: true,
      product: {
        select: { id: true, name: true, workspaceId: true },
      },
    },
  });

  const now = new Date();
  let processed = 0;

  for (const item of stockItems) {
    const available = item.quantity - item.reserved;
    if (available > item.lowThreshold) continue;

    const existing = await prisma.notification.findFirst({
      where: {
        workspaceId: item.product.workspaceId,
        type: 'stock.low',
        entityType: 'StockItem',
        entityId: item.id,
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });
    if (existing) continue;

    const allowed = await shouldCreateNotification(prisma, item.product.workspaceId, 'stock.low');
    if (!allowed) continue;

    await prisma.notification.create({
      data: {
        workspaceId: item.product.workspaceId,
        type: 'stock.low',
        title: 'Stock bajo',
        message: `El producto ${item.product.name} tiene stock bajo (${available} unidades).`,
        entityType: 'StockItem',
        entityId: item.id,
        metadata: {
          productId: item.product.id,
          productName: item.product.name,
          available,
          lowThreshold: item.lowThreshold,
        },
      },
    });
    processed += 1;
  }

  return {
    jobType: 'stock:reorder-check',
    processed,
    details: { lowStockNotified: processed },
  };
}

type NotificationPreferenceKey = 'orders' | 'handoffs' | 'stock' | 'payments' | 'customers';

const DEFAULT_NOTIFICATION_PREFERENCES: Record<NotificationPreferenceKey, boolean> = {
  orders: true,
  handoffs: true,
  stock: true,
  payments: true,
  customers: true,
};

const NOTIFICATION_TYPE_TO_PREFERENCE: Record<string, NotificationPreferenceKey> = {
  'order.new': 'orders',
  'order.cancelled': 'orders',
  'order.edited': 'orders',
  'receipt.new': 'payments',
  'handoff.requested': 'handoffs',
  'customer.new': 'customers',
  'stock.low': 'stock',
};

function resolveNotificationPreferences(
  settings?: Record<string, unknown> | null
): Record<NotificationPreferenceKey, boolean> {
  const raw = (settings?.notificationPreferences as Record<string, unknown>) || {};
  const sanitized: Partial<Record<NotificationPreferenceKey, boolean>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      sanitized[key as NotificationPreferenceKey] = value;
    }
  }
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...sanitized };
}

async function shouldCreateNotification(
  prisma: PrismaClient,
  workspaceId: string,
  type: string
): Promise<boolean> {
  const preferenceKey = NOTIFICATION_TYPE_TO_PREFERENCE[type];
  if (!preferenceKey) return true;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });

  const settings = (workspace?.settings as Record<string, unknown>) || {};
  const prefs = resolveNotificationPreferences(settings);
  return prefs[preferenceKey] !== false;
}
