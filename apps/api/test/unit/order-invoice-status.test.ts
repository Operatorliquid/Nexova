import { describe, expect, it } from 'vitest';

import {
  mergeOrderInvoiceStatusMetadata,
  resolveOrderInvoiceStatus,
} from '../../src/utils/order-invoice-status.js';

describe('order invoice status resolver', () => {
  it('keeps invoiced visible even when primary status is accepted', () => {
    const metadata = mergeOrderInvoiceStatusMetadata({}, 'invoiced');
    const status = resolveOrderInvoiceStatus({
      status: 'accepted',
      metadata,
    });

    expect(status).toBe('invoiced');
  });

  it('falls back to status history when metadata is missing', () => {
    const status = resolveOrderInvoiceStatus({
      status: 'accepted',
      metadata: null,
      statusHistory: [
        { newStatus: 'pending_invoicing', createdAt: '2026-02-10T10:00:00.000Z' },
      ],
    });

    expect(status).toBe('pending_invoicing');
  });

  it('picks the latest invoice status from history', () => {
    const status = resolveOrderInvoiceStatus({
      status: 'accepted',
      metadata: null,
      statusHistory: [
        { newStatus: 'pending_invoicing', createdAt: '2026-02-10T10:00:00.000Z' },
        { newStatus: 'invoiced', createdAt: '2026-02-11T10:00:00.000Z' },
      ],
    });

    expect(status).toBe('invoiced');
  });
});

