import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, UserCheck, Shield, UserX, RefreshCw, Trash2,
  ChevronRight, Building2, Calendar, Mail, Clock, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { Badge, Button, Input, AnimatedPage, AnimatedStagger, AnimatedCard } from '../../components/ui';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '../../components/ui/sheet';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';
import { useAuth } from '../../contexts/AuthContext';
import { normalizeCommercePlan, type CommercePlan } from '@nexova/shared';
import { DeleteConfirmModal } from '../../components/stock';

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

const getUserPrimaryPlanBadge = (user: AdminUser) => {
  const rawPlans = user.memberships
    .map((m) => m.workspace?.plan?.trim())
    .filter((plan): plan is string => Boolean(plan));

  if (rawPlans.length === 0) return null;

  const priority: CommercePlan[] = ['pro', 'standard', 'basic'];
  const normalized = rawPlans.map((raw) => normalizeCommercePlan(raw)).filter((p): p is CommercePlan => Boolean(p));

  const best = priority.find((p) => normalized.includes(p)) || normalized[0];
  if (!best) return null;

  return { label: formatPlanLabel(best), variant: getPlanVariant(best) };
};

const getUserPlanBadges = (user: AdminUser) => {
  const rawPlans = user.memberships
    .map((membership) => membership.workspace?.plan?.trim())
    .filter((plan): plan is string => Boolean(plan));

  const unique = Array.from(new Set(rawPlans));
  if (unique.length === 0) {
    return [{ key: 'unknown', label: 'Plan N/D', variant: 'outline' as const }];
  }

  return unique.map((raw) => {
    const normalized = normalizeCommercePlan(raw);
    if (!normalized) {
      return { key: raw.toLowerCase(), label: `Plan ${raw}`, variant: 'outline' as const };
    }
    return {
      key: normalized,
      label: `Plan ${formatPlanLabel(normalized)}`,
      variant: getPlanVariant(normalized),
    };
  });
};

const getMembershipStatusVariant = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'active') return 'success' as const;
  if (s === 'suspended' || s === 'inactive') return 'warning' as const;
  return 'secondary' as const;
};

const getMembershipStatusLabel = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'active') return 'Activo';
  if (s === 'suspended') return 'Suspendido';
  if (s === 'inactive') return 'Inactivo';
  return status;
};

type SheetTab = 'info' | 'memberships';

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
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Sheet state
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [activeTab, setActiveTab] = useState<SheetTab>('info');

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

      const updatedUser = { ...target, isSuperAdmin: !target.isSuperAdmin };

      setUsers((prev) =>
        prev.map((user) =>
          user.id === target.id ? updatedUser : user
        )
      );

      if (selectedUser?.id === target.id) {
        setSelectedUser(updatedUser);
      }

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

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    if (userToDelete.id === currentUser?.id) {
      toastError('No podés eliminar tu propio usuario');
      return;
    }

    setIsDeletingUser(true);
    try {
      const response = await apiFetch(`/api/v1/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo eliminar el usuario'));
      }

      if (selectedUser?.id === userToDelete.id) {
        setSelectedUser(null);
      }

      toastSuccess('Usuario eliminado');
      await loadUsers(true);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo eliminar el usuario');
    } finally {
      setIsDeletingUser(false);
    }
  };

  const openUserSheet = (user: AdminUser) => {
    setSelectedUser(user);
    setActiveTab('info');
  };

  const statCards = useMemo(() => ([
    { label: 'Total usuarios', value: stats?.total ?? 0, icon: Users, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-400' },
    { label: 'Activos', value: stats?.active ?? 0, icon: UserCheck, iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-400' },
    { label: 'Super admins', value: stats?.superAdmins ?? 0, icon: Shield, iconBg: 'bg-primary/10', iconColor: 'text-primary' },
    { label: 'Suspendidos', value: stats?.suspended ?? 0, icon: UserX, iconBg: 'bg-red-500/10', iconColor: 'text-red-400' },
  ]), [stats]);

  const sheetTabs: { id: SheetTab; label: string; icon: typeof Users; count?: number }[] = [
    { id: 'info', label: 'Información', icon: Users },
    { id: 'memberships', label: 'Negocios', icon: Building2, count: selectedUser?._count.memberships },
  ];

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
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

      {/* Stat cards */}
      <AnimatedStagger className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <AnimatedCard key={card.label}>
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
          </AnimatedCard>
        ))}
      </AnimatedStagger>

      {/* Users table */}
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
              {users.map((adminUser) => {
                const primaryPlan = getUserPrimaryPlanBadge(adminUser);
                return (
                  <div
                    key={adminUser.id}
                    onClick={() => openUserSheet(adminUser)}
                    className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer group"
                  >
                    <div className="w-11 h-11 rounded-xl bg-background/60 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-medium text-muted-foreground">
                        {formatUserName(adminUser).charAt(0).toUpperCase()}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{formatUserName(adminUser)}</p>
                      <p className="text-sm text-muted-foreground truncate">{adminUser.email}</p>
                    </div>

                    <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                      {getUserStatusBadge(adminUser.status)}
                      {primaryPlan && (
                        <Badge variant={primaryPlan.variant}>{primaryPlan.label}</Badge>
                      )}
                      {adminUser.isSuperAdmin && <Badge variant="default">Super Admin</Badge>}
                    </div>

                    <div className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground flex-shrink-0 w-24">
                      <Building2 className="w-3.5 h-3.5" />
                      {adminUser._count.memberships} negocio{adminUser._count.memberships !== 1 ? 's' : ''}
                    </div>

                    <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
                  </div>
                );
              })}
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

      {/* Detail Sheet */}
      <Sheet open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <SheetContent className="sm:max-w-2xl lg:max-w-3xl overflow-hidden flex flex-col">
          {selectedUser && (
            <>
              <SheetHeader className="pr-10">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ring-2 ring-primary/20">
                    <span className="text-xl font-bold text-primary">
                      {formatUserName(selectedUser).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SheetTitle className="truncate">
                        {formatUserName(selectedUser)}
                      </SheetTitle>
                      {getUserStatusBadge(selectedUser.status)}
                    </div>
                    <SheetDescription className="mt-1">
                      {selectedUser.email}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              {/* Tabs */}
              <div className="flex gap-1 p-1 bg-secondary/50 rounded-xl mx-6 mt-2">
                {sheetTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeTab === tab.id
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          activeTab === tab.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                        }`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {activeTab === 'info' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Email</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground text-sm truncate">{selectedUser.email}</p>
                          {selectedUser.emailVerifiedAt
                            ? <Badge variant="success">Verificado</Badge>
                            : <Badge variant="warning">Sin verificar</Badge>
                          }
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Estado</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {getUserStatusBadge(selectedUser.status)}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Super Admin</span>
                        </div>
                        <p className="font-medium text-foreground text-sm">
                          {selectedUser.isSuperAdmin ? 'Sí' : 'No'}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Negocios</span>
                        </div>
                        <p className="font-medium text-foreground text-sm">
                          {selectedUser._count.memberships}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Último login</span>
                        </div>
                        <p className="font-medium text-foreground text-sm">
                          {formatDate(selectedUser.lastLoginAt)}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Registro</span>
                        </div>
                        <p className="font-medium text-foreground text-sm">
                          {formatDate(selectedUser.createdAt)}
                        </p>
                      </div>
                    </div>

                    {/* Plans */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Planes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {getUserPlanBadges(selectedUser).map((planBadge) => (
                          <Badge key={planBadge.key} variant={planBadge.variant}>
                            {planBadge.label}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2 pt-4 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground">Acciones</p>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant={selectedUser.isSuperAdmin ? 'secondary' : 'default'}
                          onClick={() => handleToggleSuperAdmin(selectedUser)}
                          isLoading={togglingUserId === selectedUser.id}
                          className="w-full justify-center"
                        >
                          {selectedUser.isSuperAdmin ? (
                            <>
                              <ShieldOff className="w-4 h-4 mr-2" />
                              Quitar super admin
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-4 h-4 mr-2" />
                              Hacer super admin
                            </>
                          )}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => setUserToDelete(selectedUser)}
                          disabled={selectedUser.id === currentUser?.id}
                          title={
                            selectedUser.id === currentUser?.id
                              ? 'No podés eliminar tu propio usuario'
                              : 'Eliminar usuario'
                          }
                          className="w-full justify-center"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Eliminar usuario
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'memberships' && (
                  <div className="space-y-2">
                    {selectedUser.memberships.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                          <Building2 className="w-7 h-7 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground">Sin negocios asociados</p>
                        <p className="text-sm text-muted-foreground/50 mt-1">
                          Este usuario no pertenece a ningún negocio
                        </p>
                      </div>
                    ) : (
                      selectedUser.memberships.map((membership, idx) => {
                        const rawPlan = membership.workspace?.plan?.trim();
                        const normalizedPlan = rawPlan ? normalizeCommercePlan(rawPlan) : null;

                        return (
                          <div
                            key={membership.workspace?.id || idx}
                            className="p-4 rounded-xl bg-secondary/50"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-xl bg-background/60 flex items-center justify-center flex-shrink-0">
                                  <Building2 className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground text-sm truncate">
                                    {membership.workspace?.name || 'Sin nombre'}
                                  </p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    {normalizedPlan && (
                                      <Badge variant={getPlanVariant(normalizedPlan)}>
                                        {formatPlanLabel(normalizedPlan)}
                                      </Badge>
                                    )}
                                    <Badge variant={getRoleVariant(membership.role?.name || '')}>
                                      {membership.role?.name || 'Sin rol'}
                                    </Badge>
                                    <Badge variant={getMembershipStatusVariant(membership.status)}>
                                      {getMembershipStatusLabel(membership.status)}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <DeleteConfirmModal
        isOpen={Boolean(userToDelete)}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleDeleteUser}
        title="Eliminar usuario"
        message={
          userToDelete
            ? `¿Eliminar el usuario ${userToDelete.email}? Esta acción es irreversible.`
            : '¿Eliminar usuario?'
        }
        itemCount={1}
        isLoading={isDeletingUser}
      />
    </AnimatedPage>
  );
}
