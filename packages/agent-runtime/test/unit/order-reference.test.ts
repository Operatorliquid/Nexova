import { describe, expect, it } from 'vitest';

import { extractOrderReferenceDigits, normalizeOrderReference } from '../../src/utils/order-reference.js';

describe('order-reference utils', () => {
  it('normalizes common order formats', () => {
    expect(normalizeOrderReference('ord 00005')).toBe('ORD-00005');
    expect(normalizeOrderReference('ORD-5')).toBe('ORD-5');
    expect(normalizeOrderReference('#15')).toBe('ORD-15');
    expect(normalizeOrderReference('15')).toBe('ORD-15');
  });

  it('extracts digits from normalized references', () => {
    expect(extractOrderReferenceDigits('ord-00005')).toBe('00005');
    expect(extractOrderReferenceDigits('pedido 123')).toBe('123');
    expect(extractOrderReferenceDigits('sin numero')).toBeNull();
  });
});
