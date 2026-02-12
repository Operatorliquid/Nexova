import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export type NotificationPreferenceKey = 'orders' | 'handoffs' | 'stock' | 'payments' | 'customers';

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

const OWNER_WHATSAPP_NOTIFICATION_EVENT = 'owner.whatsapp_notification';

function toPhoneDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

function normalizeOwnerWhatsAppNumber(raw: string, timezone: string | null): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  let digits = toPhoneDigits(trimmed);
  if (!digits) return null;

  // Support international dialing prefix.
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  const tz = (timezone || '').trim();
  const isArgentina = tz.startsWith('America/Argentina/');

  if (isArgentina) {
    if (digits.startsWith('54')) {
      // WhatsApp in AR commonly uses the '549' prefix for mobile numbers.
      if (!digits.startsWith('549') && digits.length === 12) {
        digits = `549${digits.slice(2)}`;
      }
      return `+${digits}`;
    }

    // Users often type a local number without the country code.
    digits = digits.replace(/^0+/, '');
    if (digits.length === 10) {
      return `+549${digits}`;
    }

    if (digits.length >= 11) {
      return `+${digits}`;
    }

    return null;
  }

  // For other timezones we require a plausible E.164-like length.
  if (digits.length >= 11) {
    return `+${digits}`;
  }

  return null;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  orders: true,
  handoffs: true,
  stock: true,
  payments: true,
  customers: true,
};

export const NOTIFICATION_TYPE_TO_PREFERENCE: Record<string, NotificationPreferenceKey> = {
  'order.new': 'orders',
  'order.cancelled': 'orders',
  'order.edited': 'orders',
  'receipt.new': 'payments',
  'handoff.requested': 'handoffs',
  'customer.new': 'customers',
  'stock.low': 'stock',
};

export function resolveNotificationPreferences(
  settings?: Record<string, unknown> | null
): NotificationPreferences {
  const raw = (settings?.notificationPreferences as Record<string, unknown>) || {};
  const sanitized: Partial<NotificationPreferences> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      sanitized[key as NotificationPreferenceKey] = value;
    }
  }
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...sanitized };
}

export async function shouldCreateNotification(
  prisma: PrismaExecutor,
  workspaceId: string,
  type: string
): Promise<boolean> {
  // Dashboard notifications are always enabled and cannot be disabled.
  void prisma;
  void workspaceId;
  void type;
  return true;
}

async function resolveOwnerWhatsAppTarget(
  prisma: PrismaExecutor,
  workspaceId: string
): Promise<{ enabled: boolean; phone: string | null; preferences: NotificationPreferences }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });

  const settings = (workspace?.settings as Record<string, unknown>) || {};
  const enabled = settings.ownerAgentEnabled === true;
  const timezone = typeof settings.timezone === 'string' ? settings.timezone : null;
  const rawPhone =
    typeof settings.ownerAgentNumber === 'string' && settings.ownerAgentNumber.trim()
      ? settings.ownerAgentNumber.trim()
      : null;
  const phone = rawPhone ? normalizeOwnerWhatsAppNumber(rawPhone, timezone) : null;

  return {
    enabled,
    phone,
    preferences: resolveNotificationPreferences(settings),
  };
}

async function maybeEnqueueOwnerWhatsAppNotification(
  prisma: PrismaExecutor,
  notification: { id: string; workspaceId: string; type: string; title: string; message: string | null }
): Promise<void> {
  const preferenceKey = NOTIFICATION_TYPE_TO_PREFERENCE[notification.type];
  if (!preferenceKey) return;

  const owner = await resolveOwnerWhatsAppTarget(prisma, notification.workspaceId);
  if (!owner.enabled || !owner.phone) return;
  if (owner.preferences[preferenceKey] === false) return;

  const title = (notification.title || '').trim();
  const message = (notification.message || '').trim();
  const text = message ? `🔔 ${title}\n${message}` : `🔔 ${title}`;
  if (!text.trim()) return;

  try {
    await prisma.eventOutbox.create({
      data: {
        workspaceId: notification.workspaceId,
        eventType: OWNER_WHATSAPP_NOTIFICATION_EVENT,
        aggregateType: 'Notification',
        aggregateId: notification.id,
        payload: {
          to: owner.phone,
          content: { text },
          notification: {
            id: notification.id,
            type: notification.type,
          },
        },
        status: 'pending',
        correlationId: null,
      },
    });
  } catch {
    // Non-fatal: dashboard notifications must still be created.
  }
}

export async function createNotificationIfEnabled(
  prisma: PrismaExecutor,
  data: Prisma.NotificationCreateArgs['data']
): Promise<void> {
  const workspaceId = (data as Prisma.NotificationUncheckedCreateInput).workspaceId;
  const type = (data as Prisma.NotificationUncheckedCreateInput).type;
  if (!workspaceId || !type) {
    await prisma.notification.create({ data });
    return;
  }

  const created = await prisma.notification.create({ data });

  await maybeEnqueueOwnerWhatsAppNotification(prisma, {
    id: created.id,
    workspaceId,
    type,
    title: created.title,
    message: created.message,
  });
}
