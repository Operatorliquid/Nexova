import {
  UserPlus,
  User,
  Phone,
  Mail,
  CreditCard,
  Calendar,
  ShoppingBag,
  FileText,
  Sparkles,
  Trash2,
  AlertTriangle,
  Clock,
  DollarSign,
  Users,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  Button,
  Input,
  Badge,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AnimatedPage,
  AnimatedStagger,
  StatCard,
  AnimatedTableBody,
  AnimatedTableRow,
} from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, API_URL } from '../../lib/api';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';
import { PENDING_INVOICING_BADGE } from '../../lib/statusStyles';
import { useToast } from '../../stores/toast.store';

type JsonRecord = Record<string, unknown>;

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, {
  ...init,
  credentials: 'include',
});

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function readString(record: JsonRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(record: JsonRecord | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

interface Customer {
  id: string;
  phone: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  status: string;
  orderCount: number;
  totalSpent: number;
  currentBalance: number;
  paymentScore: number;
  dni: string | null;
  cuit?: string | null;
  businessName?: string | null;
  fiscalAddress?: string | null;
  vatCondition?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}

interface CustomerNote {
  id: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  invoiceStatus?: 'pending_invoicing' | 'invoiced' | 'invoice_cancelled' | null;
  total: number;
  paidAmount: number;
  itemCount: number;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  createdAt: string;
  deliveredAt: string | null;
}

interface Stats {
  totalCustomers: number;
  activeCustomers: number;
  newCustomers: number;
  averageSpent: number;
  totalRevenue: number;
  totalDebt: number;
}

function asCustomer(value: unknown): Customer | null {
  return asRecord(value) as Customer | null;
}

function asCustomerList(value: unknown): Customer[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => asRecord(item) !== null) as Customer[];
}

function asStats(value: unknown): Stats | null {
  return asRecord(value) as Stats | null;
}

function asCustomerNote(value: unknown): CustomerNote | null {
  return asRecord(value) as CustomerNote | null;
}

function asCustomerNoteList(value: unknown): CustomerNote[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => asRecord(item) !== null) as CustomerNote[];
}

function asCustomerOrderList(value: unknown): CustomerOrder[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => asRecord(item) !== null) as CustomerOrder[];
}

type ModalTab = 'info' | 'notes' | 'orders';

const VAT_CONDITION_LABELS: Record<string, string> = {
  '1': 'Responsable inscripto',
  '4': 'Sujeto exento',
  '5': 'Consumidor final',
  '6': 'Responsable monotributo',
  '7': 'Sujeto no categorizado',
  '8': 'Proveedor del exterior',
  '9': 'Cliente del exterior',
  '10': 'IVA liberado',
  '13': 'Monotributista social',
  '15': 'IVA no alcanzado',
  '16': 'Monotributo trabajador independiente promovido',
};

const VAT_CONDITIONS = Object.entries(VAT_CONDITION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const formatVatCondition = (value?: string | null): string => {
  if (!value) return 'No registrada';
  const trimmed = value.trim();
  if (!trimmed) return 'No registrada';
  return VAT_CONDITION_LABELS[trimmed] || value;
};

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const VAT_CONDITION_LOOKUP = VAT_CONDITIONS.reduce<Record<string, string>>((acc, item) => {
  acc[normalizeText(item.label)] = item.value;
  return acc;
}, {});

const VAT_CONDITION_VALUES = new Set(VAT_CONDITIONS.map((item) => item.value));

const CUSTOMER_DELETE_PENDING_ORDER_STATUSES = new Set<string>([
  'draft',
  'awaiting_acceptance',
  'accepted',
  'pending_payment',
  'partial_payment',
  'processing',
  'confirmed',
  'preparing',
  'ready',
  'shipped',
  'pending_invoicing',
]);

type EditableField =
  | 'dni'
  | 'email'
  | 'cuit'
  | 'businessName'
  | 'fiscalAddress'
  | 'vatCondition';

const CUSTOMER_FIELD_LIMITS = {
  dni: 10,
  cuit: 11,
  email: 120,
  businessName: 120,
  fiscalAddress: 180,
} as const;

const CUSTOMER_TEXT_REGEX = /[^0-9A-Za-zÀ-ÿ\s.,'"\-_/()#&º°]/g;

const sanitizeEditableFieldValue = (field: EditableField, value: string): string => {
  switch (field) {
    case 'dni':
      return value.replace(/\D/g, '').slice(0, CUSTOMER_FIELD_LIMITS.dni);
    case 'cuit':
      return value.replace(/\D/g, '').slice(0, CUSTOMER_FIELD_LIMITS.cuit);
    case 'email':
      return value.replace(/\s+/g, '').slice(0, CUSTOMER_FIELD_LIMITS.email);
    case 'businessName':
      return value
        .replace(CUSTOMER_TEXT_REGEX, '')
        .replace(/\s+/g, ' ')
        .slice(0, CUSTOMER_FIELD_LIMITS.businessName);
    case 'fiscalAddress':
      return value
        .replace(CUSTOMER_TEXT_REGEX, '')
        .replace(/\s+/g, ' ')
        .slice(0, CUSTOMER_FIELD_LIMITS.fiscalAddress);
    case 'vatCondition':
      return value;
    default:
      return value;
  }
};

const validateEditableFieldValue = (field: EditableField, value: string): string | null => {
  if (!value) return null;

  switch (field) {
    case 'dni':
      return /^\d{7,10}$/.test(value)
        ? null
        : 'El DNI debe tener entre 7 y 10 dígitos.';
    case 'cuit':
      return /^\d{11}$/.test(value)
        ? null
        : 'El CUIT debe tener exactamente 11 dígitos.';
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : 'Ingresá un email válido.';
    case 'businessName':
      return value.length >= 2
        ? null
        : 'La razón social debe tener al menos 2 caracteres.';
    case 'fiscalAddress':
      return value.length >= 5
        ? null
        : 'El domicilio fiscal debe tener al menos 5 caracteres.';
    case 'vatCondition':
      return VAT_CONDITION_VALUES.has(value)
        ? null
        : 'Seleccioná una condición de IVA válida.';
    default:
      return null;
  }
};

const normalizeVatConditionId = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) return trimmed;
  return VAT_CONDITION_LOOKUP[normalizeText(trimmed)] || '';
};

export default function CustomersPage(): JSX.Element {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerDni, setNewCustomerDni] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerCuit, setNewCustomerCuit] = useState('');
  const [newCustomerBusinessName, setNewCustomerBusinessName] = useState('');
  const [newCustomerFiscalAddress, setNewCustomerFiscalAddress] = useState('');
  const [newCustomerVatCondition, setNewCustomerVatCondition] = useState('');
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSavingField, setIsSavingField] = useState(false);

  // Sheet state
  const [activeTab, setActiveTab] = useState<ModalTab>('info');
  const [notes, setNotes] = useState<CustomerNote[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const customerIdParam = searchParams.get('customerId');
  const customerPhoneParam = searchParams.get('customerPhone');

  const fetchCustomersAndStats = useCallback(async (searchTerm: string): Promise<void> => {
    if (!workspace?.id) return;

    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams({ limit: '100' });
      if (searchTerm.trim()) {
        queryParams.set('search', searchTerm.trim());
      }

      const [customersRes, statsRes] = await Promise.all([
        apiFetch(`/api/v1/customers?${queryParams.toString()}`, {}, workspace.id),
        apiFetch('/api/v1/customers/stats', {}, workspace.id),
      ]);

      if (customersRes.ok) {
        const data = await readJsonRecord(customersRes);
        setCustomers(asCustomerList(data.customers));
      }

      if (statsRes.ok) {
        const data = await readJsonRecord(statsRes);
        setStats(asStats(data));
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.id]);

  const fetchCustomerById = useCallback(async (customerId: string): Promise<Customer | null> => {
    if (!workspace?.id) return null;
    try {
      const res = await apiFetch(`/api/v1/customers/${customerId}`, {}, workspace.id);
      if (!res.ok) return null;
      const data = await readJsonRecord(res);
      return asCustomer(data.customer);
    } catch (error) {
      console.error('Failed to fetch customer by id:', error);
      return null;
    }
  }, [workspace?.id]);

  const fetchCustomerByPhone = useCallback(async (phone: string): Promise<Customer | null> => {
    if (!workspace?.id) return null;
    try {
      const params = new URLSearchParams({ search: phone, limit: '1', offset: '0' });
      const res = await apiFetch(`/api/v1/customers?${params.toString()}`, {}, workspace.id);
      if (!res.ok) return null;
      const data = await readJsonRecord(res);
      return asCustomerList(data.customers)[0] ?? null;
    } catch (error) {
      console.error('Failed to fetch customer by phone:', error);
      return null;
    }
  }, [workspace?.id]);

  const startEditField = (field: EditableField, value?: string | null): void => {
    if (!selectedCustomer) return;
    const normalizedValue = field === 'vatCondition'
      ? normalizeVatConditionId(value)
      : sanitizeEditableFieldValue(field, value || '');
    setEditingField(field);
    setEditingValue(normalizedValue);
  };

  const cancelEditField = (): void => {
    setEditingField(null);
    setEditingValue('');
  };

  const saveField = async (): Promise<void> => {
    if (!workspace?.id || !selectedCustomer || !editingField) return;

    const normalizedValue = sanitizeEditableFieldValue(editingField, editingValue).trim();
    const validationError = validateEditableFieldValue(editingField, normalizedValue);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSavingField(true);

    const payload: Record<string, unknown> = {};

    switch (editingField) {
      case 'dni':
        payload.dni = normalizedValue;
        break;
      case 'email':
        payload.email = normalizedValue;
        break;
      case 'cuit':
        payload.cuit = normalizedValue;
        break;
      case 'businessName':
        payload.businessName = normalizedValue;
        break;
      case 'fiscalAddress':
        payload.fiscalAddress = normalizedValue;
        break;
      case 'vatCondition':
        payload.vatCondition = normalizedValue;
        break;
      default:
        break;
    }

    try {
      const response = await apiFetch(`/api/v1/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }, workspace.id);

      if (!response.ok) {
        const data = await readJsonRecord(response);
        throw new Error(readErrorMessage(data, 'No se pudo actualizar el cliente'));
      }

      const updated = await fetchCustomerById(selectedCustomer.id);
      if (updated) {
        setSelectedCustomer(updated);
        setCustomers((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      }
      toast.success('Datos actualizados');
      cancelEditField();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el cliente';
      toast.error(message);
    } finally {
      setIsSavingField(false);
    }
  };

  // Fetch customers and stats
  useEffect(() => {
    if (!workspace?.id) return;
    void fetchCustomersAndStats(search);
  }, [fetchCustomersAndStats, search, workspace?.id]);

  // Auto-open customer from URL param
  useEffect(() => {
    if (!customerIdParam || isLoading) return;

    const existing = customers.find((c) => c.id === customerIdParam);
    if (existing) {
      setSelectedCustomer(existing);
      setActiveTab('info');
      setNotes([]);
      setOrders([]);
      setAiSummary(null);
      setNewNote('');
      setOrderStatusFilter('all');
      return;
    }

    const load = async (): Promise<void> => {
      const customer = await fetchCustomerById(customerIdParam);
      if (customer) {
        setSelectedCustomer(customer);
        setActiveTab('info');
        setNotes([]);
        setOrders([]);
        setAiSummary(null);
        setNewNote('');
        setOrderStatusFilter('all');
      }
    };

    void load();
  }, [customerIdParam, customers, fetchCustomerById, isLoading]);

  useEffect(() => {
    if (customerIdParam || !customerPhoneParam || isLoading) return;

    const load = async (): Promise<void> => {
      const customer = await fetchCustomerByPhone(customerPhoneParam);
      if (customer) {
        setSelectedCustomer(customer);
        setActiveTab('info');
        setNotes([]);
        setOrders([]);
        setAiSummary(null);
        setNewNote('');
        setOrderStatusFilter('all');
      }
    };

    void load();
  }, [customerIdParam, customerPhoneParam, fetchCustomerByPhone, isLoading]);

  // Fetch notes when customer selected
  const fetchNotes = useCallback(async (customerId: string): Promise<void> => {
    if (!workspace?.id) return;
    setIsLoadingNotes(true);
    try {
      const res = await apiFetch(`/api/v1/customers/${customerId}/notes`, {}, workspace.id);
      if (res.ok) {
        const data = await readJsonRecord(res);
        setNotes(asCustomerNoteList(data.notes));
      }
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [workspace?.id]);

  // Fetch orders when customer selected
  const fetchOrders = useCallback(async (customerId: string, status?: string): Promise<void> => {
    if (!workspace?.id) return;
    setIsLoadingOrders(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (status && status !== 'all') params.set('status', status);

      const res = await apiFetch(`/api/v1/customers/${customerId}/orders?${params.toString()}`, {}, workspace.id);
      if (res.ok) {
        const data = await readJsonRecord(res);
        setOrders(asCustomerOrderList(data.orders));
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setIsLoadingOrders(false);
    }
  }, [workspace?.id]);

  // Add note
  const addNote = async (): Promise<void> => {
    if (!workspace?.id || !selectedCustomer || !newNote.trim()) return;
    setIsAddingNote(true);
    try {
      const res = await apiFetch(
        `/api/v1/customers/${selectedCustomer.id}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: newNote.trim() }),
        },
        workspace.id
      );
      if (res.ok) {
        const data = await readJsonRecord(res);
        const note = asCustomerNote(data.note);
        if (note) {
          setNotes((prev) => [note, ...prev]);
        }
        setNewNote('');
        toast.success('Nota agregada');
      } else {
        toast.error('Error al agregar nota');
      }
    } catch (error) {
      console.error('Failed to add note:', error);
      toast.error('Error al agregar nota');
    } finally {
      setIsAddingNote(false);
    }
  };

  // Delete note
  const deleteNote = async (noteId: string): Promise<void> => {
    if (!workspace?.id || !selectedCustomer) return;
    try {
      const res = await apiFetch(
        `/api/v1/customers/${selectedCustomer.id}/notes/${noteId}`,
        { method: 'DELETE' },
        workspace.id
      );
      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        toast.success('Nota eliminada');
      } else {
        toast.error('Error al eliminar nota');
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
      toast.error('Error al eliminar nota');
    }
  };

  // Generate AI summary
  const generateSummary = async (): Promise<void> => {
    if (!workspace?.id || !selectedCustomer) return;
    setIsLoadingSummary(true);
    setAiSummary(null);
    try {
      const res = await apiFetch(
        `/api/v1/customers/${selectedCustomer.id}/summary`,
        { method: 'POST' },
        workspace.id
      );
      if (res.ok) {
        const data = await readJsonRecord(res);
        setAiSummary(readString(data, 'summary') ?? null);
        toast.success('Resumen generado');
      } else {
        toast.error('Error al generar resumen');
      }
    } catch (error) {
      console.error('Failed to generate summary:', error);
      toast.error('Error al generar resumen');
    } finally {
      setIsLoadingSummary(false);
    }
  };

  // Handle customer selection
  const handleSelectCustomer = (customer: Customer): void => {
    setSelectedCustomer(customer);
    setActiveTab('info');
    setNotes([]);
    setOrders([]);
    setAiSummary(null);
    setNewNote('');
    setOrderStatusFilter('all');
    void fetchNotes(customer.id);
    void fetchOrders(customer.id);
  };

  // Format currency
  const formatCurrency = (amount: number): string => {
    return `$${(amount / 100).toLocaleString('es-AR')}`;
  };

  const formatPhone = (phone: string): string => {
    return phone.startsWith('manual-') ? 'Sin telefono' : phone;
  };

  // Format date
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  // Format time ago
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

  // Get score badge variant
  const getScoreVariant = (score: number): "success" | "warning" | "destructive" | "default" => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    if (score >= 40) return 'warning';
    return 'destructive';
  };

  const getScoreLabel = (score: number): string => {
    if (score >= 80) return 'Excelente';
    if (score >= 60) return 'Bueno';
    if (score >= 40) return 'Regular';
    return 'Riesgoso';
  };

  const knownPendingOrdersCount = orders.reduce((count, order) => (
    CUSTOMER_DELETE_PENDING_ORDER_STATUSES.has(order.status) ? count + 1 : count
  ), 0);

  const hasKnownDeleteBlocker = Boolean(
    selectedCustomer && (selectedCustomer.currentBalance > 0 || knownPendingOrdersCount > 0)
  );

  // Get order status badges
  const resolveAcceptanceStatus = (order: CustomerOrder): 'awaiting_acceptance' | 'accepted' | 'cancelled' => {
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

  const resolveOrderInvoiceStatus = (
    order: CustomerOrder
  ): 'pending_invoicing' | 'invoiced' | 'invoice_cancelled' | null => {
    if (
      order.invoiceStatus === 'pending_invoicing' ||
      order.invoiceStatus === 'invoiced' ||
      order.invoiceStatus === 'invoice_cancelled'
    ) {
      return order.invoiceStatus;
    }
    if (
      order.status === 'pending_invoicing' ||
      order.status === 'invoiced' ||
      order.status === 'invoice_cancelled'
    ) {
      return order.status;
    }
    return null;
  };

  const resolvePaymentStatus = (order: CustomerOrder): 'pending_payment' | 'partial_payment' | 'paid' => {
    if (order.total <= 0 || order.paidAmount >= order.total) return 'paid';
    if (order.paidAmount > 0) return 'partial_payment';
    return 'pending_payment';
  };

  const getOrderStatusBadges = (order: CustomerOrder): {
    acceptance: { label: string; className: string };
    payment: { label: string; className: string };
    invoice?: { label: string; className: string };
  } => {
    const acceptanceBadges: Record<string, { label: string; className: string }> = {
      awaiting_acceptance: { label: 'Esperando aprobacion', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
      accepted: { label: 'Aceptado', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
      cancelled: { label: 'Cancelado', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    };
    const paymentBadges: Record<string, { label: string; className: string }> = {
      pending_payment: { label: 'Pendiente de pago', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
      partial_payment: { label: 'Pago parcial', className: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
      paid: { label: 'Pagado', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    };
    const invoiceBadges: Record<string, { label: string; className: string }> = {
      pending_invoicing: { label: PENDING_INVOICING_BADGE.label, className: PENDING_INVOICING_BADGE.bordered },
      invoiced: { label: 'Facturado', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
      invoice_cancelled: { label: 'Factura cancelada', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    };
    const acceptanceKey = resolveAcceptanceStatus(order);
    const paymentKey = resolvePaymentStatus(order);
    const invoiceStatus = resolveOrderInvoiceStatus(order);
    const invoice = invoiceStatus ? invoiceBadges[invoiceStatus] : undefined;
    return {
      acceptance: acceptanceBadges[acceptanceKey],
      payment: paymentBadges[paymentKey],
      invoice,
    };
  };

  const openOrderDetail = (): void => {
    setSelectedCustomer(null);
    navigate('/orders');
  };

  // Delete customer
  const deleteCustomer = async (customerId: string): Promise<void> => {
    if (!workspace?.id) return;

    setIsDeleting(true);
    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/customers/${customerId}`, {
        method: 'DELETE',
        headers: {
          'X-Workspace-Id': workspace.id,
        },
        credentials: 'include',
      });

      if (response.ok) {
        setCustomers((prev) => prev.filter((c) => c.id !== customerId));
        if (stats) {
          setStats({
            ...stats,
            totalCustomers: stats.totalCustomers - 1,
          });
        }
        setSelectedCustomer(null);
        setShowDeleteConfirm(false);
        toast.success('Cliente eliminado correctamente');
      } else {
        const data = await readJsonRecord(response);
        const errorCode = readString(data, 'error');

        if (errorCode === 'CUSTOMER_DELETE_BLOCKED') {
          const blockers = asRecord(data.blockers);
          const debt = readNumber(blockers, 'debt') ?? 0;
          const pendingOrders = readNumber(blockers, 'pendingOrders') ?? 0;
          const detailParts: string[] = [];
          if (debt > 0) {
            detailParts.push(`deuda de ${formatCurrency(debt)}`);
          }
          if (pendingOrders > 0) {
            detailParts.push(`${pendingOrders} pedido${pendingOrders === 1 ? '' : 's'} pendiente${pendingOrders === 1 ? '' : 's'}`);
          }

          const baseMessage = readString(data, 'message') ?? 'No se puede eliminar el cliente.';
          const details = detailParts.length > 0 ? ` (${detailParts.join(' y ')})` : '';
          toast.warning(`${baseMessage}${details}`);

          const refreshed = await fetchCustomerById(customerId);
          if (refreshed) {
            setSelectedCustomer(refreshed);
            setCustomers((prev) => prev.map((c) => (c.id === refreshed.id ? { ...c, ...refreshed } : c)));
          }
          return;
        }

        throw new Error(readErrorMessage(data, 'Error al eliminar el cliente'));
      }
    } catch (error) {
      console.error('Failed to delete customer:', error);
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el cliente');
    } finally {
      setIsDeleting(false);
    }
  };

  const createCustomer = async (): Promise<void> => {
    if (!workspace?.id || !newCustomerName.trim() || !newCustomerPhone.trim()) {
      toast.error('Nombre y telefono son obligatorios');
      return;
    }

    const normalizedDni = sanitizeEditableFieldValue('dni', newCustomerDni).trim();
    const normalizedEmail = sanitizeEditableFieldValue('email', newCustomerEmail).trim();
    const normalizedCuit = sanitizeEditableFieldValue('cuit', newCustomerCuit).trim();
    const normalizedBusinessName = sanitizeEditableFieldValue('businessName', newCustomerBusinessName).trim();
    const normalizedFiscalAddress = sanitizeEditableFieldValue('fiscalAddress', newCustomerFiscalAddress).trim();
    const normalizedVatCondition = newCustomerVatCondition.trim();

    const validationChecks: Array<{ field: EditableField; value: string }> = [
      { field: 'dni', value: normalizedDni },
      { field: 'email', value: normalizedEmail },
      { field: 'cuit', value: normalizedCuit },
      { field: 'businessName', value: normalizedBusinessName },
      { field: 'fiscalAddress', value: normalizedFiscalAddress },
      { field: 'vatCondition', value: normalizedVatCondition },
    ];

    for (const item of validationChecks) {
      const error = validateEditableFieldValue(item.field, item.value);
      if (error) {
        toast.error(error);
        return;
      }
    }

    setIsCreating(true);
    try {
      const response = await fetchWithCredentials(`${API_URL}/api/v1/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace.id,
        },
        body: JSON.stringify({
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim(),
          dni: normalizedDni,
          email: normalizedEmail,
          cuit: normalizedCuit,
          businessName: normalizedBusinessName,
          fiscalAddress: normalizedFiscalAddress,
          vatCondition: normalizedVatCondition,
        }),
        credentials: 'include',
      });

      if (response.ok) {
        await fetchCustomersAndStats(search);
        setShowCreateModal(false);
        setNewCustomerName('');
        setNewCustomerPhone('');
        setNewCustomerDni('');
        setNewCustomerEmail('');
        setNewCustomerCuit('');
        setNewCustomerBusinessName('');
        setNewCustomerFiscalAddress('');
        setNewCustomerVatCondition('');
        toast.success('Cliente agregado');
      } else {
        const errorData = await readJsonRecord(response);
        toast.error(readErrorMessage(errorData, 'No se pudo crear el cliente'));
      }
    } catch (error) {
      console.error('Failed to create customer:', error);
      toast.error('No se pudo crear el cliente');
    } finally {
      setIsCreating(false);
    }
  };

  const tabs = [
    { id: 'info' as const, label: 'Informacion', icon: User },
    { id: 'notes' as const, label: `Notas`, count: notes.length, icon: FileText },
    { id: 'orders' as const, label: `Pedidos`, count: orders.length, icon: ShoppingBag },
  ];

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
      <AnimatedPage className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Clientes</h1>
            <p className="text-sm text-muted-foreground">Gestiona tu base de clientes y su historial</p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <Input
              placeholder="Buscar por nombre, telefono..."
              className="w-full md:w-72"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button className="w-full md:w-auto" onClick={() => setShowCreateModal(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Agregar cliente
            </Button>
          </div>
        </div>

        {/* Stats */}
        <AnimatedStagger className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Total clientes" value={(stats?.totalCustomers ?? 0).toString()} icon={Users} color="primary" isLoading={isLoading} />
          <StatCard label="Activos (30 dias)" value={(stats?.activeCustomers ?? 0).toString()} icon={Clock} color="emerald" isLoading={isLoading} />
          <StatCard label="Nuevos este mes" value={(stats?.newCustomers ?? 0).toString()} icon={UserPlus} color="blue" isLoading={isLoading} />
          <StatCard label="Valor promedio" value={formatCurrency(stats?.averageSpent ?? 0)} icon={DollarSign} color="cyan" isLoading={isLoading} />
        </AnimatedStagger>

        {/* Customers table */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Todos los clientes</h3>
            {stats && stats.totalDebt > 0 && (
              <Badge variant="warning" className="text-white">
                Deuda total: {formatCurrency(stats.totalDebt)}
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : customers.length === 0 ? (
            <div className="p-5">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                  <User className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No hay clientes</p>
                <p className="text-sm text-muted-foreground/50 mt-1">
                  Los clientes se crean automaticamente cuando te escriben por WhatsApp.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="md:hidden divide-y divide-border">
                {customers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => handleSelectCustomer(customer)}
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
                          <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(customer.lastSeenAt)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{formatPhone(customer.phone)}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant={getScoreVariant(customer.paymentScore)} className="text-[10px] px-1.5 py-0">
                            {getScoreLabel(customer.paymentScore)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{customer.orderCount} pedidos</span>
                          {customer.currentBalance > 0 ? (
                            <span className="text-xs debt-warning-text font-medium ml-auto">{formatCurrency(customer.currentBalance)}</span>
                          ) : (
                            <span className="text-xs text-emerald-400 ml-auto">$0</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Cliente</th>
                      <th className="text-left px-5 py-3 text-sm font-medium text-muted-foreground">Telefono</th>
                      <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground">Score</th>
                      <th className="text-center px-5 py-3 text-sm font-medium text-muted-foreground">Pedidos</th>
                      <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Deuda</th>
                      <th className="text-right px-5 py-3 text-sm font-medium text-muted-foreground">Ultima visita</th>
                    </tr>
                  </thead>
                  <AnimatedTableBody>
                    {customers.map((customer) => (
                      <AnimatedTableRow
                        key={customer.id}
                        onClick={() => handleSelectCustomer(customer)}
                        className="border-b border-border hover:bg-secondary/50 transition-colors cursor-pointer"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                              <span className="text-sm font-medium text-primary">
                                {customer.firstName?.[0]?.toUpperCase() || customer.phone.slice(-2)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-foreground">
                                {customer.fullName || 'Sin nombre'}
                              </p>
                              {customer.dni && (
                                <p className="text-xs text-muted-foreground">DNI: {customer.dni}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-mono text-sm text-foreground/80">{formatPhone(customer.phone)}</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <Badge variant={getScoreVariant(customer.paymentScore)}>
                            {getScoreLabel(customer.paymentScore)}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-foreground">{customer.orderCount}</span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          {customer.currentBalance > 0 ? (
                            <span className="debt-warning-text font-medium">{formatCurrency(customer.currentBalance)}</span>
                          ) : (
                            <span className="text-emerald-400">$0</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="text-sm text-muted-foreground">{timeAgo(customer.lastSeenAt)}</span>
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

      {/* Create customer modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle>Agregar cliente</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Completa los datos del nuevo cliente</p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Name field - required */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <label className="text-sm font-medium text-foreground">Nombre *</label>
              </div>
              <Input
                placeholder="Nombre y apellido"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void createCustomer();
                  }
                }}
                className="h-11"
              />
            </div>

            {/* Phone field - required */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <label className="text-sm font-medium text-foreground">Telefono *</label>
              </div>
              <Input
                placeholder="+54 9 11 1234 5678"
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void createCustomer();
                  }
                }}
                className="h-11"
              />
            </div>

            {/* Optional fields in a grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* DNI field */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground" />
                  <label className="text-sm font-medium text-foreground">DNI</label>
                </div>
                <Input
                  placeholder="12345678"
                  value={newCustomerDni}
                  onChange={(e) => setNewCustomerDni(sanitizeEditableFieldValue('dni', e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void createCustomer();
                    }
                  }}
                  className="h-11"
                  inputMode="numeric"
                  maxLength={CUSTOMER_FIELD_LIMITS.dni}
                />
              </div>

              {/* Email field */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <label className="text-sm font-medium text-foreground">Email</label>
                </div>
                <Input
                  type="email"
                  placeholder="email@ejemplo.com"
                  value={newCustomerEmail}
                  onChange={(e) => setNewCustomerEmail(sanitizeEditableFieldValue('email', e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void createCustomer();
                    }
                  }}
                  className="h-11"
                  maxLength={CUSTOMER_FIELD_LIMITS.email}
                />
              </div>
            </div>

            {/* Fiscal data */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <label className="text-sm font-medium text-foreground">Datos fiscales (opcional)</label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">CUIT</label>
                  <Input
                    placeholder="20123456789"
                    value={newCustomerCuit}
                    onChange={(e) => setNewCustomerCuit(sanitizeEditableFieldValue('cuit', e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void createCustomer();
                      }
                    }}
                    className="h-11"
                    inputMode="numeric"
                    maxLength={CUSTOMER_FIELD_LIMITS.cuit}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Razón social</label>
                  <Input
                    placeholder="Nombre legal"
                    value={newCustomerBusinessName}
                    onChange={(e) => setNewCustomerBusinessName(sanitizeEditableFieldValue('businessName', e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void createCustomer();
                      }
                    }}
                    className="h-11"
                    maxLength={CUSTOMER_FIELD_LIMITS.businessName}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Domicilio fiscal</label>
                  <Input
                    placeholder="Calle, número, localidad"
                    value={newCustomerFiscalAddress}
                    onChange={(e) => setNewCustomerFiscalAddress(sanitizeEditableFieldValue('fiscalAddress', e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void createCustomer();
                      }
                    }}
                    className="h-11"
                    maxLength={CUSTOMER_FIELD_LIMITS.fiscalAddress}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Condición IVA</label>
                  <Select value={newCustomerVatCondition} onValueChange={setNewCustomerVatCondition}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Seleccioná condición" />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_CONDITIONS.map((condition) => (
                        <SelectItem key={condition.value} value={condition.value}>
                          {condition.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Helper text */}
            <p className="text-xs text-muted-foreground">
              * Campos obligatorios. DNI, Email y datos fiscales son opcionales.
            </p>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-border">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setShowCreateModal(false)}
                disabled={isCreating}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={() => { void createCustomer(); }}
                disabled={isCreating || !newCustomerName.trim() || !newCustomerPhone.trim()}
              >
                {isCreating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Agregar cliente
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer detail sheet */}
      <Sheet open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
        <SheetContent className="sm:max-w-2xl lg:max-w-3xl overflow-hidden flex flex-col">
          {selectedCustomer && (
            <>
              {/* Header */}
              <SheetHeader className="pr-10">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ring-2 ring-primary/20">
                    <span className="text-xl font-bold text-primary">
                      {selectedCustomer.firstName?.[0]?.toUpperCase() || selectedCustomer.phone.slice(-2)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SheetTitle className="truncate">
                        {selectedCustomer.fullName || 'Sin nombre'}
                      </SheetTitle>
                      <Badge variant={getScoreVariant(selectedCustomer.paymentScore)}>
                        {getScoreLabel(selectedCustomer.paymentScore)} ({selectedCustomer.paymentScore})
                      </Badge>
                    </div>
                    <SheetDescription className="font-mono mt-1">
                      {formatPhone(selectedCustomer.phone)}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              {/* Tabs */}
              <div className="flex gap-1 p-1 bg-secondary/50 rounded-xl mx-4 sm:mx-6 mt-2">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                        activeTab === tab.id
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{tab.label}</span>
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

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
                {/* Info Tab */}
                {activeTab === 'info' && (
                  <div className="space-y-4">
                    {capabilities.showCustomerAiSummary && (
                      <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <span className="text-sm font-medium text-primary">Resumen IA</span>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => { void generateSummary(); }}
                            disabled={isLoadingSummary}
                            className="h-8"
                          >
                            {isLoadingSummary ? (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-foreground" />
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 mr-1.5" />
                                Generar
                              </>
                            )}
                          </Button>
                        </div>
                        {aiSummary ? (
                          <p className="text-sm text-foreground leading-relaxed">{aiSummary}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            Genera un resumen inteligente del cliente basado en su historial.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Info grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">DNI</span>
                          </div>
                          {editingField === 'dni' ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => { void saveField(); }}
                                disabled={isSavingField}
                                className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditField}
                                className="p-1 rounded-md text-muted-foreground hover:bg-muted"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditField('dni', selectedCustomer.dni)}
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {editingField === 'dni' ? (
                          <Input
                            value={editingValue}
                            onChange={(e) => setEditingValue(sanitizeEditableFieldValue('dni', e.target.value))}
                            className="h-8 text-xs px-3"
                            placeholder="Ingresá el DNI"
                            inputMode="numeric"
                            maxLength={CUSTOMER_FIELD_LIMITS.dni}
                          />
                        ) : (
                          <p className="font-medium text-foreground text-sm">{selectedCustomer.dni || 'No registrado'}</p>
                        )}
                      </div>
                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Email</span>
                          </div>
                          {editingField === 'email' ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => { void saveField(); }}
                                disabled={isSavingField}
                                className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditField}
                                className="p-1 rounded-md text-muted-foreground hover:bg-muted"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditField('email', selectedCustomer.email)}
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {editingField === 'email' ? (
                          <Input
                            value={editingValue}
                            onChange={(e) => setEditingValue(sanitizeEditableFieldValue('email', e.target.value))}
                            className="h-8 text-xs px-3"
                            placeholder="Ingresá el email"
                            maxLength={CUSTOMER_FIELD_LIMITS.email}
                          />
                        ) : (
                          <p className="font-medium text-foreground text-sm truncate">{selectedCustomer.email || 'No registrado'}</p>
                        )}
                      </div>
                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Pedidos</span>
                        </div>
                        <p className="font-medium text-foreground text-sm">{selectedCustomer.orderCount}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-secondary/50">
                        <div className="flex items-center gap-2 mb-1">
                          <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Total gastado</span>
                        </div>
                        <p className="font-medium text-foreground text-sm">{formatCurrency(selectedCustomer.totalSpent)}</p>
                      </div>
                    </div>

                    {/* Fiscal info */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Datos fiscales</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3 rounded-xl bg-secondary/50">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">CUIT</span>
                            </div>
                            {editingField === 'cuit' ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => { void saveField(); }}
                                  disabled={isSavingField}
                                  className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditField}
                                  className="p-1 rounded-md text-muted-foreground hover:bg-muted"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEditField('cuit', selectedCustomer.cuit)}
                                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {editingField === 'cuit' ? (
                            <Input
                              value={editingValue}
                              onChange={(e) => setEditingValue(sanitizeEditableFieldValue('cuit', e.target.value))}
                              className="h-8 text-xs px-3"
                              placeholder="Ingresá el CUIT"
                              inputMode="numeric"
                              maxLength={CUSTOMER_FIELD_LIMITS.cuit}
                            />
                          ) : (
                            <p className="font-medium text-foreground text-sm">{selectedCustomer.cuit || 'No registrado'}</p>
                          )}
                        </div>
                        <div className="p-3 rounded-xl bg-secondary/50">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Razón social</span>
                            </div>
                            {editingField === 'businessName' ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => { void saveField(); }}
                                  disabled={isSavingField}
                                  className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditField}
                                  className="p-1 rounded-md text-muted-foreground hover:bg-muted"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEditField('businessName', selectedCustomer.businessName)}
                                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {editingField === 'businessName' ? (
                            <Input
                              value={editingValue}
                              onChange={(e) => setEditingValue(sanitizeEditableFieldValue('businessName', e.target.value))}
                              className="h-8 text-xs px-3"
                              placeholder="Ingresá la razón social"
                              maxLength={CUSTOMER_FIELD_LIMITS.businessName}
                            />
                          ) : (
                            <p className="font-medium text-foreground text-sm truncate">{selectedCustomer.businessName || 'No registrada'}</p>
                          )}
                        </div>
                        <div className="p-3 rounded-xl bg-secondary/50 sm:col-span-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Domicilio fiscal</span>
                            </div>
                            {editingField === 'fiscalAddress' ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => { void saveField(); }}
                                  disabled={isSavingField}
                                  className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditField}
                                  className="p-1 rounded-md text-muted-foreground hover:bg-muted"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEditField('fiscalAddress', selectedCustomer.fiscalAddress)}
                                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {editingField === 'fiscalAddress' ? (
                            <Input
                              value={editingValue}
                              onChange={(e) => setEditingValue(sanitizeEditableFieldValue('fiscalAddress', e.target.value))}
                              className="h-8 text-xs px-3"
                              placeholder="Ingresá el domicilio fiscal"
                              maxLength={CUSTOMER_FIELD_LIMITS.fiscalAddress}
                            />
                          ) : (
                            <p className="font-medium text-foreground text-sm">{selectedCustomer.fiscalAddress || 'No registrado'}</p>
                          )}
                        </div>
                        <div className="p-3 rounded-xl bg-secondary/50">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Condición IVA</span>
                            </div>
                            {editingField === 'vatCondition' ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => { void saveField(); }}
                                  disabled={isSavingField}
                                  className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditField}
                                  className="p-1 rounded-md text-muted-foreground hover:bg-muted"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEditField('vatCondition', selectedCustomer.vatCondition)}
                                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {editingField === 'vatCondition' ? (
                            <Select value={editingValue} onValueChange={setEditingValue}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Seleccioná condición" />
                              </SelectTrigger>
                              <SelectContent>
                                {VAT_CONDITIONS.map((condition) => (
                                  <SelectItem key={condition.value} value={condition.value}>
                                    {condition.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="font-medium text-foreground text-sm">
                              {formatVatCondition(selectedCustomer.vatCondition)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Debt alert */}
                    {selectedCustomer.currentBalance > 0 && (
                      <div className="p-4 rounded-xl debt-warning-card">
                        <div className="flex items-center justify-center gap-3 text-center">
                          <div className="w-10 h-10 rounded-full debt-warning-icon flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-current" />
                          </div>
                          <div>
                            <p className="text-sm debt-warning-text">Deuda pendiente</p>
                            <p className="text-xl font-bold debt-warning-text">{formatCurrency(selectedCustomer.currentBalance)}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Dates */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground p-3 rounded-xl bg-secondary/30">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Primera vez: {formatDate(selectedCustomer.firstSeenAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Ultima: {formatDate(selectedCustomer.lastSeenAt)}</span>
                      </div>
                    </div>

                    {/* Delete action */}
                    <div className="pt-4 border-t border-border">
                      <Button
                        variant="secondary"
                        className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Eliminar cliente
                      </Button>
                    </div>
                  </div>
                )}

                {/* Notes Tab */}
                {activeTab === 'notes' && (
                  <div className="space-y-4">
                    {/* Add note form */}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Agregar nota sobre el cliente..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            void addNote();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button onClick={() => { void addNote(); }} disabled={isAddingNote || !newNote.trim()}>
                        {isAddingNote ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        ) : (
                          'Agregar'
                        )}
                      </Button>
                    </div>

                    {/* Notes list */}
                    {isLoadingNotes ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                      </div>
                    ) : notes.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
                          <FileText className="w-7 h-7 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground">No hay notas para este cliente.</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">Agrega notas sobre preferencias, observaciones, etc.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {notes.map((note) => (
                          <div key={note.id} className="p-4 rounded-xl bg-secondary/50 group hover:bg-secondary/70 transition-colors">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <p className="text-foreground text-sm">{note.content}</p>
                                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                  <Badge variant={note.createdBy === 'agent' ? 'default' : 'secondary'} className="text-xs px-1.5 py-0">
                                    {note.createdBy === 'agent' ? 'IA' : note.createdBy === 'user' ? 'Usuario' : 'Sistema'}
                                  </Badge>
                                  <span>{formatDate(note.createdAt)}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => { void deleteNote(note.id); }}
                                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Orders Tab */}
                {activeTab === 'orders' && (
                  <div className="space-y-4">
                    {/* Filter */}
                    <Select
                      value={orderStatusFilter}
                      onValueChange={(value) => {
                        setOrderStatusFilter(value);
                        void fetchOrders(selectedCustomer.id, value === 'all' ? undefined : value);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Filtrar por estado" />
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

                    {/* Orders list */}
                    {isLoadingOrders ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                      </div>
                    ) : orders.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
                          <ShoppingBag className="w-7 h-7 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground">No hay pedidos para este cliente.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {orders.map((order) => {
                          const statusBadges = getOrderStatusBadges(order);
                          return (
                            <div
                              key={order.id}
                              onClick={() => openOrderDetail()}
                              className="p-3 sm:p-4 rounded-xl bg-secondary/50 hover:bg-secondary/70 transition-colors cursor-pointer"
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="min-w-0">
                                  <span className="font-medium text-foreground">#{order.orderNumber}</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    <Badge variant="secondary" className={`text-xs border ${statusBadges.acceptance.className}`}>
                                      {statusBadges.acceptance.label}
                                    </Badge>
                                    <Badge variant="secondary" className={`text-xs border ${statusBadges.payment.className}`}>
                                      {statusBadges.payment.label}
                                    </Badge>
                                    {statusBadges.invoice && (
                                      <Badge variant="secondary" className={`text-xs border ${statusBadges.invoice.className}`}>
                                        {statusBadges.invoice.label}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="font-medium text-foreground">{formatCurrency(order.total)}</p>
                                  {order.paidAmount < order.total && order.paidAmount > 0 && (
                                    <p className="text-xs text-cyan-400">Pagado: {formatCurrency(order.paidAmount)}</p>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                <p>{order.itemCount} item{order.itemCount !== 1 ? 's' : ''} - {formatDate(order.createdAt)}</p>
                                {order.items.length > 0 && (
                                  <p className="mt-1 text-foreground/70 truncate text-xs">
                                    {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <DialogTitle>Confirmar eliminacion</DialogTitle>
            </div>
          </DialogHeader>

          {selectedCustomer && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-secondary">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-lg font-medium text-primary">
                    {selectedCustomer.firstName?.[0]?.toUpperCase() || selectedCustomer.phone.slice(-2)}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {selectedCustomer.fullName || formatPhone(selectedCustomer.phone)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedCustomer.orderCount} pedidos - {formatCurrency(selectedCustomer.totalSpent)} gastado
                  </p>
                </div>
              </div>

              <p className="text-foreground/80 text-sm">
                Esta accion no se puede deshacer. El cliente sera eliminado permanentemente junto con su historial.
              </p>

              {selectedCustomer.currentBalance > 0 && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-primary" />
                    <p className="text-sm text-primary">
                      Este cliente tiene una deuda de {formatCurrency(selectedCustomer.currentBalance)}
                    </p>
                  </div>
                </div>
              )}

              {knownPendingOrdersCount > 0 && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-primary" />
                    <p className="text-sm text-primary">
                      Este cliente tiene {knownPendingOrdersCount} pedido{knownPendingOrdersCount === 1 ? '' : 's'} pendiente{knownPendingOrdersCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
              )}

              {hasKnownDeleteBlocker && (
                <p className="text-xs text-muted-foreground">
                  No se puede eliminar hasta resolver la deuda y/o los pedidos pendientes.
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-red-500 hover:bg-red-600"
                  onClick={() => { void deleteCustomer(selectedCustomer.id); }}
                  disabled={isDeleting || hasKnownDeleteBlocker}
                >
                  {isDeleting ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Eliminar
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
