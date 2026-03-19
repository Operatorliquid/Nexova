import { User, Building2, Check, Ban, Info, FileText } from 'lucide-react';
import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { NavLink, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';

import {
  Button,
  Input,
  Label,
  Textarea,
  Switch,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AnimatedPage,
} from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';
import { cn } from '../../lib/utils';
import { useToast } from '../../stores/toast.store';

type JsonRecord = Record<string, unknown>;
type SettingsNavItem = { name: string; href: string };

const apiUrlRaw: unknown = import.meta.env.VITE_API_URL;
const API_URL = typeof apiUrlRaw === 'string' ? apiUrlRaw : '';
const DEFAULT_LOW_STOCK_THRESHOLD = 10;
const MAX_LOW_STOCK_THRESHOLD = 1_000_000;
const DEFAULT_WORKING_DAYS = ['lun', 'mar', 'mie', 'jue', 'vie'];
const WHATSAPP_CONTACT_MAX_LENGTH = 16;

// Use the shared API wrapper so Settings keeps working when the access token cookie expires
// (it will refresh and retry automatically).
const fetchWithCredentials = (input: string | URL, init?: RequestInit): Promise<Response> =>
  apiFetch(typeof input === 'string' ? input : input.toString(), init);

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asRecordList(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => item !== null);
}

function readString(record: JsonRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(record: JsonRecord | null, key: string): number | undefined {
  const value = record?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBoolean(record: JsonRecord | null, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readRecord(record: JsonRecord | null, key: string): JsonRecord | null {
  return asRecord(record?.[key]);
}

function readStringList(record: JsonRecord | null, key: string, fallback: string[]): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return list.length > 0 ? list : fallback;
}

function readErrorMessage(data: JsonRecord, fallback: string): string {
  return readString(data, 'message') ?? readString(data, 'error') ?? fallback;
}

async function readJsonRecord(response: Response): Promise<JsonRecord> {
  try {
    const parsed = (await response.json()) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function sanitizeWhatsappContactInput(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, '');
  const hasLeadingPlus = cleaned.startsWith('+');
  const digitsOnly = cleaned.replace(/\D/g, '').slice(0, 15);
  if (!digitsOnly) return hasLeadingPlus ? '+' : '';
  return `${hasLeadingPlus ? '+' : ''}${digitsOnly}`;
}

function isValidWhatsappContact(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^\+?\d{8,15}$/.test(trimmed);
}

function isValidOnlineStoreUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Navigation items - "Mi negocio" only shows for commerce business type
const getSettingsNav = (
  businessType?: string,
  options?: { showNotifications?: boolean; showReceipts?: boolean }
): SettingsNavItem[] => {
  const showNotifications = options?.showNotifications ?? true;
  const showReceipts = options?.showReceipts ?? true;
  const nav: SettingsNavItem[] = [
    { name: 'Mi perfil', href: '/settings' },
  ];

  if (businessType === 'commerce') {
    nav.push({ name: 'Mi negocio', href: '/settings/business' });
    if (showReceipts) {
      nav.push({ name: 'Boletas', href: '/settings/receipts' });
    }
    nav.push({ name: 'Stock', href: '/settings/stock' });
    nav.push({ name: 'Pagos', href: '/settings/payments' });
  }

  nav.push({ name: 'Aplicaciones', href: '/settings/applications' });
  if (showNotifications) {
    nav.push({ name: 'Notificaciones', href: '/settings/notifications' });
  }

  return nav;
};

function ProfileSettings(): JSX.Element {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [error, setError] = useState('');
  const avatarRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    avatarUrl: user?.avatarUrl || null,
  });

  useEffect(() => {
    setProfile({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      avatarUrl: user?.avatarUrl || null,
    });
  }, [user?.firstName, user?.lastName, user?.avatarUrl]);

  const handleAvatarUpload = (file: File): void => {
    setIsUploadingAvatar(true);
    setError('');

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile((prev) => ({ ...prev, avatarUrl: reader.result as string }));
        setIsUploadingAvatar(false);
      };
      reader.onerror = () => {
        setError('Error al cargar la imagen');
        setIsUploadingAvatar(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Error al cargar la imagen');
      setIsUploadingAvatar(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/auth/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profile),
      });

      if (response.ok) {
        await refreshUser();
        toast.success('Perfil actualizado correctamente');
      } else {
        const data = await readJsonRecord(response);
        throw new Error(readErrorMessage(data, 'Error al actualizar el perfil'));
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      const message = error instanceof Error ? error.message : 'Error al actualizar el perfil';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Mi perfil</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary border border-border">
            <div
              className={cn(
                'w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center flex-shrink-0',
                profile.avatarUrl ? 'bg-cover bg-center' : 'bg-primary/20'
              )}
              style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : {}}
            >
              {!profile.avatarUrl && (
                <span className="text-xl sm:text-2xl font-semibold text-primary">
                  {(user?.firstName?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm sm:text-base truncate">{user?.email}</p>
              {user?.isSuperAdmin && (
                <p className="text-sm text-muted-foreground">Super Admin</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-3">Foto de perfil</label>
            <div className="flex items-center gap-4">
              <div
                onClick={() => avatarRef.current?.click()}
                className={cn(
                  'w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all',
                  'border-2 border-dashed border-border hover:border-primary/50',
                  profile.avatarUrl ? 'bg-cover bg-center' : 'bg-secondary'
                )}
                style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : {}}
              >
                {!profile.avatarUrl && (
                  isUploadingAvatar ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  ) : (
                    <User className="w-8 h-8 text-muted-foreground" />
                  )
                )}
              </div>
              <div className="flex-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => avatarRef.current?.click()}
                  isLoading={isUploadingAvatar}
                >
                  {profile.avatarUrl ? 'Cambiar' : 'Subir'}
                </Button>
                {profile.avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setProfile((p) => ({ ...p, avatarUrl: null }))}
                    className="ml-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    Eliminar
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG. Max 2MB</p>
              </div>
              <input
                ref={avatarRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarUpload(file);
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Nombre"
              value={profile.firstName}
              onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
            />
            <Input
              label="Apellido"
              value={profile.lastName}
              onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
            />
          </div>

          <Input label="Email" value={user?.email || ''} disabled hint="El email no se puede cambiar" />

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <Button onClick={() => { void handleSave(); }} isLoading={isLoading}>
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS SETTINGS (Commerce only)
// ═══════════════════════════════════════════════════════════════════════════════

interface BusinessProfile {
  companyLogo: string | null;
  businessName: string;
  whatsappContact: string;
  onlineStoreEnabled: boolean;
  onlineStoreUrl: string;
  ownerAgentEnabled: boolean;
  ownerAgentNumber: string;
  ownerAgentPinRequired: boolean;
  ownerAgentPinConfigured: boolean;
  ownerAgentPin: string;
  paymentAlias: string;
  paymentCbu: string;
  businessAddress: string;
  vatConditionId: string;
  monotributoCategory: string;
  monotributoActivity: 'services' | 'goods';
  availabilityStatus: 'available' | 'unavailable' | 'vacation';
  workingDays: string[];
  continuousHours: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  morningShiftStart: string;
  morningShiftEnd: string;
  afternoonShiftStart: string;
  afternoonShiftEnd: string;
  assistantNotes: string;
}

const DAYS = [
  { id: 'lun', label: 'Lun' },
  { id: 'mar', label: 'Mar' },
  { id: 'mie', label: 'Mie' },
  { id: 'jue', label: 'Jue' },
  { id: 'vie', label: 'Vie' },
  { id: 'sab', label: 'Sab' },
  { id: 'dom', label: 'Dom' },
];

const IVA_CONDITIONS = [
  { value: '1', label: 'Responsable inscripto' },
  { value: '4', label: 'Sujeto exento' },
  { value: '5', label: 'Consumidor final' },
  { value: '6', label: 'Responsable monotributo' },
  { value: '7', label: 'Sujeto no categorizado' },
  { value: '8', label: 'Proveedor del exterior' },
  { value: '9', label: 'Cliente del exterior' },
  { value: '10', label: 'IVA liberado' },
  { value: '13', label: 'Monotributista social' },
  { value: '15', label: 'IVA no alcanzado' },
  { value: '16', label: 'Monotributo trabajador independiente promovido' },
];

const MONOTRIBUTO_CATEGORIES = [
  { value: 'A', label: 'Categoría A' },
  { value: 'B', label: 'Categoría B' },
  { value: 'C', label: 'Categoría C' },
  { value: 'D', label: 'Categoría D' },
  { value: 'E', label: 'Categoría E' },
  { value: 'F', label: 'Categoría F' },
  { value: 'G', label: 'Categoría G' },
  { value: 'H', label: 'Categoría H' },
  { value: 'I', label: 'Categoría I' },
  { value: 'J', label: 'Categoría J' },
  { value: 'K', label: 'Categoría K' },
];

function BusinessSettings(): JSX.Element {
  const { workspace, refreshUser } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const canUseOwnerWhatsappAgent = capabilities.showOwnerWhatsappAgentSettings;
  const canUseBusinessInvoicingSettings = capabilities.showBusinessInvoicingSettings;
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const companyLogoRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [profile, setProfile] = useState<BusinessProfile>({
    companyLogo: null,
    businessName: '',
    whatsappContact: '',
    onlineStoreEnabled: false,
    onlineStoreUrl: '',
    ownerAgentEnabled: false,
    ownerAgentNumber: '',
    ownerAgentPinRequired: false,
    ownerAgentPinConfigured: false,
    ownerAgentPin: '',
    paymentAlias: '',
    paymentCbu: '',
    businessAddress: '',
    vatConditionId: '',
    monotributoCategory: '',
    monotributoActivity: 'services',
    availabilityStatus: 'available',
    workingDays: [...DEFAULT_WORKING_DAYS],
    continuousHours: true,
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    morningShiftStart: '09:00',
    morningShiftEnd: '13:00',
    afternoonShiftStart: '14:00',
    afternoonShiftEnd: '18:00',
    assistantNotes: '',
  });

  const isMonotributo = ['6', '13', '16'].includes(profile.vatConditionId);
  const pinConfiguredAndEmpty = profile.ownerAgentPinConfigured && !profile.ownerAgentPin;

  // Load existing settings
  useEffect(() => {
    if (!workspace?.id) return;

    const loadSettings = async (): Promise<void> => {
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });

        if (res.ok) {
          const data = await readJsonRecord(res);
          const workspaceData = readRecord(data, 'workspace');
          const settings = readRecord(workspaceData, 'settings');
          const ownerAgentPinHash = readString(settings, 'ownerAgentPinHash');
          const availabilityValue = readString(settings, 'availabilityStatus');
          const availabilityStatus: BusinessProfile['availabilityStatus'] =
            availabilityValue === 'unavailable' || availabilityValue === 'vacation'
              ? availabilityValue
              : 'available';
          setProfile((prev) => ({
            ...prev,
            companyLogo: readString(settings, 'companyLogo') ?? null,
            businessName: readString(settings, 'businessName') ?? '',
            whatsappContact: sanitizeWhatsappContactInput(readString(settings, 'whatsappContact') ?? ''),
            onlineStoreEnabled: readBoolean(settings, 'onlineStoreEnabled', false),
            onlineStoreUrl: readString(settings, 'onlineStoreUrl') ?? '',
            ownerAgentEnabled: readBoolean(settings, 'ownerAgentEnabled', false),
            ownerAgentNumber: readString(settings, 'ownerAgentNumber') ?? '',
            ownerAgentPinRequired: ownerAgentPinHash !== undefined,
            ownerAgentPinConfigured: ownerAgentPinHash !== undefined,
            ownerAgentPin: '',
            paymentAlias: readString(settings, 'paymentAlias') ?? '',
            paymentCbu: readString(settings, 'paymentCbu') ?? '',
            businessAddress: readString(settings, 'businessAddress') ?? '',
            vatConditionId: readString(settings, 'vatConditionId') ?? '',
            monotributoCategory: readString(settings, 'monotributoCategory') ?? '',
            monotributoActivity:
              readString(settings, 'monotributoActivity') === 'goods' ? 'goods' : 'services',
            availabilityStatus,
            workingDays: readStringList(settings, 'workingDays', DEFAULT_WORKING_DAYS),
            continuousHours: readBoolean(settings, 'continuousHours', true),
            workingHoursStart: readString(settings, 'workingHoursStart') ?? '09:00',
            workingHoursEnd: readString(settings, 'workingHoursEnd') ?? '18:00',
            morningShiftStart: readString(settings, 'morningShiftStart') ?? '09:00',
            morningShiftEnd: readString(settings, 'morningShiftEnd') ?? '13:00',
            afternoonShiftStart: readString(settings, 'afternoonShiftStart') ?? '14:00',
            afternoonShiftEnd: readString(settings, 'afternoonShiftEnd') ?? '18:00',
            assistantNotes: readString(settings, 'assistantNotes') ?? '',
          }));
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, [workspace?.id]);

  useEffect(() => {
    if (isMonotributo) return;
    if (profile.monotributoCategory || profile.monotributoActivity !== 'services') {
      setProfile((prev) => ({
        ...prev,
        monotributoCategory: '',
        monotributoActivity: 'services',
      }));
    }
  }, [isMonotributo, profile.monotributoActivity, profile.monotributoCategory]);

  const handleImageUpload = (
    file: File,
    type: 'companyLogo'
  ): void => {
    setUploadingLogo(true);
    setError('');

    try {
      // For now, convert to base64 data URL (in production, upload to S3/Cloudflare)
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile((prev) => ({ ...prev, [type]: reader.result as string }));
        setUploadingLogo(false);
      };
      reader.onerror = () => {
        setError('Error al cargar la imagen');
        setUploadingLogo(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Error al cargar la imagen');
      setUploadingLogo(false);
    }
  };

  const toggleDay = (day: string): void => {
    setProfile((prev) => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter((d) => d !== day)
        : [...prev.workingDays, day],
    }));
  };

  const handleSave = async (): Promise<void> => {
    if (!workspace?.id) return;

    setIsSaving(true);
    setError('');

    try {
      const normalizedWhatsappContact = sanitizeWhatsappContactInput(profile.whatsappContact);
      if (!isValidWhatsappContact(normalizedWhatsappContact)) {
        throw new Error('Ingresá un WhatsApp de contacto válido (8 a 15 dígitos, opcional + al inicio).');
      }
      const normalizedOnlineStoreUrl = profile.onlineStoreUrl.trim();
      if (normalizedOnlineStoreUrl && !isValidOnlineStoreUrl(normalizedOnlineStoreUrl)) {
        throw new Error('Ingresá una URL de tienda online válida (dominio o URL http/https).');
      }

      const payload: Record<string, unknown> = {
        ...profile,
        whatsappContact: normalizedWhatsappContact,
        onlineStoreUrl: normalizedOnlineStoreUrl || null,
        vatConditionId: profile.vatConditionId || null,
      };

      // UI-only fields
      delete payload.ownerAgentPinRequired;
      delete payload.ownerAgentPinConfigured;

      if (canUseOwnerWhatsappAgent) {
        const pin = profile.ownerAgentPin.trim();
        const wantsPin = profile.ownerAgentEnabled && profile.ownerAgentPinRequired;
        if (!wantsPin) {
          payload.ownerAgentPin = null;
        } else if (pin) {
          payload.ownerAgentPin = pin;
        } else {
          delete payload.ownerAgentPin;
          if (!profile.ownerAgentPinConfigured) {
            throw new Error('Ingresá un PIN para activar el modo dueño con PIN.');
          }
        }
      } else {
        delete payload.ownerAgentEnabled;
        delete payload.ownerAgentNumber;
        delete payload.ownerAgentPin;
      }

      if (!canUseBusinessInvoicingSettings) {
        delete payload.vatConditionId;
        delete payload.monotributoCategory;
        delete payload.monotributoActivity;
      } else if (!profile.monotributoCategory) {
        delete payload.monotributoCategory;
        delete payload.monotributoActivity;
      }

      const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al guardar'));
      }

      setProfile((prev) => {
        const clearedPin = { ...prev, ownerAgentPin: '' };
        if (!canUseOwnerWhatsappAgent) {
          return clearedPin;
        }
        const pin = prev.ownerAgentPin.trim();
        if (!prev.ownerAgentEnabled || !prev.ownerAgentPinRequired) {
          return { ...clearedPin, ownerAgentPinConfigured: false };
        }
        if (pin) {
          return { ...clearedPin, ownerAgentPinConfigured: true };
        }
        return clearedPin;
      });

      await refreshUser();
      toast.success('Cambios guardados');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar';
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <div className="animate-pulse h-5 w-40 rounded-lg bg-secondary" />
            </div>
            <div className="p-5 space-y-4">
              <div className="animate-pulse h-10 w-full rounded-xl bg-secondary" />
              <div className="animate-pulse h-10 w-full rounded-xl bg-secondary" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Images section */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Imagenes del negocio</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Estas imagenes seran visibles para tus clientes y el agente IA
          </p>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Company Logo */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-3">
                Logo de la empresa
              </label>
              <div className="flex items-center gap-4">
                <div
                  onClick={() => companyLogoRef.current?.click()}
                  className={cn(
                    'w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all',
                    'border-2 border-dashed border-border hover:border-primary/50',
                    profile.companyLogo ? 'bg-cover bg-center' : 'bg-secondary'
                  )}
                  style={profile.companyLogo ? { backgroundImage: `url(${profile.companyLogo})` } : {}}
                >
                  {!profile.companyLogo && (
                    uploadingLogo ? (
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    ) : (
                      <Building2 className="w-8 h-8 text-muted-foreground" />
                    )
                  )}
                </div>
                <div className="flex-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => companyLogoRef.current?.click()}
                    isLoading={uploadingLogo}
                  >
                    {profile.companyLogo ? 'Cambiar' : 'Subir'}
                  </Button>
                  {profile.companyLogo && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProfile((p) => ({ ...p, companyLogo: null }))}
                      className="ml-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      Eliminar
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Aparece en PDFs del catalogo</p>
                </div>
                <input
                  ref={companyLogoRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file, 'companyLogo');
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contact & Payment section */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Contacto y pagos</h3>
        </div>
        <div className="p-5 space-y-4">
          <Input
            label="Nombre del negocio"
            placeholder="Mi comercio"
            value={profile.businessName}
            onChange={(e) => setProfile((p) => ({ ...p, businessName: e.target.value }))}
            hint="Se usa en los saludos y mensajes del agente"
          />
          <div className="pt-2 border-t border-border/50 space-y-3">
            <Switch
              label="Mostrar tienda online en el menú del bot"
              description="Si está activo, el bot mostrará el link de tu tienda debajo del menú principal."
              checked={profile.onlineStoreEnabled}
              onChange={(e) => setProfile((p) => ({ ...p, onlineStoreEnabled: e.target.checked }))}
            />
            <Input
              label="URL de la tienda online"
              placeholder="https://mitienda.com"
              value={profile.onlineStoreUrl}
              onChange={(e) => setProfile((p) => ({ ...p, onlineStoreUrl: e.target.value }))}
              hint="Podés pegar dominio o URL completa. Ejemplo: mitienda.com"
              disabled={!profile.onlineStoreEnabled}
              inputMode="url"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="WhatsApp de contacto"
              placeholder="+54 11 1234-5678"
              value={profile.whatsappContact}
              onChange={(e) =>
                setProfile((p) => ({
                  ...p,
                  whatsappContact: sanitizeWhatsappContactInput(e.target.value),
                }))
              }
              inputMode="tel"
              maxLength={WHATSAPP_CONTACT_MAX_LENGTH}
              pattern="^\\+?\\d{8,15}$"
              title="Ingresá un teléfono válido (8 a 15 dígitos, opcional + al inicio)."
              hint="Formato: +5491112345678 (8 a 15 dígitos)"
            />
            <Input
              label="Alias"
              placeholder="mi.negocio.mp"
              value={profile.paymentAlias}
              onChange={(e) => setProfile((p) => ({ ...p, paymentAlias: e.target.value }))}
              hint="Alias para transferencias"
            />
          </div>
          {canUseOwnerWhatsappAgent && (
            <div className="pt-2 border-t border-border/50 space-y-3">
              <Switch
                label="Agente para dueño por WhatsApp (pago)"
                description="Permite que este número consulte datos del dashboard por WhatsApp."
                checked={profile.ownerAgentEnabled}
                onChange={(e) => setProfile((p) => ({ ...p, ownerAgentEnabled: e.target.checked }))}
              />
              <Input
                label="Número para hablar con el agente"
                placeholder="+54 11 1234-5678"
                value={profile.ownerAgentNumber}
                onChange={(e) => setProfile((p) => ({ ...p, ownerAgentNumber: e.target.value }))}
                hint="Debe ser el número del dueño en formato E.164. Solo funciona si la feature está activada."
                disabled={!profile.ownerAgentEnabled}
              />
              <Switch
                label="Requerir PIN para modo dueño"
                description={
                  profile.ownerAgentPinConfigured
                    ? 'PIN configurado. Para cambiarlo, ingresá uno nuevo y guardá.'
                    : 'Se pedirá PIN por WhatsApp para acceder a consultas del dashboard.'
                }
                checked={profile.ownerAgentPinRequired}
                onChange={(e) => setProfile((p) => ({ ...p, ownerAgentPinRequired: e.target.checked }))}
                disabled={!profile.ownerAgentEnabled}
              />
              <Input
                label="PIN"
                type="password"
                inputMode="numeric"
                placeholder={pinConfiguredAndEmpty ? 'PIN configurado' : '4 a 12 dígitos'}
                value={profile.ownerAgentPin}
                onChange={(e) => setProfile((p) => ({ ...p, ownerAgentPin: e.target.value }))}
                hint={
                  pinConfiguredAndEmpty
                    ? 'PIN configurado (no se muestra por seguridad). Para cambiarlo, ingresá uno nuevo y guardá. Para autenticarte por WhatsApp: PIN 1234.'
                    : 'Para autenticarte, enviá por WhatsApp: PIN 1234 (reemplazá 1234 por tu PIN).'
                }
                disabled={!profile.ownerAgentEnabled || !profile.ownerAgentPinRequired}
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Direccion del negocio"
              placeholder="Av. Corrientes 1234, CABA"
              value={profile.businessAddress}
              onChange={(e) => setProfile((p) => ({ ...p, businessAddress: e.target.value }))}
              hint="El agente podra compartir esta direccion"
            />
            <Input
              label="CBU"
              placeholder="0000003100000000000000"
              value={profile.paymentCbu}
              onChange={(e) => setProfile((p) => ({ ...p, paymentCbu: e.target.value }))}
              hint="CBU para transferencias"
            />
          </div>
        </div>
      </div>

      {canUseBusinessInvoicingSettings && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold text-foreground">Facturación</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Usamos esta condición para determinar el tipo de factura que podés emitir.
            </p>
          </div>
          <div className="p-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Condición frente al IVA del comercio
              </label>
              <Select
                value={profile.vatConditionId}
                onValueChange={(value) => setProfile((prev) => ({ ...prev, vatConditionId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná la condición frente al IVA" />
                </SelectTrigger>
                <SelectContent>
                  {IVA_CONDITIONS.map((condition) => (
                    <SelectItem key={condition.value} value={condition.value}>
                      {condition.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Si emitís Factura C (monotributo), esta condición suele ser &quot;Responsable monotributo&quot;.
              </p>
            </div>

            {isMonotributo && (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Categoría de monotributo
                  </label>
                  <Select
                    value={profile.monotributoCategory}
                    onValueChange={(value) => setProfile((prev) => ({ ...prev, monotributoCategory: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccioná la categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONOTRIBUTO_CATEGORIES.map((category) => (
                        <SelectItem key={category.value} value={category.value}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Se usa para calcular tus topes mensuales y anuales.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Actividad principal
                  </label>
                  <Select
                    value={profile.monotributoActivity}
                    onValueChange={(value) =>
                      setProfile((prev) => ({ ...prev, monotributoActivity: value as 'services' | 'goods' }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccioná la actividad" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="services">Servicios</SelectItem>
                      <SelectItem value="goods">Bienes</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Define el tope correcto para tu categoría.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Availability section */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Disponibilidad del negocio</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Esto define como responde el bot de WhatsApp
          </p>
        </div>
        <div className="p-5">
          {/*
            For perfect shape consistency across icons, use an explicit box style
            instead of relying on Tailwind sizing/rounding alone.
          */}
          {(() => {
            const iconBoxStyle = {
              width: 36,
              height: 36,
              borderRadius: 12,
              flex: '0 0 36px',
            } as const;

            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'available',
                    label: 'Disponible',
                    description: 'El bot responde normalmente.',
                    Icon: Check,
                    selectedClasses: 'border-emerald-500/40 bg-emerald-500/10',
                    unselectedClasses: 'border-border bg-secondary/40 hover:border-emerald-500/40',
                    iconStyle: {
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                    },
                  },
                  {
                    id: 'unavailable',
                    label: 'No disponible',
                    description: 'El bot responde que no esta disponible.',
                    Icon: Ban,
                    selectedClasses: 'border-red-500/40 bg-red-500/10',
                    unselectedClasses: 'border-border bg-secondary/40 hover:border-red-500/40',
                    iconStyle: {
                      backgroundColor: 'rgba(239, 68, 68, 0.2)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                    },
                  },
                  {
                    id: 'vacation',
                    label: 'Vacaciones',
                    description: 'El bot responde que estan de vacaciones.',
                    Icon: Info,
                    selectedClasses: 'border-yellow-500/40 bg-yellow-500/10',
                    unselectedClasses: 'border-border bg-secondary/40 hover:border-yellow-500/40',
                    iconStyle: {
                      backgroundColor: 'rgba(234, 179, 8, 0.2)',
                      color: '#eab308',
                      border: '1px solid rgba(234, 179, 8, 0.35)',
                    },
                  },
                ].map((option) => {
                  const selected = profile.availabilityStatus === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setProfile((prev) => ({
                          ...prev,
                          availabilityStatus: option.id as BusinessProfile['availabilityStatus'],
                        }))
                      }
                      aria-pressed={selected}
                      className={cn(
                        'p-4 rounded-xl border text-left transition-all',
                        selected ? option.selectedClasses : option.unselectedClasses,
                        selected ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex items-center justify-center"
                          style={{ ...iconBoxStyle, ...option.iconStyle }}
                        >
                          <option.Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{option.label}</p>
                          <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Working Hours section */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Horarios de atencion</h3>
          <p className="text-sm text-muted-foreground mt-1">
            El agente IA informara estos horarios a los clientes
          </p>
        </div>
        <div className="p-5 space-y-6">
          {/* Working Days */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-3">
              Dias de atencion
            </label>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {DAYS.map((day) => (
                <button
                  key={day.id}
                  onClick={() => toggleDay(day.id)}
                  className={cn(
                    'w-10 h-9 sm:w-12 sm:h-10 rounded-xl text-xs sm:text-sm font-medium transition-all',
                    profile.workingDays.includes(day.id)
                      ? 'bg-primary text-white'
                      : 'bg-secondary text-muted-foreground hover:bg-secondary-strong'
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hours Type Toggle */}
          <Switch
            label="Horario corrido"
            description="Trabajo todo el dia sin corte"
            checked={profile.continuousHours}
            onChange={(e) => setProfile((p) => ({ ...p, continuousHours: e.target.checked }))}
          />

          {/* Hours inputs */}
          {profile.continuousHours ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Desde</label>
                <input
                  type="time"
                  value={profile.workingHoursStart}
                  onChange={(e) => setProfile((p) => ({ ...p, workingHoursStart: e.target.value }))}
                  className="w-full h-10 px-4 rounded-xl bg-background border border-input text-foreground text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring hover:border-muted-foreground/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Hasta</label>
                <input
                  type="time"
                  value={profile.workingHoursEnd}
                  onChange={(e) => setProfile((p) => ({ ...p, workingHoursEnd: e.target.value }))}
                  className="w-full h-10 px-4 rounded-xl bg-background border border-input text-foreground text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring hover:border-muted-foreground/30"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-secondary border border-border">
                <p className="text-sm font-medium text-foreground mb-3">Turno manana</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Desde</label>
                    <input
                      type="time"
                      value={profile.morningShiftStart}
                      onChange={(e) => setProfile((p) => ({ ...p, morningShiftStart: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl bg-background border border-input text-foreground text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring hover:border-muted-foreground/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Hasta</label>
                    <input
                      type="time"
                      value={profile.morningShiftEnd}
                      onChange={(e) => setProfile((p) => ({ ...p, morningShiftEnd: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl bg-background border border-input text-foreground text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring hover:border-muted-foreground/30"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-secondary border border-border">
                <p className="text-sm font-medium text-foreground mb-3">Turno tarde</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Desde</label>
                    <input
                      type="time"
                      value={profile.afternoonShiftStart}
                      onChange={(e) => setProfile((p) => ({ ...p, afternoonShiftStart: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl bg-background border border-input text-foreground text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring hover:border-muted-foreground/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Hasta</label>
                    <input
                      type="time"
                      value={profile.afternoonShiftEnd}
                      onChange={(e) => setProfile((p) => ({ ...p, afternoonShiftEnd: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl bg-background border border-input text-foreground text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring hover:border-muted-foreground/30"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assistant Notes section */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground">Notas para el asistente IA</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Instrucciones especiales que el agente tendra en cuenta al responder
          </p>
        </div>
        <div className="p-5">
          <Textarea
            value={profile.assistantNotes}
            onChange={(e) => setProfile((p) => ({ ...p, assistantNotes: e.target.value }))}
            placeholder="Ej: Siempre ofrecer envio gratis en compras mayores a $50.000. No aceptamos pagos en efectivo..."
            rows={4}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {profile.assistantNotes.length}/2000 caracteres
          </p>
        </div>
      </div>

      {/* Save button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}
        <Button onClick={() => { void handleSave(); }} isLoading={isSaving} className="w-full sm:w-auto sm:ml-auto">
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATIONS (WhatsApp + MercadoPago)
// ═══════════════════════════════════════════════════════════════════════════════

interface WhatsAppNumberInfo {
  id: string;
  phoneNumber: string;
  displayName: string;
  provider?: string;
  status?: string;
  healthStatus?: string;
  isActive?: boolean;
}

interface MPStatus {
  connected: boolean;
  status: string;
  externalUserId?: string;
  externalEmail?: string;
  connectedAt?: string;
  tokenExpiresAt?: string;
  stats?: {
    linksGenerated: number;
    paymentsReceived: number;
    amountCollected: number;
  };
}

interface ArcaStatus {
  connected: boolean;
  status: string;
  cuit?: string;
  environment?: string;
  pointOfSale?: number;
  connectedAt?: string;
  tokenExpiresAt?: string;
  lastError?: string;
  csr?: string;
  csrGeneratedAt?: string;
}

function parseWhatsAppNumberInfo(value: unknown): WhatsAppNumberInfo | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    id: readString(record, 'id') ?? '',
    phoneNumber: readString(record, 'phoneNumber') ?? '',
    displayName: readString(record, 'displayName') ?? '',
    provider: readString(record, 'provider'),
    status: readString(record, 'status'),
    healthStatus: readString(record, 'healthStatus'),
    isActive: readBoolean(record, 'isActive', false),
  };
}

function parseMpStatus(value: unknown): MPStatus | null {
  const record = asRecord(value);
  if (!record) return null;

  const statsRecord = readRecord(record, 'stats');
  const linksGenerated = readNumber(statsRecord, 'linksGenerated');
  const paymentsReceived = readNumber(statsRecord, 'paymentsReceived');
  const amountCollected = readNumber(statsRecord, 'amountCollected');

  return {
    connected: readBoolean(record, 'connected', false),
    status: readString(record, 'status') ?? 'disconnected',
    externalUserId: readString(record, 'externalUserId'),
    externalEmail: readString(record, 'externalEmail'),
    connectedAt: readString(record, 'connectedAt'),
    tokenExpiresAt: readString(record, 'tokenExpiresAt'),
    stats:
      linksGenerated !== undefined && paymentsReceived !== undefined && amountCollected !== undefined
        ? {
          linksGenerated,
          paymentsReceived,
          amountCollected,
        }
        : undefined,
  };
}

function parseArcaStatus(value: unknown): ArcaStatus | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    connected: readBoolean(record, 'connected', false),
    status: readString(record, 'status') ?? 'disconnected',
    cuit: readString(record, 'cuit'),
    environment: readString(record, 'environment'),
    pointOfSale: readNumber(record, 'pointOfSale'),
    connectedAt: readString(record, 'connectedAt'),
    tokenExpiresAt: readString(record, 'tokenExpiresAt'),
    lastError: readString(record, 'lastError'),
    csr: readString(record, 'csr'),
    csrGeneratedAt: readString(record, 'csrGeneratedAt'),
  };
}

function ApplicationsSettings(): JSX.Element {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const canUseArca = capabilities.showArcaIntegration;
  const canUseMercadoPago = capabilities.showMercadoPagoIntegration;
  const toast = useToast();
  const [searchParams] = useSearchParams();

  // WhatsApp state
  const [connectedNumber, setConnectedNumber] = useState<WhatsAppNumberInfo | null>(null);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [isEvolutionEnabled, setIsEvolutionEnabled] = useState(true);
  const [isLoadingWA, setIsLoadingWA] = useState(true);
  const [isConnectingWA, setIsConnectingWA] = useState(false);
  const [isGeneratingEvolutionQr, setIsGeneratingEvolutionQr] = useState(false);
  const [evolutionQrDataUrl, setEvolutionQrDataUrl] = useState<string>('');
  const [evolutionPairingCode, setEvolutionPairingCode] = useState<string>('');
  const [evolutionState, setEvolutionState] = useState<string>('');
  const evolutionPollRef = useRef<number | null>(null);
  const evolutionQrRef = useRef<string>('');
  const [waError, setWaError] = useState('');

  // MercadoPago state
  const [mpStatus, setMpStatus] = useState<MPStatus | null>(null);
  const [isLoadingMP, setIsLoadingMP] = useState(true);
  const [isConnectingMP, setIsConnectingMP] = useState(false);
  const [mpError, setMpError] = useState('');
  const [mpSuccess, setMpSuccess] = useState('');

  // ARCA state
  const [arcaStatus, setArcaStatus] = useState<ArcaStatus | null>(null);
  const [isLoadingArca, setIsLoadingArca] = useState(true);
  const [isConnectingArca, setIsConnectingArca] = useState(false);
  const [arcaError, setArcaError] = useState('');
  const [showArcaModal, setShowArcaModal] = useState(false);
  const [isGeneratingCsr, setIsGeneratingCsr] = useState(false);
  const [arcaCsr, setArcaCsr] = useState('');
  const [arcaCsrCopied, setArcaCsrCopied] = useState(false);
  const [arcaForm, setArcaForm] = useState({
    cuit: '',
    pointOfSale: '1',
    certificate: '',
    environment: 'test',
  });

  // Check for OAuth callback result
  useEffect(() => {
    const mpConnected = searchParams.get('mp_connected');
    const mpErrorParam = searchParams.get('mp_error');

    if (!canUseMercadoPago) {
      if (mpConnected || mpErrorParam) {
        window.history.replaceState({}, '', '/settings/applications');
      }
      return;
    }

    if (mpConnected === 'true') {
      setMpSuccess('MercadoPago conectado exitosamente');
      setTimeout(() => setMpSuccess(''), 5000);
      // Remove params from URL
      window.history.replaceState({}, '', '/settings/applications');
    } else if (mpErrorParam) {
      setMpError(`Error al conectar MercadoPago: ${mpErrorParam}`);
      window.history.replaceState({}, '', '/settings/applications');
    }
  }, [canUseMercadoPago, searchParams]);

  // Fetch WhatsApp data
  useEffect(() => {
    if (!workspace?.id) return;

    const fetchWhatsApp = async (): Promise<void> => {
      setIsLoadingWA(true);
      try {
        const headers = {
          'X-Workspace-Id': workspace.id,
        };

        const [connectedRes, providersRes] = await Promise.all([
          fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/whatsapp-numbers`, { headers }),
          fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/whatsapp/providers`, { headers }),
        ]);

        if (connectedRes.ok) {
          const data = await readJsonRecord(connectedRes);
          setConnectedNumber(parseWhatsAppNumberInfo(data.number));
        }
        if (providersRes.ok) {
          const data = await readJsonRecord(providersRes);
          const providers = asRecordList(data.providers);
          setIsEvolutionEnabled(
            providers.some((provider) => {
              const id = readString(provider, 'id') ?? '';
              const enabled = readBoolean(provider, 'enabled', false);
              return id.toLowerCase() === 'evolution' && enabled;
            })
          );
        }
      } catch (err) {
        console.error('Failed to fetch WhatsApp:', err);
      } finally {
        setIsLoadingWA(false);
      }
    };

    void fetchWhatsApp();
  }, [workspace?.id]);

  // Fetch MercadoPago status
  useEffect(() => {
    if (!workspace?.id || !canUseMercadoPago) {
      setIsLoadingMP(false);
      setMpStatus(null);
      return;
    }

    const fetchMPStatus = async (): Promise<void> => {
      setIsLoadingMP(true);
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/mercadopago/status`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });
        if (res.ok) {
          const data = await readJsonRecord(res);
          setMpStatus(parseMpStatus(data));
        }
      } catch (err) {
        console.error('Failed to fetch MP status:', err);
      } finally {
        setIsLoadingMP(false);
      }
    };

    void fetchMPStatus();
  }, [canUseMercadoPago, workspace?.id]);

  // Fetch ARCA status
  useEffect(() => {
    if (!workspace?.id || !canUseArca) {
      setIsLoadingArca(false);
      return;
    }

    const fetchArcaStatus = async (): Promise<void> => {
      setIsLoadingArca(true);
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/arca/status`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });
        if (res.ok) {
          const data = await readJsonRecord(res);
          const status = parseArcaStatus(data);
          setArcaStatus(status);
          if (status?.csr) {
            setArcaCsr(status.csr);
          }
          if (status?.cuit) {
            setArcaForm((prev) => ({ ...prev, cuit: status.cuit ?? prev.cuit }));
          }
          if (status?.pointOfSale !== undefined) {
            setArcaForm((prev) => ({ ...prev, pointOfSale: String(status.pointOfSale) }));
          }
          const environment = status?.environment;
          if (environment) {
            setArcaForm((prev) => ({ ...prev, environment }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch ARCA status:', err);
      } finally {
        setIsLoadingArca(false);
      }
    };

    void fetchArcaStatus();
  }, [canUseArca, workspace?.id]);

  // WhatsApp handlers
  const handleDisconnectWA = async (): Promise<void> => {
    if (!connectedNumber || !workspace?.id) return;
    setIsConnectingWA(true);
    setWaError('');

    try {
      const provider = (connectedNumber.provider || 'infobip').toLowerCase();
      const url =
        provider === 'evolution'
          ? `${API_URL}/api/v1/workspaces/${workspace.id}/whatsapp/evolution/disconnect`
          : `${API_URL}/api/v1/workspaces/${workspace.id}/whatsapp-numbers/release`;

      const res = await fetchWithCredentials(url, {
        method: 'POST',
        headers: {
          'X-Workspace-Id': workspace.id,
        },
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al desconectar'));
      }

      setConnectedNumber(null);
      setEvolutionQrDataUrl('');
      setEvolutionPairingCode('');
      setEvolutionState('');
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Error al desconectar');
    } finally {
      setIsConnectingWA(false);
    }
  };

  const stopEvolutionPolling = (): void => {
    if (evolutionPollRef.current) {
      window.clearInterval(evolutionPollRef.current);
      evolutionPollRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopEvolutionPolling();
    };
  }, []);

  useEffect(() => {
    evolutionQrRef.current = evolutionQrDataUrl;
  }, [evolutionQrDataUrl]);

  const handleConnectEvolution = async (): Promise<void> => {
    if (!workspace?.id) return;
    stopEvolutionPolling();
    setIsGeneratingEvolutionQr(true);
    setIsConnectingWA(true);
    setWaError('');
    setEvolutionQrDataUrl('');
    setEvolutionPairingCode('');
    setEvolutionState('connecting');

    try {
      const res = await fetchWithCredentials(
        `${API_URL}/api/v1/workspaces/${workspace.id}/whatsapp/evolution/connect`,
        {
          method: 'POST',
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        }
      );

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al conectar Evolution'));
      }

      const data = await readJsonRecord(res);
      const qrCode = (readString(data, 'qrCode') ?? '').trim();
      const qrDataUrl = (readString(data, 'qrDataUrl') ?? '').trim();
      const pairingCode = (readString(data, 'pairingCode') ?? '').trim();

      setEvolutionPairingCode(pairingCode);

      if (qrDataUrl) {
        setEvolutionQrDataUrl(qrDataUrl);
      } else if (qrCode) {
        const QRCode = await import('qrcode');
        const dataUrl = await QRCode.toDataURL(qrCode, { margin: 1, width: 280 });
        setEvolutionQrDataUrl(dataUrl);
      }

      const poll = async (): Promise<void> => {
        const statusRes = await fetchWithCredentials(
          `${API_URL}/api/v1/workspaces/${workspace.id}/whatsapp/evolution/status`,
          {
            headers: { 'X-Workspace-Id': workspace.id },
          }
        );

        if (!statusRes.ok) return;
        const status = await readJsonRecord(statusRes);
        setEvolutionState((readString(status, 'state') ?? '').trim());

        const pairingCodeFromStatus = (readString(status, 'pairingCode') ?? '').trim();
        if (pairingCodeFromStatus) {
          setEvolutionPairingCode(pairingCodeFromStatus);
        }

        const qrDataUrlFromStatus = (readString(status, 'qrDataUrl') ?? '').trim();
        if (qrDataUrlFromStatus && qrDataUrlFromStatus !== evolutionQrRef.current) {
          setEvolutionQrDataUrl(qrDataUrlFromStatus);
        }

        const qrCodeFromStatus = (readString(status, 'qrCode') ?? '').trim();
        if (qrCodeFromStatus && !qrDataUrlFromStatus) {
          try {
            const QRCode = await import('qrcode');
            const dataUrl = await QRCode.toDataURL(qrCodeFromStatus, { margin: 1, width: 280 });
            if (dataUrl !== evolutionQrRef.current) {
              setEvolutionQrDataUrl(dataUrl);
            }
          } catch {
            // ignore
          }
        }
        const connected = readBoolean(status, 'connected', false);
        const number = parseWhatsAppNumberInfo(status.number);
        if (connected && number) {
          setConnectedNumber(number);
          setShowSelectModal(false);
          setEvolutionQrDataUrl('');
          setEvolutionPairingCode('');
          stopEvolutionPolling();
        }
      };

      await poll();
      evolutionPollRef.current = window.setInterval(() => {
        poll().catch(() => {});
      }, 2000);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Error al conectar Evolution');
    } finally {
      setIsGeneratingEvolutionQr(false);
      setIsConnectingWA(false);
    }
  };

  // MercadoPago handlers
  const handleConnectMP = async (): Promise<void> => {
    if (!workspace?.id) {
      setMpError('No hay negocio seleccionado');
      return;
    }

    setIsConnectingMP(true);
    setMpError('');

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/mercadopago/auth-url`, {
        headers: {
          'X-Workspace-Id': workspace.id,
        },
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al obtener URL de autorización'));
      }

      const data = await readJsonRecord(res);
      const url = readString(data, 'url');
      if (!url) {
        throw new Error('No se recibió URL de autorización');
      }
      window.location.href = url;
    } catch (err) {
      setMpError(err instanceof Error ? err.message : 'Error al conectar');
      setIsConnectingMP(false);
    }
  };

  const handleDisconnectMP = async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsConnectingMP(true);
    setMpError('');

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/mercadopago`, {
        method: 'DELETE',
        headers: {
          'X-Workspace-Id': workspace.id,
        },
      });

      if (!res.ok) throw new Error('Error al desconectar');

      setMpStatus({ connected: false, status: 'disconnected' });
    } catch (err) {
      setMpError(err instanceof Error ? err.message : 'Error al desconectar');
    } finally {
      setIsConnectingMP(false);
    }
  };

  const handleConnectArca = async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsConnectingArca(true);
    setArcaError('');

    try {
      const payload: Record<string, unknown> = {
        cuit: arcaForm.cuit.trim(),
        pointOfSale: Number(arcaForm.pointOfSale),
        certificate: arcaForm.certificate,
        environment: arcaForm.environment,
      };
      const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/arca/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al conectar ARCA'));
      }

      const data = await readJsonRecord(res);
      setArcaStatus(parseArcaStatus(data));
      setShowArcaModal(false);
    } catch (err) {
      setArcaError(err instanceof Error ? err.message : 'Error al conectar ARCA');
    } finally {
      setIsConnectingArca(false);
    }
  };

  const handleGenerateArcaCsr = async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsGeneratingCsr(true);
    setArcaError('');

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/arca/csr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify({
          cuit: arcaForm.cuit.trim(),
          pointOfSale: Number(arcaForm.pointOfSale),
          environment: arcaForm.environment,
        }),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al generar CSR'));
      }

      const data = await readJsonRecord(res);
      setArcaCsr(readString(data, 'csr') ?? '');
      toast.success('CSR generado correctamente');
    } catch (err) {
      setArcaError(err instanceof Error ? err.message : 'Error al generar CSR');
    } finally {
      setIsGeneratingCsr(false);
    }
  };

  const handleCopyArcaCsr = async (): Promise<void> => {
    if (!arcaCsr) return;
    try {
      await navigator.clipboard.writeText(arcaCsr);
      setArcaCsrCopied(true);
      setTimeout(() => setArcaCsrCopied(false), 2000);
    } catch {
      setArcaError('No se pudo copiar el CSR');
    }
  };

  const handleDownloadArcaCsr = (): void => {
    if (!arcaCsr) return;
    const blob = new Blob([arcaCsr], { type: 'application/pkcs10' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arca-${arcaForm.cuit || 'csr'}.csr`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDisconnectArca = async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsConnectingArca(true);
    setArcaError('');

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/integrations/arca`, {
        method: 'DELETE',
        headers: {
          'X-Workspace-Id': workspace.id,
        },
      });

      if (!res.ok) throw new Error('Error al desconectar ARCA');

      setArcaStatus({ connected: false, status: 'disconnected' });
    } catch (err) {
      setArcaError(err instanceof Error ? err.message : 'Error al desconectar ARCA');
    } finally {
      setIsConnectingArca(false);
    }
  };

  const isLoading = isLoadingWA || (canUseMercadoPago && isLoadingMP) || (canUseArca && isLoadingArca);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2].map((i) => (
          <div key={i} className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <div className="animate-pulse h-5 w-48 rounded-lg bg-secondary" />
            </div>
            <div className="p-5">
              <div className="animate-pulse h-16 w-full rounded-xl bg-secondary" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Global messages */}
      {canUseMercadoPago && mpSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          {mpSuccess}
        </div>
      )}

      {/* WhatsApp Section */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            WhatsApp Business
          </h3>
        </div>
        <div className="p-5">
          {waError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {waError}
            </div>
          )}

          {connectedNumber ? (
            connectedNumber.isActive ? (
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-emerald-400">Conectado</p>
                    <p className="text-sm font-mono text-foreground/80 truncate">{connectedNumber.phoneNumber}</p>
                    {connectedNumber.provider && (
                      <p className="text-xs text-muted-foreground">Provider: {connectedNumber.provider}</p>
                    )}
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={() => { void handleDisconnectWA(); }} isLoading={isConnectingWA} className="w-full sm:w-auto">
                  Desconectar
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary border border-border sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                    <Ban className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">Conectando…</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {connectedNumber.provider ? `Provider: ${connectedNumber.provider}` : 'WhatsApp'}
                      {connectedNumber.healthStatus ? ` · ${connectedNumber.healthStatus}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(connectedNumber.provider || '').toLowerCase() === 'evolution' && (
                    <Button
                      size="sm"
                      className="flex-1 sm:flex-none"
                      onClick={() => {
                        setShowSelectModal(true);
                        void handleConnectEvolution();
                      }}
                      isLoading={isGeneratingEvolutionQr}
                    >
                      Ver QR
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => { void handleDisconnectWA(); }} isLoading={isConnectingWA} className="flex-1 sm:flex-none">
                    Desconectar
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary border border-border sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                  <Ban className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground">No conectado</p>
                  <p className="text-sm text-muted-foreground">Conecta WhatsApp para que el agente IA responda</p>
                </div>
              </div>
              {isEvolutionEnabled ? (
                <Button onClick={() => setShowSelectModal(true)} className="w-full sm:w-auto">
                  Conectar
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">Sin opciones disponibles</span>
              )}
            </div>
          )}
        </div>
      </div>

      {canUseMercadoPago && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-sky-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              </div>
              MercadoPago
            </h3>
          </div>
          <div className="p-5">
            {mpError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {mpError}
              </div>
            )}

            {mpStatus?.connected ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center flex-shrink-0">
                      <Check className="w-5 h-5 text-sky-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sky-400">Conectado</p>
                      <p className="text-sm text-muted-foreground truncate">{mpStatus.externalEmail}</p>
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => { void handleDisconnectMP(); }} isLoading={isConnectingMP} className="w-full sm:w-auto">
                    Desconectar
                  </Button>
                </div>

                {mpStatus.stats && null}
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary border border-border sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                    <Ban className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">No conectado</p>
                    <p className="text-sm text-muted-foreground">Conecta MercadoPago para cobrar a clientes</p>
                  </div>
                </div>
                <Button onClick={() => { void handleConnectMP(); }} isLoading={isConnectingMP} className="w-full sm:w-auto">
                  Conectar
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {canUseArca && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-amber-400" />
              </div>
              ARCA (AFIP)
            </h3>
          </div>
          <div className="p-5">
            {arcaError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {arcaError}
              </div>
            )}

            {arcaStatus?.connected ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <Check className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-amber-400">Conectado</p>
                      <p className="text-sm text-muted-foreground truncate">
                        CUIT {arcaStatus.cuit || '—'} · PV {arcaStatus.pointOfSale || '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Entorno {arcaStatus.environment === 'prod' ? 'Producción' : 'Homologación'}
                      </p>
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => { void handleDisconnectArca(); }} isLoading={isConnectingArca} className="w-full sm:w-auto">
                    Desconectar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary border border-border sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                    <Ban className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">No conectado</p>
                    <p className="text-sm text-muted-foreground">
                      {arcaStatus?.status === 'pending'
                        ? 'CSR generado. Falta subir el certificado.'
                        : 'Conecta ARCA para emitir facturas'}
                    </p>
                  </div>
                </div>
                <Button onClick={() => setShowArcaModal(true)} isLoading={isConnectingArca} className="w-full sm:w-auto">
                  {arcaStatus?.status === 'pending' ? 'Continuar' : 'Conectar'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info card */}
      <div className="glass-card rounded-2xl overflow-hidden bg-primary/5 border-primary/20">
        <div className="p-4">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Como funcionan las aplicaciones?</p>
              <p className="text-muted-foreground mt-1">
                <strong className="text-foreground/80">WhatsApp:</strong> El agente IA responde automaticamente a tus clientes 24/7.
                {canUseMercadoPago && (
                  <>
                    <br/>
                    <strong className="text-foreground/80">MercadoPago:</strong> Genera links de pago y cobra directamente desde las conversaciones.
                  </>
                )}
                {canUseArca && (
                  <>
                    <br/>
                    <strong className="text-foreground/80">ARCA:</strong> Emite facturas electrónicas con AFIP.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* WhatsApp Select Modal */}
      <Dialog
        open={showSelectModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowSelectModal(false);
            stopEvolutionPolling();
            setEvolutionQrDataUrl('');
            setEvolutionPairingCode('');
            setEvolutionState('');
          } else {
            setShowSelectModal(true);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <DialogTitle>Conectar WhatsApp</DialogTitle>
                <DialogDescription>Conectá tu número escaneando un código QR</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-secondary border border-border space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">1</div>
                    <p className="text-sm text-muted-foreground">Tocá <span className="text-foreground font-medium">&quot;Generar QR&quot;</span></p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">2</div>
                    <p className="text-sm text-muted-foreground">Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">3</div>
                    <p className="text-sm text-muted-foreground">Escaneá el código QR</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => { void handleConnectEvolution(); }} isLoading={isGeneratingEvolutionQr} disabled={!isEvolutionEnabled}>
                    Generar QR
                  </Button>
                  {!isEvolutionEnabled && (
                    <span className="text-xs text-muted-foreground">Evolution no está configurado</span>
                  )}
                  {evolutionState && (
                    <span className={cn(
                      'text-xs px-2.5 py-1 rounded-full font-medium',
                      evolutionState === 'open' || evolutionState === 'connected'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : evolutionState === 'connecting'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-red-500/20 text-red-400'
                    )}>
                      {evolutionState === 'open' || evolutionState === 'connected'
                        ? 'Conectado'
                        : evolutionState === 'connecting'
                          ? 'Conectando...'
                          : evolutionState}
                    </span>
                  )}
                </div>
              </div>

              {evolutionQrDataUrl && (
                <div className="p-4 rounded-xl bg-secondary border border-border flex flex-col items-center gap-3">
                  <div className="bg-white rounded-xl p-3">
                    <img
                      src={evolutionQrDataUrl}
                      alt="QR WhatsApp"
                      className="w-48 h-48 sm:w-60 sm:h-60"
                    />
                  </div>
                  {evolutionPairingCode && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Código:</span>
                      <span className="bg-secondary/50 rounded-lg px-3 py-1.5 font-mono text-sm text-foreground">{evolutionPairingCode}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowSelectModal(false);
                  stopEvolutionPolling();
                  setEvolutionQrDataUrl('');
                  setEvolutionPairingCode('');
                  setEvolutionState('');
                }}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ARCA Connect Modal */}
      {canUseArca && (
        <Dialog open={showArcaModal} onOpenChange={(open) => { if (!open) { setShowArcaModal(false); } }}>
          <DialogContent className="max-w-5xl">
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-amber-400" />
              </div>
              <div className="min-w-0">
                <DialogTitle>Conectar ARCA (AFIP)</DialogTitle>
                <DialogDescription>Configurá la facturación electrónica en 3 pasos</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            <div className="grid gap-4 md:grid-cols-3">
              {/* Step 1: Generate CSR */}
              <div className={cn(
                'p-4 rounded-2xl bg-secondary/50 border h-full flex flex-col gap-3',
                arcaCsr ? 'border-emerald-500/20' : 'border-border'
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center text-sm font-semibold',
                    arcaCsr ? 'bg-emerald-500/10 text-emerald-400' : 'bg-primary/10 text-primary'
                  )}>
                    {arcaCsr ? <Check className="w-4 h-4" /> : '1'}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Generar certificado</p>
                    <p className="text-xs text-muted-foreground">Creamos la clave y el CSR.</p>
                  </div>
                </div>
                <Input
                  label="CUIT"
                  placeholder="20123456789"
                  value={arcaForm.cuit}
                  onChange={(e) => setArcaForm((prev) => ({ ...prev, cuit: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                  hint={arcaForm.cuit && arcaForm.cuit.length !== 11 ? 'El CUIT debe tener 11 dígitos' : undefined}
                />
                <Input
                  label="Punto de venta"
                  type="number"
                  min={1}
                  value={arcaForm.pointOfSale}
                  onChange={(e) => setArcaForm((prev) => ({ ...prev, pointOfSale: e.target.value }))}
                  hint="Podés cambiarlo luego"
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Entorno</label>
                  <Select
                    value={arcaForm.environment}
                    onValueChange={(value) => setArcaForm((prev) => ({ ...prev, environment: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="test">Homologación (test)</SelectItem>
                      <SelectItem value="prod">Producción</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  onClick={() => { void handleGenerateArcaCsr(); }}
                  isLoading={isGeneratingCsr}
                  disabled={!arcaForm.cuit || arcaForm.cuit.length !== 11 || !arcaForm.pointOfSale}
                >
                  Generar CSR
                </Button>
                {arcaCsr && (
                  <div className="space-y-2">
                    <Textarea
                      className="h-24 text-xs font-mono"
                      value={arcaCsr}
                      readOnly
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => { void handleCopyArcaCsr(); }}>
                        {arcaCsrCopied ? 'Copiado' : 'Copiar CSR'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleDownloadArcaCsr}>
                        Descargar CSR
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Upload CSR in AFIP */}
              <div className="p-4 rounded-2xl bg-secondary/50 border border-border h-full flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Subir CSR en ARCA</p>
                    <p className="text-xs text-muted-foreground">Accedé con clave fiscal.</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-2">
                  <p>1) Ingresá en <span className="font-medium text-foreground/80">afip.gob.ar</span> y logueate.</p>
                  <p>2) Buscá el trámite <span className="font-medium text-foreground/80">{arcaForm.environment === 'prod' ? 'Administración de Certificados Digitales' : 'WSASS - Autogestión Certificados Homologación'}</span>.</p>
                  <p>3) En el panel izquierdo: <span className="font-medium text-foreground/80">{arcaForm.environment === 'prod' ? 'Agregar alias' : 'Nuevo certificado'}</span>.</p>
                  <p>4) Completá:</p>
                  <div className="ml-3 space-y-1">
                    <p>• Nombre simbólico del DN: el que quieras</p>
                    <p>• CUIT del contribuyente: dejalo igual</p>
                    <p>• Solicitud PKCS#10: pegá el CSR del paso 1</p>
                  </div>
                  <p>5) Hacé click en <span className="font-medium text-foreground/80">{arcaForm.environment === 'prod' ? 'Agregar alias' : 'Crear DN y obtener certificado'}</span>.</p>
                  <p>6) Copiá el certificado generado y pegalo en el paso 3.</p>
                  <p>7) En el panel izquierdo: <span className="font-medium text-foreground/80">{arcaForm.environment === 'prod' ? 'Agregar autorización' : 'Crear autorización a servicio'}</span>.</p>
                  <div className="ml-3 space-y-1">
                    <p>• Campo 1: seleccioná el certificado creado</p>
                    <p>• Campos 2, 3 y 4: dejalos como están</p>
                    <p>• Campo 5: <span className="font-medium text-foreground/80">wsfe</span> (Factura electrónica)</p>
                  </div>
                  <p>8) Creá la autorización y luego tocá <span className="font-medium text-foreground/80">Conectar</span>.</p>
                </div>
                <div className={cn(
                  'mt-auto p-3 rounded-xl border text-xs',
                  arcaForm.environment === 'prod'
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                    : 'bg-secondary/50 border-border text-muted-foreground'
                )}>
                  Entorno: {arcaForm.environment === 'prod' ? 'Producción' : 'Homologación (test)'}
                  <span className="block mt-1 text-muted-foreground">Si necesitás detalle por ítem, usá <span className="font-medium text-foreground/80">wsmtxca</span>. Para exportación, <span className="font-medium text-foreground/80">wsfex</span>.</span>
                </div>
              </div>

              {/* Step 3: Upload certificate */}
              <div className={cn(
                'p-4 rounded-2xl bg-secondary/50 border h-full flex flex-col gap-3',
                arcaForm.certificate ? 'border-emerald-500/20' : 'border-border'
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center text-sm font-semibold',
                    arcaForm.certificate ? 'bg-emerald-500/10 text-emerald-400' : 'bg-primary/10 text-primary'
                  )}>
                    {arcaForm.certificate ? <Check className="w-4 h-4" /> : '3'}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Subir certificado</p>
                    <p className="text-xs text-muted-foreground">Cuando ARCA lo entregue.</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Certificado PEM</p>
                <Textarea
                  className="h-28 text-xs font-mono"
                  placeholder="Pegá acá el certificado PEM completo (BEGIN CERTIFICATE)"
                  value={arcaForm.certificate}
                  onChange={(e) =>
                    setArcaForm((prev) => ({
                      ...prev,
                      certificate: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {arcaError && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                {arcaError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button variant="ghost" onClick={() => setShowArcaModal(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => { void handleConnectArca(); }}
                isLoading={isConnectingArca}
                disabled={!arcaForm.cuit || arcaForm.cuit.length !== 11 || !arcaForm.certificate}
              >
                Conectar
              </Button>
            </div>
          </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type NotificationPreferences = {
  orders: boolean;
  handoffs: boolean;
  stock: boolean;
  payments: boolean;
  customers: boolean;
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  orders: true,
  handoffs: true,
  stock: true,
  payments: true,
  customers: true,
};

function NotificationsSettings(): JSX.Element {
  const { workspace } = useAuth();
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);

  useEffect(() => {
    if (!workspace?.id) return;

    const loadSettings = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });

        if (res.ok) {
          const data = await readJsonRecord(res);
          const workspaceData = readRecord(data, 'workspace');
          const settings = readRecord(workspaceData, 'settings');
          const prefs = readRecord(settings, 'notificationPreferences');
          setPreferences({
            orders: readBoolean(prefs, 'orders', true),
            handoffs: readBoolean(prefs, 'handoffs', true),
            stock: readBoolean(prefs, 'stock', true),
            payments: readBoolean(prefs, 'payments', true),
            customers: readBoolean(prefs, 'customers', true),
          });
        }
      } catch (err) {
        console.error('Failed to load notification settings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, [workspace?.id]);

  const handleToggle = (key: keyof NotificationPreferences) => (event: ChangeEvent<HTMLInputElement>): void => {
    setPreferences((prev) => ({ ...prev, [key]: event.target.checked }));
  };

  const handleSave = async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsSaving(true);
    setError('');

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify({ notificationPreferences: preferences }),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al guardar'));
      }

      toast.success('Preferencias guardadas');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar';
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="animate-pulse h-5 w-40 rounded-lg bg-secondary" />
        </div>
        <div className="p-5 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse h-16 w-full rounded-xl bg-secondary" />
          ))}
        </div>
      </div>
    );
  }

  const items: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
    { key: 'orders', label: 'Pedidos', description: 'Enviar WhatsApp al owner cuando haya novedades de pedidos (nuevo, cancelado, editado).' },
    { key: 'handoffs', label: 'Handoffs', description: 'Enviar WhatsApp al owner cuando un cliente pida hablar con un humano.' },
    { key: 'stock', label: 'Stock bajo', description: 'Enviar WhatsApp al owner cuando un producto quede con stock bajo.' },
    { key: 'payments', label: 'Pagos', description: 'Enviar WhatsApp al owner cuando se reciba un pago.' },
    { key: 'customers', label: 'Clientes', description: 'Enviar WhatsApp al owner cuando se registre un nuevo cliente.' },
  ];

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold text-foreground">Notificaciones por WhatsApp al owner</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Las notificaciones del dashboard están siempre activas. Estas preferencias controlan qué alertas también se envían por WhatsApp al dueño.
        </p>
      </div>
      <div className="p-5 space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}
        {items.map((item) => (
          <Switch
            key={item.key}
            label={item.label}
            description={item.description}
            checked={preferences[item.key]}
            onChange={handleToggle(item.key)}
          />
        ))}
        <Button onClick={() => { void handleSave(); }} isLoading={isSaving}>
          Guardar preferencias
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECEIPT SETTINGS (Commerce only)
// ═══════════════════════════════════════════════════════════════════════════════

type ReceiptLogoMode = 'business' | 'custom' | 'none';

interface ReceiptBrandingSettings {
  title: string;
  footerText: string;
  primaryColor: string;
  tableHeaderColor: string;
  logoMode: ReceiptLogoMode;
  customLogoUrl: string | null;
  showBusinessAddress: boolean;
}

const DEFAULT_RECEIPT_SETTINGS: ReceiptBrandingSettings = {
  title: 'BOLETA',
  footerText: 'Gracias por tu compra.',
  primaryColor: '#1F2937',
  tableHeaderColor: '#F3F4F6',
  logoMode: 'business',
  customLogoUrl: null,
  showBusinessAddress: true,
};

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const normalized = (value || '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
}

function ReceiptSettings(): JSX.Element {
  const { workspace } = useAuth();
  const toast = useToast();
  const customLogoRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState('');
  const [businessLogoUrl, setBusinessLogoUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReceiptBrandingSettings>(DEFAULT_RECEIPT_SETTINGS);

  useEffect(() => {
    if (!workspace?.id) return;

    const loadSettings = async (): Promise<void> => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });

        if (!res.ok) {
          const data = await readJsonRecord(res);
          throw new Error(readErrorMessage(data, 'No se pudo cargar la configuración de boletas'));
        }

        const data = await readJsonRecord(res);
        const workspaceData = readRecord(data, 'workspace');
        const workspaceSettings = readRecord(workspaceData, 'settings');
        const receiptBranding = readRecord(workspaceSettings, 'receiptBranding');

        const logoModeRaw = readString(receiptBranding, 'logoMode');
        const logoMode: ReceiptLogoMode =
          logoModeRaw === 'custom' || logoModeRaw === 'none'
            ? logoModeRaw
            : 'business';

        setBusinessLogoUrl(readString(workspaceSettings, 'companyLogo') ?? null);
        setSettings({
          title: readString(receiptBranding, 'title') ?? DEFAULT_RECEIPT_SETTINGS.title,
          footerText: readString(receiptBranding, 'footerText') ?? DEFAULT_RECEIPT_SETTINGS.footerText,
          primaryColor: normalizeHexColor(
            readString(receiptBranding, 'primaryColor'),
            DEFAULT_RECEIPT_SETTINGS.primaryColor
          ),
          tableHeaderColor: normalizeHexColor(
            readString(receiptBranding, 'tableHeaderColor'),
            DEFAULT_RECEIPT_SETTINGS.tableHeaderColor
          ),
          logoMode,
          customLogoUrl: readString(receiptBranding, 'customLogoUrl') ?? null,
          showBusinessAddress: readBoolean(
            receiptBranding,
            'showBusinessAddress',
            DEFAULT_RECEIPT_SETTINGS.showBusinessAddress
          ),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo cargar la configuración de boletas';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, [workspace?.id]);

  const handleCustomLogoUpload = (file: File): void => {
    setUploadingLogo(true);
    setError('');

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result) {
          setError('No se pudo leer el logo');
        } else {
          setSettings((prev) => ({ ...prev, customLogoUrl: result, logoMode: 'custom' }));
        }
        setUploadingLogo(false);
      };
      reader.onerror = () => {
        setError('No se pudo leer el logo');
        setUploadingLogo(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('No se pudo leer el logo');
      setUploadingLogo(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!workspace?.id) return;

    setIsSaving(true);
    setError('');

    try {
      const payload = {
        receiptBranding: {
          title: settings.title.trim(),
          footerText: settings.footerText.trim(),
          primaryColor: normalizeHexColor(settings.primaryColor, DEFAULT_RECEIPT_SETTINGS.primaryColor),
          tableHeaderColor: normalizeHexColor(settings.tableHeaderColor, DEFAULT_RECEIPT_SETTINGS.tableHeaderColor),
          logoMode: settings.logoMode,
          customLogoUrl: settings.logoMode === 'custom' ? (settings.customLogoUrl || '') : '',
          showBusinessAddress: settings.showBusinessAddress,
        },
      };

      const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'No se pudo guardar la configuración de boletas'));
      }

      toast.success('Configuración de boletas guardada');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar la configuración de boletas';
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const previewLogo =
    settings.logoMode === 'none'
      ? null
      : settings.logoMode === 'custom'
        ? settings.customLogoUrl
        : businessLogoUrl;

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="animate-pulse h-5 w-40 rounded-lg bg-secondary" />
        </div>
        <div className="p-5 space-y-4">
          <div className="animate-pulse h-10 w-full rounded-xl bg-secondary" />
          <div className="animate-pulse h-10 w-full rounded-xl bg-secondary" />
          <div className="animate-pulse h-20 w-full rounded-xl bg-secondary" />
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold text-foreground">Boletas y resumenes PDF</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Personalizá el diseño de las boletas/resúmenes que se envían por WhatsApp y dashboard.
        </p>
      </div>
      <div className="p-5 space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <Input
          label="Título del PDF"
          value={settings.title}
          onChange={(e) => setSettings((prev) => ({ ...prev, title: e.target.value }))}
          maxLength={60}
          hint='Ejemplo: "BOLETA", "RESUMEN DE PEDIDO"'
        />

        <div className="space-y-2">
          <Label>Texto de pie</Label>
          <Textarea
            value={settings.footerText}
            onChange={(e) => setSettings((prev) => ({ ...prev, footerText: e.target.value }))}
            rows={2}
            maxLength={220}
            placeholder="Gracias por tu compra."
          />
          <p className="text-xs text-muted-foreground">Se muestra al final del PDF.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Color principal</Label>
            <input
              type="color"
              value={settings.primaryColor}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  primaryColor: normalizeHexColor(e.target.value, DEFAULT_RECEIPT_SETTINGS.primaryColor),
                }))
              }
              className="h-10 w-full rounded-xl border border-input cursor-pointer p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[10px] [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-[10px] [&::-moz-color-swatch]:border-0"
            />
          </div>
          <div className="space-y-2">
            <Label>Color del encabezado de tabla</Label>
            <input
              type="color"
              value={settings.tableHeaderColor}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  tableHeaderColor: normalizeHexColor(e.target.value, DEFAULT_RECEIPT_SETTINGS.tableHeaderColor),
                }))
              }
              className="h-10 w-full rounded-xl border border-input cursor-pointer p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[10px] [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-[10px] [&::-moz-color-swatch]:border-0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Logo en boleta</Label>
          <Select
            value={settings.logoMode}
            onValueChange={(value) => setSettings((prev) => ({ ...prev, logoMode: value as ReceiptLogoMode }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="business">Usar logo del negocio</SelectItem>
              <SelectItem value="custom">Usar logo personalizado</SelectItem>
              <SelectItem value="none">Sin logo</SelectItem>
            </SelectContent>
          </Select>

          {settings.logoMode === 'custom' && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => customLogoRef.current?.click()}
                isLoading={uploadingLogo}
              >
                {settings.customLogoUrl ? 'Cambiar logo' : 'Subir logo personalizado'}
              </Button>
              {settings.customLogoUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettings((prev) => ({ ...prev, customLogoUrl: null }))}
                >
                  Quitar
                </Button>
              )}
              <input
                ref={customLogoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCustomLogoUpload(file);
                }}
              />
            </div>
          )}

          <div className="rounded-xl border border-border bg-secondary/40 p-3 flex items-center gap-3">
            <div
              className={cn(
                'w-14 h-14 rounded-lg border border-border bg-background flex items-center justify-center overflow-hidden'
              )}
            >
              {previewLogo ? (
                <img src={previewLogo} alt="Preview logo boleta" className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {settings.logoMode === 'business'
                ? businessLogoUrl
                  ? 'Se usará el logo cargado en Mi negocio.'
                  : 'No tenés logo en Mi negocio. Subí uno o elegí logo personalizado.'
                : settings.logoMode === 'custom'
                  ? settings.customLogoUrl
                    ? 'Se usará el logo personalizado.'
                    : 'Subí un logo personalizado.'
                  : 'La boleta se enviará sin logo.'}
            </div>
          </div>
        </div>

        <Switch
          label="Mostrar dirección del negocio"
          description="Incluye la dirección configurada en Mi negocio dentro del PDF."
          checked={settings.showBusinessAddress}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              showBusinessAddress: e.target.checked,
            }))
          }
        />

        <Button onClick={() => { void handleSave(); }} isLoading={isSaving}>
          Guardar configuración
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK SETTINGS (Commerce only)
// ═══════════════════════════════════════════════════════════════════════════════

function StockSettings(): JSX.Element {
  const { workspace } = useAuth();
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState<string>(String(DEFAULT_LOW_STOCK_THRESHOLD));

  useEffect(() => {
    if (!workspace?.id) return;

    const loadSettings = async (): Promise<void> => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });

        if (!res.ok) {
          const data = await readJsonRecord(res);
          throw new Error(readErrorMessage(data, 'No se pudo cargar la configuración de stock'));
        }

        const data = await readJsonRecord(res);
        const workspaceData = readRecord(data, 'workspace');
        const settings = readRecord(workspaceData, 'settings');
        const rawThreshold = settings?.lowStockThreshold;
        const parsedThreshold = Number.parseInt(String(rawThreshold ?? ''), 10);
        const safeThreshold = Number.isFinite(parsedThreshold) && parsedThreshold >= 0
          ? Math.min(parsedThreshold, MAX_LOW_STOCK_THRESHOLD)
          : DEFAULT_LOW_STOCK_THRESHOLD;
        setThreshold(String(safeThreshold));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo cargar la configuración de stock';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, [workspace?.id]);

  const handleSave = async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsSaving(true);
    setError('');

    try {
      const parsedThreshold = Number.parseInt(threshold.trim(), 10);
      if (!Number.isFinite(parsedThreshold) || parsedThreshold < 0) {
        throw new Error('Ingresá un número entero mayor o igual a 0');
      }
      if (parsedThreshold > MAX_LOW_STOCK_THRESHOLD) {
        throw new Error(`El umbral máximo es ${MAX_LOW_STOCK_THRESHOLD}`);
      }

      const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify({ lowStockThreshold: parsedThreshold }),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'No se pudo guardar la configuración de stock'));
      }

      setThreshold(String(parsedThreshold));
      toast.success('Configuración de stock guardada');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar la configuración de stock';
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="animate-pulse h-5 w-40 rounded-lg bg-secondary" />
        </div>
        <div className="p-5 space-y-4">
          <div className="animate-pulse h-10 w-56 rounded-xl bg-secondary" />
          <div className="animate-pulse h-10 w-32 rounded-xl bg-secondary" />
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold text-foreground">Stock</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Definí el umbral de stock bajo para todos tus productos.
        </p>
      </div>
      <div className="p-5 space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}
        <Input
          label="Umbral de stock bajo"
          type="number"
          min={0}
          step={1}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          hint="Cuando un producto llegue a este valor disponible o menos, se considera stock bajo."
        />
        <p className="text-xs text-muted-foreground">
          Este cambio se aplica a productos existentes y nuevos.
        </p>
        <Button onClick={() => { void handleSave(); }} isLoading={isSaving}>
          Guardar configuración
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT SETTINGS (Commerce only)
// ═══════════════════════════════════════════════════════════════════════════════

interface PaymentMethodsSettings {
  mpLink: boolean;
  transfer: boolean;
  cash: boolean;
}

function PaymentSettings(): JSX.Element {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const canUseMercadoPago = capabilities.showMercadoPagoIntegration;
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState<PaymentMethodsSettings>({
    mpLink: true,
    transfer: true,
    cash: true,
  });

  useEffect(() => {
    if (!workspace?.id) return;

    const loadSettings = async (): Promise<void> => {
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}`, {
          headers: {
            'X-Workspace-Id': workspace.id,
          },
        });

        if (res.ok) {
          const data = await readJsonRecord(res);
          const workspaceData = readRecord(data, 'workspace');
          const settings = readRecord(workspaceData, 'settings');
          const enabled = readRecord(settings, 'paymentMethodsEnabled');
          setMethods({
            mpLink: canUseMercadoPago ? readBoolean(enabled, 'mpLink', true) : false,
            transfer: readBoolean(enabled, 'transfer', true),
            cash: readBoolean(enabled, 'cash', true),
          });
        }
      } catch (err) {
        console.error('Failed to load payment settings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, [canUseMercadoPago, workspace?.id]);

  const handleSave = async (): Promise<void> => {
    if (!workspace?.id) return;

    setIsSaving(true);
    setError('');

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/workspaces/${workspace.id}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify({
          paymentMethodsEnabled: {
            ...methods,
            mpLink: canUseMercadoPago ? methods.mpLink : false,
          },
        }),
      });

      if (!res.ok) {
        const data = await readJsonRecord(res);
        throw new Error(readErrorMessage(data, 'Error al guardar'));
      }

      toast.success('Preferencias guardadas');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar';
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="animate-pulse h-5 w-32 rounded-lg bg-secondary" />
        </div>
        <div className="p-5 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-16 w-full rounded-xl bg-secondary" />
          ))}
        </div>
      </div>
    );
  }

  const items: Array<{ key: keyof PaymentMethodsSettings; label: string; description: string }> = [
    {
      key: 'transfer',
      label: 'Transferencia',
      description: 'Mostrar alias/CBU y pedir comprobante',
    },
    {
      key: 'cash',
      label: 'Efectivo',
      description: 'Permitir pago en efectivo al repartidor',
    },
  ];
  if (canUseMercadoPago) {
    items.unshift({
      key: 'mpLink',
      label: 'Link de pago (MercadoPago)',
      description: 'Mostrar botón para generar link de pago',
    });
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold text-foreground">Pagos</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Activá o desactivá los métodos de pago que se muestran en WhatsApp
        </p>
      </div>
      <div className="p-5 space-y-4">
        {items.map((item) => (
          <Switch
            key={item.key}
            label={item.label}
            description={item.description}
            checked={methods[item.key]}
            onChange={(e) =>
              setMethods((prev) => ({ ...prev, [item.key]: e.target.checked }))
            }
          />
        ))}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <Button onClick={() => { void handleSave(); }} isLoading={isSaving}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

export default function SettingsPage(): JSX.Element {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const settingsNav = getSettingsNav(workspace?.businessType, {
    showNotifications: capabilities.showSettingsNotifications,
    showReceipts: capabilities.showReceiptBrandingSettings,
  });

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
      <AnimatedPage className="max-w-5xl mx-auto space-y-4 md:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Configuración</h1>
          <p className="text-sm text-muted-foreground">Gestiona tu perfil, negocio e integraciones</p>
        </div>
        {/* Mobile navigation — horizontal scroll tabs */}
        <div className="md:hidden">
          <nav className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {settingsNav.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                end={item.href === '/settings'}
                className={({ isActive }) =>
                  cn(
                    'shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                    isActive
                      ? 'bg-primary/20 text-primary'
                      : 'bg-secondary text-muted-foreground'
                  )
                }
              >
                {item.name}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex gap-6">
          {/* Sidebar navigation — desktop only */}
          <div className="hidden md:block glass-card rounded-2xl w-56 h-fit overflow-hidden shrink-0">
            <nav className="p-2 space-y-1">
              {settingsNav.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.href}
                  end={item.href === '/settings'}
                  className={({ isActive }) =>
                    cn(
                      'block px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary/20 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                    )
                  }
                >
                  {item.name}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <Routes>
              <Route index element={<ProfileSettings />} />
              <Route path="business" element={<BusinessSettings />} />
              <Route
                path="receipts"
                element={
                  workspace?.businessType === 'commerce' && capabilities.showReceiptBrandingSettings
                    ? <ReceiptSettings />
                    : <Navigate to="/settings" replace />
                }
              />
              <Route
                path="stock"
                element={
                  workspace?.businessType === 'commerce'
                    ? <StockSettings />
                    : <Navigate to="/settings" replace />
                }
              />
              <Route path="payments" element={<PaymentSettings />} />
              <Route path="applications" element={<ApplicationsSettings />} />
              <Route
                path="notifications"
                element={
                  capabilities.showSettingsNotifications
                    ? <NotificationsSettings />
                    : <Navigate to="/settings" replace />
                }
              />
            </Routes>
          </div>
        </div>
      </AnimatedPage>
    </div>
  );
}
