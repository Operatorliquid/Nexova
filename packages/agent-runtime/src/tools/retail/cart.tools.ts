/**
 * Cart Tools
 * Tools for managing the shopping cart in memory
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult, Cart, CartItem, AgentState } from '../../types/index.js';
import { MemoryManager } from '../../core/memory-manager.js';
import { buildProductDisplayName } from './product-utils.js';

const resolveOriginalOrderQuantity = async (
  memoryManager: MemoryManager,
  sessionId: string,
  productId: string,
  variantId?: string
): Promise<number> => {
  const memory = await memoryManager.getSession(sessionId);
  const originalItems = memory?.context.editingOrderOriginalItems || [];
  const original = originalItems.find(
    (item) => item.productId === productId && (item.variantId || null) === (variantId || null)
  );
  return original?.quantity || 0;
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET CART
// ═══════════════════════════════════════════════════════════════════════════════

const GetCartInput = z.object({}).describe('No requiere parámetros');

export class GetCartTool extends BaseTool<typeof GetCartInput, Cart | null> {
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    super({
      name: 'get_cart',
      description: 'Obtiene el carrito actual de la sesión con todos los items, subtotal y total.',
      category: ToolCategory.QUERY,
      inputSchema: GetCartInput,
    });
    this.memoryManager = memoryManager;
  }

  async execute(_input: z.infer<typeof GetCartInput>, context: ToolContext): Promise<ToolResult<Cart | null>> {
    const cart = await this.memoryManager.getCart(context.sessionId);

    if (!cart || cart.items.length === 0) {
      return {
        success: true,
        data: null,
      };
    }

    return {
      success: true,
      data: cart,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD TO CART
// ═══════════════════════════════════════════════════════════════════════════════

const AddToCartInput = z.object({
  productId: z.string().uuid().describe('ID del producto a agregar'),
  variantId: z.string().uuid().optional().describe('ID de la variante (si aplica)'),
  quantity: z.number().int().min(1).describe('Cantidad a agregar'),
});

export class AddToCartTool extends BaseTool<typeof AddToCartInput> {
  private prisma: PrismaClient;
  private memoryManager: MemoryManager;

  constructor(prisma: PrismaClient, memoryManager: MemoryManager) {
    super({
      name: 'add_to_cart',
      description: 'Agrega un producto al carrito. Valida stock disponible antes de agregar.',
      category: ToolCategory.MUTATION,
      inputSchema: AddToCartInput,
    });
    this.prisma = prisma;
    this.memoryManager = memoryManager;
  }

  async execute(input: z.infer<typeof AddToCartInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, variantId, quantity } = input;

    // Get product with stock
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        workspaceId: context.workspaceId,
        status: 'active',
        deletedAt: null,
      },
      include: {
        stockItems: true,
      },
    });

    if (!product) {
      return { success: false, error: 'Producto no encontrado o no disponible' };
    }

    // Get variant if specified
    let variant: { id: string; name: string; sku: string | null; price: number | null; stockItems: Array<{ quantity: number; reserved: number }> } | null = null;
    if (variantId) {
      const variantData = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        include: { stockItems: true },
      });
      if (!variantData) {
        return { success: false, error: 'Variante no encontrada' };
      }
      variant = variantData;
    }

    // Calculate available stock
    const stockItems = variant?.stockItems ?? product.stockItems;
    const availableStock = stockItems.reduce(
      (sum: number, s: { quantity: number; reserved: number }) => sum + s.quantity - s.reserved,
      0
    );
    const originalQty = await resolveOriginalOrderQuantity(
      this.memoryManager,
      context.sessionId,
      productId,
      variantId
    );
    const maxAllowed = availableStock + originalQty;

    // Get current cart to check existing quantity
    const currentCart = await this.memoryManager.getCart(context.sessionId);
    const existingItem = currentCart?.items.find(
      (i) => i.productId === productId && i.variantId === variantId
    );
    const totalQuantity = (existingItem?.quantity || 0) + quantity;

    if (maxAllowed < totalQuantity) {
      const inCart = existingItem?.quantity || 0;
      const availableAdditional = Math.max(maxAllowed - inCart, 0);
      const productName = buildProductDisplayName(product, variant);
      return {
        success: false,
        error: 'Stock insuficiente.',
        data: {
          insufficientStock: [
            {
              productId,
              variantId,
              name: productName,
              available: availableAdditional,
              requested: quantity,
              mode: 'add',
            },
          ],
          availableStock: maxAllowed,
          requestedQuantity: quantity,
          inCart,
        },
      };
    }

    // Build cart item
    const unitPrice = variant?.price ?? product.price;
    const displayName = buildProductDisplayName(product, variant);
    const cartItem: CartItem = {
      productId,
      ...(variantId ? { variantId } : {}),
      sku: variant?.sku ?? product.sku,
      name: displayName,
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      availableStock,
    };

    // Add to cart
    const cart = await this.memoryManager.addToCart(context.sessionId, cartItem);

    return {
      success: true,
      data: {
        added: {
          name: cartItem.name,
          quantity,
          unitPrice,
          lineTotal: cartItem.total,
        },
        cart: {
          itemCount: cart?.items.length || 0,
          subtotal: cart?.subtotal || 0,
          total: cart?.total || 0,
        },
      },
      stateTransition: AgentState.COLLECTING_ORDER,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE CART ITEM
// ═══════════════════════════════════════════════════════════════════════════════

const UpdateCartItemInput = z.object({
  productId: z.string().uuid().describe('ID del producto a modificar'),
  variantId: z.string().uuid().optional().describe('ID de la variante (si aplica)'),
  quantity: z.number().int().min(0).describe('Nueva cantidad (0 para eliminar)'),
});

export class UpdateCartItemTool extends BaseTool<typeof UpdateCartItemInput> {
  private prisma: PrismaClient;
  private memoryManager: MemoryManager;

  constructor(prisma: PrismaClient, memoryManager: MemoryManager) {
    super({
      name: 'update_cart_item',
      description: 'Modifica la cantidad de un producto en el carrito. Usar cantidad 0 para eliminar.',
      category: ToolCategory.MUTATION,
      inputSchema: UpdateCartItemInput,
    });
    this.prisma = prisma;
    this.memoryManager = memoryManager;
  }

  async execute(input: z.infer<typeof UpdateCartItemInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, variantId, quantity } = input;

    // Validate stock if increasing
    if (quantity > 0) {
      const product = await this.prisma.product.findFirst({
        where: { id: productId, workspaceId: context.workspaceId },
        include: { stockItems: true },
      });

      if (product) {
        let stockItems: Array<{ quantity: number; reserved: number }> = product.stockItems;
        let variant: { name: string } | null = null;

        if (variantId) {
          const variantData = await this.prisma.productVariant.findUnique({
            where: { id: variantId },
            include: { stockItems: true },
          });
          if (variantData) {
            stockItems = variantData.stockItems;
            variant = { name: variantData.name };
          }
        }

        const availableStock = stockItems.reduce(
          (sum: number, s: { quantity: number; reserved: number }) => sum + s.quantity - s.reserved,
          0
        );
        const originalQty = await resolveOriginalOrderQuantity(
          this.memoryManager,
          context.sessionId,
          productId,
          variantId
        );
        const maxAllowed = availableStock + originalQty;

        if (maxAllowed < quantity) {
          const productName = buildProductDisplayName(product, variant);
          return {
            success: false,
            error: 'Stock insuficiente.',
            data: {
              insufficientStock: [
                {
                  productId,
                  variantId,
                  name: productName,
                  available: maxAllowed,
                  requested: quantity,
                  mode: 'set',
                },
              ],
              availableStock: maxAllowed,
              requestedQuantity: quantity,
            },
          };
        }
      }
    }

    const cart = await this.memoryManager.updateCartItem(
      context.sessionId,
      productId,
      quantity,
      variantId
    );

    if (!cart) {
      return { success: false, error: 'Carrito no encontrado' };
    }

    const item = cart.items.find(
      (i) => i.productId === productId && i.variantId === variantId
    );

    return {
      success: true,
      data: {
        action: quantity === 0 ? 'removed' : 'updated',
        item: item ? {
          name: item.name,
          quantity: item.quantity,
          total: item.total,
        } : null,
        cart: {
          itemCount: cart.items.length,
          subtotal: cart.subtotal,
          total: cart.total,
        },
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REMOVE FROM CART
// ═══════════════════════════════════════════════════════════════════════════════

const RemoveFromCartInput = z.object({
  productId: z.string().uuid().describe('ID del producto a eliminar'),
  variantId: z.string().uuid().optional().describe('ID de la variante (si aplica)'),
});

export class RemoveFromCartTool extends BaseTool<typeof RemoveFromCartInput> {
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    super({
      name: 'remove_from_cart',
      description: 'Elimina un producto del carrito.',
      category: ToolCategory.MUTATION,
      inputSchema: RemoveFromCartInput,
    });
    this.memoryManager = memoryManager;
  }

  async execute(input: z.infer<typeof RemoveFromCartInput>, context: ToolContext): Promise<ToolResult> {
    const { productId, variantId } = input;

    const cart = await this.memoryManager.removeFromCart(
      context.sessionId,
      productId,
      variantId
    );

    if (!cart) {
      return { success: false, error: 'Carrito no encontrado' };
    }

    return {
      success: true,
      data: {
        message: 'Producto eliminado del carrito',
        cart: {
          itemCount: cart.items.length,
          subtotal: cart.subtotal,
          total: cart.total,
        },
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLEAR CART
// ═══════════════════════════════════════════════════════════════════════════════

const ClearCartInput = z.object({}).describe('No requiere parámetros');

export class ClearCartTool extends BaseTool<typeof ClearCartInput> {
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    super({
      name: 'clear_cart',
      description: 'Vacía el carrito completamente.',
      category: ToolCategory.MUTATION,
      inputSchema: ClearCartInput,
    });
    this.memoryManager = memoryManager;
  }

  async execute(_input: z.infer<typeof ClearCartInput>, context: ToolContext): Promise<ToolResult> {
    await this.memoryManager.clearCart(context.sessionId);

    return {
      success: true,
      data: { message: 'Carrito vaciado' },
      stateTransition: AgentState.IDLE,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SET CART NOTES
// ═══════════════════════════════════════════════════════════════════════════════

const SetCartNotesInput = z.object({
  notes: z.string().max(500).describe('Notas o instrucciones para el pedido'),
});

export class SetCartNotesTool extends BaseTool<typeof SetCartNotesInput> {
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    super({
      name: 'set_cart_notes',
      description: 'Agrega notas o instrucciones especiales al pedido.',
      category: ToolCategory.MUTATION,
      inputSchema: SetCartNotesInput,
    });
    this.memoryManager = memoryManager;
  }

  async execute(input: z.infer<typeof SetCartNotesInput>, context: ToolContext): Promise<ToolResult> {
    const cart = await this.memoryManager.setCartNotes(context.sessionId, input.notes);

    if (!cart) {
      return { success: false, error: 'Carrito no encontrado' };
    }

    return {
      success: true,
      data: { message: 'Notas agregadas al pedido', notes: input.notes },
    };
  }
}

/**
 * Create all cart tools
 */
export function createCartTools(
  prisma: PrismaClient,
  memoryManager: MemoryManager
): BaseTool<any, any>[] {
  return [
    new GetCartTool(memoryManager),
    new AddToCartTool(prisma, memoryManager),
    new UpdateCartItemTool(prisma, memoryManager),
    new RemoveFromCartTool(memoryManager),
    new ClearCartTool(memoryManager),
    new SetCartNotesTool(memoryManager),
  ];
}
