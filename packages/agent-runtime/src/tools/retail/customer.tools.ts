/**
 * Customer Tools - ENTREGABLE 5
 * Customer management with workspace isolation
 *
 * Features:
 * - workspace_id in all queries
 * - get_or_create_customer_by_phone
 * - set_customer_identity (dni/full_name)
 * - get_customer_notes (for conversation start)
 */
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult, CustomerInfo } from '../../types/index.js';
import { withVisibleOrders } from '../../utils/orders.js';

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

// DNI validation (Argentina)
const dniSchema = z
  .string()
  .min(7)
  .max(11)
  .regex(/^\d+$/, 'DNI debe contener solo números')
  .transform((val) => val.replace(/\D/g, ''));

// Phone validation (E.164 format)
const phoneSchema = z
  .string()
  .min(8)
  .transform((val) => {
    const cleaned = val.replace(/\s/g, '');
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  });

// ═══════════════════════════════════════════════════════════════════════════════
// GET OR CREATE CUSTOMER BY PHONE
// ═══════════════════════════════════════════════════════════════════════════════

const GetOrCreateCustomerInput = z.object({
  phone: phoneSchema.describe('Número de teléfono del cliente (formato E.164)'),
});

export class GetOrCreateCustomerByPhoneTool extends BaseTool<typeof GetOrCreateCustomerInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_or_create_customer_by_phone',
      description:
        'Busca un cliente por teléfono o lo crea si no existe. Retorna info completa incluyendo si necesita completar datos.',
      category: ToolCategory.MUTATION,
      inputSchema: GetOrCreateCustomerInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof GetOrCreateCustomerInput>,
    context: ToolContext
  ): Promise<ToolResult<CustomerInfo>> {
    const { phone } = input;

    // Try to find existing customer
    let customer = await this.prisma.customer.findUnique({
      where: {
        workspaceId_phone: {
          workspaceId: context.workspaceId,
          phone,
        },
      },
      include: {
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { content: true },
        },
      },
    });

    let isNew = false;
    let customerNotes: string[] = [];

    if (!customer) {
      // Create new customer
      const newCustomer = await this.prisma.customer.create({
        data: {
          workspaceId: context.workspaceId,
          phone,
          status: 'active',
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
      customer = { ...newCustomer, notes: [] };
      isNew = true;
    } else {
      // Update last seen
      await this.prisma.customer.updateMany({
        where: { id: customer.id, workspaceId: context.workspaceId },
        data: { lastSeenAt: new Date() },
      });
      customerNotes = customer.notes.map((n) => n.content);
    }

    // Get customer info from metadata
    const metadata = (customer.metadata as Record<string, unknown>) || {};
    const dni = metadata.dni as string | undefined;

    // Calculate debt
    const pendingPayments = await this.prisma.payment.aggregate({
      where: {
        order: {
          customerId: customer.id,
          workspaceId: context.workspaceId,
        },
        status: 'pending',
      },
      _sum: { amount: true },
    });

    const debt = pendingPayments._sum.amount || 0;

    const info: CustomerInfo = {
      id: customer.id,
      phone: customer.phone,
      firstName: customer.firstName || undefined,
      lastName: customer.lastName || undefined,
      dni,
      email: customer.email || undefined,
      isNew,
      needsRegistration: !customer.firstName || !customer.lastName || !dni,
      preferences: (customer.preferences as Record<string, unknown>) || {},
      notes: customerNotes.length > 0 ? customerNotes : undefined,
      totalOrders: customer.orderCount,
      totalSpent: Number(customer.totalSpent),
      lastOrderAt: customer.lastOrderAt || undefined,
      debt,
    };

    return {
      success: true,
      data: info,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SET CUSTOMER IDENTITY (dni + full name)
// ═══════════════════════════════════════════════════════════════════════════════

const SetCustomerIdentityInput = z.object({
  firstName: z
    .string()
    .min(2, 'Nombre debe tener al menos 2 caracteres')
    .max(100)
    .describe('Nombre del cliente'),
  lastName: z
    .string()
    .min(2, 'Apellido debe tener al menos 2 caracteres')
    .max(100)
    .describe('Apellido del cliente'),
  dni: dniSchema.describe('DNI del cliente (solo números)'),
});

export class SetCustomerIdentityTool extends BaseTool<typeof SetCustomerIdentityInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'set_customer_identity',
      description:
        'Establece la identidad del cliente (nombre completo y DNI). Usar cuando el cliente proporciona sus datos de facturación.',
      category: ToolCategory.MUTATION,
      inputSchema: SetCustomerIdentityInput,
      idempotencyKey: (input) => `set_identity:${input.dni}`,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof SetCustomerIdentityInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { firstName, lastName, dni } = input;

    // Get current customer
    const customer = await this.prisma.customer.findFirst({
      where: { id: context.customerId, workspaceId: context.workspaceId },
    });

    if (!customer) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    // Check if DNI is already used by another customer in this workspace
    const existingWithDni = await this.prisma.customer.findFirst({
      where: {
        workspaceId: context.workspaceId,
        id: { not: context.customerId },
        metadata: {
          path: ['dni'],
          equals: dni,
        },
      },
    });

    if (existingWithDni) {
      return {
        success: false,
        error: `Este DNI ya está registrado para otro cliente (${existingWithDni.firstName} ${existingWithDni.lastName})`,
      };
    }

    // Update customer
    const currentMetadata = (customer.metadata as Record<string, unknown>) || {};

    await this.prisma.customer.updateMany({
      where: { id: context.customerId, workspaceId: context.workspaceId },
      data: {
        firstName,
        lastName,
        metadata: {
          ...currentMetadata,
          dni,
          identitySetAt: new Date().toISOString(),
        },
      },
    });

    return {
      success: true,
      data: {
        message: `Datos guardados: ${firstName} ${lastName} (DNI: ${dni})`,
        fullName: `${firstName} ${lastName}`,
        dni,
        needsRegistration: false,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET CUSTOMER NOTES (for conversation start)
// ═══════════════════════════════════════════════════════════════════════════════

const GetCustomerNotesInput = z.object({}).describe('No requiere parámetros');

export class GetCustomerNotesTool extends BaseTool<typeof GetCustomerNotesInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_customer_notes',
      description:
        'Obtiene las notas y preferencias guardadas del cliente. Usar al inicio de cada conversación para personalizar la atención.',
      category: ToolCategory.QUERY,
      inputSchema: GetCustomerNotesInput,
    });
    this.prisma = prisma;
  }

  async execute(
    _input: z.infer<typeof GetCustomerNotesInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: context.customerId, workspaceId: context.workspaceId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        metadata: true,
        preferences: true,
        orderCount: true,
        totalSpent: true,
        lastOrderAt: true,
        paymentScore: true,
        currentBalance: true,
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            content: true,
            createdBy: true,
            createdAt: true,
          },
        },
      },
    });

    if (!customer) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    const preferences = (customer.preferences as Record<string, unknown>) || {};

    // Get score label
    const getScoreLabel = (score: number) => {
      if (score >= 80) return 'excelente';
      if (score >= 60) return 'bueno';
      if (score >= 40) return 'regular';
      return 'riesgoso';
    };

    return {
      success: true,
      data: {
        hasNotes: customer.notes.length > 0,
        notes: customer.notes.map((n) => ({
          id: n.id,
          content: n.content,
          createdBy: n.createdBy,
          createdAt: n.createdAt,
        })),
        preferences: {
          favoriteProducts: preferences.favoriteProducts || [],
          deliveryPreferences: preferences.deliveryPreferences || null,
          paymentPreferences: preferences.paymentPreferences || null,
          allergies: preferences.allergies || null,
          customPreferences: preferences.custom || null,
        },
        customerSummary: {
          name: customer.firstName
            ? `${customer.firstName} ${customer.lastName || ''}`
            : null,
          isRegular: customer.orderCount >= 5,
          totalOrders: customer.orderCount,
          totalSpent: Number(customer.totalSpent),
          lastOrderAt: customer.lastOrderAt,
          daysSinceLastOrder: customer.lastOrderAt
            ? Math.floor(
                (Date.now() - customer.lastOrderAt.getTime()) / (1000 * 60 * 60 * 24)
              )
            : null,
          paymentScore: customer.paymentScore,
          paymentScoreLabel: getScoreLabel(customer.paymentScore),
          hasDebt: customer.currentBalance > 0,
          currentDebt: customer.currentBalance,
        },
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD CUSTOMER NOTE
// ═══════════════════════════════════════════════════════════════════════════════

const AddCustomerNoteInput = z.object({
  content: z.string().min(1).max(500).describe('Contenido de la nota a agregar'),
});

export class AddCustomerNoteTool extends BaseTool<typeof AddCustomerNoteInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'add_customer_note',
      description:
        'Agrega una nota sobre el cliente. Usar para recordar preferencias, observaciones importantes, o información útil para futuras conversaciones.',
      category: ToolCategory.MUTATION,
      inputSchema: AddCustomerNoteInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof AddCustomerNoteInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: context.customerId, workspaceId: context.workspaceId },
      select: { id: true },
    });

    if (!customer) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    const note = await this.prisma.customerNote.create({
      data: {
        customerId: context.customerId,
        content: input.content,
        createdBy: 'agent',
      },
    });

    return {
      success: true,
      data: {
        noteId: note.id,
        message: 'Nota agregada correctamente',
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET CUSTOMER INFO (enhanced)
// ═══════════════════════════════════════════════════════════════════════════════

const GetCustomerInfoInput = z.object({}).describe('No requiere parámetros');

export class GetCustomerInfoTool extends BaseTool<typeof GetCustomerInfoInput, CustomerInfo> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_customer_info',
      description:
        'Obtiene información completa del cliente: nombre, DNI, historial, preferencias, notas y deudas.',
      category: ToolCategory.QUERY,
      inputSchema: GetCustomerInfoInput,
    });
    this.prisma = prisma;
  }

  async execute(
    _input: z.infer<typeof GetCustomerInfoInput>,
    context: ToolContext
  ): Promise<ToolResult<CustomerInfo>> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: context.customerId, workspaceId: context.workspaceId },
      include: {
        orders: {
          where: {
            workspaceId: context.workspaceId,
            status: { not: 'cancelled' },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            total: true,
            status: true,
            createdAt: true,
          },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!customer) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    // Calculate debt
    const pendingPayments = await this.prisma.payment.aggregate({
      where: {
        order: {
          customerId: context.customerId,
          workspaceId: context.workspaceId,
        },
        status: 'pending',
      },
      _sum: { amount: true },
    });

    const debt = pendingPayments._sum.amount || 0;

    const metadata = (customer.metadata as Record<string, unknown>) || {};
    const dni = metadata.dni as string | undefined;

    // Get score label
    const getScoreLabel = (score: number) => {
      if (score >= 80) return 'excelente';
      if (score >= 60) return 'bueno';
      if (score >= 40) return 'regular';
      return 'riesgoso';
    };

    const info: CustomerInfo = {
      id: customer.id,
      phone: customer.phone,
      firstName: customer.firstName || undefined,
      lastName: customer.lastName || undefined,
      dni,
      email: customer.email || undefined,
      isNew: customer.orderCount === 0,
      needsRegistration: !customer.firstName || !customer.lastName || !dni,
      preferences: (customer.preferences as Record<string, unknown>) || {},
      notes: customer.notes.map((n) => n.content),
      totalOrders: customer.orderCount,
      totalSpent: Number(customer.totalSpent),
      lastOrderAt: customer.lastOrderAt || undefined,
      debt,
      paymentScore: customer.paymentScore,
      paymentScoreLabel: getScoreLabel(customer.paymentScore),
    };

    return { success: true, data: info };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE CUSTOMER INFO (general)
// ═══════════════════════════════════════════════════════════════════════════════

const UpdateCustomerInfoInput = z.object({
  firstName: z.string().min(2).max(100).optional().describe('Nombre del cliente'),
  lastName: z.string().min(2).max(100).optional().describe('Apellido del cliente'),
  dni: dniSchema.optional().describe('DNI del cliente'),
  email: z.string().email().optional().describe('Email del cliente'),
  cuit: z.string().max(20).optional().describe('CUIT del cliente'),
  businessName: z.string().max(255).optional().describe('Razón social del cliente'),
  fiscalAddress: z.string().max(500).optional().describe('Domicilio fiscal del cliente'),
  vatCondition: z.string().max(50).optional().describe('Condición frente al IVA del cliente'),
  notes: z.string().max(1000).optional().describe('Notas/preferencias del cliente'),
});

export class UpdateCustomerInfoTool extends BaseTool<typeof UpdateCustomerInfoInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'update_customer_info',
      description:
        'Actualiza información del cliente: nombre, apellido, DNI, email o notas.',
      category: ToolCategory.MUTATION,
      inputSchema: UpdateCustomerInfoInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof UpdateCustomerInfoInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { firstName, lastName, dni, email, notes, cuit, businessName, fiscalAddress, vatCondition } = input;

    const customer = await this.prisma.customer.findFirst({
      where: { id: context.customerId, workspaceId: context.workspaceId },
    });

    if (!customer) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    // Build update data
    const updateData: Prisma.CustomerUpdateInput = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (email) updateData.email = email;
    if (cuit) updateData.cuit = cuit;
    if (businessName) updateData.businessName = businessName;
    if (fiscalAddress) updateData.fiscalAddress = fiscalAddress;
    if (vatCondition) updateData.vatCondition = vatCondition;

    // Update metadata for dni and notes
    const currentMetadata = (customer.metadata as Record<string, unknown>) || {};
    const newMetadata: Record<string, unknown> = { ...currentMetadata };
    if (dni) newMetadata.dni = dni;
    if (notes !== undefined) newMetadata.notes = notes;
    updateData.metadata = newMetadata as Prisma.InputJsonValue;

    await this.prisma.customer.updateMany({
      where: { id: context.customerId, workspaceId: context.workspaceId },
      data: updateData,
    });

    return {
      success: true,
      data: {
        message: 'Datos del cliente actualizados',
        updated: {
          firstName,
          lastName,
          dni,
          email,
          cuit,
          businessName,
          fiscalAddress,
          vatCondition,
          notes: notes !== undefined ? 'actualizado' : undefined,
        },
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET CUSTOMER DEBT
// ═══════════════════════════════════════════════════════════════════════════════

const GetCustomerDebtInput = z.object({}).describe('No requiere parámetros');

export class GetCustomerDebtTool extends BaseTool<typeof GetCustomerDebtInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_customer_debt',
      description:
        'Consulta la deuda pendiente del cliente con detalle de pedidos impagos.',
      category: ToolCategory.QUERY,
      inputSchema: GetCustomerDebtInput,
    });
    this.prisma = prisma;
  }

  async execute(
    _input: z.infer<typeof GetCustomerDebtInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    // Policy: always filter by workspace
    const ordersWithDebt = await this.prisma.order.findMany({
      where: withVisibleOrders({
        customerId: context.customerId,
        workspaceId: context.workspaceId,
        status: { notIn: ['cancelled', 'draft'] },
        payments: {
          some: { status: 'pending' },
        },
      }),
      include: {
        payments: {
          where: { status: 'pending' },
          select: { amount: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const debts = ordersWithDebt.map((order) => ({
      orderNumber: order.orderNumber,
      orderId: order.id,
      orderDate: order.createdAt,
      orderTotal: order.total,
      pendingAmount: order.payments.reduce((sum, p) => sum + p.amount, 0),
    }));

    const totalDebt = debts.reduce((sum, d) => sum + d.pendingAmount, 0);

    return {
      success: true,
      data: {
        totalDebt,
        debtCount: debts.length,
        debts,
        hasDebt: totalDebt > 0,
        formattedTotal: `$${totalDebt.toLocaleString('es-AR')}`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET ORDER HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

const GetOrderHistoryInput = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Cantidad de pedidos (default 5)'),
});

export class GetOrderHistoryTool extends BaseTool<typeof GetOrderHistoryInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_order_history',
      description:
        'Obtiene historial de pedidos del cliente. Útil para "repetir pedido" o ver compras anteriores.',
      category: ToolCategory.QUERY,
      inputSchema: GetOrderHistoryInput,
    });
    this.prisma = prisma;
  }

  async execute(
    input: z.infer<typeof GetOrderHistoryInput>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { limit } = input;

    // Policy: always filter by workspace
    const orders = await this.prisma.order.findMany({
      where: withVisibleOrders({
        customerId: context.customerId,
        workspaceId: context.workspaceId,
        status: { notIn: ['cancelled', 'draft'] },
      }),
      include: {
        items: {
          select: {
            name: true,
            quantity: true,
            unitPrice: true,
            total: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      success: true,
      data: {
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          date: o.createdAt,
          status: o.status,
          total: o.total,
          itemCount: o.items.length,
          items: o.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        })),
        totalOrders: orders.length,
        hasHistory: orders.length > 0,
      },
    };
  }
}

/**
 * Create all customer tools
 */
export function createCustomerTools(prisma: PrismaClient): BaseTool<any, any>[] {
  return [
    new GetOrCreateCustomerByPhoneTool(prisma),
    new SetCustomerIdentityTool(prisma),
    new GetCustomerNotesTool(prisma),
    new AddCustomerNoteTool(prisma),
    new GetCustomerInfoTool(prisma),
    new UpdateCustomerInfoTool(prisma),
    new GetCustomerDebtTool(prisma),
    new GetOrderHistoryTool(prisma),
  ];
}
