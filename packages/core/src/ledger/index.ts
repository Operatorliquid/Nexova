/**
 * Ledger Module
 * Customer debt/credit tracking with FIFO payment application
 */

export { LedgerService, LedgerServiceError } from './ledger.service.js';

export type {
  LedgerEntryType,
  LedgerReferenceType,
  CreateLedgerEntryInput,
  LedgerEntryResult,
  CustomerBalance,
  CustomerDebtSummary,
  UnpaidOrder,
  RecentPayment,
  ApplyPaymentInput,
  ApplyPaymentResult,
  OrderSettlement,
  CreateDebitInput,
  CreateDebitResult,
  CreateAdjustmentInput,
  DebtReminderSettings,
  DebtConfig,
  WorkspaceDebtSettings,
} from './types.js';

export { DEFAULT_DEBT_SETTINGS } from './types.js';
