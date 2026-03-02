/**
 * Commerce plan helpers and feature capabilities.
 * Used by dashboard, API and worker to keep plan behavior consistent.
 */

export type CommercePlan = 'basic' | 'standard' | 'pro';

export interface CommercePlanCapabilities {
  showCommunicationsModule: boolean;
  showWhatsappOrderImageOcr: boolean;
  showInvoicesModule: boolean;
  showDebtsModule: boolean;
  showAccountStatementPdf: boolean;
  showQuickActions: boolean;
  showMetricsAiInsights: boolean;
  showMetricsStockExpenseCard: boolean;
  showCustomerAiSummary: boolean;
  showStockReceiptImport: boolean;
  showSettingsNotifications: boolean;
  showOwnerWhatsappAgentSettings: boolean;
  showBusinessInvoicingSettings: boolean;
  showReceiptBrandingSettings: boolean;
  showArcaIntegration: boolean;
  showMercadoPagoIntegration: boolean;
  showWhatsappAudioTranscription: boolean;
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
    showCommunicationsModule: false,
    showWhatsappOrderImageOcr: false,
    showInvoicesModule: false,
    showDebtsModule: false,
    showAccountStatementPdf: false,
    showQuickActions: false,
    showMetricsAiInsights: false,
    showMetricsStockExpenseCard: false,
    showCustomerAiSummary: false,
    showStockReceiptImport: false,
    showSettingsNotifications: false,
    showOwnerWhatsappAgentSettings: false,
    showBusinessInvoicingSettings: false,
    showReceiptBrandingSettings: false,
    showArcaIntegration: false,
    showMercadoPagoIntegration: false,
    showWhatsappAudioTranscription: false,
    autoDetectManualReceiptAmount: false,
    askInvoiceAfterOrder: false,
  },
  standard: {
    showCommunicationsModule: true,
    showWhatsappOrderImageOcr: false,
    showInvoicesModule: true,
    showDebtsModule: true,
    showAccountStatementPdf: true,
    showQuickActions: false,
    showMetricsAiInsights: true,
    showMetricsStockExpenseCard: true,
    showCustomerAiSummary: true,
    showStockReceiptImport: true,
    showSettingsNotifications: true,
    showOwnerWhatsappAgentSettings: false,
    showBusinessInvoicingSettings: true,
    showReceiptBrandingSettings: true,
    showArcaIntegration: true,
    showMercadoPagoIntegration: true,
    showWhatsappAudioTranscription: false,
    autoDetectManualReceiptAmount: true,
    askInvoiceAfterOrder: true,
  },
  pro: {
    showCommunicationsModule: true,
    showWhatsappOrderImageOcr: true,
    showInvoicesModule: true,
    showDebtsModule: true,
    showAccountStatementPdf: true,
    showQuickActions: true,
    showMetricsAiInsights: true,
    showMetricsStockExpenseCard: true,
    showCustomerAiSummary: true,
    showStockReceiptImport: true,
    showSettingsNotifications: true,
    showOwnerWhatsappAgentSettings: true,
    showBusinessInvoicingSettings: true,
    showReceiptBrandingSettings: true,
    showArcaIntegration: true,
    showMercadoPagoIntegration: true,
    showWhatsappAudioTranscription: true,
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
