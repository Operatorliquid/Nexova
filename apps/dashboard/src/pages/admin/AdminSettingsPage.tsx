import { useCallback, useEffect, useState } from 'react';
import { Key, Bot, Wrench, AlertTriangle, Gauge, Trash2, RefreshCw } from 'lucide-react';
import { DEFAULT_COMMERCE_PLAN_LIMITS } from '@nexova/shared';
import {
  Badge,
  Button,
  Input,
  Label,
  Switch,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';

interface RateLimits {
  apiRequestsPerMinute: number;
  whatsappMessagesPerMinute: number;
  llmTokensPerRequest: number;
  loginAttemptsBeforeLock: number;
}

interface AdminSettings {
  defaultLlmModel: string;
  maintenanceMode: boolean;
  maintenanceMsg?: string | null;
  hasAnthropicKey: boolean;
  rateLimits?: Partial<RateLimits> | null;
  featureFlags?: Record<string, unknown> | null;
  updatedAt?: string;
}

interface ApiErrorBody {
  message?: string;
  error?: string;
}

const DEFAULT_RATE_LIMITS: RateLimits = {
  apiRequestsPerMinute: 100,
  whatsappMessagesPerMinute: 60,
  llmTokensPerRequest: 4096,
  loginAttemptsBeforeLock: 5,
};

const readApiError = async (response: Response, fallback: string) => {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // Ignore malformed error payload.
  }
  return fallback;
};

const toPositiveInt = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

type PlanLimitsForm = {
  basic: {
    ordersPerMonth: string;
    aiMetricsInsightsPerMonth: string;
    aiCustomerSummariesPerMonth: string;
    debtRemindersPerMonth: string;
  };
  standard: {
    ordersPerMonth: string;
    aiMetricsInsightsPerMonth: string;
    aiCustomerSummariesPerMonth: string;
    debtRemindersPerMonth: string;
  };
  pro: {
    ordersPerMonth: string;
    aiMetricsInsightsPerMonth: string;
    aiCustomerSummariesPerMonth: string;
    debtRemindersPerMonth: string;
  };
};

const DEFAULT_PLAN_LIMITS_FORM: PlanLimitsForm = {
  basic: {
    ordersPerMonth: String(DEFAULT_COMMERCE_PLAN_LIMITS.basic.ordersPerMonth ?? 200),
    aiMetricsInsightsPerMonth: '',
    aiCustomerSummariesPerMonth: '',
    debtRemindersPerMonth: '',
  },
  standard: {
    ordersPerMonth: String(DEFAULT_COMMERCE_PLAN_LIMITS.standard.ordersPerMonth ?? 550),
    aiMetricsInsightsPerMonth: '',
    aiCustomerSummariesPerMonth: '',
    debtRemindersPerMonth: '',
  },
  pro: {
    ordersPerMonth: String(DEFAULT_COMMERCE_PLAN_LIMITS.pro.ordersPerMonth ?? 1700),
    aiMetricsInsightsPerMonth: '',
    aiCustomerSummariesPerMonth: '',
    debtRemindersPerMonth: '',
  },
};

export default function AdminSettingsPage() {
  const toastSuccess = useToastStore((state) => state.success);
  const toastError = useToastStore((state) => state.error);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isSavingLimits, setIsSavingLimits] = useState(false);
  const [isSavingPlanLimits, setIsSavingPlanLimits] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);

  const [anthropicKey, setAnthropicKey] = useState('');
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [llmModel, setLlmModel] = useState('claude-sonnet-4-20250514');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [rateLimits, setRateLimits] = useState({
    apiRequestsPerMinute: String(DEFAULT_RATE_LIMITS.apiRequestsPerMinute),
    whatsappMessagesPerMinute: String(DEFAULT_RATE_LIMITS.whatsappMessagesPerMinute),
    llmTokensPerRequest: String(DEFAULT_RATE_LIMITS.llmTokensPerRequest),
    loginAttemptsBeforeLock: String(DEFAULT_RATE_LIMITS.loginAttemptsBeforeLock),
  });
  const [planLimits, setPlanLimits] = useState<PlanLimitsForm>(DEFAULT_PLAN_LIMITS_FORM);

  const loadSettings = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const response = await apiFetch('/api/v1/admin/settings');
      if (!response.ok) throw new Error(await readApiError(response, 'No se pudo cargar configuración'));

      const data = await response.json() as { settings: AdminSettings };
      const settings = data.settings;
      const limits = settings.rateLimits || {};

      setHasAnthropicKey(Boolean(settings.hasAnthropicKey));
      setLlmModel(settings.defaultLlmModel || 'claude-sonnet-4-20250514');
      setMaintenanceMode(Boolean(settings.maintenanceMode));
      setMaintenanceMsg(settings.maintenanceMsg || '');
      setRateLimits({
        apiRequestsPerMinute: String(
          typeof limits.apiRequestsPerMinute === 'number'
            ? limits.apiRequestsPerMinute
            : DEFAULT_RATE_LIMITS.apiRequestsPerMinute
        ),
        whatsappMessagesPerMinute: String(
          typeof limits.whatsappMessagesPerMinute === 'number'
            ? limits.whatsappMessagesPerMinute
            : DEFAULT_RATE_LIMITS.whatsappMessagesPerMinute
        ),
        llmTokensPerRequest: String(
          typeof limits.llmTokensPerRequest === 'number'
            ? limits.llmTokensPerRequest
            : DEFAULT_RATE_LIMITS.llmTokensPerRequest
        ),
        loginAttemptsBeforeLock: String(
          typeof limits.loginAttemptsBeforeLock === 'number'
            ? limits.loginAttemptsBeforeLock
            : DEFAULT_RATE_LIMITS.loginAttemptsBeforeLock
        ),
      });

      const featureFlags = asObject(settings.featureFlags);
      const commercePlanLimits = asObject(featureFlags.commercePlanLimits);
      const pickNumberOrDefault = (value: unknown, fallback: number) => {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
        if (typeof value === 'string') {
          const n = Number.parseInt(value.trim(), 10);
          if (Number.isFinite(n) && n > 0) return String(n);
        }
        return String(fallback);
      };
      const pickNumberOrEmpty = (value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
        if (typeof value === 'string') {
          const n = Number.parseInt(value.trim(), 10);
          if (Number.isFinite(n) && n > 0) return String(n);
        }
        return '';
      };
      const basicCfg = asObject(commercePlanLimits.basic);
      const standardCfg = asObject(commercePlanLimits.standard);
      const proCfg = asObject(commercePlanLimits.pro);

      setPlanLimits({
        basic: {
          ordersPerMonth: pickNumberOrDefault(basicCfg.ordersPerMonth, DEFAULT_COMMERCE_PLAN_LIMITS.basic.ordersPerMonth ?? 200),
          aiMetricsInsightsPerMonth: pickNumberOrEmpty(basicCfg.aiMetricsInsightsPerMonth),
          aiCustomerSummariesPerMonth: pickNumberOrEmpty(basicCfg.aiCustomerSummariesPerMonth),
          debtRemindersPerMonth: pickNumberOrEmpty(basicCfg.debtRemindersPerMonth),
        },
        standard: {
          ordersPerMonth: pickNumberOrDefault(standardCfg.ordersPerMonth, DEFAULT_COMMERCE_PLAN_LIMITS.standard.ordersPerMonth ?? 550),
          aiMetricsInsightsPerMonth: pickNumberOrEmpty(standardCfg.aiMetricsInsightsPerMonth),
          aiCustomerSummariesPerMonth: pickNumberOrEmpty(standardCfg.aiCustomerSummariesPerMonth),
          debtRemindersPerMonth: pickNumberOrEmpty(standardCfg.debtRemindersPerMonth),
        },
        pro: {
          ordersPerMonth: pickNumberOrDefault(proCfg.ordersPerMonth, DEFAULT_COMMERCE_PLAN_LIMITS.pro.ordersPerMonth ?? 1700),
          aiMetricsInsightsPerMonth: pickNumberOrEmpty(proCfg.aiMetricsInsightsPerMonth),
          aiCustomerSummariesPerMonth: pickNumberOrEmpty(proCfg.aiCustomerSummariesPerMonth),
          debtRemindersPerMonth: pickNumberOrEmpty(proCfg.debtRemindersPerMonth),
        },
      });
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo cargar configuración');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toastError]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveGeneral = async () => {
    setIsSavingGeneral(true);
    try {
      const response = await apiFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          defaultLlmModel: llmModel,
          maintenanceMode,
          maintenanceMsg: maintenanceMode ? maintenanceMsg : '',
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'No se pudo guardar configuración'));
      toastSuccess('Configuración general guardada');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo guardar configuración');
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const saveAnthropicKey = async () => {
    if (!anthropicKey.trim()) {
      toastError('Ingresá una API key');
      return;
    }

    setIsSavingKey(true);
    try {
      const response = await apiFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ anthropicKey: anthropicKey.trim() }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'No se pudo guardar la API key'));
      setAnthropicKey('');
      setHasAnthropicKey(true);
      toastSuccess('API key actualizada');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo guardar la API key');
    } finally {
      setIsSavingKey(false);
    }
  };

  const saveRateLimits = async () => {
    setIsSavingLimits(true);
    try {
      const payload: RateLimits = {
        apiRequestsPerMinute: toPositiveInt(rateLimits.apiRequestsPerMinute, DEFAULT_RATE_LIMITS.apiRequestsPerMinute),
        whatsappMessagesPerMinute: toPositiveInt(rateLimits.whatsappMessagesPerMinute, DEFAULT_RATE_LIMITS.whatsappMessagesPerMinute),
        llmTokensPerRequest: toPositiveInt(rateLimits.llmTokensPerRequest, DEFAULT_RATE_LIMITS.llmTokensPerRequest),
        loginAttemptsBeforeLock: toPositiveInt(rateLimits.loginAttemptsBeforeLock, DEFAULT_RATE_LIMITS.loginAttemptsBeforeLock),
      };

      const response = await apiFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ rateLimits: payload }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'No se pudieron guardar los límites'));

      setRateLimits({
        apiRequestsPerMinute: String(payload.apiRequestsPerMinute),
        whatsappMessagesPerMinute: String(payload.whatsappMessagesPerMinute),
        llmTokensPerRequest: String(payload.llmTokensPerRequest),
        loginAttemptsBeforeLock: String(payload.loginAttemptsBeforeLock),
      });
      toastSuccess('Límites guardados');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudieron guardar los límites');
    } finally {
      setIsSavingLimits(false);
    }
  };

  const savePlanLimits = async () => {
    setIsSavingPlanLimits(true);
    try {
      const toNullablePositiveInt = (value: string) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      };

      const payload = {
        basic: {
          ordersPerMonth: toPositiveInt(planLimits.basic.ordersPerMonth, DEFAULT_COMMERCE_PLAN_LIMITS.basic.ordersPerMonth ?? 200),
          aiMetricsInsightsPerMonth: toNullablePositiveInt(planLimits.basic.aiMetricsInsightsPerMonth),
          aiCustomerSummariesPerMonth: toNullablePositiveInt(planLimits.basic.aiCustomerSummariesPerMonth),
          debtRemindersPerMonth: toNullablePositiveInt(planLimits.basic.debtRemindersPerMonth),
        },
        standard: {
          ordersPerMonth: toPositiveInt(planLimits.standard.ordersPerMonth, DEFAULT_COMMERCE_PLAN_LIMITS.standard.ordersPerMonth ?? 550),
          aiMetricsInsightsPerMonth: toNullablePositiveInt(planLimits.standard.aiMetricsInsightsPerMonth),
          aiCustomerSummariesPerMonth: toNullablePositiveInt(planLimits.standard.aiCustomerSummariesPerMonth),
          debtRemindersPerMonth: toNullablePositiveInt(planLimits.standard.debtRemindersPerMonth),
        },
        pro: {
          ordersPerMonth: toPositiveInt(planLimits.pro.ordersPerMonth, DEFAULT_COMMERCE_PLAN_LIMITS.pro.ordersPerMonth ?? 1700),
          aiMetricsInsightsPerMonth: toNullablePositiveInt(planLimits.pro.aiMetricsInsightsPerMonth),
          aiCustomerSummariesPerMonth: toNullablePositiveInt(planLimits.pro.aiCustomerSummariesPerMonth),
          debtRemindersPerMonth: toNullablePositiveInt(planLimits.pro.debtRemindersPerMonth),
        },
      };

      const response = await apiFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ commercePlanLimits: payload }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'No se pudieron guardar los límites por plan'));

      setPlanLimits({
        basic: {
          ordersPerMonth: String(payload.basic.ordersPerMonth),
          aiMetricsInsightsPerMonth: payload.basic.aiMetricsInsightsPerMonth ? String(payload.basic.aiMetricsInsightsPerMonth) : '',
          aiCustomerSummariesPerMonth: payload.basic.aiCustomerSummariesPerMonth ? String(payload.basic.aiCustomerSummariesPerMonth) : '',
          debtRemindersPerMonth: payload.basic.debtRemindersPerMonth ? String(payload.basic.debtRemindersPerMonth) : '',
        },
        standard: {
          ordersPerMonth: String(payload.standard.ordersPerMonth),
          aiMetricsInsightsPerMonth: payload.standard.aiMetricsInsightsPerMonth ? String(payload.standard.aiMetricsInsightsPerMonth) : '',
          aiCustomerSummariesPerMonth: payload.standard.aiCustomerSummariesPerMonth ? String(payload.standard.aiCustomerSummariesPerMonth) : '',
          debtRemindersPerMonth: payload.standard.debtRemindersPerMonth ? String(payload.standard.debtRemindersPerMonth) : '',
        },
        pro: {
          ordersPerMonth: String(payload.pro.ordersPerMonth),
          aiMetricsInsightsPerMonth: payload.pro.aiMetricsInsightsPerMonth ? String(payload.pro.aiMetricsInsightsPerMonth) : '',
          aiCustomerSummariesPerMonth: payload.pro.aiCustomerSummariesPerMonth ? String(payload.pro.aiCustomerSummariesPerMonth) : '',
          debtRemindersPerMonth: payload.pro.debtRemindersPerMonth ? String(payload.pro.debtRemindersPerMonth) : '',
        },
      });

      toastSuccess('Límites por plan guardados');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudieron guardar los límites por plan');
    } finally {
      setIsSavingPlanLimits(false);
    }
  };

  const clearCache = async () => {
    if (!window.confirm('¿Querés limpiar la caché del sistema?')) return;
    setIsClearingCache(true);
    try {
      const response = await apiFetch('/api/v1/admin/cache/clear', { method: 'POST' });
      if (!response.ok) throw new Error(await readApiError(response, 'No se pudo limpiar la cache'));
      const body = await response.json() as { deletedKeys?: number };
      toastSuccess(`Cache limpiada (${body.deletedKeys || 0} claves eliminadas)`);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo limpiar la cache');
    } finally {
      setIsClearingCache(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Configuración del Sistema</h2>
          <p className="text-sm text-muted-foreground">
            Configuraciones globales que afectan a toda la plataforma
          </p>
        </div>
        <Button variant="secondary" onClick={() => loadSettings(true)} isLoading={isRefreshing}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Actualizar
        </Button>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">API Keys</h3>
            <p className="text-xs text-muted-foreground">Claves de acceso a servicios externos</p>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <div className="p-4 rounded-xl bg-secondary/30 border border-border space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-foreground">Anthropic API Key</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Clave de API para Claude (agente IA)
                </p>
              </div>
              {hasAnthropicKey ? (
                <Badge variant="success">Configurada</Badge>
              ) : (
                <Badge variant="destructive">No configurada</Badge>
              )}
            </div>
            <div className="flex gap-3">
              <Input
                type="password"
                placeholder="sk-ant-..."
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                className="flex-1"
              />
              <Button onClick={saveAnthropicKey} isLoading={isSavingKey}>
                {hasAnthropicKey ? 'Actualizar' : 'Guardar'}
              </Button>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-secondary/30 border border-border space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Bot className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-foreground">Modelo de IA</h4>
                <p className="text-xs text-muted-foreground">
                  Modelo predeterminado para el agente conversacional
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Modelo</Label>
              <Select value={llmModel} onValueChange={setLlmModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4 (Recomendado)</SelectItem>
                  <SelectItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</SelectItem>
                  <SelectItem value="claude-3-haiku-20240307">Claude 3 Haiku (Más rápido)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Modo Mantenimiento</h3>
            <p className="text-xs text-muted-foreground">Bloquear acceso temporal a la plataforma</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 border border-border">
            <div>
              <h4 className="text-sm font-medium text-foreground">Activar modo mantenimiento</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Los usuarios verán un mensaje de mantenimiento y no podrán acceder
              </p>
            </div>
            <Switch
              checked={maintenanceMode}
              onChange={(e) => setMaintenanceMode(e.target.checked)}
            />
          </div>

          {maintenanceMode && (
            <div className="space-y-2">
              <Label>Mensaje de mantenimiento</Label>
              <Textarea
                placeholder="Estamos realizando mejoras en la plataforma..."
                value={maintenanceMsg}
                onChange={(e) => setMaintenanceMsg(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={saveGeneral} isLoading={isSavingGeneral}>
              Guardar configuración general
            </Button>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Límites de Tasa</h3>
            <p className="text-xs text-muted-foreground">Protección contra uso excesivo</p>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-secondary/30 border border-border space-y-2">
              <Label>Requests por minuto (API)</Label>
              <Input
                type="number"
                value={rateLimits.apiRequestsPerMinute}
                onChange={(e) => setRateLimits((prev) => ({ ...prev, apiRequestsPerMinute: e.target.value }))}
              />
            </div>
            <div className="p-4 rounded-xl bg-secondary/30 border border-border space-y-2">
              <Label>Mensajes por minuto (WhatsApp)</Label>
              <Input
                type="number"
                value={rateLimits.whatsappMessagesPerMinute}
                onChange={(e) => setRateLimits((prev) => ({ ...prev, whatsappMessagesPerMinute: e.target.value }))}
              />
            </div>
            <div className="p-4 rounded-xl bg-secondary/30 border border-border space-y-2">
              <Label>Tokens máximos por request (LLM)</Label>
              <Input
                type="number"
                value={rateLimits.llmTokensPerRequest}
                onChange={(e) => setRateLimits((prev) => ({ ...prev, llmTokensPerRequest: e.target.value }))}
              />
            </div>
            <div className="p-4 rounded-xl bg-secondary/30 border border-border space-y-2">
              <Label>Intentos de login antes de bloqueo</Label>
              <Input
                type="number"
                value={rateLimits.loginAttemptsBeforeLock}
                onChange={(e) => setRateLimits((prev) => ({ ...prev, loginAttemptsBeforeLock: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={saveRateLimits} isLoading={isSavingLimits}>Guardar límites</Button>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Límites por Plan</h3>
            <p className="text-xs text-muted-foreground">
              Cuotas mensuales (UTC). Campos vacíos en IA/deuda = ilimitado.
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(['basic', 'standard', 'pro'] as const).map((plan) => (
              <div key={plan} className="p-4 rounded-xl bg-secondary/30 border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-foreground capitalize">{plan}</div>
                  <Badge variant={plan === 'basic' ? 'secondary' : plan === 'standard' ? 'info' : 'success'}>
                    {plan}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label>Pedidos / mes</Label>
                  <Input
                    type="number"
                    value={planLimits[plan].ordersPerMonth}
                    onChange={(e) =>
                      setPlanLimits((prev) => ({
                        ...prev,
                        [plan]: { ...prev[plan], ordersPerMonth: e.target.value },
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>IA métricas / mes</Label>
                  <Input
                    type="number"
                    placeholder="Ilimitado"
                    value={planLimits[plan].aiMetricsInsightsPerMonth}
                    onChange={(e) =>
                      setPlanLimits((prev) => ({
                        ...prev,
                        [plan]: { ...prev[plan], aiMetricsInsightsPerMonth: e.target.value },
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>IA clientes / mes</Label>
                  <Input
                    type="number"
                    placeholder="Ilimitado"
                    value={planLimits[plan].aiCustomerSummariesPerMonth}
                    onChange={(e) =>
                      setPlanLimits((prev) => ({
                        ...prev,
                        [plan]: { ...prev[plan], aiCustomerSummariesPerMonth: e.target.value },
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Recordatorios deuda / mes</Label>
                  <Input
                    type="number"
                    placeholder="Ilimitado"
                    value={planLimits[plan].debtRemindersPerMonth}
                    onChange={(e) =>
                      setPlanLimits((prev) => ({
                        ...prev,
                        [plan]: { ...prev[plan], debtRemindersPerMonth: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={savePlanLimits} isLoading={isSavingPlanLimits}>
              Guardar límites por plan
            </Button>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden border border-red-500/20">
        <div className="p-5 border-b border-red-500/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-red-400">Zona de Peligro</h3>
            <p className="text-xs text-muted-foreground">Acciones destructivas e irreversibles</p>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between p-4 rounded-xl bg-red-500/5 border border-red-500/15">
            <div className="flex items-center gap-3">
              <Trash2 className="w-4 h-4 text-red-400" />
              <div>
                <h4 className="text-sm font-medium text-foreground">Limpiar caché del sistema</h4>
                <p className="text-xs text-muted-foreground">
                  Elimina entradas de caché en Redis
                </p>
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={clearCache} isLoading={isClearingCache}>
              Limpiar caché
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
