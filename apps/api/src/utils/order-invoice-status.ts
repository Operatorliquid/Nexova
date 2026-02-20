import { Prisma } from '@prisma/client';

export const ORDER_INVOICE_STATUSES = ['pending_invoicing', 'invoiced', 'invoice_cancelled'] as const;
export type OrderInvoiceStatus = (typeof ORDER_INVOICE_STATUSES)[number];

const ORDER_INVOICE_STATUS_SET = new Set<string>(ORDER_INVOICE_STATUSES);

const asMetadataRecord = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const isOrderInvoiceStatus = (value: string | null | undefined): value is OrderInvoiceStatus =>
  typeof value === 'string' && ORDER_INVOICE_STATUS_SET.has(value);

export const resolveOrderInvoiceStatus = (input: {
  status: string;
  metadata?: Prisma.JsonValue | null;
}): OrderInvoiceStatus | null => {
  if (isOrderInvoiceStatus(input.status)) return input.status;
  const metadata = asMetadataRecord(input.metadata);
  const raw = metadata.invoiceStatus;
  if (typeof raw === 'string' && isOrderInvoiceStatus(raw)) {
    return raw;
  }
  return null;
};

export const buildOrderInvoiceStatusWhere = (invoiceStatus: OrderInvoiceStatus): Prisma.OrderWhereInput => ({
  OR: [
    { status: invoiceStatus },
    { metadata: { path: ['invoiceStatus'], equals: invoiceStatus } },
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
