/**
 * Conversation Router
 * Classifies incoming messages as ORDER or INFO threads
 * Handles context preservation during thread switches
 */
import { MessageThread, MessageThreadType, AgentStateType, AgentState } from '../types/index.js';

// Keywords that suggest ORDER thread
const ORDER_KEYWORDS = [
  // Direct orders
  'quiero', 'pedido', 'pedir', 'dame', 'necesito', 'mandame', 'enviame',
  'agregar', 'agregá', 'añadir', 'sumar', 'poneme', 'anotame',
  // Quantities
  'unidades', 'cajas', 'packs', 'docena', 'kilos', 'kg', 'litros',
  // Cart actions
  'carrito', 'sacar', 'quitar', 'eliminar', 'borrar', 'cambiar cantidad',
  // Confirmation
  'confirmo', 'confirmar', 'dale', 'listo', 'si', 'sí', 'perfecto',
  // Payment
  'pagar', 'pago', 'transferencia', 'efectivo', 'mercadopago',
  // Order management
  'cancelar', 'modificar', 'cambiar pedido',
  // History
  'lo de siempre', 'repetir', 'último pedido', 'mismo pedido',
];

// Keywords that suggest INFO thread
const INFO_KEYWORDS = [
  // Questions
  'horario', 'hora', 'abierto', 'cerrado', 'cierran', 'abren',
  'donde', 'dónde', 'dirección', 'direccion', 'ubicación', 'ubicacion',
  'como', 'cómo', 'cuanto', 'cuánto', 'precio', 'cuesta', 'vale',
  'envio', 'envío', 'delivery', 'despacho', 'entrega',
  // Info requests
  'catalogo', 'catálogo', 'lista', 'productos', 'que tienen', 'qué tienen',
  'formas de pago', 'medios de pago', 'metodos de pago',
  'consulta', 'pregunta', 'duda',
  // Debt/Account
  'deuda', 'debo', 'saldo', 'cuenta', 'factura',
  // Greetings (neutral but often start INFO)
  'hola', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches',
];

// Keywords that indicate user frustration or handoff request
const HANDOFF_KEYWORDS = [
  'hablar con', 'persona', 'humano', 'encargado', 'dueño', 'gerente',
  'no entiendo', 'no me sirve', 'esto no funciona', 'mal', 'problema',
  'frustrado', 'enojado', 'molesto', 'cansado',
];

export interface RouterDecision {
  thread: MessageThreadType;
  confidence: number; // 0-1
  shouldInterrupt: boolean;
  keywords: string[];
  handoffRequested: boolean;
  sentimentNegative: boolean;
}

/**
 * Classify message into ORDER or INFO thread
 */
export function classifyMessage(
  message: string,
  currentState: AgentStateType,
  currentThread: MessageThreadType
): RouterDecision {
  const normalizedMsg = message.toLowerCase().trim();
  const words = normalizedMsg.split(/\s+/);

  // Check for handoff keywords
  const handoffMatches = HANDOFF_KEYWORDS.filter(kw => normalizedMsg.includes(kw));
  const handoffRequested = handoffMatches.length > 0;

  // Simple sentiment check (negative indicators)
  const negativeIndicators = ['no', 'mal', 'problema', 'error', 'molesto', 'enojado'];
  const sentimentNegative = negativeIndicators.filter(ind =>
    normalizedMsg.includes(ind)
  ).length >= 2;

  // Check for ORDER keywords
  const orderMatches = ORDER_KEYWORDS.filter(kw => normalizedMsg.includes(kw));
  const orderScore = orderMatches.length;

  // Check for INFO keywords
  const infoMatches = INFO_KEYWORDS.filter(kw => normalizedMsg.includes(kw));
  const infoScore = infoMatches.length;

  // Check for numeric quantities (suggests order)
  const hasQuantity = /\d+\s*(unidad|caja|pack|kilo|kg|litro|docena)/i.test(normalizedMsg) ||
                      /\d+\s+\w+/i.test(normalizedMsg); // "5 cocas"
  if (hasQuantity) {
    orderMatches.push('cantidad numérica');
  }
  const adjustedOrderScore = orderScore + (hasQuantity ? 2 : 0);

  // Context-aware decision
  let thread: MessageThreadType;
  let confidence: number;
  let shouldInterrupt = false;

  // If we're in an ORDER flow state, prefer ORDER unless clear INFO
  const orderFlowStates: AgentStateType[] = [
    AgentState.COLLECTING_ORDER,
    AgentState.NEEDS_DETAILS,
    AgentState.AWAITING_CONFIRMATION,
    AgentState.EXECUTING,
  ];
  const isInOrderFlow = orderFlowStates.includes(currentState);

  if (isInOrderFlow) {
    // During order flow: need strong INFO signal to interrupt
    if (infoScore > adjustedOrderScore + 1) {
      thread = MessageThread.INFO;
      shouldInterrupt = true;
      confidence = Math.min(0.9, 0.5 + (infoScore - adjustedOrderScore) * 0.1);
    } else {
      thread = MessageThread.ORDER;
      confidence = Math.min(0.95, 0.6 + adjustedOrderScore * 0.1);
    }
  } else {
    // Not in order flow: classify normally
    if (adjustedOrderScore > infoScore) {
      thread = MessageThread.ORDER;
      confidence = Math.min(0.9, 0.5 + (adjustedOrderScore - infoScore) * 0.1);
    } else if (infoScore > adjustedOrderScore) {
      thread = MessageThread.INFO;
      confidence = Math.min(0.9, 0.5 + (infoScore - adjustedOrderScore) * 0.1);
    } else {
      // Equal or no keywords - use context
      thread = currentThread; // Stay in current thread
      confidence = 0.5;
    }
  }

  // Short confirmations during order flow stay in ORDER
  if (isInOrderFlow && words.length <= 3 && ['si', 'sí', 'dale', 'ok', 'listo', 'perfecto', 'bueno'].some(w => words.includes(w))) {
    thread = MessageThread.ORDER;
    confidence = 0.95;
    shouldInterrupt = false;
  }

  return {
    thread,
    confidence,
    shouldInterrupt,
    keywords: thread === MessageThread.ORDER ? orderMatches : infoMatches,
    handoffRequested,
    sentimentNegative,
  };
}

/**
 * ConversationRouter class with state tracking
 */
export class ConversationRouter {
  /**
   * Route a message and determine thread
   */
  route(
    message: string,
    currentState: AgentStateType,
    currentThread: MessageThreadType
  ): RouterDecision {
    return classifyMessage(message, currentState, currentThread);
  }

  /**
   * Determine if we should return to ORDER thread after answering INFO
   */
  shouldReturnToOrder(
    previousThread: MessageThreadType,
    previousState: AgentStateType,
    currentThread: MessageThreadType
  ): boolean {
    // If we interrupted ORDER for INFO, we should return
    if (previousThread === MessageThread.ORDER && currentThread === MessageThread.INFO) {
      // Only return if we were in an active order state
      const activeOrderStates: AgentStateType[] = [
        AgentState.COLLECTING_ORDER,
        AgentState.NEEDS_DETAILS,
        AgentState.AWAITING_CONFIRMATION,
      ];
      return activeOrderStates.includes(previousState);
    }
    return false;
  }

  /**
   * Build context reminder for returning to ORDER thread
   */
  buildReturnToOrderContext(cart: { items: Array<{ name: string; quantity: number }> } | null): string {
    if (!cart || cart.items.length === 0) {
      return 'Continuamos con tu pedido...';
    }

    const itemSummary = cart.items
      .map(i => `${i.quantity}x ${i.name}`)
      .slice(0, 3) // Show max 3 items
      .join(', ');

    const moreItems = cart.items.length > 3 ? ` y ${cart.items.length - 3} más` : '';

    return `Listo, retomamos tu pedido (${itemSummary}${moreItems}). ¿Qué más necesitás?`;
  }
}

export const conversationRouter = new ConversationRouter();
