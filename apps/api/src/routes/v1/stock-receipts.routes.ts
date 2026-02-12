/**
 * Stock Purchase Receipts Routes
 * Upload + OCR + apply supplier receipts to increase stock.
 */
import { FastifyPluginAsync } from 'fastify';
import { randomUUID, createHash } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { StockPurchaseReceiptService } from '@nexova/core';
import { extractStockReceiptWithClaude } from '../../utils/stock-receipt-claude.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB (matches multipart plugin limit)
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

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

const PRIMARY_UNITS = ['unit', 'kg', 'g', 'l', 'ml', 'm', 'cm'] as const;

const applyEditableItemSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1).max(500).optional(),
  quantity: z.coerce.number().int().min(1).max(1_000_000).optional(),
  isPack: z.boolean().optional(),
  unitsPerPack: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  matchedProductId: z.string().uuid().nullable().optional(),
  forceCreateProduct: z.boolean().optional(),
  suggestedProductName: z.string().trim().min(1).max(255).nullable().optional(),
  suggestedProductUnit: z.enum(PRIMARY_UNITS).nullable().optional(),
  suggestedProductUnitValue: z.string().trim().max(32).nullable().optional(),
});

const applyBodySchema = z
  .object({
    items: z.array(applyEditableItemSchema).max(500).optional(),
  })
  .default({});

function sanitizeFilename(name: string): string {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function buildProductDisplayName(product: {
  name: string;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
}): string {
  const cleanName = normalizeSuggestedName(product.name, product.name) || product.name;
  const unit = product.unit || 'unit';
  const unitValue = (product.unitValue || '').toString().trim();
  const primarySuffix = unit !== 'unit' && unitValue
    ? `${unitValue} ${UNIT_SHORT_LABELS[unit] || unit}`
    : '';

  const secondaryUnit = product.secondaryUnit || '';
  const secondaryLabel = secondaryUnit ? (SECONDARY_UNIT_LABELS[secondaryUnit] || secondaryUnit) : '';
  const secondaryValue = (product.secondaryUnitValue || '').toString().trim();
  const secondarySuffix = secondaryLabel
    ? secondaryValue ? `${secondaryLabel} ${secondaryValue}` : secondaryLabel
    : '';

  return [cleanName, primarySuffix, secondarySuffix].filter(Boolean).join(' ').trim();
}

function parseIssuedAt(value?: string | null): Date | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function computeQuantityBaseUnits(quantity: number, isPack: boolean, unitsPerPack?: number | null): number {
  const safeQty = Math.max(0, Math.trunc(Number.isFinite(quantity) ? quantity : 0));
  if (!isPack) return safeQty;
  const safeUnitsPerPack = Math.max(1, Math.trunc(Number.isFinite(unitsPerPack || 0) ? (unitsPerPack || 0) : 1));
  return safeQty * safeUnitsPerPack;
}

function normalizeSuggestedName(raw: string | null | undefined, fallback?: string | null): string | null {
  const source = (raw || '').trim() || (fallback || '').trim();
  if (!source) return null;
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
    // Handles descriptions like "SPRITE ... 354 LAT6" after LAT6 is stripped.
    cleaned = cleaned.replace(/\b\d{2,4}\b/g, ' ');
  }
  cleaned = cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s./_-]+|[\s./_-]+$/g, '')
    .trim();
  return cleaned ? cleaned.slice(0, 255) : null;
}

export const stockReceiptsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new StockPurchaseReceiptService();
  const receiptsDir = path.join(UPLOAD_DIR, 'stock-receipts');
  if (!existsSync(receiptsDir)) {
    await fs.mkdir(receiptsDir, { recursive: true });
  }

  const assertStockReceiptsEnabled = async (
    workspaceId: string,
    userId: string
  ): Promise<{ ok: true } | { ok: false; code: number; payload: any }> => {
    const membership = await fastify.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: { role: { select: { name: true } } },
    });
    const planContext = await getWorkspacePlanContext(
      fastify.prisma,
      workspaceId,
      membership?.role?.name
    );
    if (!planContext.capabilities.showStockReceiptImport) {
      return {
        ok: false,
        code: 403,
        payload: {
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye importación por boleta para stock',
        },
      };
    }
    return { ok: true };
  };

  /**
   * POST /stock-receipts/preview
   * Uploads and extracts a receipt, storing it as draft (no stock changes yet).
   */
  fastify.post(
    '/preview',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'x-workspace-id header is required' });
      }
      const enabled = await assertStockReceiptsEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.code(enabled.code).send(enabled.payload);
      }

      const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } });
      if (!data) {
        return reply.code(400).send({ error: 'NO_FILE', message: 'No file uploaded' });
      }

      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.code(400).send({
          error: 'INVALID_TYPE',
          message: 'Tipo de archivo no permitido. Use JPG, PNG, WebP o PDF.',
        });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'EMPTY_FILE', message: 'Empty file' });
      }

      const fileHash = createHash('sha256').update(buffer).digest('hex');
      const duplicate = await service.findDuplicate(fastify.prisma, workspaceId, fileHash);
      if (duplicate) {
        if (duplicate.status === 'draft') {
          const draft = await fastify.prisma.stockPurchaseReceipt.findFirst({
            where: { id: duplicate.id, workspaceId },
            include: { items: { orderBy: { createdAt: 'asc' } } },
          });

          if (draft) {
            const matchedIds = draft.items
              .map((it) => it.matchedProductId)
              .filter(Boolean) as string[];

            const productsForMap = matchedIds.length
              ? await fastify.prisma.product.findMany({
                  where: { id: { in: matchedIds }, workspaceId, deletedAt: null },
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    unit: true,
                    unitValue: true,
                    secondaryUnit: true,
                    secondaryUnitValue: true,
                    category: true,
                  },
                })
              : [];

            const productMap = new Map(productsForMap.map((p) => [p.id, p]));

            return reply.send({
              duplicate: false,
              receipt: {
                id: draft.id,
                status: draft.status,
                vendorName: draft.vendorName,
                issuedAt: draft.issuedAt?.toISOString() || null,
                total: draft.total,
                currency: draft.currency,
                fileRef: draft.fileRef,
                fileHash: draft.fileHash,
                createdAt: draft.createdAt.toISOString(),
              },
              items: draft.items.map((it) => ({
                id: it.id,
                description: it.rawDescription,
                quantity: it.quantity,
                isPack: it.isPack,
                unitsPerPack: it.unitsPerPack,
                quantityBaseUnits: it.quantityBaseUnits,
                matchedProductId: it.matchedProductId,
                matchedProductName: (() => {
                  if (!it.matchedProductId) return null;
                  const matched = productMap.get(it.matchedProductId);
                  return matched ? buildProductDisplayName(matched) : null;
                })(),
                suggestedProductName:
                  (it.suggestedProductData as any)?.suggestedProduct?.name
                    ? normalizeSuggestedName(
                        String((it.suggestedProductData as any).suggestedProduct.name),
                        it.rawDescription
                      )
                    : null,
                suggestedProductUnit:
                  (it.suggestedProductData as any)?.suggestedProduct?.unit
                    ? String((it.suggestedProductData as any).suggestedProduct.unit)
                    : null,
                suggestedProductUnitValue:
                  (it.suggestedProductData as any)?.suggestedProduct?.unitValue
                    ? String((it.suggestedProductData as any).suggestedProduct.unitValue)
                    : null,
                matchConfidence: it.matchConfidence ? Number(it.matchConfidence) : null,
                createdProductId: it.createdProductId,
              })),
            });
          }
        }

        return reply.send({
          duplicate: true,
          receiptId: duplicate.id,
          status: duplicate.status,
        });
      }

      const safeOriginal = sanitizeFilename(data.filename || 'boleta');
      const baseName = safeOriginal.replace(/\.[^/.]+$/, '');
      const ext = data.mimetype === 'application/pdf'
        ? 'pdf'
        : safeOriginal.split('.').pop() || 'jpg';
      const uniqueName = `${workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}.${ext}`;
      const filePath = path.join(receiptsDir, uniqueName);
      const fileRef = `/uploads/stock-receipts/${uniqueName}`;

      await fs.writeFile(filePath, buffer);

      const products = await fastify.prisma.product.findMany({
        where: { workspaceId, deletedAt: null, status: { not: 'archived' } },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          unitValue: true,
          secondaryUnit: true,
          secondaryUnitValue: true,
          category: true,
        },
        take: 300,
      });

      let extracted: Awaited<ReturnType<typeof extractStockReceiptWithClaude>>;
      try {
        extracted = await extractStockReceiptWithClaude({
          buffer,
          mediaType: data.mimetype,
          products,
        });
      } catch (error) {
        try {
          await fs.unlink(filePath);
        } catch {
          // ignore cleanup errors
        }
        request.log.error({ error }, 'Stock receipt OCR failed');
        return reply.code(500).send({ error: 'OCR_FAILED', message: 'No se pudo leer la boleta' });
      }

      if (!extracted.parsed) {
        try {
          await fs.unlink(filePath);
        } catch {
          // ignore cleanup errors
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          return reply.code(503).send({ error: 'LLM_NOT_CONFIGURED', message: 'LLM no configurado' });
        }
        return reply.code(500).send({ error: 'OCR_FAILED', message: 'No se pudo leer la boleta' });
      }

      const parsed = extracted.parsed;
      let draft: Awaited<ReturnType<typeof service.createDraft>>;
      try {
        draft = await service.createDraft(fastify.prisma, {
          workspaceId,
          fileRef,
          fileHash,
          mediaType: data.mimetype,
          vendorName: parsed.vendor ?? null,
          issuedAt: parseIssuedAt(parsed.issued_at ?? null),
          totalCents: parsed.total_cents ?? null,
          currency: parsed.currency ?? 'ARS',
          extractedData: {
            rawText: extracted.rawText,
            parsed,
          },
          items: (parsed.items || []).map((item) => ({
            rawDescription: item.description,
            quantity: item.quantity,
            isPack: item.is_pack === true,
            unitsPerPack: item.units_per_pack ?? null,
            matchedProductId: item.match?.product_id ?? null,
            matchConfidence: item.match?.confidence ?? null,
            unitPriceCents: item.unit_price_cents ?? null,
            lineTotalCents: item.line_total_cents ?? null,
            suggestedProduct: item.new_product
              ? {
                  name: normalizeSuggestedName(item.new_product.name, item.description) || 'Producto',
                  unit: item.new_product.unit ?? null,
                  unitValue: item.new_product.unit_value ?? null,
                  secondaryUnit: item.new_product.secondary_unit ?? null,
                  secondaryUnitValue: item.new_product.secondary_unit_value ?? null,
                }
              : null,
            metadata: item.match?.reason ? { matchReason: item.match.reason } : undefined,
          })),
        });
      } catch (error) {
        try {
          await fs.unlink(filePath);
        } catch {
          // ignore cleanup errors
        }
        throw error;
      }

      const productMap = new Map(products.map((p) => [p.id, p]));

      return reply.send({
        duplicate: false,
        receipt: {
          id: draft.id,
          status: draft.status,
          vendorName: draft.vendorName,
          issuedAt: draft.issuedAt?.toISOString() || null,
          total: draft.total,
          currency: draft.currency,
          fileRef: draft.fileRef,
          fileHash: draft.fileHash,
          createdAt: draft.createdAt.toISOString(),
        },
        items: draft.items.map((it) => ({
          id: it.id,
          description: it.rawDescription,
          quantity: it.quantity,
          isPack: it.isPack,
          unitsPerPack: it.unitsPerPack,
          quantityBaseUnits: it.quantityBaseUnits,
          matchedProductId: it.matchedProductId,
          matchedProductName: (() => {
            if (!it.matchedProductId) return null;
            const matched = productMap.get(it.matchedProductId);
            return matched ? buildProductDisplayName(matched) : null;
          })(),
          suggestedProductName:
            (it.suggestedProductData as any)?.suggestedProduct?.name
              ? normalizeSuggestedName(
                  String((it.suggestedProductData as any).suggestedProduct.name),
                  it.rawDescription
                )
              : null,
          suggestedProductUnit:
            (it.suggestedProductData as any)?.suggestedProduct?.unit
              ? String((it.suggestedProductData as any).suggestedProduct.unit)
              : null,
          suggestedProductUnitValue:
            (it.suggestedProductData as any)?.suggestedProduct?.unitValue
              ? String((it.suggestedProductData as any).suggestedProduct.unitValue)
              : null,
          matchConfidence: it.matchConfidence ? Number(it.matchConfidence) : null,
          createdProductId: it.createdProductId,
        })),
      });
    }
  );

  /**
   * POST /stock-receipts/:id/apply
   * Applies a previously extracted draft receipt to stock.
   */
  fastify.post(
    '/:id/apply',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'x-workspace-id header is required' });
      }
      const enabled = await assertStockReceiptsEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.code(enabled.code).send(enabled.payload);
      }

      const { id } = request.params as { id: string };
      if (!id) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: 'id required' });
      }

      try {
        const body = applyBodySchema.parse((request.body || {}) as unknown);
        const overrides = body.items || [];

        if (overrides.length > 0) {
          const targetReceipt = await fastify.prisma.stockPurchaseReceipt.findFirst({
            where: { id, workspaceId },
            include: { items: { orderBy: { createdAt: 'asc' } } },
          });

          if (!targetReceipt) {
            return reply.code(404).send({ error: 'NOT_FOUND', message: 'Receipt not found' });
          }
          if (targetReceipt.status !== 'draft') {
            return reply.code(409).send({
              error: 'RECEIPT_NOT_EDITABLE',
              message: 'La boleta ya fue aplicada y no puede editarse.',
            });
          }

          const itemMap = new Map(targetReceipt.items.map((it) => [it.id, it]));
          for (const override of overrides) {
            if (!itemMap.has(override.id)) {
              return reply.code(400).send({
                error: 'INVALID_ITEM',
                message: `El item ${override.id} no pertenece a esta boleta`,
              });
            }
          }

          const requestedProductIds = Array.from(
            new Set(
              overrides
                .map((override) => override.matchedProductId)
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
            )
          );
          const validProductIds = new Set<string>();
          if (requestedProductIds.length > 0) {
            const foundProducts = await fastify.prisma.product.findMany({
              where: {
                workspaceId,
                deletedAt: null,
                id: { in: requestedProductIds },
              },
              select: { id: true },
            });
            for (const product of foundProducts) validProductIds.add(product.id);
            const invalid = requestedProductIds.find((value) => !validProductIds.has(value));
            if (invalid) {
              return reply.code(400).send({
                error: 'INVALID_PRODUCT',
                message: `El producto ${invalid} no existe o no pertenece al workspace`,
              });
            }
          }

          await fastify.prisma.$transaction(async (tx) => {
            for (const override of overrides) {
              const current = itemMap.get(override.id)!;
              const quantity = typeof override.quantity === 'number'
                ? override.quantity
                : current.quantity;
              const isPack = typeof override.isPack === 'boolean'
                ? override.isPack
                : current.isPack;
              const unitsPerPack = isPack
                ? (typeof override.unitsPerPack === 'number'
                  ? override.unitsPerPack
                  : current.unitsPerPack || 1)
                : null;
              const quantityBaseUnits = computeQuantityBaseUnits(quantity, isPack, unitsPerPack);
              const description = override.description || current.rawDescription;
              let matchedProductId = current.matchedProductId;
              if (override.forceCreateProduct === true) {
                matchedProductId = null;
              }
              if (override.matchedProductId !== undefined) {
                matchedProductId = override.matchedProductId;
              }

              let suggestedProductData = ((current.suggestedProductData || {}) as Record<string, unknown>);
              if (
                override.suggestedProductName !== undefined ||
                override.suggestedProductUnit !== undefined ||
                override.suggestedProductUnitValue !== undefined ||
                override.isPack !== undefined ||
                override.unitsPerPack !== undefined ||
                override.forceCreateProduct !== undefined ||
                override.matchedProductId !== undefined
              ) {
                const next = { ...suggestedProductData };
                const currentSuggested =
                  next.suggestedProduct && typeof next.suggestedProduct === 'object'
                    ? { ...(next.suggestedProduct as Record<string, unknown>) }
                    : {};
                if (override.suggestedProductName !== undefined) {
                  if (override.suggestedProductName === null) {
                    delete currentSuggested.name;
                  } else {
                    currentSuggested.name = normalizeSuggestedName(override.suggestedProductName, description);
                  }
                }

                if (override.suggestedProductUnit !== undefined) {
                  if (override.suggestedProductUnit === null) {
                    delete currentSuggested.unit;
                  } else {
                    currentSuggested.unit = override.suggestedProductUnit;
                  }
                }

                if (override.suggestedProductUnitValue !== undefined) {
                  if (override.suggestedProductUnitValue === null || !override.suggestedProductUnitValue.trim()) {
                    delete currentSuggested.unitValue;
                  } else {
                    currentSuggested.unitValue = override.suggestedProductUnitValue.trim();
                  }
                }

                // Keep secondary unit in sync with selected quantity mode from the editable UI.
                if (isPack) {
                  currentSuggested.secondaryUnit = 'bundle';
                  currentSuggested.secondaryUnitValue = String(unitsPerPack || 1);
                } else {
                  delete currentSuggested.secondaryUnit;
                  delete currentSuggested.secondaryUnitValue;
                }
                next.suggestedProduct = currentSuggested;
                suggestedProductData = next;
              }

              await tx.stockPurchaseReceiptItem.update({
                where: { id: current.id },
                data: {
                  rawDescription: description,
                  quantity,
                  isPack,
                  unitsPerPack,
                  quantityBaseUnits,
                  matchedProductId,
                  matchConfidence: matchedProductId ? current.matchConfidence : null,
                  suggestedProductData: suggestedProductData as Prisma.InputJsonValue,
                },
              });
            }
          });
        }

        const result = await service.apply(fastify.prisma, {
          workspaceId,
          receiptId: id,
          source: 'dashboard',
        });

        return reply.send({
          success: true,
          receipt: {
            id: result.receipt.id,
            status: result.receipt.status,
            vendorName: result.receipt.vendorName,
            issuedAt: result.receipt.issuedAt?.toISOString() || null,
            total: result.receipt.total,
            currency: result.receipt.currency,
            fileRef: result.receipt.fileRef,
            appliedAt: result.receipt.appliedAt?.toISOString() || null,
          },
          createdProducts: result.createdProducts,
          stockAdjustments: result.stockAdjustments,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'APPLY_FAILED';
        return reply.code(500).send({ error: 'APPLY_FAILED', message });
      }
    }
  );
};
