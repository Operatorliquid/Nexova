import { PrismaClient } from '@prisma/client';
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
    },
  });

  const settings = (workspace?.settings as Record<string, unknown> | undefined) || {};
  const plan = resolveCommercePlan({
    workspacePlan: workspace?.plan,
    settingsPlan: settings.commercePlan,
    roleName: roleName || undefined,
    fallback: 'pro',
  });

  return {
    plan,
    capabilities: getCommercePlanCapabilities(plan),
  };
}
