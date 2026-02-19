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
  /**
   * Max WhatsApp audio transcriptions per month (UTC).
   * null = unlimited.
   */
  audioTranscriptionsPerMonth: number | null;
  /**
   * Max communication actions per month (UTC).
   * Counts both promotion creations and broadcast campaign creations.
   * null = unlimited.
   */
  communicationsActionsPerMonth: number | null;
}

export type CommercePlanLimitsConfig = Partial<Record<CommercePlan, Partial<CommercePlanLimitConfig>>>;

export const DEFAULT_COMMERCE_PLAN_LIMITS: Record<CommercePlan, CommercePlanLimitConfig> = {
  basic: {
    ordersPerMonth: 200,
    aiMetricsInsightsPerMonth: null,
    aiCustomerSummariesPerMonth: null,
    debtRemindersPerMonth: null,
    audioTranscriptionsPerMonth: null,
    communicationsActionsPerMonth: null,
  },
  standard: {
    ordersPerMonth: 550,
    aiMetricsInsightsPerMonth: null,
    aiCustomerSummariesPerMonth: null,
    debtRemindersPerMonth: null,
    audioTranscriptionsPerMonth: null,
    communicationsActionsPerMonth: 150,
  },
  pro: {
    ordersPerMonth: 1700,
    aiMetricsInsightsPerMonth: null,
    aiCustomerSummariesPerMonth: null,
    debtRemindersPerMonth: null,
    audioTranscriptionsPerMonth: null,
    communicationsActionsPerMonth: 300,
  },
};

export const COMMERCE_USAGE_METRICS = {
  aiMetricsInsights: 'ai.metrics_insights',
  aiCustomerSummary: 'ai.customer_summary',
  debtRemindersSent: 'debt.reminders.sent',
  audioTranscriptions: 'audio.transcriptions',
  communicationsActions: 'communications.actions',
} as const;
