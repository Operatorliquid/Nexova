/**
 * Stock/Inventory Tools
 * Tools for inventory management by AI agent
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult } from '../../types/index.js';
import { buildProductDisplayName } from './product-utils.js';

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

const normalizeLowStockThreshold = (value: unknown): number | null => {
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
};

async function getWorkspaceLowStockThreshold(prisma: PrismaClient, workspaceId: string): Promise<number> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });
  const settings = (workspace?.settings as Record<string, unknown>) || {};
  const threshold = normalizeLowStockThreshold(settings.lowStockThreshold);
  return threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE PRODUCT TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const CreateProductInput = z.object({
  name: z.string().min(1).max(255).describe('Nombre del producto'),
  sku: z.string().max(100).optional().describe('SKU (se genera automaticamente si no se provee)'),
  description: z.string().max(2000).optional().describe('Descripcion del producto'),
  price: z.number().min(0).describe('Precio en pesos (ej: 1500.50)'),
  unit: z.enum(['unit', 'kg', 'g', 'l', 'ml', 'm', 'cm']).optional().describe('Unidad de medida'),
  unitValue: z.number().optional().describe('Contenido/medida (ej: 2.25)'),
  secondaryUnit: z.enum(['pack', 'box', 'bundle', 'dozen']).optional().describe('Segunda unidad de medida'),
  secondaryUnitValue: z.number().optional().describe('Cantidad de la segunda unidad (ej: 6 para pack)'),
  initialStock: z.number().int().min(0).optional().default(0).describe('Cantidad inicial de stock'),
  categoryNames: z.array(z.string()).optional().describe('Nombres de categorias a asignar (se crean si no existen)'),
  imageUrl: z.string().url().optional().describe('URL de imagen del producto'),
});

export class CreateProductTool extends BaseTool<typeof CreateProductInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'create_product',
      description: 'Crea un nuevo producto en el inventario con nombre, precio, stock inicial y categorias.',
      category: ToolCategory.MUTATION,
      inputSchema: CreateProductInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof CreateProductInput>, context: ToolContext): Promise<ToolResult> {
    const { name, sku, description, price, unit, unitValue, secondaryUnit, secondaryUnitValue, initialStock, categoryNames, imageUrl } = input;
    const workspaceLowThreshold = await getWorkspaceLowStockThreshold(this.prisma, context.workspaceId);

    // Generate SKU if not provided
    const finalSku = sku || `SKU-${Date.now().toString(36).toUpperCase()}`;

    // Check SKU uniqueness
    const existing = await this.prisma.product.findFirst({
      where: { workspaceId: context.workspaceId, sku: finalSku, deletedAt: null },
    });

    if (existing) {
      return { success: false, error: `Ya existe un producto con SKU "${finalSku}"` };
    }

    if (secondaryUnit && secondaryUnit !== 'dozen' && secondaryUnitValue === undefined) {
      return { success: false, error: 'La segunda unidad requiere un valor (pack, caja o bulto)' };
    }

    // Create product
    const product = await this.prisma.product.create({
      data: {
        workspaceId: context.workspaceId,
        sku: finalSku,
        name,
        description,
        unit: unit || 'unit',
        unitValue: unit && unit !== 'unit' && unitValue !== undefined ? unitValue.toString() : null,
        secondaryUnit: secondaryUnit || null,
        secondaryUnitValue: secondaryUnit === 'dozen'
          ? '12'
          : secondaryUnit && secondaryUnitValue !== undefined
            ? secondaryUnitValue.toString()
            : null,
        price: Math.round(price * 100), // Convert to cents
        images: imageUrl ? [imageUrl] : [],
        status: 'active',
        stockItems: initialStock !== undefined && initialStock > 0 ? {
          create: {
            quantity: initialStock,
            lowThreshold: workspaceLowThreshold,
          },
        } : undefined,
      },
    });

    // Create stock item if not created with product
    if (initialStock === 0 || initialStock === undefined) {
      await this.prisma.stockItem.create({
        data: {
          productId: product.id,
          quantity: 0,
          lowThreshold: workspaceLowThreshold,
        },
      });
    }

    // Handle categories
    const assignedCategories: string[] = [];
    if (categoryNames?.length) {
      for (const catName of categoryNames) {
        // Upsert category
        const category = await this.prisma.productCategory.upsert({
          where: { workspaceId_name: { workspaceId: context.workspaceId, name: catName } },
          create: { workspaceId: context.workspaceId, name: catName },
          update: {},
        });

        // Create mapping
        await this.prisma.productCategoryMapping.create({
          data: { productId: product.id, categoryId: category.id },
        });

        assignedCategories.push(catName);
      }
    }

    return {
      success: true,
      data: {
        id: product.id,
        sku: product.sku,
        name: buildProductDisplayName(product),
        unit: product.unit,
        unitValue: product.unitValue,
        secondaryUnit: product.secondaryUnit,
        secondaryUnitValue: product.secondaryUnitValue,
        price,
        stock: initialStock || 0,
        categories: assignedCategories,
        message: `Producto "${buildProductDisplayName(product)}" creado exitosamente${assignedCategories.length ? ` en categorias: ${assignedCategories.join(', ')}` : ''}`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE PRODUCT TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const UpdateProductInput = z.object({
  productId: z.string().uuid().optional().describe('ID del producto'),
  sku: z.string().optional().describe('SKU del producto (alternativa al ID)'),
  name: z.string().min(1).max(255).optional().describe('Nuevo nombre'),
  description: z.string().max(2000).optional().describe('Nueva descripcion'),
  price: z.number().min(0).optional().describe('Nuevo precio en pesos'),
  unit: z.enum(['unit', 'kg', 'g', 'l', 'ml', 'm', 'cm']).optional().describe('Unidad de medida'),
  unitValue: z.number().optional().describe('Contenido/medida'),
  secondaryUnit: z.enum(['pack', 'box', 'bundle', 'dozen']).optional().describe('Segunda unidad de medida'),
  secondaryUnitValue: z.number().optional().describe('Cantidad de la segunda unidad'),
  status: z.enum(['active', 'draft', 'archived']).optional().describe('Nuevo estado'),
  imageUrl: z.string().url().optional().describe('Nueva URL de imagen'),
}).refine((d) => d.productId || d.sku, { message: 'Debe proporcionar productId o sku' });

export class UpdateProductTool extends BaseTool<typeof UpdateProductInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'update_product',
      description: 'Actualiza informacion de un producto existente (nombre, precio, descripcion, estado).',
      category: ToolCategory.MUTATION,
      inputSchema: UpdateProductInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof UpdateProductInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, sku, name, description, price, unit, unitValue, secondaryUnit, secondaryUnitValue, status, imageUrl } = input;

    // Find product
    const where: any = { workspaceId: context.workspaceId, deletedAt: null };
    if (productId) where.id = productId;
    else if (sku) where.sku = sku;

    const product = await this.prisma.product.findFirst({ where });
    if (!product) {
      return { success: false, error: 'Producto no encontrado' };
    }

    // Build update data
    const updateData: any = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = Math.round(price * 100);
    if (unit !== undefined) {
      updateData.unit = unit;
      updateData.unitValue = unit !== 'unit' && unitValue !== undefined ? unitValue.toString() : null;
    } else if (unitValue !== undefined) {
      updateData.unitValue = unitValue.toString();
    }
    if (secondaryUnit !== undefined) {
      if (secondaryUnit && secondaryUnit !== 'dozen' && secondaryUnitValue === undefined) {
        return { success: false, error: 'La segunda unidad requiere un valor (pack, caja o bulto)' };
      }
      updateData.secondaryUnit = secondaryUnit;
      updateData.secondaryUnitValue = secondaryUnit === 'dozen'
        ? '12'
        : secondaryUnit && secondaryUnitValue !== undefined
          ? secondaryUnitValue.toString()
          : null;
    } else if (secondaryUnitValue !== undefined) {
      updateData.secondaryUnitValue = secondaryUnitValue.toString();
    }
    if (status) updateData.status = status;
    if (imageUrl) updateData.images = [imageUrl];

    await this.prisma.product.updateMany({
      where: { id: product.id, workspaceId: context.workspaceId },
      data: updateData,
    });

    const updated = await this.prisma.product.findFirst({
      where: { id: product.id, workspaceId: context.workspaceId },
    });
    if (!updated) {
      return { success: false, error: 'Producto no encontrado' };
    }

    return {
      success: true,
      data: {
        id: updated.id,
        name: buildProductDisplayName(updated),
        unit: updated.unit,
        unitValue: updated.unitValue,
        secondaryUnit: updated.secondaryUnit,
        secondaryUnitValue: updated.secondaryUnitValue,
        price: updated.price / 100,
        status: updated.status,
        message: `Producto "${buildProductDisplayName(updated)}" actualizado`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE PRODUCT TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const DeleteProductInput = z.object({
  productId: z.string().uuid().optional().describe('ID del producto'),
  sku: z.string().optional().describe('SKU del producto'),
  productName: z.string().optional().describe('Nombre del producto (busqueda parcial)'),
}).refine((d) => d.productId || d.sku || d.productName, { message: 'Debe proporcionar productId, sku o productName' });

export class DeleteProductTool extends BaseTool<typeof DeleteProductInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'delete_product',
      description: 'Elimina un producto del inventario.',
      category: ToolCategory.MUTATION,
      inputSchema: DeleteProductInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof DeleteProductInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, sku, productName } = input;

    // Find product
    const where: any = { workspaceId: context.workspaceId, deletedAt: null };
    if (productId) where.id = productId;
    else if (sku) where.sku = sku;
    else if (productName) where.name = { contains: productName, mode: 'insensitive' };

    const product = await this.prisma.product.findFirst({ where });
    if (!product) {
      return { success: false, error: 'Producto no encontrado' };
    }

    await this.prisma.product.updateMany({
      where: { id: product.id, workspaceId: context.workspaceId },
      data: { deletedAt: new Date(), status: 'archived' },
    });

    return {
      success: true,
      data: { message: `Producto "${buildProductDisplayName(product)}" eliminado` },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUST STOCK TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const AdjustStockInput = z.object({
  productId: z.string().uuid().optional().describe('ID del producto'),
  sku: z.string().optional().describe('SKU del producto'),
  productName: z.string().optional().describe('Nombre del producto'),
  quantity: z.number().int().describe('Cantidad a ajustar (positivo para agregar, negativo para restar)'),
  reason: z.string().max(500).optional().describe('Razon del ajuste'),
}).refine((d) => d.productId || d.sku || d.productName, { message: 'Debe proporcionar productId, sku o productName' });

export class AdjustStockTool extends BaseTool<typeof AdjustStockInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'adjust_stock',
      description: 'Ajusta la cantidad de stock de un producto (agregar o restar unidades).',
      category: ToolCategory.MUTATION,
      inputSchema: AdjustStockInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof AdjustStockInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, sku, productName, quantity, reason } = input;

    // Find product
    const where: any = { workspaceId: context.workspaceId, deletedAt: null };
    if (productId) where.id = productId;
    else if (sku) where.sku = sku;
    else if (productName) where.name = { contains: productName, mode: 'insensitive' };

    const product = await this.prisma.product.findFirst({
      where,
      include: { stockItems: true },
    });

    if (!product) {
      return { success: false, error: 'Producto no encontrado' };
    }

    const displayName = buildProductDisplayName(product);
    const workspaceLowThreshold = await getWorkspaceLowStockThreshold(this.prisma, context.workspaceId);
    const totalQty = product.stockItems.reduce((sum, s) => sum + s.quantity, 0);
    const totalReserved = product.stockItems.reduce((sum, s) => sum + s.reserved, 0);
    const previousAvailable = totalQty - totalReserved;

    // Get or create stock item
    let stockItem = product.stockItems[0];
    const previousQty = stockItem?.quantity || 0;
    const previousReserved = stockItem?.reserved || 0;
    const newQty = previousQty + quantity;
    const newTotalQty = totalQty + quantity;
    const newAvailable = previousAvailable + quantity;

    if (newQty < 0 || newQty < previousReserved || newTotalQty < totalReserved) {
      return {
        success: false,
        error: 'Stock insuficiente.',
        data: {
          insufficientStock: [
            {
              productId: product.id,
              name: displayName,
              available: previousAvailable,
              reserved: totalReserved,
              requested: Math.abs(quantity),
              mode: 'set',
            },
          ],
        },
      };
    }

    if (stockItem) {
      stockItem = await this.prisma.stockItem.update({
        where: { id: stockItem.id },
        data: { quantity: newQty },
      });
    } else {
      stockItem = await this.prisma.stockItem.create({
        data: {
          productId: product.id,
          quantity: newQty,
          lowThreshold: workspaceLowThreshold,
        },
      });
    }

    // Record movement
    await this.prisma.stockMovement.create({
      data: {
        stockItemId: stockItem.id,
        type: 'adjustment',
        quantity,
        previousQty,
        newQty,
        reason: reason || (quantity > 0 ? 'Ingreso de stock' : 'Egreso de stock'),
      },
    });

    const reservedLabel = totalReserved > 0 ? ` (Reservado: ${totalReserved})` : '';

    return {
      success: true,
      data: {
        productId: product.id,
        productName: displayName,
        previousStock: previousAvailable,
        adjustment: quantity,
        newStock: newAvailable,
        reserved: totalReserved,
        previousQuantity: totalQty,
        newQuantity: newTotalQty,
        message: `Stock de "${displayName}" ajustado: ${previousAvailable} → ${newAvailable} (${quantity > 0 ? '+' : ''}${quantity})${reservedLabel}`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET FULL STOCK TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const GetFullStockInput = z.object({
  categoryName: z.string().optional().describe('Filtrar por nombre de categoria'),
  search: z.string().optional().describe('Buscar por nombre o SKU'),
  lowStockOnly: z.boolean().optional().describe('Solo productos con stock bajo (segun umbral configurado)'),
  outOfStockOnly: z.boolean().optional().describe('Solo productos sin stock'),
  limit: z.number().int().min(1).max(100).optional().default(50).describe('Cantidad maxima de resultados'),
});

export class GetFullStockTool extends BaseTool<typeof GetFullStockInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_full_stock',
      description: 'Obtiene el inventario completo con cantidades, precios y categorias. Puede filtrar por categoria, busqueda o estado de stock.',
      category: ToolCategory.QUERY,
      inputSchema: GetFullStockInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof GetFullStockInput>, context: ToolContext): Promise<ToolResult> {
    const { categoryName, search, lowStockOnly, outOfStockOnly, limit } = input;

    // Build where clause
    const where: any = {
      workspaceId: context.workspaceId,
      status: 'active',
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryName) {
      where.categoryMappings = {
        some: {
          category: { name: { contains: categoryName, mode: 'insensitive' } },
        },
      };
    }

    // Get products
    const products = await this.prisma.product.findMany({
      where,
      include: {
        stockItems: {
          select: { quantity: true, reserved: true, lowThreshold: true },
        },
        categoryMappings: {
          include: {
            category: { select: { name: true } },
          },
        },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    // Format and filter by stock status
    const inventory = products
      .map((p) => {
        const totalStock = p.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
        const lowThreshold = p.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
        const categories = p.categoryMappings.map((m) => m.category.name);

        const displayName = buildProductDisplayName(p);
        return {
          id: p.id,
          sku: p.sku,
          name: displayName,
          unit: p.unit,
          unitValue: p.unitValue,
          price: p.price / 100,
          stock: totalStock,
          reserved: p.stockItems.reduce((sum, s) => sum + s.reserved, 0),
          available: totalStock,
          isLowStock: totalStock > 0 && totalStock <= lowThreshold,
          isOutOfStock: totalStock <= 0,
          categories,
        };
      })
      .filter((p) => {
        if (lowStockOnly && !p.isLowStock) return false;
        if (outOfStockOnly && !p.isOutOfStock) return false;
        return true;
      });

    // Summary stats
    const totalProducts = inventory.length;
    const totalUnits = inventory.reduce((sum, p) => sum + p.stock, 0);
    const lowStockCount = inventory.filter((p) => p.isLowStock).length;
    const outOfStockCount = inventory.filter((p) => p.isOutOfStock).length;

    return {
      success: true,
      data: {
        inventory,
        summary: {
          totalProducts,
          totalUnits,
          lowStockCount,
          outOfStockCount,
        },
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE CATEGORY TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const CreateCategoryInput = z.object({
  name: z.string().min(1).max(100).describe('Nombre de la categoria'),
  description: z.string().max(500).optional().describe('Descripcion de la categoria'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Color en formato hexadecimal (#RRGGBB)'),
});

export class CreateCategoryTool extends BaseTool<typeof CreateCategoryInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'create_category',
      description: 'Crea una nueva categoria para organizar productos.',
      category: ToolCategory.MUTATION,
      inputSchema: CreateCategoryInput,
      requiresConfirmation: false,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof CreateCategoryInput>, context: ToolContext): Promise<ToolResult> {
    const { name, description, color } = input;

    // Check if already exists
    const existing = await this.prisma.productCategory.findFirst({
      where: { workspaceId: context.workspaceId, name, deletedAt: null },
    });

    if (existing) {
      return { success: false, error: `Ya existe una categoria llamada "${name}"` };
    }

    const category = await this.prisma.productCategory.create({
      data: {
        workspaceId: context.workspaceId,
        name,
        description,
        color,
      },
    });

    return {
      success: true,
      data: {
        id: category.id,
        name: category.name,
        message: `Categoria "${category.name}" creada`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST CATEGORIES TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const ListCategoriesInput = z.object({
  includeProductCount: z.boolean().optional().default(true).describe('Incluir conteo de productos por categoria'),
});

export class ListCategoriesTool extends BaseTool<typeof ListCategoriesInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'list_categories',
      description: 'Lista todas las categorias de productos disponibles.',
      category: ToolCategory.QUERY,
      inputSchema: ListCategoriesInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof ListCategoriesInput>, context: ToolContext): Promise<ToolResult> {
    const { includeProductCount } = input;

    const categories = await this.prisma.productCategory.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: includeProductCount ? {
        _count: { select: { products: true } },
      } : undefined,
    });

    const formattedCategories = categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      color: c.color,
      productCount: includeProductCount ? (c as any)._count?.products || 0 : undefined,
    }));

    return {
      success: true,
      data: {
        categories: formattedCategories,
        count: formattedCategories.length,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE CATEGORY TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const DeleteCategoryInput = z.object({
  categoryId: z.string().uuid().optional().describe('ID de la categoria'),
  categoryName: z.string().optional().describe('Nombre de la categoria'),
}).refine((d) => d.categoryId || d.categoryName, { message: 'Debe proporcionar categoryId o categoryName' });

export class DeleteCategoryTool extends BaseTool<typeof DeleteCategoryInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'delete_category',
      description: 'Elimina una categoria de productos.',
      category: ToolCategory.MUTATION,
      inputSchema: DeleteCategoryInput,
      requiresConfirmation: true,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof DeleteCategoryInput>, context: ToolContext): Promise<ToolResult> {
    const { categoryId, categoryName } = input;

    // Find category
    const where: any = { workspaceId: context.workspaceId, deletedAt: null };
    if (categoryId) where.id = categoryId;
    else if (categoryName) where.name = { contains: categoryName, mode: 'insensitive' };

    const category = await this.prisma.productCategory.findFirst({ where });
    if (!category) {
      return { success: false, error: 'Categoria no encontrada' };
    }

    // Soft delete
    await this.prisma.productCategory.updateMany({
      where: { id: category.id, workspaceId: context.workspaceId },
      data: { deletedAt: new Date() },
    });

    // Remove all mappings
    await this.prisma.productCategoryMapping.deleteMany({
      where: { categoryId: category.id },
    });

    return {
      success: true,
      data: { message: `Categoria "${category.name}" eliminada` },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSIGN CATEGORY TO PRODUCT TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const AssignCategoryInput = z.object({
  productId: z.string().uuid().optional().describe('ID del producto'),
  sku: z.string().optional().describe('SKU del producto'),
  productName: z.string().optional().describe('Nombre del producto'),
  categoryName: z.string().describe('Nombre de la categoria a asignar'),
}).refine((d) => d.productId || d.sku || d.productName, { message: 'Debe proporcionar productId, sku o productName' });

export class AssignCategoryToProductTool extends BaseTool<typeof AssignCategoryInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'assign_category_to_product',
      description: 'Asigna una categoria a un producto. Crea la categoria si no existe.',
      category: ToolCategory.MUTATION,
      inputSchema: AssignCategoryInput,
      requiresConfirmation: false,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof AssignCategoryInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, sku, productName, categoryName } = input;

    // Find product
    const where: any = { workspaceId: context.workspaceId, deletedAt: null };
    if (productId) where.id = productId;
    else if (sku) where.sku = sku;
    else if (productName) where.name = { contains: productName, mode: 'insensitive' };

    const product = await this.prisma.product.findFirst({ where });
    if (!product) {
      return { success: false, error: 'Producto no encontrado' };
    }

    // Upsert category
    const category = await this.prisma.productCategory.upsert({
      where: { workspaceId_name: { workspaceId: context.workspaceId, name: categoryName } },
      create: { workspaceId: context.workspaceId, name: categoryName },
      update: {},
    });

    // Check if mapping already exists
    const existingMapping = await this.prisma.productCategoryMapping.findUnique({
      where: { productId_categoryId: { productId: product.id, categoryId: category.id } },
    });

    if (existingMapping) {
      return {
        success: true,
        data: { message: `"${buildProductDisplayName(product)}" ya pertenece a la categoria "${categoryName}"` },
      };
    }

    // Create mapping
    await this.prisma.productCategoryMapping.create({
      data: { productId: product.id, categoryId: category.id },
    });

    return {
      success: true,
      data: { message: `"${buildProductDisplayName(product)}" asignado a categoria "${categoryName}"` },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create all stock/inventory tools
 */
export function createStockTools(prisma: PrismaClient): BaseTool<any, any>[] {
  return [
    new CreateProductTool(prisma),
    new UpdateProductTool(prisma),
    new DeleteProductTool(prisma),
    new AdjustStockTool(prisma),
    new GetFullStockTool(prisma),
    new CreateCategoryTool(prisma),
    new ListCategoriesTool(prisma),
    new DeleteCategoryTool(prisma),
    new AssignCategoryToProductTool(prisma),
  ];
}
