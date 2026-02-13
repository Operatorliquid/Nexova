import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Printer, RefreshCw, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  AnimatedPage,
} from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useToast } from '../../stores/toast.store';
import { Link } from 'react-router-dom';
import { PENDING_INVOICING_BADGE } from '../../lib/statusStyles';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  customer: {
    id: string;
    phone: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    cuit?: string | null;
    vatCondition?: string | null;
    businessName?: string | null;
    fiscalAddress?: string | null;
  };
  itemCount: number;
  items?: OrderItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  notes?: string | null;
  createdAt: string;
}

interface ArcaStatus {
  connected: boolean;
  status: string;
  cuit?: string;
  pointOfSale?: number;
}

interface InvoiceResult {
  approved: boolean;
  cae?: string;
  caeExpiresAt?: string | null;
  cbteNro?: number | null;
  cbteTipo?: number | null;
  pointOfSale?: number | null;
}

interface ExistingInvoice {
  id: string;
  orderId: string | null;
  cuit: string;
  pointOfSale: number;
  cbteTipo: number;
  cbteNro: number;
  cae: string | null;
  caeExpiresAt: string | null;
  total: number;
  currency: string;
  status: string;
  createdAt: string;
}

interface BillingSummary {
  range: {
    month: { from: string; to: string };
    year: { from: string; to: string };
  };
  totals: {
    month: { inside: number; outside: number; total: number };
    year: { inside: number; outside: number; total: number };
  };
  limits: {
    category: string;
    activity: string;
    month: { limit: number; used: number; remaining: number; percent: number } | null;
    year: { limit: number; used: number; remaining: number; percent: number } | null;
  } | null;
  sync: { ok: boolean; error?: string | null };
}

type BillingLimit = { limit: number; used: number; remaining: number; percent: number };

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  awaiting_acceptance: { label: 'Esperando aprobacion', className: 'bg-amber-500/20 text-amber-400' },
  accepted: { label: 'Aceptado', className: 'bg-emerald-500/20 text-emerald-400' },
  pending_invoicing: { label: PENDING_INVOICING_BADGE.label, className: PENDING_INVOICING_BADGE.pill },
  invoiced: { label: 'Facturado', className: 'bg-emerald-500/20 text-emerald-400' },
  invoice_cancelled: { label: 'Factura cancelada', className: 'bg-red-500/20 text-red-400' },
  cancelled: { label: 'Cancelado', className: 'bg-red-500/20 text-red-400' },
  paid: { label: 'Pagado', className: 'bg-emerald-500/20 text-emerald-400' },
  pending_payment: { label: 'Pendiente de pago', className: 'bg-amber-500/20 text-amber-400' },
  partial_payment: { label: 'Pago parcial', className: 'bg-cyan-500/20 text-cyan-400' },
};

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

const VAT_CONDITION_LABELS = IVA_CONDITIONS.reduce<Record<string, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const VAT_CONDITION_LOOKUP = IVA_CONDITIONS.reduce<Record<string, string>>((acc, item) => {
  acc[normalizeText(item.label)] = item.value;
  return acc;
}, {});

const formatVatCondition = (value?: string | number | null) => {
  if (value === null || value === undefined) return 'No registrada';
  const raw = typeof value === 'number' ? String(value) : value;
  const trimmed = raw.trim();
  if (!trimmed) return 'No registrada';
  return VAT_CONDITION_LABELS[trimmed] || raw;
};

const normalizeVatConditionId = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const normalized = normalizeText(trimmed);
  return VAT_CONDITION_LOOKUP[normalized] || null;
};

const resolveInvoiceType = (
  commerceVat?: string | null,
  customerVat?: string | null
): { cbteTipo: number; label: string } => {
  const commerce = commerceVat ? commerceVat.trim() : '';
  const customer = customerVat ? customerVat.trim() : '';

  const commerceIsRI = commerce === '1';
  const commerceIsMonotributo = ['6', '13', '16'].includes(commerce);

  if (commerceIsRI) {
    if (customer === '1') {
      return { cbteTipo: 1, label: 'Factura A' };
    }
    return { cbteTipo: 6, label: 'Factura B' };
  }

  if (commerceIsMonotributo) {
    return { cbteTipo: 11, label: 'Factura C' };
  }

  // Default fallback
  return { cbteTipo: 11, label: 'Factura C' };
};

const formatCurrency = (amount: number) => `$${(amount / 100).toLocaleString('es-AR')}`;
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatOrderDate = (value?: string) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatArcaDate = (value?: string | null) => {
  if (!value) return '—';
  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('es-AR');
  }
  return value;
};

const formatCbteTipoLabel = (cbteTipo?: number | null) => {
  if (!cbteTipo) return 'Factura';
  if (cbteTipo === 1) return 'Factura A';
  if (cbteTipo === 6) return 'Factura B';
  if (cbteTipo === 11) return 'Factura C';
  return `Comprobante ${cbteTipo}`;
};

const formatCbteNumber = (pointOfSale?: number, cbteNro?: number | null) => {
  if (!cbteNro) return '—';
  const pv = pointOfSale ? String(pointOfSale).padStart(4, '0') : '0000';
  const nro = String(cbteNro).padStart(8, '0');
  return `${pv}-${nro}`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getCustomerName = (customer: Order['customer']) => {
  if (customer.name) return customer.name;
  if (customer.firstName && customer.lastName) return `${customer.firstName} ${customer.lastName}`;
  return customer.firstName || customer.lastName || customer.phone;
};

export default function InvoicesPage() {
  const { workspace } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [arcaStatus, setArcaStatus] = useState<ArcaStatus | null>(null);
  const [isLoadingArca, setIsLoadingArca] = useState(true);
  const [commerceVatConditionId, setCommerceVatConditionId] = useState<string | null>(null);
  const [commerceBusinessName, setCommerceBusinessName] = useState<string | null>(null);
  const [isLoadingCommerce, setIsLoadingCommerce] = useState(true);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<InvoiceResult | null>(null);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoiceSendError, setInvoiceSendError] = useState('');
  const [existingInvoice, setExistingInvoice] = useState<ExistingInvoice | null>(null);
  const [isLoadingExistingInvoice, setIsLoadingExistingInvoice] = useState(false);
  const [existingInvoiceError, setExistingInvoiceError] = useState('');

  const summaryCategoryLabel = billingSummary?.limits
    ? `Cat. ${billingSummary.limits.category} · ${billingSummary.limits.activity === 'goods' ? 'Bienes' : 'Servicios'}`
    : null;

  const fetchOrders = async () => {
    if (!workspace?.id) return;
    setIsLoading(true);
    try {
      const baseParams: Record<string, string> = {
        limit: '100',
      };
      if (search) {
        baseParams.search = search;
      }

      const buildParams = (status: string) => {
        const params = new URLSearchParams(baseParams);
        params.set('status', status);
        return params.toString();
      };

      // API only supports a single `status` filter, so we fetch both and merge.
      const [pendingRes, invoicedRes] = await Promise.all([
        apiFetch(`/api/v1/orders?${buildParams('pending_invoicing')}`, {}, workspace.id),
        apiFetch(`/api/v1/orders?${buildParams('invoiced')}`, {}, workspace.id),
      ]);

      if (!pendingRes.ok && !invoicedRes.ok) {
        throw new Error('No se pudieron cargar los pedidos');
      }

      const pendingData = pendingRes.ok ? await pendingRes.json().catch(() => ({})) : {};
      const invoicedData = invoicedRes.ok ? await invoicedRes.json().catch(() => ({})) : {};

      const merged = new Map<string, Order>();
      [...(pendingData.orders || []), ...(invoicedData.orders || [])].forEach((order: Order) => {
        if (order?.id && !merged.has(order.id)) {
          merged.set(order.id, order);
        }
      });

      const sorted = Array.from(merged.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setOrders(sorted);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      toast.error('No se pudieron cargar los pedidos');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchOrderDetail = async (orderId: string) => {
    if (!workspace?.id) return;
    setIsLoadingDetail(true);
    try {
      const response = await apiFetch(`/api/v1/orders/${orderId}`, {}, workspace.id);
      if (!response.ok) {
        throw new Error('Error al cargar el pedido');
      }
      const data = await response.json();
      setSelectedOrder(data.order || null);
    } catch (error) {
      console.error('Failed to fetch order detail:', error);
      toast.error('No se pudo cargar el detalle del pedido');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const fetchExistingInvoice = async (orderId: string) => {
    if (!workspace?.id) return;
    setIsLoadingExistingInvoice(true);
    setExistingInvoiceError('');
    try {
      const response = await apiFetch(
        `/api/v1/integrations/arca/invoices/by-order/${orderId}`,
        {},
        workspace.id
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'No se pudo cargar la factura');
      }
      const data = await response.json();
      setExistingInvoice(data.invoice || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar la factura';
      setExistingInvoiceError(message);
      setExistingInvoice(null);
    } finally {
      setIsLoadingExistingInvoice(false);
    }
  };

  const fetchSummary = async () => {
    if (!workspace?.id) return;
    setIsLoadingSummary(true);
    setSummaryError('');
    try {
      const response = await apiFetch('/api/v1/integrations/arca/summary', {}, workspace.id);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'No se pudo cargar el resumen');
      }
      const data = await response.json();
      setBillingSummary(data);
      if (data?.sync?.error) {
        setSummaryError(String(data.sync.error));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar el resumen';
      setSummaryError(message);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const fetchArcaStatus = async () => {
    if (!workspace?.id) return;
    setIsLoadingArca(true);
    try {
      const response = await apiFetch('/api/v1/integrations/arca/status', {}, workspace.id);
      if (response.ok) {
        const data = await response.json();
        setArcaStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch ARCA status:', error);
    } finally {
      setIsLoadingArca(false);
    }
  };

  const fetchCommerceSettings = async () => {
    if (!workspace?.id) return;
    setIsLoadingCommerce(true);
    try {
      const response = await apiFetch(`/api/v1/workspaces/${workspace.id}`, {}, workspace.id);
      if (response.ok) {
        const data = await response.json();
        const settings = data.workspace?.settings || {};
        setCommerceVatConditionId(settings.vatConditionId || null);
        setCommerceBusinessName(settings.businessName || null);
      } else {
        setCommerceVatConditionId(null);
        setCommerceBusinessName(null);
      }
    } catch (error) {
      console.error('Failed to fetch commerce settings:', error);
      setCommerceVatConditionId(null);
      setCommerceBusinessName(null);
    } finally {
      setIsLoadingCommerce(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [workspace?.id, search]);

  useEffect(() => {
    fetchArcaStatus();
  }, [workspace?.id]);

  useEffect(() => {
    fetchCommerceSettings();
  }, [workspace?.id]);

  useEffect(() => {
    fetchSummary();
  }, [workspace?.id]);

  const selectedOrderTotal = selectedOrder?.total ?? 0;
  const selectedOrderItems = selectedOrder?.items || [];
  const customer = selectedOrder?.customer;
  const customerCuitDigits = customer?.cuit ? customer.cuit.replace(/\D/g, '') : '';
  const invoiceType = resolveInvoiceType(commerceVatConditionId, customer?.vatCondition || null);
  const customerVatConditionId = normalizeVatConditionId(customer?.vatCondition || null);
  const hasCustomerFiscalData = Boolean(
    customerCuitDigits &&
      customerCuitDigits.length === 11 &&
      customer?.businessName &&
      customer?.fiscalAddress &&
      customerVatConditionId
  );
  const canCreateInvoice = Boolean(
    selectedOrder &&
      selectedOrder.status === 'pending_invoicing' &&
      arcaStatus?.connected &&
      !isCreating &&
      !isLoadingDetail &&
      hasCustomerFiscalData &&
      commerceVatConditionId
  );

  const renderLimitBar = (limit: BillingLimit | null) => {
    if (!limit) return null;
    const percent = Number.isFinite(limit.percent) ? limit.percent : 0;
    const color =
      percent >= 0.9 ? 'bg-red-500' : percent >= 0.7 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Límite: {formatCurrency(limit.limit)}</span>
          <span>{formatPercent(percent)}</span>
        </div>
        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${Math.min(percent * 100, 100)}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">
          Restante: <span className="text-foreground">{formatCurrency(limit.remaining)}</span>
        </div>
      </div>
    );
  };


  const handleSelectOrder = (order: Order) => {
    setSelectedOrder(order);
    setInvoiceResult(null);
    setInvoiceError('');
    setExistingInvoice(null);
    setExistingInvoiceError('');
    fetchOrderDetail(order.id);
    if (order.status === 'invoiced') {
      fetchExistingInvoice(order.id);
    }
  };

  const handleCreateInvoice = async () => {
    if (!workspace?.id || !selectedOrder) return;
    if (selectedOrder.status !== 'pending_invoicing') {
      setInvoiceError('Este pedido no está pendiente de facturación.');
      return;
    }
    if (!arcaStatus?.connected) {
      setInvoiceError('ARCA no está conectado.');
      return;
    }
    if (!commerceVatConditionId) {
      setInvoiceError('Configurá la condición frente al IVA del comercio antes de emitir facturas.');
      return;
    }
    if (!customer) {
      setInvoiceError('No se encontraron los datos del cliente.');
      return;
    }
    const cuitDigits = customer.cuit ? customer.cuit.replace(/\D/g, '') : '';
    if (!cuitDigits || cuitDigits.length !== 11) {
      setInvoiceError('El cliente no tiene un CUIT válido.');
      return;
    }
    if (!customer.businessName || !customer.fiscalAddress || !customer.vatCondition) {
      setInvoiceError('Faltan datos fiscales del cliente.');
      return;
    }
    const vatIdValue = normalizeVatConditionId(customer.vatCondition || null);
    if (!vatIdValue) {
      setInvoiceError('La condición IVA del cliente no es válida.');
      return;
    }
    const vatId = Number(vatIdValue);
    if (Number.isNaN(vatId)) {
      setInvoiceError('La condición IVA del cliente no es válida.');
      return;
    }

    setIsCreating(true);
    setInvoiceError('');
    setInvoiceResult(null);
    setInvoiceSendError('');

    try {
      const today = new Date();
      const cbteFch = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
        today.getDate()
      ).padStart(2, '0')}`;
      const total = Number((selectedOrder.total / 100).toFixed(2));

      const payload = {
        orderId: selectedOrder.id,
        cbteTipo: invoiceType.cbteTipo,
        concept: 1,
        docTipo: 80,
        docNro: Number(cuitDigits),
        cbteFch,
        condicionIVAReceptorId: vatId,
        impTotal: total,
        impNeto: total,
        impIVA: 0,
        impTrib: 0,
        impOpEx: 0,
        impTotConc: 0,
        monId: 'PES',
        monCotiz: 1,
      };

      const response = await apiFetch('/api/v1/integrations/arca/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      }, workspace.id);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Error al emitir la factura');
      }

      const data = await response.json();
      setInvoiceResult({
        approved: Boolean(data.approved),
        cae: data.cae,
        caeExpiresAt: data.caeExpiresAt,
        cbteNro: data.cbteNro,
        cbteTipo: invoiceType.cbteTipo,
        pointOfSale: arcaStatus?.pointOfSale ?? null,
      });

      if (data.approved) {
        toast.success('Factura emitida correctamente');
        setSelectedOrder((prev) => (prev ? { ...prev, status: 'invoiced' } : prev));
        fetchExistingInvoice(selectedOrder.id);
        fetchOrders();
      } else {
        toast.warning('La factura fue rechazada por ARCA');
      }

      fetchSummary();
      return { approved: Boolean(data.approved) };
    } catch (error) {
      console.error('Failed to create invoice:', error);
      const message = error instanceof Error ? error.message : 'Error al emitir la factura';
      setInvoiceError(message);
      toast.error(message);
      return { approved: false };
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!workspace?.id || !selectedOrder) return;
    setIsSendingInvoice(true);
    setInvoiceSendError('');
    try {
      const response = await apiFetch(
        `/api/v1/integrations/arca/invoices/${selectedOrder.id}/send`,
        { method: 'POST', body: JSON.stringify({}) },
        workspace.id
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'No se pudo enviar la factura');
      }

      await response.json().catch(() => ({}));
      toast.success('Factura enviada al cliente');
    } catch (error) {
      console.error('Failed to send invoice:', error);
      const message = error instanceof Error ? error.message : 'No se pudo enviar la factura';
      setInvoiceSendError(message);
      toast.error(message);
    } finally {
      setIsSendingInvoice(false);
    }
  };

  const handleCreateAndSendInvoice = async () => {
    const result = await handleCreateInvoice();
    if (result?.approved) {
      await handleSendInvoice();
    }
  };

  const handlePrint = () => {
    if (!selectedOrder) return;
    const invoice = existingInvoice
      ? {
          approved: existingInvoice.status === 'authorized',
          cae: existingInvoice.cae || undefined,
          caeExpiresAt: existingInvoice.caeExpiresAt,
          cbteNro: existingInvoice.cbteNro,
          cbteTipo: existingInvoice.cbteTipo,
          pointOfSale: existingInvoice.pointOfSale,
        }
      : invoiceResult;
    if (!invoice) return;
    const items = selectedOrder.items || [];
    const customerName = getCustomerName(selectedOrder.customer);
    const businessName = commerceBusinessName || workspace?.name || 'Nexova';
    const invoiceTypeLabel = formatCbteTipoLabel(invoice.cbteTipo) || invoiceType.label;
    const pointOfSale = invoice.pointOfSale ?? arcaStatus?.pointOfSale;
    const html = `
      <html>
        <head>
          <title>Factura ${escapeHtml(selectedOrder.orderNumber)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
            h1 { font-size: 20px; margin: 0 0 8px; }
            .muted { color: #64748b; font-size: 12px; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
            .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
            .totals { margin-top: 12px; text-align: right; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1>${escapeHtml(businessName)}</h1>
              <div class="muted">${escapeHtml(invoiceTypeLabel)} · ${escapeHtml(formatCbteNumber(pointOfSale, invoice.cbteNro))}</div>
              <div class="muted">Pedido ${escapeHtml(selectedOrder.orderNumber)}</div>
            </div>
            <div class="muted">
              <div>CAE: ${escapeHtml(invoice.cae || '—')}</div>
              <div>Venc. CAE: ${escapeHtml(formatArcaDate(invoice.caeExpiresAt))}</div>
            </div>
          </div>
          <div class="card">
            <div><strong>Cliente:</strong> ${escapeHtml(customerName)}</div>
            <div><strong>Telefono:</strong> ${escapeHtml(selectedOrder.customer.phone)}</div>
            <div><strong>Fecha:</strong> ${escapeHtml(formatOrderDate(selectedOrder.createdAt))}</div>
          </div>
          <div class="card">
            <strong>Detalle</strong>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (item) => `
                    <tr>
                      <td>${escapeHtml(item.name)}</td>
                      <td>${item.quantity}</td>
                      <td>${escapeHtml(formatCurrency(item.unitPrice))}</td>
                      <td>${escapeHtml(formatCurrency(item.total))}</td>
                    </tr>
                  `
                  )
                  .join('')}
              </tbody>
            </table>
            <div class="totals"><strong>Total:</strong> ${escapeHtml(formatCurrency(selectedOrder.total))}</div>
          </div>
          <script>
            window.onload = () => {
              window.print();
              window.onafterprint = () => window.close();
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Facturación</h1>
            <p className="text-sm text-muted-foreground">Emití facturas ARCA para pedidos con solicitud.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={fetchOrders} disabled={isLoading}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Actualizar
            </Button>
          </div>
        </div>

        {arcaStatus && !isLoadingArca && !arcaStatus.connected && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">ARCA no está conectado</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Conectá ARCA para poder emitir facturas electrónicas.
            </p>
            <div>
              <Link to="/settings/applications">
                <Button size="sm" variant="outline">Ir a aplicaciones</Button>
              </Link>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Estado de facturación</h3>
              <p className="text-xs text-muted-foreground">
                Totales dentro y fuera de Nexova para el mes y el año en curso.
              </p>
            </div>
            {summaryCategoryLabel && (
              <Badge className="bg-primary/15 text-primary">{summaryCategoryLabel}</Badge>
            )}
          </div>

          {summaryError && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
              {summaryError}
            </div>
          )}

          {isLoadingSummary && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[0, 1].map((item) => (
                <div key={item} className="glass-card rounded-2xl animate-pulse p-4 space-y-3">
                  <div className="animate-pulse rounded-lg bg-secondary h-4 w-32" />
                  <div className="animate-pulse rounded-lg bg-secondary h-7 w-24 mt-1" />
                  <div className="animate-pulse rounded-lg bg-secondary h-3 w-full" />
                </div>
              ))}
            </div>
          )}

          {!isLoadingSummary && billingSummary && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {([
                { label: 'Este mes', totals: billingSummary.totals.month, limit: billingSummary.limits?.month || null },
                { label: 'Año en curso', totals: billingSummary.totals.year, limit: billingSummary.limits?.year || null },
              ] as const).map((item) => (
                <div key={item.label} className="glass-card rounded-2xl hover:shadow-2xl transition-all duration-300">
                  <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{item.label}</p>
                        <p className="text-xs text-muted-foreground">Total facturado</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-foreground">{formatCurrency(item.totals.total)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                      <div className="rounded-xl border border-border bg-secondary/40 p-3">
                        <p className="text-[11px] uppercase tracking-wide">Nexova</p>
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(item.totals.inside)}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-secondary/40 p-3">
                        <p className="text-[11px] uppercase tracking-wide">Fuera de Nexova</p>
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(item.totals.outside)}</p>
                      </div>
                    </div>
                    {item.limit ? (
                      renderLimitBar(item.limit)
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Configurá la categoría y actividad del monotributo para ver el tope.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-6">
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">Pedidos con solicitud</h3>
                <Badge className="bg-primary/15 text-primary">{orders.length} pedidos</Badge>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por cliente o pedido"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="p-5">
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {isLoading && (
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                )}
                {!isLoading && orders.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                      <FileText className="w-7 h-7 text-muted-foreground/50" />
                    </div>
                    <p className="text-muted-foreground">No hay pedidos con solicitud de factura</p>
                    <p className="text-sm text-muted-foreground/50 mt-1">
                      Los pedidos con solicitud de facturación aparecerán acá
                    </p>
                  </div>
                )}
                {!isLoading && orders.map((order) => {
                  const status = STATUS_CONFIG[order.status] || { label: order.status, className: 'bg-muted text-muted-foreground' };
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => handleSelectOrder(order)}
                      className={cn(
                        'w-full text-left p-4 rounded-2xl border border-border hover:bg-secondary/50 transition-all',
                        selectedOrder?.id === order.id && 'border-primary/30 bg-primary/5'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Pedido {order.orderNumber}</p>
                          <p className="text-xs text-muted-foreground">{getCustomerName(order.customer)}</p>
                        </div>
                        <Badge className={status.className}>{status.label}</Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{formatOrderDate(order.createdAt)}</span>
                        <span className="font-semibold text-foreground">{formatCurrency(order.total)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Crear factura</h3>
                  <p className="text-xs text-muted-foreground">Seleccioná un pedido y completá los datos fiscales.</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {!selectedOrder && (
                <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                  <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                    <FileText className="w-7 h-7 text-muted-foreground/50" />
                  </div>
                  <p className="text-muted-foreground">Elegí un pedido para emitir la factura</p>
                  <p className="text-sm text-muted-foreground/50 mt-1">Seleccioná uno de la lista de la izquierda</p>
                </div>
              )}

              {selectedOrder && (
                <div key={selectedOrder.id} className="space-y-4 animate-slide-up">
                  <div className="p-4 rounded-2xl border border-border bg-secondary">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Pedido {selectedOrder.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">{getCustomerName(selectedOrder.customer)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-lg font-semibold text-foreground">{formatCurrency(selectedOrderTotal)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{formatOrderDate(selectedOrder.createdAt)}</span>
                      <span>•</span>
                      <span>{selectedOrder.itemCount} items</span>
                      {arcaStatus?.pointOfSale ? (
                        <>
                          <span>•</span>
                          <span>PV {arcaStatus.pointOfSale}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Detalle del pedido</p>
                    <div className="rounded-2xl border border-border divide-y divide-border">
                      {isLoadingDetail && (
                        <div className="flex items-center justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                        </div>
                      )}
                      {!isLoadingDetail && selectedOrderItems.length === 0 && (
                        <div className="p-3 text-xs text-muted-foreground">No hay items en este pedido.</div>
                      )}
                      {!isLoadingDetail && selectedOrderItems.map((item) => (
                        <div key={item.id} className="p-3 flex items-center justify-between text-sm">
                          <div>
                            <p className="font-medium text-foreground">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{item.quantity} uds · {formatCurrency(item.unitPrice)} c/u</p>
                          </div>
                          <p className="font-semibold text-foreground">{formatCurrency(item.total)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">Datos fiscales del cliente</p>
                      <Badge className="bg-primary/10 text-primary">{invoiceType.label}</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-2xl border border-border bg-secondary/40 p-3 text-sm">
                        <p className="text-xs text-muted-foreground">CUIT</p>
                        <p className="font-semibold text-foreground">
                          {customer?.cuit || 'No registrado'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border bg-secondary/40 p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Razón social</p>
                        <p className="font-semibold text-foreground">
                          {customer?.businessName || 'No registrada'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border bg-secondary/40 p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Domicilio fiscal</p>
                        <p className="font-semibold text-foreground">
                          {customer?.fiscalAddress || 'No registrado'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border bg-secondary/40 p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Condición frente al IVA</p>
                        <p className="font-semibold text-foreground">
                          {formatVatCondition(customer?.vatCondition)}
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Condición IVA del comercio:{' '}
                      {isLoadingCommerce
                        ? 'Cargando...'
                        : commerceVatConditionId
                          ? formatVatCondition(commerceVatConditionId)
                          : 'Sin configurar'}
                    </div>
                  </div>

                  {selectedOrder && !hasCustomerFiscalData && (
                    <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
                      Faltan datos fiscales del cliente. Pedile completar CUIT, razón social, domicilio fiscal y condición IVA.
                    </div>
                  )}

                  {selectedOrder && selectedOrder.status === 'invoiced' && (
                    <div className="p-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300">
                      Este pedido ya está facturado.
                    </div>
                  )}

                  {selectedOrder && !isLoadingCommerce && !commerceVatConditionId && (
                    <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
                      Configurá la condición frente al IVA del comercio en Mi negocio para poder emitir facturas.
                    </div>
                  )}

                  {selectedOrder && selectedOrder.status === 'invoiced' && isLoadingExistingInvoice && (
                    <div className="p-3 rounded-2xl border border-border bg-secondary/40 text-xs text-muted-foreground">
                      Cargando datos de la factura...
                    </div>
                  )}

                  {selectedOrder && selectedOrder.status === 'invoiced' && existingInvoiceError && (
                    <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300">
                      {existingInvoiceError}
                    </div>
                  )}

                  {invoiceError && (
                    <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                      {invoiceError}
                    </div>
                  )}

                  {selectedOrder.status === 'pending_invoicing' && (
                    <Button
                      onClick={handleCreateAndSendInvoice}
                      isLoading={isCreating || isSendingInvoice}
                      disabled={!canCreateInvoice || isSendingInvoice}
                    >
                      Emitir factura y enviar al cliente
                    </Button>
                  )}

                  {selectedOrder.status === 'invoiced' && (
                    <Button
                      onClick={handleSendInvoice}
                      isLoading={isSendingInvoice}
                      disabled={isSendingInvoice || isLoadingExistingInvoice}
                    >
                      Enviar factura al cliente
                    </Button>
                  )}

                  {invoiceSendError && (
                    <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-400">
                      {invoiceSendError}
                    </div>
                  )}

                  {(existingInvoice || invoiceResult) && (() => {
                    const invoice = existingInvoice
                      ? {
                          approved: existingInvoice.status === 'authorized',
                          cae: existingInvoice.cae || undefined,
                          caeExpiresAt: existingInvoice.caeExpiresAt,
                          cbteNro: existingInvoice.cbteNro,
                          cbteTipo: existingInvoice.cbteTipo,
                          pointOfSale: existingInvoice.pointOfSale,
                        }
                      : invoiceResult;

                    if (!invoice) return null;

                    const label = formatCbteTipoLabel(invoice.cbteTipo) || invoiceType.label;
                    const cbteNumber = formatCbteNumber(invoice.pointOfSale ?? arcaStatus?.pointOfSale, invoice.cbteNro);

                    return (
                    <div className="p-4 rounded-2xl border border-border bg-secondary space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {invoice.approved ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                          )}
                          <p className="text-sm font-semibold text-foreground">
                            {invoice.approved ? 'Factura emitida' : 'Factura rechazada'}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={handlePrint} disabled={!invoice.approved}>
                          <Printer className="w-4 h-4 mr-2" />
                          Imprimir
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide">Comprobante</p>
                          <p className="text-sm font-semibold text-foreground">
                            {cbteNumber}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide">CAE</p>
                          <p className="text-sm font-semibold text-foreground">{invoice.cae || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide">Vencimiento CAE</p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatArcaDate(invoice.caeExpiresAt)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide">Estado</p>
                          <p className="text-sm font-semibold text-foreground">
                            {invoice.approved ? 'Aprobada' : 'Rechazada'}
                          </p>
                        </div>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </AnimatedPage>
    </div>
  );
}
