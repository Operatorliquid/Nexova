import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, MessageSquare, Phone, RefreshCw, AlertTriangle } from 'lucide-react';
import { Badge, Button, AnimatedPage, AnimatedStagger, StatCard } from '../../components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';
import { WorkspacePaywallCard } from '../paywall/WorkspaceSuspendedPage';

interface AdminStats {
  users: { total: number; active: number };
  workspaces: { total: number; active: number };
  messages: { total: number };
  whatsappNumbers: { total: number };
}

interface AdminUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  isSuperAdmin: boolean;
  createdAt: string;
  memberships: Array<{
    status: string;
    role: {
      id: string;
      name: string;
    };
    workspace: {
      id: string;
      name: string;
      plan: string;
    };
  }>;
}

interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  _count: {
    users: number;
    products: number;
    orders: number;
    agentSessions: number;
  };
}

interface ApiErrorBody {
  message?: string;
  error?: string;
}

const readApiError = async (response: Response, fallback: string) => {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // Ignore malformed error body.
  }
  return fallback;
};

const formatUserName = (user: AdminUser) => {
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));

const getStatusBadge = (status: AdminUser['status'] | AdminWorkspace['status']) => {
  if (status === 'active') return <Badge variant="success">Activo</Badge>;
  if (status === 'suspended') return <Badge variant="warning">Suspendido</Badge>;
  return <Badge variant="secondary">Inactivo</Badge>;
};

const getUserRoleNames = (user: AdminUser) => {
  const names = user.memberships
    .map((membership) => membership.role?.name?.trim())
    .filter((name): name is string => Boolean(name));
  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique : ['Sin rol'];
};

const getRoleVariant = (roleName: string) => {
  const normalized = roleName.trim().toLowerCase();
  if (normalized === 'owner') return 'default' as const;
  if (normalized === 'admin') return 'warning' as const;
  if (normalized === 'pro') return 'success' as const;
  if (normalized === 'standard' || normalized === 'standar') return 'info' as const;
  return 'secondary' as const;
};

export default function AdminDashboard() {
  const toastError = useToastStore((state) => state.error);
  const toastInfo = useToastStore((state) => state.info);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentUsers, setRecentUsers] = useState<AdminUser[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<AdminWorkspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaywallPreviewOpen, setIsPaywallPreviewOpen] = useState(false);
  const [isOrdersLimitPreviewOpen, setIsOrdersLimitPreviewOpen] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [statsRes, usersRes, workspacesRes] = await Promise.all([
        apiFetch('/api/v1/admin/stats'),
        apiFetch('/api/v1/admin/users?limit=5&page=1'),
        apiFetch('/api/v1/admin/workspaces?limit=5&page=1'),
      ]);

      if (!statsRes.ok) throw new Error(await readApiError(statsRes, 'No se pudieron cargar las métricas'));
      if (!usersRes.ok) throw new Error(await readApiError(usersRes, 'No se pudieron cargar los usuarios'));
      if (!workspacesRes.ok) {
        throw new Error(await readApiError(workspacesRes, 'No se pudieron cargar los negocios'));
      }

      const [statsData, usersData, workspacesData] = await Promise.all([
        statsRes.json() as Promise<{ stats: AdminStats }>,
        usersRes.json() as Promise<{ users: AdminUser[] }>,
        workspacesRes.json() as Promise<{ workspaces: AdminWorkspace[] }>,
      ]);

      setStats(statsData.stats);
      setRecentUsers(usersData.users || []);
      setRecentWorkspaces(workspacesData.workspaces || []);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo cargar el dashboard admin');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toastError]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const triggerOrdersLimitToast = () => {
    toastError('Alcanzaste el límite mensual de pedidos (200).');
  };

  const triggerDebtReminderLimitToast = () => {
    toastError('Alcanzaste el límite mensual de recordatorios de deuda (50).');
  };

  const triggerMetricsInsightsLimitToast = () => {
    toastError('Alcanzaste el límite mensual de resúmenes IA de métricas (40).');
  };

  const triggerCustomerSummaryLimitToast = () => {
    toastError('Alcanzaste el límite mensual de resúmenes IA de clientes (80).');
  };

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Resumen general de la plataforma</p>
        </div>
        <Button variant="secondary" onClick={() => loadDashboard(true)} isLoading={isRefreshing}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Actualizar
        </Button>
      </div>

      <AnimatedStagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Usuarios totales" value={(stats?.users.total ?? 0).toString()} icon={Users} color="blue" sub={`${stats?.users.active ?? 0} activos`} isLoading={isLoading} />
        <StatCard label="Negocios" value={(stats?.workspaces.total ?? 0).toString()} icon={Building2} color="emerald" sub={`${stats?.workspaces.active ?? 0} activos`} isLoading={isLoading} />
        <StatCard label="Mensajes" value={(stats?.messages.total ?? 0).toString()} icon={MessageSquare} color="cyan" isLoading={isLoading} />
        <StatCard label="Números WhatsApp" value={(stats?.whatsappNumbers.total ?? 0).toString()} icon={Phone} color="emerald" isLoading={isLoading} />
      </AnimatedStagger>

      <div className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-foreground">Simulador de avisos de planes</h3>
          <p className="text-sm text-muted-foreground">
            Estos botones solo muestran cómo se ven los avisos en UI. No cambian datos reales.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsPaywallPreviewOpen(true)}>
            Ver pantalla suspendida por pago
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsOrdersLimitPreviewOpen(true)}>
            Ver cartel de limite de pedidos
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={triggerDebtReminderLimitToast}>
            Sin recordatorios de deuda
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={triggerOrdersLimitToast}>
            Sin pedidos disponibles
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={triggerMetricsInsightsLimitToast}>
            Sin consejos IA
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={triggerCustomerSummaryLimitToast}>
            Sin resúmenes IA
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Usuarios recientes</h3>
            <Link to="/admin/users" className="text-sm text-primary hover:text-primary/70 transition-colors">
              Ver todos
            </Link>
          </div>
          <div className="p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : recentUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <Users className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No hay usuarios registrados</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-background/60 flex items-center justify-center">
                      <span className="text-sm font-medium text-muted-foreground">
                        {formatUserName(user).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{formatUserName(user)}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {getUserRoleNames(user).map((roleName) => (
                          <Badge key={`${user.id}-${roleName}`} variant={getRoleVariant(roleName)}>
                            {roleName}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(user.status)}
                      {user.isSuperAdmin && <Badge variant="default">Super Admin</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Negocios recientes</h3>
            <Link to="/admin/negocios" className="text-sm text-primary hover:text-primary/70 transition-colors">
              Ver todos
            </Link>
          </div>
          <div className="p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : recentWorkspaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <Building2 className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No hay negocios creados</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-background/60 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-muted-foreground/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{workspace.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        /{workspace.slug} · {formatDate(workspace.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      {getStatusBadge(workspace.status)}
                      <p className="text-xs text-muted-foreground mt-1">
                        {workspace._count.users} usuarios
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={isPaywallPreviewOpen} onOpenChange={setIsPaywallPreviewOpen}>
        <DialogContent className="max-w-5xl p-0 bg-background border-border overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Vista previa: suscripción suspendida</DialogTitle>
            <DialogDescription>
              Simulación visual del bloqueo por pago para un workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-[70vh] p-6 flex items-center justify-center bg-background">
            <WorkspacePaywallCard
              status="suspended"
              workspaceName="Negocio de prueba"
              helperText="Vista previa en superadmin. Los botones reales se muestran en el dashboard del cliente."
              onRetry={() => toastInfo('Vista previa: acción Reintentar')}
              onLogout={() => toastInfo('Vista previa: acción Cerrar sesion')}
            />
          </div>
          <div className="px-6 pb-6">
            <Button type="button" variant="secondary" onClick={() => {
              toastInfo('Vista previa cerrada');
              setIsPaywallPreviewOpen(false);
            }}>
              Cerrar vista previa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isOrdersLimitPreviewOpen} onOpenChange={setIsOrdersLimitPreviewOpen}>
        <DialogContent className="max-w-4xl p-0 bg-background border-border overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Vista previa: limite mensual de pedidos</DialogTitle>
            <DialogDescription>
              Este es el cartel que aparece arriba en la pantalla de Pedidos cuando el limite se alcanza.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-[38vh] p-6 bg-background">
            <div className="glass-card rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Ya no recibiras mas pedidos porque alcanzaste tu limite mensual (200).
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Puedes mejorar tu plan para seguir utilizando este servicio.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="px-6 pb-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                toastInfo('Vista previa cerrada');
                setIsOrdersLimitPreviewOpen(false);
              }}
            >
              Cerrar vista previa
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
