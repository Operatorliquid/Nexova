import type { Prisma, PrismaClient, StockPurchaseReceipt, StockPurchaseReceiptItem } from '@prisma/client';
import { randomUUID } from 'crypto';

export type StockPurchaseReceiptStatus = 'draft' | 'applied';

export interface StockPurchaseReceiptProductSuggestion {
  name: string;
  unit?: 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm' | null;
  unitValue?: string | null;
  secondaryUnit?: 'pack' | 'box' | 'bundle' | 'dozen' | null;
  secondaryUnitValue?: string | null;
}

export interface CreateDraftStockPurchaseReceiptItemInput {
  rawDescription: string;
  quantity: number;
  isPack?: boolean;
  unitsPerPack?: number | null;
  matchedProductId?: string | null;
  matchConfidence?: number | null;
  unitPriceCents?: number | null;
  lineTotalCents?: number | null;
  suggestedProduct?: StockPurchaseReceiptProductSuggestion | null;
  metadata?: Record<string, unknown>;
}

export interface CreateDraftStockPurchaseReceiptInput {
  workspaceId: string;
  fileRef: string;
  fileHash: string;
  mediaType?: string | null;
  vendorName?: string | null;
  issuedAt?: Date | null;
  totalCents?: number | null;
  currency?: string | null;
  extractedData?: Record<string, unknown> | null;
  items: CreateDraftStockPurchaseReceiptItemInput[];
}

export interface ApplyStockPurchaseReceiptResult {
  receipt: StockPurchaseReceipt;
  createdProducts: Array<{ id: string; name: string; sku: string }>;
  stockAdjustments: Array<{ productId: string; productName: string; delta: number; previousQty: number; newQty: number }>;
  duplicateOfReceiptId?: string | null;
}

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

function normalizeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(asNumber)) return null;
    return Math.trunc(asNumber);
  }
  return null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDraftProductName(raw: string, fallback: string): string {
  const source = (raw || '').trim() || (fallback || '').trim() || 'Producto';
  const hasLataFormat = /\b(?:lat|lata)\s*x?\s*\d{1,4}\b|\b(?:lat|lata)\d{1,4}\b/i.test(source);
  let cleaned = source
    .replace(/\b(?:pet|pack|paq|paquete|bulto|caja|cx)\s*x?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b(?:pet|pack|paq|paquete|bulto|caja|cx)\b/gi, ' ')
    .replace(/\b(?:lat|lata)\s*x?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b(?:lat|lata)\d{1,4}\b/gi, ' ')
    .replace(/\b\d{2,4}\s*(?:lat|lata)\s*x?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b\d{2,4}\s*(?:lat|lata)\b/gi, ' ')
    .replace(/\blata\s*x?\s*\d{2,4}\b/gi, 'lata')
    .replace(/\bx?\s*\d+(?:[.,]\d+)?\s*(kg|kgr|kilo|kilos|g|gr|gramo|gramos|l|lt|lts|litro|litros|ml|cc|m|mt|mts|metro|metros|cm)\b/gi, ' ')
    .replace(/\b\d{1,4}\s*(cc|ml|lts?|lt|kg|gr|g)\b/gi, ' ')
    .replace(/\bx\s*\d{1,4}\b/gi, ' ')
    .replace(/[.;:,]+/g, ' ');
  if (hasLataFormat) {
    cleaned = cleaned.replace(/\b\d{2,4}\b/g, ' ');
  }
  cleaned = cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s./_-]+|[\s./_-]+$/g, '')
    .trim();

  const value = cleaned || 'Producto';
  return value.slice(0, 255);
}

function hasNameNoiseToken(raw: string): boolean {
  if (!raw) return false;
  return (
    /\b(?:pet|pack|paq|paquete|bulto|caja|cx)\s*x?\s*\d{1,4}\b/i.test(raw) ||
    /\b(?:pet|pack|paq|paquete|bulto|caja|cx)\b/i.test(raw) ||
    /\b(?:lat|lata)\s*x?\s*\d{1,4}\b|\b(?:lat|lata)\d{1,4}\b/i.test(raw) ||
    /\b\d{2,4}\s*(?:lat|lata)\s*x?\s*\d{1,4}\b|\b\d{2,4}\s*(?:lat|lata)\b/i.test(raw) ||
    /\bx?\s*\d+(?:[.,]\d+)?\s*(kg|kgr|kilo|kilos|g|gr|gramo|gramos|l|lt|lts|litro|litros|ml|cc|m|mt|mts|metro|metros|cm)\b/i.test(raw) ||
    /\b\d{1,4}\s*(cc|ml|lts?|lt|kg|gr|g)\b/i.test(raw)
  );
}

function sanitizeSku(value: string): string {
  return (value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || `SKU-${Date.now().toString(36).toUpperCase()}`;
}

function normalizeLowStockThreshold(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.trunc(parsed);
    return normalized >= 0 ? normalized : null;
  }
  return null;
}

function getUsagePeriod(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

function normalizeUsageQuantity(quantity: number | bigint): bigint {
  if (typeof quantity === 'bigint') return quantity;
  if (!Number.isFinite(quantity)) return 0n;
  const normalized = Math.floor(quantity);
  if (normalized <= 0) return 0n;
  return BigInt(normalized);
}

async function recordUsage(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    metric: string;
    quantity: number | bigint;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
  }
): Promise<void> {
  const amount = normalizeUsageQuantity(params.quantity);
  if (amount <= 0n) return;

  const { start, end } = getUsagePeriod(params.occurredAt ?? new Date());
  try {
    const existing = await prisma.usageRecord.findFirst({
      where: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        periodStart: start,
        periodEnd: end,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await prisma.usageRecord.updateMany({
        where: { id: existing.id, workspaceId: params.workspaceId },
        data: { quantity: { increment: amount } },
      });
      return;
    }

    await prisma.usageRecord.create({
      data: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        quantity: amount,
        periodStart: start,
        periodEnd: end,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Non-fatal
  }
}

function computeUnitsPerPack(params: {
  isPack: boolean;
  unitsPerPack?: number | null;
  productSecondaryUnit?: string | null;
  productSecondaryUnitValue?: string | null;
}): number {
  if (!params.isPack) return 1;

  const explicit = params.unitsPerPack ?? null;
  if (explicit && explicit > 0) return explicit;

  if (params.productSecondaryUnit === 'dozen') return 12;

  const parsed = normalizeInt(params.productSecondaryUnitValue);
  if (parsed && parsed > 0) return parsed;

  return 1;
}

function computeBaseUnits(params: {
  quantity: number;
  isPack: boolean;
  unitsPerPack: number;
}): number {
  const qty = Number.isFinite(params.quantity) ? Math.trunc(params.quantity) : 0;
  const safeQty = qty > 0 ? qty : 0;
  if (!params.isPack) return safeQty;
  const upp = Number.isFinite(params.unitsPerPack) ? Math.trunc(params.unitsPerPack) : 1;
  const safeUpp = upp > 0 ? upp : 1;
  return safeQty * safeUpp;
}

export class StockPurchaseReceiptService {
  private async getWorkspaceLowStockThreshold(prisma: PrismaClient, workspaceId: string): Promise<number> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const settings = (workspace?.settings as Record<string, unknown>) || {};
    const threshold = normalizeLowStockThreshold(settings.lowStockThreshold);
    return threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  }

  async findDuplicate(prisma: PrismaClient, workspaceId: string, fileHash: string): Promise<StockPurchaseReceipt | null> {
    const hash = (fileHash || '').trim().toLowerCase();
    if (!hash) return null;
    return prisma.stockPurchaseReceipt.findFirst({
      where: { workspaceId, fileHash: hash },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDraft(prisma: PrismaClient, input: CreateDraftStockPurchaseReceiptInput): Promise<StockPurchaseReceipt & { items: StockPurchaseReceiptItem[] }> {
    const fileHash = (input.fileHash || '').trim().toLowerCase();
    if (!fileHash) {
      throw new Error('fileHash required');
    }

    const existing = await prisma.stockPurchaseReceipt.findFirst({
      where: { workspaceId: input.workspaceId, fileHash },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (existing) return existing;

    const currency = safeString(input.currency) || 'ARS';
    const total = typeof input.totalCents === 'number' && Number.isFinite(input.totalCents)
      ? Math.max(0, Math.trunc(input.totalCents))
      : 0;

    const created = await prisma.stockPurchaseReceipt.create({
      data: {
        workspaceId: input.workspaceId,
        status: 'draft',
        vendorName: safeString(input.vendorName),
        issuedAt: input.issuedAt ?? undefined,
        total,
        currency,
        fileRef: input.fileRef,
        fileHash,
        mediaType: safeString(input.mediaType) ?? undefined,
        extractedData: (input.extractedData ?? {}) as Prisma.InputJsonValue,
        items: {
          create: input.items.map((item) => {
            const quantity = Number.isFinite(item.quantity) ? Math.max(0, Math.trunc(item.quantity)) : 0;
            const isPack = item.isPack === true;
            const unitsPerPack = item.unitsPerPack ?? null;
            const baseUnits = computeBaseUnits({
              quantity,
              isPack,
              unitsPerPack: unitsPerPack && unitsPerPack > 0 ? unitsPerPack : 1,
            });

            const matchConfidence =
              typeof item.matchConfidence === 'number' && Number.isFinite(item.matchConfidence)
                ? Math.max(0, Math.min(1, item.matchConfidence))
                : null;

            const suggested = (item.suggestedProduct || item.metadata)
              ? {
                  ...(item.suggestedProduct ? { suggestedProduct: item.suggestedProduct } : {}),
                  ...(item.metadata ? { metadata: item.metadata } : {}),
                }
              : {};

            return {
              rawDescription: (item.rawDescription || '').slice(0, 500),
              quantity,
              isPack,
              unitsPerPack: unitsPerPack && unitsPerPack > 0 ? unitsPerPack : null,
              quantityBaseUnits: baseUnits,
              matchedProductId: item.matchedProductId ?? null,
              unitPrice: item.unitPriceCents ?? null,
              lineTotal: item.lineTotalCents ?? null,
              matchConfidence: matchConfidence === null ? null : matchConfidence.toFixed(3),
              suggestedProductData: suggested as Prisma.InputJsonValue,
            };
          }),
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    return created;
  }

  async apply(
    prisma: PrismaClient,
    params: {
      workspaceId: string;
      receiptId: string;
      source: 'dashboard' | 'owner_whatsapp';
    }
  ): Promise<ApplyStockPurchaseReceiptResult> {
    const workspaceLowThreshold = await this.getWorkspaceLowStockThreshold(
      prisma,
      params.workspaceId
    );
    const receipt = await prisma.stockPurchaseReceipt.findFirst({
      where: { id: params.receiptId, workspaceId: params.workspaceId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    if (!receipt) {
      throw new Error('Receipt not found');
    }

    if (receipt.status === 'applied') {
      return {
        receipt,
        createdProducts: [],
        stockAdjustments: [],
      };
    }

    const createdProducts: ApplyStockPurchaseReceiptResult['createdProducts'] = [];
    const stockAdjustments: ApplyStockPurchaseReceiptResult['stockAdjustments'] = [];

    const applied = await prisma.$transaction(async (tx) => {
      for (const item of receipt.items) {
        let productId: string | null = item.matchedProductId;

        if (productId) {
          const exists = await tx.product.findFirst({
            where: {
              id: productId,
              workspaceId: params.workspaceId,
              deletedAt: null,
              status: { not: 'archived' },
            },
            select: {
              id: true,
              name: true,
              sku: true,
              status: true,
              attributes: true,
              secondaryUnit: true,
              secondaryUnitValue: true,
            },
          });
          if (!exists) {
            productId = null;
          } else {
            const attributes =
              exists.attributes && typeof exists.attributes === 'object'
                ? (exists.attributes as Record<string, unknown>)
                : null;
            const createdFrom =
              attributes && typeof attributes.createdFrom === 'string'
                ? attributes.createdFrom
                : '';
            if (exists.status === 'draft' && createdFrom === 'stock_purchase_receipt') {
              await tx.product.update({
                where: { id: exists.id },
                data: { status: 'active' },
              });
            }
            const normalizedName = normalizeDraftProductName(exists.name, item.rawDescription);
            const shouldNormalize = hasNameNoiseToken(exists.name);
            if (normalizedName !== exists.name && shouldNormalize) {
              await tx.product.update({
                where: { id: exists.id },
                data: { name: normalizedName },
              });
            }
          }
        }

        if (!productId) {
          const suggested = (item.suggestedProductData as Record<string, unknown>)?.suggestedProduct as Record<string, unknown> | undefined;
          const name = normalizeDraftProductName(
            safeString(suggested?.name) || '',
            item.rawDescription.slice(0, 255) || 'Producto'
          );
          const unit = (safeString(suggested?.unit) as any) || 'unit';
          const unitValue = safeString(suggested?.unitValue);
          const secondaryUnit = safeString(suggested?.secondaryUnit) as any;
          const secondaryUnitValue = safeString(suggested?.secondaryUnitValue);

          const skuBase = sanitizeSku(`${name}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`);

          const created = await tx.product.create({
            data: {
              workspaceId: params.workspaceId,
              sku: skuBase,
              name,
              unit,
              unitValue: unitValue ?? null,
              secondaryUnit: secondaryUnit ?? null,
              secondaryUnitValue: secondaryUnitValue ?? null,
              category: null,
              price: 0,
              currency: receipt.currency || 'ARS',
              images: [] as unknown as Prisma.InputJsonValue,
              attributes: { createdFrom: 'stock_purchase_receipt' } as Prisma.InputJsonValue,
              keywords: [],
              // New products from supplier receipts must be available for owner/order flows.
              status: 'active',
            },
            select: { id: true, name: true, sku: true, secondaryUnit: true, secondaryUnitValue: true },
          });

          productId = created.id;
          createdProducts.push({ id: created.id, name: created.name, sku: created.sku });

          await tx.stockPurchaseReceiptItem.updateMany({
            where: { id: item.id, receiptId: receipt.id },
            data: { createdProductId: created.id },
          });
        }

        // Fetch product secondary unit for pack conversion (if needed).
        const product = await tx.product.findFirst({
          where: {
            id: productId,
            workspaceId: params.workspaceId,
            deletedAt: null,
            status: { not: 'archived' },
          },
          select: { id: true, name: true, secondaryUnit: true, secondaryUnitValue: true },
        });
        if (!product) continue;

        const unitsPerPack = computeUnitsPerPack({
          isPack: item.isPack,
          unitsPerPack: item.unitsPerPack,
          productSecondaryUnit: product.secondaryUnit,
          productSecondaryUnitValue: product.secondaryUnitValue,
        });

        const delta = computeBaseUnits({
          quantity: item.quantity,
          isPack: item.isPack,
          unitsPerPack,
        });

        if (delta <= 0) continue;

        // Get stock item (no variants/locations in this flow).
        const existingStock = await tx.stockItem.findFirst({
          where: { productId: product.id, variantId: null, location: null },
          select: { id: true, quantity: true, reserved: true },
        });

        const previousQty = existingStock?.quantity ?? 0;
        const newQty = previousQty + delta;

        let stockItemId: string;
        if (existingStock) {
          await tx.stockItem.update({
            where: { id: existingStock.id },
            data: { quantity: newQty },
          });
          stockItemId = existingStock.id;
        } else {
          const createdStock = await tx.stockItem.create({
            data: {
              productId: product.id,
              quantity: newQty,
              lowThreshold: workspaceLowThreshold,
            },
            select: { id: true },
          });
          stockItemId = createdStock.id;
        }

        await tx.stockMovement.create({
          data: {
            stockItemId,
            type: 'adjustment',
            quantity: delta,
            previousQty,
            newQty,
            reason: receipt.vendorName
              ? `Boleta de compra (${receipt.vendorName})`
              : 'Boleta de compra',
            referenceType: 'StockPurchaseReceipt',
            referenceId: receipt.id,
          },
        });

        await tx.stockPurchaseReceiptItem.updateMany({
          where: { id: item.id, receiptId: receipt.id },
          data: {
            matchedProductId: item.matchedProductId ?? product.id,
            quantityBaseUnits: delta,
            unitsPerPack: item.isPack ? unitsPerPack : null,
          },
        });

        stockAdjustments.push({
          productId: product.id,
          productName: product.name,
          delta,
          previousQty,
          newQty,
        });
      }

      const updatedReceipt = await tx.stockPurchaseReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'applied',
          appliedAt: new Date(),
        },
      });

      return updatedReceipt;
    });

    await recordUsage(prisma, {
      workspaceId: params.workspaceId,
      metric: 'premium.stock_receipts.processed',
      quantity: 1,
      metadata: {
        source: params.source,
        receiptId: applied.id,
      },
    });

    return {
      receipt: applied,
      createdProducts,
      stockAdjustments,
    };
  }
}
