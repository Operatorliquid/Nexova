/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * API TYPES
 * Common types for API requests and responses
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API RESPONSE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    validationErrors?: Array<{
      field: string;
      message: string;
      code: string;
    }>;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

export const API_ERROR_CODES = {
  // Authentication errors (1xxx)
  UNAUTHORIZED: 'AUTH_001',
  TOKEN_EXPIRED: 'AUTH_002',
  TOKEN_INVALID: 'AUTH_003',
  MFA_REQUIRED: 'AUTH_004',
  MFA_INVALID: 'AUTH_005',
  ACCOUNT_LOCKED: 'AUTH_006',
  EMAIL_NOT_VERIFIED: 'AUTH_007',

  // Authorization errors (2xxx)
  FORBIDDEN: 'AUTHZ_001',
  INSUFFICIENT_PERMISSIONS: 'AUTHZ_002',
  RESOURCE_NOT_OWNED: 'AUTHZ_003',

  // Validation errors (3xxx)
  VALIDATION_FAILED: 'VAL_001',
  INVALID_INPUT: 'VAL_002',
  MISSING_REQUIRED_FIELD: 'VAL_003',

  // Resource errors (4xxx)
  NOT_FOUND: 'RES_001',
  ALREADY_EXISTS: 'RES_002',
  CONFLICT: 'RES_003',
  GONE: 'RES_004',

  // Business logic errors (5xxx)
  INSUFFICIENT_STOCK: 'BIZ_001',
  ORDER_NOT_MODIFIABLE: 'BIZ_002',
  PAYMENT_FAILED: 'BIZ_003',
  QUOTA_EXCEEDED: 'BIZ_004',
  RATE_LIMIT_EXCEEDED: 'BIZ_005',

  // Integration errors (6xxx)
  INTEGRATION_ERROR: 'INT_001',
  INTEGRATION_TIMEOUT: 'INT_002',
  INTEGRATION_UNAVAILABLE: 'INT_003',

  // Server errors (9xxx)
  INTERNAL_ERROR: 'SRV_001',
  SERVICE_UNAVAILABLE: 'SRV_002',
  TIMEOUT: 'SRV_003',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

export interface RequestContext {
  /** Request ID for tracing */
  requestId: string;
  /** Correlation ID (propagated across services) */
  correlationId: string;
  /** Authenticated user ID */
  userId?: string;
  /** Current workspace ID */
  workspaceId?: string;
  /** User's role in workspace */
  role?: string;
  /** User's permissions */
  permissions?: string[];
  /** Client IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebhookPayload {
  /** Provider identifier */
  provider: 'infobip' | 'mercadopago';
  /** Webhook event type */
  eventType: string;
  /** Raw payload */
  payload: unknown;
  /** Signature for verification */
  signature?: string;
  /** Timestamp */
  timestamp: string;
}

export interface InboundMessage {
  /** External message ID (for idempotency) */
  messageId: string;
  /** Sender phone number (E.164) */
  from: string;
  /** Recipient phone number (E.164) */
  to: string;
  /** Message timestamp */
  timestamp: Date;
  /** Message type */
  type: 'text' | 'image' | 'document' | 'location' | 'button_reply' | 'list_reply';
  /** Message content */
  content: {
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
    latitude?: number;
    longitude?: number;
    buttonId?: string;
    buttonText?: string;
    listRowId?: string;
  };
  /** Contact information */
  contact?: {
    name?: string;
    phone?: string;
  };
  /** Reply context */
  context?: {
    referredMessageId?: string;
  };
  /** Raw original payload */
  raw: unknown;
}

export interface DeliveryReport {
  /** Message ID */
  messageId: string;
  /** Recipient */
  to: string;
  /** Delivery status */
  status: 'sent' | 'delivered' | 'read' | 'failed';
  /** Status timestamp */
  timestamp: Date;
  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type WebSocketMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'event'
  | 'ping'
  | 'pong'
  | 'error';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  channel?: string;
  data?: T;
  error?: string;
  timestamp?: string;
}

export type WebSocketChannel =
  | 'sessions:*'
  | 'sessions:messages'
  | 'sessions:state'
  | 'orders:*'
  | 'orders:created'
  | 'orders:updated'
  | 'handoffs:pending'
  | 'handoffs:claimed'
  | 'stock:low'
  | 'payments:*';
