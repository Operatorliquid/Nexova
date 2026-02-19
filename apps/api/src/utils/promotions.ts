export interface PromotionDiscountInput {
  id: string;
  name: string;
  promoType: string;
  value: number;
  startsAt: Date;
  endsAt: Date;
  status: string;
  productId: string;
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

  return { discount: 0, matchedSubtotal: 0 };
}

