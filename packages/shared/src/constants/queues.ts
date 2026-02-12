/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * QUEUE DEFINITIONS
 * BullMQ queue configurations and constants
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface QueueConfig {
  name: string;
  description: string;
  concurrency: number;
  attempts: number;
  backoff: {
    type: 'exponential' | 'linear' | 'fixed';
    delay: number;
  };
  timeout: number;
  priority?: number;
}

export const QUEUES = {
  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════
  AGENT_PROCESS: {
    name: 'agent-process',
    description: 'Main agent processing queue for inbound messages',
    concurrency: 1,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    timeout: 60000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE SENDING
  // ═══════════════════════════════════════════════════════════════════════════
  MESSAGE_SEND: {
    name: 'message-send',
    description: 'Outbound message delivery via integrations',
    concurrency: 20,
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 2000 },
    timeout: 30000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT OUTBOX
  // ═══════════════════════════════════════════════════════════════════════════
  OUTBOX_RELAY: {
    name: 'outbox-relay',
    description: 'Transactional outbox event relay',
    concurrency: 1,
    attempts: 10,
    backoff: { type: 'exponential' as const, delay: 500 },
    timeout: 10000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOK RETRY
  // ═══════════════════════════════════════════════════════════════════════════
  WEBHOOK_RETRY: {
    name: 'webhook-retry',
    description: 'Retry failed webhook processing',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 5000 },
    timeout: 60000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULED JOBS
  // ═══════════════════════════════════════════════════════════════════════════
  SCHEDULED: {
    name: 'scheduled-jobs',
    description: 'Scheduled/cron jobs',
    concurrency: 2,
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 60000 },
    timeout: 300000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  NOTIFICATION: {
    name: 'notification-send',
    description: 'Send notifications (email, push, etc.)',
    concurrency: 10,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    timeout: 30000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBT REMINDERS
  // ═══════════════════════════════════════════════════════════════════════════
  DEBT_REMINDER: {
    name: 'debt-reminder',
    description: 'Send debt reminders to customers with overdue payments',
    concurrency: 5,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
    timeout: 60000,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEAD LETTER QUEUE
  // ═══════════════════════════════════════════════════════════════════════════
  DLQ: {
    name: 'dlq-failed',
    description: 'Dead letter queue for exhausted jobs',
    concurrency: 1,
    attempts: 1,
    backoff: { type: 'fixed' as const, delay: 0 },
    timeout: 60000,
  },
} as const satisfies Record<string, QueueConfig>;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]['name'];
