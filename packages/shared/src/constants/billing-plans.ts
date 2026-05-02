import type { CommercePlan } from './commerce-plan.js';

export type BillingMonthsOption = 1 | 12 | 24 | 48;

export interface BillingPlanCatalogItem {
  plan: CommercePlan;
  name: string;
  description: string;
  currency: 'ARS';
  monthlyAmountCents: number;
}

export const BILLING_MONTH_OPTIONS: BillingMonthsOption[] = [1, 12, 24, 48];

export const BILLING_PLAN_CATALOG: Record<CommercePlan, BillingPlanCatalogItem> = {
  basic: {
    plan: 'basic',
    name: 'Plan Base',
    description: 'Acceso base a plataforma, inbox, bot, catálogo y boleta estándar.',
    currency: 'ARS',
    monthlyAmountCents: 7500000,
  },
  standard: {
    plan: 'standard',
    name: 'Plan Pro',
    description: 'Automatización comercial, promociones, facturación y catálogo personalizado.',
    currency: 'ARS',
    monthlyAmountCents: 15000000,
  },
  pro: {
    plan: 'pro',
    name: 'Plan Empresa',
    description: 'Operación avanzada con acciones rápidas y control por WhatsApp en vivo.',
    currency: 'ARS',
    monthlyAmountCents: 20000000,
  },
};

export function isValidBillingMonthsOption(value: unknown): value is BillingMonthsOption {
  return typeof value === 'number' && BILLING_MONTH_OPTIONS.includes(value as BillingMonthsOption);
}

export function coerceBillingMonths(value: unknown, fallback: BillingMonthsOption = 1): BillingMonthsOption {
  const asNumber = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  return isValidBillingMonthsOption(asNumber) ? asNumber : fallback;
}

export function getPlanBillingTotalCents(plan: CommercePlan, months: BillingMonthsOption): number {
  return BILLING_PLAN_CATALOG[plan].monthlyAmountCents * months;
}
