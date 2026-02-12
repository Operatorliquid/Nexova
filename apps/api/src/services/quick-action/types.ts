/**
 * Quick Action Types
 * Type definitions for the Quick Action system
 */

export type ToolRiskLevel = 'safe' | 'moderate' | 'dangerous';

export interface ToolPolicy {
  name: string;
  riskLevel: ToolRiskLevel;
  requiresConfirmation: boolean;
  allowedRoles: ('owner' | 'admin' | 'staff')[];
  description: string;
}

export interface QuickActionRequest {
  command: string;
  workspaceId: string;
  userId: string;
  skipConfirmation?: boolean;
  confirmationToken?: string;
}

export interface ParsedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  policy: ToolPolicy;
}

export interface QuickActionResult {
  id: string;
  status: 'success' | 'pending_confirmation' | 'error' | 'denied';
  command: string;
  parsedTools: ParsedToolCall[];
  results?: ToolExecutionResult[];
  confirmationRequired?: ConfirmationRequest;
  error?: string;
  summary?: string;
  explanation?: string;
  uiActions?: QuickActionUIAction[];
  executedAt?: Date;
  executedBy: string;
}

export type QuickActionUIActionType = 'navigate' | 'open_url' | 'execute_command';

export interface QuickActionUIAction {
  type: QuickActionUIActionType;
  label: string;
  path?: string;
  query?: Record<string, string>;
  url?: string;
  command?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  auto?: boolean;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  canRollback: boolean;
  rollbackData?: unknown;
}

export interface ConfirmationRequest {
  token: string;
  expiresAt: Date;
  tools: Array<{
    name: string;
    input: Record<string, unknown>;
    riskLevel: ToolRiskLevel;
    description: string;
  }>;
  warningMessage: string;
}

export interface QuickActionHistoryItem {
  id: string;
  command: string;
  status: 'success' | 'pending_confirmation' | 'error' | 'denied' | 'rolled_back';
  toolsCalled: string[];
  resultSummary: string;
  executedAt: Date;
  executedBy: string;
  canRerun: boolean;
  canRollback: boolean;
}

// Tool policies configuration
export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  navigate_dashboard: {
    name: 'navigate_dashboard',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Abrir una pantalla del dashboard',
  },
  // Safe tools - read-only queries
  get_customer_info: {
    name: 'get_customer_info',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Obtener información de cliente',
  },
  list_customers: {
    name: 'list_customers',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar clientes del workspace',
  },
  list_debtors: {
    name: 'list_debtors',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar clientes con deuda',
  },
  send_debt_reminder: {
    name: 'send_debt_reminder',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Enviar recordatorio de deuda a un cliente',
  },
  send_debt_reminders_bulk: {
    name: 'send_debt_reminders_bulk',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Enviar recordatorio de deuda a todos los clientes con deuda',
  },
  search_products: {
    name: 'search_products',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Buscar productos',
  },
  list_products: {
    name: 'list_products',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar productos del catálogo',
  },
  get_product_details: {
    name: 'get_product_details',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver detalles de un producto',
  },
  list_categories: {
    name: 'list_categories',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar categorías de productos',
  },
  get_order_details: {
    name: 'get_order_details',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver detalles de pedido',
  },
  list_orders: {
    name: 'list_orders',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar pedidos',
  },
  list_conversations: {
    name: 'list_conversations',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar conversaciones del inbox',
  },
  open_conversation: {
    name: 'open_conversation',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Encontrar una conversación por cliente',
  },
  get_conversation_messages: {
    name: 'get_conversation_messages',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver mensajes de una conversación',
  },
  list_notifications: {
    name: 'list_notifications',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Listar notificaciones del workspace',
  },
  get_customer_balance: {
    name: 'get_customer_balance',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver saldo de cliente',
  },
  get_unpaid_orders: {
    name: 'get_unpaid_orders',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver pedidos impagos',
  },
  generate_catalog_pdf: {
    name: 'generate_catalog_pdf',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Generar catálogo PDF',
  },
  get_business_metrics: {
    name: 'get_business_metrics',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver métricas del negocio',
  },
  get_sales_summary: {
    name: 'get_sales_summary',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Resumen de ventas por período',
  },
  get_low_stock_products: {
    name: 'get_low_stock_products',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver productos con stock bajo',
  },
  get_business_insights: {
    name: 'get_business_insights',
    riskLevel: 'safe',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Ver consejos del negocio',
  },

  // Moderate tools - create/update operations
  update_customer: {
    name: 'update_customer',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Actualizar datos de cliente',
  },
  create_product: {
    name: 'create_product',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Crear producto',
  },
  update_product: {
    name: 'update_product',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Actualizar producto',
  },
  create_category: {
    name: 'create_category',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Crear categoría',
  },
  update_category: {
    name: 'update_category',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Actualizar categoría',
  },
  assign_category_to_products: {
    name: 'assign_category_to_products',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Crear/asignar categoría a productos',
  },
  send_conversation_message: {
    name: 'send_conversation_message',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Enviar mensaje en una conversación',
  },
  set_agent_active: {
    name: 'set_agent_active',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Activar o pausar el agente en una conversación',
  },
  mark_notification_read: {
    name: 'mark_notification_read',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Marcar notificación como leída',
  },
  mark_all_notifications_read: {
    name: 'mark_all_notifications_read',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Marcar todas las notificaciones como leídas',
  },
  update_order_status: {
    name: 'update_order_status',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Cambiar estado de pedido',
  },
  add_order_note: {
    name: 'add_order_note',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin', 'staff'],
    description: 'Agregar nota a pedido',
  },
  create_payment_link: {
    name: 'create_payment_link',
    riskLevel: 'moderate',
    requiresConfirmation: false,
    allowedRoles: ['owner', 'admin'],
    description: 'Crear link de pago',
  },

  // Dangerous tools - require confirmation
  cancel_order: {
    name: 'cancel_order',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Cancelar pedido',
  },
  apply_payment: {
    name: 'apply_payment',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Aplicar pago a cuenta',
  },
  adjust_stock: {
    name: 'adjust_stock',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Ajustar stock',
  },
  bulk_set_stock: {
    name: 'bulk_set_stock',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Ajustar stock de todos los productos',
  },
  adjust_prices_percent: {
    name: 'adjust_prices_percent',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Ajustar precios por porcentaje o monto (producto/s o categoría)',
  },
  delete_product: {
    name: 'delete_product',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Eliminar producto',
  },
  delete_category: {
    name: 'delete_category',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Eliminar categoría',
  },
  delete_customer: {
    name: 'delete_customer',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner'],
    description: 'Eliminar cliente',
  },
  apply_discount: {
    name: 'apply_discount',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner', 'admin'],
    description: 'Aplicar descuento',
  },
  create_credit_adjustment: {
    name: 'create_credit_adjustment',
    riskLevel: 'dangerous',
    requiresConfirmation: true,
    allowedRoles: ['owner'],
    description: 'Ajustar crédito de cliente',
  },
};

// Command suggestions for autocomplete
export const COMMAND_SUGGESTIONS = [
  { command: 'abrir clientes', example: 'abrir clientes', description: 'Navega a la lista de clientes' },
  { command: 'abrir pedidos', example: 'abrir pedidos', description: 'Navega a la lista de pedidos' },
  { command: 'buscar cliente', example: 'buscar cliente Juan Pérez', description: 'Busca un cliente por nombre o teléfono' },
  { command: 'listar clientes', example: 'listar clientes', description: 'Muestra clientes recientes' },
  { command: 'ver pedido', example: 'ver pedido #1234', description: 'Muestra detalles de un pedido' },
  { command: 'pedidos de hoy', example: 'pedidos de hoy', description: 'Lista los pedidos del día' },
  { command: 'pedidos pendientes', example: 'pedidos pendientes', description: 'Lista pedidos sin entregar' },
  { command: 'buscar producto', example: 'buscar producto coca cola', description: 'Busca productos en el catálogo' },
  { command: 'listar productos', example: 'listar productos', description: 'Muestra productos activos' },
  { command: 'stock de', example: 'stock de cerveza quilmes', description: 'Ver stock de un producto' },
  { command: 'deuda de', example: 'deuda de cliente Juan', description: 'Ver deuda de un cliente' },
  { command: 'deudores', example: 'clientes con deuda', description: 'Lista clientes con deuda' },
  { command: 'recordar deuda', example: 'enviar recordatorio de deuda a cliente Juan', description: '⚠️ Envía recordatorio de deuda (requiere confirmación)' },
  { command: 'recordar deuda a todos', example: 'enviar recordatorio de deuda a todos los clientes', description: '⚠️ Envía recordatorio masivo (requiere confirmación)' },
  { command: 'marcar entregado', example: 'marcar entregado pedido #1234', description: 'Marca un pedido como entregado' },
  { command: 'cancelar pedido', example: 'cancelar pedido #1234', description: '⚠️ Cancela un pedido (requiere confirmación)' },
  { command: 'aplicar pago', example: 'aplicar pago $5000 a cliente Juan', description: '⚠️ Registra un pago (requiere confirmación)' },
  { command: 'ajustar stock', example: 'ajustar stock +10 coca cola', description: '⚠️ Ajusta stock (requiere confirmación)' },
  { command: 'subir precios', example: 'subile 5% a coca cola', description: '⚠️ Ajusta precios por porcentaje (requiere confirmación)' },
  { command: 'subir precios por monto', example: 'subile 1500 pesos a coca cola', description: '⚠️ Ajusta precios por monto fijo (requiere confirmación)' },
  { command: 'conversaciones', example: 'ver conversaciones', description: 'Lista conversaciones activas' },
  { command: 'notificaciones', example: 'ver notificaciones', description: 'Muestra notificaciones recientes' },
  { command: 'generar catálogo', example: 'generar catálogo de bebidas', description: 'Genera PDF del catálogo' },
  { command: 'ver métricas', example: 'ver métricas últimos 30 días', description: 'Muestra el resumen del negocio' },
  { command: 'ventas del mes', example: 'cuánto vendí este mes', description: 'Resumen de ventas del mes actual' },
  { command: 'ventas por mes', example: 'cuánto vendí en septiembre 2024', description: 'Resumen de ventas de un mes específico' },
  { command: 'cliente top', example: 'mostrame el cliente que más vende', description: 'Abre el cliente con más ventas' },
  { command: 'producto top', example: 'cuál es el producto más vendido', description: 'Muestra el producto más vendido' },
  { command: 'stock bajo', example: 'hay productos con pocas unidades', description: 'Lista productos con stock bajo' },
  { command: 'consejos', example: 'consejos para mi negocio', description: 'Genera recomendaciones basadas en métricas' },
];
