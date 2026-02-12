/**
 * Order Tools - ENTREGABLE 5
 * Transactional order management with stock control
 *
 * Features:
 * - workspace_id in all queries (policy checks)
 * - Idempotency keys for mutations
 * - StockMove tracking for all stock changes
 * - PROCESSED status protection
 */
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult, AgentState } from '../../types/index.js';
import { MemoryManager } from '../../core/memory-manager.js';
import { buildProductDisplayName } from './product-utils.js';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { withVisibleOrders } from '../../utils/orders.js';
import { getEffectivePlanLimits, resolveWorkspacePlan } from '../../utils/commerce-plan-limits.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & POLICIES
// ═══════════════════════════════════════════════════════════════════════════════

// Order statuses that can be modified by agent
const MODIFIABLE_STATUSES = ['draft', 'awaiting_acceptance', 'pending_payment', 'paid'] as const;

// Order statuses that are "processed" - NO modifications allowed
const PROCESSED_STATUSES = ['accepted', 'processing', 'shipped', 'delivered', 'invoiced'] as const;

// Stock movement types
const STOCK_MOVE_TYPE = {
  RESERVATION: 'reservation',
  RELEASE: 'release',
  SALE: 'sale',
  REVERSAL: 'reversal',
  ADJUSTMENT: 'adjustment',
} as const;

/**
 * Policy check: can modify this order?
 */
function canModifyOrder(status: string): { allowed: boolean; reason?: string } {
  if (PROCESSED_STATUSES.includes(status as any)) {
    return {
      allowed: false,
      reason: `El pedido está en estado "${status}" y no puede ser modificado. Necesitás hablar con un operador.`,
    };
  }
  if (status === 'cancelled') {
    return { allowed: false, reason: 'El pedido ya está cancelado.' };
  }
  return { allowed: true };
}

/**
 * Generate idempotency key from cart content
 */
function generateCartHash(items: Array<{ productId: string; variantId?: string; quantity: number }>): string {
  const content = items
    .map((i) => `${i.productId}:${i.variantId || 'none'}:${i.quantity}`)
    .sort()
    .join('|');
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function formatMoneyCents(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

type InsufficientStockDetail = {
  productId?: string;
  variantId?: string;
  name: string;
  available: number;
  requested: number;
  mode?: 'add' | 'set';
};

class InsufficientStockError extends Error {
  details: InsufficientStockDetail[];

  constructor(details: InsufficientStockDetail[]) {
    super('Stock insuficiente');
    this.details = details;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRM ORDER (from cart)
// ═══════════════════════════════════════════════════════════════════════════════

const ConfirmOrderInput = z.object({
  notes: z.string().max(500).optional().describe('Notas adicionales del cliente'),
});

export class ConfirmOrderTool extends BaseTool<typeof ConfirmOrderInput> {
  private prisma: PrismaClient;
  private memoryManager: MemoryManager;

  private async generateOrderNumber(workspaceId: string): Promise<string> {
    const lastOrder = await this.prisma.order.findFirst({
      where: { workspaceId, orderNumber: { startsWith: 'ORD-' } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });

    let sequence = 1;
    if (lastOrder?.orderNumber) {
      const match = lastOrder.orderNumber.match(/ORD-(\d+)/i);
      if (match) {
        const lastSeq = Number(match[1]);
        if (Number.isFinite(lastSeq)) {
          sequence = lastSeq + 1;
        }
      }
    }

    return `ORD-${String(sequence).padStart(5, '0')}`;
  }

  constructor(prisma: PrismaClient, memoryManager: MemoryManager) {
    super({
      name: 'confirm_order',
      description:
        'Confirma el pedido actual creando una orden desde el carrito. SOLO usar después de que el cliente confirme explícitamente. Descuenta stock y crea movimientos.',
      category: ToolCategory.MUTATION,
      inputSchema: ConfirmOrderInput,
      requiresConfirmation: true,
      idempotencyKey: (input) => {
        // Will be replaced with actual cart hash in execute
        return `confirm_order_${Date.now()}`;
      },
    });
    this.prisma = prisma;
    this.memoryManager = memoryManager;
  }

  async execute(
    input: z.infer<typeof ConfirmOrderInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { notes } = input;

    // 1. Get cart from memory
    const cart = await this.memoryManager.getCart(context.sessionId);
    if (!cart || cart.items.length === 0) {
      return { success: false, error: 'El carrito está vacío' };
    }

    // 2. Generate idempotency key from cart content
    const cartHash = generateCartHash(
      cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity }))
    );
    const timeBucket = Math.floor(Date.now() / 60000); // minute-level idempotency
    const idempotencyKey = `confirm_order:${context.sessionId}:${cartHash}:${timeBucket}`;

    // 3. Check idempotency
    const storedOrderId = await this.memoryManager.getIdempotencyValue(idempotencyKey);
    if (storedOrderId && storedOrderId !== '1') {
      const existingOrder = await this.prisma.order.findFirst({
        where: withVisibleOrders({
          id: storedOrderId,
          workspaceId: context.workspaceId,
          customerId: context.customerId,
        }),
      });
      if (existingOrder) {
        return {
          success: true,
          data: {
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            total: existingOrder.total,
            status: existingOrder.status,
            message: `Este pedido ya fue confirmado: ${existingOrder.orderNumber}`,
            duplicate: true,
          },
        };
      }
    }

    // 3.5 Enforce plan order quota (monthly)
    const plan = await resolveWorkspacePlan(this.prisma, context.workspaceId);
    const planLimits = await getEffectivePlanLimits(this.prisma, plan);
    const monthlyLimit = planLimits.ordersPerMonth;
    if (monthlyLimit !== null) {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      const createdThisMonth = await this.prisma.order.count({
        where: {
          workspaceId: context.workspaceId,
          createdAt: { gte: start, lte: end },
        },
      });
      if (createdThisMonth >= monthlyLimit) {
        return {
          success: false,
          error: `Alcanzaste el límite mensual de pedidos (${monthlyLimit}).`,
        };
      }
    }

    // 4. Validate stock for all items (pre-check)
    const stockValidation = await this.validateStock(cart.items);
    if (!stockValidation.valid) {
      return {
        success: false,
        error: stockValidation.error,
        data: { insufficientStock: stockValidation.details },
      };
    }

    // 5. Generate order number + create order in transaction with stock deduction
    let orderNumber = await this.generateOrderNumber(context.workspaceId);
    let order: { id: string; orderNumber: string; total: number; status: string; customerId: string } | null = null;
    const maxAttempts = 5;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          order = await this.prisma.$transaction(
            async (tx) => {
              const newOrder = await tx.order.create({
                data: {
                  workspaceId: context.workspaceId,
                  customerId: context.customerId,
                  sessionId: context.sessionId,
                  orderNumber,
                  status: 'awaiting_acceptance',
                  subtotal: cart.subtotal,
                  shipping: cart.shipping,
                  discount: cart.discount,
                  total: cart.total,
                  notes: notes || cart.notes,
                  shippingAddress: cart.shippingAddress
                    ? (cart.shippingAddress as unknown as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                },
              });

          // Create order items and handle stock
          for (const item of cart.items) {
            // Create order item
            await tx.orderItem.create({
              data: {
                orderId: newOrder.id,
                productId: item.productId,
                variantId: item.variantId,
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
              },
            });

            // Find stock item
            const stockItem = await tx.stockItem.findFirst({
              where: {
                productId: item.productId,
                variantId: item.variantId ?? null,
              },
            });

            if (!stockItem) {
              throw new Error(`Stock no encontrado para ${item.name}`);
            }

            // Calculate available (double-check in transaction)
            const availableInTx = stockItem.quantity - stockItem.reserved;
            if (availableInTx < item.quantity) {
              throw new InsufficientStockError([
                {
                  productId: item.productId,
                  variantId: item.variantId,
                  name: item.name,
                  available: availableInTx,
                  requested: item.quantity,
                  mode: 'set',
                },
              ]);
            }

            // Update stock (reserve)
            await tx.stockItem.update({
              where: { id: stockItem.id },
              data: { reserved: { increment: item.quantity } },
            });

            // Create stock movement (RESERVATION)
            await tx.stockMovement.create({
              data: {
                stockItemId: stockItem.id,
                type: STOCK_MOVE_TYPE.RESERVATION,
                quantity: -item.quantity,
                previousQty: availableInTx,
                newQty: availableInTx - item.quantity,
                reason: `Reserva para orden ${orderNumber}`,
                referenceType: 'Order',
                referenceId: newOrder.id,
              },
            });

            // Create stock reservation record
            await tx.stockReservation.create({
              data: {
                orderId: newOrder.id,
                productId: item.productId,
                variantId: item.variantId ?? null,
                quantity: item.quantity,
                status: 'active',
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
              },
            });
          }

          // Create status history
          await tx.orderStatusHistory.create({
            data: {
              orderId: newOrder.id,
              previousStatus: null,
              newStatus: 'awaiting_acceptance',
              reason: 'Pedido confirmado por cliente via WhatsApp',
              changedBy: 'agent',
            },
          });

          // Update customer stats
          await tx.customer.updateMany({
            where: { id: context.customerId, workspaceId: context.workspaceId },
            data: {
              orderCount: { increment: 1 },
              totalSpent: { increment: BigInt(cart.total) },
              lastOrderAt: new Date(),
            },
          });

              return newOrder;
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 15000,
            }
          );
          break;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            orderNumber = await this.generateOrderNumber(context.workspaceId);
            continue;
          }
          throw error;
        }
      }

      if (!order) {
        throw new Error('No se pudo generar un número de pedido');
      }

      try {
        await createNotificationIfEnabled(this.prisma, {
          workspaceId: context.workspaceId,
          type: 'order.new',
          title: 'Nuevo pedido',
          message: `Pedido ${order.orderNumber} confirmado`,
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            customerId: order.customerId,
            sessionId: context.sessionId,
          },
        });
      } catch (error) {
        console.error('[ConfirmOrder] Failed to create notification:', error);
      }

      // 7. Mark idempotency with orderId for dedupe
      await this.memoryManager.setIdempotencyValue(idempotencyKey, order.id, 3600 * 24); // 24h

      // 8. Clear cart
      await this.memoryManager.clearCart(context.sessionId);

      // 9. Store order ID in context
      await this.memoryManager.setPendingOrderId(context.sessionId, order.id);

      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: order.total,
          status: order.status,
          itemCount: cart.items.length,
          message: `¡Pedido ${order.orderNumber} confirmado! Total: $${formatMoneyCents(order.total)}`,
        },
        stateTransition: AgentState.DONE,
      };
    } catch (error) {
      console.error('[ConfirmOrder] Transaction failed:', error);
      if (error instanceof InsufficientStockError) {
        return {
          success: false,
          error: 'Stock insuficiente.',
          data: { insufficientStock: error.details },
        };
      }
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error al confirmar el pedido. Intentá de nuevo.',
      };
    }
  }

  private async validateStock(
    items: Array<{ productId: string; variantId?: string; name: string; quantity: number }>
  ): Promise<{ valid: boolean; error?: string; details?: InsufficientStockDetail[] }> {
    const insufficientStock: InsufficientStockDetail[] = [];

    for (const item of items) {
      const stockItems = await this.prisma.stockItem.findMany({
        where: { productId: item.productId, variantId: item.variantId ?? null },
      });
      const available = stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);

      if (available < item.quantity) {
        insufficientStock.push({
          productId: item.productId,
          variantId: item.variantId,
          name: item.name,
          available,
          requested: item.quantity,
          mode: 'set',
        });
      }
    }

    if (insufficientStock.length > 0) {
      return {
        valid: false,
        error: 'Stock insuficiente.',
        details: insufficientStock,
      };
    }

    return { valid: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET ORDER DETAILS
// ═══════════════════════════════════════════════════════════════════════════════

const GetOrderDetailsInput = z
  .object({
    orderNumber: z.string().optional().describe('Número de orden (ej: ORD-00001)'),
    orderId: z.string().uuid().optional().describe('ID de la orden'),
  })
  .refine((data) => data.orderNumber || data.orderId, {
    message: 'Debe proporcionar orderNumber u orderId',
  });

export class GetOrderDetailsTool extends BaseTool<typeof GetOrderDetailsInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_order_details',
      description: 'Obtiene detalles de una orden: estado, items, pagos, si se puede modificar.',
      category: ToolCategory.QUERY,
      inputSchema: GetOrderDetailsInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof GetOrderDetailsInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { orderNumber, orderId } = input;

    // Policy: always filter by workspace
    const where: Prisma.OrderWhereInput = {
      workspaceId: context.workspaceId,
      customerId: context.customerId,
    };

    if (orderId) {
      where.id = orderId;
    } else if (orderNumber) {
      where.orderNumber = orderNumber;
    }

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders(where),
      include: {
        items: true,
        payments: {
          select: {
            id: true,
            amount: true,
            status: true,
            method: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      return { success: false, error: 'Orden no encontrada' };
    }

    const policy = canModifyOrder(order.status);
    const paidAmount = order.payments
      .filter((p) => p.status === 'completed')
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      success: true,
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        canModify: policy.allowed,
        isProcessed: PROCESSED_STATUSES.includes(order.status as any),
        items: order.items.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
        })),
        subtotal: order.subtotal,
        shipping: order.shipping,
        discount: order.discount,
        total: order.total,
        payments: order.payments,
        paidAmount,
        pendingAmount: order.total - paidAmount,
        createdAt: order.createdAt,
        notes: order.notes,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANCEL ORDER IF NOT PROCESSED
// ═══════════════════════════════════════════════════════════════════════════════

const CancelOrderInput = z
  .object({
    orderNumber: z.string().optional().describe('Número de orden'),
    orderId: z.string().uuid().optional().describe('ID de la orden'),
    reason: z.string().min(3).max(500).describe('Razón de la cancelación'),
  })
  .refine((data) => data.orderNumber || data.orderId, {
    message: 'Debe proporcionar orderNumber u orderId',
  });

export class CancelOrderIfNotProcessedTool extends BaseTool<typeof CancelOrderInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'cancel_order_if_not_processed',
      description:
        'Cancela un pedido y revierte el stock si NO está PROCESADO. Si está procesado, requiere HANDOFF.',
      category: ToolCategory.MUTATION,
      inputSchema: CancelOrderInput,
      requiresConfirmation: true,
      idempotencyKey: (input) =>
        `cancel_order:${input.orderId || input.orderNumber}`,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof CancelOrderInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { orderNumber, orderId, reason } = input;

    // Policy: always filter by workspace
    const where: Prisma.OrderWhereInput = {
      workspaceId: context.workspaceId,
      customerId: context.customerId,
    };

    if (orderId) {
      where.id = orderId;
    } else if (orderNumber) {
      where.orderNumber = orderNumber;
    }

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders(where),
      include: { items: true },
    });

    if (!order) {
      return { success: false, error: 'Orden no encontrada' };
    }

    // Check if already cancelled
    if (order.status === 'cancelled') {
      return {
        success: true,
        data: {
          orderNumber: order.orderNumber,
          message: 'La orden ya está cancelada.',
          alreadyCancelled: true,
        },
      };
    }

    // Policy check
    const policy = canModifyOrder(order.status);
    if (!policy.allowed) {
      return {
        success: false,
        error: policy.reason,
        stateTransition: AgentState.HANDOFF,
      };
    }

    // Cancel in transaction with stock reversal
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Update order status
          await tx.order.updateMany({
            where: { id: order.id, workspaceId: context.workspaceId },
            data: {
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelReason: reason,
            },
          });

          // Get and release all active reservations
          const reservations = await tx.stockReservation.findMany({
            where: { orderId: order.id, status: 'active' },
          });

          for (const reservation of reservations) {
            // Update reservation status
            await tx.stockReservation.update({
              where: { id: reservation.id },
              data: { status: 'released', releasedAt: new Date() },
            });

            // Find stock item
            const stockItem = await tx.stockItem.findFirst({
              where: {
                productId: reservation.productId,
                variantId: reservation.variantId ?? null,
              },
            });

            if (stockItem) {
              const currentAvailable = stockItem.quantity - stockItem.reserved;

              // Release reserved stock
              await tx.stockItem.update({
                where: { id: stockItem.id },
                data: { reserved: { decrement: reservation.quantity } },
              });

              // Create stock movement (REVERSAL)
              await tx.stockMovement.create({
                data: {
                  stockItemId: stockItem.id,
                  type: STOCK_MOVE_TYPE.REVERSAL,
                  quantity: reservation.quantity,
                  previousQty: currentAvailable,
                  newQty: currentAvailable + reservation.quantity,
                  reason: `Cancelación de orden ${order.orderNumber}: ${reason}`,
                  referenceType: 'Order',
                  referenceId: order.id,
                },
              });
            }
          }

          // Create status history
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              previousStatus: order.status,
              newStatus: 'cancelled',
              reason,
              changedBy: 'agent',
            },
          });

          // Revert customer stats
          await tx.customer.updateMany({
            where: { id: context.customerId, workspaceId: context.workspaceId },
            data: {
              orderCount: { decrement: 1 },
              totalSpent: { decrement: BigInt(order.total) },
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        }
      );

      try {
        await createNotificationIfEnabled(this.prisma, {
          workspaceId: context.workspaceId,
          type: 'order.cancelled',
          title: 'Pedido cancelado',
          message: `Pedido ${order.orderNumber} cancelado`,
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: context.customerId,
            sessionId: context.sessionId,
            reason,
          },
        });
      } catch (error) {
        console.error('[CancelOrder] Failed to create notification:', error);
      }

      return {
        success: true,
        data: {
          orderNumber: order.orderNumber,
          message: `Pedido ${order.orderNumber} cancelado. El stock fue devuelto.`,
        },
        stateTransition: AgentState.IDLE,
      };
    } catch (error) {
      console.error('[CancelOrder] Transaction failed:', error);
      return {
        success: false,
        error: 'Error al cancelar el pedido. Intentá de nuevo.',
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODIFY ORDER IF NOT PROCESSED
// ═══════════════════════════════════════════════════════════════════════════════

const ModifyOrderInput = z
  .object({
    orderNumber: z.string().optional().describe('Número de orden'),
    orderId: z.string().uuid().optional().describe('ID de la orden'),
    action: z
      .enum(['add', 'remove', 'update_quantity'])
      .describe('Acción: add, remove, update_quantity'),
    productId: z.string().uuid().describe('ID del producto'),
    variantId: z.string().uuid().optional().describe('ID de la variante'),
    quantity: z.number().int().min(0).describe('Cantidad (0 para eliminar)'),
  })
  .refine((data) => data.orderNumber || data.orderId, {
    message: 'Debe proporcionar orderNumber u orderId',
  });

export class ModifyOrderIfNotProcessedTool extends BaseTool<typeof ModifyOrderInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'modify_order_if_not_processed',
      description:
        'Modifica items de un pedido NO PROCESADO. Ajusta stock delta en transacción.',
      category: ToolCategory.MUTATION,
      inputSchema: ModifyOrderInput,
      requiresConfirmation: true,
      idempotencyKey: (input) =>
        `modify_order:${input.orderId || input.orderNumber}:${input.action}:${input.productId}:${input.quantity}`,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof ModifyOrderInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { orderNumber, orderId, action, productId, variantId, quantity } = input;

    // Policy: always filter by workspace
    const where: Prisma.OrderWhereInput = { workspaceId: context.workspaceId };
    if (orderId) where.id = orderId;
    else if (orderNumber) where.orderNumber = orderNumber;

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders(where),
      include: { items: true },
    });

    if (!order) {
      return { success: false, error: 'Orden no encontrada' };
    }

    // Policy check
    const policy = canModifyOrder(order.status);
    if (!policy.allowed) {
      return {
        success: false,
        error: policy.reason,
        stateTransition: AgentState.HANDOFF,
      };
    }

    // Get product
    const product = await this.prisma.product.findFirst({
      where: { id: productId, workspaceId: context.workspaceId },
    });

    if (!product) {
      return { success: false, error: 'Producto no encontrado' };
    }

    // Get variant if specified
    const variant = variantId
      ? await this.prisma.productVariant.findUnique({ where: { id: variantId } })
      : null;
    const unitPrice = variant?.price ?? product.price;
    const productName = buildProductDisplayName(product, variant);

    try {
      const updatedOrder = await this.prisma.$transaction(
        async (tx) => {
          const normalizedVariantId = variantId ?? null;
          const existingItem = order.items.find(
            (i) => i.productId === productId && (i.variantId ?? null) === normalizedVariantId
          );
          let effectiveAction = action;
          let effectiveQuantity = quantity;

          if (action === 'add' && existingItem) {
            // Treat "add" as increment when item already exists
            effectiveAction = 'update_quantity';
            effectiveQuantity = existingItem.quantity + quantity;
          }

          // Get stock item
          const stockItem = await tx.stockItem.findFirst({
            where: { productId, variantId: normalizedVariantId },
          });

          if (!stockItem) {
            throw new Error(`Stock no encontrado para ${productName}`);
          }

          const currentAvailable = stockItem.quantity - stockItem.reserved;

          if (effectiveAction === 'add' || (effectiveAction === 'update_quantity' && !existingItem)) {
            // ADD: new item to order
            if (currentAvailable < effectiveQuantity) {
              throw new InsufficientStockError([
                {
                  productId,
                  variantId,
                  name: productName,
                  available: currentAvailable,
                  requested: effectiveQuantity,
                  mode: 'set',
                },
              ]);
            }

            // Create order item
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId,
                variantId,
                sku: variant?.sku || product.sku,
                name: productName,
                quantity: effectiveQuantity,
                unitPrice,
                total: unitPrice * effectiveQuantity,
              },
            });

            // Reserve stock
            await tx.stockItem.update({
              where: { id: stockItem.id },
              data: { reserved: { increment: effectiveQuantity } },
            });

            // Create stock movement
            await tx.stockMovement.create({
              data: {
                stockItemId: stockItem.id,
                type: STOCK_MOVE_TYPE.RESERVATION,
                quantity: -effectiveQuantity,
                previousQty: currentAvailable,
                newQty: currentAvailable - effectiveQuantity,
                reason: `Agregado a orden ${order.orderNumber}`,
                referenceType: 'Order',
                referenceId: order.id,
              },
            });

            // Find or create reservation
            const existingReservation = await tx.stockReservation.findFirst({
              where: {
                orderId: order.id,
                productId,
                variantId: variantId ?? null,
                status: 'active',
              },
            });

            if (existingReservation) {
              await tx.stockReservation.update({
                where: { id: existingReservation.id },
                data: { quantity: { increment: effectiveQuantity } },
              });
            } else {
              await tx.stockReservation.create({
                data: {
                  orderId: order.id,
                  productId,
                  variantId: variantId ?? null,
                  quantity: effectiveQuantity,
                  status: 'active',
                  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
              });
            }
          } else if (effectiveAction === 'remove' || (effectiveAction === 'update_quantity' && effectiveQuantity === 0)) {
            // REMOVE: delete item from order
            if (!existingItem) {
              throw new Error('Item no encontrado en la orden');
            }

            // Delete order item
            await tx.orderItem.delete({ where: { id: existingItem.id } });

            // Release stock
            await tx.stockItem.update({
              where: { id: stockItem.id },
              data: { reserved: { decrement: existingItem.quantity } },
            });

            // Create stock movement (release)
            await tx.stockMovement.create({
              data: {
                stockItemId: stockItem.id,
                type: STOCK_MOVE_TYPE.RELEASE,
                quantity: existingItem.quantity,
                previousQty: currentAvailable,
                newQty: currentAvailable + existingItem.quantity,
                reason: `Removido de orden ${order.orderNumber}`,
                referenceType: 'Order',
                referenceId: order.id,
              },
            });

            // Update reservation
            await tx.stockReservation.updateMany({
              where: {
                orderId: order.id,
                productId,
                variantId: variantId ?? null,
                status: 'active',
              },
              data: {
                quantity: { decrement: existingItem.quantity },
              },
            });
          } else if (effectiveAction === 'update_quantity' && existingItem) {
            // UPDATE QUANTITY: adjust item quantity
            const delta = effectiveQuantity - existingItem.quantity;

            if (delta > 0) {
              // Increasing quantity - need more stock
              if (currentAvailable < delta) {
                throw new InsufficientStockError([
                  {
                    productId,
                    variantId,
                    name: productName,
                    available: currentAvailable,
                    requested: delta,
                    mode: 'add',
                  },
                ]);
              }

              await tx.stockItem.update({
                where: { id: stockItem.id },
                data: { reserved: { increment: delta } },
              });

              await tx.stockMovement.create({
                data: {
                  stockItemId: stockItem.id,
                  type: STOCK_MOVE_TYPE.RESERVATION,
                  quantity: -delta,
                  previousQty: currentAvailable,
                  newQty: currentAvailable - delta,
                  reason: `Cantidad aumentada en orden ${order.orderNumber}`,
                  referenceType: 'Order',
                  referenceId: order.id,
                },
              });
            } else if (delta < 0) {
              // Decreasing quantity - release stock
              await tx.stockItem.update({
                where: { id: stockItem.id },
                data: { reserved: { decrement: Math.abs(delta) } },
              });

              await tx.stockMovement.create({
                data: {
                  stockItemId: stockItem.id,
                  type: STOCK_MOVE_TYPE.RELEASE,
                  quantity: Math.abs(delta),
                  previousQty: currentAvailable,
                  newQty: currentAvailable + Math.abs(delta),
                  reason: `Cantidad reducida en orden ${order.orderNumber}`,
                  referenceType: 'Order',
                  referenceId: order.id,
                },
              });
            }

            // Update order item
            await tx.orderItem.update({
              where: { id: existingItem.id },
              data: {
                quantity: effectiveQuantity,
                total: unitPrice * effectiveQuantity,
              },
            });

            // Update reservation
            await tx.stockReservation.updateMany({
              where: {
                orderId: order.id,
                productId,
                variantId: variantId ?? null,
                status: 'active',
              },
              data: { quantity: effectiveQuantity },
            });
          }

          // Recalculate order totals
          const updatedItems = await tx.orderItem.findMany({
            where: { orderId: order.id },
          });
          const subtotal = updatedItems.reduce((sum, i) => sum + i.total, 0);

          await tx.order.updateMany({
            where: { id: order.id, workspaceId: context.workspaceId },
            data: {
              subtotal,
              total: subtotal + order.shipping - order.discount,
            },
          });

          const updatedOrder = await tx.order.findFirst({
            where: withVisibleOrders({ id: order.id, workspaceId: context.workspaceId }),
            include: { items: true },
          });

          if (!updatedOrder) {
            throw new Error('Pedido no encontrado');
          }

          return updatedOrder;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        }
      );

      try {
        await createNotificationIfEnabled(this.prisma, {
          workspaceId: context.workspaceId,
          type: 'order.edited',
          title: 'Pedido editado',
          message: `Pedido ${order.orderNumber} modificado`,
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: context.customerId,
            sessionId: context.sessionId,
            action,
            productId,
            quantity,
          },
        });
      } catch (error) {
        console.error('[ModifyOrder] Failed to create notification:', error);
      }

      return {
        success: true,
        data: {
          orderNumber: order.orderNumber,
          action,
          productName,
          quantity,
          items: updatedOrder.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            total: i.total,
          })),
          newTotal: updatedOrder.total,
          message: `Pedido ${order.orderNumber} modificado. Nuevo total: $${formatMoneyCents(updatedOrder.total)}`,
        },
      };
    } catch (error) {
      console.error('[ModifyOrder] Transaction failed:', error);
      if (error instanceof InsufficientStockError) {
        return {
          success: false,
          error: 'Stock insuficiente.',
          data: { insufficientStock: error.details },
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error al modificar el pedido',
      };
    }
  }
}

/**
 * Create all order tools
 */
export function createOrderTools(
  prisma: PrismaClient,
  memoryManager: MemoryManager
): BaseTool<any, any>[] {
  return [
    new ConfirmOrderTool(prisma, memoryManager),
    new GetOrderDetailsTool(prisma),
    new CancelOrderIfNotProcessedTool(prisma),
    new ModifyOrderIfNotProcessedTool(prisma),
  ];
}
