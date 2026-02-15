import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, Plus, Trash2, AlertTriangle, MessageCircle, RefreshCw, Link2, FlaskConical } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AnimatedPage,
} from '../../components/ui';
import { businessTypes } from '../../config/modules';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';
import { WorkspacePaywallCard } from '../paywall/WorkspaceSuspendedPage';

interface WhatsAppNumber {
  id: string;
  phoneNumber: string;
  displayName: string;
  provider: 'infobip' | 'twilio' | string;
  businessType: string;
  status: 'available' | 'assigned' | 'suspended' | 'error';
  isActive: boolean;
  hasCredentials?: boolean;
  healthStatus?: 'healthy' | 'error' | 'unknown' | string | null;
  workspace?: {
    id: string;
    name: string;
  } | null;
  notes?: string | null;
  createdAt: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

type EvolutionHealth = {
  configured: boolean;
  healthy: boolean;
  baseUrl?: string;
  instanceCount?: number;
  error?: string;
};

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

const getBusinessTypeName = (id: string) => businessTypes[id]?.name || id;

const getStatusBadge = (number: WhatsAppNumber) => {
  if (number.status === 'assigned') return <Badge variant="success">Asignado</Badge>;
  if (number.status === 'suspended') return <Badge variant="warning">Suspendido</Badge>;
  if (number.status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Disponible</Badge>;
};

const getHealthBadge = (healthStatus?: string | null) => {
  if (!healthStatus || healthStatus === 'unknown') return <Badge variant="secondary">Sin test</Badge>;
  if (healthStatus === 'healthy') return <Badge variant="success">Sano</Badge>;
  return <Badge variant="warning">Revisar</Badge>;
};

export default function WhatsAppNumbersPage() {
  const toastSuccess = useToastStore((state) => state.success);
  const toastError = useToastStore((state) => state.error);

  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [evolutionHealth, setEvolutionHealth] = useState<EvolutionHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<WhatsAppNumber | null>(null);
  const [assignWorkspaceId, setAssignWorkspaceId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionNumberId, setActionNumberId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    phoneNumber: '',
    businessType: 'commerce',
  });

  const resetCreateForm = () => {
    setFormData({
      phoneNumber: '',
      businessType: 'commerce',
    });
    setError('');
  };

  const loadAdminData = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [numbersRes, workspacesRes, evolutionRes] = await Promise.all([
        apiFetch('/api/v1/admin/whatsapp-numbers'),
        apiFetch('/api/v1/admin/workspaces?limit=200&page=1'),
        apiFetch('/api/v1/admin/whatsapp/evolution/health'),
      ]);

      if (!numbersRes.ok) throw new Error(await readApiError(numbersRes, 'No se pudieron cargar los números'));
      if (!workspacesRes.ok) {
        throw new Error(await readApiError(workspacesRes, 'No se pudieron cargar los negocios'));
      }

      const numbersData = await numbersRes.json() as { numbers: WhatsAppNumber[] };
      const workspacesData = await workspacesRes.json() as { workspaces: Array<{ id: string; name: string }> };

      setNumbers(numbersData.numbers || []);
      setWorkspaces((workspacesData.workspaces || []).map((w) => ({ id: w.id, name: w.name })));

      if (evolutionRes.ok) {
        const data = await evolutionRes.json() as EvolutionHealth;
        setEvolutionHealth(data);
      } else {
        setEvolutionHealth(null);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'No se pudo cargar la configuración de WhatsApp');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toastError]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const handleAddNumber = async () => {
    setError('');
    if (!formData.phoneNumber.trim()) {
      setError('Ingresá el número de teléfono');
      return;
    }
    if (!formData.businessType) {
      setError('Seleccioná el tipo de negocio');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        phoneNumber: formData.phoneNumber.trim(),
        businessType: formData.businessType,
      };

      const res = await apiFetch('/api/v1/admin/whatsapp-numbers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await readApiError(res, 'Error al crear número'));

      const data = await res.json() as { number: WhatsAppNumber };
      setNumbers((prev) => [data.number, ...prev]);
      toastSuccess('Número agregado');
      setShowAddModal(false);
      resetCreateForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear número');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteNumber = async (id: string) => {
    if (!window.confirm('¿Seguro que querés eliminar este número?')) return;
    setActionNumberId(id);
    try {
      const res = await apiFetch(`/api/v1/admin/whatsapp-numbers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, 'No se pudo eliminar el número'));
      setNumbers((prev) => prev.filter((n) => n.id !== id));
      toastSuccess('Número eliminado');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'No se pudo eliminar el número');
    } finally {
      setActionNumberId(null);
    }
  };

  const handleTestConnection = async (id: string) => {
    setActionNumberId(id);
    try {
      const res = await apiFetch(`/api/v1/admin/whatsapp-numbers/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(await readApiError(res, 'No se pudo probar la conexión'));
      toastSuccess('Conexión validada');
      await loadAdminData(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'No se pudo probar la conexión');
    } finally {
      setActionNumberId(null);
    }
  };

  const handleOpenAssignModal = (number: WhatsAppNumber) => {
    setAssignTarget(number);
    setAssignWorkspaceId(number.workspace?.id || '');
    setShowAssignModal(true);
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    if (!assignWorkspaceId) {
      toastError('Seleccioná un negocio');
      return;
    }

    setIsAssigning(true);
    try {
      const res = await apiFetch(`/api/v1/admin/whatsapp-numbers/${assignTarget.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: assignWorkspaceId,
          allowedRoles: [],
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'No se pudo asignar el número'));
      toastSuccess('Número asignado');
      setShowAssignModal(false);
      setAssignTarget(null);
      setAssignWorkspaceId('');
      await loadAdminData(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'No se pudo asignar el número');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnassign = async (number: WhatsAppNumber) => {
    if (!number.workspace) return;
    setActionNumberId(number.id);
    try {
      const res = await apiFetch(`/api/v1/admin/whatsapp-numbers/${number.id}/unassign`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readApiError(res, 'No se pudo desasignar el número'));
      toastSuccess('Número desasignado');
      await loadAdminData(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'No se pudo desasignar el número');
    } finally {
      setActionNumberId(null);
    }
  };

  const stats = useMemo(() => ({
    total: numbers.length,
    assigned: numbers.filter((n) => n.status === 'assigned').length,
    available: numbers.filter((n) => n.status === 'available').length,
    suspended: numbers.filter((n) => n.status === 'suspended').length,
  }), [numbers]);

  const isEvolutionMode = Boolean(evolutionHealth?.configured);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Números WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            Agregá números, asignalos a negocios y probá conectividad
          </p>
        </div>
        <div className="flex items-center gap-3">
          {evolutionHealth ? (
            evolutionHealth.configured ? (
              <Badge variant={evolutionHealth.healthy ? 'success' : 'warning'}>
                Evolution {evolutionHealth.healthy ? 'Online' : 'Error'}
              </Badge>
            ) : (
              <Badge variant="secondary">Evolution no configurado</Badge>
            )
          ) : (
            <Badge variant="secondary">Evolution: sin datos</Badge>
          )}
          <Button variant="secondary" onClick={() => loadAdminData(true)} isLoading={isRefreshing}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Actualizar
          </Button>
          {!isEvolutionMode && (
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Agregar número
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{stats.total}</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Disponibles</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{stats.available}</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Asignados</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{stats.assigned}</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Suspendidos</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{stats.suspended}</p>
        </div>
      </div>

      {isEvolutionMode && (
        <div className="flex justify-center">
          <WorkspacePaywallCard
            showActions={false}
            badgeText="WhatsApp · Evolution"
            badgeVariant={evolutionHealth?.healthy ? 'success' : 'warning'}
            titleOverride="Gestión de números deshabilitada"
            descriptionOverride="Actualmente estamos usando Evolution (Baileys) para conectar WhatsApp por QR. No se pueden agregar números desde este panel hasta que cambiemos la configuración."
            leftTitleOverride="Estado Evolution"
            leftDescriptionOverride={
              evolutionHealth?.healthy
                ? `Evolution está online${typeof evolutionHealth.instanceCount === 'number' ? ` · Instancias: ${evolutionHealth.instanceCount}` : ''}.`
                : `No se pudo validar Evolution${evolutionHealth?.error ? `: ${evolutionHealth.error}` : '.'}`
            }
            rightTitleOverride="Cómo se conecta"
            rightDescriptionOverride="Cada negocio conecta su propio número desde Configuración → Aplicaciones → WhatsApp."
            helperText="Para volver a un proveedor por números (Infobip), primero hay que cambiar la configuración global."
            topRightIcon={<Phone className="w-5 h-5 text-foreground" />}
          />
        </div>
      )}

      {numbers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {numbers.map((number) => (
            <div key={number.id} className="glass-card rounded-2xl p-5 hover:shadow-2xl transition-all duration-300">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <Phone className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono font-medium text-foreground truncate">{number.phoneNumber}</p>
                    <p className="text-sm text-muted-foreground mt-1 truncate">
                      {number.displayName || number.phoneNumber}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {number.provider} · {getBusinessTypeName(number.businessType)}
                    </p>
                    {number.workspace && (
                      <p className="text-xs text-primary mt-1">
                        Asignado a: {number.workspace.name}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {getStatusBadge(number)}
                  {getHealthBadge(number.healthStatus)}
                  {number.hasCredentials ? <Badge variant="success">Credenciales OK</Badge> : <Badge variant="warning">Sin credenciales</Badge>}
                </div>
              </div>

              {number.notes && (
                <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{number.notes}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenAssignModal(number)}
                  disabled={actionNumberId === number.id}
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  {number.workspace ? 'Reasignar' : 'Asignar'}
                </Button>

                {number.workspace && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleUnassign(number)}
                    isLoading={actionNumberId === number.id}
                  >
                    Desasignar
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleTestConnection(number.id)}
                  isLoading={actionNumberId === number.id}
                >
                  <FlaskConical className="w-4 h-4 mr-2" />
                  Test
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteNumber(number.id)}
                  isLoading={actionNumberId === number.id}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Eliminar
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : isEvolutionMode ? null : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <MessageCircle className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground">No hay números configurados</p>
              <p className="text-sm text-muted-foreground/50 mt-1 max-w-sm">
                Agregá números de WhatsApp y asignalos a un tipo de negocio para que los usuarios puedan usarlos.
              </p>
              {!isEvolutionMode && (
                <Button onClick={() => setShowAddModal(true)} className="mt-6">
                  <Plus className="w-4 h-4 mr-2" />
                  Agregar primer número
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={showAddModal}
        onOpenChange={(open) => {
          setShowAddModal(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Phone className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <DialogTitle>Agregar número WhatsApp</DialogTitle>
                <DialogDescription>
                  Cargá el número y el tipo de comercio. El proveedor por defecto es Infobip.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 py-4 px-1 -mx-1">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Número de teléfono</Label>
              <Input
                placeholder="5491155550000"
                value={formData.phoneNumber}
                onChange={(e) => setFormData((prev) => ({ ...prev, phoneNumber: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de comercio</Label>
              <Select
                value={formData.businessType}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, businessType: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(businessTypes).map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-3 w-full pt-4 border-t border-border">
            <Button variant="secondary" className="flex-1" onClick={() => setShowAddModal(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={handleAddNumber} isLoading={isSubmitting}>
              Agregar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showAssignModal}
        onOpenChange={(open) => {
          setShowAssignModal(open);
          if (!open) {
            setAssignTarget(null);
            setAssignWorkspaceId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar número</DialogTitle>
            <DialogDescription>
              {assignTarget ? `Número ${assignTarget.phoneNumber}` : 'Seleccioná un negocio'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Negocio</Label>
            <Select value={assignWorkspaceId} onValueChange={setAssignWorkspaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar negocio" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3 w-full pt-4 border-t border-border">
            <Button variant="secondary" className="flex-1" onClick={() => setShowAssignModal(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={handleAssign} isLoading={isAssigning}>
              Asignar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
