import type { CommercePlan } from './commerce-plan.js';

export interface CommercePlanLimitConfig {
  /**
   * Max orders per calendar month (UTC).
   * null = unlimited.
   */
  ordersPerMonth: number | null;
  /**
   * Max AI metrics insights generations per month (UTC).
   * null = unlimited.
   */
  aiMetricsInsightsPerMonth: number | null;
  /**
   * Max AI customer summaries generations per month (UTC).
   * null = unlimited.
   */
  aiCustomerSummariesPerMonth: number | null;
  /**
   * Max debt reminders sent per month (UTC).
   * null = unlimited.
   */
  debtRemindersPerMonth: number | null;
}

export type CommercePlanLimitsConfig = Partial<Record<CommercePlan, Partial<CommercePlanLimitConfig>>>;

export const DEFAULT_COMMERCE_PLAN_LIMITS: Record<CommercePlan, CommercePlanLimitConfig> = {
  basic: {
    ordersPerMonth: 200,
    aiMetricsInsightsPerMonth: null,
    aiCustomerSummariesPerMonth: null,
    debtRemindersPerMonth: null,
  },
  standard: {
    ordersPerMonth: 550,
    aiMetricsInsightsPerMonth: null,
    aiCustomerSummariesPerMonth: null,
    debtRemindersPerMonth: null,
  },
  pro: {
    ordersPerMonth: 1700,
    aiMetricsInsightsPerMonth: null,
    aiCustomerSummariesPerMonth: null,
    debtRemindersPerMonth: null,
  },
};

export const COMMERCE_USAGE_METRICS = {
  aiMetricsInsights: 'ai.metrics_insights',
  aiCustomerSummary: 'ai.customer_summary',
  debtRemindersSent: 'debt.reminders.sent',
} as const;

