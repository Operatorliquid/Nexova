import {
  BILLING_MONTH_OPTIONS,
  BILLING_PLAN_CATALOG,
  coerceBillingMonths,
  getPlanBillingTotalCents,
  isValidBillingMonthsOption,
  normalizeCommercePlan,
  type BillingMonthsOption,
  type CommercePlan,
} from '@nexova/shared';

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

export const getConfiguredMonthlyAmountCents = (plan: CommercePlan): number => {
  const envValue =
    plan === 'basic'
      ? process.env.STRIPE_PRICE_BASIC_MONTHLY_CENTS
      : plan === 'standard'
        ? process.env.STRIPE_PRICE_STANDARD_MONTHLY_CENTS
        : process.env.STRIPE_PRICE_PRO_MONTHLY_CENTS;

  const parsed = parsePositiveInteger(envValue);
  return parsed ?? BILLING_PLAN_CATALOG[plan].monthlyAmountCents;
};

export const buildBillingCatalog = () => {
  return (Object.keys(BILLING_PLAN_CATALOG) as CommercePlan[]).map((plan) => {
    const base = BILLING_PLAN_CATALOG[plan];
    const monthlyAmountCents = getConfiguredMonthlyAmountCents(plan);
    return {
      ...base,
      monthlyAmountCents,
    };
  });
};

export const normalizePlanInput = (value: unknown): CommercePlan | null => {
  return normalizeCommercePlan(value);
};

export const normalizeMonthsInput = (value: unknown): BillingMonthsOption => {
  return coerceBillingMonths(value, 1);
};

export const isSupportedMonths = (value: unknown): value is BillingMonthsOption => {
  return isValidBillingMonthsOption(value);
};

export const getBillingTotalCents = (plan: CommercePlan, months: BillingMonthsOption): number => {
  const monthly = getConfiguredMonthlyAmountCents(plan);
  const defaultMonthly = BILLING_PLAN_CATALOG[plan].monthlyAmountCents;
  if (monthly === defaultMonthly) {
    return getPlanBillingTotalCents(plan, months);
  }
  return monthly * months;
};

export const getBillingMonthOptions = () => BILLING_MONTH_OPTIONS;

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

export const getLandingUrl = (): string => {
  return process.env.LANDING_URL || 'http://localhost:5174';
};

export const getDashboardUrl = (): string => {
  return process.env.DASHBOARD_URL || 'http://localhost:5173';
};

export const getApiPublicUrl = (): string => {
  return process.env.API_PUBLIC_URL || `http://localhost:${process.env.API_PORT || '3000'}`;
};

