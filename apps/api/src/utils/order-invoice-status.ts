import { Prisma } from '@prisma/client';

export const ORDER_INVOICE_STATUSES = ['pending_invoicing', 'invoiced', 'invoice_cancelled'] as const;
export type OrderInvoiceStatus = (typeof ORDER_INVOICE_STATUSES)[number];

const ORDER_INVOICE_STATUS_SET = new Set<string>(ORDER_INVOICE_STATUSES);

type OrderStatusHistoryLike = {
  newStatus?: string | null;
  createdAt?: Date | string | null;
};

const asMetadataRecord = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const isOrderInvoiceStatus = (value: string | null | undefined): value is OrderInvoiceStatus =>
  typeof value === 'string' && ORDER_INVOICE_STATUS_SET.has(value);

const resolveFromStatusHistory = (
  statusHistory?: OrderStatusHistoryLike[] | null
): OrderInvoiceStatus | null => {
  if (!Array.isArray(statusHistory) || statusHistory.length === 0) return null;

  let latestStatus: OrderInvoiceStatus | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const entry of statusHistory) {
    const status = typeof entry?.newStatus === 'string' ? entry.newStatus : null;
    if (!isOrderInvoiceStatus(status)) continue;

    const createdAtValue = entry?.createdAt;
    const timestamp = createdAtValue ? new Date(createdAtValue).getTime() : Number.NaN;
    if (Number.isFinite(timestamp)) {
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestStatus = status;
      }
      continue;
    }

    if (!latestStatus) {
      latestStatus = status;
    }
  }

  return latestStatus;
};

export const resolveOrderInvoiceStatus = (input: {
  status: string;
  metadata?: Prisma.JsonValue | null;
  statusHistory?: OrderStatusHistoryLike[] | null;
}): OrderInvoiceStatus | null => {
  const metadata = asMetadataRecord(input.metadata);
  const raw = metadata.invoiceStatus;
  if (typeof raw === 'string' && isOrderInvoiceStatus(raw)) {
    return raw;
  }
  const fromHistory = resolveFromStatusHistory(input.statusHistory);
  if (fromHistory) return fromHistory;
  if (isOrderInvoiceStatus(input.status)) return input.status;
  return null;
};

export const buildOrderInvoiceStatusWhere = (invoiceStatus: OrderInvoiceStatus): Prisma.OrderWhereInput => ({
  OR: [
    { status: invoiceStatus },
    { metadata: { path: ['invoiceStatus'], equals: invoiceStatus } },
    ...(invoiceStatus === 'pending_invoicing'
      ? [
          {
            AND: [
              { statusHistory: { some: { newStatus: 'pending_invoicing' } } },
              { statusHistory: { none: { newStatus: { in: ['invoiced', 'invoice_cancelled'] } } } },
            ],
          } satisfies Prisma.OrderWhereInput,
        ]
      : invoiceStatus === 'invoiced'
        ? [{ statusHistory: { some: { newStatus: 'invoiced' } } } satisfies Prisma.OrderWhereInput]
        : [{ statusHistory: { some: { newStatus: 'invoice_cancelled' } } } satisfies Prisma.OrderWhereInput]),
  ],
});

export const mergeOrderInvoiceStatusMetadata = (
  metadata: Prisma.JsonValue | null | undefined,
  invoiceStatus: OrderInvoiceStatus | null
): Prisma.InputJsonValue => {
  const base = asMetadataRecord(metadata);
  const next: Record<string, unknown> = { ...base };
  if (invoiceStatus) {
    next.invoiceStatus = invoiceStatus;
  } else {
    delete next.invoiceStatus;
  }
  return next as Prisma.InputJsonValue;
};
