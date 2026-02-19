import { AlertTriangle, FileText, Upload, Search, DollarSign, Users, Clock, Eye, MessageSquare, CreditCard, Send, Info } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { AnimatedPage, AnimatedStagger, StatCard, Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '../../components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../stores/toast.store';


type JsonRecord = Record<string, unknown>;
type DebtStatusFilter = 'all' | 'normal' | 'seguimiento' | 'alerta' | 'severo';

const envValues = import.meta.env as unknown as Record<string, unknown>;
const apiUrlFromEnv = envValues['VITE_API_URL'];
const API_URL = typeof apiUrlFromEnv === 'string' ? apiUrlFromEnv : '';

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, {
    ...init,
    credentials: 'include',
  });

interface CustomerWithDebt {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  currentBalance: number;
  orderCount: number;
  totalSpent: number;
  lastSeenAt: string;
  debtReminderCount?: number;
  lastDebtReminderAt?: string | null;
  debtDays?: number;
}

interface UnpaidOrder {
  orderId: string;
  orderNumber: string;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  createdAt: string;
  daysOld: number;
}

interface Stats {
  totalDebt: number;
  overdueDebt?: number;
  customersWithDebt: number;
  totalCustomers: number;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(record: JsonRecord | null, key: string): string | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: JsonRecord | null, key: string): number | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(record: JsonRecord | null, key: string): boolean | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readRecord(record: JsonRecord | null, key: string): JsonRecord | null {
  if (!record) {
    return null;
  }
  return asRecord(record[key]);
}

function readArray(record: JsonRecord | null, key: string): unknown[] {
  if (!record) {
    return [];
  }
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readErrorMessage(record: JsonRecord | null, fallback: string): string {
  return readString(record, 'message') ?? readString(record, 'error') ?? fallback;
}

async function readJsonRecord(response: Response): Promise<JsonRecord | null> {
  try {
    const payload: unknown = await response.json();
    return asRecord(payload);
  } catch {
    return null;
  }
}

function parseCustomerWithDebt(value: unknown): CustomerWithDebt | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = readString(record, 'id');
  const phone = readString(record, 'phone');
  if (!id || !phone) {
    return null;
  }

  const firstName = readString(record, 'firstName') ?? null;
  const lastName = readString(record, 'lastName') ?? null;
  const fullName = readString(record, 'fullName') ?? null;

  return {
    id,
    phone,
    firstName,
    lastName,
    fullName,
    currentBalance: readNumber(record, 'currentBalance') ?? 0,
    orderCount: readNumber(record, 'orderCount') ?? 0,
    totalSpent: readNumber(record, 'totalSpent') ?? 0,
    lastSeenAt: readString(record, 'lastSeenAt') ?? '',
    debtReminderCount: readNumber(record, 'debtReminderCount'),
    lastDebtReminderAt: readString(record, 'lastDebtReminderAt') ?? null,
    debtDays: readNumber(record, 'debtDays'),
  };
}

function parseUnpaidOrder(value: unknown): UnpaidOrder | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const orderId = readString(record, 'orderId');
  const orderNumber = readString(record, 'orderNumber');
  if (!orderId || !orderNumber) {
    return null;
  }

  return {
    orderId,
    orderNumber,
    total: readNumber(record, 'total') ?? 0,
    paidAmount: readNumber(record, 'paidAmount') ?? 0,
    pendingAmount: readNumber(record, 'pendingAmount') ?? 0,
    createdAt: readString(record, 'createdAt') ?? '',
    daysOld: readNumber(record, 'daysOld') ?? 0,
  };
}

function parseUnpaidOrders(record: JsonRecord | null): UnpaidOrder[] {
  return readArray(record, 'orders')
    .map(item => parseUnpaidOrder(item))
    .filter((order): order is UnpaidOrder => order !== null);
}

function parseBulkResult(
  record: JsonRecord | null
): { sent: number; failed: number; total: number } {
  return {
    sent: readNumber(record, 'sent') ?? 0,
    failed: readNumber(record, 'failed') ?? 0,
    total: readNumber(record, 'total') ?? 0,
  };
}

function revokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function DebtsPage(): JSX.Element {
  const { workspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [customersWithDebt, setCustomersWithDebt] = useState<CustomerWithDebt[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DebtStatusFilter>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithDebt | null>(null);
  const [isStatusInfoOpen, setIsStatusInfoOpen] = useState(false);
  const [isBulkReminderOpen, setIsBulkReminderOpen] = useState(false);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [reminderCustomer, setReminderCustomer] = useState<CustomerWithDebt | null>(null);
  const [reminderOrders, setReminderOrders] = useState<UnpaidOrder[]>([]);
  const [isReminderLoading, setIsReminderLoading] = useState(false);
  const [isReminderSending, setIsReminderSending] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<CustomerWithDebt | null>(null);
  const [paymentOrders, setPaymentOrders] = useState<UnpaidOrder[]>([]);
  const [selectedPaymentOrderId, setSelectedPaymentOrderId] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
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
  const [detailOrders, setDetailOrders] = useState<UnpaidOrder[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Fetch customers with debt
  useEffect(() => {
    if (!workspace?.id) {
      return;
    }

    const fetchData = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const headers = {
          'X-Workspace-Id': workspace.id,
        };

        // Fetch all customers and filter by debt
        const queryParams = new URLSearchParams({
          limit: '100',
          ...(search && { search }),
        });

        const [customersRes, statsRes] = await Promise.all([
          fetchWithCredentials(`${API_URL}/api/v1/customers?${queryParams.toString()}`, { headers }),
          fetchWithCredentials(`${API_URL}/api/v1/customers/stats`, { headers }),
        ]);

        let debtors: CustomerWithDebt[] = [];
        if (customersRes.ok) {
          const data = await readJsonRecord(customersRes);
          // Filter customers with debt
          debtors = readArray(data, 'customers')
            .map(customer => parseCustomerWithDebt(customer))
            .filter((customer): customer is CustomerWithDebt => customer !== null && customer.currentBalance > 0);
          // Sort by debt amount (highest first)
          debtors.sort((a: CustomerWithDebt, b: CustomerWithDebt) => b.currentBalance - a.currentBalance);
          setCustomersWithDebt(debtors);
        }

        if (statsRes.ok) {
          const data = await readJsonRecord(statsRes);
          setStats({
            totalDebt: readNumber(data, 'totalDebt') ?? 0,
            overdueDebt: readNumber(data, 'overdueDebt') ?? 0,
            customersWithDebt: debtors.length,
            totalCustomers: readNumber(data, 'totalCustomers') ?? 0,
          });
        }
      } catch (error) {
        console.error('Failed to fetch debts:', error);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [workspace?.id, search]);

  // Recalculate stats from loaded data
  useEffect(() => {
    if (customersWithDebt.length > 0 || !isLoading) {
      const totalDebt = customersWithDebt.reduce((sum, c) => sum + c.currentBalance, 0);
      setStats((prev): Stats => ({
        ...prev,
        totalDebt,
        customersWithDebt: customersWithDebt.length,
        totalCustomers: prev?.totalCustomers || 0,
        overdueDebt: prev?.overdueDebt || 0,
      }));
    }
  }, [customersWithDebt, isLoading]);

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

  const clearReceiptAttachment = useCallback((): void => {
    setReceiptFile(null);
    setReceiptNeedsAmount(false);
    setPendingReceiptId(null);
    setReceiptDetectedAmount(null);
    setReceiptUploadError('');
    if (receiptPreviewUrl) {
      revokeObjectUrl(receiptPreviewUrl);
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
    if (!receiptFile) {
      setReceiptPreviewUrl((previousUrl) => {
        if (previousUrl) {
          revokeObjectUrl(previousUrl);
        }
        return null;
      });
      setReceiptPreviewType(null);
      return;
    }

    const url = URL.createObjectURL(receiptFile);
    setReceiptPreviewUrl((previousUrl) => {
      if (previousUrl) {
        revokeObjectUrl(previousUrl);
      }
      return url;
    });
    setReceiptPreviewType(receiptFile.type === 'application/pdf' ? 'pdf' : 'image');

    return (): void => {
      revokeObjectUrl(url);
    };
  }, [receiptFile]);

  const buildAuthHeaders = (): Record<string, string> | null => {
    if (!workspace?.id) {
      return null;
    }
    return {
      'X-Workspace-Id': workspace.id,
    };
  };

  const fetchUnpaidOrders = async (customerId: string): Promise<UnpaidOrder[]> => {
    const headers = buildAuthHeaders();
    if (!headers) {
      return [];
    }
    const res = await fetchWithCredentials(`${API_URL}/api/v1/customers/${customerId}/unpaid-orders`, { headers });
    if (!res.ok) {
      return [];
    }
    const data = await readJsonRecord(res);
    return parseUnpaidOrders(data);
  };

  const openCustomerDetail = async (customer: CustomerWithDebt): Promise<void> => {
    setSelectedCustomer(customer);
    setIsDetailLoading(true);
    try {
      const orders = await fetchUnpaidOrders(customer.id);
      setDetailOrders(orders);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleOpenOrder = (orderId: string): void => {
    setSelectedCustomer(null);
    setDetailOrders([]);
    navigate(`/orders?orderId=${orderId}`);
  };

  const openReminderModal = async (customer: CustomerWithDebt): Promise<void> => {
    setSelectedCustomer(null);
    setReminderCustomer(customer);
    setIsReminderLoading(true);
    try {
      const orders = await fetchUnpaidOrders(customer.id);
      setReminderOrders(orders);
    } finally {
      setIsReminderLoading(false);
    }
  };

  const handleSendReminder = async (): Promise<void> => {
    if (!workspace?.id || !reminderCustomer) {
      return;
    }
    setIsReminderSending(true);
    try {
      const headers = buildAuthHeaders();
      if (!headers) throw new Error('No se pudo autenticar');
      const res = await fetchWithCredentials(`${API_URL}/api/v1/customers/${reminderCustomer.id}/debt-reminder`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const body = await readJsonRecord(res);
        throw new Error(readErrorMessage(body, 'No se pudo enviar el recordatorio'));
      }
      toast.success('Recordatorio enviado');
      setReminderCustomer(null);
      setReminderOrders([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar el recordatorio');
    } finally {
      setIsReminderSending(false);
    }
  };

  const handleBulkReminder = async (): Promise<void> => {
    if (!workspace?.id) {
      return;
    }
    setIsBulkSending(true);
    try {
      const headers = buildAuthHeaders();
      if (!headers) throw new Error('No se pudo autenticar');
      const res = await fetchWithCredentials(`${API_URL}/api/v1/customers/debt-reminders/bulk`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const body = await readJsonRecord(res);
        throw new Error(readErrorMessage(body, 'No se pudo enviar recordatorios'));
      }
      const data = await readJsonRecord(res);
      setBulkResult(parseBulkResult(data));
      toast.success('Recordatorios enviados');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar recordatorios');
    } finally {
      setIsBulkSending(false);
    }
  };

  const openPaymentModal = async (customer: CustomerWithDebt): Promise<void> => {
    setSelectedCustomer(null);
    setPaymentCustomer(customer);
    setIsPaymentModalOpen(true);
    setIsReminderLoading(false);
    resetReceiptUpload();
    const orders = await fetchUnpaidOrders(customer.id);
    setPaymentOrders(orders);
    setSelectedPaymentOrderId(orders[0]?.orderId || '');
  };

  const handleUploadReceipt = async (): Promise<void> => {
    if (!workspace?.id || !selectedPaymentOrderId) {
      return;
    }
    const isCash = receiptPaymentMethod === 'cash';
    if (isCash && !receiptAmount.trim()) {
      setReceiptUploadError('Ingresá un monto');
      return;
    }
    if (!isCash) {
      if (!receiptFile) {
        setReceiptUploadError('Seleccioná un comprobante');
        return;
      }
      if (!receiptAutoDetect && !receiptAmount.trim()) {
        setReceiptUploadError('Ingresá un monto o activá la detección automática');
        return;
      }
    }

    setIsReceiptUploading(true);
    setReceiptUploadError('');
    try {
      const headers: Record<string, string> = {
        'X-Workspace-Id': workspace.id,
      };

      const response = isCash
        ? await fetchWithCredentials(`${API_URL}/api/v1/orders/${selectedPaymentOrderId}/receipts`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: receiptAmount.trim(),
              paymentMethod: receiptPaymentMethod,
            }),
          })
        : await fetchWithCredentials(`${API_URL}/api/v1/orders/${selectedPaymentOrderId}/receipts`, {
            method: 'POST',
            headers,
            body: (() => {
              const formData = new FormData();
              formData.append('file', receiptFile as File);
              formData.append('autoDetect', receiptAutoDetect ? 'true' : 'false');
              formData.append('paymentMethod', receiptPaymentMethod);
              if (receiptAmount.trim()) {
                formData.append('amount', receiptAmount.trim());
              }
              return formData;
            })(),
          });

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
      if (readBoolean(data, 'applied')) {
        toast.success('Pago registrado');
        setIsPaymentModalOpen(false);
        resetReceiptUpload();
        return;
      }

      if (!isCash) {
        setPendingReceiptId(readString(data, 'receiptId') ?? readString(readRecord(data, 'receipt'), 'id') ?? null);
        setReceiptNeedsAmount(true);
        const extractedAmount = readNumber(data, 'extractedAmount');
        if (typeof extractedAmount === 'number') {
          setReceiptDetectedAmount(extractedAmount);
          setReceiptAmount((extractedAmount / 100).toString());
        } else {
          setReceiptDetectedAmount(null);
        }
        setReceiptUploadError('No pude detectar el monto. Ingresalo manualmente.');
      }
    } catch (error) {
      setReceiptUploadError(error instanceof Error ? error.message : 'No se pudo subir el comprobante');
    } finally {
      setIsReceiptUploading(false);
    }
  };

  const handleApplyReceiptAmount = async (): Promise<void> => {
    if (!workspace?.id || !selectedPaymentOrderId || !pendingReceiptId) {
      return;
    }
    const amountCents = parseMoneyInputToCents(receiptAmount);
    if (!amountCents) {
      setReceiptUploadError('Ingresá un monto válido');
      return;
    }
    setIsReceiptUploading(true);
    setReceiptUploadError('');
    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/integrations/receipts/${pendingReceiptId}/apply`, {
        method: 'POST',
        headers: {
          'X-Workspace-Id': workspace.id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: selectedPaymentOrderId,
          amount: amountCents,
        }),
      });

      if (!response.ok) {
        let message = 'No se pudo aplicar el comprobante';
        const body = await readJsonRecord(response);
        message = readErrorMessage(body, message);
        throw new Error(message);
      }

      toast.success('Pago registrado');
      setIsPaymentModalOpen(false);
      resetReceiptUpload();
    } catch (error) {
      setReceiptUploadError(error instanceof Error ? error.message : 'No se pudo aplicar el comprobante');
    } finally {
      setIsReceiptUploading(false);
    }
  };

  // Format date
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
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

  // Get debt severity color
  const getDebtSeverity = (amount: number): string => {
    if (amount > 0) return 'debt-warning-text';
    return 'text-foreground';
  };

  const resolveDebtStatus = (
    days: number
  ): { label: string; color: string } => {
    if (days < 5) {
      return { label: 'Normal', color: 'bg-emerald-500/20 text-emerald-400' };
    }
    if (days < 15) {
      return { label: 'Seguimiento', color: 'bg-primary/20 text-primary' };
    }
    if (days < 30) {
      return { label: 'Alerta', color: 'bg-primary/20 text-primary' };
    }
    return { label: 'Severo', color: 'bg-red-500/20 text-red-400' };
  };

  const resolveDebtStatusKey = (days: number): DebtStatusFilter => {
    if (days < 5) return 'normal';
    if (days < 15) return 'seguimiento';
    if (days < 30) return 'alerta';
    return 'severo';
  };

  const filteredCustomers = customersWithDebt.filter((customer) => {
    if (statusFilter === 'all') return true;
    const days = customer.debtDays ?? 0;
    return resolveDebtStatusKey(days) === statusFilter;
  });

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Deudas</h1>
            <p className="text-sm text-muted-foreground">
              Seguimiento de pagos pendientes
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                className="w-full pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as DebtStatusFilter)}
            >
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder="Estado deuda" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="seguimiento">Seguimiento</SelectItem>
                <SelectItem value="alerta">Alerta</SelectItem>
                <SelectItem value="severo">Severo</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => {
              setBulkResult(null);
              setIsBulkReminderOpen(true);
            }}>
              <Send className="w-4 h-4 mr-2" />
              Enviar recordatorio masivo
            </Button>
          </div>
        </div>

        {/* Stats */}
        <AnimatedStagger className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          <StatCard label="Total por cobrar" value={formatCurrency(stats?.totalDebt ?? 0)} icon={DollarSign} color="primary" isLoading={isLoading} />
          <StatCard label="Clientes con deuda" value={(stats?.customersWithDebt ?? 0).toString()} icon={Users} color="primary" isLoading={isLoading} />
          <StatCard label="Vencido (+30 dias)" value={formatCurrency(stats?.overdueDebt ?? 0)} icon={Clock} color="red" isLoading={isLoading} />
        </AnimatedStagger>

        {/* Debts table */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Seguimiento de deudas</h3>
            {stats && stats.totalDebt > 0 && (
              <Badge variant="warning" className="text-white">
                Total: {formatCurrency(stats.totalDebt)}
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : customersWithDebt.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <DollarSign className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground">No hay deudas pendientes</p>
              <p className="text-sm text-muted-foreground/50 mt-1">
                Todos tus clientes están al día con sus pagos
              </p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <Clock className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground">No hay clientes con este estado</p>
              <p className="text-sm text-muted-foreground/50 mt-1">
                Probá con otro estado para ver resultados
              </p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {filteredCustomers.map((customer) => {
                const status = resolveDebtStatus(customer.debtDays ?? 0);
                return (
                  <button
                    key={customer.id}
                    onClick={() => {
                      void openCustomerDetail(customer);
                    }}
                    className="w-full text-left px-4 py-3.5 hover:bg-secondary/50 transition-colors active:bg-secondary"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-primary">
                          {customer.firstName?.[0]?.toUpperCase() || customer.phone.slice(-2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm text-foreground truncate">
                            {customer.fullName || 'Sin nombre'}
                          </p>
                          <span className={`text-sm font-semibold flex-shrink-0 ${getDebtSeverity(customer.currentBalance)}`}>
                            {formatCurrency(customer.currentBalance)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{customer.phone}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${status.color}`}>
                            {status.label}
                          </span>
                          <span className="text-xs text-muted-foreground">{customer.debtDays ?? 0} días</span>
                          <span className="text-xs text-muted-foreground ml-auto">{customer.orderCount} pedidos</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-2 -mb-1">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void openReminderModal(customer);
                        }}
                        className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-emerald-400"
                        title="Enviar recordatorio"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void openPaymentModal(customer);
                        }}
                        className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                        title="Registrar pago"
                      >
                        <CreditCard className="w-4 h-4" />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Cliente</th>
                    <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Telefono</th>
                    <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Deuda</th>
                    <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground">Pedidos</th>
                    <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground">
                      <div className="inline-flex items-center gap-1">
                        Estado
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setIsStatusInfoOpen(true);
                          }}
                          className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                          title="Cómo se calcula"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </th>
                    <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Ultima visita</th>
                    <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="border-b border-border hover:bg-secondary transition-colors cursor-pointer"
                      onClick={() => {
                        void openCustomerDetail(customer);
                      }}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3" title="Ver detalle de deuda">
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary">
                              {customer.firstName?.[0]?.toUpperCase() || customer.phone.slice(-2)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {customer.fullName || 'Sin nombre'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-sm text-foreground/80">{customer.phone}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={`font-semibold ${getDebtSeverity(customer.currentBalance)}`}>
                          {formatCurrency(customer.currentBalance)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="text-foreground">{customer.orderCount}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {(() => {
                          const status = resolveDebtStatus(customer.debtDays ?? 0);
                          return (
                            <div className="inline-flex items-center gap-2">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
                                {status.label}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {customer.debtDays ?? 0} días
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="text-sm text-muted-foreground">{timeAgo(customer.lastSeenAt)}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void openCustomerDetail(customer);
                            }}
                            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                            title="Ver detalles"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-emerald-400"
                            title="Enviar recordatorio"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openReminderModal(customer);
                            }}
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          <button
                            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                            title="Registrar pago"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openPaymentModal(customer);
                            }}
                          >
                            <CreditCard className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>

        {/* Customer detail modal */}
        <Dialog
          open={!!selectedCustomer}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCustomer(null);
              setDetailOrders([]);
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[90dvh] flex flex-col">
            {selectedCustomer && (
              <>
                <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <DialogTitle>Detalle de deuda</DialogTitle>
                      <DialogDescription>
                        {selectedCustomer.fullName || selectedCustomer.phone}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-1 -mx-1">
                  {/* Customer header */}
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-xl font-bold text-primary">
                        {selectedCustomer.firstName?.[0]?.toUpperCase() || selectedCustomer.phone.slice(-2)}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-foreground">
                        {selectedCustomer.fullName || 'Sin nombre'}
                      </h4>
                      <p className="text-sm font-mono text-muted-foreground">{selectedCustomer.phone}</p>
                    </div>
                  </div>

                  {/* Debt alert */}
                  <div className="p-4 rounded-xl debt-warning-card">
                    <div className="text-center">
                      <p className="text-sm debt-warning-text">Deuda pendiente</p>
                      <p className="text-3xl font-bold debt-warning-text">
                        {formatCurrency(selectedCustomer.currentBalance)}
                      </p>
                    </div>
                  </div>

                  {/* Orders list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">Pedidos con deuda</p>
                      {detailOrders.length > 0 && (
                        <span className="text-xs text-muted-foreground">Tocá un pedido para abrirlo</span>
                      )}
                    </div>
                    {isDetailLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                      </div>
                    ) : detailOrders.length === 0 ? (
                      <div className="p-3 rounded-xl bg-secondary/50 text-sm text-muted-foreground">
                        No hay pedidos pendientes.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {detailOrders.map((order) => (
                          <button
                            key={order.orderId}
                            className="w-full text-left p-3 rounded-xl border border-border bg-secondary/50 hover:bg-secondary/70 transition-colors"
                            onClick={() => handleOpenOrder(order.orderId)}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-foreground">{order.orderNumber}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(order.createdAt)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-foreground">
                                  {formatCurrency(order.pendingAmount)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Pendiente
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Customer stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-secondary/50">
                      <p className="text-sm text-muted-foreground">Pedidos</p>
                      <p className="font-medium text-foreground">{selectedCustomer.orderCount}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-secondary/50">
                      <p className="text-sm text-muted-foreground">Total gastado</p>
                      <p className="font-medium text-foreground">{formatCurrency(selectedCustomer.totalSpent)}</p>
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex gap-3 w-full pt-4 border-t border-border flex-shrink-0">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      void openReminderModal(selectedCustomer);
                    }}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Enviar recordatorio
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      void openPaymentModal(selectedCustomer);
                    }}
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Registrar pago
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isStatusInfoOpen} onOpenChange={setIsStatusInfoOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader className="pb-4 border-b border-border">
              <DialogTitle>Estado de deuda</DialogTitle>
              <DialogDescription>
                Se calcula por los días desde la creación del pedido más antiguo pendiente.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Normal</span>
                <span>&lt; 5 días</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Seguimiento</span>
                <span>5 a 15 días</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Alerta</span>
                <span>15 a 30 días</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Severo</span>
                <span>30 días o más</span>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isBulkReminderOpen} onOpenChange={setIsBulkReminderOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader className="pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Send className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <DialogTitle>Recordatorio masivo</DialogTitle>
                  <DialogDescription>
                    Se enviará un recordatorio a todos los clientes con deuda
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-secondary/50">
                <p className="text-sm text-muted-foreground">
                  Clientes con deuda: <span className="text-foreground font-medium">{customersWithDebt.length}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Total por cobrar: <span className="text-foreground font-medium">{formatCurrency(stats?.totalDebt ?? 0)}</span>
                </p>
              </div>
              {bulkResult && (
                <div className="p-4 rounded-xl bg-secondary/50 text-sm text-muted-foreground">
                  Enviados: {bulkResult.sent} · Fallidos: {bulkResult.failed}
                </div>
              )}
              <div className="flex gap-3 w-full pt-4 border-t border-border">
                <Button variant="secondary" className="flex-1" onClick={() => setIsBulkReminderOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    void handleBulkReminder();
                  }}
                  isLoading={isBulkSending}
                >
                  Enviar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!reminderCustomer}
          onOpenChange={(open) => {
            if (!open) {
              setReminderCustomer(null);
              setReminderOrders([]);
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader className="pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <DialogTitle>Enviar recordatorio</DialogTitle>
                  <DialogDescription>
                    {reminderCustomer?.fullName || reminderCustomer?.phone}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              {isReminderLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">Pedidos con deuda:</p>
                    {reminderOrders.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hay pedidos pendientes.</p>
                    ) : (
                      <div className="space-y-1 text-sm text-foreground">
                        {reminderOrders.map((order) => (
                          <div key={order.orderId} className="flex items-center justify-between">
                            <span>{order.orderNumber}</span>
                            <span>{formatCurrency(order.pendingAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 w-full pt-4 border-t border-border">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => {
                        setReminderCustomer(null);
                        setReminderOrders([]);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={() => {
                        void handleSendReminder();
                      }}
                      isLoading={isReminderSending}
                      disabled={reminderOrders.length === 0}
                    >
                      Enviar
                    </Button>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isPaymentModalOpen}
          onOpenChange={(open) => {
            setIsPaymentModalOpen(open);
            if (!open) {
              setPaymentCustomer(null);
              setPaymentOrders([]);
              setSelectedPaymentOrderId('');
              resetReceiptUpload();
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[90dvh] flex flex-col">
            <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <DialogTitle>Registrar pago</DialogTitle>
                  <DialogDescription>
                    {paymentCustomer?.fullName || paymentCustomer?.phone}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4 py-4 px-1 -mx-1">
              <div className="space-y-2">
                <Label>Pedido</Label>
                <Select value={selectedPaymentOrderId} onValueChange={setSelectedPaymentOrderId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccioná un pedido" />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentOrders.map((order) => (
                      <SelectItem key={order.orderId} value={order.orderId}>
                        {order.orderNumber} · {formatCurrency(order.pendingAmount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Método de pago</Label>
                <Select
                  value={receiptPaymentMethod}
                  onValueChange={(value) => setReceiptPaymentMethod(value as 'transfer' | 'cash' | 'link')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccioná un método" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="link">Link de pago</SelectItem>
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
                    <Label>Comprobante</Label>
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

              {receiptPaymentMethod !== 'cash' && (
                <Switch
                  checked={receiptAutoDetect}
                  onChange={(e) => setReceiptAutoDetect(e.target.checked)}
                  label="Detectar monto automáticamente"
                  description="Si no se detecta, podés ingresarlo manualmente."
                />
              )}

              <div className="space-y-2">
                <Label>Monto</Label>
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
            </div>

            <div className="flex gap-3 w-full pt-4 border-t border-border">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setIsPaymentModalOpen(false)}
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
                isLoading={isReceiptUploading}
                disabled={!selectedPaymentOrderId}
              >
                {receiptNeedsAmount
                  ? 'Aplicar comprobante'
                  : receiptPaymentMethod === 'cash'
                    ? 'Registrar pago'
                    : 'Subir comprobante'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </AnimatedPage>
    </div>
  );
}
