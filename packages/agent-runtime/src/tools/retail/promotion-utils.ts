type UnknownRecord = Record<string, unknown>;

export interface PromotionRecord {
  id: string;
  name: string;
  promoType: string;
  value: number;
  status: string;
  startsAt: Date;
  endsAt: Date;
  productId: string;
  metadata?: unknown;
}

export interface PromotionItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface PromotionDiscountResult {
  discount: number;
  matchedSubtotal: number;
}

export interface PromotionRuleConfig {
  buyQuantity: number;
  payQuantity: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const DEFAULT_BUY_X_PAY_Y_RULES: PromotionRuleConfig = {
  buyQuantity: 2,
  payQuantity: 1,
};

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function readInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

export function getPromotionRules(promotion: Pick<PromotionRecord, 'promoType' | 'metadata'>): PromotionRuleConfig | null {
  if (promotion.promoType !== 'buy_x_pay_y') return null;
  const metadata = asRecord(promotion.metadata);
  const rules = asRecord(metadata?.promoRules) || asRecord(metadata?.rules);
  const buyRaw = readInt(rules?.buyQuantity);
  const payRaw = readInt(rules?.payQuantity);
  const buyQuantity = buyRaw && buyRaw >= 2 ? buyRaw : DEFAULT_BUY_X_PAY_Y_RULES.buyQuantity;
  const payCandidate = payRaw && payRaw >= 1 ? payRaw : DEFAULT_BUY_X_PAY_Y_RULES.payQuantity;
  const payQuantity = Math.max(1, Math.min(payCandidate, buyQuantity - 1));
  return { buyQuantity, payQuantity };
}

export function computePromotionStatus(status: string, startsAt: Date, endsAt: Date, now: Date = new Date()): string {
  if (status === 'archived' || status === 'paused' || status === 'draft' || status === 'expired') {
    return status;
  }
  if (now > endsAt) return 'expired';
  if (now < startsAt) return 'draft';
  return status;
}

export function promotionIsUsable(promotion: Pick<PromotionRecord, 'status' | 'startsAt' | 'endsAt'>, at: Date = new Date()): boolean {
  return promotion.status === 'active' && promotion.startsAt <= at && promotion.endsAt >= at;
}

export function formatPromotionRemainingTime(now: Date, endsAt: Date): string {
  const remainingMs = Math.max(0, endsAt.getTime() - now.getTime());
  if (remainingMs === 0) return 'ahora';

  const days = Math.floor(remainingMs / MS_PER_DAY);
  const hours = Math.floor((remainingMs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((remainingMs % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return days === 1 ? '1 día' : `${days} días`;
  if (hours > 0) return hours === 1 ? '1 hora' : `${hours} horas`;
  if (minutes > 0) return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
  return 'menos de 1 minuto';
}

export function formatPromotionValueLabel(params: {
  promotion: Pick<PromotionRecord, 'promoType' | 'value' | 'metadata'>;
  productBasePrice: number;
}): { label: string; promoPrice: number; savings: number } {
  const { promotion, productBasePrice } = params;
  if (promotion.promoType === 'percentage') {
    const percentage = Math.max(0, Math.min(100, promotion.value));
    const promoPrice = Math.max(0, Math.round((productBasePrice * (100 - percentage)) / 100));
    return {
      label: `${percentage}% OFF`,
      promoPrice,
      savings: Math.max(productBasePrice - promoPrice, 0),
    };
  }

  if (promotion.promoType === 'fixed_price') {
    const promoPrice = Math.max(0, promotion.value);
    return {
      label: `Precio promo $${Math.round(promoPrice / 100).toLocaleString('es-AR')}`,
      promoPrice,
      savings: Math.max(productBasePrice - promoPrice, 0),
    };
  }

  if (promotion.promoType === 'second_unit_percentage') {
    const percent = Math.max(0, Math.min(100, promotion.value));
    const promoPrice = Math.max(0, Math.round(productBasePrice * (1 - percent / 200)));
    return {
      label: `${percent}% en 2da unidad`,
      promoPrice,
      savings: Math.max(productBasePrice - promoPrice, 0),
    };
  }

  if (promotion.promoType === 'buy_x_pay_y') {
    const rules = getPromotionRules(promotion) || DEFAULT_BUY_X_PAY_Y_RULES;
    const promoPrice = Math.max(0, Math.round((productBasePrice * rules.payQuantity) / rules.buyQuantity));
    return {
      label: `${rules.buyQuantity}x${rules.payQuantity}`,
      promoPrice,
      savings: Math.max(productBasePrice - promoPrice, 0),
    };
  }

  return {
    label: `${promotion.value}`,
    promoPrice: productBasePrice,
    savings: 0,
  };
}

export function calculatePromotionDiscount(params: {
  promotion: PromotionRecord;
  items: PromotionItemInput[];
}): PromotionDiscountResult {
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
      totalDiscount += bundles * freeUnitsPerBundle * item.unitPrice;
    }
    return { discount: totalDiscount, matchedSubtotal };
  }

  return { discount: 0, matchedSubtotal: 0 };
}

export function selectBestPromotion(params: {
  promotions: PromotionRecord[];
  items: PromotionItemInput[];
  now?: Date;
}): { promotion: PromotionRecord; result: PromotionDiscountResult } | null {
  const now = params.now || new Date();
  let best: { promotion: PromotionRecord; result: PromotionDiscountResult } | null = null;

  for (const promotion of params.promotions) {
    if (!promotionIsUsable(promotion, now)) continue;
    const result = calculatePromotionDiscount({
      promotion,
      items: params.items,
    });
    if (result.discount <= 0 || result.matchedSubtotal <= 0) continue;

    if (!best) {
      best = { promotion, result };
      continue;
    }
    const hasBetterDiscount = result.discount > best.result.discount;
    const sameDiscountEndsSooner =
      result.discount === best.result.discount && promotion.endsAt.getTime() < best.promotion.endsAt.getTime();

    if (hasBetterDiscount || sameDiscountEndsSooner) {
      best = { promotion, result };
    }
  }

  return best;
}
