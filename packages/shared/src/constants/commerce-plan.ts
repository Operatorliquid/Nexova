/**
 * Commerce plan helpers and feature capabilities.
 * Used by dashboard, API and worker to keep plan behavior consistent.
 */

export type CommercePlan = 'basic' | 'standard' | 'pro';

export interface CommercePlanCapabilities {
  showInvoicesModule: boolean;
  showDebtsModule: boolean;
  showQuickActions: boolean;
  showMetricsAiInsights: boolean;
  showMetricsStockExpenseCard: boolean;
  showCustomerAiSummary: boolean;
  showStockReceiptImport: boolean;
  showSettingsNotifications: boolean;
  showOwnerWhatsappAgentSettings: boolean;
  showBusinessInvoicingSettings: boolean;
  showArcaIntegration: boolean;
  showMercadoPagoIntegration: boolean;
  autoDetectManualReceiptAmount: boolean;
  askInvoiceAfterOrder: boolean;
}

const PLAN_ALIASES: Record<string, CommercePlan> = {
  basic: 'basic',
  free: 'basic',
  starter: 'basic',
  standard: 'standard',
  standar: 'standard',
  pro: 'pro',
  professional: 'pro',
  enterprise: 'pro',
};

const ROLE_ALIASES: Record<string, CommercePlan> = {
  basic: 'basic',
  standard: 'standard',
  standar: 'standard',
  pro: 'pro',
};

const PLAN_CAPABILITIES: Record<CommercePlan, CommercePlanCapabilities> = {
  basic: {
    showInvoicesModule: false,
    showDebtsModule: false,
    showQuickActions: false,
    showMetricsAiInsights: false,
    showMetricsStockExpenseCard: false,
    showCustomerAiSummary: false,
    showStockReceiptImport: false,
    showSettingsNotifications: false,
    showOwnerWhatsappAgentSettings: false,
    showBusinessInvoicingSettings: false,
    showArcaIntegration: false,
    showMercadoPagoIntegration: false,
    autoDetectManualReceiptAmount: false,
    askInvoiceAfterOrder: false,
  },
  standard: {
    showInvoicesModule: true,
    showDebtsModule: true,
    showQuickActions: false,
    showMetricsAiInsights: true,
    showMetricsStockExpenseCard: true,
    showCustomerAiSummary: true,
    showStockReceiptImport: true,
    showSettingsNotifications: true,
    showOwnerWhatsappAgentSettings: false,
    showBusinessInvoicingSettings: true,
    showArcaIntegration: true,
    showMercadoPagoIntegration: true,
    autoDetectManualReceiptAmount: true,
    askInvoiceAfterOrder: true,
  },
  pro: {
    showInvoicesModule: true,
    showDebtsModule: true,
    showQuickActions: true,
    showMetricsAiInsights: true,
    showMetricsStockExpenseCard: true,
    showCustomerAiSummary: true,
    showStockReceiptImport: true,
    showSettingsNotifications: true,
    showOwnerWhatsappAgentSettings: true,
    showBusinessInvoicingSettings: true,
    showArcaIntegration: true,
    showMercadoPagoIntegration: true,
    autoDetectManualReceiptAmount: true,
    askInvoiceAfterOrder: true,
  },
};

const normalizeToken = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export function normalizeCommercePlan(value: unknown): CommercePlan | null {
  const token = normalizeToken(value);
  if (!token) return null;
  return PLAN_ALIASES[token] || null;
}

export function normalizeCommercePlanFromRoleName(value: unknown): CommercePlan | null {
  const token = normalizeToken(value);
  if (!token) return null;
  return ROLE_ALIASES[token] || null;
}

export function resolveCommercePlan(params: {
  workspacePlan?: unknown;
  settingsPlan?: unknown;
  roleName?: unknown;
  fallback?: CommercePlan;
}): CommercePlan {
  const byWorkspacePlan = normalizeCommercePlan(params.workspacePlan);
  if (byWorkspacePlan) return byWorkspacePlan;

  const bySettingsPlan = normalizeCommercePlan(params.settingsPlan);
  if (bySettingsPlan) return bySettingsPlan;

  const byRoleName = normalizeCommercePlanFromRoleName(params.roleName);
  if (byRoleName) return byRoleName;

  return params.fallback || 'pro';
}

export function getCommercePlanCapabilities(plan: CommercePlan): CommercePlanCapabilities {
  return PLAN_CAPABILITIES[plan];
}
