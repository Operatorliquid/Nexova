/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * QUEUE PAYLOAD TYPES
 * Type definitions for BullMQ job payloads
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// agent:process
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentProcessPayload {
  /** Workspace ID for multi-tenancy */
  workspaceId: string;
  /** External message ID (for idempotency) */
  messageId: string;
  /** Customer phone number or channel identifier */
  channelId: string;
  /** Channel type */
  channelType: 'whatsapp' | 'web' | 'api';
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Job priority */
  priority?: 'high' | 'normal' | 'low';
  /** Additional metadata */
  metadata?: {
    customerName?: string;
    isReply?: boolean;
    referredMessageId?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// message:send
// ═══════════════════════════════════════════════════════════════════════════════

export interface MessageSendPayload {
  /** Workspace ID */
  workspaceId: string;
  /** Agent session ID */
  sessionId: string;
  /** Recipient phone number (E.164) */
  to: string;
  /** Message type */
  messageType: 'text' | 'template' | 'media' | 'interactive';
  /** Message content */
  content: {
    /** Plain text content */
    text?: string;
    /** Optional header text for interactive messages */
    header?: string;
    /** Optional footer text for interactive messages */
    footer?: string;
    /** Template ID (for template messages) */
    templateId?: string;
    /** Template parameters */
    templateParams?: Record<string, string>;
    /** Media URL (for media messages) */
    mediaUrl?: string;
    /** Media type */
    mediaType?: 'image' | 'document' | 'audio' | 'video';
    /** Interactive buttons */
    buttons?: Array<{ id: string; title: string }>;
    /** Interactive list button label */
    buttonText?: string;
    /** Interactive list sections */
    listSections?: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
  /** Correlation ID for tracing */
  correlationId: string;
  /** Reply to specific message */
  replyToMessageId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// outbox:relay
// ═══════════════════════════════════════════════════════════════════════════════

export interface OutboxRelayPayload {
  /** Batch size - how many events to process */
  batchSize: number;
  /** Only process events older than X ms (optional) */
  maxAge?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// webhook:retry
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebhookRetryPayload {
  /** Webhook inbox record ID */
  webhookInboxId?: string;
  /** Workspace ID */
  workspaceId?: string;
  /** Current attempt number */
  attempt?: number;
  /** Scan and enqueue failed webhooks */
  scan?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// scheduled:jobs
// ═══════════════════════════════════════════════════════════════════════════════

export type ScheduledJobType =
  | 'session:cleanup'
  | 'reservation:expire'
  | 'draft:expire'
  | 'usage:aggregate'
  | 'connection:health'
  | 'memory:prune'
  | 'audit:archive'
  | 'stock:reorder-check';

export interface ScheduledJobPayload {
  /** Job type identifier */
  jobType: ScheduledJobType;
  /** Specific workspace (null = all workspaces) */
  workspaceId?: string;
  /** Job-specific parameters */
  params?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// notification:send
// ═══════════════════════════════════════════════════════════════════════════════

export type NotificationChannel = 'email' | 'push' | 'sms' | 'slack' | 'webhook';

export interface NotificationPayload {
  /** Workspace ID */
  workspaceId: string;
  /** Notification channel */
  channel: NotificationChannel;
  /** Recipient identifier (email, user ID, phone, etc.) */
  recipient: string;
  /** Notification type/template */
  type: string;
  /** Template data */
  data: Record<string, unknown>;
  /** Priority */
  priority?: 'high' | 'normal' | 'low';
  /** Correlation ID */
  correlationId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// debt:reminder
// ═══════════════════════════════════════════════════════════════════════════════

export interface DebtReminderPayload {
  /** Workspace ID to process */
  workspaceId: string;
  /** Specific customer ID (optional - if null, process all eligible customers) */
  customerId?: string;
  /** Reminder level (1, 2, 3) - corresponds to firstReminderDays, secondReminderDays, etc. */
  reminderLevel?: number;
  /** Force send even if recently reminded */
  force?: boolean;
  /** Correlation ID for tracing */
  correlationId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// dlq:failed (Dead Letter Queue)
// ═══════════════════════════════════════════════════════════════════════════════

export interface DLQPayload {
  /** Original queue name */
  originalQueue: string;
  /** Original job ID */
  jobId: string;
  /** Original job payload */
  payload: unknown;
  /** Final error message */
  error: string;
  /** Total attempts made */
  attempts: number;
  /** When job was moved to DLQ */
  failedAt: string;
  /** Stack trace if available */
  stack?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNION TYPE FOR ALL PAYLOADS
// ═══════════════════════════════════════════════════════════════════════════════

export type QueuePayload =
  | AgentProcessPayload
  | MessageSendPayload
  | OutboxRelayPayload
  | WebhookRetryPayload
  | ScheduledJobPayload
  | NotificationPayload
  | DebtReminderPayload
  | DLQPayload;
