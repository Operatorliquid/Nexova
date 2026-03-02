import Anthropic from '@anthropic-ai/sdk';

export type OrderImageClassification = 'order_products' | 'payment_receipt' | 'unknown';
export type OrderImageMatchType = 'exact' | 'ambiguous' | 'not_found';

export type OrderImageCatalogProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string | null;
  unitValue: string | null;
  secondaryUnit: string | null;
  secondaryUnitValue: string | null;
};

export type OrderImageProductCandidate = {
  productId: string;
  name: string;
  displayName: string;
  sku: string;
  unit: string | null;
  unitValue: string | null;
  secondaryUnit: string | null;
  secondaryUnitValue: string | null;
  score: number;
};

export type OrderImageMatchedItem = {
  description: string;
  quantity: number;
  matchType: OrderImageMatchType;
  matchedProductId?: string;
  matchedProductName?: string;
  clarification?: string;
  candidates?: OrderImageProductCandidate[];
};

export type AnalyzeOrderImageResult = {
  classification: OrderImageClassification;
  confidence?: number;
  items: OrderImageMatchedItem[];
  message: string;
};

type ExtractedOrderLine = {
  description: string;
  quantity: number;
};

type RankedCandidate = OrderImageProductCandidate & {
  unitMatched: boolean;
};

const PRODUCT_MATCH_STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'con',
  'sin',
  'en',
  'por',
  'para',
  'un',
  'una',
  'uno',
  'unas',
  'unos',
  'quiero',
  'necesito',
  'mandame',
  'manda',
  'agrega',
  'agregar',
  'pedido',
  'pedir',
]);

const UNIT_SHORT_LABELS: Record<string, string> = {
  unit: 'uds',
  kg: 'kg',
  g: 'g',
  l: 'lts',
  ml: 'ml',
  m: 'm',
  cm: 'cm',
};

const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

const stripAccents = (raw: string): string => raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function tokenizeForProductMatch(raw: string): string[] {
  const normalized = stripAccents(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return [];

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !PRODUCT_MATCH_STOPWORDS.has(token));

  return Array.from(new Set(tokens));
}

function normalizeComparableToken(token: string): string {
  let normalized = stripAccents(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  if (!normalized) return '';

  if (normalized.length > 4 && normalized.endsWith('es')) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.length > 3 && normalized.endsWith('s')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function fuzzyTokenMatch(leftRaw: string, rightRaw: string): boolean {
  const left = normalizeComparableToken(leftRaw);
  const right = normalizeComparableToken(rightRaw);
  if (!left || !right) return false;
  if (left === right) return true;

  if (left.length >= 4 && right.includes(left)) return true;
  if (right.length >= 4 && left.includes(right)) return true;

  if (left.length >= 5 && right.length >= 5) {
    const distance = levenshteinDistance(left, right);
    if (distance <= 1) return true;
    if (Math.max(left.length, right.length) >= 9 && distance <= 2) return true;
  }

  return false;
}

function computeTokenSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  let overlapLeft = 0;
  let overlapRight = 0;
  const matchedRight = new Set<number>();

  for (const token of left) {
    const idx = right.findIndex((candidate, candidateIndex) => {
      if (matchedRight.has(candidateIndex) && candidate === token) return true;
      return fuzzyTokenMatch(token, candidate);
    });
    if (idx >= 0) {
      overlapLeft += 1;
      if (!matchedRight.has(idx)) {
        matchedRight.add(idx);
        overlapRight += 1;
      }
    }
  }
  if (overlapLeft === 0) return 0;

  const recall = overlapLeft / left.length;
  const precision = overlapRight / right.length;
  const harmonic = (2 * recall * precision) / (recall + precision);
  return Number.isFinite(harmonic) ? harmonic : 0;
}

function buildProductDisplayName(product: {
  name: string;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
}): string {
  const unit = product.unit || 'unit';
  const unitValue = product.unitValue?.toString().trim();
  let base = product.name;

  if (unit !== 'unit' && unitValue) {
    const short = UNIT_SHORT_LABELS[unit] || unit;
    base = `${base} ${unitValue} ${short}`.trim();
  }

  if (product.secondaryUnit) {
    const label = SECONDARY_UNIT_LABELS[product.secondaryUnit] || product.secondaryUnit;
    const value = product.secondaryUnitValue?.toString().trim();
    base = value ? `${base} ${label} ${value}`.trim() : `${base} ${label}`.trim();
  }

  return base;
}

function normalizeUnit(raw: string): string | null {
  const token = stripAccents(raw).toLowerCase().replace(/[^a-z]/g, '').trim();
  if (!token) return null;
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(token)) return 'l';
  if (['ml', 'cc', 'mililitro', 'mililitros'].includes(token)) return 'ml';
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(token)) return 'kg';
  if (['g', 'gr', 'gramo', 'gramos'].includes(token)) return 'g';
  if (['m', 'mt', 'metro', 'metros'].includes(token)) return 'm';
  if (['cm', 'centimetro', 'centimetros'].includes(token)) return 'cm';
  if (['pack', 'paq', 'paquete', 'paquetes'].includes(token)) return 'pack';
  if (['caja', 'cajas', 'box'].includes(token)) return 'box';
  if (['bulto', 'bultos', 'bundle'].includes(token)) return 'bundle';
  if (['docena', 'docenas', 'dozen', 'doc'].includes(token)) return 'dozen';
  return null;
}

function normalizeMeasureValue(raw: string): string {
  const normalized = raw.replace(',', '.').trim();
  if (!normalized) return '';
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return normalized;
  }
  if (Math.floor(asNumber) === asNumber) {
    return String(Math.floor(asNumber));
  }
  return String(asNumber);
}

function extractUnitHints(text: string): Array<{ unit?: string; value?: string }> {
  const hints: Array<{ unit?: string; value?: string }> = [];
  const normalized = text.toLowerCase().replace(/,/g, '.');

  const withUnitRegex = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = withUnitRegex.exec(normalized))) {
    const unit = normalizeUnit(match[2]);
    if (!unit) continue;
    hints.push({ unit, value: normalizeMeasureValue(match[1]) });
  }

  const tokenRegex = /\b(pack|paq|paquete|caja|box|bulto|docena|dozen|doc)\b/gi;
  let tokenMatch: RegExpExecArray | null;
  while ((tokenMatch = tokenRegex.exec(normalized))) {
    const unit = normalizeUnit(tokenMatch[1]);
    if (unit) hints.push({ unit });
  }

  return hints;
}

function matchesUnitHints(
  product: {
    unit?: string | null;
    unitValue?: string | null;
    secondaryUnit?: string | null;
    secondaryUnitValue?: string | null;
  },
  hints: Array<{ unit?: string; value?: string }>
): boolean {
  if (!hints.length) return true;

  const productUnit = product.unit || 'unit';
  const productUnitValue = product.unitValue ? normalizeMeasureValue(product.unitValue) : null;
  const productSecondaryUnit = product.secondaryUnit || null;
  const productSecondaryValue = product.secondaryUnitValue ? normalizeMeasureValue(product.secondaryUnitValue) : null;

  return hints.some((hint) => {
    if (!hint.unit) return false;

    if (hint.unit === productUnit) {
      if (!hint.value || !productUnitValue) return true;
      return hint.value === productUnitValue;
    }

    if (hint.unit === productSecondaryUnit) {
      if (!hint.value) return true;
      if (!productSecondaryValue) return false;
      return hint.value === productSecondaryValue;
    }

    return false;
  });
}

function parsePositiveQuantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const qty = Math.round(value);
    if (qty > 0 && qty <= 1_000_000) return qty;
    return 1;
  }
  if (typeof value === 'string') {
    const digits = value.replace(/[^0-9.-]/g, '').trim();
    if (!digits) return 1;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) return 1;
    return parsePositiveQuantity(parsed);
  }
  return 1;
}

function detectReceiptByText(raw: string): boolean {
  const normalized = stripAccents(raw || '').toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('comprobante')
    || normalized.includes('transferencia')
    || normalized.includes('mercado pago')
    || normalized.includes('pago')
    || normalized.includes('ticket')
    || normalized.includes('trx')
    || normalized.includes('operacion')
  );
}

function splitCaptionIntoItems(caption?: string): ExtractedOrderLine[] {
  const raw = (caption || '').trim();
  if (!raw) return [];

  const parts = raw
    .split(/\n|,|;|\s+y\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      const prefixed = part.match(/^(\d+)\s*x?\s*(.+)$/i);
      if (prefixed) {
        return {
          quantity: parsePositiveQuantity(prefixed[1]),
          description: prefixed[2].trim(),
        };
      }
      return {
        quantity: 1,
        description: part,
      };
    })
    .filter((line) => line.description.length > 0)
    .slice(0, 30);
}

function buildPrompt(caption?: string): string {
  const captionLine = caption?.trim()
    ? `Texto/caption enviado junto a la imagen: "${caption.trim()}".`
    : 'No hay texto/caption adicional.';

  return [
    'Clasificá esta imagen/PDF en UNA de estas categorías:',
    '1) order_products: lista/pedido de productos.',
    '2) payment_receipt: comprobante de pago/transferencia.',
    '3) unknown: no se puede determinar.',
    captionLine,
    'Si es order_products, extraé los items con cantidad y descripción.',
    'Si no se ve la cantidad, usar 1.',
    'Respondé SOLO JSON válido en una sola línea con esta forma exacta:',
    '{"intent":"order_products|payment_receipt|unknown","confidence":0.0,"items":[{"description":"string","quantity":number}]}',
  ].join('\n');
}

function normalizeClassification(value: unknown, caption?: string): OrderImageClassification {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'order_products') return 'order_products';
    if (normalized === 'payment_receipt' || normalized === 'receipt') return 'payment_receipt';
    if (normalized === 'unknown') return 'unknown';
  }
  if (detectReceiptByText(caption || '')) return 'payment_receipt';
  if ((caption || '').trim()) return 'order_products';
  return 'unknown';
}

function normalizeExtractedItems(items: unknown, caption?: string): ExtractedOrderLine[] {
  if (!Array.isArray(items)) {
    return splitCaptionIntoItems(caption);
  }

  const parsed = items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const descriptionRaw = record.description;
      const description = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : '';
      if (!description) return null;
      return {
        description,
        quantity: parsePositiveQuantity(record.quantity),
      };
    })
    .filter((line): line is ExtractedOrderLine => line !== null);

  return parsed.length > 0 ? parsed.slice(0, 30) : splitCaptionIntoItems(caption);
}

async function extractIntentAndItemsWithClaude(params: {
  buffer: Buffer;
  mediaType: string;
  caption?: string;
}): Promise<{ classification: OrderImageClassification; confidence?: number; lines: ExtractedOrderLine[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return {
      classification: normalizeClassification(undefined, params.caption),
      lines: splitCaptionIntoItems(params.caption),
    };
  }

  const model = process.env.ORDER_IMAGE_OCR_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  const anthropic = new Anthropic({ apiKey });

  const base64 = params.buffer.toString('base64');
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: buildPrompt(params.caption) },
  ];

  if (params.mediaType === 'application/pdf') {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64,
      },
    } as Anthropic.ContentBlockParam);
  } else {
    const mediaType = params.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    } as Anthropic.ContentBlockParam);
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1200,
    temperature: 0,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const rawText = textBlock?.text?.trim() || '';
  if (!rawText) {
    return {
      classification: normalizeClassification(undefined, params.caption),
      lines: splitCaptionIntoItems(params.caption),
    };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      classification: normalizeClassification(undefined, params.caption),
      lines: splitCaptionIntoItems(params.caption),
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      intent?: unknown;
      confidence?: unknown;
      items?: unknown;
    };
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : undefined;
    return {
      classification: normalizeClassification(parsed.intent, params.caption),
      confidence,
      lines: normalizeExtractedItems(parsed.items, params.caption),
    };
  } catch {
    return {
      classification: normalizeClassification(undefined, params.caption),
      lines: splitCaptionIntoItems(params.caption),
    };
  }
}

function rankCandidates(item: ExtractedOrderLine, products: OrderImageCatalogProduct[]): RankedCandidate[] {
  const itemTokens = tokenizeForProductMatch(item.description);
  const unitHints = extractUnitHints(item.description);

  return products
    .map((product) => {
      const productTokens = tokenizeForProductMatch(`${product.name} ${product.sku || ''}`);
      let score = computeTokenSimilarity(itemTokens, productTokens);
      if (itemTokens[0] && productTokens[0] && itemTokens[0] === productTokens[0]) {
        score += 0.08;
      }

      const unitMatched = unitHints.length > 0 ? matchesUnitHints(product, unitHints) : false;
      if (unitHints.length > 0) {
        score += unitMatched ? 0.24 : -0.14;
      }

      score = Math.max(0, Math.min(0.99, score));

      return {
        productId: product.id,
        name: product.name,
        displayName: buildProductDisplayName(product),
        sku: product.sku,
        unit: product.unit,
        unitValue: product.unitValue,
        secondaryUnit: product.secondaryUnit,
        secondaryUnitValue: product.secondaryUnitValue,
        score,
        unitMatched,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function resolveMatch(item: ExtractedOrderLine, products: OrderImageCatalogProduct[]): OrderImageMatchedItem {
  const candidates = rankCandidates(item, products);
  const best = candidates[0];
  const second = candidates[1];
  const hasUnitHints = extractUnitHints(item.description).length > 0;

  if (!best || best.score < 0.28) {
    return {
      description: item.description,
      quantity: item.quantity,
      matchType: 'not_found',
      clarification: `No encontré "${item.description}" en el stock. ¿Me lo podés escribir con más detalle?`,
      candidates: [],
    };
  }

  const isAmbiguousBySimilarity = Boolean(second) && best.score - second.score < 0.08 && second.score >= 0.45;
  const isAmbiguousByMeasure = hasUnitHints && !best.unitMatched && best.score < 0.8;
  const isWeakMatch = best.score < 0.52;

  if (isAmbiguousBySimilarity || isAmbiguousByMeasure || isWeakMatch) {
    const topCandidates = candidates.slice(0, 3);
    const suggestion = topCandidates[0]?.displayName
      ? `Tengo ${topCandidates[0].displayName}. ¿Te sirve?`
      : `No me quedó claro "${item.description}". ¿Cuál querés exactamente?`;

    return {
      description: item.description,
      quantity: item.quantity,
      matchType: 'ambiguous',
      clarification: suggestion,
      candidates: topCandidates,
    };
  }

  return {
    description: item.description,
    quantity: item.quantity,
    matchType: 'exact',
    matchedProductId: best.productId,
    matchedProductName: best.displayName,
    candidates: [best],
  };
}

export async function analyzeOrderImageWithClaude(params: {
  buffer: Buffer;
  mediaType: string;
  caption?: string;
  products: OrderImageCatalogProduct[];
}): Promise<AnalyzeOrderImageResult> {
  const extracted = await extractIntentAndItemsWithClaude({
    buffer: params.buffer,
    mediaType: params.mediaType,
    caption: params.caption,
  });

  if (extracted.classification === 'payment_receipt') {
    return {
      classification: 'payment_receipt',
      confidence: extracted.confidence,
      items: [],
      message: 'Detecté que el archivo parece un comprobante de pago.',
    };
  }

  if (extracted.classification !== 'order_products') {
    return {
      classification: 'unknown',
      confidence: extracted.confidence,
      items: [],
      message: 'No pude identificar productos con claridad en la imagen.',
    };
  }

  const items = extracted.lines.map((line) => resolveMatch(line, params.products));
  const exactCount = items.filter((item) => item.matchType === 'exact').length;
  const ambiguousCount = items.filter((item) => item.matchType === 'ambiguous').length;
  const notFoundCount = items.filter((item) => item.matchType === 'not_found').length;

  const message =
    items.length === 0
      ? 'No encontré líneas de productos para procesar.'
      : ambiguousCount > 0 || notFoundCount > 0
        ? `Detecté ${items.length} item(s): ${exactCount} claros, ${ambiguousCount} ambiguos y ${notFoundCount} sin match.`
        : `Detecté ${exactCount} item(s) de producto listos para agregar al pedido.`;

  return {
    classification: 'order_products',
    confidence: extracted.confidence,
    items,
    message,
  };
}
