/**
 * Agent Runtime Types
 */
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// FSM STATES
// ═══════════════════════════════════════════════════════════════════════════════

export const AgentState = {
  IDLE: 'IDLE',
  COLLECTING_ORDER: 'COLLECTING_ORDER',
  NEEDS_DETAILS: 'NEEDS_DETAILS',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  EXECUTING: 'EXECUTING',
  DONE: 'DONE',
  HANDOFF: 'HANDOFF',
} as const;

export type AgentStateType = (typeof AgentState)[keyof typeof AgentState];

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const ToolCategory = {
  QUERY: 'query',
  MUTATION: 'mutation',
  SYSTEM: 'system',
} as const;

export type ToolCategoryType = (typeof ToolCategory)[keyof typeof ToolCategory];

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategoryType;
  inputSchema: z.ZodSchema;
  requiresConfirmation?: boolean;
  idempotencyKey?: (input: Record<string, unknown>) => string;
}

export interface ToolContext {
  workspaceId: string;
  sessionId: string;
  customerId: string;
  userId?: string;
  correlationId: string;
  currentState: AgentStateType;
  channelType?: 'whatsapp' | 'web' | 'api';
  isOwner?: boolean;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stateTransition?: AgentStateType;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CART TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CartItem {
  productId: string;
  variantId?: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  availableStock: number;
}

export interface Cart {
  sessionId: string;
  workspaceId: string;
  customerId: string;
  items: CartItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  notes?: string;
  shippingAddress?: ShippingAddress;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CustomerInfo {
  id: string;
  phone: string;
  firstName?: string;
  lastName?: string;
  dni?: string;
  email?: string;
  isNew: boolean;
  needsRegistration: boolean;
  preferences: Record<string, unknown>;
  notes?: string[];
  totalOrders: number;
  totalSpent: number;
  lastOrderAt?: Date;
  debt: number;
  paymentScore?: number;
  paymentScoreLabel?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMERCE PROFILE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CommerceProfile {
  name: string;
  phone?: string;
  address?: string;
  city?: string;
  schedule?: string;
  deliveryInfo?: string;
  paymentMethods?: string[];
  policies?: string;
  customInstructions?: string;
  // New commerce profile fields
  whatsappContact?: string;
  paymentAlias?: string;
  paymentCbu?: string;
  paymentMethodsEnabled?: {
    mpLink?: boolean;
    transfer?: boolean;
    cash?: boolean;
  };
  vatConditionId?: string;
  workingDays?: string[];
  continuousHours?: boolean;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  morningShiftStart?: string;
  morningShiftEnd?: string;
  afternoonShiftStart?: string;
  afternoonShiftEnd?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION MEMORY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface SessionMemory {
  sessionId: string;
  workspaceId: string;
  customerId: string;
  state: AgentStateType;
  cart: Cart | null;
  pendingConfirmation: PendingConfirmation | null;
  context: ConversationContext;
  lastActivityAt: Date;
}

export interface PendingConfirmation {
  action: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  message: string;
  expiresAt: Date;
}

export interface ConversationContext {
  customerInfo: CustomerInfo | null;
  pendingRegistration?: {
    firstName?: string;
    lastName?: string;
    dni?: string;
  };
  registrationGreetingSent?: boolean;
  lastQuestion?: string;
  pendingOrderId?: string;
  pendingOrderNumber?: string;
  pendingOrderOptions?: Array<{
    id: string;
    orderNumber?: string;
  }>;
  pendingInvoicePrompt?: {
    orderId: string;
    orderNumber: string;
  };
  invoiceDataCollection?: {
    orderId: string;
    orderNumber?: string;
    step: 'cuit' | 'businessName' | 'fiscalAddress' | 'vatCondition' | 'confirm' | 'edit_select' | 'edit_field';
    data: {
      cuit?: string;
      businessName?: string;
      fiscalAddress?: string;
      vatCondition?: string;
    };
    editingField?: 'cuit' | 'businessName' | 'fiscalAddress' | 'vatCondition';
    vatPage?: number;
  };
  pendingOrderDecision?: boolean;
  activeOrdersPrompt?: boolean;
  activeOrdersAction?: 'edit' | 'cancel' | 'invoice';
  activeOrdersAwaiting?: Array<{
    id: string;
    orderNumber: string;
  }>;
  activeOrdersPayable?: Array<{
    id: string;
    orderNumber: string;
    pendingAmount: number;
  }>;
  activeOrdersSubmenu?: 'other';
  activeOrdersInvoiceOptions?: Array<{
    id: string;
    orderNumber: string;
  }>;
  paymentStage?: 'select_order' | 'select_method' | 'select_method_more' | 'await_receipt' | 'await_receipt_amount' | 'confirm_receipt';
  paymentMethod?: 'transfer' | 'link' | 'cash';
  paymentOrders?: Array<{
    id: string;
    orderNumber: string;
    pendingAmount: number;
  }>;
  paymentOrderId?: string;
  paymentOrderNumber?: string;
  paymentPendingAmount?: number;
  paymentReceiptId?: string;
  paymentReceiptAmount?: number;
  pendingProductSelection?: {
    quantity: number;
    requestedName?: string;
    options: Array<{
      productId: string;
      variantId?: string;
      name: string;
      price?: number;
      secondaryUnit?: string | null;
      secondaryUnitValue?: string | number | null;
    }>;
    requestedSecondaryUnit?: 'pack' | 'box' | 'bundle' | 'dozen';
    remainingSegments?: Array<{
      quantity: number;
      name: string;
    }>;
    pendingUnknown?: string[];
    pendingErrors?: string[];
    pendingShortages?: Array<{
      productId?: string;
      variantId?: string;
      name: string;
      available: number;
      requested: number;
      mode?: 'add' | 'set';
    }>;
  };
  pendingCancelOrderId?: string;
  pendingCancelOrderNumber?: string;
  pendingStockAdjustment?: {
    items: Array<{
      productId?: string;
      variantId?: string;
      name: string;
      available: number;
      requested: number;
      mode?: 'add' | 'set';
    }>;
  };
  pendingCatalogOffer?: {
    requested?: string[];
  };
  otherInquiry?: boolean;
  repeatOrders?: Array<{
    id: string;
    orderNumber: string;
  }>;
  repeatOrderId?: string;
  repeatOrderNumber?: string;
  orderViewAwaitingAck?: boolean;
  orderViewAwaitingNumber?: boolean;
  editingOrderId?: string;
  editingOrderNumber?: string;
  editingOrderOriginalItems?: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    name: string;
  }>;
  commerceProfile?: CommerceProfile;
  interruptedTopic?: string;
  lastMenu?: 'primary' | 'secondary';
  lastProductInquiry?: {
    name: string;
    unit?: string;
    unitValue?: string;
    displayName?: string;
    at?: string;
  };
  /**
   * Owner-mode focus context.
   * Used to resolve follow-ups like "su deuda", "ese cliente", "ese pedido" without asking again.
   */
  ownerFocus?: {
    customerId?: string;
    customerPhone?: string;
    customerName?: string;
    orderId?: string;
    orderNumber?: string;
    updatedAt?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface IncomingMessage {
  messageId: string;
  sessionId: string;
  workspaceId: string;
  customerId: string;
  channelId: string;
  channelType: 'whatsapp' | 'web' | 'api';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface OutgoingMessage {
  sessionId: string;
  content: string;
  channelId: string;
  channelType: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuditEntry {
  correlationId: string;
  sessionId: string;
  workspaceId: string;
  timestamp: Date;
  phase: 'input' | 'decision' | 'tool_call' | 'validation' | 'result';
  data: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT PROCESS TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProcessMessageInput {
  workspaceId: string;
  sessionId: string;
  customerId: string;
  channelId: string;
  channelType?: 'whatsapp' | 'web' | 'api';
  message: string;
  messageId: string;
  correlationId: string;
  isOwner?: boolean;
}

export interface ProcessMessageOutput {
  response: string;
  responseType?: 'text' | 'interactive-list' | 'interactive-buttons';
  responsePayload?: InteractiveListPayload | InteractiveButtonsPayload;
  state: AgentStateType;
  toolsUsed: ToolExecution[];
  tokensUsed: number;
  shouldSendMessage: boolean;
}

export interface InteractiveListPayload {
  body: string;
  buttonText: string;
  sections: InteractiveListSection[];
  header?: string;
  footer?: string;
}

export interface InteractiveListSection {
  title?: string;
  rows: InteractiveListRow[];
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveButtonsPayload {
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
}

export interface ToolExecution {
  correlationId: string;
  toolName: string;
  category: ToolCategoryType;
  input: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
  validationPassed: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const MessageThread = {
  ORDER: 'ORDER',
  INFO: 'INFO',
} as const;

export type MessageThreadType = (typeof MessageThread)[keyof typeof MessageThread];

export interface OrchestratorContext {
  workspaceId: string;
  sessionId: string;
  customerId: string;
  channelId: string;
  channelType: 'whatsapp' | 'web' | 'api';
  correlationId: string;
  messageId: string;
}

export interface OrchestratorResult {
  response: string;
  state: AgentStateType;
  thread: MessageThreadType;
  toolsUsed: ToolExecution[];
  tokensUsed: number;
  shouldSendMessage: boolean;
  handoffTriggered: boolean;
  handoffReason?: string;
}

export interface SessionState {
  state: AgentStateType;
  thread: MessageThreadType;
  failureCount: number;
  lastFailureAt?: Date;
  interruptedThread?: MessageThreadType;
  interruptedState?: AgentStateType;
}

export interface AgentTurnAudit {
  correlationId: string;
  sessionId: string;
  workspaceId: string;
  messageId: string;
  timestamp: Date;
  input: {
    content: string;
    thread: MessageThreadType;
    previousState: AgentStateType;
  };
  decision: {
    newThread: MessageThreadType;
    newState: AgentStateType;
    reasoning?: string;
  };
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: ToolResult;
    durationMs: number;
  }>;
  result: {
    response: string;
    finalState: AgentStateType;
    tokensUsed: number;
    totalDurationMs: number;
    handoffTriggered: boolean;
    handoffReason?: string;
  };
}
