/**
 * System Tools
 * Tools for agent control: handoff, state management
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult, AgentState } from '../../types/index.js';
import { createNotificationIfEnabled } from '../../utils/notifications.js';
import { withVisibleOrders } from '../../utils/orders.js';

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST HANDOFF
// ═══════════════════════════════════════════════════════════════════════════════

const RequestHandoffInput = z.object({
  reason: z.string().min(3).describe('Razón del handoff'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal').describe('Prioridad'),
  trigger: z.enum([
    'customer_request',    // Cliente pidió hablar con humano
    'agent_limitation',    // El agente no puede resolver
    'negative_sentiment',  // Cliente frustrado/enojado
    'sensitive_topic',     // Tema sensible (reclamo, problema)
    'processed_order',     // Pedido ya procesado, necesita modificación
    'authorization_needed', // Se necesita autorización (descuento, etc)
  ]).describe('Tipo de trigger'),
  context: z.string().optional().describe('Contexto adicional para el operador'),
});

export class RequestHandoffTool extends BaseTool<typeof RequestHandoffInput> {
  private prisma: PrismaClient;
  private static readonly REPEAT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

  constructor(prisma: PrismaClient) {
    super({
      name: 'request_handoff',
      description: 'Transfiere la conversación a un operador humano. Usar cuando el cliente lo pide, hay un problema que no podés resolver, o se necesita autorización.',
      category: ToolCategory.SYSTEM,
      inputSchema: RequestHandoffInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof RequestHandoffInput>, context: ToolContext): Promise<ToolResult> {
    const { reason, priority, trigger, context: additionalContext } = input;

    let existingHandoff = await this.prisma.handoffRequest.findFirst({
      where: {
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    if (existingHandoff) {
      const ageMs = now.getTime() - existingHandoff.createdAt.getTime();
      if (ageMs > RequestHandoffTool.REPEAT_WINDOW_MS) {
        await this.prisma.handoffRequest.updateMany({
          where: { id: existingHandoff.id, workspaceId: context.workspaceId },
          data: { status: 'expired', resolvedAt: now, resolution: 'Expired by new request' },
        });
        existingHandoff = null;
      }
    }

    const handoff = existingHandoff
      ? existingHandoff
      : await this.prisma.handoffRequest.create({
          data: {
            workspaceId: context.workspaceId,
            sessionId: context.sessionId,
            trigger,
            reason,
            priority,
            status: 'pending',
          },
        });

    try {
      await createNotificationIfEnabled(this.prisma, {
        workspaceId: context.workspaceId,
        type: 'handoff.requested',
        title: 'Solicitud de humano',
        message: existingHandoff
          ? 'Un cliente reiteró su solicitud de hablar con un humano'
          : 'Un cliente pidió hablar con un humano',
        entityType: 'Handoff',
        entityId: handoff.id,
        metadata: {
          sessionId: context.sessionId,
          customerId: context.customerId,
          trigger,
          priority,
          reason,
          repeat: Boolean(existingHandoff),
        },
      });
    } catch (error) {
      console.error('[RequestHandoff] Failed to create notification:', error);
    }

    const session = await this.prisma.agentSession.findFirst({
      where: { id: context.sessionId, workspaceId: context.workspaceId },
      select: { metadata: true },
    });
    const metadata = (session?.metadata as Record<string, unknown>) || {};

    // Update session metadata (sin desactivar IA ni forzar HANDOFF)
    await this.prisma.agentSession.updateMany({
      where: { id: context.sessionId, workspaceId: context.workspaceId },
      data: {
        lastFailure: reason,
        metadata: {
          ...metadata,
          handoffId: handoff.id,
          handoffReason: reason,
          handoffContext: additionalContext ?? null,
          handoffRequestedAt: new Date().toISOString(),
        },
      },
    });

    return {
      success: true,
      data: {
        handoffId: handoff.id,
        priority,
        message: 'Te voy a comunicar con un operador. En breve te atienden.',
      },
      // No forzar transición a HANDOFF: la IA sigue activa hasta que el humano tome control.
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPEAT LAST ORDER
// ═══════════════════════════════════════════════════════════════════════════════

const RepeatLastOrderInput = z.object({
  orderNumber: z.string().optional().describe('Número de orden específica a repetir'),
  orderId: z.string().uuid().optional().describe('ID de orden específica'),
});

export class RepeatLastOrderTool extends BaseTool<typeof RepeatLastOrderInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'repeat_last_order',
      description: 'Obtiene los items del último pedido del cliente para facilitar "repetir pedido". NO crea el pedido, solo devuelve los items.',
      category: ToolCategory.QUERY,
      inputSchema: RepeatLastOrderInput,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof RepeatLastOrderInput>, context: ToolContext): Promise<ToolResult> {
    const { orderNumber, orderId } = input;

    // Build query
    const where: any = {
      customerId: context.customerId,
      workspaceId: context.workspaceId,
      status: { notIn: ['cancelled', 'draft'] },
    };

    if (orderId) {
      where.id = orderId;
    } else if (orderNumber) {
      where.orderNumber = orderNumber;
    }

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders(where),
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            product: {
              include: {
                stockItems: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return {
        success: false,
        error: 'No encontré pedidos anteriores para repetir',
      };
    }

    // Check current stock for each item
    const items = order.items.map((item) => {
      const currentStock = item.product.stockItems.reduce(
        (sum, s) => sum + s.quantity - s.reserved,
        0
      );
      return {
        productId: item.productId,
        variantId: item.variantId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        originalPrice: item.unitPrice,
        currentPrice: item.product.price,
        currentStock,
        available: currentStock >= item.quantity,
        priceChanged: item.product.price !== item.unitPrice,
      };
    });

    const allAvailable = items.every((i) => i.available);
    const hasChanges = items.some((i) => i.priceChanged);

    return {
      success: true,
      data: {
        sourceOrder: {
          orderNumber: order.orderNumber,
          date: order.createdAt,
          total: order.total,
        },
        items,
        allAvailable,
        hasChanges,
        message: allAvailable
          ? 'Todos los productos del pedido anterior están disponibles'
          : 'Algunos productos tienen stock limitado',
      },
    };
  }
}

// Note: SetShippingAddress tool is handled by cart.tools.ts MemoryManager

/**
 * Create all system tools
 */
export function createSystemTools(prisma: PrismaClient): BaseTool<any, any>[] {
  return [
    new RequestHandoffTool(prisma),
    new RepeatLastOrderTool(prisma),
  ];
}
