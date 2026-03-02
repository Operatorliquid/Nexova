import { type PrismaClient } from '@prisma/client';

import {
  getCommercePlanCapabilities,
  resolveCommercePlan,
  type CommercePlan,
  type CommercePlanCapabilities,
} from '@nexova/shared';

export interface WorkspacePlanContext {
  plan: CommercePlan;
  capabilities: CommercePlanCapabilities;
}

export async function getWorkspacePlanContext(
  prisma: PrismaClient,
  workspaceId: string,
  roleName?: string | null
): Promise<WorkspacePlanContext> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      plan: true,
      settings: true,
      subscription: {
        select: {
          plan: true,
          status: true,
        },
      },
    },
  });

  const settings = (workspace?.settings as Record<string, unknown> | undefined) || {};
  const subscriptionStatus = (workspace?.subscription?.status || '').toLowerCase();
  const subscriptionPlan =
    workspace?.subscription?.plan && ['active', 'trialing', 'past_due', 'paid'].includes(subscriptionStatus)
      ? workspace.subscription.plan
      : undefined;
  const plan = resolveCommercePlan({
    workspacePlan: subscriptionPlan || workspace?.plan,
    settingsPlan: settings.commercePlan,
    roleName: roleName || undefined,
    fallback: 'pro',
  });

  return {
    plan,
    capabilities: getCommercePlanCapabilities(plan),
  };
}
