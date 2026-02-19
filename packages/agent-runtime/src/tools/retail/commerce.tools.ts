/**
 * Commerce Tools
 * Tools for commerce profile and settings
 */
import { randomUUID } from 'crypto';

import { type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { CatalogPdfService, type CatalogOptions, type CatalogProductFilter, OrderReceiptPdfService, decrypt } from '@nexova/core';
import {
  EvolutionClient,
  EvolutionError,
  InfobipClient,
  type MercadoPagoIntegrationService,
} from '@nexova/integrations';
import { getCommercePlanCapabilities, resolveCommercePlan } from '@nexova/shared';

import { ToolCategory, type ToolContext, type ToolResult, type CommerceProfile } from '../../types/index.js';
import { LocalFileUploader } from '../../utils/file-uploader.js';
import { withVisibleOrders } from '../../utils/orders.js';
import { BaseTool } from '../base.js';





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
    const readString = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed || undefined;
    };

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
    const workingHoursStart = readString(settings.workingHoursStart);
    const workingHoursEnd = readString(settings.workingHoursEnd);
    const morningShiftStart = readString(settings.morningShiftStart);
    const morningShiftEnd = readString(settings.morningShiftEnd);
    const afternoonShiftStart = readString(settings.afternoonShiftStart);
    const afternoonShiftEnd = readString(settings.afternoonShiftEnd);

    if (settings.continuousHours) {
      if (workingHoursStart && workingHoursEnd) {
        hoursText = `de ${workingHoursStart} a ${workingHoursEnd} hs`;
      }
    } else {
      const parts = [];
      if (morningShiftStart && morningShiftEnd) {
        parts.push(`Mañana: ${morningShiftStart} a ${morningShiftEnd}`);
      }
      if (afternoonShiftStart && afternoonShiftEnd) {
        parts.push(`Tarde: ${afternoonShiftStart} a ${afternoonShiftEnd}`);
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
    const where: Prisma.OrderWhereInput = { workspaceId: context.workspaceId };
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
    const where: Prisma.OrderWhereInput = { workspaceId: context.workspaceId };
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
  private fileUploader: LocalFileUploader;

  constructor(prisma: PrismaClient) {
    super({
      name: 'send_catalog_pdf',
      description: 'Genera y envía el catálogo de productos en PDF al cliente.',
      category: ToolCategory.MUTATION,
      inputSchema: SendCatalogPdfInput,
    });
    this.prisma = prisma;
    this.catalogService = new CatalogPdfService(prisma);
    this.fileUploader = new LocalFileUploader();
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

      const mediaUrl = await this.fileUploader.upload(
        catalog.buffer,
        catalog.filename || 'catalogo.pdf',
        'application/pdf',
        context.workspaceId,
        { category: 'catalogs' }
      );

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

      const to = this.normalizePhone(customer.phone);
      const caption = `📋 ${catalog.filename}`;
      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();
      let result: { messageId: string; status: string; to: string };
      if (provider === 'evolution') {
        const baseUrl = this.resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
        const instanceName = this.getEvolutionInstanceName(whatsappNumber.providerConfig);
        if (!baseUrl || !instanceName) {
          return { success: false, error: 'Evolution no está configurado (baseUrl / instanceName).' };
        }
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        result = await this.sendEvolutionPdfWithInlineFallback({
          client,
          to,
          mediaUrl,
          caption,
          filename: catalog.filename || 'catalogo.pdf',
          buffer: catalog.buffer,
        });
      } else {
        const client = new InfobipClient({
          apiKey,
          baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
          senderNumber: whatsappNumber.phoneNumber,
        });
        result = await client.sendDocument(to, mediaUrl, caption);
      }

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

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  }

  private async sendEvolutionPdfWithInlineFallback(params: {
    client: EvolutionClient;
    to: string;
    mediaUrl: string;
    caption: string;
    filename: string;
    buffer: Buffer;
  }): Promise<{ messageId: string; status: string; to: string }> {
    const inlineBase64 = this.buildPdfBase64(params.buffer);
    try {
      return await params.client.sendDocument(params.to, inlineBase64, params.caption, {
        mimetype: 'application/pdf',
        fileName: params.filename,
      });
    } catch (inlineError) {
      if (!(inlineError instanceof EvolutionError)) throw inlineError;
      try {
        return await params.client.sendDocument(params.to, params.mediaUrl, params.caption, {
          mimetype: 'application/pdf',
          fileName: params.filename,
        });
      } catch (urlError) {
        if (!(urlError instanceof EvolutionError)) throw urlError;
        throw new Error(
          `No se pudo enviar el catálogo en PDF por Evolution (inline: ${this.formatEvolutionError(inlineError)} | url: ${this.formatEvolutionError(urlError)})`
        );
      }
    }
  }

  private buildPdfBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  private formatEvolutionError(error: EvolutionError): string {
    const response = (error.responseBody || '').trim();
    if (response.length === 0) return `${error.statusCode}`;
    const compact = response.replace(/\s+/g, ' ');
    return `${error.statusCode} ${compact.slice(0, 240)}`;
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
    if (provider === 'evolution') {
      const envKey = (process.env.EVOLUTION_API_KEY || '').trim();
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

  private resolveEvolutionBaseUrl(apiUrl?: string | null): string {
    const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
    const envUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/$/, '');
    return cleaned || envUrl;
  }

  private getEvolutionInstanceName(providerConfig: unknown): string {
    if (!providerConfig || typeof providerConfig !== 'object') return '';
    const cfg = providerConfig as Record<string, unknown>;
    const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
    return typeof value === 'string' ? value.trim() : '';
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
  private fileUploader: LocalFileUploader;

  constructor(prisma: PrismaClient) {
    super({
      name: 'send_order_pdf',
      description: 'Genera y envía el resumen del pedido en PDF al cliente.',
      category: ToolCategory.MUTATION,
      inputSchema: SendOrderPdfInput,
    });
    this.prisma = prisma;
    this.receiptService = new OrderReceiptPdfService(prisma);
    this.fileUploader = new LocalFileUploader();
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

      const mediaUrl = await this.fileUploader.upload(
        receipt.buffer,
        receipt.filename || 'pedido.pdf',
        'application/pdf',
        context.workspaceId,
        { category: 'orders' }
      );

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

      const to = this.normalizePhone(customer.phone);
      const caption = `🧾 Pedido ${orderData.orderNumber}`;
      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();

      let result: { messageId: string; status: string; to: string };
      if (provider === 'evolution') {
        const baseUrl = this.resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
        const instanceName = this.getEvolutionInstanceName(whatsappNumber.providerConfig);
        if (!baseUrl || !instanceName) {
          return { success: false, error: 'Evolution no está configurado (baseUrl / instanceName).' };
        }
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        result = await client.sendDocument(to, mediaUrl, caption);
      } else {
        const client = new InfobipClient({
          apiKey,
          baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
          senderNumber: whatsappNumber.phoneNumber,
        });
        result = await client.sendDocument(to, mediaUrl, caption);
      }

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

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
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
    if (provider === 'evolution') {
      const envKey = (process.env.EVOLUTION_API_KEY || '').trim();
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

  private resolveEvolutionBaseUrl(apiUrl?: string | null): string {
    const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
    const envUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/$/, '');
    return cleaned || envUrl;
  }

  private getEvolutionInstanceName(providerConfig: unknown): string {
    if (!providerConfig || typeof providerConfig !== 'object') return '';
    const cfg = providerConfig as Record<string, unknown>;
    const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
    return typeof value === 'string' ? value.trim() : '';
  }

}

/**
 * Create all commerce tools
 */
export function createCommerceTools(
  prisma: PrismaClient,
  mpService?: MercadoPagoIntegrationService
): Array<BaseTool<z.ZodSchema, unknown>> {
  return [
    new GetCommerceProfileTool(prisma),
    new CreatePaymentLinkTool(prisma, mpService),
    new ProcessPaymentReceiptTool(prisma),
    new SendCatalogPdfTool(prisma),
    new SendOrderPdfTool(prisma),
  ];
}
