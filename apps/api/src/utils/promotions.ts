export interface PromotionDiscountInput {
  id: string;
  name: string;
  promoType: string;
  value: number;
  startsAt: Date;
  endsAt: Date;
  status: string;
  productId: string;
  metadata?: unknown;
}

export type PromotionRuleConfig = {
  buyQuantity: number;
  payQuantity: number;
};

const DEFAULT_BUY_X_PAY_Y_RULES: PromotionRuleConfig = {
  buyQuantity: 2,
  payQuantity: 1,
};

const PROMOTION_TYPES_WITH_PERCENT_VALUE = new Set(['percentage', 'second_unit_percentage']);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

export function getPromotionRules(promotion: Pick<PromotionDiscountInput, 'promoType' | 'metadata'>): PromotionRuleConfig | null {
  if (promotion.promoType !== 'buy_x_pay_y') return null;

  const metadata = asRecord(promotion.metadata);
  const rulesRecord =
    asRecord(metadata?.promoRules)
    || asRecord(metadata?.rules)
    || null;

  const buyRaw = readInt(rulesRecord?.buyQuantity);
  const payRaw = readInt(rulesRecord?.payQuantity);
  const buyQuantity = buyRaw && buyRaw >= 2 ? buyRaw : DEFAULT_BUY_X_PAY_Y_RULES.buyQuantity;
  const payCandidate = payRaw && payRaw >= 1 ? payRaw : DEFAULT_BUY_X_PAY_Y_RULES.payQuantity;
  const payQuantity = Math.min(payCandidate, buyQuantity - 1);

  return {
    buyQuantity,
    payQuantity: Math.max(payQuantity, 1),
  };
}

export function validatePromotionDefinition(params: {
  promoType: string;
  value: number;
  rules?: unknown;
}): { valid: true; normalizedRules: PromotionRuleConfig | null } | { valid: false; message: string } {
  const { promoType, value, rules } = params;

  if (promoType === 'fixed_price') {
    if (value < 1) {
      return { valid: false, message: 'El precio fijo debe ser mayor a 0.' };
    }
    return { valid: true, normalizedRules: null };
  }

  if (PROMOTION_TYPES_WITH_PERCENT_VALUE.has(promoType)) {
    if (value < 1 || value > 100) {
      return { valid: false, message: 'El porcentaje debe estar entre 1 y 100.' };
    }
    return { valid: true, normalizedRules: null };
  }

  if (promoType === 'buy_x_pay_y') {
    const rulesRecord = asRecord(rules);
    const buyQuantity = readInt(rulesRecord?.buyQuantity) ?? DEFAULT_BUY_X_PAY_Y_RULES.buyQuantity;
    const payQuantity = readInt(rulesRecord?.payQuantity) ?? DEFAULT_BUY_X_PAY_Y_RULES.payQuantity;
    if (buyQuantity < 2) {
      return { valid: false, message: 'En promo X por Y, X debe ser al menos 2.' };
    }
    if (payQuantity < 1) {
      return { valid: false, message: 'En promo X por Y, Y debe ser al menos 1.' };
    }
    if (payQuantity >= buyQuantity) {
      return { valid: false, message: 'En promo X por Y, Y debe ser menor que X.' };
    }
    return {
      valid: true,
      normalizedRules: { buyQuantity, payQuantity },
    };
  }

  return { valid: false, message: 'Tipo de promoción no soportado.' };
}

export function getPromotionValueLabel(params: {
  promoType: string;
  value: number;
  metadata?: unknown;
}): string {
  const { promoType, value, metadata } = params;
  if (promoType === 'percentage') {
    const percent = Math.max(0, Math.min(100, value));
    return `${percent}% OFF`;
  }
  if (promoType === 'fixed_price') {
    return `Precio fijo`;
  }
  if (promoType === 'second_unit_percentage') {
    const percent = Math.max(0, Math.min(100, value));
    return `${percent}% en 2da unidad`;
  }
  if (promoType === 'buy_x_pay_y') {
    const rules = getPromotionRules({ promoType, metadata });
    const buy = rules?.buyQuantity ?? DEFAULT_BUY_X_PAY_Y_RULES.buyQuantity;
    const pay = rules?.payQuantity ?? DEFAULT_BUY_X_PAY_Y_RULES.payQuantity;
    return `${buy}x${pay}`;
  }
  return `${value}`;
}

export function computePromotionStatus(status: string, startsAt: Date, endsAt: Date): string {
  if (status === 'archived' || status === 'paused' || status === 'draft' || status === 'expired') {
    return status;
  }
  const now = new Date();
  if (now > endsAt) return 'expired';
  if (now < startsAt) return 'draft';
  return status;
}

export function promotionIsUsable(promotion: PromotionDiscountInput, at: Date = new Date()): boolean {
  if (promotion.status !== 'active') return false;
  if (promotion.startsAt > at) return false;
  if (promotion.endsAt < at) return false;
  return true;
}

export function calculatePromotionDiscount(params: {
  promotion: PromotionDiscountInput;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
}): { discount: number; matchedSubtotal: number } {
  const matchedItems = params.items.filter((item) => item.productId === params.promotion.productId);
  if (matchedItems.length === 0) {
    return { discount: 0, matchedSubtotal: 0 };
  }

  const matchedSubtotal = matchedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  if (params.promotion.promoType === 'percentage') {
    const percent = Math.max(0, Math.min(100, params.promotion.value));
    return { discount: Math.round((matchedSubtotal * percent) / 100), matchedSubtotal };
  }

  if (params.promotion.promoType === 'fixed_price') {
    let totalDiscount = 0;
    for (const item of matchedItems) {
      const unitDelta = Math.max(item.unitPrice - params.promotion.value, 0);
      totalDiscount += unitDelta * item.quantity;
    }
    return { discount: totalDiscount, matchedSubtotal };
  }

  if (params.promotion.promoType === 'second_unit_percentage') {
    const percent = Math.max(0, Math.min(100, params.promotion.value));
    if (percent <= 0) {
      return { discount: 0, matchedSubtotal };
    }

    let totalDiscount = 0;
    for (const item of matchedItems) {
      const discountedUnits = Math.floor(item.quantity / 2);
      if (discountedUnits <= 0) continue;
      const discountPerUnit = Math.round((item.unitPrice * percent) / 100);
      totalDiscount += discountPerUnit * discountedUnits;
    }

    return { discount: totalDiscount, matchedSubtotal };
  }

  if (params.promotion.promoType === 'buy_x_pay_y') {
    const rules = getPromotionRules(params.promotion);
    if (!rules) return { discount: 0, matchedSubtotal };

    const freeUnitsPerBundle = Math.max(rules.buyQuantity - rules.payQuantity, 0);
    if (freeUnitsPerBundle <= 0) return { discount: 0, matchedSubtotal };

    let totalDiscount = 0;
    for (const item of matchedItems) {
      const bundles = Math.floor(item.quantity / rules.buyQuantity);
      if (bundles <= 0) continue;
      const freeUnits = bundles * freeUnitsPerBundle;
      totalDiscount += freeUnits * item.unitPrice;
    }

    return { discount: totalDiscount, matchedSubtotal };
  }

  return { discount: 0, matchedSubtotal: 0 };
}
