import {
  Megaphone,
  Percent,
  BadgeDollarSign,
  Send,
  Image as ImageIcon,
  Clock,
  AlertTriangle,
  Search,
  Upload,
  X,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DeleteConfirmModal } from '../../components/stock';
import {
  AnimatedPage,
  AnimatedStagger,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  Textarea,
} from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';
import { API_URL, apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';

type JsonRecord = Record<string, unknown>;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asRecordList(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item)).filter((item): item is JsonRecord => item !== null);
}

function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(record: JsonRecord | null, key: string): number {
  const value = record?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readBoolean(record: JsonRecord | null, key: string): boolean {
  return record?.[key] === true;
}

function readNullableNumber(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key];
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readObject(record: JsonRecord | null, key: string): JsonRecord | null {
  return asRecord(record?.[key]);
}

async function readJsonRecord(response: Response): Promise<JsonRecord> {
  try {
    const payload = (await response.json()) as unknown;
    return asRecord(payload) || {};
  } catch {
    return {};
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label}: timeout de ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'Formato de imagen no valido. Usa JPG, PNG, WebP o GIF.';
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return 'La imagen supera el maximo de 5MB.';
  }
  return null;
}

function toPublicUploadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = (API_URL || origin).replace(/\/$/, '');
  if (!base) return url;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('No se pudo leer la imagen'));
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
}

interface PromotionView {
  id: string;
  name: string;
  imageUrl: string | null;
  promoType: string;
  value: number;
  valueLabel: string;
  rules: { buyQuantity: number; payQuantity: number } | null;
  status: string;
  computedStatus: string;
  startsAt: string;
  endsAt: string;
  productName: string;
  productPrice: number;
  orderCount: number;
  revenue: number;
  discountTotal: number;
}

interface CampaignView {
  id: string;
  name: string;
  message: string;
  imageUrl: string | null;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  promotionName: string | null;
}

interface MetricsView {
  promotionsTotal: number;
  promotionsActive: number;
  requestedPromotions: number;
  ordersWithPromotion: number;
  ordersWithoutPromotion: number;
  revenueWithPromotion: number;
  revenueWithoutPromotion: number;
  campaignsTotal: number;
  campaignsSent: number;
  campaignsFailed: number;
  usage: {
    communicationsActions: {
      limit: number | null;
      used: number;
      remaining: number | null;
      percentUsed: number;
      isNearLimit: boolean;
      isExhausted: boolean;
    };
  };
}

const DEFAULT_METRICS: MetricsView = {
  promotionsTotal: 0,
  promotionsActive: 0,
  requestedPromotions: 0,
  ordersWithPromotion: 0,
  ordersWithoutPromotion: 0,
  revenueWithPromotion: 0,
  revenueWithoutPromotion: 0,
  campaignsTotal: 0,
  campaignsSent: 0,
  campaignsFailed: 0,
  usage: {
    communicationsActions: {
      limit: null,
      used: 0,
      remaining: null,
      percentUsed: 0,
      isNearLimit: false,
      isExhausted: false,
    },
  },
};

function formatCurrency(amount: number): string {
  return `$${(amount / 100).toLocaleString('es-AR')}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function promotionTypeLabel(promoType: string): string {
  if (promoType === 'percentage') return 'Porcentaje';
  if (promoType === 'fixed_price') return 'Precio fijo';
  if (promoType === 'second_unit_percentage') return 'Desc. 2da unidad';
  if (promoType === 'buy_x_pay_y') return 'X por Y';
  return promoType;
}

function promotionValueLabel(promotion: PromotionView): string {
  if (promotion.valueLabel && promotion.promoType !== 'fixed_price') return promotion.valueLabel;
  if (promotion.promoType === 'percentage') return `${promotion.value}%`;
  if (promotion.promoType === 'fixed_price') return `Precio fijo ${formatCurrency(promotion.value)}`;
  if (promotion.promoType === 'second_unit_percentage') return `${promotion.value}% en 2da unidad`;
  if (promotion.promoType === 'buy_x_pay_y' && promotion.rules) {
    return `${promotion.rules.buyQuantity}x${promotion.rules.payQuantity}`;
  }
  return `${promotion.value}`;
}

function toLocalDatetimeValue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function statusClass(status: string): string {
  if (status === 'active' || status === 'completed') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'processing' || status === 'draft') return 'bg-primary/20 text-primary';
  if (status === 'paused' || status === 'partial') return 'bg-amber-500/20 text-amber-400';
  if (status === 'expired' || status === 'failed' || status === 'archived' || status === 'cancelled') {
    return 'bg-red-500/20 text-red-400';
  }
  return 'bg-secondary text-muted-foreground';
}

function statusLabel(status: string): string {
  if (status === 'active') return 'Activa';
  if (status === 'completed') return 'Completada';
  if (status === 'processing') return 'Procesando';
  if (status === 'draft') return 'Borrador';
  if (status === 'paused') return 'Pausada';
  if (status === 'partial') return 'Parcial';
  if (status === 'expired') return 'Vencida';
  if (status === 'failed') return 'Fallida';
  if (status === 'archived') return 'Archivada';
  if (status === 'cancelled') return 'Cancelada';
  return status;
}

function ImageThumbnail({ src, alt }: { src: string; alt: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-12 h-12 rounded-lg border border-border bg-secondary/40 flex items-center justify-center shrink-0">
        <ImageIcon className="w-4 h-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={toPublicUploadUrl(src)}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-12 h-12 rounded-lg object-cover border border-border bg-secondary/20 shrink-0"
    />
  );
}

export default function CommunicationsPage(): JSX.Element {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const toastSuccess = useToastStore((state) => state.success);
  const toastError = useToastStore((state) => state.error);
  const lastLoadIssueRef = useRef<'none' | 'full'>('none');
  const autoLoadedWorkspaceIdRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<'promotions' | 'broadcasts'>('promotions');
  const [isLoading, setIsLoading] = useState(true);
  const [isPromoDialogOpen, setIsPromoDialogOpen] = useState(false);
  const [isCampaignDialogOpen, setIsCampaignDialogOpen] = useState(false);
  const [isCreatingPromo, setIsCreatingPromo] = useState(false);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [promotions, setPromotions] = useState<PromotionView[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [metrics, setMetrics] = useState<MetricsView>(DEFAULT_METRICS);

  const [promoName, setPromoName] = useState('');
  const [promoProductId, setPromoProductId] = useState('');
  const [promoProductSearch, setPromoProductSearch] = useState('');
  const [promoType, setPromoType] = useState<'percentage' | 'fixed_price' | 'second_unit_percentage' | 'buy_x_pay_y'>('percentage');
  const [promoValue, setPromoValue] = useState('');
  const [promoBuyQuantity, setPromoBuyQuantity] = useState('2');
  const [promoPayQuantity, setPromoPayQuantity] = useState('1');
  const [promoStartsAt, setPromoStartsAt] = useState(toLocalDatetimeValue(new Date().toISOString()));
  const [promoEndsAt, setPromoEndsAt] = useState(toLocalDatetimeValue(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()));
  const [promoImageFile, setPromoImageFile] = useState<File | null>(null);
  const [promoImagePreview, setPromoImagePreview] = useState('');
  const [promoImageInputKey, setPromoImageInputKey] = useState(0);

  const [campaignName, setCampaignName] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignImageFile, setCampaignImageFile] = useState<File | null>(null);
  const [campaignImagePreview, setCampaignImagePreview] = useState('');
  const [campaignImageInputKey, setCampaignImageInputKey] = useState(0);
  const [campaignPromotionId, setCampaignPromotionId] = useState('none');
  const [promotionToDelete, setPromotionToDelete] = useState<PromotionView | null>(null);
  const [isDeletingPromotion, setIsDeletingPromotion] = useState(false);

  const communicationsUsage = metrics.usage.communicationsActions;
  const hasCommunicationsLimit = communicationsUsage.limit !== null;
  const isCommunicationsLimitReached = communicationsUsage.isExhausted;
  const showCommunicationsLimitWarning =
    hasCommunicationsLimit && (communicationsUsage.isNearLimit || communicationsUsage.isExhausted);

  const promotionOptions = useMemo(
    () =>
      promotions
        .filter((promotion) => promotion.computedStatus === 'active')
        .map((promotion) => ({ id: promotion.id, label: promotion.name })),
    [promotions]
  );

  const filteredProducts = useMemo(() => {
    const term = promoProductSearch.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) => product.name.toLowerCase().includes(term));
  }, [products, promoProductSearch]);

  const selectedPromoProduct = useMemo(
    () => products.find((product) => product.id === promoProductId) || null,
    [products, promoProductId]
  );

  const notifyLoadIssue = useCallback(
    () => {
      if (lastLoadIssueRef.current === 'full') return;
      toastError('No se pudo cargar comunicacion');
      lastLoadIssueRef.current = 'full';
    },
    [toastError]
  );

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      if (!workspace?.id) {
        throw new Error('Workspace no encontrado');
      }

      const fileError = validateImageFile(file);
      if (fileError) throw new Error(fileError);

      const formData = new FormData();
      formData.append('file', file);

      const response = await apiFetch(
        '/api/v1/uploads/product-image',
        {
          method: 'POST',
          body: formData,
        },
        workspace.id
      );

      const body = await readJsonRecord(response);
      if (!response.ok) {
        throw new Error(
          readString(body, 'message') || readString(body, 'error') || 'No se pudo subir la imagen'
        );
      }

      const uploadedUrl = readString(body, 'url');
      if (!uploadedUrl) {
        throw new Error('No se recibio la URL de la imagen subida');
      }
      return uploadedUrl;
    },
    [workspace?.id]
  );

  const handlePromoImageSelected = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file) return;
      const fileError = validateImageFile(file);
      if (fileError) {
        toastError(fileError);
        return;
      }
      try {
        const preview = await fileToDataUrl(file);
        setPromoImageFile(file);
        setPromoImagePreview(preview);
      } catch (error) {
        toastError(error instanceof Error ? error.message : 'No se pudo leer la imagen');
      }
    },
    [toastError]
  );

  const handleCampaignImageSelected = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file) return;
      const fileError = validateImageFile(file);
      if (fileError) {
        toastError(fileError);
        return;
      }
      try {
        const preview = await fileToDataUrl(file);
        setCampaignImageFile(file);
        setCampaignImagePreview(preview);
      } catch (error) {
        toastError(error instanceof Error ? error.message : 'No se pudo leer la imagen');
      }
    },
    [toastError]
  );

  const loadAll = useCallback(async (): Promise<void> => {
    if (!workspace?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const metricsPromise = withTimeout(
        apiFetch('/api/v1/communications/metrics', {}, workspace.id),
        REQUEST_TIMEOUT_MS,
        'metrics'
      );

      const [productsResult, promotionsResult, campaignsResult] = await Promise.allSettled([
        withTimeout(
          apiFetch('/api/v1/communications/products?limit=500', {}, workspace.id),
          REQUEST_TIMEOUT_MS,
          'products'
        ),
        withTimeout(
          apiFetch('/api/v1/communications/promotions?limit=100', {}, workspace.id),
          REQUEST_TIMEOUT_MS,
          'promotions'
        ),
        withTimeout(
          apiFetch('/api/v1/communications/campaigns?limit=100', {}, workspace.id),
          REQUEST_TIMEOUT_MS,
          'campaigns'
        ),
      ]);

      const failures: string[] = [];
      let loadedCommunicationsOk = 0;

      if (productsResult.status === 'fulfilled') {
        const productsRes = productsResult.value;
        if (productsRes.ok) {
          const data = await readJsonRecord(productsRes);
          const parsed = asRecordList(data.products).map((item) => ({
            id: readString(item, 'id') || '',
            name: readString(item, 'name') || 'Producto',
            price: readNumber(item, 'price'),
          }));
          setProducts(parsed.filter((item) => item.id));
        } else {
          const data = await readJsonRecord(productsRes);
          failures.push(`products (${productsRes.status}): ${readString(data, 'message') || 'request failed'}`);
        }
      } else {
        failures.push(`products: ${toErrorMessage(productsResult.reason)}`);
      }

      if (promotionsResult.status === 'fulfilled') {
        const promotionsRes = promotionsResult.value;
        if (promotionsRes.ok) {
          const data = await readJsonRecord(promotionsRes);
          const parsed = asRecordList(data.promotions).map((item) => {
            const product = readObject(item, 'product');
            const metricsItem = readObject(item, 'metrics');
            const rulesItem = readObject(item, 'rules');
            const buyQuantity = readNumber(rulesItem, 'buyQuantity');
            const payQuantity = readNumber(rulesItem, 'payQuantity');
            return {
              id: readString(item, 'id') || '',
              name: readString(item, 'name') || 'Promo',
              imageUrl: readString(item, 'imageUrl'),
              promoType: readString(item, 'promoType') || 'percentage',
              value: readNumber(item, 'value'),
              valueLabel: readString(item, 'valueLabel') || '',
              rules:
                buyQuantity >= 2 && payQuantity >= 1
                  ? { buyQuantity: Math.trunc(buyQuantity), payQuantity: Math.trunc(payQuantity) }
                  : null,
              status: readString(item, 'status') || 'draft',
              computedStatus: readString(item, 'computedStatus') || readString(item, 'status') || 'draft',
              startsAt: readString(item, 'startsAt') || new Date().toISOString(),
              endsAt: readString(item, 'endsAt') || new Date().toISOString(),
              productName: readString(product, 'name') || 'Producto',
              productPrice: readNumber(product, 'price'),
              orderCount: readNumber(metricsItem, 'orderCount'),
              revenue: readNumber(metricsItem, 'revenue'),
              discountTotal: readNumber(metricsItem, 'discountTotal'),
            };
          });
          setPromotions(parsed.filter((item) => item.id));
          loadedCommunicationsOk += 1;
        } else {
          const data = await readJsonRecord(promotionsRes);
          failures.push(`promotions (${promotionsRes.status}): ${readString(data, 'message') || 'request failed'}`);
        }
      } else {
        failures.push(`promotions: ${toErrorMessage(promotionsResult.reason)}`);
      }

      if (campaignsResult.status === 'fulfilled') {
        const campaignsRes = campaignsResult.value;
        if (campaignsRes.ok) {
          const data = await readJsonRecord(campaignsRes);
          const parsed = asRecordList(data.campaigns).map((item) => {
            const promotion = readObject(item, 'promotion');
            return {
              id: readString(item, 'id') || '',
              name: readString(item, 'name') || 'Difusion',
              message: readString(item, 'message') || '',
              imageUrl: readString(item, 'imageUrl'),
              status: readString(item, 'status') || 'draft',
              totalRecipients: readNumber(item, 'totalRecipients'),
              sentCount: readNumber(item, 'sentCount'),
              failedCount: readNumber(item, 'failedCount'),
              createdAt: readString(item, 'createdAt') || new Date().toISOString(),
              promotionName: readString(promotion, 'name'),
            };
          });
          setCampaigns(parsed.filter((item) => item.id));
          loadedCommunicationsOk += 1;
        } else {
          const data = await readJsonRecord(campaignsRes);
          failures.push(`campaigns (${campaignsRes.status}): ${readString(data, 'message') || 'request failed'}`);
        }
      } else {
        failures.push(`campaigns: ${toErrorMessage(campaignsResult.reason)}`);
      }

      // Avoid blocking the whole page while metrics resolve.
      setIsLoading(false);

      const metricsResult = await metricsPromise.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason })
      );

      if (metricsResult.status === 'fulfilled') {
        const metricsRes = metricsResult.value;
        if (metricsRes.ok) {
          const data = await readJsonRecord(metricsRes);
          const promotionsData = readObject(data, 'promotions');
          const ordersData = readObject(data, 'orders');
          const withPromo = readObject(ordersData, 'withPromotion');
          const withoutPromo = readObject(ordersData, 'withoutPromotion');
          const campaignsData = readObject(data, 'campaigns');
          const usageData = readObject(data, 'usage');
          const communicationsActionsData = readObject(usageData, 'communicationsActions');
          const usageLimit = readNullableNumber(communicationsActionsData, 'limit');
          setMetrics({
            promotionsTotal: readNumber(promotionsData, 'total'),
            promotionsActive: readNumber(promotionsData, 'active'),
            requestedPromotions: readNumber(promotionsData, 'requested'),
            ordersWithPromotion: readNumber(withPromo, 'count'),
            ordersWithoutPromotion: readNumber(withoutPromo, 'count'),
            revenueWithPromotion: readNumber(withPromo, 'revenue'),
            revenueWithoutPromotion: readNumber(withoutPromo, 'revenue'),
            campaignsTotal: readNumber(campaignsData, 'total'),
            campaignsSent: readNumber(campaignsData, 'sent'),
            campaignsFailed: readNumber(campaignsData, 'failed'),
            usage: {
              communicationsActions: {
                limit: usageLimit,
                used: readNumber(communicationsActionsData, 'used'),
                remaining: readNullableNumber(communicationsActionsData, 'remaining'),
                percentUsed: readNumber(communicationsActionsData, 'percentUsed'),
                isNearLimit: readBoolean(communicationsActionsData, 'isNearLimit'),
                isExhausted: readBoolean(communicationsActionsData, 'isExhausted'),
              },
            },
          });
          loadedCommunicationsOk += 1;
        } else {
          const data = await readJsonRecord(metricsRes);
          failures.push(`metrics (${metricsRes.status}): ${readString(data, 'message') || 'request failed'}`);
        }
      } else {
        failures.push(`metrics: ${toErrorMessage(metricsResult.reason)}`);
      }

      if (failures.length > 0) {
        if (loadedCommunicationsOk === 0) {
          notifyLoadIssue();
        }
        console.error('Failed to load communications data:', failures);
      } else {
        lastLoadIssueRef.current = 'none';
      }
    } catch (error) {
      console.error('Failed to load communications data:', error);
      notifyLoadIssue();
    } finally {
      setIsLoading(false);
    }
  }, [notifyLoadIssue, workspace?.id]);

  useEffect(() => {
    if (!capabilities.showCommunicationsModule) {
      setIsLoading(false);
      autoLoadedWorkspaceIdRef.current = null;
      return;
    }
    if (!workspace?.id) {
      setIsLoading(false);
      autoLoadedWorkspaceIdRef.current = null;
      return;
    }
    if (autoLoadedWorkspaceIdRef.current === workspace.id) {
      return;
    }
    autoLoadedWorkspaceIdRef.current = workspace.id;
    void loadAll();
  }, [capabilities.showCommunicationsModule, loadAll, workspace?.id]);

  const handleCreatePromotion = async (): Promise<void> => {
    if (!workspace?.id) return;
    if (isCommunicationsLimitReached) {
      toastError(
        `Alcanzaste el límite mensual de comunicación (${communicationsUsage.limit ?? 0}).`
      );
      return;
    }
    if (
      !promoName.trim()
      || !promoProductId
      || (promoType !== 'buy_x_pay_y' && !promoValue)
      || !promoStartsAt
      || !promoEndsAt
    ) {
      toastError('Completa todos los campos de la promocion');
      return;
    }

    const rawValue = Number(promoValue);
    const isValueRequired = promoType !== 'buy_x_pay_y';
    const value = isValueRequired ? rawValue : 0;
    if (isValueRequired && (!Number.isFinite(value) || value <= 0)) {
      toastError('El valor de la promocion no es valido');
      return;
    }
    if ((promoType === 'percentage' || promoType === 'second_unit_percentage') && (value < 1 || value > 100)) {
      toastError('El porcentaje debe estar entre 1 y 100');
      return;
    }

    const buyQuantity = Number(promoBuyQuantity);
    const payQuantity = Number(promoPayQuantity);
    if (promoType === 'buy_x_pay_y') {
      if (!Number.isFinite(buyQuantity) || buyQuantity < 2) {
        toastError('En promo X por Y, X debe ser al menos 2');
        return;
      }
      if (!Number.isFinite(payQuantity) || payQuantity < 1 || payQuantity >= buyQuantity) {
        toastError('En promo X por Y, Y debe ser menor que X');
        return;
      }
    }

    setIsCreatingPromo(true);
    try {
      let uploadedPromoImageUrl: string | null = null;
      if (promoImageFile) {
        uploadedPromoImageUrl = await uploadImage(promoImageFile);
      }

      const response = await apiFetch(
        '/api/v1/communications/promotions',
        {
          method: 'POST',
          body: JSON.stringify({
            name: promoName.trim(),
            productId: promoProductId,
            promoType,
            value,
            rules:
              promoType === 'buy_x_pay_y'
                ? {
                    buyQuantity: Math.trunc(buyQuantity),
                    payQuantity: Math.trunc(payQuantity),
                  }
                : undefined,
            startsAt: new Date(promoStartsAt).toISOString(),
            endsAt: new Date(promoEndsAt).toISOString(),
            imageUrl: uploadedPromoImageUrl,
            status: 'active',
          }),
        },
        workspace.id
      );
      const body = await readJsonRecord(response);
      if (!response.ok) {
        throw new Error(readString(body, 'message') || 'No se pudo crear la promocion');
      }

      setIsPromoDialogOpen(false);
      setPromoName('');
      setPromoProductId('');
      setPromoProductSearch('');
      setPromoType('percentage');
      setPromoValue('');
      setPromoBuyQuantity('2');
      setPromoPayQuantity('1');
      setPromoStartsAt(toLocalDatetimeValue(new Date().toISOString()));
      setPromoEndsAt(toLocalDatetimeValue(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()));
      setPromoImageFile(null);
      setPromoImagePreview('');
      setPromoImageInputKey((prev) => prev + 1);
      toastSuccess('Promocion creada');
      await loadAll();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo crear la promocion');
    } finally {
      setIsCreatingPromo(false);
    }
  };

  const handleCreateCampaign = async (): Promise<void> => {
    if (!workspace?.id) return;
    if (isCommunicationsLimitReached) {
      toastError(
        `Alcanzaste el límite mensual de comunicación (${communicationsUsage.limit ?? 0}).`
      );
      return;
    }
    if (!campaignName.trim() || !campaignMessage.trim()) {
      toastError('Completa nombre y mensaje de la difusion');
      return;
    }

    setIsCreatingCampaign(true);
    try {
      let uploadedCampaignImageUrl: string | null = null;
      if (campaignImageFile) {
        uploadedCampaignImageUrl = toPublicUploadUrl(await uploadImage(campaignImageFile));
      }

      const response = await apiFetch(
        '/api/v1/communications/campaigns',
        {
          method: 'POST',
          body: JSON.stringify({
            name: campaignName.trim(),
            message: campaignMessage.trim(),
            imageUrl: uploadedCampaignImageUrl,
            promotionId: campaignPromotionId === 'none' ? null : campaignPromotionId,
            sendToAll: true,
          }),
        },
        workspace.id
      );
      const body = await readJsonRecord(response);
      if (!response.ok) {
        throw new Error(readString(body, 'message') || 'No se pudo lanzar la difusion');
      }

      setIsCampaignDialogOpen(false);
      setCampaignName('');
      setCampaignMessage('');
      setCampaignImageFile(null);
      setCampaignImagePreview('');
      setCampaignImageInputKey((prev) => prev + 1);
      setCampaignPromotionId('none');
      toastSuccess('Difusion enviada a cola');
      await loadAll();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo lanzar la difusion');
    } finally {
      setIsCreatingCampaign(false);
    }
  };

  const handleDeletePromotion = async (): Promise<void> => {
    if (!workspace?.id || !promotionToDelete) return;
    setIsDeletingPromotion(true);
    try {
      const response = await apiFetch(
        `/api/v1/communications/promotions/${promotionToDelete.id}`,
        { method: 'DELETE' },
        workspace.id
      );
      const body = await readJsonRecord(response);
      if (!response.ok) {
        throw new Error(readString(body, 'message') || 'No se pudo eliminar la promocion');
      }
      setPromotions((prev) => prev.filter((promotion) => promotion.id !== promotionToDelete.id));
      setPromotionToDelete(null);
      toastSuccess('Promocion eliminada');
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'No se pudo eliminar la promocion');
    } finally {
      setIsDeletingPromotion(false);
    }
  };

  if (!capabilities.showCommunicationsModule) {
    return (
      <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
        <AnimatedPage className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          <div className="glass-card rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Tu plan actual no incluye el módulo de comunicación.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Este módulo está disponible para planes Standard y Pro.
                </p>
              </div>
            </div>
          </div>
        </AnimatedPage>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Comunicacion</h1>
            <p className="text-sm text-muted-foreground">
              Gestion de promociones y difusion de WhatsApp
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => setIsPromoDialogOpen(true)}
              disabled={isCommunicationsLimitReached}
            >
              <Percent className="w-4 h-4 mr-2" />
              Nueva promocion
            </Button>
            <Button onClick={() => setIsCampaignDialogOpen(true)} disabled={isCommunicationsLimitReached}>
              <Send className="w-4 h-4 mr-2" />
              Nueva difusion
            </Button>
          </div>
        </div>

        {showCommunicationsLimitWarning && hasCommunicationsLimit && (
          <div
            className={`glass-card rounded-2xl p-4 border ${
              isCommunicationsLimitReached
                ? 'border-red-500/35 bg-red-500/10'
                : 'border-amber-500/35 bg-amber-500/10'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  isCommunicationsLimitReached ? 'bg-red-500/20' : 'bg-amber-500/20'
                }`}
              >
                <AlertTriangle
                  className={`w-5 h-5 ${isCommunicationsLimitReached ? 'text-red-300' : 'text-amber-400'}`}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isCommunicationsLimitReached
                    ? `Alcanzaste el límite mensual de comunicación (${communicationsUsage.limit}).`
                    : `Te estás por quedar sin cupo mensual de comunicación (${communicationsUsage.used}/${communicationsUsage.limit}).`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isCommunicationsLimitReached
                    ? 'Ya no podrás crear promociones ni difusiones hasta el próximo mes o al mejorar tu plan.'
                    : `Te quedan ${communicationsUsage.remaining ?? 0} acciones este mes. Cada promoción o difusión nueva consume 1 acción.`}
                </p>
              </div>
            </div>
          </div>
        )}

        <AnimatedStagger className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            label="Promos activas"
            value={`${metrics.promotionsActive}/${metrics.promotionsTotal}`}
            icon={BadgeDollarSign}
            color="emerald"
            isLoading={isLoading}
          />
          <StatCard
            label="Pedidos con promo"
            value={metrics.ordersWithPromotion.toString()}
            icon={Percent}
            color="blue"
            isLoading={isLoading}
          />
          <StatCard
            label="Ventas con promo"
            value={formatCurrency(metrics.revenueWithPromotion)}
            icon={Megaphone}
            color="primary"
            isLoading={isLoading}
          />
          <StatCard
            label="Mensajes enviados"
            value={metrics.campaignsSent.toString()}
            icon={Send}
            color="cyan"
            isLoading={isLoading}
          />
        </AnimatedStagger>

        <div className="glass-card rounded-2xl p-2 flex gap-2">
          <button
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === 'promotions' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('promotions')}
          >
            Promociones
          </button>
          <button
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === 'broadcasts' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('broadcasts')}
          >
            Difusion
          </button>
        </div>

        {activeTab === 'promotions' ? (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Promociones configuradas</h3>
              <Badge variant="secondary">{promotions.length} items</Badge>
            </div>
            {promotions.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No hay promociones creadas todavia.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Promo</th>
                      <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Producto</th>
                      <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Tipo</th>
                      <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Pedidos</th>
                      <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Ventas</th>
                      <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground">Estado</th>
                      <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Finaliza</th>
                      <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promotions.map((promotion) => (
                      <tr key={promotion.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            {promotion.imageUrl ? (
                              <ImageThumbnail src={promotion.imageUrl} alt={`Promo ${promotion.name}`} />
                            ) : (
                              <div className="w-12 h-12 rounded-lg border border-border bg-secondary/30 flex items-center justify-center shrink-0">
                                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{promotion.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {promotionValueLabel(promotion)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm text-foreground">{promotion.productName}</p>
                          <p className="text-xs text-muted-foreground">Base: {formatCurrency(promotion.productPrice)}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">
                          {promotionTypeLabel(promotion.promoType)}
                        </td>
                        <td className="px-5 py-4 text-right text-sm text-foreground">{promotion.orderCount}</td>
                        <td className="px-5 py-4 text-right text-sm text-foreground">{formatCurrency(promotion.revenue)}</td>
                        <td className="px-5 py-4 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs ${statusClass(promotion.computedStatus)}`}>
                            {statusLabel(promotion.computedStatus)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">{formatDate(promotion.endsAt)}</td>
                        <td className="px-5 py-4 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPromotionToDelete(promotion)}
                            className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-4 h-4 mr-1.5" />
                            Eliminar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Campanas de difusion</h3>
              <Badge variant="secondary">{campaigns.length} items</Badge>
            </div>
            {campaigns.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No hay campanas enviadas todavia.</div>
            ) : (
              <div className="divide-y divide-border">
                {campaigns.map((campaign) => {
                  const progress = campaign.totalRecipients > 0
                    ? Math.round((campaign.sentCount / campaign.totalRecipients) * 100)
                    : 0;
                  return (
                    <div key={campaign.id} className="p-5 space-y-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          {campaign.imageUrl ? (
                            <ImageThumbnail src={campaign.imageUrl} alt={`Difusion ${campaign.name}`} />
                          ) : (
                            <div className="w-12 h-12 rounded-lg border border-border bg-secondary/30 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{campaign.name}</p>
                            <p className="text-sm text-muted-foreground line-clamp-2">{campaign.message}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${statusClass(campaign.status)}`}>
                            {statusLabel(campaign.status)}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatDate(campaign.createdAt)}</span>
                        </div>
                      </div>
                      {campaign.promotionName && (
                        <div className="text-xs text-primary">Promo vinculada: {campaign.promotionName}</div>
                      )}
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{campaign.sentCount} enviados / {campaign.failedCount} fallidos</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </AnimatedPage>

      <Dialog open={isPromoDialogOpen} onOpenChange={setIsPromoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva promocion</DialogTitle>
            <DialogDescription>
              Elige producto, tipo de promo y duracion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Nombre promocion" value={promoName} onChange={(e) => setPromoName(e.target.value)} />
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Producto</label>
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  className="pl-9"
                  placeholder="Buscar producto"
                  value={promoProductSearch}
                  onChange={(e) => setPromoProductSearch(e.target.value)}
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border bg-background/40">
                {filteredProducts.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    No encontramos productos para seleccionar.
                  </div>
                ) : (
                  filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={`w-full text-left px-3 py-2.5 transition ${
                        promoProductId === product.id
                          ? 'bg-primary/15 text-foreground'
                          : 'hover:bg-secondary/70 text-foreground'
                      }`}
                      onClick={() => setPromoProductId(product.id)}
                    >
                      <p className="text-sm">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(product.price)}</p>
                    </button>
                  ))
                )}
              </div>
              {selectedPromoProduct && (
                <p className="text-xs text-muted-foreground">
                  Seleccionado: <span className="text-foreground">{selectedPromoProduct.name}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={promoType}
                onValueChange={(value) =>
                  setPromoType(value as 'percentage' | 'fixed_price' | 'second_unit_percentage' | 'buy_x_pay_y')
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje</SelectItem>
                  <SelectItem value="fixed_price">Precio fijo</SelectItem>
                  <SelectItem value="second_unit_percentage">Descuento 2da unidad</SelectItem>
                  <SelectItem value="buy_x_pay_y">Promo X por Y</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder={
                  promoType === 'percentage' || promoType === 'second_unit_percentage'
                    ? 'Valor %'
                    : promoType === 'fixed_price'
                      ? 'Precio fijo en centavos'
                      : 'No aplica (se usa X por Y)'
                }
                value={promoValue}
                onChange={(e) => setPromoValue(e.target.value)}
                disabled={promoType === 'buy_x_pay_y'}
              />
            </div>
            {promoType === 'buy_x_pay_y' && (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Lleva X"
                  value={promoBuyQuantity}
                  onChange={(e) => setPromoBuyQuantity(e.target.value)}
                />
                <Input
                  placeholder="Paga Y"
                  value={promoPayQuantity}
                  onChange={(e) => setPromoPayQuantity(e.target.value)}
                />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Inicio</label>
                <Input type="datetime-local" value={promoStartsAt} onChange={(e) => setPromoStartsAt(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fin</label>
                <Input type="datetime-local" value={promoEndsAt} onChange={(e) => setPromoEndsAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Imagen de promo (opcional)</label>
                {promoImageFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPromoImageFile(null);
                      setPromoImagePreview('');
                      setPromoImageInputKey((prev) => prev + 1);
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Quitar
                  </Button>
                )}
              </div>
              <label className="flex flex-col items-center justify-center w-full h-28 rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50 transition-all cursor-pointer">
                {promoImageFile ? (
                  <>
                    <ImageIcon className="w-6 h-6 text-primary mb-1.5" />
                    <span className="text-sm text-foreground font-medium">{promoImageFile.name}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">Click para cambiar imagen</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                    <span className="text-sm text-muted-foreground">Subir imagen para la promo</span>
                    <span className="text-xs text-muted-foreground/60 mt-0.5">JPG, PNG, WebP, GIF (max. 5MB)</span>
                  </>
                )}
                <input
                  key={promoImageInputKey}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    void handlePromoImageSelected(e.target.files?.[0] || null);
                  }}
                  className="hidden"
                />
              </label>
              {promoImagePreview && (
                <img
                  src={promoImagePreview}
                  alt="Vista previa promo"
                  className="w-full h-32 object-contain rounded-xl border border-border bg-secondary/20"
                />
              )}
            </div>
            <Button
              className="w-full"
              disabled={isCreatingPromo || isCommunicationsLimitReached}
              onClick={() => void handleCreatePromotion()}
            >
              {isCreatingPromo ? 'Creando...' : 'Crear promocion'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCampaignDialogOpen} onOpenChange={setIsCampaignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva difusion</DialogTitle>
            <DialogDescription>
              Envia mensaje masivo por WhatsApp Evolution. Se enviara a todos los clientes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Nombre campana" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
            <Textarea
              placeholder="Mensaje de difusion"
              value={campaignMessage}
              onChange={(e) => setCampaignMessage(e.target.value)}
              rows={5}
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Imagen de difusion (opcional)</label>
                {campaignImageFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCampaignImageFile(null);
                      setCampaignImagePreview('');
                      setCampaignImageInputKey((prev) => prev + 1);
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Quitar
                  </Button>
                )}
              </div>
              <label className="flex flex-col items-center justify-center w-full h-28 rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50 transition-all cursor-pointer">
                {campaignImageFile ? (
                  <>
                    <ImageIcon className="w-6 h-6 text-primary mb-1.5" />
                    <span className="text-sm text-foreground font-medium">{campaignImageFile.name}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">Click para cambiar imagen</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                    <span className="text-sm text-muted-foreground">Subir imagen para la difusion</span>
                    <span className="text-xs text-muted-foreground/60 mt-0.5">JPG, PNG, WebP, GIF (max. 5MB)</span>
                  </>
                )}
                <input
                  key={campaignImageInputKey}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    void handleCampaignImageSelected(e.target.files?.[0] || null);
                  }}
                  className="hidden"
                />
              </label>
              {campaignImagePreview && (
                <img
                  src={campaignImagePreview}
                  alt="Vista previa difusion"
                  className="w-full h-32 object-contain rounded-xl border border-border bg-secondary/20"
                />
              )}
            </div>
            <Select value={campaignPromotionId} onValueChange={setCampaignPromotionId}>
              <SelectTrigger>
                <SelectValue placeholder="Vincular promocion (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin promocion</SelectItem>
                {promotionOptions.map((promotion) => (
                  <SelectItem key={promotion.id} value={promotion.id}>
                    {promotion.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              El envio se procesa en cola y puede tardar algunos minutos.
            </div>
            <Button
              className="w-full"
              disabled={isCreatingCampaign || isCommunicationsLimitReached}
              onClick={() => void handleCreateCampaign()}
            >
              {isCreatingCampaign ? 'Encolando...' : 'Enviar difusion'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmModal
        isOpen={promotionToDelete !== null}
        onClose={() => {
          if (!isDeletingPromotion) setPromotionToDelete(null);
        }}
        onConfirm={handleDeletePromotion}
        isLoading={isDeletingPromotion}
        title="Eliminar promocion"
        message={
          promotionToDelete
            ? `¿Eliminar "${promotionToDelete.name}" del listado?`
            : '¿Eliminar esta promocion del listado?'
        }
      />
    </div>
  );
}
