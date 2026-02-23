import type { ReactNode } from 'react';

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

type JsonRecord = Record<string, unknown>;

const formatMoney = (amount: number): string =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount / 100);

const formatDateTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asRecordList(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => entry !== null);
}

function readString(record: JsonRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readFirstString(record: JsonRecord | null, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) return value;
  }
  return undefined;
}

function readNumber(record: JsonRecord | null, key: string, fallback = 0): number {
  const value = record?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readCount(record: JsonRecord | null, key: string, fallback = 0): number {
  return Math.trunc(readNumber(record, key, fallback));
}

function getDisplayName(record: JsonRecord | null, fallback = 'Cliente'): string {
  const fullName = [readString(record, 'firstName'), readString(record, 'lastName')]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .trim();
  if (fullName) return fullName;
  return readFirstString(record, ['phone', 'email']) ?? fallback;
}

const ResultSection = ({ title, children }: { title: string; children: ReactNode }): JSX.Element => (
  <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    <div className="space-y-2.5">{children}</div>
  </div>
);

export function QuickActionToolResult({ tool }: { tool: ToolExecutionResult }): JSX.Element | null {
  if (!tool.success) {
    const data = asRecord(tool.data);
    if (readString(data, 'kind') === 'ambiguous_product') {
      return null;
    }
    return (
      <div className="text-sm text-red-400">
        {tool.error || 'Error al ejecutar la herramienta'}
      </div>
    );
  }

  if (tool.toolName === 'list_orders' && Array.isArray(tool.data)) {
    const orders = asRecordList(tool.data);
    return (
      <ResultSection title={`Pedidos (${orders.length})`}>
        {orders.slice(0, 5).map((order, index) => {
          const orderNumber = readString(order, 'orderNumber') ?? 'Pedido';
          const orderStatus = readString(order, 'status') ?? 'estado';
          const createdAt = readString(order, 'createdAt');
          const total = readNumber(order, 'total');
          const key = readFirstString(order, ['id', 'orderNumber']) ?? `order-${index}`;

          return (
            <div key={key} className="flex items-center justify-between text-sm">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{orderNumber}</span>
                <span className="text-muted-foreground">
                  {orderStatus} {createdAt ? `· ${formatDateTime(createdAt)}` : ''}
                </span>
              </div>
              <span className="font-medium text-foreground">${formatMoney(total)}</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if ((tool.toolName === 'search_products' || tool.toolName === 'list_products') && Array.isArray(tool.data)) {
    const products = asRecordList(tool.data);
    return (
      <ResultSection title={`Productos (${products.length})`}>
        {products.slice(0, 5).map((product, index) => {
          const key = readFirstString(product, ['id', 'sku']) ?? `product-${index}`;
          const name = readFirstString(product, ['displayName', 'name']) ?? 'Producto';
          const stock = readCount(product, 'stock');
          const sku = readString(product, 'sku') ?? '-';
          const price = readNumber(product, 'price');

          return (
            <div key={key} className="flex items-center justify-between text-sm">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{name}</span>
                <span className="text-muted-foreground">
                  Stock: {stock} · SKU: {sku}
                </span>
              </div>
              <span className="font-medium text-foreground">${formatMoney(price)}</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (
    (tool.toolName === 'get_customer_info' ||
      tool.toolName === 'list_customers' ||
      tool.toolName === 'list_debtors') &&
    Array.isArray(tool.data)
  ) {
    const customers = asRecordList(tool.data);
    return (
      <ResultSection title={`Clientes (${customers.length})`}>
        {customers.slice(0, 5).map((customer, index) => {
          const key = readFirstString(customer, ['id', 'phone']) ?? `customer-${index}`;
          const contact = readFirstString(customer, ['phone', 'email']) ?? '';
          const balance = readNumber(customer, 'currentBalance');

          return (
            <div key={key} className="flex items-center justify-between text-sm">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{getDisplayName(customer)}</span>
                <span className="text-muted-foreground">{contact}</span>
              </div>
              <span className="text-muted-foreground">${formatMoney(balance)}</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_unpaid_orders' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const orders = asRecordList(data?.orders);
    const totalPending = readNumber(data, 'totalPending');

    return (
      <ResultSection title="Pedidos impagos">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total pendiente</span>
          <span className="font-medium text-foreground">${formatMoney(totalPending)}</span>
        </div>
        {orders.slice(0, 4).map((order, index) => {
          const key = readFirstString(order, ['id', 'orderNumber']) ?? `unpaid-order-${index}`;
          const orderNumber = readString(order, 'orderNumber') ?? 'Pedido';
          const pendingAmount = readNumber(order, 'pendingAmount');

          return (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{orderNumber}</span>
              <span className="text-muted-foreground">${formatMoney(pendingAmount)}</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_customer_balance' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    return (
      <ResultSection title="Saldo del cliente">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{getDisplayName(data)}</span>
          <span className="font-medium text-foreground">${formatMoney(readNumber(data, 'currentBalance'))}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'send_debt_reminder' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const customer = asRecord(data?.customer);

    return (
      <ResultSection title="Recordatorio de deuda">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{getDisplayName(customer)}</span>
          <span className="font-medium text-foreground">${formatMoney(readNumber(data, 'totalDebt'))}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pedidos pendientes</span>
          <span className="text-foreground">{readCount(data, 'ordersCount')}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'send_debt_reminders_bulk' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    return (
      <ResultSection title="Recordatorios masivos">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Enviados</span>
          <span className="font-medium text-foreground">{readCount(data, 'sent')}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Fallidos</span>
          <span className="text-foreground">{readCount(data, 'failed')}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total deudores</span>
          <span className="text-foreground">{readCount(data, 'total')}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_order_details' && tool.data && typeof tool.data === 'object') {
    const order = asRecord(tool.data);
    const orderNumber = readString(order, 'orderNumber') ?? '';

    return (
      <ResultSection title={`Pedido ${orderNumber}`}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Estado</span>
          <span className="text-foreground">{readString(order, 'status') ?? '-'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium text-foreground">${formatMoney(readNumber(order, 'total'))}</span>
        </div>
      </ResultSection>
    );
  }

  if (
    (tool.toolName === 'get_sales_summary' || tool.toolName === 'get_business_metrics') &&
    tool.data &&
    typeof tool.data === 'object'
  ) {
    const data = asRecord(tool.data);
    const summary = asRecord(data?.summary);
    const topCustomer = asRecordList(data?.topCustomers)[0] ?? null;
    const topProduct = asRecordList(data?.topProducts)[0] ?? null;
    const range = asRecord(data?.range);
    const rangeLabel = readString(range, 'label');

    return (
      <ResultSection title={`Ventas${rangeLabel ? ` · ${rangeLabel}` : ''}`}>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Total</p>
            <p className="font-semibold text-foreground">${formatMoney(readNumber(summary, 'totalRevenue'))}</p>
          </div>
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Pedidos</p>
            <p className="font-semibold text-foreground">{readCount(summary, 'totalOrders')}</p>
          </div>
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Ticket prom.</p>
            <p className="font-semibold text-foreground">${formatMoney(readNumber(summary, 'avgOrderValue'))}</p>
          </div>
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Pendiente</p>
            <p className="font-semibold text-foreground">${formatMoney(readNumber(summary, 'pendingRevenue'))}</p>
          </div>
        </div>
        {(topCustomer || topProduct) && (
          <div className="space-y-1 text-sm">
            {topCustomer && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cliente top</span>
                <span className="text-foreground">{readString(topCustomer, 'name') ?? 'Cliente'}</span>
              </div>
            )}
            {topProduct && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Producto top</span>
                <span className="text-foreground">{readString(topProduct, 'name') ?? 'Producto'}</span>
              </div>
            )}
          </div>
        )}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_low_stock_products' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const products = asRecordList(data?.products);
    const totalLowStock = readCount(data, 'totalLowStock', products.length);

    return (
      <ResultSection title={`Stock bajo (${totalLowStock})`}>
        {products.slice(0, 5).map((product, index) => {
          const key = readFirstString(product, ['id', 'sku']) ?? `low-stock-${index}`;
          const name = readFirstString(product, ['displayName', 'name']) ?? 'Producto';
          const available = readCount(product, 'available');

          return (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{name}</span>
              <span className="text-muted-foreground">{available} uds</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'list_categories' && Array.isArray(tool.data)) {
    const categories = asRecordList(tool.data);
    return (
      <ResultSection title={`Categorías (${categories.length})`}>
        {categories.slice(0, 5).map((category, index) => {
          const key = readFirstString(category, ['id', 'name']) ?? `category-${index}`;
          const name = readString(category, 'name') ?? 'Categoría';
          const productCount = readCount(category, 'productCount');

          return (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{name}</span>
              <span className="text-muted-foreground">{productCount} prod.</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_product_details' && tool.data && typeof tool.data === 'object') {
    const product = asRecord(tool.data);

    return (
      <ResultSection title="Detalle de producto">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Nombre</span>
          <span className="text-foreground">{readFirstString(product, ['displayName', 'name']) ?? 'Producto'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Precio</span>
          <span className="text-foreground">${formatMoney(readNumber(product, 'price'))}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Stock</span>
          <span className="text-foreground">{readCount(product, 'stock')}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'list_conversations' && Array.isArray(tool.data)) {
    const conversations = asRecordList(tool.data);
    return (
      <ResultSection title={`Conversaciones (${conversations.length})`}>
        {conversations.slice(0, 5).map((conversation, index) => {
          const key = readFirstString(conversation, ['id']) ?? `conversation-${index}`;
          const customerName = readString(conversation, 'customerName') ?? 'Cliente';
          const lastMessage = readString(conversation, 'lastMessage') ?? 'Sin mensajes';

          return (
            <div key={key} className="flex flex-col text-sm">
              <span className="font-medium text-foreground">{customerName}</span>
              <span className="text-muted-foreground line-clamp-1">{lastMessage}</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_conversation_messages' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const messages = asRecordList(data?.messages);

    return (
      <ResultSection title={`Mensajes (${messages.length})`}>
        {messages.slice(-5).map((message, index) => {
          const key = readFirstString(message, ['id']) ?? `message-${index}`;
          const role = readString(message, 'role') ?? 'usuario';
          const content = readString(message, 'content') ?? '';

          return (
            <div key={key} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">{role}:</span> {content}
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'list_notifications' && Array.isArray(tool.data)) {
    const notifications = asRecordList(tool.data);
    return (
      <ResultSection title={`Notificaciones (${notifications.length})`}>
        {notifications.slice(0, 5).map((notification, index) => {
          const key = readFirstString(notification, ['id']) ?? `notification-${index}`;
          const title = readString(notification, 'title') ?? 'Notificación';
          const message = readString(notification, 'message') ?? '';

          return (
            <div key={key} className="flex flex-col text-sm">
              <span className="font-medium text-foreground">{title}</span>
              <span className="text-muted-foreground line-clamp-1">{message}</span>
            </div>
          );
        })}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_business_insights' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const insights = asRecord(data?.insights);
    const actions = asRecordList(insights?.actions);

    return (
      <ResultSection title="Insights del negocio">
        {readString(insights, 'headline') && (
          <p className="text-sm font-medium text-foreground">{readString(insights, 'headline')}</p>
        )}
        {readString(insights, 'summary') && (
          <p className="text-sm text-muted-foreground">{readString(insights, 'summary')}</p>
        )}
        {actions.length > 0 && (
          <div className="space-y-1 text-sm">
            {actions.slice(0, 3).map((action, index) => {
              const title = readString(action, 'title') ?? `Acción ${index + 1}`;
              const detail = readString(action, 'detail') ?? '';
              return (
                <div key={`${title}-${index}`} className="rounded-lg bg-secondary/60 p-2">
                  <p className="font-medium text-foreground">{title}</p>
                  <p className="text-muted-foreground">{detail}</p>
                </div>
              );
            })}
          </div>
        )}
      </ResultSection>
    );
  }

  if (tool.toolName === 'generate_catalog_pdf' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const url = readString(data, 'url');

    return (
      <ResultSection title="Catálogo">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Productos</span>
          <span className="text-foreground">{readCount(data, 'productCount')}</span>
        </div>
        {url && (
          <button
            onClick={() => window.open(url, '_blank')}
            className="w-full h-9 rounded-xl bg-secondary hover:bg-secondary/80 text-sm text-foreground border border-border transition-all"
          >
            Descargar catálogo
          </button>
        )}
      </ResultSection>
    );
  }

  if (tool.toolName === 'generate_account_statement_pdf' && tool.data && typeof tool.data === 'object') {
    const data = asRecord(tool.data);
    const customer = asRecord(data?.customer);
    const url = readString(data, 'url');
    const totalDebt = readNumber(data, 'totalDebt');
    const unpaidOrders = readCount(data, 'unpaidOrders');

    return (
      <ResultSection title="Resumen de cuenta">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Cliente</span>
          <span className="text-foreground">{getDisplayName(customer)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Deuda</span>
          <span className="font-medium text-foreground">${formatMoney(totalDebt)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pedidos pendientes</span>
          <span className="text-foreground">{unpaidOrders}</span>
        </div>
        {url && (
          <button
            onClick={() => window.open(url, '_blank')}
            className="w-full h-9 rounded-xl bg-secondary hover:bg-secondary/80 text-sm text-foreground border border-border transition-all"
          >
            Descargar resumen PDF
          </button>
        )}
      </ResultSection>
    );
  }

  return (
    <ResultSection title="Resultado">
      <p className="text-sm text-muted-foreground">Acción completada.</p>
    </ResultSection>
  );
}
