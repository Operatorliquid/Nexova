import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, UserCheck, Shield, UserX, RefreshCw } from 'lucide-react';
import { Badge, Button, Input } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';
import { useAuth } from '../../contexts/AuthContext';

interface AdminUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  isSuperAdmin: boolean;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
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
  _count: {
    memberships: number;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface UsersStats {
  total: number;
  active: number;
  superAdmins: number;
  suspended: number;
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
    // Ignore malformed response body.
  }
  return fallback;
};

const formatUserName = (user: AdminUser) => {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return fullName || user.email;
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const getUserStatusBadge = (status: AdminUser['status']) => {
  if (status === 'active') return <Badge variant="success">Activo</Badge>;
  if (status === 'suspended') return <Badge variant="warning">Suspendido</Badge>;
  return <Badge variant="secondary">Inactivo</Badge>;
};

const getRoleVariant = (roleName: string) => {
  const normalized = roleName.trim().toLowerCase();
  if (normalized === 'owner') return 'default' as const;
  if (normalized === 'admin') return 'warning' as const;
  if (normalized === 'pro') return 'success' as const;
  if (normalized === 'standard' || normalized === 'standar') return 'info' as const;
  return 'secondary' as const;
};

const getUserRoleNames = (user: AdminUser) => {
  const names = user.memberships
    .map((membership) => membership.role?.name?.trim())
    .filter((name): name is string => Boolean(name));
  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique : ['Sin rol'];
};

export default function UsersPage() {
  const toastSuccess = useToastStore((state) => state.success);
  const toastError = useToastStore((state) => state.error);
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<UsersStats | null>(null);
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
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [search]);

  const loadUsers = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const usersQuery = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      });
      if (search) usersQuery.set('search', search);

      const [usersRes, statsRes] = await Promise.all([
        apiFetch(`/api/v1/admin/users?${usersQuery.toString()}`),
        apiFetch('/api/v1/admin/users/stats'),
      ]);

      if (!usersRes.ok) throw new Error(await readApiError(usersRes, 'No se pudieron cargar los usuarios'));
      if (!statsRes.ok) throw new Error(await readApiError(statsRes, 'No se pudieron cargar las estadísticas'));

      const usersData = await usersRes.json() as { users: AdminUser[]; pagination: Pagination };
      const statsData = await statsRes.json() as { stats: UsersStats };

      setUsers(usersData.users || []);
      setPagination(usersData.pagination || { page: 1, limit: 20, total: 0, pages: 0 });
      setStats(statsData.stats);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [pagination.page, pagination.limit, search, toastError]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleToggleSuperAdmin = async (target: AdminUser) => {
    if (target.id === currentUser?.id && target.isSuperAdmin) {
      toastError('No podés quitarte permisos de super admin a vos mismo');
      return;
    }

    setTogglingUserId(target.id);
    try {
      const response = await apiFetch(`/api/v1/admin/users/${target.id}/super-admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isSuperAdmin: !target.isSuperAdmin }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo actualizar el usuario'));
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === target.id ? { ...user, isSuperAdmin: !target.isSuperAdmin } : user
        )
      );

      setStats((prev) => {
        if (!prev) return prev;
        const delta = target.isSuperAdmin ? -1 : 1;
        return { ...prev, superAdmins: Math.max(0, prev.superAdmins + delta) };
      });
      toastSuccess('Permisos actualizados');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo actualizar el usuario');
    } finally {
      setTogglingUserId(null);
    }
  };

  const statCards = useMemo(() => ([
    { label: 'Total usuarios', value: stats?.total ?? 0, icon: Users, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-400' },
    { label: 'Activos', value: stats?.active ?? 0, icon: UserCheck, iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-400' },
    { label: 'Super admins', value: stats?.superAdmins ?? 0, icon: Shield, iconBg: 'bg-primary/10', iconColor: 'text-primary' },
    { label: 'Suspendidos', value: stats?.suspended ?? 0, icon: UserX, iconBg: 'bg-red-500/10', iconColor: 'text-red-400' },
  ]), [stats]);

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Usuarios</h2>
          <p className="text-sm text-muted-foreground">
            Gestiona todos los usuarios registrados en la plataforma
          </p>
        </div>
        <div className="flex w-full md:w-auto items-center gap-3">
          <div className="w-full md:w-72">
            <Input
              placeholder="Buscar usuarios..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={() => loadUsers(true)} isLoading={isRefreshing}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Actualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="glass-card rounded-2xl p-5 hover:shadow-2xl transition-all duration-300 hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.label}</p>
                {isLoading ? (
                  <div className="h-7 w-16 rounded-lg bg-secondary animate-pulse mt-2" />
                ) : (
                  <p className="text-2xl font-semibold mt-1 text-foreground">{card.value}</p>
                )}
              </div>
              <div className={`w-10 h-10 rounded-xl ${card.iconBg} flex items-center justify-center`}>
                <card.icon className={`w-5 h-5 ${card.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Todos los usuarios</h3>
          <p className="text-sm text-muted-foreground">
            {pagination.total} total
          </p>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <Users className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground">No hay usuarios registrados</p>
              <p className="text-sm text-muted-foreground/50 mt-1">
                Los usuarios aparecerán aquí cuando se registren
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((adminUser) => (
                <div
                  key={adminUser.id}
                  className="flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-xl bg-background/60 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-medium text-muted-foreground">
                        {formatUserName(adminUser).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{formatUserName(adminUser)}</p>
                      <p className="text-sm text-muted-foreground truncate">{adminUser.email}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {getUserRoleNames(adminUser).map((roleName) => (
                          <Badge key={`${adminUser.id}-${roleName}`} variant={getRoleVariant(roleName)}>
                            {roleName}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Último login: {formatDate(adminUser.lastLoginAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 md:mr-3">
                    {getUserStatusBadge(adminUser.status)}
                    {adminUser.isSuperAdmin && <Badge variant="default">Super Admin</Badge>}
                    {adminUser.emailVerifiedAt ? <Badge variant="success">Verificado</Badge> : <Badge variant="warning">Sin verificar</Badge>}
                  </div>

                  <div className="text-sm text-muted-foreground md:w-32">
                    {adminUser._count.memberships} negocio{adminUser._count.memberships !== 1 ? 's' : ''}
                  </div>

                  <Button
                    size="sm"
                    variant={adminUser.isSuperAdmin ? 'secondary' : 'default'}
                    onClick={() => handleToggleSuperAdmin(adminUser)}
                    isLoading={togglingUserId === adminUser.id}
                  >
                    {adminUser.isSuperAdmin ? 'Quitar super admin' : 'Hacer super admin'}
                  </Button>
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
    </div>
  );
}
