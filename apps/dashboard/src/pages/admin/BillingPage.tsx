import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, CalendarClock, Receipt, RefreshCw } from 'lucide-react';
import { Badge, Button, Input } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { useToastStore } from '../../stores/toast.store';

interface BillingPaymentRow {
  id: string;
  plan: string;
  months: number;
  amount: number;
  currency: string;
  status: string;
  paidAt: string;
  nextChargeAt?: string | null;
  stripeCheckoutSessionId: string;
  user?: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface BillingPaymentsResponse {
  payments: BillingPaymentRow[];
  pagination: Pagination;
}

const formatMoney = (amountCents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format((amountCents || 0) / 100);

const formatCurrencyCode = (value?: string | null) => (value || 'USD').toUpperCase();

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const getPaymentStatusBadge = (status: string) => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'paid') return <Badge variant="success">Pagado</Badge>;
  if (normalized === 'failed') return <Badge variant="warning">Fallido</Badge>;
  return <Badge variant="secondary">{status || 'N/D'}</Badge>;
};

export default function BillingPage() {
  const toastError = useToastStore((state) => state.error);
  const [rows, setRows] = useState<BillingPaymentRow[]>([]);
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

  useEffect(() => {
    const timeoutId = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [search]);

  const loadPayments = useCallback(
    async (silent = false) => {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const params = new URLSearchParams({
          page: String(pagination.page),
          limit: String(pagination.limit),
        });
        if (search) params.set('search', search);

        const res = await apiFetch(`/api/v1/admin/billing/payments?${params.toString()}`);
        if (!res.ok) {
          throw new Error('No se pudieron cargar los pagos');
        }
        const data = (await res.json()) as BillingPaymentsResponse;
        setRows(data.payments || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, pages: 0 });
      } catch (error) {
        toastError(error instanceof Error ? error.message : 'No se pudieron cargar los pagos');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [pagination.page, pagination.limit, search, toastError]
  );

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const stats = useMemo(() => {
    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
    const nextChargeCount = rows.filter((row) => Boolean(row.nextChargeAt)).length;
    return {
      payments: rows.length,
      totalAmount,
      nextChargeCount,
    };
  }, [rows]);

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Cobros</h2>
          <p className="text-sm text-muted-foreground">
            Qué se pagó, cuándo se pagó y próximo cobro por workspace
          </p>
        </div>
        <div className="flex w-full md:w-auto items-center gap-3">
          <div className="w-full md:w-72">
            <Input
              placeholder="Buscar por negocio, email o plan..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={() => loadPayments(true)} isLoading={isRefreshing}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Actualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Cobros en la vista</p>
              <p className="text-2xl font-semibold mt-1 text-foreground">{stats.payments}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Receipt className="w-5 h-5 text-blue-400" />
            </div>
          </div>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Monto total en la vista</p>
              <p className="text-2xl font-semibold mt-1 text-foreground">
                {formatMoney(stats.totalAmount, 'USD')}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Con próximo cobro</p>
              <p className="text-2xl font-semibold mt-1 text-foreground">{stats.nextChargeCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Pagos registrados</h3>
          <p className="text-sm text-muted-foreground">{pagination.total} total</p>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No hay pagos registrados
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-xl bg-secondary/50 hover:bg-secondary transition-colors p-4 grid grid-cols-1 xl:grid-cols-6 gap-3"
                >
                  <div className="xl:col-span-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {row.workspace?.name || 'Workspace'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.user?.email || 'Sin email'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Plan {row.plan} · {row.months} mes(es)
                    </p>
                  </div>
                  <div className="flex items-center">
                    <p className="text-sm font-semibold text-foreground">
                      {formatMoney(row.amount, row.currency)} {formatCurrencyCode(row.currency)}
                    </p>
                  </div>
                  <div className="flex items-center">{getPaymentStatusBadge(row.status)}</div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pago</p>
                    <p className="text-sm text-foreground">{formatDateTime(row.paidAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Próximo cobro</p>
                    <p className="text-sm text-foreground">{formatDateTime(row.nextChargeAt)}</p>
                  </div>
                </div>
              ))}
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
                onClick={() =>
                  setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))
                }
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    page: Math.min(prev.pages, prev.page + 1),
                  }))
                }
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
