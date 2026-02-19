import { Megaphone, Percent, BadgeDollarSign, Send, Image as ImageIcon, Clock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { apiFetch } from '../../lib/api';
import { useToast } from '../../stores/toast.store';

type JsonRecord = Record<string, unknown>;

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

interface ProductOption {
  id: string;
  name: string;
  price: number;
}

interface PromotionView {
  id: string;
  name: string;
  promoType: string;
  value: number;
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

export default function CommunicationsPage(): JSX.Element {
  const { workspace } = useAuth();
  const toast = useToast();

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
  const [promoType, setPromoType] = useState<'percentage' | 'fixed_price'>('percentage');
  const [promoValue, setPromoValue] = useState('');
  const [promoStartsAt, setPromoStartsAt] = useState(toLocalDatetimeValue(new Date().toISOString()));
  const [promoEndsAt, setPromoEndsAt] = useState(toLocalDatetimeValue(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()));

  const [campaignName, setCampaignName] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignImageUrl, setCampaignImageUrl] = useState('');
  const [campaignPromotionId, setCampaignPromotionId] = useState('none');

  const promotionOptions = useMemo(
    () =>
      promotions
        .filter((promotion) => promotion.computedStatus === 'active')
        .map((promotion) => ({ id: promotion.id, label: promotion.name })),
    [promotions]
  );

  const loadAll = useCallback(async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsLoading(true);
    try {
      const [productsRes, promotionsRes, campaignsRes, metricsRes] = await Promise.all([
        apiFetch('/api/v1/products?limit=200', {}, workspace.id),
        apiFetch('/api/v1/communications/promotions?limit=100', {}, workspace.id),
        apiFetch('/api/v1/communications/campaigns?limit=100', {}, workspace.id),
        apiFetch('/api/v1/communications/metrics', {}, workspace.id),
      ]);

      if (productsRes.ok) {
        const data = await readJsonRecord(productsRes);
        const parsed = asRecordList(data.products).map((item) => ({
          id: readString(item, 'id') || '',
          name: readString(item, 'name') || 'Producto',
          price: readNumber(item, 'price'),
        }));
        setProducts(parsed.filter((item) => item.id));
      }

      if (promotionsRes.ok) {
        const data = await readJsonRecord(promotionsRes);
        const parsed = asRecordList(data.promotions).map((item) => {
          const product = readObject(item, 'product');
          const metricsItem = readObject(item, 'metrics');
          return {
            id: readString(item, 'id') || '',
            name: readString(item, 'name') || 'Promo',
            promoType: readString(item, 'promoType') || 'percentage',
            value: readNumber(item, 'value'),
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
      }

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
      }

      if (metricsRes.ok) {
        const data = await readJsonRecord(metricsRes);
        const promotionsData = readObject(data, 'promotions');
        const ordersData = readObject(data, 'orders');
        const withPromo = readObject(ordersData, 'withPromotion');
        const withoutPromo = readObject(ordersData, 'withoutPromotion');
        const campaignsData = readObject(data, 'campaigns');
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
        });
      }
    } catch (error) {
      console.error('Failed to load communications data:', error);
      toast.error('No se pudo cargar comunicacion');
    } finally {
      setIsLoading(false);
    }
  }, [toast, workspace?.id]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreatePromotion = async (): Promise<void> => {
    if (!workspace?.id) return;
    if (!promoName.trim() || !promoProductId || !promoValue || !promoStartsAt || !promoEndsAt) {
      toast.error('Completa todos los campos de la promocion');
      return;
    }

    const value = Number(promoValue);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('El valor de la promocion no es valido');
      return;
    }

    setIsCreatingPromo(true);
    try {
      const response = await apiFetch(
        '/api/v1/communications/promotions',
        {
          method: 'POST',
          body: JSON.stringify({
            name: promoName.trim(),
            productId: promoProductId,
            promoType,
            value,
            startsAt: new Date(promoStartsAt).toISOString(),
            endsAt: new Date(promoEndsAt).toISOString(),
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
      setPromoType('percentage');
      setPromoValue('');
      setPromoStartsAt(toLocalDatetimeValue(new Date().toISOString()));
      setPromoEndsAt(toLocalDatetimeValue(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()));
      toast.success('Promocion creada');
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la promocion');
    } finally {
      setIsCreatingPromo(false);
    }
  };

  const handleCreateCampaign = async (): Promise<void> => {
    if (!workspace?.id) return;
    if (!campaignName.trim() || !campaignMessage.trim()) {
      toast.error('Completa nombre y mensaje de la difusion');
      return;
    }

    setIsCreatingCampaign(true);
    try {
      const response = await apiFetch(
        '/api/v1/communications/campaigns',
        {
          method: 'POST',
          body: JSON.stringify({
            name: campaignName.trim(),
            message: campaignMessage.trim(),
            imageUrl: campaignImageUrl.trim() || null,
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
      setCampaignImageUrl('');
      setCampaignPromotionId('none');
      toast.success('Difusion enviada a cola');
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo lanzar la difusion');
    } finally {
      setIsCreatingCampaign(false);
    }
  };

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
            <Button variant="secondary" onClick={() => setIsPromoDialogOpen(true)}>
              <Percent className="w-4 h-4 mr-2" />
              Nueva promocion
            </Button>
            <Button onClick={() => setIsCampaignDialogOpen(true)}>
              <Send className="w-4 h-4 mr-2" />
              Nueva difusion
            </Button>
          </div>
        </div>

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
                    </tr>
                  </thead>
                  <tbody>
                    {promotions.map((promotion) => (
                      <tr key={promotion.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-4">
                          <p className="font-medium text-foreground">{promotion.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {promotion.promoType === 'percentage'
                              ? `${promotion.value}%`
                              : `Precio fijo ${formatCurrency(promotion.value)}`}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm text-foreground">{promotion.productName}</p>
                          <p className="text-xs text-muted-foreground">Base: {formatCurrency(promotion.productPrice)}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">
                          {promotion.promoType === 'percentage' ? 'Porcentaje' : 'Precio fijo'}
                        </td>
                        <td className="px-5 py-4 text-right text-sm text-foreground">{promotion.orderCount}</td>
                        <td className="px-5 py-4 text-right text-sm text-foreground">{formatCurrency(promotion.revenue)}</td>
                        <td className="px-5 py-4 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs ${statusClass(promotion.computedStatus)}`}>
                            {promotion.computedStatus}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">{formatDate(promotion.endsAt)}</td>
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
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium text-foreground">{campaign.name}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2">{campaign.message}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${statusClass(campaign.status)}`}>
                            {campaign.status}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatDate(campaign.createdAt)}</span>
                        </div>
                      </div>
                      {campaign.imageUrl && (
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5" />
                          Incluye imagen
                        </div>
                      )}
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
            <Select value={promoProductId} onValueChange={setPromoProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Producto" />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({formatCurrency(product.price)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Select value={promoType} onValueChange={(value) => setPromoType(value as 'percentage' | 'fixed_price')}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje</SelectItem>
                  <SelectItem value="fixed_price">Precio fijo</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder={promoType === 'percentage' ? 'Valor %' : 'Precio fijo en centavos'}
                value={promoValue}
                onChange={(e) => setPromoValue(e.target.value)}
              />
            </div>
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
            <Button className="w-full" disabled={isCreatingPromo} onClick={() => void handleCreatePromotion()}>
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
            <Input
              placeholder="URL imagen (opcional)"
              value={campaignImageUrl}
              onChange={(e) => setCampaignImageUrl(e.target.value)}
            />
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
            <Button className="w-full" disabled={isCreatingCampaign} onClick={() => void handleCreateCampaign()}>
              {isCreatingCampaign ? 'Encolando...' : 'Enviar difusion'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

