import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_COMMERCE_PLAN_LIMITS,
  resolveCommercePlan,
  type CommercePlan,
  type CommercePlanLimitConfig,
} from '@nexova/shared';

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n >= 1) return n;
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    const n = Math.trunc(parsed);
    if (n >= 1) return n;
    return undefined;
  }
  return undefined;
}

function pickPlanLimitConfig(value: unknown): Partial<CommercePlanLimitConfig> {
  const obj = asObject(value);
  const ordersPerMonth = normalizeLimit(obj.ordersPerMonth);
  const aiMetricsInsightsPerMonth = normalizeLimit(obj.aiMetricsInsightsPerMonth);
  const aiCustomerSummariesPerMonth = normalizeLimit(obj.aiCustomerSummariesPerMonth);
  const debtRemindersPerMonth = normalizeLimit(obj.debtRemindersPerMonth);

  return {
    ...(ordersPerMonth !== undefined ? { ordersPerMonth } : {}),
    ...(aiMetricsInsightsPerMonth !== undefined ? { aiMetricsInsightsPerMonth } : {}),
    ...(aiCustomerSummariesPerMonth !== undefined ? { aiCustomerSummariesPerMonth } : {}),
    ...(debtRemindersPerMonth !== undefined ? { debtRemindersPerMonth } : {}),
  };
}

export async function resolveWorkspacePlan(
  prisma: PrismaClient,
  workspaceId: string
): Promise<CommercePlan> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true, settings: true },
  });
  const settings = (workspace?.settings as Record<string, unknown> | undefined) || {};
  return resolveCommercePlan({
    workspacePlan: workspace?.plan,
    settingsPlan: settings.commercePlan,
    fallback: 'pro',
  });
}

export async function getEffectivePlanLimits(
  prisma: PrismaClient,
  plan: CommercePlan
): Promise<CommercePlanLimitConfig> {
  const defaults = DEFAULT_COMMERCE_PLAN_LIMITS[plan];
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'system' },
      select: { featureFlags: true },
    });
    const featureFlags = asObject(settings?.featureFlags);
    const allLimits = asObject(featureFlags.commercePlanLimits);
    const override = pickPlanLimitConfig(allLimits[plan]);

    return {
      ...defaults,
      ...override,
    };
  } catch {
    return defaults;
  }
}

