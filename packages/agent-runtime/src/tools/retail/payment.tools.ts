/**
 * Payment Tools - ENTREGABLE 6
 * Payment management, receipts, and debt tracking
 *
 * Features:
 * - create_mp_payment_link: Generate MercadoPago payment link
 * - process_receipt: Register uploaded payment receipt
 * - apply_receipt_to_order: Apply receipt payment to specific order
 * - apply_payment_to_balance: Apply payment to customer balance (FIFO)
 * - get_customer_balance: Query customer debt/credit status
 * - get_unpaid_orders: List customer's unpaid orders
 */
import Anthropic from '@anthropic-ai/sdk';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { type LedgerService, decrypt } from '@nexova/core';
import type { MercadoPagoIntegrationService } from '@nexova/integrations';
import { getCommercePlanCapabilities, resolveCommercePlan } from '@nexova/shared';

import { ToolCategory, type ToolContext, type ToolResult } from '../../types/index.js';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { resolveOrderReference } from '../../utils/order-reference.js';
import { withVisibleOrders } from '../../utils/orders.js';
import { fetchBinaryWithGuards } from '../../utils/remote-fetch-guard.js';
import { BaseTool } from '../base.js';
import { buildProductDisplayName, extractUnitHints, matchesUnitHints } from './product-utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DEPENDENCIES INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

export interface PaymentToolsDependencies {
  prisma: PrismaClient;
  ledgerService: LedgerService;
  mpService?: MercadoPagoIntegrationService;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface PaymentLinkResult {
  success: boolean;
  paymentId: string;
  paymentUrl: string;
  amount: number;
  expiresAt?: string;
  message: string;
}

interface ProcessReceiptResult {
  success: boolean;
  receiptId: string;
  status: string;
  matchingOrders: Array<{
    orderId: string;
    orderNumber: string;
    pendingAmount: number;
  }>;
  needsOrderSelection: boolean;
  amountRejected?: boolean;
  message: string;
}

interface ApplyReceiptResult {
  success: boolean;
  applied: boolean;
  orderNumber: string;
  orderPaidAmount: number;
  orderPendingAmount: number;
  isFullyPaid: boolean;
  message: string;
}

interface ApplyPaymentResult {
  success: boolean;
  ledgerEntryId: string;
  previousBalance: number;
  newBalance: number;
  ordersSettled: string[];
  message: string;
}

interface CustomerBalanceResult {
  success: boolean;
  currentBalance: number;
  hasDebt: boolean;
  hasCreditBalance: boolean;
  unpaidOrderCount: number;
  oldestUnpaidOrder?: {
    orderNumber: string;
    amount: number;
    daysOld: number;
  };
  recentPayments: Array<{
    amount: number;
    date: string;
    method: string;
  }>;
  formattedMessage: string;
}

interface UnpaidOrdersResult {
  success: boolean;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    total: number;
    paidAmount: number;
    pendingAmount: number;
    createdAt: string;
    daysOld: number;
  }>;
  totalPending: number;
  message: string;
}

interface PaymentStatusResult {
  success: boolean;
  status: string;
  amount: number;
  orderId?: string;
  orderNumber?: string;
  createdAt: string;
  completedAt?: string;
  message: string;
}

interface ExtractReceiptAmountResult {
  success: boolean;
  amountCents?: number;
  confidence?: number;
  extractedText?: string;
  message: string;
}

type OrderImageClassification = 'order_products' | 'payment_receipt' | 'unknown';

type OrderImageMatchType = 'exact' | 'ambiguous' | 'not_found';

interface OrderImageProductCandidate {
  productId: string;
  name: string;
  displayName: string;
  sku: string;
  unit: string | null;
  unitValue: string | null;
  secondaryUnit: string | null;
  secondaryUnitValue: string | null;
  score: number;
}

interface OrderImageMatchedItem {
  description: string;
  quantity: number;
  matchType: OrderImageMatchType;
  matchedProductId?: string;
  matchedProductName?: string;
  clarification?: string;
  candidates?: OrderImageProductCandidate[];
}

interface OcrOrderImageProductsResult {
  success: boolean;
  classification: OrderImageClassification;
  confidence?: number;
  items: OrderImageMatchedItem[];
  message: string;
}

// Helper function to format money
function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const INT32_MAX = 2_147_483_647;

function sanitizeDeclaredAmount(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const rounded = Math.round(value);
  if (rounded > INT32_MAX) return undefined;
  return rounded;
}

function parseAmountToCents(raw: string): number | null {
  let value = raw.trim();
  if (!value) return null;

  if (value.includes('.') && value.includes(',')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    const parts = value.split(',');
    if (parts[1] && parts[1].length === 2) {
      value = `${parts[0].replace(/\./g, '')}.${parts[1]}`;
    } else {
      value = value.replace(/,/g, '');
    }
  } else {
    value = value.replace(/,/g, '');
  }

  const amount = Number(value);
  if (Number.isNaN(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  if (cents <= 0 || cents > INT32_MAX) return null;
  return cents;
}

function buildReceiptPrompt(expectedAmount?: number): string {
  const expected = expectedAmount
    ? `Monto esperado: ${expectedAmount} centavos (ARS).`
    : 'Monto esperado: desconocido.';

  return [
    'Extrae el MONTO TOTAL PAGADO de este comprobante.',
    'Si hay varias cifras, priorizá el total final o el monto más cercano al esperado.',
    'Respondé en centavos (ARS). Ejemplo: si el total es $20.000, respondé 2000000.',
    expected,
    'Respondé SOLO con JSON válido en una sola línea:',
    '{"amount_cents": number | null, "confidence": number (0-1)}',
  ].join('\n');
}

function normalizeAmount(value: unknown, expectedAmount?: number): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    let cents = Math.round(value);
    if (cents <= 0 || cents > INT32_MAX) return undefined;
    if (
      expectedAmount &&
      expectedAmount > 0 &&
      cents < expectedAmount * 0.2 &&
      cents * 100 <= INT32_MAX &&
      Math.abs(cents * 100 - expectedAmount) < Math.abs(cents - expectedAmount)
    ) {
      cents = cents * 100;
    }
    return cents;
  }
  if (typeof value === 'string') {
    const parsed = parseAmountToCents(value);
    if (!parsed) return undefined;
    return normalizeAmount(parsed, expectedAmount);
  }
  return undefined;
}

function inferMediaType(fileRef: string): string {
  const lower = fileRef.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

function shouldAttachInfobipAuth(fileRef: string): boolean {
  try {
    const url = new URL(fileRef);
    const host = url.hostname.toLowerCase();
    return host === 'infobip.com' || host.endsWith('.infobip.com');
  } catch {
    // Relative URLs (/uploads/...) or invalid URLs should not receive auth headers.
    return false;
  }
}

function parseHost(value?: string | null): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedReceiptSource(fileRef: string, configuredApiUrl?: string | null): boolean {
  try {
    const url = new URL(fileRef);
    const protocol = url.protocol.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'http:') return false;

    const host = url.hostname.toLowerCase();
    const configuredHost = parseHost(configuredApiUrl);
    const envHosts = (process.env.RECEIPT_PROXY_ALLOWED_HOSTS || '')
      .split(',')
      .map((entry) => parseHost(entry))
      .filter(Boolean);
    const apiHosts = [
      parseHost(process.env.API_BASE_URL),
      parseHost(process.env.PUBLIC_BASE_URL),
      parseHost(process.env.PUBLIC_API_URL),
      parseHost(process.env.API_PUBLIC_URL),
      parseHost(process.env.BASE_URL),
      parseHost(process.env.API_URL),
      configuredHost,
      ...envHosts,
    ]
      .filter(Boolean) as string[];
    const trustedUploadHosts = new Set(apiHosts);

    if (
      url.pathname.startsWith('/uploads/')
      || url.pathname.startsWith('/api/v1/uploads/file/')
    ) {
      return trustedUploadHosts.has(host);
    }

    if (host === 'infobip.com' || host.endsWith('.infobip.com')) return true;
    return trustedUploadHosts.has(host);
  } catch {
    return false;
  }
}

type WorkspaceProductForImageMatch = {
  id: string;
  name: string;
  sku: string;
  unit: string | null;
  unitValue: string | null;
  secondaryUnit: string | null;
  secondaryUnitValue: string | null;
};

type ExtractedOrderLine = {
  description: string;
  quantity: number;
};

type RankedOrderImageProductCandidate = OrderImageProductCandidate & {
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

function stripAccents(raw: string): string {
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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

  const lines = parts
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
    .filter((line) => line.description.length > 0);

  return lines.slice(0, 30);
}

function buildOrderImagePrompt(caption?: string): string {
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

function normalizeOrderImageClassification(value: unknown, caption?: string): OrderImageClassification {
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

function normalizeExtractedOrderLines(items: unknown, caption?: string): ExtractedOrderLine[] {
  if (!Array.isArray(items)) {
    return splitCaptionIntoItems(caption);
  }

  const parsed = items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const candidate = entry as Record<string, unknown>;
      const descriptionRaw = candidate.description;
      const description = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : '';
      if (!description) return null;
      return {
        description,
        quantity: parsePositiveQuantity(candidate.quantity),
      };
    })
    .filter((line): line is ExtractedOrderLine => line !== null);

  if (parsed.length > 0) return parsed.slice(0, 30);
  return splitCaptionIntoItems(caption);
}

async function extractOrderImageIntentWithClaude(params: {
  buffer: Buffer;
  mediaType: string;
  caption?: string;
}): Promise<{ classification: OrderImageClassification; confidence?: number; items: ExtractedOrderLine[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return {
      classification: normalizeOrderImageClassification(undefined, params.caption),
      items: splitCaptionIntoItems(params.caption),
    };
  }

  const model = process.env.ORDER_IMAGE_OCR_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  const anthropic = new Anthropic({ apiKey });

  const base64 = params.buffer.toString('base64');
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: buildOrderImagePrompt(params.caption) },
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
      classification: normalizeOrderImageClassification(undefined, params.caption),
      items: splitCaptionIntoItems(params.caption),
    };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      classification: normalizeOrderImageClassification(undefined, params.caption),
      items: splitCaptionIntoItems(params.caption),
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      intent?: unknown;
      confidence?: unknown;
      items?: unknown;
    };
    const classification = normalizeOrderImageClassification(parsed.intent, params.caption);
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : undefined;
    const items = normalizeExtractedOrderLines(parsed.items, params.caption);
    return { classification, confidence, items };
  } catch {
    return {
      classification: normalizeOrderImageClassification(undefined, params.caption),
      items: splitCaptionIntoItems(params.caption),
    };
  }
}

function rankOrderImageCandidates(
  item: ExtractedOrderLine,
  products: WorkspaceProductForImageMatch[]
): RankedOrderImageProductCandidate[] {
  const descriptionTokens = tokenizeForProductMatch(item.description);
  const unitHints = extractUnitHints(item.description);

  const ranked = products
    .map((product) => {
      const productTokens = tokenizeForProductMatch(`${product.name} ${product.sku || ''}`);
      let score = computeTokenSimilarity(descriptionTokens, productTokens);
      if (descriptionTokens[0] && productTokens[0] && descriptionTokens[0] === productTokens[0]) {
        score += 0.08;
      }

      const unitMatched = unitHints.length > 0
        ? matchesUnitHints(product, unitHints)
        : false;

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
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 5);
}

function buildOrderImageMatch(item: ExtractedOrderLine, products: WorkspaceProductForImageMatch[]): OrderImageMatchedItem {
  const candidates = rankOrderImageCandidates(item, products);
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

async function extractReceiptAmountWithClaude(params: {
  buffer: Buffer;
  mediaType: string;
  expectedAmount?: number;
}): Promise<{ amountCents?: number; confidence?: number; extractedText?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return {};

  const model = process.env.RECEIPT_OCR_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  const anthropic = new Anthropic({ apiKey });

  const base64 = params.buffer.toString('base64');
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: buildReceiptPrompt(params.expectedAmount) },
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
    max_tokens: 200,
    temperature: 0,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const rawText = textBlock?.text?.trim() || '';
  if (!rawText) return {};

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { extractedText: rawText };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { amount_cents?: unknown; confidence?: unknown };
    const amount = normalizeAmount(parsed.amount_cents, params.expectedAmount);
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : undefined;

    return {
      amountCents: amount,
      confidence,
      extractedText: rawText,
    };
  } catch {
    return { extractedText: rawText };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE MP PAYMENT LINK
// ═══════════════════════════════════════════════════════════════════════════════

const CreateMPPaymentLinkInput = z.object({
  orderId: z
    .string()
    .uuid()
    .optional()
    .describe('ID de la orden a pagar. Si no se especifica, es pago a cuenta.'),
  orderNumber: z
    .string()
    .optional()
    .describe('Número de la orden a pagar (ej: ORD-00005 o 5).'),
  amount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Monto en centavos. Requerido si no hay orderId.'),
  description: z
    .string()
    .max(200)
    .optional()
    .describe('Descripción del pago'),
});

export class CreateMPPaymentLinkTool extends BaseTool<typeof CreateMPPaymentLinkInput> {
  private prisma: PrismaClient;
  private mpService: MercadoPagoIntegrationService;

  constructor(prisma: PrismaClient, mpService: MercadoPagoIntegrationService) {
    super({
      name: 'create_mp_payment_link',
      description:
        'Genera un link de pago de MercadoPago para una orden o pago a cuenta. El cliente puede pagar con tarjeta, transferencia o efectivo.',
      category: ToolCategory.MUTATION,
      inputSchema: CreateMPPaymentLinkInput,
    });
    this.prisma = prisma;
    this.mpService = mpService;
  }

  async execute(
    input: z.infer<typeof CreateMPPaymentLinkInput>,
    context: ToolContext
  ): Promise<ToolResult<PaymentLinkResult>> {
    const { orderId, orderNumber, amount, description } = input;
    const workspacePlan = await this.prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: {
        plan: true,
        settings: true,
        subscription: {
          select: {
            plan: true,
            status: true,
          },
        },
      },
    });
    const workspaceSettings = (workspacePlan?.settings as Record<string, unknown> | undefined) || {};
    const subscriptionStatus = (workspacePlan?.subscription?.status || '').toLowerCase();
    const subscriptionPlan =
      workspacePlan?.subscription?.plan && ['active', 'trialing', 'past_due', 'paid'].includes(subscriptionStatus)
        ? workspacePlan.subscription.plan
        : undefined;
    const plan = resolveCommercePlan({
      workspacePlan: subscriptionPlan || workspacePlan?.plan,
      settingsPlan: workspaceSettings.commercePlan,
      fallback: 'pro',
    });
    if (!getCommercePlanCapabilities(plan).showMercadoPagoIntegration) {
      return {
        success: false,
        error: 'Tu plan actual no incluye links de pago',
      };
    }

    if (!orderId && !orderNumber && !amount) {
      return {
        success: false,
        error: 'Necesito el ID/número de la orden o el monto a pagar',
      };
    }

    let paymentAmount = amount;
    let paymentDescription = description || 'Pago a cuenta';
    let resolvedOrderNumber: string | undefined;
    let resolvedOrderId: string | undefined;

    if (orderId || orderNumber) {
      const resolved = await resolveOrderReference({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        customerId: context.customerId,
        orderId,
        orderNumber,
        includeTrashed: false,
        requireNotDeleted: false,
      });
      if (resolved && 'ambiguous' in resolved) {
        return {
          success: false,
          error: `Hay más de un pedido que coincide: ${resolved.matches.join(', ')}`,
        };
      }
      if (!resolved) {
        return {
          success: false,
          error: 'No encontré esa orden',
        };
      }

      resolvedOrderId = resolved.id;

      const order = await this.prisma.order.findFirst({
        where: withVisibleOrders({
          id: resolved.id,
          workspaceId: context.workspaceId,
          customerId: context.customerId,
        }),
        select: {
          id: true,
          orderNumber: true,
          total: true,
          paidAmount: true,
        },
      });

      if (!order) {
        return {
          success: false,
          error: 'No encontré esa orden',
        };
      }

      const pendingAmount = order.total - order.paidAmount;
      if (pendingAmount <= 0) {
        return {
          success: false,
          error: `El pedido #${order.orderNumber} ya está pagado`,
        };
      }

      paymentAmount = amount || pendingAmount;
      paymentDescription = description || `Pago pedido #${order.orderNumber}`;
      resolvedOrderNumber = order.orderNumber;
    }

    const externalReference = `${context.workspaceId}:${resolvedOrderId || 'account'}:${Date.now()}`;

    try {
      const result = await this.mpService.createPaymentLink(context.workspaceId, {
        amount: paymentAmount!,
        description: paymentDescription,
        externalReference,
        payerEmail: undefined,
        notificationUrl: `${process.env.API_BASE_URL}/api/v1/integrations/webhooks/mercadopago/${context.workspaceId}`,
        expirationMinutes: 60,
        metadata: {
          workspaceId: context.workspaceId,
          customerId: context.customerId,
          orderId: resolvedOrderId,
          sessionId: context.sessionId,
        },
      });

      if (resolvedOrderId) {
        await this.prisma.payment.create({
          data: {
            orderId: resolvedOrderId,
            provider: 'mercadopago',
            externalId: result.preferenceId,
            status: 'pending',
            amount: paymentAmount!,
            currency: 'ARS',
            paymentUrl: result.paymentUrl,
            providerData: {
              preferenceId: result.preferenceId,
              externalReference,
            },
          },
        });
      }

      const formattedAmount = formatMoney(paymentAmount!);
      const message = resolvedOrderNumber
        ? `Acá tenés el link de pago por $${formattedAmount} para el pedido #${resolvedOrderNumber}: ${result.paymentUrl}`
        : `Acá tenés el link de pago por $${formattedAmount}: ${result.paymentUrl}`;

      return {
        success: true,
        data: {
          success: true,
          paymentId: result.paymentId,
          paymentUrl: result.paymentUrl,
          amount: paymentAmount!,
          expiresAt: result.expiresAt?.toISOString(),
          message,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No pude generar el link de pago',
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS RECEIPT
// ═══════════════════════════════════════════════════════════════════════════════

const ExtractReceiptAmountInput = z.object({
  fileRef: z.string().describe('Referencia al archivo subido (de WhatsApp)'),
  fileType: z.enum(['image', 'pdf']).default('image').describe('Tipo de archivo'),
  expectedAmount: z.number().int().positive().optional().describe('Monto esperado en centavos'),
});

export class ExtractReceiptAmountTool extends BaseTool<typeof ExtractReceiptAmountInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'extract_receipt_amount',
      description: 'Extrae el monto del comprobante usando OCR.',
      category: ToolCategory.QUERY,
      inputSchema: ExtractReceiptAmountInput,
    });
    this.prisma = prisma;
  }

  private resolveWhatsAppApiKey(number: {
    apiKeyEnc?: string | null;
    apiKeyIv?: string | null;
    provider?: string | null;
  }): string {
    const provider = (number.provider || 'infobip').toLowerCase();
    if (provider === 'infobip') {
      const envKey = (process.env.INFOBIP_API_KEY || '').trim();
      if (envKey) return envKey;
      if (number.apiKeyEnc && number.apiKeyIv) {
        return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
      }
      return '';
    }
    if (number.apiKeyEnc && number.apiKeyIv) {
      return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
    }
    return '';
  }

  private async fetchReceiptBuffer(
    fileRef: string,
    expectedFileType: 'image' | 'pdf',
    apiKey?: string,
    configuredApiUrl?: string | null
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    if (!isAllowedReceiptSource(fileRef, configuredApiUrl)) {
      throw new Error('No pude descargar el comprobante: host no permitido');
    }

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `App ${apiKey}`;
    }

    const allowedContentTypes = expectedFileType === 'pdf'
      ? ['application/pdf']
      : ['image/*'];

    const { buffer, contentType } = await fetchBinaryWithGuards({
      url: fileRef,
      headers,
      isAllowedHost: (host) => isAllowedReceiptSource(`https://${host}/`, configuredApiUrl),
      allowedContentTypes,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 15000,
    });

    return { buffer, contentType };
  }

  async execute(
    input: z.infer<typeof ExtractReceiptAmountInput>,
    context: ToolContext
  ): Promise<ToolResult<ExtractReceiptAmountResult>> {
    const { fileRef, fileType, expectedAmount } = input;

    const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
      where: { workspaceId: context.workspaceId, isActive: true },
      select: { apiKeyEnc: true, apiKeyIv: true, provider: true, apiUrl: true },
    });

    const wantsInfobipAuth = shouldAttachInfobipAuth(fileRef);
    const apiKey = wantsInfobipAuth
      ? ((whatsappNumber ? this.resolveWhatsAppApiKey(whatsappNumber) : '')
        || process.env.INFOBIP_API_KEY
        || '')
      : '';

    try {
      const { buffer, contentType } = await this.fetchReceiptBuffer(
        fileRef,
        fileType,
        apiKey,
        whatsappNumber?.apiUrl
      );

      const resolvedContentType = contentType
        || (fileType === 'pdf' ? 'application/pdf' : inferMediaType(fileRef));

      const extracted = await extractReceiptAmountWithClaude({
        buffer,
        mediaType: resolvedContentType,
        expectedAmount,
      });

      if (!extracted.amountCents) {
        return {
          success: true,
          data: {
            success: false,
            extractedText: extracted.extractedText,
            message: 'No pude detectar el monto en el comprobante.',
          },
        };
      }

      return {
        success: true,
        data: {
          success: true,
          amountCents: extracted.amountCents,
          confidence: extracted.confidence,
          extractedText: extracted.extractedText,
          message: 'Monto detectado correctamente.',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No pude analizar el comprobante',
      };
    }
  }
}

const OcrOrderImageProductsInput = z.object({
  fileRef: z.string().describe('Referencia al archivo subido (de WhatsApp)'),
  fileType: z.enum(['image', 'pdf']).default('image').describe('Tipo de archivo'),
  caption: z.string().optional().describe('Texto/caption asociado al archivo'),
});

export class OcrOrderImageProductsTool extends BaseTool<typeof OcrOrderImageProductsInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'ocr_order_image_products',
      description:
        'Analiza una imagen/PDF enviada por cliente para detectar si es pedido de productos o comprobante de pago, y matchear productos con stock.',
      category: ToolCategory.QUERY,
      inputSchema: OcrOrderImageProductsInput,
    });
    this.prisma = prisma;
  }

  private resolveWhatsAppApiKey(number: {
    apiKeyEnc?: string | null;
    apiKeyIv?: string | null;
    provider?: string | null;
  }): string {
    const provider = (number.provider || 'infobip').toLowerCase();
    if (provider === 'infobip') {
      const envKey = (process.env.INFOBIP_API_KEY || '').trim();
      if (envKey) return envKey;
      if (number.apiKeyEnc && number.apiKeyIv) {
        return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
      }
      return '';
    }
    if (number.apiKeyEnc && number.apiKeyIv) {
      return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
    }
    return '';
  }

  private async fetchMediaBuffer(
    fileRef: string,
    expectedFileType: 'image' | 'pdf',
    apiKey?: string,
    configuredApiUrl?: string | null
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    if (!isAllowedReceiptSource(fileRef, configuredApiUrl)) {
      throw new Error('No pude descargar el archivo: host no permitido');
    }

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `App ${apiKey}`;
    }

    const allowedContentTypes = expectedFileType === 'pdf'
      ? ['application/pdf']
      : ['image/*'];

    const { buffer, contentType } = await fetchBinaryWithGuards({
      url: fileRef,
      headers,
      isAllowedHost: (host) => isAllowedReceiptSource(`https://${host}/`, configuredApiUrl),
      allowedContentTypes,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 15000,
    });

    return { buffer, contentType };
  }

  async execute(
    input: z.infer<typeof OcrOrderImageProductsInput>,
    context: ToolContext
  ): Promise<ToolResult<OcrOrderImageProductsResult>> {
    const workspacePlan = await this.prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: {
        plan: true,
        settings: true,
        subscription: {
          select: {
            plan: true,
            status: true,
          },
        },
      },
    });
    const workspaceSettings = (workspacePlan?.settings as Record<string, unknown> | undefined) || {};
    const subscriptionStatus = (workspacePlan?.subscription?.status || '').toLowerCase();
    const subscriptionPlan =
      workspacePlan?.subscription?.plan && ['active', 'trialing', 'past_due', 'paid'].includes(subscriptionStatus)
        ? workspacePlan.subscription.plan
        : undefined;
    const plan = resolveCommercePlan({
      workspacePlan: subscriptionPlan || workspacePlan?.plan,
      settingsPlan: workspaceSettings.commercePlan,
      fallback: 'pro',
    });
    if (!getCommercePlanCapabilities(plan).showWhatsappOrderImageOcr) {
      return {
        success: false,
        error: 'Tu plan actual no incluye pedidos por imagen',
      };
    }

    const { fileRef, fileType, caption } = input;

    const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
      where: { workspaceId: context.workspaceId, isActive: true },
      select: { apiKeyEnc: true, apiKeyIv: true, provider: true, apiUrl: true },
    });

    const wantsInfobipAuth = shouldAttachInfobipAuth(fileRef);
    const apiKey = wantsInfobipAuth
      ? ((whatsappNumber ? this.resolveWhatsAppApiKey(whatsappNumber) : '')
        || process.env.INFOBIP_API_KEY
        || '')
      : '';

    try {
      const { buffer, contentType } = await this.fetchMediaBuffer(
        fileRef,
        fileType,
        apiKey,
        whatsappNumber?.apiUrl
      );

      const resolvedContentType = contentType
        || (fileType === 'pdf' ? 'application/pdf' : inferMediaType(fileRef));

      const ocr = await extractOrderImageIntentWithClaude({
        buffer,
        mediaType: resolvedContentType,
        caption,
      });

      if (ocr.classification === 'payment_receipt') {
        return {
          success: true,
          data: {
            success: true,
            classification: 'payment_receipt',
            confidence: ocr.confidence,
            items: [],
            message: 'Detecté que el archivo parece un comprobante de pago.',
          },
        };
      }

      if (ocr.classification !== 'order_products') {
        return {
          success: true,
          data: {
            success: true,
            classification: 'unknown',
            confidence: ocr.confidence,
            items: [],
            message: 'No pude identificar productos con claridad en la imagen.',
          },
        };
      }

      const products = await this.prisma.product.findMany({
        where: {
          workspaceId: context.workspaceId,
          status: 'active',
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          unitValue: true,
          secondaryUnit: true,
          secondaryUnitValue: true,
        },
        take: 500,
      });

      const matches = ocr.items.map((item) => buildOrderImageMatch(item, products));
      const exactCount = matches.filter((m) => m.matchType === 'exact').length;
      const ambiguousCount = matches.filter((m) => m.matchType === 'ambiguous').length;
      const notFoundCount = matches.filter((m) => m.matchType === 'not_found').length;

      const message =
        matches.length === 0
          ? 'No encontré líneas de productos para procesar.'
          : ambiguousCount > 0 || notFoundCount > 0
            ? `Detecté ${matches.length} item(s): ${exactCount} claros, ${ambiguousCount} ambiguos y ${notFoundCount} sin match.`
            : `Detecté ${exactCount} item(s) de producto listos para agregar al pedido.`;

      return {
        success: true,
        data: {
          success: true,
          classification: 'order_products',
          confidence: ocr.confidence,
          items: matches,
          message,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No pude analizar la imagen',
      };
    }
  }
}

const ProcessReceiptInput = z.object({
  fileRef: z.string().describe('Referencia al archivo subido (de WhatsApp)'),
  fileType: z.enum(['image', 'pdf']).default('image').describe('Tipo de archivo'),
  orderId: z.string().uuid().optional().describe('ID de la orden asociada'),
  paymentMethod: z
    .enum(['transfer', 'link', 'cash'])
    .optional()
    .describe('Método de pago reportado por el cliente'),
  declaredAmount: z.number().int().positive().optional().describe('Monto declarado por el cliente en centavos'),
  declaredDate: z.string().optional().describe('Fecha del pago según cliente'),
  extractedAmount: z.number().int().positive().optional().describe('Monto detectado automáticamente'),
  extractedConfidence: z.number().min(0).max(1).optional().describe('Confianza del OCR'),
  extractedText: z.string().optional().describe('Texto crudo detectado por OCR'),
});

export class ProcessReceiptTool extends BaseTool<typeof ProcessReceiptInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'process_receipt',
      description: 'Registra un comprobante de pago enviado por el cliente (transferencia, depósito).',
      category: ToolCategory.MUTATION,
      inputSchema: ProcessReceiptInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof ProcessReceiptInput>,
    context: ToolContext
  ): Promise<ToolResult<ProcessReceiptResult>> {
    const {
      fileRef,
      fileType,
      declaredAmount,
      declaredDate,
      orderId,
      paymentMethod,
      extractedAmount,
      extractedConfidence,
      extractedText,
    } = input;
    const safeDeclaredAmount = sanitizeDeclaredAmount(declaredAmount);
    const safeExtractedAmount = sanitizeDeclaredAmount(extractedAmount);
    const safeConfidence =
      typeof extractedConfidence === 'number' && Number.isFinite(extractedConfidence)
        ? Math.max(0, Math.min(1, extractedConfidence))
        : undefined;

    const receipt = await this.prisma.receipt.create({
      data: {
        workspaceId: context.workspaceId,
        customerId: context.customerId,
        sessionId: context.sessionId,
        fileRef,
        fileType,
        declaredAmount: safeDeclaredAmount,
        declaredDate: declaredDate ? new Date(declaredDate) : undefined,
        extractedAmount: safeExtractedAmount,
        extractedConfidence: safeConfidence,
        extractedRawText: extractedText,
        orderId,
        paymentMethod,
        status: 'pending_review',
      },
    });

    try {
      await createNotificationIfEnabled(this.prisma, {
        workspaceId: context.workspaceId,
        type: 'receipt.new',
        title: 'Nuevo comprobante',
        message: 'Comprobante recibido por WhatsApp',
        entityType: 'Receipt',
        entityId: receipt.id,
        metadata: {
          orderId,
          customerId: context.customerId,
          sessionId: context.sessionId,
          paymentMethod,
        },
      });
    } catch (error) {
      console.error('[ProcessReceipt] Failed to create notification:', error);
    }

    const unpaidOrders = await this.prisma.order.findMany({
      where: withVisibleOrders({
        workspaceId: context.workspaceId,
        customerId: context.customerId,
        status: { notIn: ['cancelled', 'draft', 'returned', 'trashed'] },
        paidAt: null,
      }),
      orderBy: { createdAt: 'asc' },
      select: { id: true, orderNumber: true, total: true, paidAmount: true },
    });

    const matchingOrders = unpaidOrders
      .filter((order) => order.total > order.paidAmount)
      .map((order) => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        pendingAmount: order.total - order.paidAmount,
      }));

    const orderMatch = orderId
      ? matchingOrders.find((order) => order.orderId === orderId) ?? null
      : null;
    const effectiveMatchingOrders = orderMatch ? [orderMatch] : matchingOrders;

    const needsOrderSelection = effectiveMatchingOrders.length !== 1;
    const needsAmount = !safeDeclaredAmount;

    let message: string;
    if (needsAmount) {
      message = 'Recibí tu comprobante. ¿De cuánto es el pago?';
    } else if (needsOrderSelection && effectiveMatchingOrders.length > 1) {
      const orderList = effectiveMatchingOrders
        .map((o) => `• Pedido #${o.orderNumber}: $${formatMoney(o.pendingAmount)} pendiente`)
        .join('\n');
      message = `Recibí tu comprobante por $${formatMoney(safeDeclaredAmount || 0)}. Tenés ${effectiveMatchingOrders.length} pedidos pendientes:\n${orderList}\n¿A cuál lo aplico?`;
    } else if (effectiveMatchingOrders.length === 1) {
      message = `Recibí tu comprobante. ¿Confirmo el pago de $${formatMoney(safeDeclaredAmount || 0)} para el pedido #${effectiveMatchingOrders[0].orderNumber}?`;
    } else {
      message = `Recibí tu comprobante por $${formatMoney(safeDeclaredAmount || 0)}. No tenés pedidos pendientes, ¿lo aplico como pago a cuenta?`;
    }

    return {
      success: true,
      data: {
        success: true,
        receiptId: receipt.id,
        status: receipt.status,
        matchingOrders: effectiveMatchingOrders,
        needsOrderSelection,
        ...(safeDeclaredAmount ? {} : { amountRejected: true }),
        message,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE RECEIPT AMOUNT
// ═══════════════════════════════════════════════════════════════════════════════

const UpdateReceiptAmountInput = z.object({
  receiptId: z.string().uuid().describe('ID del comprobante a actualizar'),
  declaredAmount: z.number().int().positive().describe('Monto declarado por el cliente en centavos'),
  declaredDate: z.string().optional().describe('Fecha del pago según cliente'),
});

export class UpdateReceiptAmountTool extends BaseTool<typeof UpdateReceiptAmountInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'update_receipt_amount',
      description: 'Actualiza el monto declarado en un comprobante pendiente.',
      category: ToolCategory.MUTATION,
      inputSchema: UpdateReceiptAmountInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof UpdateReceiptAmountInput>,
    context: ToolContext
  ): Promise<ToolResult<{ success: boolean; receiptId: string }>> {
    const { receiptId, declaredAmount, declaredDate } = input;
    const safeDeclaredAmount = sanitizeDeclaredAmount(declaredAmount);

    if (!safeDeclaredAmount) {
      return { success: false, error: 'El monto declarado no es válido.' };
    }

    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, workspaceId: context.workspaceId, customerId: context.customerId },
    });

    if (!receipt) {
      return { success: false, error: 'No encontré ese comprobante.' };
    }

    if (receipt.status === 'applied') {
      return { success: false, error: 'Ese comprobante ya fue aplicado.' };
    }

    if (receipt.status === 'rejected') {
      return { success: false, error: 'Ese comprobante fue rechazado.' };
    }

    await this.prisma.receipt.updateMany({
      where: { id: receiptId, workspaceId: context.workspaceId },
      data: {
        declaredAmount: safeDeclaredAmount,
        declaredDate: declaredDate ? new Date(declaredDate) : receipt.declaredDate,
      },
    });

    return {
      success: true,
      data: {
        success: true,
        receiptId,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLY RECEIPT TO ORDER
// ═══════════════════════════════════════════════════════════════════════════════

const ApplyReceiptToOrderInput = z
  .object({
    receiptId: z.string().uuid().describe('ID del comprobante a aplicar'),
    orderId: z.string().uuid().optional().describe('ID de la orden destino'),
    orderNumber: z.string().optional().describe('Número de la orden destino (ej: ORD-00005 o 5)'),
    amount: z.number().int().positive().describe('Monto a aplicar en centavos'),
  })
  .refine((data) => data.orderId || data.orderNumber, {
    message: 'Debe proporcionar orderId u orderNumber',
  });

export class ApplyReceiptToOrderTool extends BaseTool<typeof ApplyReceiptToOrderInput> {
  private prisma: PrismaClient;
  private ledgerService: LedgerService;

  constructor(prisma: PrismaClient, ledgerService: LedgerService) {
    super({
      name: 'apply_receipt_to_order',
      description: 'Aplica un comprobante de pago a una orden específica.',
      category: ToolCategory.MUTATION,
      inputSchema: ApplyReceiptToOrderInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
    this.ledgerService = ledgerService;
  }

  async execute(
    input: z.infer<typeof ApplyReceiptToOrderInput>,
    context: ToolContext
  ): Promise<ToolResult<ApplyReceiptResult>> {
    const { receiptId, orderId, orderNumber, amount } = input;

    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, workspaceId: context.workspaceId, customerId: context.customerId },
    });

    if (!receipt) {
      return { success: false, error: 'No encontré ese comprobante' };
    }

    if (receipt.status === 'applied') {
      return { success: false, error: 'Ese comprobante ya fue aplicado' };
    }

    if (receipt.status === 'rejected') {
      return { success: false, error: 'Ese comprobante fue rechazado' };
    }

    const resolvedOrder = await resolveOrderReference({
      prisma: this.prisma,
      workspaceId: context.workspaceId,
      customerId: context.customerId,
      orderId,
      orderNumber,
      includeTrashed: false,
      requireNotDeleted: false,
    });
    if (resolvedOrder && 'ambiguous' in resolvedOrder) {
      return {
        success: false,
        error: `Hay más de un pedido que coincide: ${resolvedOrder.matches.join(', ')}`,
      };
    }
    if (!resolvedOrder) {
      return { success: false, error: 'No encontré esa orden' };
    }

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders({
        id: resolvedOrder.id,
        workspaceId: context.workspaceId,
        customerId: context.customerId,
      }),
      select: { id: true, orderNumber: true, total: true, paidAmount: true, currency: true },
    });

    if (!order) {
      return { success: false, error: 'No encontré esa orden' };
    }

    const result = await this.ledgerService.applyPaymentToOrder(
      context.workspaceId,
      context.customerId,
      resolvedOrder.id,
      amount,
      'Receipt',
      receiptId,
      'agent'
    );

    await this.prisma.receipt.updateMany({
      where: { id: receiptId, workspaceId: context.workspaceId },
      data: {
        status: 'applied',
        appliedAmount: amount,
        orderId: resolvedOrder.id,
        appliedAt: new Date(),
        appliedBy: 'agent',
      },
    });

    await this.prisma.payment.create({
      data: {
        orderId: resolvedOrder.id,
        provider: 'receipt',
        externalId: receiptId,
        method: receipt.paymentMethod || 'transfer',
        status: 'completed',
        amount,
        currency: order.currency || 'ARS',
        netAmount: amount,
        completedAt: new Date(),
        providerData: {
          receiptId,
        },
      },
    });

    const settlement = result.ordersSettled[0];
    const message = settlement.isFullyPaid
      ? `¡Listo! Apliqué $${formatMoney(amount)} al pedido #${settlement.orderNumber}. ¡Ya está completamente pago!`
      : `Apliqué $${formatMoney(amount)} al pedido #${settlement.orderNumber}. Queda pendiente: $${formatMoney(order.total - settlement.newPaidAmount)}`;

    return {
      success: true,
      data: {
        success: true,
        applied: true,
        orderNumber: settlement.orderNumber,
        orderPaidAmount: settlement.newPaidAmount,
        orderPendingAmount: order.total - settlement.newPaidAmount,
        isFullyPaid: settlement.isFullyPaid,
        message,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLY PAYMENT TO BALANCE
// ═══════════════════════════════════════════════════════════════════════════════

const ApplyPaymentToBalanceInput = z.object({
  receiptId: z.string().uuid().optional().describe('ID del comprobante (si aplica)'),
  amount: z.number().int().positive().describe('Monto a acreditar en centavos'),
  description: z.string().max(200).describe('Descripción del pago'),
});

export class ApplyPaymentToBalanceTool extends BaseTool<typeof ApplyPaymentToBalanceInput> {
  private prisma: PrismaClient;
  private ledgerService: LedgerService;

  constructor(prisma: PrismaClient, ledgerService: LedgerService) {
    super({
      name: 'apply_payment_to_balance',
      description: 'Aplica un pago al balance del cliente usando estrategia FIFO.',
      category: ToolCategory.MUTATION,
      inputSchema: ApplyPaymentToBalanceInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
    this.ledgerService = ledgerService;
  }

  async execute(
    input: z.infer<typeof ApplyPaymentToBalanceInput>,
    context: ToolContext
  ): Promise<ToolResult<ApplyPaymentResult>> {
    const { receiptId, amount, description } = input;

    const result = await this.ledgerService.applyPayment({
      workspaceId: context.workspaceId,
      customerId: context.customerId,
      amount,
      referenceType: receiptId ? 'Receipt' : 'Payment',
      referenceId: receiptId || crypto.randomUUID(),
      description,
      createdBy: 'agent',
    });

    if (receiptId) {
      await this.prisma.receipt.updateMany({
        where: { id: receiptId, workspaceId: context.workspaceId },
        data: {
          status: 'applied',
          appliedAmount: amount,
          appliedAt: new Date(),
          appliedBy: 'agent',
        },
      });
    }

    const settledOrders = result.ordersSettled.map((o) => o.orderNumber);
    let message: string;

    if (result.newBalance <= 0 && result.previousBalance > 0) {
      message = `¡Excelente! Registré el pago de $${formatMoney(amount)}. ¡Ya no tenés deuda!`;
    } else if (settledOrders.length > 0) {
      const ordersText = settledOrders.length === 1
        ? `el pedido #${settledOrders[0]}`
        : `los pedidos ${settledOrders.map((o) => `#${o}`).join(', ')}`;
      message = `Registré el pago de $${formatMoney(amount)} y quedó saldado ${ordersText}.`;
      if (result.newBalance > 0) {
        message += ` Saldo pendiente: $${formatMoney(result.newBalance)}`;
      }
    } else {
      message = `Registré el pago de $${formatMoney(amount)} a tu cuenta.`;
      if (result.newBalance < 0) {
        message += ` Tenés $${formatMoney(Math.abs(result.newBalance))} a favor.`;
      }
    }

    return {
      success: true,
      data: {
        success: true,
        ledgerEntryId: result.ledgerEntryId,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        ordersSettled: settledOrders,
        message,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET CUSTOMER BALANCE
// ═══════════════════════════════════════════════════════════════════════════════

const GetCustomerBalanceInput = z.object({});

export class GetCustomerBalanceTool extends BaseTool<typeof GetCustomerBalanceInput> {
  private ledgerService: LedgerService;

  constructor(ledgerService: LedgerService) {
    super({
      name: 'get_customer_balance',
      description: 'Consulta el saldo actual del cliente: deuda, saldo a favor, órdenes pendientes.',
      category: ToolCategory.QUERY,
      inputSchema: GetCustomerBalanceInput,
    });
    this.ledgerService = ledgerService;
  }

  async execute(
    _input: z.infer<typeof GetCustomerBalanceInput>,
    context: ToolContext
  ): Promise<ToolResult<CustomerBalanceResult>> {
    const summary = await this.ledgerService.getCustomerDebtSummary(
      context.workspaceId,
      context.customerId
    );

    const oldestOrder = summary.unpaidOrders[0];

    return {
      success: true,
      data: {
        success: true,
        currentBalance: summary.currentBalance,
        hasDebt: summary.hasDebt,
        hasCreditBalance: summary.hasCreditBalance,
        unpaidOrderCount: summary.unpaidOrders.length,
        oldestUnpaidOrder: oldestOrder
          ? { orderNumber: oldestOrder.orderNumber, amount: oldestOrder.pendingAmount, daysOld: oldestOrder.daysOld }
          : undefined,
        recentPayments: summary.recentPayments.map((p) => ({
          amount: p.amount,
          date: p.createdAt.toISOString(),
          method: p.method,
        })),
        formattedMessage: summary.formattedMessage,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET UNPAID ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

const GetUnpaidOrdersInput = z.object({});

export class GetUnpaidOrdersTool extends BaseTool<typeof GetUnpaidOrdersInput> {
  private ledgerService: LedgerService;

  constructor(ledgerService: LedgerService) {
    super({
      name: 'get_unpaid_orders',
      description: 'Lista las órdenes impagas del cliente, ordenadas por antigüedad.',
      category: ToolCategory.QUERY,
      inputSchema: GetUnpaidOrdersInput,
    });
    this.ledgerService = ledgerService;
  }

  async execute(
    _input: z.infer<typeof GetUnpaidOrdersInput>,
    context: ToolContext
  ): Promise<ToolResult<UnpaidOrdersResult>> {
    const unpaidOrders = await this.ledgerService.getUnpaidOrders(
      context.workspaceId,
      context.customerId
    );

    const totalPending = unpaidOrders.reduce((sum, o) => sum + o.pendingAmount, 0);

    let message: string;
    if (unpaidOrders.length === 0) {
      message = 'No tenés pedidos pendientes de pago.';
    } else if (unpaidOrders.length === 1) {
      const order = unpaidOrders[0];
      message = `Tenés 1 pedido pendiente: #${order.orderNumber} por $${formatMoney(order.pendingAmount)}`;
    } else {
      message = `Tenés ${unpaidOrders.length} pedidos pendientes por un total de $${formatMoney(totalPending)}`;
    }

    return {
      success: true,
      data: {
        success: true,
        orders: unpaidOrders.map((o) => ({
          orderId: o.orderId,
          orderNumber: o.orderNumber,
          total: o.total,
          paidAmount: o.paidAmount,
          pendingAmount: o.pendingAmount,
          createdAt: o.createdAt.toISOString(),
          daysOld: o.daysOld,
        })),
        totalPending,
        message,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET PAYMENT STATUS
// ═══════════════════════════════════════════════════════════════════════════════

const GetPaymentStatusInput = z.object({
  paymentId: z.string().describe('ID del pago a consultar'),
});

export class GetPaymentStatusTool extends BaseTool<typeof GetPaymentStatusInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_payment_status',
      description: 'Consulta el estado de un pago pendiente.',
      category: ToolCategory.QUERY,
      inputSchema: GetPaymentStatusInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof GetPaymentStatusInput>,
    context: ToolContext
  ): Promise<ToolResult<PaymentStatusResult>> {
    const { paymentId } = input;

    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [{ id: paymentId }, { externalId: paymentId }],
        order: { workspaceId: context.workspaceId },
      },
      include: { order: { select: { orderNumber: true } } },
    });

    if (!payment) {
      return { success: false, error: 'No encontré ese pago' };
    }

    const statusMessages: Record<string, string> = {
      pending: 'El pago está pendiente',
      processing: 'El pago se está procesando',
      completed: 'El pago fue confirmado',
      failed: 'El pago falló',
      cancelled: 'El pago fue cancelado',
      refunded: 'El pago fue reembolsado',
    };

    return {
      success: true,
      data: {
        success: true,
        status: payment.status,
        amount: payment.amount,
        orderId: payment.orderId,
        orderNumber: payment.order?.orderNumber,
        createdAt: payment.createdAt.toISOString(),
        completedAt: payment.completedAt?.toISOString(),
        message: statusMessages[payment.status] || `Estado del pago: ${payment.status}`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create all payment tools
 */
export function createPaymentTools(
  deps: PaymentToolsDependencies
): Array<BaseTool<z.ZodSchema, unknown>> {
  const { prisma, ledgerService, mpService } = deps;

  const tools: Array<BaseTool<z.ZodSchema, unknown>> = [
    new OcrOrderImageProductsTool(prisma),
    new ExtractReceiptAmountTool(prisma),
    new ProcessReceiptTool(prisma),
    new UpdateReceiptAmountTool(prisma),
    new ApplyReceiptToOrderTool(prisma, ledgerService),
    new ApplyPaymentToBalanceTool(prisma, ledgerService),
    new GetCustomerBalanceTool(ledgerService),
    new GetUnpaidOrdersTool(ledgerService),
    new GetPaymentStatusTool(prisma),
  ];

  if (mpService) {
    tools.unshift(new CreateMPPaymentLinkTool(prisma, mpService));
  }

  return tools;
}
