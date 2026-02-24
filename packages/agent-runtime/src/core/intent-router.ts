/**
 * Deterministic intent and selection parsing helpers.
 * Keeps critical flow-routing decisions out of LLM ambiguity.
 */

export type GlobalFlowIntent = 'order' | 'payment' | 'menu' | 'active_orders' | 'catalog' | null;

const MENU_PATTERNS: RegExp[] = [
  /\bmenu\b/,
  /\bmenu principal\b/,
  /\bvolver al menu\b/,
  /\bvolver al inicio\b/,
  /\binicio\b/,
  /\bregresar\b/,
  /\breset\b/,
  /\breiniciar\b/,
  /\bempezar de nuevo\b/,
];

const PAYMENT_KEYWORDS = [
  'pagar',
  'pago',
  'abonar',
  'abono',
  'deuda',
  'saldo pendiente',
  'comprobante',
  'transferencia',
  'mercadopago',
  'link de pago',
];

const ACTIVE_ORDERS_KEYWORDS = [
  'mis pedidos',
  'mis ordenes',
  'mis órdenes',
  'ver pedidos',
  'ver mis pedidos',
  'pedidos pendientes',
  'pedido pendiente',
  'pedidos activos',
  'estado de pedido',
  'estado del pedido',
  'seguimiento pedido',
];

const CATALOG_KEYWORDS = [
  'catalogo',
  'catálogo',
  'lista de precios',
  'lista precios',
  'ver productos',
  'mostrar productos',
  'enviame catalogo',
  'enviame el catalogo',
  'enviar catalogo',
  'catalogo pdf',
];

const ORDER_KEYWORDS = [
  'nuevo pedido',
  'hacer pedido',
  'hacer un pedido',
  'quiero pedir',
  'quiero comprar',
  'armar pedido',
  'tomar pedido',
  'agregar al pedido',
];

const INDEX_WORDS: Record<string, number> = {
  uno: 1,
  una: 1,
  primero: 1,
  primer: 1,
  dos: 2,
  segundo: 2,
  segunda: 2,
  tres: 3,
  tercero: 3,
  tercera: 3,
  cuatro: 4,
  cuarto: 4,
  cuarta: 4,
  cinco: 5,
  quinto: 5,
  quinta: 5,
  seis: 6,
  sexto: 6,
  sexta: 6,
  siete: 7,
  septimo: 7,
  septima: 7,
  octavo: 8,
  octava: 8,
  ocho: 8,
  nueve: 9,
  noveno: 9,
  novena: 9,
  diez: 10,
  decimo: 10,
  decima: 10,
};

export function normalizeIntentText(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!¡?¿;:()"']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAnyKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function parseGlobalFlowIntent(message: string): GlobalFlowIntent {
  const normalized = normalizeIntentText(message);
  if (!normalized) return null;

  if (MENU_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'menu';
  }

  const paymentIntent = hasAnyKeyword(normalized, PAYMENT_KEYWORDS);
  const activeOrdersIntent = hasAnyKeyword(normalized, ACTIVE_ORDERS_KEYWORDS);
  const catalogIntent = hasAnyKeyword(normalized, CATALOG_KEYWORDS);
  const orderIntent = hasAnyKeyword(normalized, ORDER_KEYWORDS);

  if (paymentIntent) return 'payment';
  if (activeOrdersIntent) return 'active_orders';
  // Promotions should not force "catalog" flow.
  // Let the agent resolve them via promotions tools.
  if (catalogIntent && !orderIntent) return 'catalog';
  if (orderIntent) return 'order';
  if (catalogIntent) return 'catalog';

  return null;
}

/**
 * Parses interactive-style numeric selections from free text.
 * Returns a 1-based index when the message clearly refers to an option number.
 */
export function extractSelectionIndex(message: string): number | null {
  const raw = (message || '').trim().toLowerCase();
  if (!raw) return null;

  const directMatch = raw.match(/^#?\s*(\d{1,2})[.)-]?$/);
  if (directMatch?.[1]) {
    const parsed = Number.parseInt(directMatch[1], 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
  }

  const directWord = raw.match(
    /^(?:opcion|op|numero|nro|num)?\s*(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|primero|primer|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta|sexto|sexta|septimo|septima|octavo|octava|noveno|novena|decimo|decima)$/
  );
  if (directWord?.[1]) {
    const parsed = INDEX_WORDS[directWord[1]];
    return Number.isFinite(parsed) ? parsed : null;
  }

  const normalized = normalizeIntentText(message);
  if (!normalized) return null;

  // Avoid treating explicit order numbers like ORD-00005 as list indexes.
  if (/\bord\s*\d+\b/.test(normalized) || normalized.startsWith('ord ')) {
    return null;
  }

  const contextualMatch = normalized.match(
    /^(?:el|la|opcion|op|pedido|orden|item|numero|nro|num)\s*(?:nro|numero|num)?\s*([a-z0-9]{1,16})$/
  );
  const token = contextualMatch?.[1];
  if (token) {
    if (/^\d{1,2}$/.test(token)) {
      const parsed = Number.parseInt(token, 10);
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
    }
    const parsed = INDEX_WORDS[token];
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}
