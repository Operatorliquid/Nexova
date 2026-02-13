/**
 * Integrations Routes
 * Handles MercadoPago OAuth, connection management, and webhooks
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  MercadoPagoIntegrationService,
  MercadoPagoWebhookHandler,
  MercadoPagoClient,
  IntegrationServiceError,
  ArcaIntegrationService,
  ArcaIntegrationError,
  type MercadoPagoConfig,
} from '@nexova/integrations';
import { LedgerService, decrypt, ArcaInvoicePdfService } from '@nexova/core';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recalcCustomerFinancials } from '../../utils/customer-financials.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';

// MercadoPago config from environment
const getMercadoPagoConfig = (): MercadoPagoConfig => ({
  clientId: process.env.MP_CLIENT_ID || '',
  clientSecret: process.env.MP_CLIENT_SECRET || '',
  redirectUri: process.env.MP_REDIRECT_URI || 'http://localhost:3000/api/v1/integrations/mercadopago/callback',
  sandbox: process.env.MP_SANDBOX === 'true',
});

export async function integrationsRoutes(app: FastifyInstance): Promise<void> {
  // Initialize services
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
  const mpConfig = getMercadoPagoConfig();
  const mpService = new MercadoPagoIntegrationService(app.prisma, mpConfig);
  const arcaService = new ArcaIntegrationService(app.prisma);
  const ledgerService = new LedgerService(app.prisma);
  const arcaPdfService = new ArcaInvoicePdfService();

  const formatMoney = (cents: number): string =>
    new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const sanitizeFilename = (name: string): string => {
    return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
  };

  const normalizePhone = (phone: string): string => {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  };

  const isLocalBaseUrl = (value: string): boolean => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    } catch {
      return false;
    }
  };

  const resolvePublicBaseUrlFromEnv = (): string | null => {
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

    return null;
  };

  const resolvePublicBaseUrlFromRequest = (request: FastifyRequest): string | null => {
    const forwardedHost = request.headers['x-forwarded-host'];
    const host =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ||
      (request.headers['host'] as string | undefined);
    if (!host) return null;

    const forwardedProto = request.headers['x-forwarded-proto'];
    const proto =
      (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ||
      'http';

    const base = `${proto}://${host}`.replace(/\/$/, '');
    if (isLocalBaseUrl(base)) return null;
    return base;
  };

  const resolveNgrokBaseUrl = async (): Promise<string | null> => {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { tunnels?: Array<{ public_url?: string }> };
      const httpsTunnel = data.tunnels?.find((t) => t.public_url?.startsWith('https://'));
      return httpsTunnel?.public_url?.replace(/\/$/, '') || null;
    } catch {
      return null;
    }
  };

  const resolvePublicBaseUrl = async (request: FastifyRequest): Promise<string | null> => {
    const fromRequest = resolvePublicBaseUrlFromRequest(request);
    if (fromRequest) return fromRequest;

    const fromEnv = resolvePublicBaseUrlFromEnv();
    if (fromEnv && !isLocalBaseUrl(fromEnv)) return fromEnv;

    const fromNgrok = await resolveNgrokBaseUrl();
    if (fromNgrok) return fromNgrok;

    return null;
  };

  const resolveWhatsAppApiKey = (number: {
    apiKeyEnc?: string | null;
    apiKeyIv?: string | null;
    provider?: string | null;
  }): string => {
    if (number.apiKeyEnc && number.apiKeyIv) {
      return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
    }

    const provider = (number.provider || 'infobip').toLowerCase();
    if (provider === 'infobip') {
      return (process.env.INFOBIP_API_KEY || '').trim();
    }
    return '';
  };

  const resolveInfobipBaseUrl = (apiUrl?: string | null): string => {
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
  };

  const parseArcaDate = (value?: string | null): Date | null => {
    if (!value) return null;
    const normalized = value.replace(/[^0-9]/g, '');
    if (normalized.length !== 8) return null;
    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(4, 6));
    const day = Number(normalized.slice(6, 8));
    if (!year || !month || !day) return null;
    return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
  };

  const assertArcaEnabled = async (
    workspaceId: string,
    userId: string
  ): Promise<{ ok: true } | { ok: false; code: number; payload: any }> => {
    const membership = await app.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: { role: { select: { name: true } } },
    });
    const planContext = await getWorkspacePlanContext(
      app.prisma,
      workspaceId,
      membership?.role?.name
    );
    if (!planContext.capabilities.showArcaIntegration) {
      return {
        ok: false,
        code: 403,
        payload: {
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye integración con ARCA',
        },
      };
    }
    return { ok: true };
  };

  const assertMercadoPagoEnabled = async (
    workspaceId: string,
    userId: string
  ): Promise<{ ok: true } | { ok: false; code: number; payload: any }> => {
    const membership = await app.prisma.membership.findFirst({
      where: {
        workspaceId,
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: { role: { select: { name: true } } },
    });
    const planContext = await getWorkspacePlanContext(
      app.prisma,
      workspaceId,
      membership?.role?.name
    );
    if (!planContext.capabilities.showMercadoPagoIntegration) {
      return {
        ok: false,
        code: 403,
        payload: {
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye integración con Mercado Pago',
        },
      };
    }
    return { ok: true };
  };

  const isMercadoPagoEnabledForWorkspace = async (workspaceId: string): Promise<boolean> => {
    const planContext = await getWorkspacePlanContext(app.prisma, workspaceId);
    return planContext.capabilities.showMercadoPagoIntegration;
  };

  const MONOTRIBUTO_MONTHLY_LIMITS: Record<string, { services: number; goods: number }> = {
    A: { services: 37085.74, goods: 37085.74 },
    B: { services: 42216.41, goods: 42216.41 },
    C: { services: 49435.58, goods: 48320.22 },
    D: { services: 63357.8, goods: 61824.18 },
    E: { services: 89714.31, goods: 81070.26 },
    F: { services: 112906.59, goods: 97291.54 },
    G: { services: 172457.38, goods: 118920.05 },
    H: { services: 391400.62, goods: 238038.48 },
    I: { services: 721650.46, goods: 355672.64 },
    J: { services: 874069.29, goods: 434895.92 },
    K: { services: 1208890.6, goods: 525732.01 },
  };

  const MONOTRIBUTO_ANNUAL_LIMITS: Record<string, number> = {
    A: 8992597.87,
    B: 13175201.52,
    C: 18473166.15,
    D: 22934610.05,
    E: 26977793.6,
    F: 33809379.57,
    G: 40431835.35,
    H: 61344853.64,
    I: 68664410.05,
    J: 78632948.76,
    K: 94805682.9,
  };

  const toCents = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    return Math.round(value * 100);
  };

  const resolveMonotributoLimits = (category?: string | null, activity?: string | null) => {
    if (!category) return null;
    const key = category.toUpperCase();
    const monthly = MONOTRIBUTO_MONTHLY_LIMITS[key];
    const annual = MONOTRIBUTO_ANNUAL_LIMITS[key];
    const activityKey = activity === 'goods' ? 'goods' : 'services';

    return {
      category: key,
      activity: activityKey,
      monthlyLimitCents: toCents(monthly?.[activityKey] ?? null),
      annualLimitCents: toCents(annual ?? null),
    };
  };

  const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);
  const startOfYear = (date: Date): Date => new Date(date.getFullYear(), 0, 1);

  const notifyReceiptStatus = async (params: {
    receipt: { sessionId?: string | null };
    workspaceId: string;
    amount?: number | null;
    orderNumber?: string | null;
    status: 'accepted' | 'rejected';
    reason?: string | null;
  }): Promise<void> => {
    const { receipt, workspaceId, amount, orderNumber, status, reason } = params;
    if (!receipt.sessionId) return;

    const session = await app.prisma.agentSession.findFirst({
      where: { id: receipt.sessionId, workspaceId },
      include: {
        workspace: {
          include: {
            whatsappNumbers: {
              where: { isActive: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!session || session.channelType !== 'whatsapp' || !session.channelId) {
      return;
    }

    const whatsappNumber = session.workspace.whatsappNumbers[0];
    if (!whatsappNumber) return;

    const apiKey = resolveWhatsAppApiKey(whatsappNumber);
    if (!apiKey) return;

    try {
      const { InfobipClient } = await import('@nexova/integrations/whatsapp');
      const client = new InfobipClient({
        apiKey,
        baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
        senderNumber: whatsappNumber.phoneNumber,
      });

      const amountLabel = amount ? `$${formatMoney(amount)}` : 'el pago';
      const orderLabel = orderNumber ? `del pedido ${orderNumber}` : 'de tu pedido';
      const text =
        status === 'accepted'
          ? `✅ Tu pago por ${amountLabel} ${orderLabel} fue aceptado. ¡Gracias!`
          : `❌ Tu pago por ${amountLabel} ${orderLabel} fue rechazado.${reason ? ` Motivo: ${reason}` : ' Si fue un error, enviá el comprobante nuevamente.'}`;

      await client.sendText(session.channelId, text);
    } catch (error) {
      app.log.error(error, 'Failed to notify receipt status via WhatsApp');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // MERCADOPAGO OAUTH
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /integrations/mercadopago/auth-url
   * Get OAuth authorization URL to connect MercadoPago
   */
  app.get('/mercadopago/auth-url', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertMercadoPagoEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const { url, state } = mpService.getAuthorizationUrl(workspaceId);

      // State contains workspaceId.timestamp.random and is validated in handleOAuthCallback
      return reply.send({ url, state });
    },
  });

  /**
   * GET /integrations/mercadopago/callback
   * OAuth callback - exchanges code for tokens
   */
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>('/mercadopago/callback', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { code, state, error } = request.query;

      // Redirect URL for dashboard
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
      const redirectBase = `${dashboardUrl}/settings/applications`;

      if (error) {
        request.log.warn({ error }, 'MercadoPago OAuth error');
        return reply.redirect(`${redirectBase}?mp_error=${encodeURIComponent(error)}`);
      }

      if (!code || !state) {
        return reply.redirect(`${redirectBase}?mp_error=missing_params`);
      }

      // State validation is done inside handleOAuthCallback (checks workspaceId and timestamp)
      try {
        const { workspaceId } = await mpService.handleOAuthCallback(code, state);
        const canUseMercadoPago = await isMercadoPagoEnabledForWorkspace(workspaceId);
        if (!canUseMercadoPago) {
          await mpService.disconnect(workspaceId);
          return reply.redirect(`${redirectBase}?mp_error=${encodeURIComponent('forbidden_by_plan')}`);
        }
        return reply.redirect(`${redirectBase}?mp_connected=true&workspace=${workspaceId}`);
      } catch (err) {
        request.log.error(err, 'Failed to complete MercadoPago OAuth');
        const errorMsg = err instanceof Error ? err.message : 'unknown_error';
        return reply.redirect(`${redirectBase}?mp_error=${encodeURIComponent(errorMsg)}`);
      }
    },
  });

  /**
   * GET /integrations/mercadopago/status
   * Get MercadoPago connection status
   */
  app.get('/mercadopago/status', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertMercadoPagoEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const status = await mpService.getStatus(workspaceId);
      return reply.send(status);
    },
  });

  /**
   * DELETE /integrations/mercadopago
   * Disconnect MercadoPago
   */
  app.delete('/mercadopago', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertMercadoPagoEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      await mpService.disconnect(workspaceId);
      return reply.send({ success: true, message: 'MercadoPago disconnected' });
    },
  });

  /**
   * GET /integrations/mercadopago/health
   * Health check for MercadoPago connection
   */
  app.get('/mercadopago/health', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertMercadoPagoEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const health = await mpService.healthCheck(workspaceId);
      return reply.send(health);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // ARCA (AFIP) - WSFEv1
  // ═══════════════════════════════════════════════════════════════════════════════

  const arcaConnectSchema = z.object({
    cuit: z.string().min(6),
    pointOfSale: z.number().int().min(1),
    certificate: z.string().min(1),
    privateKey: z.string().min(1).optional(),
    environment: z.enum(['test', 'prod']).default('test'),
  });

  const arcaCsrSchema = z.object({
    cuit: z.string().min(6),
    pointOfSale: z.number().int().min(1),
    environment: z.enum(['test', 'prod']).default('test'),
  });

  const arcaInvoiceSchema = z.object({
    orderId: z.string().uuid().optional(),
    pointOfSale: z.number().int().min(1).optional(),
    cbteTipo: z.number().int().min(1),
    concept: z.number().int().min(1),
    docTipo: z.number().int().min(1),
    docNro: z.number().min(0),
    cbteFch: z.string().optional(),
    impTotal: z.number().min(0),
    impNeto: z.number().min(0),
    impIVA: z.number().min(0).optional(),
    impTrib: z.number().min(0).optional(),
    impOpEx: z.number().min(0).optional(),
    impTotConc: z.number().min(0).optional(),
    monId: z.string().optional(),
    monCotiz: z.number().optional(),
    condicionIVAReceptorId: z.number().int().min(1).optional(),
    iva: z.array(z.object({
      Id: z.number().int(),
      BaseImp: z.number(),
      Importe: z.number(),
    })).optional(),
  });

  /**
   * POST /integrations/arca/connect
   * Connect ARCA WSFEv1 using certificate + key
   */
  app.post('/arca/connect', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const body = arcaConnectSchema.parse(request.body);
      try {
        await arcaService.connect(workspaceId, body);
        const status = await arcaService.getStatus(workspaceId);
        return reply.send(status);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al conectar ARCA';
        const status = error instanceof ArcaIntegrationError ? 400 : 500;
        return reply.status(status).send({ error: message });
      }
    },
  });

  /**
   * POST /integrations/arca/csr
   * Generate CSR + store encrypted private key
   */
  app.post('/arca/csr', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const body = arcaCsrSchema.parse(request.body);
      try {
        const result = await arcaService.generateCsr(workspaceId, body);
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al generar CSR';
        return reply.status(500).send({ error: message });
      }
    },
  });

  /**
   * GET /integrations/arca/status
   */
  app.get('/arca/status', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const status = await arcaService.getStatus(workspaceId);
      return reply.send(status);
    },
  });

  /**
   * DELETE /integrations/arca
   */
  app.delete('/arca', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      await arcaService.disconnect(workspaceId);
      return reply.send({ success: true, message: 'ARCA disconnected' });
    },
  });

  /**
   * GET /integrations/arca/health
   */
  app.get('/arca/health', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const health = await arcaService.healthCheck(workspaceId);
      return reply.send(health);
    },
  });

  /**
   * GET /integrations/arca/summary
   * Billing summary (month/year, inside vs outside Nexova)
   */
  app.get('/arca/summary', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const now = new Date();
      const monthStart = startOfMonth(now);
      monthStart.setHours(0, 0, 0, 0);
      const yearStart = startOfYear(now);
      yearStart.setHours(0, 0, 0, 0);

      let syncError: string | null = null;
      try {
        await arcaService.syncInvoicesForRange(workspaceId, { from: yearStart, includeAllPointsOfSale: true });
      } catch (error) {
        syncError = error instanceof Error ? error.message : 'No se pudo sincronizar con ARCA';
      }

      const [monthTotalsRaw, yearTotalsRaw, workspace] = await Promise.all([
        app.prisma.arcaInvoiceRecord.groupBy({
          by: ['origin'],
          where: {
            workspaceId,
            status: 'authorized',
            cbteFch: { gte: monthStart, lte: now },
          },
          _sum: { total: true },
        }),
        app.prisma.arcaInvoiceRecord.groupBy({
          by: ['origin'],
          where: {
            workspaceId,
            status: 'authorized',
            cbteFch: { gte: yearStart, lte: now },
          },
          _sum: { total: true },
        }),
        app.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { settings: true },
        }),
      ]);

      const mapTotals = (rows: Array<{ origin: string; _sum: { total: number | null } }>) => {
        let inside = 0;
        let outside = 0;
        rows.forEach((row) => {
          if (row.origin === 'nexova') {
            inside = row._sum.total || 0;
          } else {
            outside += row._sum.total || 0;
          }
        });
        return {
          inside,
          outside,
          total: inside + outside,
        };
      };

      const monthTotals = mapTotals(monthTotalsRaw);
      const yearTotals = mapTotals(yearTotalsRaw);

      const settings = (workspace?.settings as Record<string, unknown>) || {};
      const limits = resolveMonotributoLimits(
        (settings.monotributoCategory as string) || null,
        (settings.monotributoActivity as string) || null
      );

      const buildLimit = (limit: number | null, used: number) => {
        if (!limit) return null;
        const remaining = Math.max(limit - used, 0);
        const percent = limit > 0 ? Math.min(used / limit, 1) : 0;
        return { limit, used, remaining, percent };
      };

      return reply.send({
        range: {
          month: { from: monthStart.toISOString(), to: now.toISOString() },
          year: { from: yearStart.toISOString(), to: now.toISOString() },
        },
        totals: {
          month: monthTotals,
          year: yearTotals,
        },
        limits: limits
          ? {
              category: limits.category,
              activity: limits.activity,
              month: buildLimit(limits.monthlyLimitCents, monthTotals.total),
              year: buildLimit(limits.annualLimitCents, yearTotals.total),
            }
          : null,
        sync: {
          ok: !syncError,
          error: syncError,
        },
      });
    },
  });

  /**
   * GET /integrations/arca/invoices/by-order/:orderId
   * Returns the latest ARCA invoice stored for a given Nexova order.
   */
  app.get<{
    Params: { orderId: string };
  }>('/arca/invoices/by-order/:orderId', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const { orderId } = request.params as { orderId: string };
      if (!orderId) {
        return reply.status(400).send({ error: 'orderId required' });
      }

      const invoice = await app.prisma.arcaInvoice.findFirst({
        where: { workspaceId, orderId },
        orderBy: { createdAt: 'desc' },
      });

      if (!invoice) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Invoice not found' });
      }

      return reply.send({
        invoice: {
          id: invoice.id,
          orderId: invoice.orderId,
          cuit: invoice.cuit,
          pointOfSale: invoice.pointOfSale,
          cbteTipo: invoice.cbteTipo,
          cbteNro: invoice.cbteNro,
          cae: invoice.cae,
          caeExpiresAt: invoice.caeExpiresAt?.toISOString() || null,
          total: invoice.total,
          currency: invoice.currency,
          status: invoice.status,
          createdAt: invoice.createdAt.toISOString(),
        },
      });
    },
  });

  /**
   * POST /integrations/arca/invoices
   * Issue WSFEv1 invoice
   */
  app.post('/arca/invoices', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const body = arcaInvoiceSchema.parse(request.body);
      const normalizedBody = {
        ...body,
        condicionIVAReceptorId: body.condicionIVAReceptorId ?? 5,
      };
      try {
        const result = await arcaService.issueInvoice(workspaceId, normalizedBody);
        const status = await arcaService.getStatus(workspaceId);
        const totalCents = Math.round(normalizedBody.impTotal * 100);

        if (result.cbteNro) {
          const cbteFch = normalizedBody.cbteFch || new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const issuedAt = parseArcaDate(cbteFch);

          await app.prisma.arcaInvoice.create({
            data: {
              workspaceId,
              orderId: normalizedBody.orderId || null,
              cuit: status.cuit || '',
              pointOfSale: normalizedBody.pointOfSale || status.pointOfSale || 0,
              cbteTipo: normalizedBody.cbteTipo,
              cbteNro: result.cbteNro,
              cae: result.cae,
              caeExpiresAt: parseArcaDate(result.caeExpiresAt) || undefined,
              total: totalCents,
              currency: 'ARS',
              status: result.approved ? 'authorized' : 'rejected',
              requestData: normalizedBody as unknown as object,
              responseData: result.raw as unknown as object,
            },
          });

          if (issuedAt) {
            await app.prisma.arcaInvoiceRecord.upsert({
              where: {
                workspaceId_pointOfSale_cbteTipo_cbteNro: {
                  workspaceId,
                  pointOfSale: normalizedBody.pointOfSale || status.pointOfSale || 0,
                  cbteTipo: normalizedBody.cbteTipo,
                  cbteNro: result.cbteNro,
                },
              },
              create: {
                workspaceId,
                pointOfSale: normalizedBody.pointOfSale || status.pointOfSale || 0,
                cbteTipo: normalizedBody.cbteTipo,
                cbteNro: result.cbteNro,
                cbteFch: issuedAt,
                total: totalCents,
                currency: 'ARS',
                docTipo: normalizedBody.docTipo,
                docNro: String(normalizedBody.docNro),
                status: result.approved ? 'authorized' : 'rejected',
                origin: 'nexova',
              },
              update: {
                cbteFch: issuedAt,
                total: totalCents,
                currency: 'ARS',
                docTipo: normalizedBody.docTipo,
                docNro: String(normalizedBody.docNro),
                status: result.approved ? 'authorized' : 'rejected',
                origin: 'nexova',
              },
            });
          }
        }

        if (normalizedBody.orderId && result.approved) {
          const existingOrder = await app.prisma.order.findFirst({
            where: { id: normalizedBody.orderId, workspaceId },
            select: { status: true },
          });

          if (existingOrder) {
            await app.prisma.$transaction([
              app.prisma.order.update({
                where: { id: normalizedBody.orderId },
                data: { status: 'invoiced' },
              }),
              app.prisma.orderStatusHistory.create({
                data: {
                  orderId: normalizedBody.orderId,
                  previousStatus: existingOrder.status,
                  newStatus: 'invoiced',
                  reason: 'Factura emitida vía ARCA',
                  changedBy: 'system',
                },
              }),
            ]);
          }
        }

        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al emitir factura';
        return reply.status(500).send({ error: message });
      }
    },
  });

  /**
   * POST /integrations/arca/invoices/:orderId/send
   * Sends the latest authorized invoice for a given order to the customer via WhatsApp.
   */
  app.post<{
    Params: { orderId: string };
  }>('/arca/invoices/:orderId/send', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertArcaEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const { orderId } = request.params as { orderId: string };
      if (!orderId) {
        return reply.status(400).send({ error: 'orderId required' });
      }

      const order = await app.prisma.order.findFirst({
        where: { id: orderId, workspaceId, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          items: {
            select: {
              name: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
          workspace: {
            select: {
              name: true,
            },
          },
          customer: {
            select: {
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!order) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
      }

      const customerPhone = order.customer?.phone;
      if (!customerPhone) {
        return reply.status(400).send({ error: 'NO_PHONE', message: 'Customer has no phone' });
      }

      const invoice = await app.prisma.arcaInvoice.findFirst({
        where: { workspaceId, orderId, status: 'authorized' },
        orderBy: { createdAt: 'desc' },
      });

      if (!invoice) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Invoice not found' });
      }

      const whatsappNumber = await app.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
        select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true },
      });

      if (!whatsappNumber) {
        return reply.status(400).send({ error: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp not configured' });
      }

      const apiKey = resolveWhatsAppApiKey(whatsappNumber) || process.env.INFOBIP_API_KEY || '';
      if (!apiKey) {
        return reply.status(400).send({ error: 'WHATSAPP_API_KEY_MISSING', message: 'WhatsApp API key missing' });
      }

      const formatCbteTipoLabel = (cbteTipo: number): string => {
        if (cbteTipo === 1) return 'Factura A';
        if (cbteTipo === 6) return 'Factura B';
        if (cbteTipo === 11) return 'Factura C';
        return `Comprobante ${cbteTipo}`;
      };

      const formatCbteNumber = (pointOfSale: number, cbteNro: number): string => {
        const pv = String(pointOfSale || 0).padStart(4, '0');
        const nro = String(cbteNro || 0).padStart(8, '0');
        return `${pv}-${nro}`;
      };

      const cbteLabel = formatCbteTipoLabel(invoice.cbteTipo);
      const cbteNumber = formatCbteNumber(invoice.pointOfSale, invoice.cbteNro);

      const customerName =
        [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ').trim() ||
        '-';

      const { buffer, filename } = await arcaPdfService.generateInvoicePdf({
        businessName: order.workspace?.name || 'Nexova',
        invoiceLabel: cbteLabel,
        invoiceNumber: cbteNumber,
        orderNumber: order.orderNumber,
        issuedAt: invoice.createdAt,
        cae: invoice.cae,
        caeExpiresAt: invoice.caeExpiresAt,
        customerName,
        customerPhone: customerPhone,
        totalCents: invoice.total,
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPrice,
          totalCents: item.total,
        })),
      });

      const invoicesDir = path.join(UPLOAD_DIR, 'invoices');
      await fs.mkdir(invoicesDir, { recursive: true });

      const safeFilename = sanitizeFilename(filename || `factura_${order.orderNumber}.pdf`);
      const uniqueName = `${workspaceId}-${orderId}-${invoice.id}-${Date.now()}-${randomUUID().slice(0, 8)}-${safeFilename}`;
      await fs.writeFile(path.join(invoicesDir, uniqueName), buffer);

      const publicBase = await resolvePublicBaseUrl(request);
      if (!publicBase) {
        return reply.status(400).send({
          error: 'PUBLIC_URL_MISSING',
          message:
            'No hay una URL publica configurada para enviar el PDF. Configura API_BASE_URL o PUBLIC_BASE_URL (por ejemplo, tu tunnel de Cloudflare).',
        });
      }

      const mediaUrl = `${publicBase}/uploads/invoices/${uniqueName}`;
      const caption = `Te dejo la factura de tu ${order.orderNumber} gracias por tu compra!`;

      try {
        const { InfobipClient } = await import('@nexova/integrations/whatsapp');
        const client = new InfobipClient({
          apiKey,
          baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
          senderNumber: whatsappNumber.phoneNumber,
        });

        const to = normalizePhone(customerPhone);
        const result = await client.sendDocument(to, mediaUrl, caption);

        try {
          await app.prisma.eventOutbox.create({
            data: {
              workspaceId,
              eventType: 'message.sent',
              aggregateType: 'Message',
              aggregateId: result.messageId || `${orderId}:${Date.now()}`,
              payload: {
                to,
                content: {
                  mediaType: 'document',
                  mediaUrl,
                  filename: safeFilename,
                  caption,
                },
                status: result.status,
              },
              status: 'pending',
              correlationId: null,
            },
          });
        } catch {
          // Non-fatal
        }

        return reply.send({ success: true, sent: true, to });
      } catch (error) {
        request.log.error(error, 'Failed to send invoice via WhatsApp');
        const message = error instanceof Error ? error.message : 'Failed to send invoice via WhatsApp';
        return reply.status(500).send({ error: 'SEND_FAILED', message });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // MERCADOPAGO WEBHOOKS (IPN)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /integrations/webhooks/mercadopago/:workspaceId
   * Receive MercadoPago IPN notifications
   */
  app.post<{
    Params: { workspaceId: string };
    Body: unknown;
  }>('/webhooks/mercadopago/:workspaceId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', format: 'uuid' },
        },
        required: ['workspaceId'],
      },
    },
    handler: async (request, reply) => {
      const { workspaceId } = request.params;
      const payload = request.body;

      request.log.info({ workspaceId, payload }, 'Received MercadoPago webhook');

      try {
        const result = await mpService.processWebhook(workspaceId, payload, {
          'x-signature': request.headers['x-signature'] as string | undefined,
          'x-request-id': request.headers['x-request-id'] as string | undefined,
        });

        // If payment approved, create ledger entry
        if (result.payment?.isApproved && result.payment.externalReference) {
          // Parse external reference: workspaceId:orderId:timestamp
          const [, orderId] = result.payment.externalReference.split(':');

          if (orderId && orderId !== 'account') {
            // Get order and customer
            const order = await app.prisma.order.findFirst({
              where: { id: orderId, workspaceId },
              select: { id: true, customerId: true, orderNumber: true },
            });

            if (order) {
              // Apply payment using ledger service
              await ledgerService.applyPaymentToOrder(
                workspaceId,
                order.customerId,
                order.id,
                result.payment.amount,
                'Payment',
                result.payment.id,
                'webhook'
              );

              await recalcCustomerFinancials(app.prisma, workspaceId, order.customerId);

              request.log.info(
                { orderId, amount: result.payment.amount },
                'Payment applied to order from webhook'
              );
            }
          } else {
            // Account payment - find customer by payer email if available
            // For now, log and skip
            request.log.info(
              { amount: result.payment.amount },
              'Account payment received, needs manual application'
            );
          }
        }

        return reply.send({ status: 'processed', type: result.type });
      } catch (err) {
        if (err instanceof IntegrationServiceError) {
          if (err.code === 'INVALID_SIGNATURE') {
            return reply.status(401).send({ error: 'Invalid signature' });
          }
          if (err.code === 'NOT_CONNECTED') {
            return reply.status(404).send({ error: 'Integration not connected' });
          }
        }

        request.log.error(err, 'Failed to process MercadoPago webhook');
        // Return 200 to prevent retries for internal errors
        return reply.send({ status: 'error', error: 'Processing failed' });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /integrations/payments/create-link
   * Create a MercadoPago payment link
   */
  app.post<{
    Body: {
      orderId?: string;
      amount?: number;
      description?: string;
      customerId?: string;
    };
  }>('/payments/create-link', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          orderId: { type: 'string', format: 'uuid' },
          amount: { type: 'number', minimum: 1 },
          description: { type: 'string', maxLength: 200 },
          customerId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }
      const enabled = await assertMercadoPagoEnabled(workspaceId, request.user!.sub);
      if (!enabled.ok) {
        return reply.status(enabled.code).send(enabled.payload);
      }

      const { orderId, amount, description, customerId } = request.body;

      if (!orderId && !amount) {
        return reply.status(400).send({ error: 'orderId or amount required' });
      }

      let paymentAmount = amount;
      let paymentDescription = description || 'Pago';
      let customer: { email?: string; firstName?: string; lastName?: string } | undefined;

      // If orderId, get order details
      if (orderId) {
        const order = await app.prisma.order.findFirst({
          where: { id: orderId, workspaceId },
          include: { customer: true },
        });

        if (!order) {
          return reply.status(404).send({ error: 'Order not found' });
        }

        paymentAmount = amount || (order.total - order.paidAmount);
        paymentDescription = description || `Pago pedido #${order.orderNumber}`;
        customer = {
          email: order.customer.email || undefined,
          firstName: order.customer.firstName || undefined,
          lastName: order.customer.lastName || undefined,
        };
      } else if (customerId) {
        const cust = await app.prisma.customer.findFirst({
          where: { id: customerId, workspaceId },
        });
        if (cust) {
          customer = {
            email: cust.email || undefined,
            firstName: cust.firstName || undefined,
            lastName: cust.lastName || undefined,
          };
        }
      }

      const externalReference = `${workspaceId}:${orderId || 'account'}:${Date.now()}`;

      try {
        const result = await mpService.createPaymentLink(workspaceId, {
          amount: paymentAmount!,
          description: paymentDescription,
          externalReference,
          payerEmail: customer?.email,
          payerName: customer?.firstName
            ? `${customer.firstName} ${customer.lastName || ''}`.trim()
            : undefined,
          notificationUrl: `${process.env.API_BASE_URL}/api/v1/integrations/webhooks/mercadopago/${workspaceId}`,
          expirationMinutes: 60,
          metadata: { workspaceId, orderId, customerId },
        });

        // Store payment record if orderId provided
        if (orderId) {
          await app.prisma.payment.create({
            data: {
              orderId,
              provider: 'mercadopago',
              externalId: result.preferenceId,
              status: 'pending',
              amount: paymentAmount!,
              currency: 'ARS',
              paymentUrl: result.paymentUrl,
              providerData: { preferenceId: result.preferenceId, externalReference },
            },
          });
        }

        return reply.send({
          success: true,
          paymentId: result.paymentId,
          paymentUrl: result.paymentUrl,
          amount: paymentAmount,
          expiresAt: result.expiresAt?.toISOString(),
        });
      } catch (err) {
        if (err instanceof IntegrationServiceError) {
          return reply.status(400).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // RECEIPTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /integrations/receipts
   * List receipts for workspace
   */
  app.get<{
    Querystring: { status?: string; customerId?: string; limit?: number; offset?: number };
  }>('/receipts', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { status, customerId, limit = 50, offset = 0 } = request.query;

      const where = {
        workspaceId,
        ...(status && { status }),
        ...(customerId && { customerId }),
      };

      const [receipts, total] = await Promise.all([
        app.prisma.receipt.findMany({
          where,
          orderBy: { uploadedAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
            order: { select: { id: true, orderNumber: true } },
          },
        }),
        app.prisma.receipt.count({ where }),
      ]);

      return reply.send({ receipts, total });
    },
  });

  /**
   * GET /integrations/receipts/:id/file
   * Proxy receipt file from Infobip
   */
  app.get<{
    Params: { id: string };
  }>('/receipts/:id/file', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { id } = request.params;

      const receipt = await app.prisma.receipt.findFirst({
        where: { id, workspaceId },
        select: { id: true, fileRef: true, fileType: true },
      });

      if (!receipt) {
        return reply.status(404).send({ error: 'Receipt not found' });
      }

      const contentType = receipt.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg';
      const fileRef = receipt.fileRef;
      if (!fileRef) {
        return reply.status(404).send({ error: 'RECEIPT_NO_FILE', message: 'Comprobante sin archivo' });
      }
      const resolveLocalPath = (ref: string): string | null => {
        if (ref.startsWith('/uploads/')) {
          const relative = ref.replace('/uploads/', '');
          return path.join(UPLOAD_DIR, relative);
        }
        try {
          const url = new URL(ref);
          if (url.pathname.startsWith('/uploads/')) {
            const relative = url.pathname.replace('/uploads/', '');
            return path.join(UPLOAD_DIR, relative);
          }
        } catch {
          // not a URL
        }
        return null;
      };

      const localPath = resolveLocalPath(fileRef);
      if (localPath && existsSync(localPath)) {
        const buffer = await fs.readFile(localPath);
        reply.header('Content-Type', contentType);
        return reply.send(buffer);
      }

      const whatsappNumber = await app.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
        select: { apiKeyEnc: true, apiKeyIv: true, provider: true },
      });

      const apiKey =
        (whatsappNumber?.apiKeyEnc && whatsappNumber?.apiKeyIv
          ? decrypt({ encrypted: whatsappNumber.apiKeyEnc, iv: whatsappNumber.apiKeyIv })
          : '') || process.env.INFOBIP_API_KEY || '';

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers.Authorization = `App ${apiKey}`;
      }

      const response = await fetch(fileRef, { headers });
      if (!response.ok) {
        const errorText = await response.text();
        return reply.status(502).send({
          error: 'RECEIPT_FETCH_FAILED',
          message: errorText || `HTTP ${response.status}`,
        });
      }

      reply.header('Content-Type', response.headers.get('content-type') || contentType);

      const buffer = Buffer.from(await response.arrayBuffer());
      return reply.send(buffer);
    },
  });

  /**
   * DELETE /integrations/receipts/:id
   * Delete a receipt and revert applied amount if needed
   */
  app.delete<{
    Params: { id: string };
  }>('/receipts/:id', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { id } = request.params;

      const receipt = await app.prisma.receipt.findFirst({
        where: { id, workspaceId },
        select: {
          id: true,
          fileRef: true,
          status: true,
          appliedAmount: true,
          customerId: true,
          orderId: true,
        },
      });

      if (!receipt) {
        return reply.status(404).send({ error: 'Receipt not found' });
      }

      const appliedAmount = receipt.appliedAmount ?? 0;
      const shouldRevert = receipt.status === 'applied' && appliedAmount > 0;
      let orderSummary: {
        id: string;
        orderNumber: string;
        status: string;
        total: number;
        paidAmount: number;
        pendingAmount: number;
      } | null = null;

      await app.prisma.$transaction(async (tx) => {
        if (shouldRevert) {
          const customer = await tx.customer.findFirst({
            where: { id: receipt.customerId, workspaceId },
            select: { currentBalance: true },
          });

          if (!customer) {
            throw new Error('Customer not found');
          }

          const newBalance = customer.currentBalance + appliedAmount;

          await tx.customer.updateMany({
            where: { id: receipt.customerId, workspaceId },
            data: { currentBalance: newBalance },
          });

          await tx.ledgerEntry.create({
            data: {
              workspaceId,
              customerId: receipt.customerId,
              type: 'debit',
              amount: appliedAmount,
              currency: 'ARS',
              balanceAfter: newBalance,
              referenceType: 'ReceiptReversal',
              referenceId: receipt.id,
              description: 'Reverso de comprobante',
              metadata: receipt.orderId ? { orderId: receipt.orderId } : undefined,
              createdBy: request.user?.sub || 'system',
            },
          });

          if (receipt.orderId) {
            const order = await tx.order.findFirst({
              where: { id: receipt.orderId, workspaceId },
              select: {
                id: true,
                orderNumber: true,
                status: true,
                total: true,
                paidAmount: true,
                paidAt: true,
              },
            });

            if (order) {
              const newPaidAmount = Math.max((order.paidAmount ?? 0) - appliedAmount, 0);
              const isFullyPaid = newPaidAmount >= order.total;
              const nextStatus = isFullyPaid ? 'paid' : (order.status === 'paid' ? 'accepted' : order.status);

              await tx.order.updateMany({
                where: { id: order.id, workspaceId },
                data: {
                  paidAmount: newPaidAmount,
                  paidAt: isFullyPaid ? (order.paidAt ?? new Date()) : null,
                  status: nextStatus,
                },
              });

              orderSummary = {
                id: order.id,
                orderNumber: order.orderNumber,
                status: nextStatus,
                total: order.total,
                paidAmount: newPaidAmount,
                pendingAmount: Math.max(order.total - newPaidAmount, 0),
              };
            }
          }
        }

        await tx.payment.deleteMany({
          where: {
            provider: 'receipt',
            externalId: receipt.id,
          },
        });

        await tx.receipt.deleteMany({ where: { id: receipt.id, workspaceId } });
      });

      if (shouldRevert) {
        await recalcCustomerFinancials(app.prisma, workspaceId, receipt.customerId);
      }

      const resolveLocalPath = (ref: string): string | null => {
        if (ref.startsWith('/uploads/')) {
          const relative = ref.replace('/uploads/', '');
          return path.join(UPLOAD_DIR, relative);
        }
        try {
          const url = new URL(ref);
          if (url.pathname.startsWith('/uploads/')) {
            const relative = url.pathname.replace('/uploads/', '');
            return path.join(UPLOAD_DIR, relative);
          }
        } catch {
          // not a URL
        }
        return null;
      };

	      const localPath = receipt.fileRef ? resolveLocalPath(receipt.fileRef) : null;
	      if (localPath && existsSync(localPath)) {
	        try {
	          await fs.unlink(localPath);
	        } catch {
          // ignore cleanup errors
        }
      }

      return reply.send({
        success: true,
        deleted: true,
        order: orderSummary,
      });
    },
  });

  /**
   * POST /integrations/receipts/:id/apply
   * Apply a receipt to an order or balance
   */
  app.post<{
    Params: { id: string };
    Body: { orderId?: string; amount: number };
  }>('/receipts/:id/apply', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          orderId: { type: 'string', format: 'uuid' },
          amount: { type: 'number', minimum: 1 },
        },
        required: ['amount'],
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { id } = request.params;
      const { orderId, amount } = request.body;

      const receipt = await app.prisma.receipt.findFirst({
        where: { id, workspaceId },
      });

      if (!receipt) {
        return reply.status(404).send({ error: 'Receipt not found' });
      }

      if (receipt.status === 'applied') {
        return reply.status(400).send({ error: 'Receipt already applied' });
      }

      if (receipt.status === 'rejected') {
        return reply.status(400).send({ error: 'Receipt rejected' });
      }

      let result;
      if (orderId) {
        result = await ledgerService.applyPaymentToOrder(
          workspaceId,
          receipt.customerId,
          orderId,
          amount,
          'Receipt',
          id,
          request.user?.sub
        );
      } else {
        result = await ledgerService.applyPayment({
          workspaceId,
          customerId: receipt.customerId,
          amount,
          referenceType: 'Receipt',
          referenceId: id,
          description: 'Comprobante aplicado',
          createdBy: request.user?.sub,
        });
      }

      await recalcCustomerFinancials(app.prisma, workspaceId, receipt.customerId);

      if (orderId || receipt.orderId) {
        const targetOrderId = orderId || receipt.orderId!;
        const existingPayment = await app.prisma.payment.findFirst({
          where: {
            orderId: targetOrderId,
            provider: 'receipt',
            externalId: receipt.id,
          },
          select: { id: true },
        });

        if (!existingPayment) {
          await app.prisma.payment.create({
            data: {
              orderId: targetOrderId,
              provider: 'receipt',
              externalId: receipt.id,
              method: receipt.paymentMethod || 'transfer',
              status: 'completed',
              amount,
              currency: 'ARS',
              netAmount: amount,
              completedAt: new Date(),
              providerData: { receiptId: receipt.id, source: 'manual' },
            },
          });
        }
      }

      // Update receipt
      await app.prisma.receipt.updateMany({
        where: { id, workspaceId },
        data: {
          status: 'applied',
          appliedAmount: amount,
          orderId,
          appliedAt: new Date(),
          appliedBy: request.user?.sub,
        },
      });

      let orderSummary: {
        id: string;
        orderNumber: string;
        status: string;
        total: number;
        paidAmount: number;
        pendingAmount: number;
      } | null = null;

      if (orderId) {
        const refreshedOrder = await app.prisma.order.findFirst({
          where: { id: orderId, workspaceId, deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            paidAmount: true,
            payments: {
              where: { status: 'completed' },
              select: { amount: true },
            },
          },
        });

        if (refreshedOrder) {
          const paymentsSum = refreshedOrder.payments.reduce((sum, p) => sum + p.amount, 0);
          const paidAmount = Math.max(refreshedOrder.paidAmount ?? 0, paymentsSum);
          orderSummary = {
            id: refreshedOrder.id,
            orderNumber: refreshedOrder.orderNumber,
            status: refreshedOrder.status,
            total: refreshedOrder.total,
            paidAmount,
            pendingAmount: Math.max(refreshedOrder.total - paidAmount, 0),
          };
        }
      }

      let orderNumber: string | null = orderSummary?.orderNumber ?? null;
      if (!orderNumber && (orderId || receipt.orderId)) {
        const targetOrderId = orderId || receipt.orderId!;
        const targetOrder = await app.prisma.order.findFirst({
          where: { id: targetOrderId, workspaceId },
          select: { orderNumber: true },
        });
        orderNumber = targetOrder?.orderNumber ?? null;
      }

      await notifyReceiptStatus({
        receipt,
        workspaceId,
        amount,
        orderNumber,
        status: 'accepted',
      });

      return reply.send({
        success: true,
        ledgerEntryId: result.ledgerEntryId,
        newBalance: result.newBalance,
        ordersSettled: result.ordersSettled.map((o) => o.orderNumber),
        order: orderSummary,
      });
    },
  });

  /**
   * POST /integrations/receipts/:id/reject
   * Reject a receipt (manual review)
   */
  app.post<{
    Params: { id: string };
    Body: { reason?: string };
  }>('/receipts/:id/reject', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { id } = request.params;
      const { reason } = request.body;

      const receipt = await app.prisma.receipt.findFirst({
        where: { id, workspaceId },
      });

      if (!receipt) {
        return reply.status(404).send({ error: 'Receipt not found' });
      }

      if (receipt.status === 'applied') {
        return reply.status(400).send({ error: 'Receipt already applied' });
      }

      if (receipt.status === 'rejected') {
        return reply.status(400).send({ error: 'Receipt already rejected' });
      }

      await app.prisma.receipt.updateMany({
        where: { id, workspaceId },
        data: {
          status: 'rejected',
          rejectionReason: reason || null,
          confirmedAt: new Date(),
          confirmedBy: request.user?.sub,
        },
      });

      let orderNumber: string | null = null;
      if (receipt.orderId) {
        const targetOrder = await app.prisma.order.findFirst({
          where: { id: receipt.orderId, workspaceId },
          select: { orderNumber: true },
        });
        orderNumber = targetOrder?.orderNumber ?? null;
      }

      const amount =
        receipt.declaredAmount ?? receipt.extractedAmount ?? receipt.appliedAmount ?? null;

      await notifyReceiptStatus({
        receipt,
        workspaceId,
        amount,
        orderNumber,
        status: 'rejected',
        reason,
      });

      return reply.send({ success: true, status: 'rejected' });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // CUSTOMER BALANCE
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /integrations/customers/:id/balance
   * Get customer balance and debt summary
   */
  app.get<{ Params: { id: string } }>('/customers/:id/balance', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { id } = request.params;

      try {
        const summary = await ledgerService.getCustomerDebtSummary(workspaceId, id);
        return reply.send(summary);
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({ error: 'Customer not found' });
        }
        throw err;
      }
    },
  });

  /**
   * GET /integrations/customers/:id/ledger
   * Get customer ledger history
   */
  app.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number; type?: 'debit' | 'credit' };
  }>('/customers/:id/ledger', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { id } = request.params;
      const { limit, offset, type } = request.query;

      const result = await ledgerService.getLedgerHistory(workspaceId, id, {
        limit,
        offset,
        type,
      });

      return reply.send(result);
    },
  });

  /**
   * POST /integrations/ledger/adjustment
   * Create manual ledger adjustment (admin only)
   */
  app.post<{
    Body: {
      customerId: string;
      type: 'debit' | 'credit';
      amount: number;
      reason: string;
    };
  }>('/ledger/adjustment', {
    preHandler: [app.requirePermission('payments:update')],
    schema: {
      body: {
        type: 'object',
        properties: {
          customerId: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['debit', 'credit'] },
          amount: { type: 'number', minimum: 1 },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['customerId', 'type', 'amount', 'reason'],
      },
    },
    handler: async (request, reply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      const { customerId, type, amount, reason } = request.body;

      const result = await ledgerService.createAdjustment({
        workspaceId,
        customerId,
        type,
        amount,
        reason,
        createdBy: request.user?.sub || 'admin',
      });

      return reply.send({
        success: true,
        entry: result,
      });
    },
  });
}
