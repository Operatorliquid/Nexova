import {
  getCommercePlanCapabilities,
  resolveCommercePlan,
  type CommercePlan,
  type CommercePlanCapabilities,
} from '@nexova/shared';

type WorkspaceLike = {
  plan?: string | null;
  role?: { name?: string | null } | null;
} | null | undefined;

export function resolveWorkspaceCommercePlan(workspace: WorkspaceLike): CommercePlan {
  return resolveCommercePlan({
    workspacePlan: workspace?.plan,
    roleName: workspace?.role?.name,
    fallback: 'pro',
  });
}

export function getWorkspaceCommerceCapabilities(
  workspace: WorkspaceLike
): CommercePlanCapabilities {
  const plan = resolveWorkspaceCommercePlan(workspace);
  return getCommercePlanCapabilities(plan);
}
