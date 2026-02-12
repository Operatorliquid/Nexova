/**
 * @nexova/core
 * Core services: Auth, Tenancy, RBAC, Observability
 */

// Auth
export { AuthService, AuthError } from './auth/auth.service.js';
export type { RegisterInput, LoginInput, AuthResult } from './auth/auth.service.js';
export { hashPassword, verifyPassword, validatePasswordStrength } from './auth/password.service.js';
export {
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  generateSecureToken,
} from './auth/token.service.js';
export type { AccessTokenPayload, RefreshTokenPayload, TokenPair } from './auth/token.service.js';

// Tenancy
export { WorkspaceService, WorkspaceError } from './tenancy/workspace.service.js';
export type { CreateWorkspaceInput, UpdateWorkspaceInput } from './tenancy/workspace.service.js';
export {
  runWithContext,
  getContext,
  requireContext,
  getUserId,
  getWorkspaceId,
  getPermissions,
  isSuperAdmin,
  getRequestId,
} from './tenancy/context.js';
export type { TenantContext } from './tenancy/context.js';
export { applyTenantPrismaMiddleware } from './tenancy/prisma-tenant.middleware.js';

// RBAC
export {
  PermissionService,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  permissionMatches,
} from './rbac/permission.service.js';
export type { Permission } from './rbac/permission.service.js';

// Observability
export { logger, createChildLogger } from './observability/logger.js';
export type { Logger, LogContext } from './observability/logger.js';

// Crypto
export { encrypt, decrypt, generateEncryptionKey } from './crypto/encryption.js';
export type { EncryptedData } from './crypto/encryption.js';

// Queue
export { QueueService } from './queue/queue.service.js';
export type { QueueConnection } from './queue/queue.service.js';

// Ledger (Debt Management)
export { LedgerService, LedgerServiceError } from './ledger/ledger.service.js';
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
} from './ledger/types.js';
export { DEFAULT_DEBT_SETTINGS } from './ledger/types.js';

// Catalog (PDF Generation)
export { CatalogPdfService, CatalogError } from './catalog/catalog-pdf.service.js';
export type {
  CatalogProductFilter,
  CatalogProduct,
  CatalogOptions,
  CatalogResult,
} from './catalog/types.js';
export { DEFAULT_CATALOG_OPTIONS } from './catalog/types.js';

// Orders (PDF Receipt)
export { OrderReceiptPdfService } from './orders/order-receipt-pdf.service.js';
export type { ReceiptOrder } from './orders/order-receipt-pdf.service.js';

// Invoices (ARCA PDF)
export { ArcaInvoicePdfService } from './invoices/arca-invoice-pdf.service.js';
export type { ArcaInvoicePdfData, ArcaInvoicePdfItem } from './invoices/arca-invoice-pdf.service.js';

// Stock (Purchase Receipts)
export { StockPurchaseReceiptService } from './stock/stock-purchase-receipt.service.js';
export type {
  CreateDraftStockPurchaseReceiptInput,
  CreateDraftStockPurchaseReceiptItemInput,
  StockPurchaseReceiptProductSuggestion,
  ApplyStockPurchaseReceiptResult,
} from './stock/stock-purchase-receipt.service.js';

// Re-export Prisma Client
export { PrismaClient } from '@prisma/client';
export type * from '@prisma/client';
