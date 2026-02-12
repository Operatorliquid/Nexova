import type { CommercePlan } from './commerce-plan.js';

export type BillingMonthsOption = 1 | 12 | 24 | 48;

export interface BillingPlanCatalogItem {
  plan: CommercePlan;
  name: string;
  description: string;
  currency: 'USD';
  monthlyAmountCents: number;
}

export const BILLING_MONTH_OPTIONS: BillingMonthsOption[] = [1, 12, 24, 48];

export const BILLING_PLAN_CATALOG: Record<CommercePlan, BillingPlanCatalogItem> = {
  basic: {
    plan: 'basic',
    name: 'Basic',
    description: 'Funciones esenciales para operar con WhatsApp y dashboard.',
    currency: 'USD',
    monthlyAmountCents: 2900,
  },
  standard: {
    plan: 'standard',
    name: 'Standard',
    description: 'Más automatización y módulos completos para crecer.',
    currency: 'USD',
    monthlyAmountCents: 5900,
  },
  pro: {
    plan: 'pro',
    name: 'Pro',
    description: 'Acceso total a todas las funcionalidades del dashboard.',
    currency: 'USD',
    monthlyAmountCents: 9900,
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

