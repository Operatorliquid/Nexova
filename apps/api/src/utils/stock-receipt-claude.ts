import Anthropic from '@anthropic-ai/sdk';

const INT32_MAX = 2_147_483_647;

type ClaudeProduct = {
  id: string;
  sku: string;
  name: string;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
  category?: string | null;
};

export type StockReceiptExtractedItem = {
  description: string;
  quantity: number;
  is_pack?: boolean;
  units_per_pack?: number | null;
  // Raw fields often seen in supplier receipts (for fallback normalization).
  bultos?: number | null;
  uxb?: number | null;
  units?: number | null;
  unit_price_cents?: number | null;
  line_total_cents?: number | null;
  match?: {
    product_id: string | null;
    confidence?: number | null;
    reason?: string | null;
  };
  new_product?: {
    name: string;
    unit?: 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm' | null;
    unit_value?: string | null;
    secondary_unit?: 'pack' | 'box' | 'bundle' | 'dozen' | null;
    secondary_unit_value?: string | null;
  } | null;
};

export type StockReceiptExtractResult = {
  vendor?: string | null;
  issued_at?: string | null; // YYYY-MM-DD
  currency?: string | null;
  total_cents?: number | null;
  confidence?: number | null;
  items?: StockReceiptExtractedItem[];
};

type PrimaryUnit = 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm';
type SecondaryUnit = 'pack' | 'box' | 'bundle' | 'dozen';
type ProductMatchCandidate = {
  productId: string;
  confidence: number;
  reason: string;
};

const PRODUCT_STOPWORDS = new Set([
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
  'x',
  'un',
  'una',
  'gas',
  'gaseosa',
]);

function normalizeCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const cents = Math.round(value);
    if (cents <= 0 || cents > INT32_MAX) return null;
    return cents;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const sanitized = trimmed.replace(/[^0-9.,-]/g, '');
    if (!sanitized) return null;

    // If we get an integer-like value (no separators), assume it's already cents.
    if (!sanitized.includes('.') && !sanitized.includes(',')) {
      const asInteger = Number(sanitized);
      if (!Number.isFinite(asInteger) || asInteger <= 0) return null;
      const cents = Math.round(asInteger);
      if (cents <= 0 || cents > INT32_MAX) return null;
      return cents;
    }

    let normalized = sanitized;
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
    const cents = Math.round(amount * 100);
    if (cents <= 0 || cents > INT32_MAX) return null;
    return cents;
  }

  return null;
}

function normalizeQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const qty = Math.round(value);
    if (qty <= 0 || qty > 1_000_000) return null;
    return qty;
  }
  if (typeof value === 'string') {
    const digits = value.trim().replace(/[^0-9.-]/g, '');
    if (!digits) return null;
    const asNumber = Number(digits);
    if (!Number.isFinite(asNumber)) return null;
    return normalizeQuantity(asNumber);
  }
  return null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function normalizeIssuedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const alt = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (alt) {
    return `${alt[3]}-${alt[2]}-${alt[1]}`;
  }
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

function stripAccents(raw: string): string {
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function mapPrimaryUnit(raw: string): PrimaryUnit | null {
  const token = raw.trim().toLowerCase();
  if (['kg', 'kgr', 'kilo', 'kilos'].includes(token)) return 'kg';
  if (['g', 'gr', 'gramo', 'gramos'].includes(token)) return 'g';
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(token)) return 'l';
  if (['ml', 'cc'].includes(token)) return 'ml';
  if (['m', 'mt', 'mts', 'metro', 'metros'].includes(token)) return 'm';
  if (['cm', 'centimetro', 'centimetros'].includes(token)) return 'cm';
  return null;
}

function normalizePrimaryUnit(raw: unknown): PrimaryUnit | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (token === 'unit') return 'unit';
  return mapPrimaryUnit(token);
}

function toComparableMeasure(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeMeasureValue(value);
  return normalized || null;
}

function inferPackUnitsFromText(text: string): number | null {
  // Common supplier shorthand: PETx6, PACK x 6, Bulto x 12, Caja x 24.
  const candidates = Array.from(
    text.matchAll(/\b(?:pet|pack|paq|paquete|bulto|caja|cx|lat|lata)\s*x?\s*(\d{1,4})\b/gi)
  );
  if (candidates.length === 0) return null;
  const last = candidates[candidates.length - 1];
  const units = normalizeQuantity(last[1] || '');
  if (!units || units <= 1) return null;
  return units;
}

function hasPackMarker(text: string): boolean {
  return (
    /\b(?:pet|pack|paq|paquete|bulto|caja|cx|lat|lata)\b/i.test(text) ||
    /\b(?:lat|lata)\d{1,4}\b/i.test(text) ||
    /\bx\s*\d{1,4}\b/i.test(text)
  );
}

function inferPrimaryMeasureFromText(text: string): { unit: PrimaryUnit; value: string } | null {
  const candidates: Array<{ unit: PrimaryUnit; value: string }> = [];

  for (const match of text.matchAll(/(?:^|[\s./_-])x?\s*(\d+(?:[.,]\d+)?)\s*(kg|kgr|kilo|kilos|g|gr|gramo|gramos|l|lt|lts|litro|litros|ml|cc|m|mt|mts|metro|metros|cm)\b/gi)) {
    const value = normalizeMeasureValue(match[1] || '');
    const unit = mapPrimaryUnit(match[2] || '');
    if (value && unit) candidates.push({ unit, value });
  }

  // Compact forms like "x250ml", "2lt", "1kg"
  for (const match of text.matchAll(/\bx?\s*(\d+(?:[.,]\d+)?)(kg|kgr|kilo|kilos|g|gr|gramo|gramos|l|lt|lts|litro|litros|ml|cc|m|mt|mts|metro|metros|cm)\b/gi)) {
    const value = normalizeMeasureValue(match[1] || '');
    const unit = mapPrimaryUnit(match[2] || '');
    if (value && unit) candidates.push({ unit, value });
  }

  // Supplier shorthand: "LATAX354" usually means 354ml cans.
  for (const match of text.matchAll(/\blata\s*x?\s*(\d{2,4})\b/gi)) {
    const value = normalizeMeasureValue(match[1] || '');
    if (value) candidates.push({ unit: 'ml', value });
  }

  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

function stripMeasureFromName(raw: string): string {
  return raw
    .replace(/(?:^|[\s./_-])x?\s*\d+(?:[.,]\d+)?\s*(kg|kgr|kilo|kilos|g|gr|gramo|gramos|l|lt|lts|litro|litros|ml|cc|m|mt|mts|metro|metros|cm)\b/gi, ' ')
    .replace(/\bx?\s*\d+(?:[.,]\d+)?(kg|kgr|kilo|kilos|g|gr|gramo|gramos|l|lt|lts|litro|litros|ml|cc|m|mt|mts|metro|metros|cm)\b/gi, ' ')
    .replace(/\b(?:pet|pack|paq|paquete|bulto|caja|cx)\s*x?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b(?:pet|pack|paq|paquete|bulto|caja|cx)\b/gi, ' ')
    .replace(/\b(?:lat|lata)\s*x?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b(?:lat|lata)\d{1,4}\b/gi, ' ')
    .replace(/\b\d{2,4}\s*(?:lat|lata)\s*x?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b\d{2,4}\s*(?:lat|lata)\b/gi, ' ')
    .replace(/\blata\s*x?\s*\d{2,4}\b/gi, 'lata')
    .replace(/\bx\s*\d{2,4}\b/gi, ' ')
    .replace(/\b\d{1,4}\s*(?:cc|ml|lts?|lt|kg|gr|g)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s./_-]+|[\s./_-]+$/g, '')
    .trim();
}

function normalizeProductName(rawName: string, fallback: string): string {
  const base = stripMeasureFromName(rawName || '') || stripMeasureFromName(fallback || '') || fallback || 'Producto';
  return base
    .replace(/[.;:,]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 255);
}

function tokenizeForMatch(raw: string): string[] {
  const normalized = stripAccents(stripMeasureFromName(raw || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return [];
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !PRODUCT_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

function computeTokenSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const recall = overlap / left.length;
  const precision = overlap / right.length;
  const harmonic = (2 * recall * precision) / (recall + precision);
  return Number.isFinite(harmonic) ? harmonic : 0;
}

function resolveProductMatch(params: {
  description: string;
  isPack: boolean;
  unitsPerPack: number | null;
  llmProductId: string | null;
  llmConfidence: number | null;
  llmReason: string | null;
  products: ClaudeProduct[];
}): ProductMatchCandidate | null {
  const productById = new Map(params.products.map((product) => [product.id, product]));
  const descriptionTokens = tokenizeForMatch(params.description);
  const inferredMeasure = inferPrimaryMeasureFromText(params.description);

  const ranked = params.products
    .map((product) => {
      const productTokens = tokenizeForMatch(product.name || '');
      let score = computeTokenSimilarity(descriptionTokens, productTokens);
      if (descriptionTokens[0] && productTokens[0] && descriptionTokens[0] === productTokens[0]) {
        score += 0.08;
      }

      const productUnit = normalizePrimaryUnit(product.unit);
      const productUnitValue = toComparableMeasure(product.unitValue ? String(product.unitValue) : null);
      if (inferredMeasure && productUnit) {
        if (inferredMeasure.unit === productUnit) {
          score += 0.14;
          if (productUnitValue && inferredMeasure.value === productUnitValue) {
            score += 0.24;
          } else if (productUnitValue && inferredMeasure.value !== productUnitValue) {
            score -= 0.14;
          }
        } else {
          score -= 0.18;
        }
      }

      if (params.isPack) {
        if (product.secondaryUnit && ['pack', 'box', 'bundle', 'dozen'].includes(product.secondaryUnit)) {
          score += 0.06;
        }
        const expected = params.unitsPerPack && params.unitsPerPack > 0 ? String(params.unitsPerPack) : null;
        const secondaryValue = product.secondaryUnitValue ? normalizeMeasureValue(String(product.secondaryUnitValue)) : null;
        if (expected && secondaryValue && expected === secondaryValue) {
          score += 0.12;
        }
      }

      return {
        product,
        score: Math.max(0, Math.min(0.99, score)),
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  const deterministicCandidate =
    best &&
    best.score >= 0.56 &&
    (best.score >= 0.82 || !second || best.score - second.score >= 0.07)
      ? {
          productId: best.product.id,
          confidence: Math.max(0.45, Math.min(0.95, best.score)),
          reason: `heuristic-match:${best.score.toFixed(2)}`,
        }
      : null;

  const llmCandidate =
    params.llmProductId && productById.has(params.llmProductId)
      ? {
          productId: params.llmProductId,
          confidence: params.llmConfidence ?? null,
          reason: params.llmReason || null,
        }
      : null;

  if (!llmCandidate && !deterministicCandidate) return null;
  if (!llmCandidate && deterministicCandidate) return deterministicCandidate;
  if (llmCandidate && !deterministicCandidate) {
    return {
      productId: llmCandidate.productId,
      confidence: llmCandidate.confidence ?? 0.5,
      reason: llmCandidate.reason || 'llm-match',
    };
  }

  if (llmCandidate && deterministicCandidate) {
    if (llmCandidate.productId === deterministicCandidate.productId) {
      return {
        productId: llmCandidate.productId,
        confidence: Math.max(llmCandidate.confidence ?? 0.5, deterministicCandidate.confidence),
        reason: llmCandidate.reason || deterministicCandidate.reason,
      };
    }

    const llmConfidence = llmCandidate.confidence ?? 0;
    if (llmConfidence >= 0.75 && deterministicCandidate.confidence < llmConfidence + 0.2) {
      return {
        productId: llmCandidate.productId,
        confidence: llmConfidence,
        reason: llmCandidate.reason || 'llm-match',
      };
    }
    if (deterministicCandidate.confidence >= 0.74 && deterministicCandidate.confidence > llmConfidence + 0.08) {
      return deterministicCandidate;
    }

    return {
      productId: llmCandidate.productId,
      confidence: Math.max(0.5, llmConfidence),
      reason: llmCandidate.reason || 'llm-match',
    };
  }

  return null;
}

function mapSecondaryUnit(raw: string): SecondaryUnit | null {
  const token = raw.trim().toLowerCase();
  if (['pack', 'paquete'].includes(token)) return 'pack';
  if (['box', 'caja'].includes(token)) return 'box';
  if (['bundle', 'bulto'].includes(token)) return 'bundle';
  if (['dozen', 'docena'].includes(token)) return 'dozen';
  return null;
}

function inferSecondaryUnitFromText(text: string, isPack: boolean, unitsPerPack?: number | null): SecondaryUnit | null {
  if (!isPack) return null;
  if (/\bdocena(s)?\b/i.test(text) || unitsPerPack === 12) return 'dozen';
  if (/\bpet\b/i.test(text)) return 'pack';
  if (/\bcaja(s)?\b/i.test(text)) return 'box';
  if (/\bpack(s)?\b/i.test(text)) return 'pack';
  if (/\bbulto(s)?\b/i.test(text)) return 'bundle';
  return 'bundle';
}

function buildPrompt(products: ClaudeProduct[]): string {
  const catalog = products.length
    ? `CATALOGO (productos existentes):\n${JSON.stringify(products)}`
    : 'CATALOGO (productos existentes): []';

  return [
    'Sos un asistente especializado en leer boletas/facturas de compra de mercaderia (proveedores) para actualizar stock.',
    'Tu tarea:',
    '1) Extraer items (descripcion y cantidad).',
    '2) Identificar el producto EXACTO del catalogo (por tamanio/pack) y devolver el product_id.',
    '3) Si no existe en el catalogo, propon un new_product (NO inventes ids).',
    '4) Detectar si el item es un PACK/CAJA/BULTO/DOCENA y, si es posible, units_per_pack.',
    '5) Extraer el total (total_cents) en centavos ARS.',
    '',
    'REGLAS:',
    '- product_id debe ser EXACTAMENTE uno de los ids del CATALOGO o null.',
    '- Si hay duda entre 2 productos similares, elige null y completa new_product o deja match.confidence baja.',
    '- Si la boleta usa columnas "Bultos", "UxB" y "Unidad":',
    '  - quantity = Bultos cuando Bultos > 0, is_pack = true, units_per_pack = UxB.',
    '  - Si Bultos = 0 o vacio, quantity = Unidad, is_pack = false (aunque UxB exista).',
    '  - Nunca dejes quantity en 0 si hay datos de unidades o bultos.',
    '- Tratar "PETx6", "PACKx6", "CAJAx24" como formato de segunda unidad: pack/caja con units_per_pack.',
    '- Para segunda unidad "bulto", usar secondary_unit = "bundle".',
    '- En new_product.name NO incluyas medida ni formato (ej: no "Pepsi 2LT", no "Coca PETx6").',
    '- La medida va en unit/unit_value y el formato pack/caja/bulto/docena va en secondary_unit/secondary_unit_value.',
    '- Si falta total, estimá total_cents sumando line_total_cents de los ítems.',
    '- No inventes productos ni ids.',
    '- Respondé SOLO con JSON válido en una sola linea (sin markdown).',
    '',
    'FORMATO:',
    '{',
    '  "vendor": string|null,',
    '  "issued_at": "YYYY-MM-DD"|null,',
    '  "currency": "ARS"|null,',
    '  "total_cents": number|null,',
    '  "confidence": number (0-1)|null,',
    '  "items": [',
    '    {',
    '      "description": string,',
    '      "quantity": number,',
    '      "is_pack": boolean,',
    '      "units_per_pack": number|null,',
    '      "bultos": number|null,',
    '      "uxb": number|null,',
    '      "units": number|null,',
    '      "unit_price_cents": number|null,',
    '      "line_total_cents": number|null,',
    '      "match": {"product_id": string|null, "confidence": number (0-1)|null, "reason": string|null},',
    '      "new_product": {"name": string, "unit": string|null, "unit_value": string|null, "secondary_unit": string|null, "secondary_unit_value": string|null} | null',
    '    }',
    '  ]',
    '}',
    '',
    catalog,
  ].join('\n');
}

export async function extractStockReceiptWithClaude(params: {
  buffer: Buffer;
  mediaType: string;
  products: ClaudeProduct[];
}): Promise<{ parsed: StockReceiptExtractResult | null; rawText: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return { parsed: null, rawText: '' };
  }

  const model =
    process.env.STOCK_RECEIPT_OCR_MODEL ||
    process.env.RECEIPT_OCR_MODEL ||
    process.env.LLM_MODEL ||
    'claude-sonnet-4-20250514';

  const anthropic = new Anthropic({ apiKey });
  const base64 = params.buffer.toString('base64');

  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: buildPrompt(params.products) }];

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
    max_tokens: 1400,
    temperature: 0,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const rawText = textBlock?.text?.trim() || '';
  if (!rawText) {
    return { parsed: null, rawText: '' };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { parsed: null, rawText };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as StockReceiptExtractResult;
    const products = Array.isArray(params.products) ? params.products : [];

    const normalizedItems = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((item) => {
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        const bultos = normalizeQuantity((item as any).bultos ?? (item as any).bulk_qty ?? null);
        const units = normalizeQuantity((item as any).units ?? (item as any).unidad ?? null);
        const uxb = normalizeQuantity((item as any).uxb ?? (item as any).units_per_bulk ?? null);

        let quantity = normalizeQuantity(item.quantity) ?? 0;
        let isPack = item.is_pack === true;
        let unitsPerPack = normalizeQuantity(item.units_per_pack ?? null);
        let unitPrice = normalizeCents(item.unit_price_cents ?? null);
        let lineTotal = normalizeCents(item.line_total_cents ?? null);

        if (bultos && bultos > 0) {
          quantity = bultos;
          isPack = true;
        } else if (bultos === 0 && units && units > 0) {
          // Explicitly prefer "Unidad" when "Bultos" is present as 0.
          quantity = units;
          isPack = false;
        } else if (units && units > 0 && quantity <= 0) {
          quantity = units;
          isPack = false;
        }

        if (uxb && uxb > 0 && (!unitsPerPack || unitsPerPack <= 0)) {
          unitsPerPack = uxb;
        }

        const inferredPackUnits = inferPackUnitsFromText(description);
        if ((!unitsPerPack || unitsPerPack <= 0) && inferredPackUnits && inferredPackUnits > 1) {
          unitsPerPack = inferredPackUnits;
        }

        if (quantity <= 0 && units && units > 0) {
          quantity = units;
          isPack = false;
        }
        if (!isPack && hasPackMarker(description) && (unitsPerPack || 0) > 1 && quantity > 0) {
          isPack = true;
        }
        if (!isPack && /\bbulto(s)?\b/i.test(description) && quantity > 0 && (unitsPerPack || 0) > 1) {
          isPack = true;
        }

        if ((!lineTotal || lineTotal <= 0) && unitPrice && unitPrice > 0 && quantity > 0) {
          lineTotal = unitPrice * quantity;
        }
        if ((!unitPrice || unitPrice <= 0) && lineTotal && lineTotal > 0 && quantity > 0) {
          unitPrice = Math.max(1, Math.round(lineTotal / quantity));
        }

        const match = item.match && typeof item.match === 'object' ? item.match : null;
        const llmProductId = typeof match?.product_id === 'string' ? match.product_id : null;
        const llmConfidence = normalizeConfidence(match?.confidence);
        const llmReason = typeof match?.reason === 'string' ? match.reason.slice(0, 500) : null;
        const resolvedMatch = resolveProductMatch({
          description,
          isPack,
          unitsPerPack: unitsPerPack ?? null,
          llmProductId,
          llmConfidence,
          llmReason,
          products,
        });
        const productId = resolvedMatch?.productId ?? null;
        const confidence = resolvedMatch?.confidence ?? llmConfidence;
        const reason = resolvedMatch?.reason || llmReason;

        const llmSuggested = item.new_product && typeof item.new_product === 'object' ? item.new_product : null;
        const llmRawName = llmSuggested && typeof llmSuggested.name === 'string' ? llmSuggested.name : '';
        const inferredMeasure = inferPrimaryMeasureFromText(description);
        const llmUnit = llmSuggested && typeof llmSuggested.unit === 'string'
          ? mapPrimaryUnit(llmSuggested.unit) || (llmSuggested.unit === 'unit' ? 'unit' : null)
          : null;
        const llmUnitValue = llmSuggested && typeof llmSuggested.unit_value === 'string'
          ? normalizeMeasureValue(llmSuggested.unit_value)
          : '';

        const primaryUnit = llmUnit || inferredMeasure?.unit || null;
        const primaryUnitValue = llmUnitValue || inferredMeasure?.value || null;

        const llmSecondary = llmSuggested && typeof llmSuggested.secondary_unit === 'string'
          ? mapSecondaryUnit(llmSuggested.secondary_unit)
          : null;
        const secondaryUnit = llmSecondary || inferSecondaryUnitFromText(description, isPack, unitsPerPack);
        const secondaryUnitValue = isPack
          ? (typeof llmSuggested?.secondary_unit_value === 'string' && llmSuggested.secondary_unit_value.trim()
            ? normalizeMeasureValue(llmSuggested.secondary_unit_value)
            : (unitsPerPack && unitsPerPack > 0 ? String(unitsPerPack) : null))
          : null;

        const newProduct = {
          name: normalizeProductName(llmRawName, description),
          unit: (primaryUnit || 'unit') as any,
          unit_value: primaryUnit === 'unit' ? null : (primaryUnitValue || null),
          secondary_unit: secondaryUnit as any,
          secondary_unit_value: secondaryUnitValue,
        };

        if (!description || quantity <= 0) return null;

        return {
          description,
          quantity,
          is_pack: isPack,
          units_per_pack: unitsPerPack ?? null,
          bultos: bultos ?? null,
          uxb: uxb ?? null,
          units: units ?? null,
          unit_price_cents: unitPrice ?? null,
          line_total_cents: lineTotal ?? null,
          match: {
            product_id: productId,
            confidence: confidence ?? null,
            reason,
          },
          new_product: newProduct && newProduct.name ? (newProduct as any) : null,
        } as StockReceiptExtractedItem;
      })
      .filter(Boolean) as StockReceiptExtractedItem[];

    let totalCents = normalizeCents(parsed.total_cents ?? null);
    const itemsTotal = normalizedItems.reduce((sum, item) => sum + (item.line_total_cents || 0), 0);
    if ((!totalCents || totalCents <= 0) && itemsTotal > 0) {
      totalCents = itemsTotal;
    }
    const currency = typeof parsed.currency === 'string' && parsed.currency.trim() ? parsed.currency.trim() : 'ARS';
    const issuedAt = normalizeIssuedAt(parsed.issued_at ?? null);
    const vendor = typeof parsed.vendor === 'string' ? parsed.vendor.trim() : null;
    const topConfidence = normalizeConfidence(parsed.confidence);

    return {
      rawText,
      parsed: {
        vendor: vendor || null,
        issued_at: issuedAt,
        currency,
        total_cents: totalCents,
        confidence: topConfidence,
        items: normalizedItems,
      },
    };
  } catch {
    return { parsed: null, rawText };
  }
}
