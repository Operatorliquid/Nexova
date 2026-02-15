import { AlertTriangle, CreditCard, Lock, LogOut, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';
import { AnimatedPage } from '@/components/ui/motion';
import { useAuth } from '@/contexts/AuthContext';

export function normalizeWorkspaceStatus(status?: string | null) {
  return (status || '').trim().toLowerCase();
}

export function buildWorkspaceSuspendedCopy(status: string) {
  if (status === 'cancelled' || status === 'canceled') {
    return {
      title: 'Suscripcion cancelada',
      description:
        'Tu suscripcion esta cancelada. Para volver a usar Nexova, elegi un plan y completa el pago.',
    };
  }

  // Default to suspended for anything not active.
  return {
    title: 'Suscripcion suspendida',
    description:
      'Tu suscripcion no esta activa. Para reactivar el acceso, regulariza el pago o elegi un plan nuevamente.',
  };
}

interface WorkspacePaywallCardProps {
  status?: string | null;
  workspaceName?: string | null;
  helperText?: string;
  showActions?: boolean;
  retryLabel?: string;
  logoutLabel?: string;
  onRetry?: () => void;
  onLogout?: () => void;
  badgeText?: string;
  badgeVariant?: 'secondary' | 'success' | 'warning' | 'destructive';
  titleOverride?: string;
  descriptionOverride?: string;
  leftTitleOverride?: string;
  leftDescriptionOverride?: string;
  rightTitleOverride?: string;
  rightDescriptionOverride?: string;
  topRightIcon?: ReactNode;
}

export function WorkspacePaywallCard({
  status,
  workspaceName,
  helperText = 'Si ya realizaste el pago, toca "Reintentar" para actualizar el estado.',
  showActions = true,
  retryLabel = 'Reintentar',
  logoutLabel = 'Cerrar sesion',
  onRetry,
  onLogout,
  badgeText,
  badgeVariant,
  titleOverride,
  descriptionOverride,
  leftTitleOverride,
  leftDescriptionOverride,
  rightTitleOverride,
  rightDescriptionOverride,
  topRightIcon,
}: WorkspacePaywallCardProps) {
  const normalizedStatus = normalizeWorkspaceStatus(status);
  const copy = buildWorkspaceSuspendedCopy(normalizedStatus);
  const isCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'canceled';
  const resolvedBadgeText = badgeText || (isCancelled ? 'Suscripcion cancelada' : 'Suscripcion suspendida');
  const resolvedBadgeVariant = badgeVariant || (isCancelled ? 'destructive' : 'warning');
  const resolvedTitle = titleOverride || copy.title;
  const resolvedDescription = descriptionOverride || copy.description;
  const leftTitle = leftTitleOverride || 'Acceso bloqueado temporalmente';
  const leftDescription = leftDescriptionOverride || 'Mientras el estado de suscripcion no sea activo, el dashboard queda bloqueado.';
  const rightTitle = rightTitleOverride || 'Proximo paso';
  const rightDescription = rightDescriptionOverride || 'Regulariza el pago y luego presiona Reintentar para recuperar el acceso.';

  return (
    <Card className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border/80 glass-card shadow-2xl">
      <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-primary/10 blur-[80px]" />
      <div className="absolute -bottom-24 -right-16 w-72 h-72 rounded-full bg-amber-500/10 blur-[90px]" />

      <CardHeader className="relative z-10 p-7 md:p-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Badge variant={resolvedBadgeVariant} className="border border-current/20">
            {resolvedBadgeText}
          </Badge>
          <div className="w-11 h-11 rounded-2xl bg-background/60 border border-border flex items-center justify-center">
            {topRightIcon || <Lock className="w-5 h-5 text-foreground" />}
          </div>
        </div>
        <CardTitle className="text-2xl tracking-tight">{resolvedTitle}</CardTitle>
        <CardDescription className="text-base leading-relaxed">
          {workspaceName ? `${workspaceName}. ` : ''}
          {resolvedDescription}
        </CardDescription>
      </CardHeader>

      <CardContent
        className={`relative z-10 px-7 md:px-8 pt-0 ${showActions ? 'pb-0' : 'pb-7 md:pb-8'}`}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              {leftTitle}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {leftDescription}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CreditCard className="w-4 h-4 text-primary" />
              {rightTitle}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {rightDescription}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-4">
          {helperText}
        </p>
      </CardContent>

      {showActions && (
        <CardFooter className="relative z-10 p-7 md:p-8 gap-3 flex-wrap">
          <Button type="button" onClick={onRetry} className="min-w-[150px]">
            <RefreshCw className="w-4 h-4 mr-2" />
            {retryLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onLogout} className="min-w-[150px]">
            <LogOut className="w-4 h-4 mr-2" />
            {logoutLabel}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export default function WorkspaceSuspendedPage() {
  const { workspace, logout, refreshUser } = useAuth();

  return (
    <div className="min-h-screen bg-background overflow-hidden relative">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 -left-40 w-96 h-96 bg-[#4236c4]/15 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[820px] h-[440px] bg-[#4236c4]/5 rounded-full blur-[200px]" />
      </div>

      <div className="min-h-screen flex items-center justify-center p-6">
        <AnimatedPage className="w-full max-w-2xl space-y-6">
          <div className="flex items-center justify-center">
            <div className="px-4 py-2 rounded-xl border border-border bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
              Nexova · Estado de suscripcion
            </div>
          </div>
          <WorkspacePaywallCard
            status={workspace?.status}
            workspaceName={workspace?.name}
            onRetry={refreshUser}
            onLogout={logout}
          />
        </AnimatedPage>
      </div>
    </div>
  );
}
