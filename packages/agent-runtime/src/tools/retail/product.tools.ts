/**
 * Product Tools
 * Tools for product search and catalog
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult } from '../../types/index.js';
import { buildProductDisplayName, extractUnitHints, matchesUnitHints, normalizeUnitToken } from './product-utils.js';

const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'y',
  'a',
  'al',
  'por',
  'para',
  'con',
  'sin',
  'x',
  'quiero',
  'queres',
  'quieres',
  'quisiera',
  'dame',
  'agrega',
  'agregar',
  'sumar',
  'anadir',
  'pone',
  'pon',
  'poner',
  'saca',
  'sacar',
  'entonces',
  'hola',
  'buenas',
  'buenos',
  'porfavor',
  'porfa',
  'favor',
  'gracias',
]);

function normalizeQueryText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeQuery(value: string): string[] {
  return normalizeQueryText(value)
    .split(' ')
    .filter((token) => {
      if (!token) return false;
      if (STOPWORDS.has(token)) return false;
      if (/^\d+(\.\d+)?$/.test(token)) return false;
      if (normalizeUnitToken(token)) return false;
      return true;
    });
}

function extractQuantitySegments(tokens: string[]): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/^\d+$/.test(token)) {
      i += 1;
      const nameTokens: string[] = [];
      while (i < tokens.length && !/^\d+$/.test(tokens[i] ?? '')) {
        const current = tokens[i] ?? '';
        if (current && !STOPWORDS.has(current)) {
          nameTokens.push(current);
        }
        i += 1;
      }
      if (nameTokens.length > 0) {
        segments.push(nameTokens.join(' ').trim());
      }
      continue;
    }
    i += 1;
  }

  return segments;
}

function expandTokenVariants(token: string): string[] {
  const variants = new Set<string>([token]);
  if (token.length > 3) {
    if (token.endsWith('ces') && token.length > 4) {
      variants.add(`${token.slice(0, -3)}z`);
    }
    if (token.endsWith('es') && token.length > 4) {
      variants.add(token.slice(0, -2));
    }
    if (token.endsWith('s')) {
      variants.add(token.slice(0, -1));
    }
  }
  return Array.from(variants).filter((value) => value.length > 1);
}

function buildTokenFilter(token: string) {
  const variants = expandTokenVariants(token);
  return {
    OR: [
      ...variants.map((variant) => ({
        OR: [
          { name: { contains: variant, mode: 'insensitive' } },
          { sku: { contains: variant, mode: 'insensitive' } },
          { description: { contains: variant, mode: 'insensitive' } },
          { shortDesc: { contains: variant, mode: 'insensitive' } },
          { keywords: { has: variant.toLowerCase() } },
        ],
      })),
    ],
  };
}

function buildTermFilter(term: string) {
  const tokens = tokenizeQuery(term).filter((token) => /[a-z]/.test(token) || token.length > 2);
  if (tokens.length <= 1) {
    const single = tokens[0] || term;
    return buildTokenFilter(single);
  }
  return {
    AND: tokens.map((token) => buildTokenFilter(token)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

const SearchProductsInput = z.object({
  query: z.string().optional().describe('Texto de búsqueda (nombre, SKU, descripción)'),
  category: z.string().optional().describe('Filtrar por categoría'),
  limit: z.number().min(1).max(50).optional().default(10).describe('Cantidad máxima de resultados'),
  onlyInStock: z.boolean().optional().default(true).describe('Solo mostrar productos con stock disponible'),
});

export class SearchProductsTool extends BaseTool<typeof SearchProductsInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'search_products',
      description:
        'Busca productos en el catálogo por nombre, SKU o categoría. Devuelve precio y disponibilidad para validación interna (no mostrar cantidades de stock).',
      category: ToolCategory.QUERY,
      inputSchema: SearchProductsInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof SearchProductsInput>, context: ToolContext): Promise<ToolResult> {
    const { query, category, limit, onlyInStock } = input;

    const where: any = {
      workspaceId: context.workspaceId,
      // Owner-mode can work with draft products (e.g., newly imported from receipts).
      status: context.isOwner ? { not: 'archived' } : 'active',
      deletedAt: null,
    };
    const andClauses: any[] = [];

    let multiItemQuery = false;

    if (query) {
      const normalized = normalizeQueryText(query);
      const rawTokens = normalized.split(' ').filter(Boolean);
      const segments = extractQuantitySegments(rawTokens);
      const secondaryParts = query
        .split(/\s*,\s*|\s+y\s+/i)
        .map((part) => normalizeQueryText(part))
        .filter(Boolean);

      let terms: string[] = [];
      let multiItem = false;

      if (segments.length > 1) {
        terms = segments;
        multiItem = true;
      } else if (segments.length === 1) {
        terms = segments;
      } else if (secondaryParts.length > 1) {
        terms = secondaryParts;
        multiItem = true;
      } else if (normalized) {
        terms = [normalized];
      }

      const filteredTerms = terms
        .map((term) => term.trim())
        .filter((term) => term.length > 1);

      multiItemQuery = multiItem;

      if (filteredTerms.length === 1 && !multiItem) {
        andClauses.push(buildTermFilter(filteredTerms[0]));
      } else if (filteredTerms.length > 0) {
        andClauses.push({ OR: filteredTerms.map((term) => buildTermFilter(term)) });
      }
    }

    if (category) {
      andClauses.push({
        OR: [
          { category: { contains: category, mode: 'insensitive' } },
          {
            categoryMappings: {
              some: {
                category: { name: { contains: category, mode: 'insensitive' } },
              },
            },
          },
        ],
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const products = await this.prisma.product.findMany({
      where,
      include: {
        stockItems: {
          select: { quantity: true, reserved: true },
        },
        variants: {
          where: { status: 'active', deletedAt: null },
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            attributes: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: limit,
    });

    // Calculate available stock and filter if needed
    const productsWithStock = products.map((p) => {
      const availableStock = p.stockItems.reduce(
        (sum, s) => sum + s.quantity - s.reserved,
        0
      );
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.shortDesc || p.description?.substring(0, 100),
        price: p.price,
        comparePrice: p.comparePrice,
        category: p.category,
        unit: p.unit,
        unitValue: p.unitValue,
        secondaryUnit: p.secondaryUnit,
        secondaryUnitValue: p.secondaryUnitValue,
        availableStock,
        hasVariants: p.variants.length > 0,
        displayName: buildProductDisplayName(p),
        variants: p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          price: v.price || p.price,
          attributes: v.attributes,
        })),
      };
    }).filter((p) => !onlyInStock || p.availableStock > 0);

    const unitHints = extractUnitHints(query || '');
    let filteredProducts = productsWithStock;
    if (!multiItemQuery && unitHints.length > 0) {
      const unitMatched = productsWithStock.filter((p) => matchesUnitHints(p, unitHints));
      if (unitMatched.length > 0) {
        filteredProducts = unitMatched;
      }
    }

    return {
      success: true,
      data: {
        products: filteredProducts,
        count: filteredProducts.length,
        query: query || null,
        category: category || null,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET PRODUCT DETAILS
// ═══════════════════════════════════════════════════════════════════════════════

const GetProductDetailsInput = z.object({
  productId: z.string().uuid().optional().describe('ID del producto'),
  sku: z.string().optional().describe('SKU del producto'),
}).refine(
  (data: { productId?: string; sku?: string }) => data.productId || data.sku,
  { message: 'Debe proporcionar productId o sku' }
);

export class GetProductDetailsTool extends BaseTool<typeof GetProductDetailsInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_product_details',
      description: 'Obtiene información detallada de un producto específico: precio, stock, variantes disponibles.',
      category: ToolCategory.QUERY,
      inputSchema: GetProductDetailsInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof GetProductDetailsInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, sku } = input;

    const where: any = {
      workspaceId: context.workspaceId,
      deletedAt: null,
    };

    if (productId) {
      where.id = productId;
    } else if (sku) {
      where.sku = sku;
    }

    const product = await this.prisma.product.findFirst({
      where,
      include: {
        stockItems: {
          select: { quantity: true, reserved: true, location: true },
        },
        variants: {
          where: { deletedAt: null },
          include: {
            stockItems: {
              select: { quantity: true, reserved: true },
            },
          },
        },
      },
    });

    if (!product) {
      return { success: false, error: 'Producto no encontrado' };
    }

    const totalStock = product.stockItems.reduce(
      (sum, s) => sum + s.quantity - s.reserved,
      0
    );

    return {
      success: true,
      data: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        displayName: buildProductDisplayName(product),
        unit: product.unit,
        unitValue: product.unitValue,
        secondaryUnit: product.secondaryUnit,
        secondaryUnitValue: product.secondaryUnitValue,
        description: product.description,
        shortDesc: product.shortDesc,
        price: product.price,
        comparePrice: product.comparePrice,
        currency: product.currency,
        taxRate: product.taxRate,
        category: product.category,
        images: product.images,
        attributes: product.attributes,
        availableStock: totalStock,
        status: product.status,
        variants: product.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          name: v.name,
          price: v.price || product.price,
          attributes: v.attributes,
          availableStock: v.stockItems.reduce(
            (sum, s) => sum + s.quantity - s.reserved,
            0
          ),
        })),
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

const GetCategoriesInput = z.object({}).describe('No requiere parámetros');

export class GetCategoriesTool extends BaseTool<typeof GetCategoriesInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_categories',
      description: 'Obtiene las categorías de productos disponibles.',
      category: ToolCategory.QUERY,
      inputSchema: GetCategoriesInput,
    });
    this.prisma = prisma;
  }

  async execute(_input: z.infer<typeof GetCategoriesInput>, context: ToolContext): Promise<ToolResult> {
    const [products, mappedCategories] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          workspaceId: context.workspaceId,
          status: 'active',
          deletedAt: null,
          category: { not: null },
        },
        select: { category: true },
        distinct: ['category'],
      }),
      this.prisma.productCategory.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          products: {
            some: {
              product: { status: 'active', deletedAt: null },
            },
          },
        },
        select: { name: true },
      }),
    ]);

    const categories = Array.from(
      new Set([
        ...products.map((p) => p.category).filter((c): c is string => c !== null),
        ...mappedCategories.map((c) => c.name),
      ])
    ).sort();

    return {
      success: true,
      data: { categories, count: categories.length },
    };
  }
}

/**
 * Create all product tools
 */
export function createProductTools(prisma: PrismaClient): BaseTool<any, any>[] {
  return [
    new SearchProductsTool(prisma),
    new GetProductDetailsTool(prisma),
    new GetCategoriesTool(prisma),
  ];
}
