/**
 * Ledger Types
 * Types for debt/credit tracking
 */

// ═══════════════════════════════════════════════════════════════════════════════
// LEDGER ENTRY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type LedgerEntryType = 'debit' | 'credit';

export type LedgerReferenceType =
  | 'Order'
  | 'Payment'
  | 'Receipt'
  | 'Adjustment'
  | 'WriteOff'
  | 'Refund';

export interface CreateLedgerEntryInput {
  workspaceId: string;
  customerId: string;
  type: LedgerEntryType;
  amount: number;
  currency?: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface LedgerEntryResult {
  id: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  referenceType: string;
  referenceId: string;
  description: string;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER BALANCE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CustomerBalance {
  customerId: string;
  currentBalance: number;
  hasDebt: boolean;
  hasCreditBalance: boolean;
  currency: string;
}

export interface CustomerDebtSummary extends CustomerBalance {
  unpaidOrders: UnpaidOrder[];
  recentPayments: RecentPayment[];
  lastActivityAt?: Date;
  formattedMessage: string;
}

export interface UnpaidOrder {
  orderId: string;
  orderNumber: string;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  createdAt: Date;
  daysOld: number;
}

export interface RecentPayment {
  id: string;
  amount: number;
  method: string;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT APPLICATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApplyPaymentInput {
  workspaceId: string;
  customerId: string;
  amount: number;
  referenceType: LedgerReferenceType;
  referenceId: string;
  description: string;
  createdBy?: string;
}

export interface ApplyPaymentResult {
  ledgerEntryId: string;
  previousBalance: number;
  newBalance: number;
  appliedAmount: number;
  ordersSettled: OrderSettlement[];
}

export interface OrderSettlement {
  orderId: string;
  orderNumber: string;
  amountApplied: number;
  previousPaidAmount: number;
  newPaidAmount: number;
  isFullyPaid: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEBIT CREATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreateDebitInput {
  workspaceId: string;
  customerId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  createdBy?: string;
}

export interface CreateDebitResult {
  ledgerEntryId: string;
  previousBalance: number;
  newBalance: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUSTMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreateAdjustmentInput {
  workspaceId: string;
  customerId: string;
  type: LedgerEntryType;
  amount: number;
  reason: string;
  createdBy: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE DEBT SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

export interface DebtReminderSettings {
  enabled: boolean;
  firstReminderDays: number;
  secondReminderDays: number;
  thirdReminderDays: number;
  maxReminders: number;
  sendBetweenHours: [number, number];
  messageTemplate: string;
}

export interface DebtConfig {
  maxDebtAmount?: number;
  gracePeriodDays: number;
  autoBlockOnOverdue: boolean;
}

export interface WorkspaceDebtSettings {
  debtReminders: DebtReminderSettings;
  debtConfig: DebtConfig;
}

export const DEFAULT_DEBT_SETTINGS: WorkspaceDebtSettings = {
  debtReminders: {
    enabled: false,
    firstReminderDays: 3,
    secondReminderDays: 7,
    thirdReminderDays: 14,
    maxReminders: 3,
    sendBetweenHours: [9, 20],
    messageTemplate: 'Hola {customerName}! Te recordamos que tenés un saldo pendiente de ${totalDebt}. Podés pagar por MercadoPago o transferencia. ¿Te genero un link de pago? Cualquier duda, estamos para ayudarte.',
  },
  debtConfig: {
    gracePeriodDays: 30,
    autoBlockOnOverdue: false,
  },
};
