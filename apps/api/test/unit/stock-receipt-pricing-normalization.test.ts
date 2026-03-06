import { describe, expect, it } from 'vitest';

import { normalizeExtractedStockReceiptPricing } from '../../src/utils/stock-receipt-claude.js';

describe('normalizeExtractedStockReceiptPricing', () => {
  it('normalizes pack price to base-unit price when line total indicates pack pricing', () => {
    const normalized = normalizeExtractedStockReceiptPricing({
      quantity: 1,
      isPack: true,
      unitsPerPack: 6,
      unitPriceCents: 60000,
      lineTotalCents: 60000,
    });

    expect(normalized.unitPriceCents).toBe(10000);
    expect(normalized.lineTotalCents).toBe(60000);
  });

  it('keeps base-unit price as-is when line total already matches base units', () => {
    const normalized = normalizeExtractedStockReceiptPricing({
      quantity: 2,
      isPack: true,
      unitsPerPack: 6,
      unitPriceCents: 10000,
      lineTotalCents: 120000,
    });

    expect(normalized.unitPriceCents).toBe(10000);
    expect(normalized.lineTotalCents).toBe(120000);
  });

  it('infers line total when only pack price is present', () => {
    const normalized = normalizeExtractedStockReceiptPricing({
      quantity: 3,
      isPack: true,
      unitsPerPack: 6,
      unitPriceCents: 60000,
      lineTotalCents: null,
    });

    expect(normalized.unitPriceCents).toBe(10000);
    expect(normalized.lineTotalCents).toBe(180000);
  });

  it('infers base-unit price from line total for packs', () => {
    const normalized = normalizeExtractedStockReceiptPricing({
      quantity: 2,
      isPack: true,
      unitsPerPack: 6,
      unitPriceCents: null,
      lineTotalCents: 120000,
    });

    expect(normalized.unitPriceCents).toBe(10000);
    expect(normalized.lineTotalCents).toBe(120000);
  });

  it('keeps classic quantity * unit behavior for non-pack lines', () => {
    const normalized = normalizeExtractedStockReceiptPricing({
      quantity: 4,
      isPack: false,
      unitsPerPack: null,
      unitPriceCents: 2500,
      lineTotalCents: null,
    });

    expect(normalized.unitPriceCents).toBe(2500);
    expect(normalized.lineTotalCents).toBe(10000);
  });
});
