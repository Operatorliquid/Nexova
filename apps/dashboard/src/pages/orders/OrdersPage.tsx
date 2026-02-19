import { Package, User, CreditCard, ShoppingCart, Plus, Minus, Search, Trash2, RotateCcw, AlertTriangle, FileText, Calendar, Printer, ChevronDown, Receipt, DollarSign, TrendingUp, Clock, Upload, Eye } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { DeleteConfirmModal } from '../../components/stock';
import { Badge, Button, Input, Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, AnimatedPage, AnimatedStagger, StatCard, AnimatedTableBody, AnimatedTableRow } from '../../components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, API_URL } from '../../lib/api';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';
import { PENDING_INVOICING_BADGE } from '../../lib/statusStyles';
import { useToast } from '../../stores/toast.store';

type JsonRecord = Record<string, unknown>;

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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRecord(record: JsonRecord | null, key: string): JsonRecord | null {
  return asRecord(record?.[key]);
}

function readErrorMessage(record: JsonRecord, fallback: string): string {
  return readString(record, 'message') ?? readString(record, 'error') ?? fallback;
}

async function readJsonRecord(response: Response): Promise<JsonRecord> {
  try {
    const parsed = (await response.json()) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}


interface OrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ReceiptItem {
  id: string;
  fileType: string;
  fileRef?: string | null;
  status: string;
  appliedAmount?: number | null;
  declaredAmount?: number | null;
  extractedAmount?: number | null;
  uploadedAt?: string;
  paymentMethod?: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  cancelReason?: string | null;
  isTrashed?: boolean;
  trashReason?: string | null;
  trash?: {
    isTrashed: boolean;
    previousStatus: string | null;
    trashedAt: string | null;
    reason: string | null;
  } | null;
  customer: {
    id: string;
    phone: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  };
  itemCount: number;
  items?: OrderItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  notes: string | null;
  hasPromotion?: boolean;
  promotion?: {
    id: string;
    name: string;
    promoType: string;
    value: number;
  } | null;
  createdAt: string;
  updatedAt?: string;
  receipts?: ReceiptItem[];
}

// Helper to get customer display name
const getCustomerName = (customer: Order['customer']): string => {
  if (customer.name) return customer.name;
  if (customer.firstName && customer.lastName) {
    return `${customer.firstName} ${customer.lastName}`;
  }
  return customer.firstName || customer.lastName || customer.phone;
};

interface Stats {
  totalOrders: number;
  pendingOrders: number;
  monthlyOrders: number;
  monthlyOrdersQuotaLimit?: number | null;
  monthlyOrdersUsedForLimit?: number;
  monthlyOrdersLimitReached?: boolean;
  totalRevenue: number;
  avgOrderValue: number;
  pendingRevenue: number;
}

interface CustomerOption {
  id: string;
  fullName: string | null;
  phone: string;
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
  stock: number;
  images?: string[];
}

function asOrder(value: unknown): Order | null {
  return asRecord(value) as Order | null;
}

function asOrderArray(value: unknown): Order[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => asRecord(item) !== null) as Order[];
}

function asStats(value: unknown): Stats | null {
  return asRecord(value) as Stats | null;
}

function asCustomerOptionArray(value: unknown): CustomerOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => asRecord(item) !== null) as CustomerOption[];
}

function asProductOptionArray(value: unknown): ProductOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => asRecord(item) !== null) as ProductOption[];
}

const DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
];

const ACCEPTANCE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  awaiting_acceptance: { label: 'Esperando aprobacion', color: 'bg-amber-500/20 text-amber-400' },
  accepted: { label: 'Aceptado', color: 'bg-emerald-500/20 text-emerald-400' },
  cancelled: { label: 'Cancelado', color: 'bg-red-500/20 text-red-400' },
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_payment: { label: 'Pendiente de pago', color: 'bg-amber-500/20 text-amber-400' },
  partial_payment: { label: 'Pago parcial', color: 'bg-cyan-500/20 text-cyan-400' },
  paid: { label: 'Pagado', color: 'bg-emerald-500/20 text-emerald-400' },
};

const INVOICE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_invoicing: { label: PENDING_INVOICING_BADGE.label, color: PENDING_INVOICING_BADGE.pill },
  invoiced: { label: 'Facturado', color: 'bg-emerald-500/20 text-emerald-400' },
  invoice_cancelled: { label: 'Factura cancelada', color: 'bg-red-500/20 text-red-400' },
};

const RECEIPT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  applied: { label: 'Aplicado', color: 'bg-emerald-500/20 text-emerald-400' },
  pending_review: { label: 'Pendiente', color: 'bg-primary/20 text-primary' },
  confirmed: { label: 'Confirmado', color: 'bg-blue-500/20 text-blue-400' },
  rejected: { label: 'Rechazado', color: 'bg-red-500/20 text-red-400' },
};

const RECEIPT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  link: 'Link de pago',
  mercadopago: 'Link de pago',
};

const resolveAcceptanceStatus = (order: Order): keyof typeof ACCEPTANCE_STATUS_CONFIG => {
  if (order.status === 'cancelled' || order.status === 'returned') return 'cancelled';
  if (
    order.status === 'awaiting_acceptance' ||
    order.status === 'draft' ||
    order.status === 'pending_invoicing'
  ) {
    return 'awaiting_acceptance';
  }
  return 'accepted';
};

const resolvePaymentStatus = (order: Order): keyof typeof PAYMENT_STATUS_CONFIG => {
  if (order.total <= 0 || order.paidAmount >= order.total) return 'paid';
  if (order.paidAmount > 0) return 'partial_payment';
  return 'pending_payment';
};

const resolveDateRange = (filter: string): { from?: string; to?: string } => {
  if (filter === 'all') {
    return {};
  }
  const now = new Date();
  const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const endOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  if (filter === 'today') {
    return { from: startOfDay(now).toISOString(), to: now.toISOString() };
  }

  if (filter === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return { from: startOfDay(yesterday).toISOString(), to: endOfDay(yesterday).toISOString() };
  }

  if (filter === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const start = new Date(now);
    start.setDate(now.getDate() + diff);
    return { from: startOfDay(start).toISOString(), to: now.toISOString() };
  }

  if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: startOfDay(start).toISOString(), to: now.toISOString() };
  }

  return {};
};

export default function OrdersPage(): JSX.Element {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const canAutoDetectManualReceiptAmount = capabilities.autoDetectManualReceiptAmount;
  const canUsePaymentLinks = capabilities.showMercadoPagoIntegration;
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isProductsExpanded, setIsProductsExpanded] = useState(false);
  const [activeOrderTab, setActiveOrderTab] = useState<'details' | 'receipts'>('details');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreateLoading, setIsCreateLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  const [trashedOrders, setTrashedOrders] = useState<Order[]>([]);
  const trashedOrdersRequestIdRef = useRef(0);
  const [trashCandidate, setTrashCandidate] = useState<Order | null>(null);
  const [trashReasonDraft, setTrashReasonDraft] = useState('');
  const [isTrashing, setIsTrashing] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<Order | null>(null);
  const [receiptPreviews, setReceiptPreviews] = useState<Record<string, string>>({});
  const receiptPreviewsRef = useRef<Record<string, string>>({});
  const [isRestoring, setIsRestoring] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [isReceiptUploadOpen, setIsReceiptUploadOpen] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptAutoDetect, setReceiptAutoDetect] = useState(true);
  const [receiptPaymentMethod, setReceiptPaymentMethod] = useState<'transfer' | 'cash' | 'link'>('transfer');
  const [isReceiptUploading, setIsReceiptUploading] = useState(false);
  const [receiptNeedsAmount, setReceiptNeedsAmount] = useState(false);
  const [pendingReceiptId, setPendingReceiptId] = useState<string | null>(null);
  const [receiptDetectedAmount, setReceiptDetectedAmount] = useState<number | null>(null);
  const [receiptUploadError, setReceiptUploadError] = useState('');
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptPreviewType, setReceiptPreviewType] = useState<'image' | 'pdf' | null>(null);
  const [receiptFileInputKey, setReceiptFileInputKey] = useState(0);
  const [receiptToDelete, setReceiptToDelete] = useState<ReceiptItem | null>(null);
  const [showReceiptDeleteConfirm, setShowReceiptDeleteConfirm] = useState(false);
  const [isDeletingReceipt, setIsDeletingReceipt] = useState(false);
  const [receiptActionTarget, setReceiptActionTarget] = useState<ReceiptItem | null>(null);
  const [receiptActionType, setReceiptActionType] = useState<'accept' | 'reject' | null>(null);
  const [receiptActionAmount, setReceiptActionAmount] = useState('');
  const [receiptActionReason, setReceiptActionReason] = useState('');
  const [receiptActionError, setReceiptActionError] = useState('');
  const [isReceiptActionOpen, setIsReceiptActionOpen] = useState(false);
  const [isReceiptActionLoading, setIsReceiptActionLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'partial' | 'paid'>('pending');
  const [partialPaid, setPartialPaid] = useState('');
  const ordersMonthlyLimit =
    typeof stats?.monthlyOrdersQuotaLimit === 'number' ? stats.monthlyOrdersQuotaLimit : null;
  const ordersMonthlyUsedForLimit =
    typeof stats?.monthlyOrdersUsedForLimit === 'number' ? stats.monthlyOrdersUsedForLimit : 0;
  const isOrdersLimitReached = Boolean(
    stats &&
      ordersMonthlyLimit !== null &&
      (stats.monthlyOrdersLimitReached === true ||
        ordersMonthlyUsedForLimit >= ordersMonthlyLimit)
  );

  const fetchOrdersAndStats = useCallback(async (): Promise<void> => {
    if (!workspace?.id) return;
    setIsLoading(true);
    try {
      const dateRange = resolveDateRange(dateFilter);
      const queryParams = new URLSearchParams({
        limit: '100',
        ...(search && { search }),
        ...(statusFilter && statusFilter !== 'all' && { status: statusFilter }),
        ...(dateRange.from && { from: dateRange.from }),
        ...(dateRange.to && { to: dateRange.to }),
      });

      const [ordersRes, statsRes] = await Promise.all([
        apiFetch(`/api/v1/orders?${queryParams.toString()}`, {}, workspace.id),
        apiFetch('/api/v1/orders/stats', {}, workspace.id),
      ]);

      if (ordersRes.ok) {
        const data = await readJsonRecord(ordersRes);
        setOrders(asOrderArray(data.orders));
      } else {
        const errorBody = await readJsonRecord(ordersRes);
        throw new Error(readErrorMessage(errorBody, 'No se pudieron cargar los pedidos'));
      }

      if (statsRes.ok) {
        const data = await readJsonRecord(statsRes);
        setStats(asStats(data));
      } else {
        const errorBody = await readJsonRecord(statsRes);
        throw new Error(readErrorMessage(errorBody, 'No se pudieron cargar las métricas de pedidos'));
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los pedidos');
    } finally {
      setIsLoading(false);
    }
  }, [dateFilter, search, statusFilter, toast, workspace?.id]);

  const fetchOrderDetail = useCallback(async (orderId: string, options?: { silent?: boolean }): Promise<void> => {
    if (!workspace?.id) return;
    if (!options?.silent) {
      setIsLoadingDetail(true);
    }
    try {
      const response = await apiFetch(`/api/v1/orders/${orderId}`, {}, workspace.id);
      if (response.ok) {
        const data = await readJsonRecord(response);
        setSelectedOrder(asOrder(data.order));
      }
    } catch (error) {
      console.error('Failed to fetch order detail:', error);
    } finally {
      if (!options?.silent) {
        setIsLoadingDetail(false);
      }
    }
  }, [workspace?.id]);

  // Fetch orders and stats
  useEffect(() => {
    if (!workspace?.id) return;
    void fetchOrdersAndStats();
  }, [fetchOrdersAndStats, workspace?.id]);

  const orderIdParam = searchParams.get('orderId');
  const orderNumberParam = searchParams.get('orderNumber');

  useEffect(() => {
    if (!workspace?.id) return;
    if (!orderIdParam) return;
    setActiveOrderTab('details');
    void fetchOrderDetail(orderIdParam);
  }, [fetchOrderDetail, orderIdParam, workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) return;
    if (orderIdParam || !orderNumberParam) return;

    const resolveOrderByNumber = async (): Promise<void> => {
      try {
        const params = new URLSearchParams({
          search: orderNumberParam,
          limit: '1',
          offset: '0',
        });
        const response = await apiFetch(`/api/v1/orders?${params.toString()}`, {}, workspace.id);
        if (!response.ok) return;
        const data = await readJsonRecord(response);
        const match = asOrderArray(data.orders)[0];
        if (match?.id) {
          setActiveOrderTab('details');
          void fetchOrderDetail(match.id);
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('orderNumber');
          nextParams.set('orderId', match.id);
          setSearchParams(nextParams);
        }
      } catch (error) {
        console.error('Failed to resolve order by number:', error);
      }
    };

    void resolveOrderByNumber();
  }, [fetchOrderDetail, orderIdParam, orderNumberParam, searchParams, setSearchParams, workspace?.id]);

  useEffect(() => {
    if (!canAutoDetectManualReceiptAmount) {
      setReceiptAutoDetect(false);
    }
  }, [canAutoDetectManualReceiptAmount]);

  const applyOrderUpdate = (orderUpdate: Partial<Order> & { id: string }): void => {
    if (!orderUpdate?.id) return;
    setSelectedOrder((prev) =>
      prev && prev.id === orderUpdate.id ? { ...prev, ...orderUpdate } : prev
    );
    setOrders((prev) =>
      prev.map((order) => (order.id === orderUpdate.id ? { ...order, ...orderUpdate } : order))
    );
  };

  const removeReceiptPreview = (receiptId: string): void => {
    setReceiptPreviews((prev) => {
      const next = { ...prev };
      const url = next[receiptId];
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
        delete next[receiptId];
      }
      return next;
    });
  };

  // Handle order selection
  const handleSelectOrder = (order: Order): void => {
    setSelectedOrder(order);
    setIsProductsExpanded(false);
    setActiveOrderTab('details');
    void fetchOrderDetail(order.id);
  };

  useEffect(() => {
    receiptPreviewsRef.current = receiptPreviews;
  }, [receiptPreviews]);

  useEffect(() => {
    return () => {
      Object.values(receiptPreviewsRef.current).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
    };
  }, []);

  useEffect(() => {
    setReceiptPreviews((previousPreviews) => {
      Object.values(previousPreviews).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      return {};
    });
  }, [selectedOrder?.id]);

  useEffect(() => {
    if (!receiptFile) {
      setReceiptPreviewUrl((previousPreviewUrl) => {
        if (previousPreviewUrl) {
          try {
            URL.revokeObjectURL(previousPreviewUrl);
          } catch {
            // ignore
          }
        }
        return null;
      });
      setReceiptPreviewType(null);
      return;
    }

    const url = URL.createObjectURL(receiptFile);
    setReceiptPreviewUrl(url);
    setReceiptPreviewType(receiptFile.type === 'application/pdf' ? 'pdf' : 'image');

    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    };
  }, [receiptFile]);

  useEffect(() => {
    if (!selectedOrder || activeOrderTab !== 'receipts' || !workspace?.id) return;
    const loadReceiptPreviews = async (): Promise<void> => {
      const receipts = selectedOrder.receipts || [];
      for (const receipt of receipts) {
        if (receipt.fileType !== 'image') continue;
        if (receiptPreviews[receipt.id]) continue;
        try {
          const response = await apiFetch(
            `/api/v1/integrations/receipts/${receipt.id}/file`,
            {},
            workspace.id
          );
          if (!response.ok) continue;
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          setReceiptPreviews((prev) => ({ ...prev, [receipt.id]: url }));
        } catch (error) {
          console.error('Failed to load receipt preview:', error);
        }
      }
    };
    void loadReceiptPreviews();
  }, [activeOrderTab, receiptPreviews, selectedOrder, workspace?.id]);

  // Format currency
  const formatCurrency = (amount: number): string => {
    return `$${(amount / 100).toLocaleString('es-AR')}`;
  };

  const parseMoneyInputToCents = (raw: string): number | null => {
    const value = raw.trim();
    if (!value) return null;
    const match = value.match(/([0-9][0-9.,]*)/);
    if (!match) return null;
    let normalized = match[1];
    if (normalized.includes('.') && normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (normalized.includes(',')) {
      const parts = normalized.split(',');
      if (parts[1] && parts[1].length === 2) {
        normalized = `${parts[0].replace(/\./g, '')}.${parts[1]}`;
      } else {
        normalized = normalized.replace(/,/g, '');
      }
    } else {
      normalized = normalized.replace(/,/g, '');
    }
    const amount = Number(normalized);
    if (Number.isNaN(amount) || amount <= 0) return null;
    return Math.round(amount * 100);
  };

  const clearReceiptAttachment = useCallback(() => {
    setReceiptFile(null);
    setReceiptNeedsAmount(false);
    setPendingReceiptId(null);
    setReceiptDetectedAmount(null);
    setReceiptUploadError('');
    if (receiptPreviewUrl) {
      try {
        URL.revokeObjectURL(receiptPreviewUrl);
      } catch {
        // ignore
      }
    }
    setReceiptPreviewUrl(null);
    setReceiptPreviewType(null);
    setReceiptFileInputKey((prev) => prev + 1);
  }, [receiptPreviewUrl]);

  const resetReceiptUpload = (): void => {
    clearReceiptAttachment();
    setReceiptAmount('');
    setReceiptAutoDetect(true);
    setReceiptPaymentMethod('transfer');
    setIsReceiptUploading(false);
  };

  useEffect(() => {
    if (receiptPaymentMethod === 'cash') {
      clearReceiptAttachment();
    }
  }, [receiptPaymentMethod, clearReceiptAttachment]);

  useEffect(() => {
    if (!canUsePaymentLinks && receiptPaymentMethod === 'link') {
      setReceiptPaymentMethod('transfer');
    }
  }, [canUsePaymentLinks, receiptPaymentMethod]);

  const resetReceiptAction = (): void => {
    setReceiptActionTarget(null);
    setReceiptActionType(null);
    setReceiptActionAmount('');
    setReceiptActionReason('');
    setReceiptActionError('');
    setIsReceiptActionLoading(false);
  };

  const openReceiptAction = (receipt: ReceiptItem, type: 'accept' | 'reject'): void => {
    setReceiptActionTarget(receipt);
    setReceiptActionType(type);
    const amount =
      receipt.appliedAmount ?? receipt.declaredAmount ?? receipt.extractedAmount ?? null;
    setReceiptActionAmount(amount ? (amount / 100).toString() : '');
    setReceiptActionReason('');
    setReceiptActionError('');
    setIsReceiptActionOpen(true);
  };

  const handleUploadReceipt = async (): Promise<void> => {
    if (!workspace?.id || !selectedOrder) return;
    const effectivePaymentMethod =
      canUsePaymentLinks || receiptPaymentMethod !== 'link'
        ? receiptPaymentMethod
        : 'transfer';
    const isCash = effectivePaymentMethod === 'cash';
    if (isCash && !receiptAmount.trim()) {
      setReceiptUploadError('Ingresá un monto');
      return;
    }
    if (!isCash) {
      const effectiveAutoDetect = canAutoDetectManualReceiptAmount && receiptAutoDetect;
      if (!receiptFile) {
        setReceiptUploadError('Seleccioná un comprobante');
        return;
      }
      if (!effectiveAutoDetect && !receiptAmount.trim()) {
        setReceiptUploadError(
          canAutoDetectManualReceiptAmount
            ? 'Ingresá un monto o activá la detección automática'
            : 'Ingresá un monto'
        );
        return;
      }
    }

    setIsReceiptUploading(true);
    setReceiptUploadError('');
    try {
      const response = isCash
        ? await apiFetch(
            `/api/v1/orders/${selectedOrder.id}/receipts`,
            {
              method: 'POST',
              body: JSON.stringify({
                amount: receiptAmount.trim(),
                paymentMethod: effectivePaymentMethod,
              }),
            },
            workspace.id
          )
        : await apiFetch(
            `/api/v1/orders/${selectedOrder.id}/receipts`,
            {
              method: 'POST',
              body: (() => {
                const formData = new FormData();
                formData.append('file', receiptFile as File);
                formData.append(
                  'autoDetect',
                  canAutoDetectManualReceiptAmount && receiptAutoDetect ? 'true' : 'false'
                );
                formData.append('paymentMethod', effectivePaymentMethod);
                if (receiptAmount.trim()) {
                  formData.append('amount', receiptAmount.trim());
                }
                return formData;
              })(),
            },
            workspace.id
          );

      if (!response.ok) {
        let message = 'No se pudo subir el comprobante';
        const body = await readJsonRecord(response);
        if (response.status === 409 || readString(body, 'error') === 'DUPLICATE_RECEIPT') {
          message = 'Este comprobante esta duplicado';
        } else {
          message = readErrorMessage(body, message);
        }
        throw new Error(message);
      }

      const data = await readJsonRecord(response);
      const updatedOrder = asOrder(data.order);
      if (updatedOrder?.id) {
        applyOrderUpdate(updatedOrder);
      }
      if (data.applied === true) {
        toast.success('Comprobante aplicado');
        setIsReceiptUploadOpen(false);
        resetReceiptUpload();
        await fetchOrderDetail(selectedOrder.id, { silent: true });
        return;
      }

      if (!isCash) {
        const receipt = readRecord(data, 'receipt');
        const receiptId = readString(data, 'receiptId') ?? readString(receipt, 'id') ?? null;
        setPendingReceiptId(receiptId);
        setReceiptNeedsAmount(true);
        const extractedAmount = readNumber(data, 'extractedAmount');
        if (extractedAmount !== undefined) {
          setReceiptDetectedAmount(extractedAmount);
          setReceiptAmount((extractedAmount / 100).toString());
        } else {
          setReceiptDetectedAmount(null);
        }
        setReceiptUploadError('No pude detectar el monto. Ingresalo manualmente.');
      }
    } catch (error) {
      console.error('Failed to upload receipt:', error);
      setReceiptUploadError(error instanceof Error ? error.message : 'No se pudo subir el comprobante');
    } finally {
      setIsReceiptUploading(false);
    }
  };

  const handleApplyReceiptAmount = async (): Promise<void> => {
    if (!workspace?.id || !selectedOrder || !pendingReceiptId) return;
    const amountCents = parseMoneyInputToCents(receiptAmount);
    if (!amountCents) {
      setReceiptUploadError('Ingresá un monto válido');
      return;
    }

    setIsReceiptUploading(true);
    setReceiptUploadError('');
    try {
      const response = await apiFetch(
        `/api/v1/integrations/receipts/${pendingReceiptId}/apply`,
        {
          method: 'POST',
          body: JSON.stringify({
            orderId: selectedOrder.id,
            amount: amountCents,
          }),
        },
        workspace.id
      );

      if (!response.ok) {
        let message = 'No se pudo aplicar el comprobante';
        const body = await readJsonRecord(response);
        message = readErrorMessage(body, message);
        throw new Error(message);
      }

      const data = await readJsonRecord(response);
      const updatedOrder = asOrder(data.order);
      if (updatedOrder?.id) {
        applyOrderUpdate(updatedOrder);
      }
      toast.success('Comprobante aplicado');
      setIsReceiptUploadOpen(false);
      resetReceiptUpload();
      await fetchOrderDetail(selectedOrder.id, { silent: true });
    } catch (error) {
      console.error('Failed to apply receipt:', error);
      setReceiptUploadError(error instanceof Error ? error.message : 'No se pudo aplicar el comprobante');
    } finally {
      setIsReceiptUploading(false);
    }
  };

  const handleDeleteReceipt = async (): Promise<void> => {
    if (!workspace?.id || !receiptToDelete) return;
    setIsDeletingReceipt(true);
    try {
      const response = await apiFetch(
        `/api/v1/integrations/receipts/${receiptToDelete.id}`,
        { method: 'DELETE' },
        workspace.id
      );

      if (!response.ok) {
        let message = 'No se pudo eliminar el comprobante';
        const body = await readJsonRecord(response);
        message = readErrorMessage(body, message);
        throw new Error(message);
      }

      const data = await readJsonRecord(response);
      const updatedOrder = asOrder(data.order);
      if (updatedOrder?.id) {
        applyOrderUpdate(updatedOrder);
      }
      const updatedOrderRecord = readRecord(data, 'order');
      const paidAmount = readNumber(updatedOrderRecord, 'paidAmount');
      const pendingAmount = readNumber(updatedOrderRecord, 'pendingAmount');

      setSelectedOrder((prev) =>
        prev
          ? {
              ...prev,
              receipts: prev.receipts?.filter((r) => r.id !== receiptToDelete.id) || [],
              ...(updatedOrderRecord
                ? {
                    paidAmount: paidAmount ?? prev.paidAmount,
                    pendingAmount: pendingAmount ?? prev.pendingAmount,
                  }
                : {}),
            }
          : prev
      );

      removeReceiptPreview(receiptToDelete.id);
      toast.success('Comprobante eliminado');
    } catch (error) {
      console.error('Failed to delete receipt:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el comprobante');
    } finally {
      setIsDeletingReceipt(false);
      setShowReceiptDeleteConfirm(false);
      setReceiptToDelete(null);
    }
  };

  const handleReceiptAction = async (): Promise<void> => {
    if (!workspace?.id || !selectedOrder || !receiptActionTarget || !receiptActionType) return;
    setIsReceiptActionLoading(true);
    setReceiptActionError('');

    try {
      if (receiptActionType === 'accept') {
        const amountCents = parseMoneyInputToCents(receiptActionAmount);
        if (!amountCents) {
          setReceiptActionError('Ingresá un monto válido');
          setIsReceiptActionLoading(false);
          return;
        }

        const response = await apiFetch(
          `/api/v1/integrations/receipts/${receiptActionTarget.id}/apply`,
          {
            method: 'POST',
            body: JSON.stringify({
              orderId: selectedOrder.id,
              amount: amountCents,
            }),
          },
          workspace.id
        );

        if (!response.ok) {
          let message = 'No se pudo aplicar el comprobante';
          const body = await readJsonRecord(response);
          message = readErrorMessage(body, message);
          throw new Error(message);
        }

        const data = await readJsonRecord(response);
        const updatedOrder = asOrder(data.order);
        if (updatedOrder?.id) {
          applyOrderUpdate(updatedOrder);
        }

        toast.success('Comprobante aprobado');
      } else {
        const response = await apiFetch(
          `/api/v1/integrations/receipts/${receiptActionTarget.id}/reject`,
          {
            method: 'POST',
            body: JSON.stringify({
              reason: receiptActionReason.trim() || undefined,
            }),
          },
          workspace.id
        );

        if (!response.ok) {
          let message = 'No se pudo rechazar el comprobante';
          const body = await readJsonRecord(response);
          message = readErrorMessage(body, message);
          throw new Error(message);
        }

        toast.success('Comprobante rechazado');
      }

      await fetchOrderDetail(selectedOrder.id, { silent: true });
      setIsReceiptActionOpen(false);
      resetReceiptAction();
    } catch (error) {
      console.error('Receipt action failed:', error);
      setReceiptActionError(error instanceof Error ? error.message : 'No se pudo actualizar el comprobante');
    } finally {
      setIsReceiptActionLoading(false);
    }
  };

  // Format date
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Time ago
  const timeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `hace ${diffMins}m`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays < 7) return `hace ${diffDays}d`;
    return formatDate(dateString);
  };

  // Format date long
  const formatDateLong = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  // Format time
  const formatTime = (dateString: string): string => {
    return new Date(dateString).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get status badges
  const getStatusBadges = (order: Order): JSX.Element => {
    const acceptanceKey = resolveAcceptanceStatus(order);
    const paymentKey = resolvePaymentStatus(order);
    const acceptance = ACCEPTANCE_STATUS_CONFIG[acceptanceKey];
    const payment = PAYMENT_STATUS_CONFIG[paymentKey];
    const invoice = INVOICE_STATUS_CONFIG[order.status];
    return (
      <div className="inline-flex flex-wrap gap-2 justify-center">
        <span className={`px-2 py-1 text-xs rounded-full ${acceptance.color}`}>
          {acceptance.label}
        </span>
        <span className={`px-2 py-1 text-xs rounded-full ${payment.color}`}>
          {payment.label}
        </span>
        {invoice && (
          <span className={`px-2 py-1 text-xs rounded-full ${invoice.color}`}>
            {invoice.label}
          </span>
        )}
        {order.hasPromotion && (
          <span className="px-2 py-1 text-xs rounded-full bg-primary/20 text-primary">
            Promo
          </span>
        )}
      </div>
    );
  };

  const resetCreateForm = (): void => {
    setProductSearch('');
    setCustomerSearch('');
    setSelectedCustomerId('');
    setItemQuantities({});
    setPaymentStatus('pending');
    setPartialPaid('');
  };

  useEffect(() => {
    if (!isCreateOpen || !workspace?.id) return;

    const loadCreateData = async (): Promise<void> => {
      setIsCreateLoading(true);
      try {
        const [customersRes, productsRes] = await Promise.all([
          apiFetch('/api/v1/customers?limit=100', {}, workspace.id),
          apiFetch('/api/v1/products?limit=100', {}, workspace.id),
        ]);

        if (customersRes.ok) {
          const data = await readJsonRecord(customersRes);
          setCustomers(asCustomerOptionArray(data.customers));
        } else {
          toast.error('No se pudieron cargar los clientes');
        }

        if (productsRes.ok) {
          const data = await readJsonRecord(productsRes);
          setProducts(asProductOptionArray(data.products));
        } else {
          toast.error('No se pudieron cargar los productos');
        }
      } catch (error) {
        console.error('Failed to load create order data:', error);
        toast.error('No se pudieron cargar clientes o productos');
      } finally {
        setIsCreateLoading(false);
      }
    };

    void loadCreateData();
  }, [isCreateOpen, toast, workspace?.id]);

  useEffect(() => {
    if (!isTrashOpen || !workspace?.id) return;

    const loadTrashed = async (): Promise<void> => {
      const requestId = ++trashedOrdersRequestIdRef.current;
      setIsTrashLoading(true);
      try {
        const res = await apiFetch('/api/v1/orders?status=trashed&limit=100', {}, workspace.id);
        if (requestId !== trashedOrdersRequestIdRef.current) return;
        if (res.ok) {
          const data = await readJsonRecord(res);
          setTrashedOrders(asOrderArray(data.orders));
        } else {
          const errorBody = await readJsonRecord(res);
          throw new Error(readErrorMessage(errorBody, 'No se pudieron cargar los pedidos en papelera'));
        }
      } catch (error) {
        if (requestId !== trashedOrdersRequestIdRef.current) return;
        console.error('Failed to load trashed orders:', error);
        toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los pedidos en papelera');
      } finally {
        if (requestId === trashedOrdersRequestIdRef.current) {
          setIsTrashLoading(false);
        }
      }
    };

    void loadTrashed();

    return () => {
      trashedOrdersRequestIdRef.current += 1;
    };
  }, [isTrashOpen, toast, workspace?.id]);

  const selectedItems = products
    .map((p) => ({ ...p, quantity: itemQuantities[p.id] || 0 }))
    .filter((p) => p.quantity > 0);

  const subtotalCents = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  let paymentAmountCents = 0;
  if (paymentStatus === 'paid') {
    paymentAmountCents = subtotalCents;
  } else if (paymentStatus === 'partial') {
    const parsed = Number(partialPaid.replace(',', '.'));
    if (!Number.isNaN(parsed) && parsed > 0) {
      paymentAmountCents = Math.round(parsed * 100);
    }
  }

  const canCreate =
    selectedCustomerId &&
    selectedItems.length > 0 &&
    (paymentStatus !== 'partial' ||
      (paymentAmountCents > 0 && paymentAmountCents < subtotalCents));

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const filteredCustomers = customers.filter((customer) => {
    const target = `${customer.fullName || ''} ${customer.phone}`.toLowerCase();
    return target.includes(customerSearch.toLowerCase());
  });

  const openPdfFromResponse = async (response: Response, fallbackName: string): Promise<void> => {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const opened = window.open(url, '_blank');
    if (!opened) {
      const link = document.createElement('a');
      link.href = url;
      link.download = fallbackName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  };

  const openReceiptFile = async (receiptId: string): Promise<void> => {
    if (!workspace?.id) return;
    const response = await apiFetch(
      `/api/v1/integrations/receipts/${receiptId}/file`,
      {},
      workspace.id
    );
    if (!response.ok) {
      toast.error('No se pudo abrir el comprobante');
      return;
    }
    await openPdfFromResponse(response, `comprobante_${receiptId}.pdf`);
  };

  const handleAcceptAndPrint = async (): Promise<void> => {
    if (!workspace?.id || !selectedOrder) return;
    setIsAccepting(true);
    try {
      const acceptanceStatus = resolveAcceptanceStatus(selectedOrder);
      if (acceptanceStatus === 'awaiting_acceptance') {
        const res = await apiFetch(
          `/api/v1/orders/${selectedOrder.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'accepted' }),
          },
          workspace.id
        );

        if (!res.ok) {
          throw new Error('No se pudo aceptar el pedido');
        }

        const data = await readJsonRecord(res);
        const orderData = readRecord(data, 'order');
        const completedPayments = asRecordList(orderData?.payments).filter((payment) => readString(payment, 'status') === 'completed');
        const paymentsSum = completedPayments.reduce(
          (sum: number, payment) => sum + (readNumber(payment, 'amount') ?? 0),
          0
        );
        const nextStatus = readString(orderData, 'status') ?? selectedOrder.status;
        const updatedPaidAmount = Math.max(
          readNumber(orderData, 'paidAmount') ?? selectedOrder.paidAmount,
          paymentsSum
        );
        setSelectedOrder((prev) =>
          prev
            ? {
                ...prev,
                status: nextStatus,
                paidAmount: updatedPaidAmount,
                pendingAmount: Math.max(prev.total - updatedPaidAmount, 0),
              }
            : prev
        );
        const orderId = readString(orderData, 'id');
        if (orderId) {
          setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: nextStatus } : order)));
        }
        await fetchOrderDetail(selectedOrder.id, { silent: true });
      }

      const receiptRes = await apiFetch(
        `/api/v1/orders/${selectedOrder.id}/receipt`,
        {},
        workspace.id
      );

      if (!receiptRes.ok) {
        throw new Error('No se pudo generar la boleta');
      }

      await openPdfFromResponse(receiptRes, `boleta_${selectedOrder.orderNumber}.pdf`);
    } catch (error) {
      console.error('Failed to accept and print:', error);
      toast.error('No se pudo aceptar e imprimir la boleta');
    } finally {
      setIsAccepting(false);
    }
  };

  const handleCreateOrder = async (): Promise<void> => {
    if (!workspace?.id) return;
    if (!canCreate) {
      toast.error('Completá cliente, productos y estado de pago');
      return;
    }

    setIsCreating(true);
    try {
      const items = selectedItems.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
        unitPrice: item.price,
      }));

      const response = await apiFetch(
        '/api/v1/orders',
        {
          method: 'POST',
          body: JSON.stringify({
            customerId: selectedCustomerId,
            items,
            shipping: 0,
            discount: 0,
            status: 'accepted',
            paidAmount: paymentAmountCents,
            paymentMethod: 'cash',
          }),
        },
        workspace.id
      );

      if (!response.ok) {
        let message = 'No se pudo crear el pedido';
        const errorBody = await readJsonRecord(response);
        message = readErrorMessage(errorBody, message);
        throw new Error(message);
      }

      setIsCreateOpen(false);
      resetCreateForm();
      await fetchOrdersAndStats();
      toast.success('Pedido creado');
    } catch (error) {
      console.error('Failed to create order:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el pedido');
    } finally {
      setIsCreating(false);
    }
  };

  const handleMoveToTrash = async (): Promise<void> => {
    const candidate = trashCandidate;
    if (!workspace?.id || !candidate) return;
    const reason = trashReasonDraft.trim();
    if (reason.length < 3) {
      toast.error('Indicá un motivo de al menos 3 caracteres');
      return;
    }
    setIsTrashing(true);
    try {
      const res = await apiFetch(
        `/api/v1/orders/${candidate.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'trashed', cancelReason: reason }),
        },
        workspace.id
      );

      if (!res.ok) {
        const errorBody = await readJsonRecord(res);
        throw new Error(readErrorMessage(errorBody, 'No se pudo enviar a la papelera'));
      }
      const payload = await readJsonRecord(res);
      const customerNotification = readRecord(payload, 'customerNotification');

      setOrders((prev) => prev.filter((o) => o.id !== candidate.id));
      if (selectedOrder?.id === candidate.id) {
        setSelectedOrder(null);
      }
      setTrashCandidate(null);
      setTrashReasonDraft('');
      await fetchOrdersAndStats();
      toast.success('Pedido cancelado y enviado a la papelera');
      if (
        customerNotification?.attempted === true &&
        customerNotification?.sent !== true
      ) {
        const reasonText = readString(customerNotification, 'error');
        toast.warning(
          reasonText
            ? `Pedido cancelado, pero no se pudo avisar al cliente (${reasonText})`
            : 'Pedido cancelado, pero no se pudo avisar al cliente'
        );
      }
    } catch (error) {
      console.error('Failed to trash order:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar a la papelera');
    } finally {
      setIsTrashing(false);
    }
  };

  const handleRestoreFromTrash = async (): Promise<void> => {
    const candidate = restoreCandidate;
    if (!workspace?.id || !candidate) return;
    setIsRestoring(true);
    try {
      const res = await apiFetch(
        `/api/v1/orders/${candidate.id}/restore`,
        { method: 'POST' },
        workspace.id
      );

      if (!res.ok) {
        const errorBody = await readJsonRecord(res);
        throw new Error(readErrorMessage(errorBody, 'No se pudo restaurar el pedido'));
      }

      const payload = await readJsonRecord(res);
      const restoredOrderRecord = readRecord(payload, 'order');
      const restoredStatus = readString(restoredOrderRecord, 'status') || 'cancelled';
      const restoredOrder: Order = {
        ...candidate,
        status: restoredStatus,
        isTrashed: false,
        trashReason: null,
        trash: null,
      };

      setOrders((prev) => {
        const withoutRestored = prev.filter((order) => order.id !== candidate.id);
        if (statusFilter !== 'all' && statusFilter !== 'cancelled') {
          return withoutRestored;
        }
        return [restoredOrder, ...withoutRestored];
      });
      setTrashedOrders((prev) => prev.filter((o) => o.id !== candidate.id));
      setRestoreCandidate(null);
      toast.success('Pedido restaurado (sigue en estado cancelado)');
    } catch (error) {
      console.error('Failed to restore order:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo restaurar el pedido');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Pedidos</h1>
            <p className="text-sm text-muted-foreground">Gestiona los pedidos de tus clientes</p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <Input
              placeholder="Buscar por cliente..."
              className="w-full md:w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-3">
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-full md:w-44">
                  <SelectValue placeholder="Días" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-52">
                  <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="awaiting_acceptance">Esperando aprobacion</SelectItem>
                  <SelectItem value="accepted">Aceptado</SelectItem>
                  <SelectItem value="pending_invoicing">Pendiente de facturación</SelectItem>
                  <SelectItem value="invoiced">Facturado</SelectItem>
                  <SelectItem value="invoice_cancelled">Factura cancelada</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                  <SelectItem value="paid">Pagado</SelectItem>
                  <SelectItem value="pending_payment">Pendiente de pago</SelectItem>
                  <SelectItem value="partial_payment">Pago parcial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1 md:flex-none" onClick={() => setIsTrashOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Papelera
              </Button>
              <Button className="flex-1 md:flex-none" onClick={() => setIsCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Nuevo pedido
              </Button>
            </div>
          </div>
        </div>

        {isOrdersLimitReached && ordersMonthlyLimit !== null && (
          <div className="glass-card rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Ya no recibiras mas pedidos porque alcanzaste tu limite mensual ({ordersMonthlyLimit}).
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Puedes mejorar tu plan para seguir utilizando este servicio.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <AnimatedStagger className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Total pedidos" value={(stats?.totalOrders ?? 0).toString()} icon={ShoppingCart} color="primary" isLoading={isLoading} />
          <StatCard label="Pendientes de aprobación" value={(stats?.pendingOrders ?? 0).toString()} icon={Clock} color="amber" isLoading={isLoading} />
          <StatCard label="Ingresos" value={formatCurrency(stats?.totalRevenue ?? 0)} icon={DollarSign} color="emerald" isLoading={isLoading} />
          <StatCard label="Ticket promedio" value={formatCurrency(stats?.avgOrderValue ?? 0)} icon={TrendingUp} color="cyan" isLoading={isLoading} />
        </AnimatedStagger>

        {/* Orders table */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Todos los pedidos</h3>
            {stats && stats.pendingRevenue > 0 && (
              <Badge variant="warning" className="text-white">
                Por cobrar: {formatCurrency(stats.pendingRevenue)}
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-5">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <ShoppingCart className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No hay pedidos</p>
                <p className="text-sm text-muted-foreground/50 mt-1">
                  Los pedidos apareceran aqui desde WhatsApp o creados manualmente
                </p>
                <Button className="mt-6" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Crear primer pedido
                </Button>
              </div>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {orders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => handleSelectOrder(order)}
                  className="w-full text-left px-4 py-3.5 hover:bg-secondary/50 transition-colors active:bg-secondary"
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-medium text-foreground">#{order.orderNumber}</span>
                      <span className="text-sm text-foreground truncate">{getCustomerName(order.customer)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(order.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadges(order)}
                    </div>
                    <span className="text-sm font-medium flex-shrink-0">
                      {order.pendingAmount === 0 ? (
                        <span className="text-emerald-400">{formatCurrency(order.total)}</span>
                      ) : order.paidAmount > 0 ? (
                        <span>
                          <span className="text-emerald-400">{formatCurrency(order.paidAmount)}</span>
                          <span className="text-muted-foreground/50">/</span>
                          <span className="text-muted-foreground">{formatCurrency(order.total)}</span>
                        </span>
                      ) : (
                        <span className="text-foreground">{formatCurrency(order.total)}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground font-mono">{order.customer.phone}</span>
                  </div>
                </button>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground whitespace-nowrap">Pedido</th>
                  <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Cliente</th>
                  <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground whitespace-nowrap">Items</th>
                  <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground whitespace-nowrap">Total</th>
                  <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground whitespace-nowrap">Estado</th>
                  <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground whitespace-nowrap">
                    <span className="inline-block -translate-x-2">Fecha</span>
                  </th>
                </tr>
              </thead>
              <AnimatedTableBody>
                {orders.map((order) => (
                  <AnimatedTableRow
                    key={order.id}
                    onClick={() => handleSelectOrder(order)}
                    className="border-b border-border hover:bg-secondary transition-colors cursor-pointer group"
                  >
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="font-mono font-medium text-foreground">#{order.orderNumber}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-medium text-foreground">{getCustomerName(order.customer)}</p>
                        <p className="text-xs text-muted-foreground">{order.customer.phone}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <span className="text-foreground">{order.itemCount}</span>
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      {order.paidAmount > 0 && order.pendingAmount > 0 ? (
                        <span>
                          <span className="text-emerald-400 font-medium">{formatCurrency(order.paidAmount)}</span>
                          <span className="text-muted-foreground/50 mx-1">/</span>
                          <span className="text-muted-foreground">{formatCurrency(order.total)}</span>
                        </span>
                      ) : order.pendingAmount === 0 ? (
                        <span className="font-medium text-emerald-400">{formatCurrency(order.total)}</span>
                      ) : (
                        <span className="font-medium text-foreground">{formatCurrency(order.total)}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      {getStatusBadges(order)}
                    </td>
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <div className="relative flex items-center justify-center w-full">
                        <span className="text-sm text-muted-foreground inline-block -translate-x-2">{timeAgo(order.createdAt)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTrashCandidate(order);
                            setTrashReasonDraft('');
                          }}
                          className="absolute right-0 translate-x-2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-all"
                          title="Cancelar y enviar a papelera"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </AnimatedTableRow>
                ))}
              </AnimatedTableBody>
            </table>
            </div>
            </>
          )}
        </div>

      </AnimatedPage>

      {/* Order detail sheet */}
      <Sheet open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <SheetContent className="sm:max-w-2xl lg:max-w-3xl overflow-hidden flex flex-col">
          {selectedOrder && (
            <>
              {/* Header */}
              <SheetHeader className="pr-10">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ring-2 ring-primary/20">
                    <ShoppingCart className="w-7 h-7 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <SheetTitle className="truncate">Pedido #{selectedOrder.orderNumber}</SheetTitle>
                    <SheetDescription className="mt-1">
                      {selectedOrder.createdAt && `${formatDateLong(selectedOrder.createdAt)} a las ${formatTime(selectedOrder.createdAt)}`}
                    </SheetDescription>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {getStatusBadges(selectedOrder)}
                </div>
              </SheetHeader>

              {/* Tabs */}
              <div className="flex gap-1 p-1 bg-secondary/50 rounded-xl mx-4 sm:mx-6 mt-2">
                <button
                  onClick={() => setActiveOrderTab('details')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                    activeOrderTab === 'details'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  <span>Detalles</span>
                </button>
                <button
                  onClick={() => setActiveOrderTab('receipts')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                    activeOrderTab === 'receipts'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Receipt className="w-4 h-4 flex-shrink-0" />
                  <span>Comprobantes</span>
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
                {isLoadingDetail ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : activeOrderTab === 'details' ? (
                  <div className="space-y-4">
                    {/* Customer info */}
                    <div className="p-4 rounded-xl bg-secondary/50">
                      <div className="flex items-center gap-3 mb-3">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">Cliente</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">
                            {getCustomerName(selectedOrder.customer).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{getCustomerName(selectedOrder.customer)}</p>
                          <p className="text-sm text-muted-foreground font-mono">{selectedOrder.customer?.phone || ''}</p>
                        </div>
                      </div>
                    </div>

                    {/* Order items - Collapsible */}
                    <div className="rounded-xl bg-secondary/50 overflow-hidden">
                      {/* Header - Always visible */}
                      <button
                        type="button"
                        onClick={() => setIsProductsExpanded(!isProductsExpanded)}
                        className="w-full p-4 flex items-center justify-between hover:bg-secondary/70 transition-colors"
                      >
                        <span className="text-sm font-medium text-muted-foreground">Ver detalles del pedido</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">{formatCurrency(selectedOrder.subtotal)}</span>
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isProductsExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {/* Expandable content */}
                      <div className={`transition-all duration-200 ease-in-out ${isProductsExpanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
                        <div className="px-4 pb-4">
                          {selectedOrder.items && selectedOrder.items.length > 0 ? (
                            <div className="space-y-2 max-h-[250px] overflow-y-auto scrollbar-hide">
                              {selectedOrder.items.map((item) => (
                                <div key={item.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-8 h-8 rounded-lg bg-background/50 flex items-center justify-center flex-shrink-0">
                                      <Package className="w-3.5 h-3.5 text-muted-foreground" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatCurrency(item.unitPrice)} x {item.quantity}
                                      </p>
                                    </div>
                                  </div>
                                  <p className="text-sm font-medium text-foreground ml-3">{formatCurrency(item.total)}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-4">
                              <p className="text-sm text-muted-foreground">{selectedOrder.itemCount} items</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Totals - Always visible */}
                      <div className="px-4 pb-4 pt-2 border-t border-border/50 space-y-2">
                        {selectedOrder.shipping > 0 && (
                          <div className="flex justify-between text-sm text-foreground">
                            <span>Envio</span>
                            <span>{formatCurrency(selectedOrder.shipping)}</span>
                          </div>
                        )}
                        {selectedOrder.discount > 0 && (
                          <div className="flex justify-between text-sm text-emerald-400">
                            <span>Descuento</span>
                            <span>-{formatCurrency(selectedOrder.discount)}</span>
                          </div>
                        )}
                        {selectedOrder.hasPromotion && selectedOrder.promotion && (
                          <div className="flex justify-between text-sm text-primary">
                            <span>Promo aplicada</span>
                            <span>{selectedOrder.promotion.name}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold text-foreground pt-2 border-t border-border">
                          <span>Total</span>
                          <span>{formatCurrency(selectedOrder.total)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Payment status */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <div className="flex items-center gap-2 mb-1">
                          <CreditCard className="w-4 h-4 text-emerald-400" />
                          <p className="text-xs text-emerald-400">Pagado</p>
                        </div>
                        <p className="text-xl font-bold text-emerald-400">{formatCurrency(selectedOrder.paidAmount)}</p>
                      </div>
                      <div className={`p-4 rounded-xl ${
                        selectedOrder.pendingAmount > 0
                          ? 'debt-warning-card'
                          : 'bg-secondary/50 border border-border'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <CreditCard className={`w-4 h-4 ${selectedOrder.pendingAmount > 0 ? 'debt-warning-text' : 'text-muted-foreground'}`} />
                          <p className={`text-xs ${selectedOrder.pendingAmount > 0 ? 'debt-warning-text' : 'text-muted-foreground'}`}>
                            Pendiente
                          </p>
                        </div>
                        <p className={`text-xl font-bold ${selectedOrder.pendingAmount > 0 ? 'debt-warning-text' : 'text-muted-foreground'}`}>
                          {formatCurrency(selectedOrder.pendingAmount)}
                        </p>
                      </div>
                    </div>

                    {/* Accept button */}
                    {(() => {
                      const acceptanceKey = resolveAcceptanceStatus(selectedOrder);
                      const isAccepted = acceptanceKey === 'accepted';
                      if (acceptanceKey === 'cancelled') {
                        return (
                          <div className="w-full p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-sm font-medium">Pedido cancelado</span>
                          </div>
                        );
                      }
                      return (
                        <Button
                          className={`w-full h-12 text-base${isAccepted ? ' bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/20 hover:shadow-blue-600/30' : ''}`}
                          variant="default"
                          onClick={() => { void handleAcceptAndPrint(); }}
                          disabled={isAccepting}
                        >
                          <Printer className="w-5 h-5 mr-2" />
                          {isAccepting
                            ? 'Procesando...'
                            : isAccepted
                              ? 'Re-imprimir boleta'
                              : 'Aceptar e imprimir boleta'}
                        </Button>
                      );
                    })()}

                    {/* Notes */}
                    {selectedOrder.notes && (
                      <div className="p-4 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium text-muted-foreground">Notas</span>
                        </div>
                        <p className="text-sm text-foreground">{selectedOrder.notes}</p>
                      </div>
                    )}

                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-xl bg-secondary/30">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Creado: {selectedOrder.createdAt && formatDate(selectedOrder.createdAt)}</span>
                    </div>

                    {/* Delete action */}
                    <div className="pt-4 border-t border-border">
                      <Button
                        variant="secondary"
                        className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => {
                          setTrashCandidate(selectedOrder);
                          setTrashReasonDraft('');
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Cancelar y enviar a la papelera
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Receipts Tab */
                  <div className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Comprobantes de pago</p>
                        <p className="text-xs text-muted-foreground">Cargá un comprobante manualmente</p>
                      </div>
                      <Button
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          resetReceiptUpload();
                          setIsReceiptUploadOpen(true);
                        }}
                      >
                        <Upload className="w-4 h-4 mr-1" />
                        Agregar comprobante
                      </Button>
                    </div>
                    {selectedOrder.receipts && selectedOrder.receipts.length > 0 ? (
                      selectedOrder.receipts.map((receipt) => {
                        const amount =
                          receipt.appliedAmount ??
                          receipt.declaredAmount ??
                          receipt.extractedAmount ??
                          null;
                        const methodLabel = receipt.paymentMethod
                          ? (RECEIPT_METHOD_LABELS[receipt.paymentMethod] || receipt.paymentMethod)
                          : 'Transferencia';
                        const previewUrl = receipt.fileType === 'image'
                          ? receiptPreviews[receipt.id]
                          : undefined;
                        return (
                          <div
                            key={receipt.id}
                            className="p-4 rounded-xl border border-border bg-secondary/50 group relative"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-xl bg-secondary flex items-center justify-center overflow-hidden border border-border flex-shrink-0">
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt="Comprobante"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <Receipt className="w-8 h-8 text-muted-foreground/60" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-foreground">
                                    {amount ? formatCurrency(amount) : 'Monto no detectado'}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                      (RECEIPT_STATUS_CONFIG[receipt.status] || RECEIPT_STATUS_CONFIG.pending_review).color
                                    }`}>
                                      {(RECEIPT_STATUS_CONFIG[receipt.status] || { label: receipt.status }).label}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReceiptToDelete(receipt);
                                        setShowReceiptDeleteConfirm(true);
                                      }}
                                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
                                      title="Eliminar comprobante"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {receipt.uploadedAt ? formatDate(receipt.uploadedAt) : 'Comprobante subido'}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Método: {methodLabel}
                                </p>
                                <div className="mt-3 flex items-center gap-2">
                                  {receipt.fileRef ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => { void openReceiptFile(receipt.id); }}
                                    >
                                      <Eye className="w-4 h-4 mr-1" />
                                      Ver comprobante
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      Sin archivo adjunto
                                    </span>
                                  )}
                                </div>
                                {receipt.status === 'pending_review' && (
                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    <Button
                                      size="sm"
                                      className="w-full"
                                      onClick={() => openReceiptAction(receipt, 'accept')}
                                    >
                                      Aprobar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                      onClick={() => openReceiptAction(receipt, 'reject')}
                                    >
                                      Rechazar
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                          <Receipt className="w-7 h-7 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground">Comprobantes de pago</p>
                        <p className="text-sm text-muted-foreground/50 mt-1">
                          Los comprobantes de este pedido apareceran aqui
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={isReceiptUploadOpen}
        onOpenChange={(open) => {
          setIsReceiptUploadOpen(open);
          if (!open) resetReceiptUpload();
        }}
      >
        <DialogContent className="max-w-lg max-h-[88dvh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Receipt className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle>Agregar comprobante</DialogTitle>
                <DialogDescription>Subí una imagen o PDF del comprobante de pago o registrá un pago en efectivo.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1 flex-1 min-h-0">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Método de pago</label>
              <Select
                value={receiptPaymentMethod}
                onValueChange={(value) => setReceiptPaymentMethod(value as 'transfer' | 'cash' | 'link')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un método" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                  {canUsePaymentLinks && <SelectItem value="link">Link de pago</SelectItem>}
                  <SelectItem value="cash">Efectivo</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Para efectivo no es necesario subir el comprobante.
              </p>
            </div>

            {receiptPaymentMethod !== 'cash' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Comprobante</label>
                {receiptFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearReceiptAttachment}
                    disabled={isReceiptUploading}
                  >
                    Quitar archivo
                  </Button>
                )}
              </div>
              <label className="flex flex-col items-center justify-center w-full h-28 rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50 transition-all cursor-pointer">
                {receiptFile ? (
                  <>
                    <FileText className="w-6 h-6 text-primary mb-1.5" />
                    <span className="text-sm text-foreground font-medium">{receiptFile.name}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">Click para cambiar archivo</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
                    <span className="text-sm text-muted-foreground">Click para seleccionar archivo</span>
                    <span className="text-xs text-muted-foreground/50 mt-0.5">JPG, PNG, PDF (máx. 5MB)</span>
                  </>
                )}
                <input
                  key={receiptFileInputKey}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            </div>
            )}

            {receiptPaymentMethod !== 'cash' && receiptPreviewUrl && (
              <div className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
                {receiptPreviewType === 'pdf' ? (
                  <iframe
                    src={receiptPreviewUrl}
                    title="Vista previa comprobante"
                    className="w-full h-56"
                  />
                ) : (
                  <img
                    src={receiptPreviewUrl}
                    alt="Vista previa comprobante"
                    className="w-full h-56 object-contain bg-background"
                  />
                )}
              </div>
            )}

            {receiptPaymentMethod !== 'cash' && canAutoDetectManualReceiptAmount && (
              <Switch
                checked={receiptAutoDetect}
                onChange={(e) => setReceiptAutoDetect(e.target.checked)}
                label="Detectar monto automáticamente"
                description="Si no se detecta, podés ingresarlo manualmente."
              />
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Monto</label>
              <Input
                placeholder="Ej: 4000"
                value={receiptAmount}
                onChange={(e) => setReceiptAmount(e.target.value)}
              />
              {receiptDetectedAmount !== null && (
                <p className="text-xs text-muted-foreground">
                  Monto detectado: {formatCurrency(receiptDetectedAmount)}
                </p>
              )}
            </div>

            {receiptUploadError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/20">
                <AlertTriangle className="w-4 h-4 text-primary flex-shrink-0" />
                <p className="text-sm text-primary">{receiptUploadError}</p>
              </div>
            )}

            <div className="flex gap-3 w-full">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setIsReceiptUploadOpen(false)}
                disabled={isReceiptUploading}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (receiptNeedsAmount) {
                    void handleApplyReceiptAmount();
                    return;
                  }
                  void handleUploadReceipt();
                }}
                disabled={isReceiptUploading}
              >
                {isReceiptUploading
                  ? 'Procesando...'
                  : receiptNeedsAmount
                    ? 'Aplicar comprobante'
                    : receiptPaymentMethod === 'cash'
                      ? 'Registrar pago'
                      : 'Subir comprobante'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create order modal */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open);
        if (!open) resetCreateForm();
      }}>
        <DialogContent className="max-w-5xl max-h-[90dvh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle>Nuevo pedido</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Selecciona productos y cliente</p>
              </div>
            </div>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 pt-4 flex-1 overflow-hidden">
            {/* Products - 3 columns */}
            <div className="lg:col-span-3 flex flex-col min-h-0">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                    <Package className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-foreground">Productos</h3>
                </div>
                <div className="relative flex-1 max-w-xs">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-hide pr-2 space-y-2">
                {isCreateLoading ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
                    <p className="text-muted-foreground">Cargando productos...</p>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                      <Package className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                    <p className="text-muted-foreground">No hay productos disponibles</p>
                  </div>
                ) : (
                  filteredProducts.map((product) => {
                    const quantity = itemQuantities[product.id] || 0;
                    const isSelected = quantity > 0;
                    return (
                      <div
                        key={product.id}
                        className={`flex items-center gap-4 p-3 rounded-xl transition-all ${
                          isSelected
                            ? 'bg-primary/10 border border-primary/30'
                            : 'bg-secondary hover:bg-secondary/80'
                        }`}
                      >
                        {/* Product image */}
                        <div className="w-14 h-14 rounded-xl bg-background/50 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {product.images && product.images.length > 0 ? (
                            <img
                              src={product.images[0].startsWith('/') ? `${API_URL}${product.images[0]}` : product.images[0]}
                              alt={product.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const fallback = target.nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'block';
                              }}
                            />
                          ) : null}
                          <Package
                            className="w-6 h-6 text-muted-foreground/50"
                            style={{ display: product.images && product.images.length > 0 ? 'none' : 'block' }}
                          />
                        </div>

                        {/* Product info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{product.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm font-semibold text-primary">{formatCurrency(product.price)}</span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className={`text-xs ${product.stock <= 5 ? 'text-primary' : 'text-muted-foreground'}`}>
                              Stock: {product.stock}
                            </span>
                          </div>
                        </div>

                        {/* Quantity controls */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => {
                              if (quantity > 0) {
                                setItemQuantities((prev) => ({
                                  ...prev,
                                  [product.id]: quantity - 1,
                                }));
                              }
                            }}
                            disabled={quantity === 0}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                              quantity === 0
                                ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                                : 'bg-secondary hover:bg-background text-foreground'
                            }`}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className={`w-8 text-center font-medium ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                            {quantity}
                          </span>
                          <button
                            onClick={() => {
                              if (quantity < product.stock) {
                                setItemQuantities((prev) => ({
                                  ...prev,
                                  [product.id]: quantity + 1,
                                }));
                              }
                            }}
                            disabled={quantity >= product.stock}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                              quantity >= product.stock
                                ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                                : 'bg-primary/20 hover:bg-primary/30 text-primary'
                            }`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Summary - 2 columns */}
            <div className="lg:col-span-2 flex flex-col gap-4 overflow-y-auto scrollbar-hide">
              {/* Customer selection */}
              <div className="glass-card rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Cliente</p>
                  </div>
                  {customerSearch && (
                    <span className="text-xs text-muted-foreground">
                      {filteredCustomers.length} resultado{filteredCustomers.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre o telefono..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {/* Customer list */}
                <div className="max-h-40 overflow-y-auto scrollbar-hide space-y-1">
                  {filteredCustomers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">
                      {customerSearch ? 'No se encontraron clientes' : 'No hay clientes disponibles'}
                    </p>
                  ) : (
                    filteredCustomers.map((customer) => {
                      const isSelected = selectedCustomerId === customer.id;
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => setSelectedCustomerId(isSelected ? '' : customer.id)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all ${
                            isSelected
                              ? 'bg-primary/20 border border-primary/30'
                              : 'bg-secondary/50 hover:bg-secondary border border-transparent'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-primary/30' : 'bg-background/50'
                          }`}>
                            <span className={`text-sm font-medium ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                              {(customer.fullName || customer.phone).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                              {customer.fullName || 'Sin nombre'}
                            </p>
                            <p className="text-xs text-muted-foreground">{customer.phone}</p>
                          </div>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                              <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Payment status */}
              <div className="glass-card rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Estado de pago</p>
                </div>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as 'pending' | 'partial' | 'paid')}
                  className="select-modern w-full"
                >
                  <option value="pending">No pagado</option>
                  <option value="partial">Pago parcial</option>
                  <option value="paid">Pagado</option>
                </select>

                {paymentStatus === 'partial' && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <Input
                      type="number"
                      min={0}
                      value={partialPaid}
                      onChange={(e) => setPartialPaid(e.target.value)}
                      placeholder="Monto pagado"
                    />
                    <p className="text-xs text-muted-foreground">
                      Ingresa un monto entre $1 y {formatCurrency(Math.max(subtotalCents - 100, 0))}
                    </p>
                  </div>
                )}
              </div>

              {/* Order summary */}
              <div className="glass-card rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Resumen del pedido</p>
                </div>

                {selectedItems.length > 0 ? (
                  <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hide">
                    {selectedItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate flex-1 mr-2">
                          {item.quantity}x {item.name}
                        </span>
                        <span className="text-foreground font-medium">
                          {formatCurrency(item.price * item.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay productos seleccionados
                  </p>
                )}

                <div className="pt-3 border-t border-border space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Productos</span>
                    <span className="text-foreground">{selectedItems.reduce((sum, i) => sum + i.quantity, 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-semibold">
                    <span className="text-foreground">Total</span>
                    <span className="text-primary">{formatCurrency(subtotalCents)}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-auto pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={() => { void handleCreateOrder(); }} disabled={!canCreate || isCreating}>
                  {isCreating ? 'Creando...' : 'Crear pedido'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Trash confirm modal */}
      <Dialog open={!!trashCandidate} onOpenChange={(open) => {
        if (!open) {
          setTrashCandidate(null);
          setTrashReasonDraft('');
        }
      }}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center text-center pt-2">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
              <Trash2 className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Cancelar y enviar a papelera</h3>
            <p className="text-sm text-muted-foreground mb-4">
              El pedido quedará cancelado y guardado en papelera. Debés indicar el motivo.
            </p>
            {trashCandidate && (
              <div className="w-full p-4 rounded-xl bg-secondary/50 border border-border mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background/50 flex items-center justify-center">
                    <span className="text-sm font-medium text-muted-foreground">
                      {getCustomerName(trashCandidate.customer).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="font-mono text-sm font-medium text-foreground">#{trashCandidate.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">{getCustomerName(trashCandidate.customer)}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="font-semibold text-foreground">{formatCurrency(trashCandidate.total)}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="w-full mb-6 text-left">
              <label className="text-sm font-medium text-foreground">Motivo de cancelación</label>
              <Input
                value={trashReasonDraft}
                onChange={(e) => setTrashReasonDraft(e.target.value)}
                placeholder="Ej: Cliente pidió cancelar el pedido"
                maxLength={500}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">Se enviará este motivo al cliente por WhatsApp.</p>
            </div>
            <div className="flex gap-3 w-full">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setTrashCandidate(null);
                  setTrashReasonDraft('');
                }}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-red-600 text-white hover:bg-red-500"
                onClick={() => { void handleMoveToTrash(); }}
                disabled={isTrashing}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {isTrashing ? 'Cancelando...' : 'Cancelar y enviar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Trash list modal */}
      <Dialog open={isTrashOpen} onOpenChange={setIsTrashOpen}>
        <DialogContent className="max-w-4xl max-h-[90dvh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-4 pr-8">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1">
                <DialogTitle>Papelera</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {trashedOrders.length} pedido{trashedOrders.length !== 1 ? 's' : ''} en papelera
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto pt-4">
            {isTrashLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
                <p className="text-muted-foreground">Cargando pedidos...</p>
              </div>
            ) : trashedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <Trash2 className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">Papelera vacía</p>
                <p className="text-sm text-muted-foreground/50 mt-1">
                  Los pedidos eliminados aparecerán aquí y podrás restaurarlos
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {trashedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className="w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg font-medium text-muted-foreground">
                        {getCustomerName(order.customer).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-medium text-foreground">#{order.orderNumber}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{timeAgo(order.createdAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{getCustomerName(order.customer)} · {order.customer.phone}</p>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Motivo: {order.trashReason || order.cancelReason || 'Sin motivo informado'}
                      </p>
                    </div>
                    <div className="text-right mr-2">
                      <p className="font-semibold text-foreground">{formatCurrency(order.total)}</p>
                      <p className="text-xs text-muted-foreground">{order.itemCount} items</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRestoreCandidate(order)}
                      className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore confirm modal */}
      <Dialog open={!!restoreCandidate} onOpenChange={(open) => {
        if (!open) setRestoreCandidate(null);
      }}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center text-center pt-2">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
              <RotateCcw className="w-8 h-8 text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Restaurar pedido</h3>
            <p className="text-sm text-muted-foreground mb-4">
              El pedido saldrá de la papelera y seguirá en estado cancelado.
            </p>
            {restoreCandidate && (
              <div className="w-full p-4 rounded-xl bg-secondary/50 border border-border mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background/50 flex items-center justify-center">
                    <span className="text-sm font-medium text-muted-foreground">
                      {getCustomerName(restoreCandidate.customer).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="font-mono text-sm font-medium text-foreground">#{restoreCandidate.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">{getCustomerName(restoreCandidate.customer)}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="font-semibold text-foreground">{formatCurrency(restoreCandidate.total)}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-3 w-full">
              <Button variant="secondary" className="flex-1" onClick={() => setRestoreCandidate(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-blue-600 text-white hover:bg-blue-500"
                onClick={() => { void handleRestoreFromTrash(); }}
                disabled={isRestoring}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                {isRestoring ? 'Restaurando...' : 'Restaurar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmModal
        isOpen={showReceiptDeleteConfirm}
        onClose={() => {
          setShowReceiptDeleteConfirm(false);
          setReceiptToDelete(null);
        }}
        onConfirm={handleDeleteReceipt}
        title="Eliminar comprobante"
        message={
          receiptToDelete
            ? `¿Eliminar el comprobante${receiptToDelete.appliedAmount || receiptToDelete.declaredAmount || receiptToDelete.extractedAmount ? ` de ${formatCurrency(
                receiptToDelete.appliedAmount ??
                  receiptToDelete.declaredAmount ??
                  receiptToDelete.extractedAmount ??
                  0
              )}` : ''}?`
            : '¿Eliminar comprobante?'
        }
        itemCount={1}
        isLoading={isDeletingReceipt}
      />

      <Dialog
        open={isReceiptActionOpen}
        onOpenChange={(open) => {
          setIsReceiptActionOpen(open);
          if (!open) resetReceiptAction();
        }}
      >
        <DialogContent className="max-w-md">
          {receiptActionType === 'accept' ? (
            <div className="space-y-4">
              <DialogHeader className="pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <DialogTitle>Aprobar comprobante</DialogTitle>
                    <DialogDescription>Aplicá el monto al pedido.</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Monto</label>
                <Input
                  placeholder="Ej: 4000"
                  value={receiptActionAmount}
                  onChange={(e) => setReceiptActionAmount(e.target.value)}
                />
              </div>
              {receiptActionError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/20">
                  <AlertTriangle className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-sm text-primary">{receiptActionError}</p>
                </div>
              )}
              <div className="flex gap-3 w-full pt-4 border-t border-border">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setIsReceiptActionOpen(false)}
                  disabled={isReceiptActionLoading}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/30"
                  onClick={() => { void handleReceiptAction(); }}
                  isLoading={isReceiptActionLoading}
                >
                  Aprobar
                </Button>
              </div>
            </div>
          ) : receiptActionType === 'reject' ? (
            <div className="space-y-4">
              <DialogHeader className="pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <DialogTitle>Rechazar comprobante</DialogTitle>
                    <DialogDescription>Indicá un motivo (opcional).</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Motivo</label>
                <Input
                  placeholder="Ej: monto ilegible"
                  value={receiptActionReason}
                  onChange={(e) => setReceiptActionReason(e.target.value)}
                />
              </div>
              {receiptActionError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/20">
                  <AlertTriangle className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-sm text-primary">{receiptActionError}</p>
                </div>
              )}
              <div className="flex gap-3 w-full pt-4 border-t border-border">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setIsReceiptActionOpen(false)}
                  disabled={isReceiptActionLoading}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => { void handleReceiptAction(); }}
                  isLoading={isReceiptActionLoading}
                >
                  Rechazar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
