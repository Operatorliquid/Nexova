import { useCallback, useEffect, useState } from 'react';
import { Building2, Users, Package, ShoppingCart, Bot, RefreshCw } from 'lucide-react';
import { Badge, Button, Input, AnimatedPage, AnimatedStagger, StatCard } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';
import { normalizeCommercePlan, type CommercePlan } from '@nexova/shared';

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  _count: {
    users: number;
    products: number;
    orders: number;
    agentSessions: number;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface WorkspacesStats {
  users: { total: number; active: number };
  workspaces: { total: number; active: number };
  messages: { total: number };
  whatsappNumbers: { total: number };
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
    // Ignore malformed body.
  }
  return fallback;
};

const getStatusBadge = (status: WorkspaceRow['status']) => {
  if (status === 'active') return <Badge variant="success">Activo</Badge>;
  if (status === 'suspended') return <Badge variant="warning">Suspendido</Badge>;
  return <Badge variant="secondary">Inactivo</Badge>;
};

const formatPlanLabel = (plan: CommercePlan) => {
  if (plan === 'basic') return 'Basic';
  if (plan === 'standard') return 'Standard';
  return 'Pro';
};

const getPlanVariant = (plan: CommercePlan) => {
  if (plan === 'basic') return 'secondary' as const;
  if (plan === 'standard') return 'info' as const;
  return 'success' as const;
};

const getPlanBadge = (rawPlan: string) => {
  const normalized = normalizeCommercePlan(rawPlan);
  if (!normalized) {
    return <Badge variant="outline">Plan {rawPlan || 'N/D'}</Badge>;
  }
  return <Badge variant={getPlanVariant(normalized)}>Plan {formatPlanLabel(normalized)}</Badge>;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));

export default function WorkspacesPage() {
  const toastError = useToastStore((state) => state.error);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [stats, setStats] = useState<WorkspacesStats | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [search]);

  const loadWorkspaces = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      });
      if (search) params.set('search', search);

      const [workspacesRes, statsRes] = await Promise.all([
        apiFetch(`/api/v1/admin/workspaces?${params.toString()}`),
        apiFetch('/api/v1/admin/stats'),
      ]);

      if (!workspacesRes.ok) {
        throw new Error(await readApiError(workspacesRes, 'No se pudieron cargar los negocios'));
      }
      if (!statsRes.ok) {
        throw new Error(await readApiError(statsRes, 'No se pudieron cargar las métricas'));
      }

      const workspacesData = await workspacesRes.json() as {
        workspaces: WorkspaceRow[];
        pagination: Pagination;
      };
      const statsData = await statsRes.json() as { stats: WorkspacesStats };

      setRows(workspacesData.workspaces || []);
      setPagination(workspacesData.pagination || { page: 1, limit: 20, total: 0, pages: 0 });
      setStats(statsData.stats);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudieron cargar los negocios');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [pagination.page, pagination.limit, search, toastError]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);


  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Negocios</h2>
          <p className="text-sm text-muted-foreground">Resumen de workspaces registrados</p>
        </div>
        <div className="flex w-full md:w-auto items-center gap-3">
          <div className="w-full md:w-72">
            <Input
              placeholder="Buscar por nombre o slug..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={() => loadWorkspaces(true)} isLoading={isRefreshing}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Actualizar
          </Button>
        </div>
      </div>

      <AnimatedStagger className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Negocios" value={(stats?.workspaces.total ?? 0).toString()} icon={Building2} color="emerald" sub={`${stats?.workspaces.active ?? 0} activos`} isLoading={isLoading} />
        <StatCard label="Usuarios" value={(stats?.users.total ?? 0).toString()} icon={Users} color="blue" sub={`${stats?.users.active ?? 0} activos`} isLoading={isLoading} />
        <StatCard label="Mensajes" value={(stats?.messages.total ?? 0).toString()} icon={Bot} color="cyan" isLoading={isLoading} />
      </AnimatedStagger>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Listado de negocios</h3>
          <p className="text-sm text-muted-foreground">{pagination.total} total</p>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <Building2 className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground">No hay negocios para mostrar</p>
              <p className="text-sm text-muted-foreground/50 mt-1">
                Los negocios aparecerán cuando los usuarios completen onboarding
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((workspace) => (
                <div
                  key={workspace.id}
                  className="flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-xl bg-background/60 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-muted-foreground/70" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{workspace.name}</p>
                      <p className="text-sm text-muted-foreground truncate">/{workspace.slug}</p>
                      <p className="text-xs text-muted-foreground mt-1">Creado: {formatDate(workspace.createdAt)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {getStatusBadge(workspace.status)}
                    {getPlanBadge(workspace.plan)}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {workspace._count.users}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Package className="w-3.5 h-3.5" />
                      {workspace._count.products}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShoppingCart className="w-3.5 h-3.5" />
                      {workspace._count.orders}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Bot className="w-3.5 h-3.5" />
                      {workspace._count.agentSessions}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {pagination.pages > 1 && (
          <div className="p-5 border-t border-border flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Página {pagination.page} de {pagination.pages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() => setPagination((prev) => ({ ...prev, page: Math.min(prev.pages, prev.page + 1) }))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </AnimatedPage>
  );
}
