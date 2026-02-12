/**
 * Commerce Tools
 * Tools for commerce profile and settings
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { getCommercePlanCapabilities, resolveCommercePlan } from '@nexova/shared';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult, CommerceProfile } from '../../types/index.js';
import { CatalogPdfService, CatalogOptions, CatalogProductFilter, OrderReceiptPdfService, decrypt } from '@nexova/core';
import { withVisibleOrders } from '../../utils/orders.js';
import { InfobipClient, type MercadoPagoIntegrationService } from '@nexova/integrations';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// GET COMMERCE PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

const GetCommerceProfileInput = z.object({}).describe('No requiere parámetros');

export class GetCommerceProfileTool extends BaseTool<typeof GetCommerceProfileInput, CommerceProfile> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_commerce_profile',
      description: 'Obtiene información del comercio: nombre, dirección, horarios, políticas de envío, medios de pago e instrucciones especiales.',
      category: ToolCategory.QUERY,
      inputSchema: GetCommerceProfileInput,
    });
    this.prisma = prisma;
  }

  async execute(_input: z.infer<typeof GetCommerceProfileInput>, context: ToolContext): Promise<ToolResult<CommerceProfile>> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: {
        name: true,
        phone: true,
        settings: true,
        plan: true,
      },
    });

    if (!workspace) {
      return { success: false, error: 'Comercio no encontrado' };
    }

    const settings = (workspace.settings as Record<string, unknown>) || {};
    const plan = resolveCommercePlan({
      workspacePlan: workspace.plan,
      settingsPlan: settings.commercePlan,
      fallback: 'pro',
    });
    const capabilities = getCommercePlanCapabilities(plan);
    const rawPaymentMethodsEnabled =
      (settings.paymentMethodsEnabled as
        | { mpLink?: boolean; transfer?: boolean; cash?: boolean }
        | undefined) || {};
    const paymentMethodsEnabled = {
      mpLink: capabilities.showMercadoPagoIntegration
        ? (typeof rawPaymentMethodsEnabled.mpLink === 'boolean'
            ? rawPaymentMethodsEnabled.mpLink
            : true)
        : false,
      transfer:
        typeof rawPaymentMethodsEnabled.transfer === 'boolean'
          ? rawPaymentMethodsEnabled.transfer
          : true,
      cash:
        typeof rawPaymentMethodsEnabled.cash === 'boolean'
          ? rawPaymentMethodsEnabled.cash
          : true,
    };
    const paymentMethodsRaw = Array.isArray(settings.paymentMethods)
      ? (settings.paymentMethods.filter((method): method is string => typeof method === 'string'))
      : undefined;
    const paymentMethods = capabilities.showMercadoPagoIntegration
      ? paymentMethodsRaw
      : paymentMethodsRaw?.filter((method) => {
          const normalized = method.toLowerCase();
          return !normalized.includes('mercadopago') && !normalized.includes('link');
        });

    // Build schedule string from new fields
    let schedule = settings.schedule as string | undefined;
    if (!schedule && settings.workingDays) {
      schedule = this.buildScheduleString(settings);
    }

    const businessName = (settings.businessName as string) || undefined;

    const profile: CommerceProfile = {
      name: businessName || 'Tu Comercio',
      phone: workspace.phone || undefined,
      // Support both legacy and new address field
      address: (settings.businessAddress as string) || (settings.address as string) || undefined,
      city: settings.city as string | undefined,
      schedule,
      deliveryInfo: settings.deliveryInfo as string | undefined,
      paymentMethods,
      policies: settings.policies as string | undefined,
      // Support both legacy and new instructions field
      customInstructions: (settings.assistantNotes as string) || (settings.agentInstructions as string) || undefined,
      // New fields
      whatsappContact: settings.whatsappContact as string | undefined,
      paymentAlias: settings.paymentAlias as string | undefined,
      paymentCbu: settings.paymentCbu as string | undefined,
      paymentMethodsEnabled,
      vatConditionId: settings.vatConditionId as string | undefined,
      workingDays: settings.workingDays as string[] | undefined,
      continuousHours: settings.continuousHours as boolean | undefined,
      workingHoursStart: settings.workingHoursStart as string | undefined,
      workingHoursEnd: settings.workingHoursEnd as string | undefined,
      morningShiftStart: settings.morningShiftStart as string | undefined,
      morningShiftEnd: settings.morningShiftEnd as string | undefined,
      afternoonShiftStart: settings.afternoonShiftStart as string | undefined,
      afternoonShiftEnd: settings.afternoonShiftEnd as string | undefined,
    };

    return { success: true, data: profile };
  }

  private buildScheduleString(settings: Record<string, unknown>): string | undefined {
    const workingDays = settings.workingDays as string[] | undefined;
    if (!workingDays?.length) return undefined;

    const dayNames: Record<string, string> = {
      lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves',
      vie: 'Viernes', sab: 'Sábado', dom: 'Domingo',
    };

    const daysOrder = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
    const sortedDays = workingDays.sort((a, b) => daysOrder.indexOf(a) - daysOrder.indexOf(b));

    let daysText = '';
    if (sortedDays.length === 7) {
      daysText = 'Todos los días';
    } else if (sortedDays.length === 5 && sortedDays.every((d) => ['lun', 'mar', 'mie', 'jue', 'vie'].includes(d))) {
      daysText = 'Lunes a Viernes';
    } else if (sortedDays.length === 6 && sortedDays.every((d) => ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'].includes(d))) {
      daysText = 'Lunes a Sábado';
    } else {
      daysText = sortedDays.map((d) => dayNames[d] || d).join(', ');
    }

    let hoursText = '';
    if (settings.continuousHours) {
      if (settings.workingHoursStart && settings.workingHoursEnd) {
        hoursText = `de ${settings.workingHoursStart} a ${settings.workingHoursEnd} hs`;
      }
    } else {
      const parts = [];
      if (settings.morningShiftStart && settings.morningShiftEnd) {
        parts.push(`Mañana: ${settings.morningShiftStart} a ${settings.morningShiftEnd}`);
      }
      if (settings.afternoonShiftStart && settings.afternoonShiftEnd) {
        parts.push(`Tarde: ${settings.afternoonShiftStart} a ${settings.afternoonShiftEnd}`);
      }
      hoursText = parts.join(' | ');
    }

    return daysText && hoursText ? `${daysText} - ${hoursText}` : daysText || undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE PAYMENT LINK
// ═══════════════════════════════════════════════════════════════════════════════

const CreatePaymentLinkInput = z.object({
  orderNumber: z.string().optional().describe('Número de orden'),
  orderId: z.string().uuid().optional().describe('ID de la orden'),
  amount: z.number().positive().optional().describe('Monto específico (default: total pendiente)'),
}).refine(
  (data) => data.orderNumber || data.orderId,
  { message: 'Debe proporcionar orderNumber u orderId' }
);

export class CreatePaymentLinkTool extends BaseTool<typeof CreatePaymentLinkInput> {
  private prisma: PrismaClient;
  private mpService?: MercadoPagoIntegrationService;

  constructor(prisma: PrismaClient, mpService?: MercadoPagoIntegrationService) {
    super({
      name: 'create_payment_link',
      description: 'Genera un link de pago de MercadoPago para un pedido.',
      category: ToolCategory.MUTATION,
      inputSchema: CreatePaymentLinkInput,
      idempotencyKey: (input) => `payment_link_${input.orderId || input.orderNumber}_${Date.now()}`,
    });
    this.prisma = prisma;
    this.mpService = mpService;
  }

  async execute(input: z.infer<typeof CreatePaymentLinkInput>, context: ToolContext): Promise<ToolResult> {
    const { orderNumber, orderId, amount } = input;
    const workspacePlan = await this.prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: { plan: true, settings: true },
    });
    const workspaceSettings = (workspacePlan?.settings as Record<string, unknown> | undefined) || {};
    const plan = resolveCommercePlan({
      workspacePlan: workspacePlan?.plan,
      settingsPlan: workspaceSettings.commercePlan,
      fallback: 'pro',
    });
    if (!getCommercePlanCapabilities(plan).showMercadoPagoIntegration) {
      return {
        success: false,
        error: 'Tu plan actual no incluye links de pago',
      };
    }

    // Get order
    const where: any = { workspaceId: context.workspaceId };
    if (orderId) where.id = orderId;
    else if (orderNumber) where.orderNumber = orderNumber;

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders(where),
      include: {
        payments: {
          where: { status: 'completed' },
        },
        customer: true,
      },
    });

    if (!order) {
      return { success: false, error: 'Orden no encontrada' };
    }

    // Calculate pending amount
    const paidAmount = order.payments.reduce((sum, p) => sum + p.amount, 0);
    const pendingAmount = order.total - paidAmount;

    if (pendingAmount <= 0) {
      return { success: false, error: 'La orden ya está pagada completamente' };
    }

    const paymentAmount = amount || pendingAmount;

    if (!this.mpService) {
      return {
        success: false,
        error: 'MercadoPago no está configurado o no está conectado en este workspace',
      };
    }

    const externalReference = `${context.workspaceId}:${order.id}:${Date.now()}`;
    const customerName = order.customer?.firstName
      ? `${order.customer.firstName} ${order.customer.lastName || ''}`.trim()
      : undefined;

    let result;
    try {
      result = await this.mpService.createPaymentLink(context.workspaceId, {
        amount: paymentAmount,
        description: `Pago pedido #${order.orderNumber}`,
        externalReference,
        payerEmail: order.customer?.email || undefined,
        payerName: customerName,
        notificationUrl: `${process.env.API_BASE_URL}/api/v1/integrations/webhooks/mercadopago/${context.workspaceId}`,
        expirationMinutes: 60,
        metadata: {
          workspaceId: context.workspaceId,
          customerId: order.customerId,
          orderId: order.id,
          sessionId: context.sessionId,
        },
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No pude generar el link de pago',
      };
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'mercadopago',
        method: 'link',
        status: 'pending',
        amount: paymentAmount,
        currency: order.currency,
        paymentUrl: result.paymentUrl,
        externalId: result.preferenceId,
        providerData: {
          preferenceId: result.preferenceId,
          externalReference,
        },
      },
    });

    return {
      success: true,
      data: {
        paymentId: payment.id,
        orderNumber: order.orderNumber,
        amount: paymentAmount,
        paymentUrl: payment.paymentUrl,
        message: `Link de pago generado por $${paymentAmount.toLocaleString('es-AR')}`,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS PAYMENT RECEIPT
// ═══════════════════════════════════════════════════════════════════════════════

const ProcessPaymentReceiptInput = z.object({
  orderNumber: z.string().optional().describe('Número de orden al que aplicar el pago'),
  orderId: z.string().uuid().optional().describe('ID de la orden'),
  amount: z.number().positive().describe('Monto del pago'),
  method: z.enum(['transfer', 'cash', 'mercadopago', 'other']).describe('Método de pago'),
  reference: z.string().optional().describe('Referencia o número de comprobante'),
}).refine(
  (data) => data.orderNumber || data.orderId,
  { message: 'Debe proporcionar orderNumber u orderId' }
);

export class ProcessPaymentReceiptTool extends BaseTool<typeof ProcessPaymentReceiptInput> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({
      name: 'process_payment_receipt',
      description: 'Registra un pago recibido (transferencia, efectivo, etc). Usar cuando el cliente envía comprobante.',
      category: ToolCategory.MUTATION,
      inputSchema: ProcessPaymentReceiptInput,
      requiresConfirmation: true,
      idempotencyKey: (input) => `payment_${input.orderId || input.orderNumber}_${input.amount}_${input.reference || Date.now()}`,
    });
    this.prisma = prisma;
  }

  async execute(input: z.infer<typeof ProcessPaymentReceiptInput>, context: ToolContext): Promise<ToolResult> {
    const { orderNumber, orderId, amount, method, reference } = input;

    // Get order
    const where: any = { workspaceId: context.workspaceId };
    if (orderId) where.id = orderId;
    else if (orderNumber) where.orderNumber = orderNumber;

    const order = await this.prisma.order.findFirst({
      where: withVisibleOrders(where),
      include: {
        payments: {
          where: { status: 'completed' },
        },
      },
    });

    if (!order) {
      return { success: false, error: 'Orden no encontrada' };
    }

    // Calculate pending
    const paidAmount = order.payments.reduce((sum, p) => sum + p.amount, 0);
    const pendingAmount = order.total - paidAmount;

    // Create payment record (pending confirmation from owner)
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'manual',
        externalId: reference,
        method,
        status: 'pending', // Needs owner confirmation
        amount,
        currency: order.currency,
        providerData: {
          reportedBy: 'agent',
          sessionId: context.sessionId,
          customerId: context.customerId,
        },
      },
    });

    const remainingAfterPayment = pendingAmount - amount;

    return {
      success: true,
      data: {
        paymentId: payment.id,
        orderNumber: order.orderNumber,
        amount,
        method,
        status: 'pending_confirmation',
        message: `Pago de $${amount.toLocaleString('es-AR')} registrado. Pendiente de confirmación por el comercio.`,
        orderTotal: order.total,
        previouslyPaid: paidAmount,
        remainingAfterPayment: remainingAfterPayment > 0 ? remainingAfterPayment : 0,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEND CATALOG PDF
// ═══════════════════════════════════════════════════════════════════════════════

const SendCatalogPdfInput = z.object({
  category: z.string().optional().describe('Filtrar por categoría (opcional)'),
});

export class SendCatalogPdfTool extends BaseTool<typeof SendCatalogPdfInput> {
  private prisma: PrismaClient;
  private catalogService: CatalogPdfService;

  constructor(prisma: PrismaClient) {
    super({
      name: 'send_catalog_pdf',
      description: 'Genera y envía el catálogo de productos en PDF al cliente.',
      category: ToolCategory.MUTATION,
      inputSchema: SendCatalogPdfInput,
    });
    this.prisma = prisma;
    this.catalogService = new CatalogPdfService(prisma);
  }

  async execute(input: z.infer<typeof SendCatalogPdfInput>, context: ToolContext): Promise<ToolResult> {
    const { category } = input;

    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: context.workspaceId },
        select: { name: true, settings: true },
      });

      if (!workspace) {
        return { success: false, error: 'Comercio no encontrado' };
      }

      const settings = (workspace.settings as Record<string, unknown>) || {};
      const businessName =
        (settings.businessName as string) || workspace.name || 'Productos';
      const logoUrl = (settings.companyLogo as string) || undefined;

      const filter: CatalogProductFilter = {
        category,
        status: 'active',
      };

      const options: CatalogOptions = {
        title: 'Catálogo',
        includeImages: true,
        showStock: false,
        showComparePrice: true,
        workspaceName: businessName,
        logoUrl,
      };

      const catalog = await this.catalogService.generateCatalog(
        context.workspaceId,
        filter,
        options
      );

      const uploadsDir = this.getUploadDir();
      const catalogsDir = path.join(uploadsDir, 'catalogs');
      await fs.mkdir(catalogsDir, { recursive: true });

      const safeName = this.sanitizeFilename(catalog.filename || 'catalogo.pdf');
      const uniqueName = `${context.workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
      const filePath = path.join(catalogsDir, uniqueName);
      await fs.writeFile(filePath, catalog.buffer);

      const publicBase = await this.resolvePublicBaseUrl();
      if (!publicBase) {
        return {
          success: false,
          error: 'No hay una URL pública configurada para enviar el PDF. Configurá PUBLIC_BASE_URL o NGROK_URL.',
        };
      }

      const mediaUrl = `${publicBase}/uploads/catalogs/${uniqueName}`;

      const customer = await this.prisma.customer.findFirst({
        where: { id: context.customerId, workspaceId: context.workspaceId },
        select: { phone: true },
      });

      if (!customer?.phone) {
        return { success: false, error: 'No se encontró el teléfono del cliente' };
      }

      const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: context.workspaceId, isActive: true },
      });

      if (!whatsappNumber) {
        return { success: false, error: 'No hay un número de WhatsApp activo para este comercio' };
      }

      const apiKey = this.resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        return { success: false, error: 'La API key de WhatsApp no está configurada' };
      }

      const client = new InfobipClient({
        apiKey,
        baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
        senderNumber: whatsappNumber.phoneNumber,
      });

      const to = this.normalizePhone(customer.phone);
      const caption = `📋 ${catalog.filename}`;
      const result = await client.sendDocument(to, mediaUrl, caption);

      try {
        await this.prisma.eventOutbox.create({
          data: {
            workspaceId: context.workspaceId,
            eventType: 'message.sent',
            aggregateType: 'Message',
            aggregateId: result.messageId || randomUUID(),
            payload: {
              to,
              content: {
                mediaType: 'document',
                mediaUrl,
                text: caption,
              },
              status: result.status,
            },
            status: 'pending',
            correlationId: context.correlationId || null,
          },
        });
      } catch {
        // Non-fatal: message was already sent
      }

      return {
        success: true,
        data: {
          productCount: catalog.productCount,
          pageCount: catalog.pageCount,
          filename: catalog.filename,
          message: `Catálogo enviado${category ? ` de "${category}"` : ''}.`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Error al generar o enviar el catálogo: ${message}`,
      };
    }
  }

  private getUploadDir(): string {
    if (process.env.UPLOAD_DIR) {
      return process.env.UPLOAD_DIR;
    }

    const repoRoot = this.findRepoRoot(process.cwd()) || process.cwd();
    return path.join(repoRoot, 'apps', 'api', 'uploads');
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  }

  private resolveWhatsAppApiKey(number: { apiKeyEnc?: string | null; apiKeyIv?: string | null }): string {
    if (!number.apiKeyEnc || !number.apiKeyIv) return '';
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }

  private async resolvePublicBaseUrl(): Promise<string | null> {
    const candidates = [
      process.env.API_BASE_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.PUBLIC_API_URL,
      process.env.API_PUBLIC_URL,
      process.env.NGROK_URL,
      process.env.BASE_URL,
      process.env.API_URL,
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.trim()) {
        return candidate.replace(/\/$/, '');
      }
    }

    return this.resolveNgrokBaseUrl();
  }

  private async resolveNgrokBaseUrl(): Promise<string | null> {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      const data = await response.json() as { tunnels?: Array<{ public_url?: string }> };
      const httpsTunnel = data.tunnels?.find((t) => t.public_url?.startsWith('https://'));
      return httpsTunnel?.public_url?.replace(/\/$/, '') || null;
    } catch {
      return null;
    }
  }

  private findRepoRoot(startDir: string): string | null {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      if (
        existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
        existsSync(path.join(current, 'turbo.json'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private resolveInfobipBaseUrl(apiUrl?: string | null): string {
    const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
    const envUrl = (process.env.INFOBIP_BASE_URL || '').trim().replace(/\/$/, '');
    const defaultUrl = 'https://api.infobip.com';

    if (cleaned && cleaned.toLowerCase() !== defaultUrl) {
      return cleaned;
    }
    if (envUrl) {
      return envUrl;
    }
    return cleaned || defaultUrl;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEND ORDER PDF (SUMMARY/RECEIPT)
// ═══════════════════════════════════════════════════════════════════════════════

const SendOrderPdfInput = z
  .object({
    orderId: z.string().uuid().optional().describe('ID del pedido'),
    orderNumber: z.string().optional().describe('Número del pedido'),
    summary: z
      .object({
        orderNumber: z.string().optional(),
        items: z.array(
          z.object({
            name: z.string(),
            quantity: z.number().int().min(1),
            unitPrice: z.number(),
            total: z.number(),
          })
        ),
        subtotal: z.number(),
        shipping: z.number().optional().default(0),
        discount: z.number().optional().default(0),
        total: z.number(),
        paidAmount: z.number().optional().default(0),
        notes: z.string().optional(),
        createdAt: z.string().optional(),
      })
      .optional(),
  })
  .refine((data) => data.orderId || data.orderNumber || data.summary, {
    message: 'Debe proporcionar orderId, orderNumber o summary',
  });

type OrderSummaryItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export class SendOrderPdfTool extends BaseTool<typeof SendOrderPdfInput> {
  private prisma: PrismaClient;
  private receiptService: OrderReceiptPdfService;

  constructor(prisma: PrismaClient) {
    super({
      name: 'send_order_pdf',
      description: 'Genera y envía el resumen del pedido en PDF al cliente.',
      category: ToolCategory.MUTATION,
      inputSchema: SendOrderPdfInput,
    });
    this.prisma = prisma;
    this.receiptService = new OrderReceiptPdfService(prisma);
  }

  async execute(input: z.infer<typeof SendOrderPdfInput>, context: ToolContext): Promise<ToolResult> {
    const { orderId, orderNumber, summary } = input;

    try {
      let orderData: {
        id: string;
        orderNumber: string;
        createdAt: Date;
        status: string;
        subtotal: number;
        shipping: number;
        discount: number;
        total: number;
        paidAmount: number;
        notes?: string | null;
        customer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
        items: OrderSummaryItem[];
      } | null = null;

      if (summary) {
        const customer = await this.prisma.customer.findFirst({
          where: { id: context.customerId, workspaceId: context.workspaceId },
          select: { firstName: true, lastName: true, phone: true },
        });

        const createdAt = summary.createdAt ? new Date(summary.createdAt) : new Date();
        orderData = {
          id: orderId || context.sessionId,
          orderNumber: summary.orderNumber || orderNumber || 'PEDIDO EN CURSO',
          createdAt,
          status: 'draft',
          subtotal: summary.subtotal,
          shipping: summary.shipping ?? 0,
          discount: summary.discount ?? 0,
          total: summary.total,
          paidAmount: summary.paidAmount ?? 0,
          notes: summary.notes ?? null,
          customer: {
            firstName: customer?.firstName,
            lastName: customer?.lastName,
            phone: customer?.phone,
          },
          items: summary.items,
        };
      } else {
        const order = await this.prisma.order.findFirst({
          where: withVisibleOrders({
            workspaceId: context.workspaceId,
            customerId: context.customerId,
            ...(orderId ? { id: orderId } : { orderNumber }),
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
            customer: { select: { firstName: true, lastName: true, phone: true } },
            payments: { where: { status: 'completed' }, select: { amount: true } },
          },
        });

        if (!order) {
          return { success: false, error: 'Pedido no encontrado' };
        }

        const paidAmount = order.payments.reduce((sum, p) => sum + p.amount, 0);
        orderData = {
          id: order.id,
          orderNumber: order.orderNumber,
          createdAt: order.createdAt,
          status: order.status,
          subtotal: order.subtotal,
          shipping: order.shipping,
          discount: order.discount,
          total: order.total,
          paidAmount,
          notes: order.notes,
          customer: order.customer,
          items: order.items,
        };
      }

      if (!orderData) {
        return { success: false, error: 'No se pudo generar el resumen del pedido.' };
      }

      const receipt = await this.receiptService.generateReceipt(context.workspaceId, orderData);

      const uploadsDir = this.getUploadDir();
      const ordersDir = path.join(uploadsDir, 'orders');
      await fs.mkdir(ordersDir, { recursive: true });

      const safeName = this.sanitizeFilename(receipt.filename || 'pedido.pdf');
      const uniqueName = `${context.workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
      const filePath = path.join(ordersDir, uniqueName);
      await fs.writeFile(filePath, receipt.buffer);

      const publicBase = await this.resolvePublicBaseUrl();
      if (!publicBase) {
        return {
          success: false,
          error: 'No hay una URL pública configurada para enviar el PDF. Configurá PUBLIC_BASE_URL o NGROK_URL.',
        };
      }

      const mediaUrl = `${publicBase}/uploads/orders/${uniqueName}`;

      const customer = await this.prisma.customer.findFirst({
        where: { id: context.customerId, workspaceId: context.workspaceId },
        select: { phone: true },
      });

      if (!customer?.phone) {
        return { success: false, error: 'No se encontró el teléfono del cliente' };
      }

      const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: context.workspaceId, isActive: true },
      });

      if (!whatsappNumber) {
        return { success: false, error: 'No hay un número de WhatsApp activo para este comercio' };
      }

      const apiKey = this.resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        return { success: false, error: 'La API key de WhatsApp no está configurada' };
      }

      const client = new InfobipClient({
        apiKey,
        baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
        senderNumber: whatsappNumber.phoneNumber,
      });

      const to = this.normalizePhone(customer.phone);
      const caption = `🧾 Pedido ${orderData.orderNumber}`;
      const result = await client.sendDocument(to, mediaUrl, caption);

      try {
        await this.prisma.eventOutbox.create({
          data: {
            workspaceId: context.workspaceId,
            eventType: 'message.sent',
            aggregateType: 'Message',
            aggregateId: result.messageId || randomUUID(),
            payload: {
              to,
              content: {
                mediaType: 'document',
                mediaUrl,
                text: caption,
              },
              status: result.status,
            },
            status: 'pending',
            correlationId: context.correlationId || null,
          },
        });
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        data: {
          filename: receipt.filename,
          orderNumber: orderData.orderNumber,
          message: `Pedido ${orderData.orderNumber} enviado en PDF.`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Error al generar o enviar el PDF del pedido: ${message}`,
      };
    }
  }

  private getUploadDir(): string {
    if (process.env.UPLOAD_DIR) {
      return process.env.UPLOAD_DIR;
    }

    const repoRoot = this.findRepoRoot(process.cwd()) || process.cwd();
    return path.join(repoRoot, 'apps', 'api', 'uploads');
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  }

  private resolveWhatsAppApiKey(number: { apiKeyEnc?: string | null; apiKeyIv?: string | null }): string {
    if (!number.apiKeyEnc || !number.apiKeyIv) return '';
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }

  private async resolvePublicBaseUrl(): Promise<string | null> {
    const candidates = [
      process.env.API_BASE_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.PUBLIC_API_URL,
      process.env.API_PUBLIC_URL,
      process.env.NGROK_URL,
      process.env.BASE_URL,
      process.env.API_URL,
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.trim()) {
        return candidate.replace(/\/$/, '');
      }
    }

    return this.resolveNgrokBaseUrl();
  }

  private async resolveNgrokBaseUrl(): Promise<string | null> {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      const data = await response.json() as { tunnels?: Array<{ public_url?: string }> };
      const httpsTunnel = data.tunnels?.find((t) => t.public_url?.startsWith('https://'));
      return httpsTunnel?.public_url?.replace(/\/$/, '') || null;
    } catch {
      return null;
    }
  }

  private resolveInfobipBaseUrl(apiUrl?: string | null): string {
    const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
    const envUrl = (process.env.INFOBIP_BASE_URL || '').trim().replace(/\/$/, '');
    const defaultUrl = 'https://api.infobip.com';

    if (cleaned && cleaned.toLowerCase() !== defaultUrl) {
      return cleaned;
    }
    if (envUrl) {
      return envUrl;
    }
    return cleaned || defaultUrl;
  }

  private findRepoRoot(startDir: string): string | null {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      if (
        existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
        existsSync(path.join(current, 'turbo.json')) ||
        existsSync(path.join(current, '.git'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }
}

/**
 * Create all commerce tools
 */
export function createCommerceTools(
  prisma: PrismaClient,
  mpService?: MercadoPagoIntegrationService
): BaseTool<any, any>[] {
  return [
    new GetCommerceProfileTool(prisma),
    new CreatePaymentLinkTool(prisma, mpService),
    new ProcessPaymentReceiptTool(prisma),
    new SendCatalogPdfTool(prisma),
    new SendOrderPdfTool(prisma),
  ];
}
