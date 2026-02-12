import type { ReactNode } from 'react';

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount / 100);

const formatDateTime = (value?: string) => {
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

const ResultSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    <div className="space-y-2.5">{children}</div>
  </div>
);

export function QuickActionToolResult({ tool }: { tool: ToolExecutionResult }) {
  if (!tool.success) {
    if (tool.data && typeof tool.data === 'object' && (tool.data as any).kind === 'ambiguous_product') {
      return null;
    }
    return (
      <div className="text-sm text-red-400">
        {tool.error || 'Error al ejecutar la herramienta'}
      </div>
    );
  }

  if (tool.toolName === 'list_orders' && Array.isArray(tool.data)) {
    const orders = tool.data as Array<any>;
    return (
      <ResultSection title={`Pedidos (${orders.length})`}>
        {orders.slice(0, 5).map((order) => (
          <div key={order.id || order.orderNumber} className="flex items-center justify-between text-sm">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{order.orderNumber || 'Pedido'}</span>
              <span className="text-muted-foreground">
                {order.status || 'estado'} {order.createdAt ? `· ${formatDateTime(order.createdAt)}` : ''}
              </span>
            </div>
            <span className="font-medium text-foreground">${formatMoney(order.total || 0)}</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if ((tool.toolName === 'search_products' || tool.toolName === 'list_products') && Array.isArray(tool.data)) {
    const products = tool.data as Array<any>;
    return (
      <ResultSection title={`Productos (${products.length})`}>
        {products.slice(0, 5).map((product) => (
          <div key={product.id || product.sku} className="flex items-center justify-between text-sm">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{product.displayName || product.name}</span>
              <span className="text-muted-foreground">
                Stock: {product.stock ?? 0} · SKU: {product.sku || '-'}
              </span>
            </div>
            <span className="font-medium text-foreground">${formatMoney(product.price || 0)}</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (
    (tool.toolName === 'get_customer_info' ||
      tool.toolName === 'list_customers' ||
      tool.toolName === 'list_debtors') &&
    Array.isArray(tool.data)
  ) {
    const customers = tool.data as Array<any>;
    return (
      <ResultSection title={`Clientes (${customers.length})`}>
        {customers.slice(0, 5).map((customer) => (
          <div key={customer.id || customer.phone} className="flex items-center justify-between text-sm">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">
                {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Cliente'}
              </span>
              <span className="text-muted-foreground">{customer.phone || customer.email || ''}</span>
            </div>
            <span className="text-muted-foreground">${formatMoney(customer.currentBalance || 0)}</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_unpaid_orders' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    const orders = Array.isArray(data.orders) ? data.orders : [];
    return (
      <ResultSection title="Pedidos impagos">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total pendiente</span>
          <span className="font-medium text-foreground">${formatMoney(data.totalPending || 0)}</span>
        </div>
        {orders.slice(0, 4).map((order: any) => (
          <div key={order.id || order.orderNumber} className="flex items-center justify-between text-sm">
            <span className="text-foreground">{order.orderNumber}</span>
            <span className="text-muted-foreground">${formatMoney(order.pendingAmount || 0)}</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_customer_balance' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    return (
      <ResultSection title="Saldo del cliente">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {[data.firstName, data.lastName].filter(Boolean).join(' ') || data.phone || 'Cliente'}
          </span>
          <span className="font-medium text-foreground">${formatMoney(data.currentBalance || 0)}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'send_debt_reminder' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    const customer = data.customer || {};
    return (
      <ResultSection title="Recordatorio de deuda">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.phone || 'Cliente'}
          </span>
          <span className="font-medium text-foreground">${formatMoney(data.totalDebt || 0)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pedidos pendientes</span>
          <span className="text-foreground">{data.ordersCount || 0}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'send_debt_reminders_bulk' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    return (
      <ResultSection title="Recordatorios masivos">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Enviados</span>
          <span className="font-medium text-foreground">{data.sent || 0}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Fallidos</span>
          <span className="text-foreground">{data.failed || 0}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total deudores</span>
          <span className="text-foreground">{data.total || 0}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_order_details' && tool.data && typeof tool.data === 'object') {
    const order = tool.data as any;
    return (
      <ResultSection title={`Pedido ${order.orderNumber || ''}`}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Estado</span>
          <span className="text-foreground">{order.status || '-'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium text-foreground">${formatMoney(order.total || 0)}</span>
        </div>
      </ResultSection>
    );
  }

  if (
    (tool.toolName === 'get_sales_summary' || tool.toolName === 'get_business_metrics') &&
    tool.data &&
    typeof tool.data === 'object'
  ) {
    const data = tool.data as any;
    const summary = data.summary || {};
    const topCustomer = Array.isArray(data.topCustomers) ? data.topCustomers[0] : null;
    const topProduct = Array.isArray(data.topProducts) ? data.topProducts[0] : null;
    return (
      <ResultSection title={`Ventas${data.range?.label ? ` · ${data.range.label}` : ''}`}>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Total</p>
            <p className="font-semibold text-foreground">${formatMoney(summary.totalRevenue || 0)}</p>
          </div>
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Pedidos</p>
            <p className="font-semibold text-foreground">{summary.totalOrders || 0}</p>
          </div>
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Ticket prom.</p>
            <p className="font-semibold text-foreground">${formatMoney(summary.avgOrderValue || 0)}</p>
          </div>
          <div className="rounded-lg bg-secondary/60 p-2">
            <p className="text-muted-foreground">Pendiente</p>
            <p className="font-semibold text-foreground">${formatMoney(summary.pendingRevenue || 0)}</p>
          </div>
        </div>
        {(topCustomer || topProduct) && (
          <div className="space-y-1 text-sm">
            {topCustomer && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cliente top</span>
                <span className="text-foreground">{topCustomer.name}</span>
              </div>
            )}
            {topProduct && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Producto top</span>
                <span className="text-foreground">{topProduct.name}</span>
              </div>
            )}
          </div>
        )}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_low_stock_products' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    const products = Array.isArray(data.products) ? data.products : [];
    return (
      <ResultSection title={`Stock bajo (${data.totalLowStock || products.length || 0})`}>
        {products.slice(0, 5).map((product: any) => (
          <div key={product.id || product.sku} className="flex items-center justify-between text-sm">
            <span className="text-foreground">{product.displayName || product.name}</span>
            <span className="text-muted-foreground">{product.available ?? 0} uds</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'list_categories' && Array.isArray(tool.data)) {
    const categories = tool.data as Array<any>;
    return (
      <ResultSection title={`Categorías (${categories.length})`}>
        {categories.slice(0, 5).map((category) => (
          <div key={category.id || category.name} className="flex items-center justify-between text-sm">
            <span className="text-foreground">{category.name}</span>
            <span className="text-muted-foreground">{category.productCount || 0} prod.</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_product_details' && tool.data && typeof tool.data === 'object') {
    const product = tool.data as any;
    return (
      <ResultSection title="Detalle de producto">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Nombre</span>
          <span className="text-foreground">{product.displayName || product.name}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Precio</span>
          <span className="text-foreground">${formatMoney(product.price || 0)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Stock</span>
          <span className="text-foreground">{product.stock ?? 0}</span>
        </div>
      </ResultSection>
    );
  }

  if (tool.toolName === 'list_conversations' && Array.isArray(tool.data)) {
    const conversations = tool.data as Array<any>;
    return (
      <ResultSection title={`Conversaciones (${conversations.length})`}>
        {conversations.slice(0, 5).map((conversation) => (
          <div key={conversation.id} className="flex flex-col text-sm">
            <span className="font-medium text-foreground">{conversation.customerName || 'Cliente'}</span>
            <span className="text-muted-foreground line-clamp-1">{conversation.lastMessage || 'Sin mensajes'}</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_conversation_messages' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return (
      <ResultSection title={`Mensajes (${messages.length})`}>
        {messages.slice(-5).map((message: any) => (
          <div key={message.id} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">{message.role}:</span> {message.content}
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'list_notifications' && Array.isArray(tool.data)) {
    const notifications = tool.data as Array<any>;
    return (
      <ResultSection title={`Notificaciones (${notifications.length})`}>
        {notifications.slice(0, 5).map((notification) => (
          <div key={notification.id} className="flex flex-col text-sm">
            <span className="font-medium text-foreground">{notification.title || 'Notificación'}</span>
            <span className="text-muted-foreground line-clamp-1">{notification.message || ''}</span>
          </div>
        ))}
      </ResultSection>
    );
  }

  if (tool.toolName === 'get_business_insights' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    const insights = data.insights || {};
    return (
      <ResultSection title="Insights del negocio">
        {insights.headline && (
          <p className="text-sm font-medium text-foreground">{insights.headline}</p>
        )}
        {insights.summary && (
          <p className="text-sm text-muted-foreground">{insights.summary}</p>
        )}
        {Array.isArray(insights.actions) && insights.actions.length > 0 && (
          <div className="space-y-1 text-sm">
            {insights.actions.slice(0, 3).map((action: any, idx: number) => (
              <div key={`${action.title}-${idx}`} className="rounded-lg bg-secondary/60 p-2">
                <p className="font-medium text-foreground">{action.title}</p>
                <p className="text-muted-foreground">{action.detail}</p>
              </div>
            ))}
          </div>
        )}
      </ResultSection>
    );
  }

  if (tool.toolName === 'generate_catalog_pdf' && tool.data && typeof tool.data === 'object') {
    const data = tool.data as any;
    return (
      <ResultSection title="Catálogo">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Productos</span>
          <span className="text-foreground">{data.productCount || 0}</span>
        </div>
        {data.url && (
          <button
            onClick={() => window.open(data.url, '_blank')}
            className="w-full h-9 rounded-xl bg-secondary hover:bg-secondary/80 text-sm text-foreground border border-border transition-all"
          >
            Descargar catálogo
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
