import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

import type { Prisma } from '@prisma/client';
import { type FastifyPluginAsync, type FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  WorkspaceService,
  generateTokenPair,
  hashPassword,
  hashToken,
  validatePasswordStrength,
} from '@nexova/core';
import {
  BILLING_PLAN_CATALOG,
  type CommercePlan,
} from '@nexova/shared';

import {
  addMonths,
  buildBillingCatalog,
  getApiPublicUrl,
  getBillingMonthOptions,
  getBillingTotalCents,
  getDashboardUrl,
  getLandingUrl,
  normalizeMonthsInput,
  normalizePlanInput,
} from '../../utils/billing.js';
import { isMailerConfigured, sendMail } from '../../utils/mailer.js';

const createIntentSchema = z.object({
  plan: z.string().min(1),
  months: z.coerce.number().int().optional(),
  email: z.string().email().optional(),
});

const registerWithIntentSchema = z.object({
  flowToken: z.string().min(8).max(64),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  companyName: z.string().min(2).max(255),
});

const verifyEmailSchema = z.object({
  token: z.string().min(16).max(256),
  flowToken: z.string().min(8).max(64).optional(),
});

const createCheckoutSessionSchema = z.object({
  flowToken: z.string().min(8).max(64),
});

const finalizeCheckoutSchema = z.object({
  flowToken: z.string().min(8).max(64),
  sessionId: z.string().min(5).max(255).optional(),
});

type AuthTokens = ReturnType<typeof generateTokenPair>;
type CookieOptions = NonNullable<Parameters<FastifyReply['setCookie']>[2]>;
type PendingRegistrationDraft = {
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  tokenHash: string;
  tokenExpiresAt: string;
  createdAt: string;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const hashPlainToken = (value: string): string => createHash('sha256').update(value).digest('hex');

const randomToken = (size = 32): string => randomBytes(size).toString('hex');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readIntentMetadata = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? { ...value } : {};

const readPendingRegistrationDraft = (
  metadata: Record<string, unknown>
): PendingRegistrationDraft | null => {
  const raw = metadata.pendingRegistration;
  if (!isRecord(raw)) return null;

  const email = typeof raw.email === 'string' ? normalizeEmail(raw.email) : '';
  const passwordHash = typeof raw.passwordHash === 'string' ? raw.passwordHash : '';
  const firstName = typeof raw.firstName === 'string' ? raw.firstName : null;
  const lastName = typeof raw.lastName === 'string' ? raw.lastName : null;
  const companyName = typeof raw.companyName === 'string' ? raw.companyName : null;
  const tokenHash = typeof raw.tokenHash === 'string' ? raw.tokenHash : '';
  const tokenExpiresAt = typeof raw.tokenExpiresAt === 'string' ? raw.tokenExpiresAt : '';
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';

  if (!email || !passwordHash || !tokenHash || !tokenExpiresAt || !createdAt) {
    return null;
  }

  return {
    email,
    passwordHash,
    firstName,
    lastName,
    companyName,
    tokenHash,
    tokenExpiresAt,
    createdAt,
  };
};

const formatWorkspaceName = (params: {
  companyName?: string | null;
  firstName?: string | null;
  email?: string | null;
}): string => {
  const company = params.companyName?.trim();
  if (company) return company;
  const first = params.firstName?.trim();
  if (first) return first;
  const prefix = params.email?.split('@')[0]?.trim();
  if (prefix) return prefix;
  return `workspace-${Date.now()}`;
};

const formatWorkspaceSlug = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'workspace';
};

const MP_API_BASE_URL = 'https://api.mercadopago.com';

type MercadoPagoSubscriptionStatus =
  | 'authorized'
  | 'paused'
  | 'cancelled'
  | 'pending'
  | 'unknown';

type MercadoPagoPreapproval = {
  id: string;
  status: MercadoPagoSubscriptionStatus;
  externalReference: string | null;
  initPoint: string | null;
  payerEmail: string | null;
  payerId: string | null;
  nextPaymentDate: Date | null;
};

type MercadoPagoAuthorizedPayment = {
  id: string;
  preapprovalId: string | null;
  status: string;
  amountCents: number;
  currency: string;
  paidAt: Date | null;
};

const readMercadoPagoBillingConfig = (): {
  accessToken: string;
  webhookSecret: string;
} => {
  const accessToken = (
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN ||
    process.env.MP_BILLING_ACCESS_TOKEN ||
    process.env.MP_ACCESS_TOKEN ||
    process.env.MP_PRIVATE_ACCESS_TOKEN ||
    ''
  ).trim();

  const webhookSecret = (
    process.env.MP_SUBSCRIPTIONS_WEBHOOK_SECRET ||
    process.env.MP_BILLING_WEBHOOK_SECRET ||
    ''
  ).trim();

  return { accessToken, webhookSecret };
};

const ensureMercadoPagoConfigured = (): { accessToken: string; webhookSecret: string } => {
  const config = readMercadoPagoBillingConfig();
  if (!config.accessToken) {
    throw new Error('MP_SUBSCRIPTIONS_ACCESS_TOKEN is required');
  }
  return config;
};

const sanitizeMercadoPagoStatus = (value: unknown): MercadoPagoSubscriptionStatus => {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'authorized') return 'authorized';
  if (normalized === 'paused') return 'paused';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'pending') return 'pending';
  return 'unknown';
};

const readString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isMercadoPagoConfigError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    (error.message.includes('MP_SUBSCRIPTIONS_ACCESS_TOKEN') ||
      error.message.toLowerCase().includes('mercadopago'))
  );
};

const safeCompare = (left: string, right: string): boolean => {
  const leftBuf = Buffer.from(left, 'utf8');
  const rightBuf = Buffer.from(right, 'utf8');
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
};

const verifyMercadoPagoWebhookSignature = (params: {
  requestId: string;
  dataId: string;
  signatureHeader: string;
  secret: string;
}): boolean => {
  const parts = params.signatureHeader.split(',').map((part) => part.trim());
  const ts = parts.find((part) => part.startsWith('ts='))?.slice(3);
  const v1 = parts.find((part) => part.startsWith('v1='))?.slice(3);
  if (!ts || !v1) return false;

  const manifest = `id:${params.dataId};request-id:${params.requestId};ts:${ts};`;
  const expected = createHmac('sha256', params.secret).update(manifest).digest('hex');
  return safeCompare(v1, expected);
};

const readGoogleConfig = (): {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${getApiPublicUrl()}/api/v1/billing/auth/google/callback`;
  const enabled = Boolean(clientId && clientSecret && redirectUri);
  return {
    enabled,
    clientId,
    clientSecret,
    redirectUri,
  };
};

const mercadopagoRequest = async <T>(
  accessToken: string,
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  }
): Promise<T> => {
  const method = options?.method || 'GET';
  const response = await fetch(`${MP_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
    },
    body: method === 'POST' ? JSON.stringify(options?.body || {}) : undefined,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(
      `MercadoPago request failed (${method} ${path}) with ${response.status}${details ? `: ${details}` : ''}`
    );
  }

  return response.json() as Promise<T>;
};

const parsePreapprovalResponse = (payload: unknown): MercadoPagoPreapproval => {
  const data = isRecord(payload) ? payload : {};
  const id = readString(data.id);
  if (!id) {
    throw new Error('MercadoPago preapproval response missing id');
  }

  const autoRecurring =
    isRecord(data.auto_recurring) ? data.auto_recurring : {};

  return {
    id,
    status: sanitizeMercadoPagoStatus(data.status),
    externalReference: readString(data.external_reference),
    initPoint: readString(data.init_point),
    payerEmail: readString(data.payer_email),
    payerId: readString(data.payer_id),
    nextPaymentDate: parseDate(
      data.next_payment_date ||
        data.date_of_next_charge ||
        autoRecurring.next_payment_date
    ),
  };
};

const parseAuthorizedPaymentResponse = (payload: unknown): MercadoPagoAuthorizedPayment => {
  const data = isRecord(payload) ? payload : {};
  const idCandidate = data.id;
  const id =
    (typeof idCandidate === 'string' && idCandidate.trim()) ||
    (typeof idCandidate === 'number' ? String(idCandidate) : '');
  if (!id) {
    throw new Error('MercadoPago authorized payment response missing id');
  }

  const amountRaw = data.transaction_amount;
  const amount =
    typeof amountRaw === 'number' && Number.isFinite(amountRaw)
      ? Math.round(amountRaw * 100)
      : 0;

  return {
    id,
    preapprovalId: readString(data.preapproval_id),
    status: typeof data.status === 'string' ? data.status : 'unknown',
    amountCents: amount,
    currency: readString(data.currency_id) || 'ARS',
    paidAt: parseDate(data.date_approved || data.date_created),
  };
};

const authCookieSameSiteRaw = (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
const authCookieSameSite: 'lax' | 'strict' | 'none' =
  authCookieSameSiteRaw === 'none' || authCookieSameSiteRaw === 'strict' || authCookieSameSiteRaw === 'lax'
    ? authCookieSameSiteRaw
    : 'lax';
const authCookieSecure = process.env.NODE_ENV === 'production' || authCookieSameSite === 'none';

const setAuthCookies = (
  reply: FastifyReply,
  tokens: AuthTokens
): void => {
  const base: CookieOptions = {
    httpOnly: true,
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    path: '/',
  };
  void reply.setCookie('accessToken', tokens.accessToken, {
    ...base,
    expires: tokens.accessTokenExpiresAt,
  });
  void reply.setCookie('refreshToken', tokens.refreshToken, {
    ...base,
    expires: tokens.refreshTokenExpiresAt,
  });
};

const isIntentExpired = (expiresAt: Date): boolean => expiresAt.getTime() <= Date.now();

const billingMembershipInclude = {
  workspace: {
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      status: true,
      settings: true,
    },
  },
  role: {
    select: {
      id: true,
      name: true,
      permissions: true,
    },
  },
} satisfies Prisma.MembershipInclude;

type BillingMembership = Prisma.MembershipGetPayload<{
  include: typeof billingMembershipInclude;
}>;

type BillingWorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  plan: BillingMembership['workspace']['plan'];
  status: BillingMembership['workspace']['status'];
  role: BillingMembership['role'];
  onboardingCompleted: boolean;
  businessType: 'bookings' | 'commerce';
};

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  const workspaceService = new WorkspaceService(fastify.prisma);
  const landingBaseUrl = getLandingUrl().replace(/\/+$/, '');
  const landingPath = (pathname: string): string => {
    const normalized = pathname.replace(/^\/+/, '');
    return `${landingBaseUrl}/${normalized}`;
  };

  const fetchMemberships = (userId: string): Promise<BillingMembership[]> => {
    return fastify.prisma.membership.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: billingMembershipInclude,
    });
  };

  const mapWorkspaces = (memberships: BillingMembership[]): BillingWorkspaceSummary[] => {
    return memberships.map((m) => {
      const settings = (m.workspace.settings as Record<string, unknown>) || {};
      const rawBusinessType =
        typeof settings.businessType === 'string'
          ? settings.businessType.toLowerCase()
          : '';
      const businessType = rawBusinessType === 'bookings' ? 'bookings' : 'commerce';
      return {
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        plan: m.workspace.plan,
        status: m.workspace.status,
        role: m.role,
        onboardingCompleted: true,
        businessType,
      };
    });
  };

  const ensureWorkspaceForUser = async (params: {
    id: string;
    firstName?: string | null;
    companyName?: string | null;
    email?: string | null;
    isSuperAdmin?: boolean;
  }): Promise<BillingMembership[]> => {
    let memberships = await fetchMemberships(params.id);
    if (memberships.length === 0 && !params.isSuperAdmin) {
      const workspaceName = formatWorkspaceName({
        companyName: params.companyName,
        firstName: params.firstName,
        email: params.email,
      });
      const workspaceSlug = `${formatWorkspaceSlug(workspaceName)}-${Date.now()}`;

      const created = await workspaceService.create({
        name: workspaceName,
        slug: workspaceSlug,
        ownerId: params.id,
      });

      // Keep the dashboard "Mi negocio" business name aligned with workspace name on initial signup.
      const companyName = params.companyName?.trim();
      if (companyName) {
        const existingSettings =
          (created.settings as Record<string, unknown>) || {};
        await fastify.prisma.workspace.update({
          where: { id: created.id },
          data: {
            settings: {
              ...existingSettings,
              businessName: companyName,
            } as Prisma.InputJsonValue,
          },
        });
      }
      memberships = await fetchMemberships(params.id);
    }
    return memberships;
  };

  const issueTokensForUser = async (params: {
    user: { id: string; email: string; isSuperAdmin: boolean };
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthTokens> => {
    const tokens = generateTokenPair({
      id: params.user.id,
      email: params.user.email,
      isSuperAdmin: params.user.isSuperAdmin,
    });
    await fastify.prisma.refreshToken.create({
      data: {
        userId: params.user.id,
        tokenHash: hashToken(tokens.refreshToken),
        family: tokens.tokenFamily,
        expiresAt: tokens.refreshTokenExpiresAt,
        ipAddress: params.ipAddress,
        deviceInfo: params.userAgent,
      },
    });
    return tokens;
  };

  const createMercadoPagoSubscription = async (params: {
    intent: {
      flowToken: string;
      plan: string;
      months: number;
      amount: number;
    };
    email: string;
  }): Promise<MercadoPagoPreapproval> => {
    const { accessToken } = ensureMercadoPagoConfigured();
    const planConfig = BILLING_PLAN_CATALOG[params.intent.plan as CommercePlan];
    const recurrenceMonths = Math.max(1, params.intent.months || 1);
    const response = await mercadopagoRequest<Record<string, unknown>>(
      accessToken,
      '/preapproval',
      {
        method: 'POST',
        idempotencyKey: params.intent.flowToken,
        body: {
          reason: `Nexova ${planConfig?.name || params.intent.plan} - ${recurrenceMonths} mes(es)`,
          external_reference: params.intent.flowToken,
          payer_email: params.email,
          back_url: `${landingPath('checkout/success/')}?flowToken=${encodeURIComponent(params.intent.flowToken)}`,
          notification_url: `${getApiPublicUrl().replace(/\/+$/, '')}/api/v1/billing/webhook`,
          auto_recurring: {
            frequency: recurrenceMonths,
            frequency_type: 'months',
            transaction_amount: params.intent.amount / 100,
            currency_id: 'ARS',
          },
          status: 'pending',
        },
      }
    );

    return parsePreapprovalResponse(response);
  };

  const getMercadoPagoPreapproval = async (preapprovalId: string): Promise<MercadoPagoPreapproval> => {
    const { accessToken } = ensureMercadoPagoConfigured();
    const payload = await mercadopagoRequest<Record<string, unknown>>(
      accessToken,
      `/preapproval/${encodeURIComponent(preapprovalId)}`
    );
    return parsePreapprovalResponse(payload);
  };

  const getMercadoPagoAuthorizedPayment = async (
    authorizedPaymentId: string
  ): Promise<MercadoPagoAuthorizedPayment> => {
    const { accessToken } = ensureMercadoPagoConfigured();
    const payload = await mercadopagoRequest<Record<string, unknown>>(
      accessToken,
      `/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`
    );
    return parseAuthorizedPaymentResponse(payload);
  };

  const setWorkspaceStatusFromSubscription = async (params: {
    preapprovalId: string;
    preapprovalStatus: MercadoPagoSubscriptionStatus;
    nextPaymentDate: Date | null;
  }): Promise<void> => {
    const subscription = await fastify.prisma.workspaceSubscription.findFirst({
      where: {
        stripeSubscriptionId: params.preapprovalId,
      },
      select: {
        workspaceId: true,
      },
    });

    if (!subscription) return;

    const subscriptionStatus =
      params.preapprovalStatus === 'authorized'
        ? 'active'
        : params.preapprovalStatus === 'cancelled'
          ? 'cancelled'
          : 'past_due';
    const workspaceStatus = subscriptionStatus === 'active' ? 'active' : 'suspended';

    await fastify.prisma.$transaction(async (tx) => {
      await tx.workspaceSubscription.updateMany({
        where: { workspaceId: subscription.workspaceId },
        data: {
          status: subscriptionStatus,
          nextChargeAt: params.nextPaymentDate || undefined,
          ...(subscriptionStatus === 'cancelled' ? { cancelledAt: new Date() } : {}),
        },
      });

      await tx.workspace.update({
        where: { id: subscription.workspaceId },
        data: {
          status: workspaceStatus,
        },
      });
    });
  };

  const recordRecurringAuthorizedPayment = async (
    authorizedPayment: MercadoPagoAuthorizedPayment
  ): Promise<void> => {
    if (!authorizedPayment.preapprovalId || authorizedPayment.status !== 'authorized') return;

    const subscription = await fastify.prisma.workspaceSubscription.findFirst({
      where: {
        stripeSubscriptionId: authorizedPayment.preapprovalId,
      },
      select: {
        workspaceId: true,
        userId: true,
        plan: true,
        billingCycleMonths: true,
      },
    });

    if (!subscription) return;

    const paymentRecordId = `mp_authorized_${authorizedPayment.id}`;
    const paidAt = authorizedPayment.paidAt || new Date();
    const cycleMonths = Math.max(1, subscription.billingCycleMonths || 1);
    const currentPeriodEnd = addMonths(paidAt, cycleMonths);

    const normalizedPlan = normalizePlanInput(subscription.plan);
    const fallbackAmount =
      normalizedPlan
        ? getBillingTotalCents(normalizedPlan, cycleMonths as 1 | 12 | 24 | 48)
        : 0;
    const amountCents = authorizedPayment.amountCents > 0 ? authorizedPayment.amountCents : fallbackAmount;

    await fastify.prisma.$transaction(async (tx) => {
      const existing = await tx.billingPayment.findUnique({
        where: { stripeCheckoutSessionId: paymentRecordId },
        select: { id: true },
      });

      if (!existing) {
        await tx.billingPayment.create({
          data: {
            workspaceId: subscription.workspaceId,
            userId: subscription.userId,
            checkoutIntentId: null,
            stripeCheckoutSessionId: paymentRecordId,
            stripePaymentIntentId: authorizedPayment.id,
            stripeCustomerId: null,
            amount: amountCents,
            currency: authorizedPayment.currency || 'ARS',
            plan: subscription.plan,
            months: cycleMonths,
            status: 'paid',
            paidAt,
            nextChargeAt: currentPeriodEnd,
            metadata: {
              provider: 'mercadopago',
              source: 'subscription_authorized_payment',
              preapprovalId: authorizedPayment.preapprovalId,
            },
          },
        });
      }

      await tx.workspaceSubscription.updateMany({
        where: { workspaceId: subscription.workspaceId },
        data: {
          status: 'active',
          currentPeriodStart: paidAt,
          currentPeriodEnd,
          nextChargeAt: currentPeriodEnd,
          cancelledAt: null,
        },
      });

      await tx.workspace.update({
        where: { id: subscription.workspaceId },
        data: { status: 'active' },
      });
    });
  };

  const markIntentAsPaid = async (params: {
    flowToken: string;
    preapproval: MercadoPagoPreapproval;
    paymentRecordId?: string;
    paymentId?: string | null;
  }): Promise<void> => {
    const { flowToken, preapproval } = params;

    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
    });

    if (!intent || !intent.workspaceId) {
      throw new Error('Checkout intent not found');
    }

    const paidAt = new Date();
    const currentPeriodStart = paidAt;
    const currentPeriodEnd =
      preapproval.nextPaymentDate || addMonths(currentPeriodStart, Math.max(1, intent.months || 1));
    const paymentRecordId = params.paymentRecordId || `mp_preapproval_${preapproval.id}`;
    const paymentId = params.paymentId || preapproval.id;
    const customerRef = preapproval.payerId || preapproval.payerEmail || undefined;
    const workspaceId = intent.workspaceId;

    await fastify.prisma.$transaction(async (tx) => {
      const existing = await tx.billingPayment.findUnique({
        where: { stripeCheckoutSessionId: paymentRecordId },
        select: { id: true },
      });

      if (!existing) {
        await tx.billingPayment.create({
          data: {
            workspaceId,
            userId: intent.userId,
            checkoutIntentId: intent.id,
            stripeCheckoutSessionId: paymentRecordId,
            stripePaymentIntentId: paymentId,
            stripeCustomerId: customerRef,
            amount: intent.amount,
            currency: intent.currency,
            plan: intent.plan,
            months: intent.months,
            status: 'paid',
            paidAt,
            nextChargeAt: currentPeriodEnd,
            metadata: {
              provider: 'mercadopago',
              preapprovalId: preapproval.id,
              preapprovalStatus: preapproval.status,
            },
          },
        });
      }

      await tx.workspaceSubscription.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          userId: intent.userId,
          plan: intent.plan,
          status: 'active',
          billingCycleMonths: intent.months,
          currentPeriodStart,
          currentPeriodEnd,
          nextChargeAt: currentPeriodEnd,
          stripeCustomerId: customerRef,
          stripeSubscriptionId: preapproval.id,
        },
        update: {
          userId: intent.userId,
          plan: intent.plan,
          status: 'active',
          billingCycleMonths: intent.months,
          currentPeriodStart,
          currentPeriodEnd,
          nextChargeAt: currentPeriodEnd,
          stripeCustomerId: customerRef,
          stripeSubscriptionId: preapproval.id,
          cancelledAt: null,
        },
      });

      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          plan: intent.plan,
          status: 'active',
        },
      });

      await tx.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          status: 'completed',
          stripeCheckoutSessionId: preapproval.id,
          stripePaymentIntentId: paymentId,
          stripeCustomerId: customerRef,
          completedAt: paidAt,
          metadata: {
            ...readIntentMetadata(intent.metadata),
            provider: 'mercadopago',
            preapprovalStatus: preapproval.status,
          } as Prisma.InputJsonValue,
        },
      });
    });
  };

  fastify.get('/catalog', async (_request, reply) => {
    const plans = buildBillingCatalog();
    return reply.send({
      plans,
      monthsOptions: getBillingMonthOptions(),
    });
  });

  fastify.post('/intents', async (request, reply) => {
    const body = createIntentSchema.parse(request.body);
    const plan = normalizePlanInput(body.plan);
    if (!plan) {
      return reply.code(400).send({
        error: 'INVALID_PLAN',
        message: 'Plan inválido',
      });
    }
    const months = normalizeMonthsInput(body.months ?? 1);
    const totalCents = getBillingTotalCents(plan, months);

    const flowToken = randomToken(24);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await fastify.prisma.billingCheckoutIntent.create({
      data: {
        flowToken,
        email: body.email ? normalizeEmail(body.email) : null,
        plan,
        months,
        amount: totalCents,
        currency: 'ARS',
        status: 'pending_auth',
        expiresAt,
      },
    });

    const planCatalog = BILLING_PLAN_CATALOG[plan];
    return reply.code(201).send({
      flowToken: created.flowToken,
      plan: created.plan,
      planName: planCatalog.name,
      months: created.months,
      monthlyAmountCents: getBillingTotalCents(plan, 1),
      totalAmountCents: created.amount,
      currency: created.currency,
      expiresAt: created.expiresAt,
    });
  });

  fastify.get('/intents/:flowToken', async (request, reply) => {
    const { flowToken } = request.params as { flowToken: string };
    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
      select: {
        flowToken: true,
        email: true,
        plan: true,
        months: true,
        amount: true,
        currency: true,
        status: true,
        userId: true,
        workspaceId: true,
        metadata: true,
        expiresAt: true,
      },
    });

    if (!intent) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Intent no encontrado',
      });
    }

    const metadata = readIntentMetadata(intent.metadata);
    const pendingRegistration = readPendingRegistrationDraft(metadata);

    return reply.send({
      intent: {
        flowToken: intent.flowToken,
        email: intent.email,
        plan: intent.plan,
        months: intent.months,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        expiresAt: intent.expiresAt,
        requiresEmailVerification:
          intent.status === 'pending_verification' && Boolean(pendingRegistration),
        isVerified:
          intent.status === 'verified' ||
          intent.status === 'checkout_created' ||
          intent.status === 'completed' ||
          Boolean(intent.userId && intent.workspaceId),
      },
      planDetails: BILLING_PLAN_CATALOG[intent.plan as CommercePlan] || null,
    });
  });

  fastify.post('/register', async (request, reply) => {
    const body = registerWithIntentSchema.parse(request.body);
    const flowToken = body.flowToken.trim();

    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
    });

    if (!intent || isIntentExpired(intent.expiresAt)) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        message: 'La sesión de checkout expiró. Volvé a seleccionar un plan.',
      });
    }

    if (intent.status === 'completed') {
      return reply.code(409).send({
        error: 'INTENT_ALREADY_COMPLETED',
        message: 'Este checkout ya fue completado.',
      });
    }

    if (intent.userId || intent.workspaceId) {
      return reply.code(409).send({
        error: 'INTENT_ALREADY_LINKED',
        message: 'Este checkout ya está asociado a una cuenta. Iniciá sesión para continuar.',
      });
    }

    const email = normalizeEmail(body.email);

    const existing = await fastify.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });

    if (existing) {
      return reply.code(409).send({
        error: 'EMAIL_EXISTS',
        message: 'Ya existe una cuenta con ese email. Iniciá sesión para continuar.',
      });
    }

    const validation = validatePasswordStrength(body.password);
    if (!validation.valid) {
      return reply.code(400).send({
        error: 'WEAK_PASSWORD',
        message: validation.errors.join('. '),
      });
    }

    const plainToken = randomToken(24);
    const tokenHash = hashPlainToken(plainToken);
    const passwordHash = await hashPassword(body.password);
    const draft: PendingRegistrationDraft = {
      email,
      passwordHash,
      firstName: body.firstName.trim() || null,
      lastName: body.lastName.trim() || null,
      companyName: body.companyName.trim() || null,
      tokenHash,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const currentMetadata = readIntentMetadata(intent.metadata);

    await fastify.prisma.billingCheckoutIntent.update({
      where: { id: intent.id },
      data: {
        email,
        status: 'pending_verification',
        metadata: {
          ...currentMetadata,
          pendingRegistration: draft,
        } as Prisma.InputJsonValue,
      },
    });

    const verifyUrl = `${landingPath('verify-email/')}?token=${encodeURIComponent(
      plainToken
    )}&flowToken=${encodeURIComponent(flowToken)}`;

    const subject = 'Confirmá tu email para continuar el checkout en Nexova';
    const text = `Hola ${body.firstName.trim()}, confirmá tu email para continuar: ${verifyUrl}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
        <h2 style="margin-bottom:12px">Confirmá tu email</h2>
        <p style="line-height:1.5">Para continuar con tu checkout en Nexova, confirmá tu cuenta desde el siguiente botón:</p>
        <p style="margin:20px 0">
          <a href="${verifyUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">Confirmar email</a>
        </p>
        <p style="font-size:12px;color:#6b7280;line-height:1.5">Si no solicitaste este registro, podés ignorar este mensaje.</p>
      </div>
    `;

    const mailResult = await sendMail({
      to: email,
      subject,
      text,
      html,
    });

    if (!mailResult.sent) {
      request.log.error(
        {
          email,
          flowToken,
          mailError: mailResult.error || 'unknown',
        },
        'Billing verification email send failed'
      );
    }

    if (!mailResult.sent && isMailerConfigured()) {
      return reply.code(500).send({
        error: 'MAIL_SEND_FAILED',
        message: 'No se pudo enviar el email de verificacion. Intenta nuevamente.',
        ...(process.env.BILLING_MAIL_DEBUG === 'true'
          ? { debug: mailResult.error || 'unknown' }
          : {}),
      });
    }

    return reply.send({
      success: true,
      requiresEmailVerification: true,
      email,
      flowToken,
      mailSent: mailResult.sent,
      ...(mailResult.sent
        ? {}
        : {
            message: isMailerConfigured()
              ? 'No se pudo enviar el email. Intentá nuevamente.'
              : 'Mailer no configurado en entorno local.',
            debugVerificationUrl:
              process.env.NODE_ENV === 'production' ? undefined : verifyUrl,
          }),
    });
  });

  fastify.post('/verify-email', async (request, reply) => {
    const body = verifyEmailSchema.parse(request.body);
    const tokenHash = hashPlainToken(body.token.trim());
    const flowToken = body.flowToken?.trim();
    if (!flowToken) {
      return reply.code(400).send({
        error: 'FLOW_TOKEN_REQUIRED',
        message: 'Falta flowToken para verificar la cuenta.',
      });
    }

    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
      select: {
        id: true,
        flowToken: true,
        plan: true,
        status: true,
        expiresAt: true,
        email: true,
        userId: true,
        workspaceId: true,
        metadata: true,
      },
    });

    if (!intent || isIntentExpired(intent.expiresAt)) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        message: 'La sesión de checkout expiró. Volvé a seleccionar un plan.',
      });
    }

    // Idempotency: if the intent is already linked to a user, just reissue session.
    if (intent.userId) {
      const existingUser = await fastify.prisma.user.findUnique({
        where: { id: intent.userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isSuperAdmin: true,
        },
      });

      if (existingUser) {
        const tokens = await issueTokensForUser({
          user: {
            id: existingUser.id,
            email: existingUser.email,
            isSuperAdmin: existingUser.isSuperAdmin,
          },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        setAuthCookies(reply, tokens);

        const memberships = await ensureWorkspaceForUser({
          id: existingUser.id,
          firstName: existingUser.firstName,
          email: existingUser.email,
          isSuperAdmin: existingUser.isSuperAdmin,
        });
        const workspaces = mapWorkspaces(memberships);
        const workspace = workspaces[0] || null;

        return reply.send({
          success: true,
          alreadyVerified: true,
          user: {
            id: existingUser.id,
            email: existingUser.email,
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            isSuperAdmin: existingUser.isSuperAdmin,
          },
          workspace,
          workspaces,
          next: `${landingPath('checkout/continue/')}?flowToken=${encodeURIComponent(flowToken)}`,
        });
      }
    }

    const metadata = readIntentMetadata(intent.metadata);
    const draft = readPendingRegistrationDraft(metadata);
    if (!draft) {
      return reply.code(400).send({
        error: 'INVALID_TOKEN',
        message: 'No hay una verificación pendiente para este checkout.',
      });
    }

    if (draft.tokenHash !== tokenHash) {
      return reply.code(400).send({
        error: 'INVALID_TOKEN',
        message: 'El enlace de verificación es inválido o expiró.',
      });
    }

    const tokenExpiresAt = new Date(draft.tokenExpiresAt);
    if (Number.isNaN(tokenExpiresAt.getTime()) || tokenExpiresAt.getTime() < Date.now()) {
      return reply.code(400).send({
        error: 'INVALID_TOKEN',
        message: 'El enlace de verificación es inválido o expiró.',
      });
    }

    const existingByEmail = await fastify.prisma.user.findUnique({
      where: { email: draft.email },
      select: { id: true },
    });
    if (existingByEmail) {
      return reply.code(409).send({
        error: 'EMAIL_EXISTS',
        message: 'Ya existe una cuenta con ese email. Iniciá sesión para continuar.',
      });
    }

    const user = await fastify.prisma.user.create({
      data: {
        email: draft.email,
        passwordHash: draft.passwordHash,
        firstName: draft.firstName,
        lastName: draft.lastName,
        status: 'active',
        emailVerifiedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isSuperAdmin: true,
      },
    });

    const memberships = await ensureWorkspaceForUser({
      id: user.id,
      firstName: user.firstName,
      companyName: draft.companyName,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });
    const workspace = memberships[0]?.workspace;
    if (!workspace) {
      return reply.code(500).send({
        error: 'WORKSPACE_CREATE_FAILED',
        message: 'No se pudo crear el workspace',
      });
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.workspace.update({
        where: { id: workspace.id },
        data: {
          plan: intent.plan,
          status: 'suspended',
        },
      });

      const currentMetadata = readIntentMetadata(intent.metadata);
      const nextMetadata: Record<string, unknown> = { ...currentMetadata };
      delete nextMetadata.pendingRegistration;
      nextMetadata.emailVerifiedAt = new Date().toISOString();

      await tx.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          email: user.email,
          userId: user.id,
          workspaceId: workspace.id,
          status: 'verified',
          metadata: nextMetadata as Prisma.InputJsonValue,
        },
      });
    });

    const tokens = await issueTokensForUser({
      user: {
        id: user.id,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
      },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    setAuthCookies(reply, tokens);
    const workspaces = mapWorkspaces(memberships);
    const primaryWorkspace = workspaces[0] || null;

    return reply.send({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isSuperAdmin: user.isSuperAdmin,
      },
      workspace: primaryWorkspace,
      workspaces,
      next: `${landingPath('checkout/continue/')}?flowToken=${encodeURIComponent(flowToken)}`,
    });
  });

  fastify.get('/auth/google/start', async (request, reply) => {
    const { flowToken, companyName, firstName, lastName } = request.query as {
      flowToken?: string;
      companyName?: string;
      firstName?: string;
      lastName?: string;
    };
    if (!flowToken) {
      return reply.code(400).send({
        error: 'FLOW_TOKEN_REQUIRED',
        message: 'flowToken requerido',
      });
    }

    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
      select: { id: true, flowToken: true, expiresAt: true, metadata: true },
    });
    if (!intent || isIntentExpired(intent.expiresAt)) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        message: 'Intent inválido o expirado.',
      });
    }

    const normalizedFirstName = typeof firstName === 'string' ? firstName.trim() : '';
    const normalizedLastName = typeof lastName === 'string' ? lastName.trim() : '';
    const normalizedCompany = typeof companyName === 'string' ? companyName.trim() : '';

    if (!normalizedFirstName) {
      return reply.code(400).send({
        error: 'FIRST_NAME_REQUIRED',
        message: 'Ingresá tu nombre para continuar.',
      });
    }
    if (!normalizedLastName) {
      return reply.code(400).send({
        error: 'LAST_NAME_REQUIRED',
        message: 'Ingresá tu apellido para continuar.',
      });
    }
    if (!normalizedCompany || normalizedCompany.length < 2) {
      return reply.code(400).send({
        error: 'COMPANY_NAME_REQUIRED',
        message: 'Ingresá el nombre de tu empresa para continuar.',
      });
    }

    const currentIntentMetadata = readIntentMetadata(intent.metadata);
    await fastify.prisma.billingCheckoutIntent.update({
      where: { id: intent.id },
      data: {
        metadata: {
          ...currentIntentMetadata,
          companyName: normalizedCompany,
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
        } as Prisma.InputJsonValue,
      },
    });

    const google = readGoogleConfig();
    if (!google.enabled) {
      return reply.code(500).send({
        error: 'GOOGLE_AUTH_NOT_CONFIGURED',
        message: 'Google OAuth no está configurado.',
      });
    }

    const state = randomToken(24);
    await fastify.prisma.oAuthState.create({
      data: {
        provider: 'google',
        state,
        flowToken,
        redirectUri: `${landingPath('checkout/continue/')}?flowToken=${encodeURIComponent(flowToken)}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', google.clientId);
    authUrl.searchParams.set('redirect_uri', google.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('prompt', 'select_account');
    authUrl.searchParams.set('state', state);

    return reply.redirect(authUrl.toString());
  });

  fastify.get('/auth/google/callback', async (request, reply) => {
    const { state, code } = request.query as { state?: string; code?: string };
    if (!state || !code) {
      return reply.code(400).send({
        error: 'INVALID_OAUTH_CALLBACK',
        message: 'Callback inválido de Google.',
      });
    }

    const oauthState = await fastify.prisma.oAuthState.findUnique({
      where: { state },
    });
    if (!oauthState || oauthState.provider !== 'google' || oauthState.usedAt || oauthState.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({
        error: 'INVALID_OAUTH_STATE',
        message: 'La sesión de Google expiró. Reintentá el registro.',
      });
    }

    const google = readGoogleConfig();
    if (!google.enabled) {
      return reply.code(500).send({
        error: 'GOOGLE_AUTH_NOT_CONFIGURED',
        message: 'Google OAuth no está configurado.',
      });
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      return reply.code(400).send({
        error: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
        message: 'No se pudo completar la autenticación con Google.',
      });
    }

    const tokenData = (await tokenRes.json()) as {
      id_token?: string;
      access_token?: string;
    };
    if (!tokenData.id_token) {
      return reply.code(400).send({
        error: 'GOOGLE_ID_TOKEN_MISSING',
        message: 'Google no devolvió un id_token válido.',
      });
    }

    const profileRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenData.id_token)}`
    );
    if (!profileRes.ok) {
      return reply.code(400).send({
        error: 'GOOGLE_PROFILE_FAILED',
        message: 'No se pudo validar el perfil de Google.',
      });
    }

    const profile = (await profileRes.json()) as {
      email?: string;
      email_verified?: string;
      given_name?: string;
      family_name?: string;
    };

    const email = normalizeEmail(profile.email || '');
    if (!email) {
      return reply.code(400).send({
        error: 'GOOGLE_EMAIL_MISSING',
        message: 'Google no devolvió un email válido.',
      });
    }
    if (profile.email_verified !== 'true') {
      return reply.code(400).send({
        error: 'GOOGLE_EMAIL_NOT_VERIFIED',
        message: 'La cuenta de Google debe tener email verificado.',
      });
    }

    const checkoutIntent = oauthState.flowToken
      ? await fastify.prisma.billingCheckoutIntent.findUnique({
          where: { flowToken: oauthState.flowToken },
          select: { id: true, plan: true, metadata: true },
        })
      : null;
    const checkoutMetadata = checkoutIntent ? readIntentMetadata(checkoutIntent.metadata) : {};
    const checkoutCompanyName =
      typeof checkoutMetadata.companyName === 'string' ? checkoutMetadata.companyName : null;
    const checkoutFirstName =
      typeof checkoutMetadata.firstName === 'string' ? checkoutMetadata.firstName : null;
    const checkoutLastName =
      typeof checkoutMetadata.lastName === 'string' ? checkoutMetadata.lastName : null;

    let user = await fastify.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isSuperAdmin: true,
      },
    });

    if (!user) {
      user = await fastify.prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(randomUUID()),
          firstName: checkoutFirstName || profile.given_name || null,
          lastName: checkoutLastName || profile.family_name || null,
          status: 'active',
          emailVerifiedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isSuperAdmin: true,
        },
      });
    } else {
      await fastify.prisma.user.update({
        where: { id: user.id },
        data: {
          status: 'active',
          emailVerifiedAt: new Date(),
          firstName: user.firstName || checkoutFirstName || profile.given_name || null,
          lastName: user.lastName || checkoutLastName || profile.family_name || null,
        },
      });
    }

    const memberships = await ensureWorkspaceForUser({
      id: user.id,
      firstName: user.firstName || checkoutFirstName || profile.given_name || null,
      companyName: checkoutCompanyName,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });
    const workspace = memberships[0]?.workspace || null;

      if (checkoutIntent && workspace) {
          const currentMetadata = readIntentMetadata(checkoutIntent.metadata);
          const nextMetadata: Record<string, unknown> = { ...currentMetadata };
          delete nextMetadata.pendingRegistration;
          nextMetadata.emailVerifiedAt = new Date().toISOString();

          await fastify.prisma.billingCheckoutIntent.update({
            where: { id: checkoutIntent.id },
            data: {
              email: user.email,
              userId: user.id,
              workspaceId: workspace.id,
              status: 'verified',
              metadata: nextMetadata as Prisma.InputJsonValue,
            },
          });
        await fastify.prisma.workspace.update({
          where: { id: workspace.id },
          data: {
            status: 'suspended',
            plan: normalizePlanInput(checkoutIntent.plan) || workspace.plan,
          },
        });
    }

    await fastify.prisma.oAuthState.update({
      where: { id: oauthState.id },
      data: { usedAt: new Date(), userId: user.id },
    });

    const tokens = await issueTokensForUser({
      user: {
        id: user.id,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
      },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setAuthCookies(reply, tokens);

    const nextUrl = oauthState.redirectUri || landingPath('checkout/continue/');
    return reply.redirect(nextUrl);
  });

  fastify.post(
    '/checkout/session',
    {
      preHandler: [fastify.authenticate],
      config: { allowMissingWorkspace: true, allowSuspendedWorkspace: true },
    },
    async (request, reply) => {
      const body = createCheckoutSessionSchema.parse(request.body);
      const userId = request.user!.sub;

      let intent = await fastify.prisma.billingCheckoutIntent.findUnique({
        where: { flowToken: body.flowToken },
      });
      if (!intent || isIntentExpired(intent.expiresAt)) {
        return reply.code(400).send({
          error: 'INVALID_INTENT',
          message: 'Intent inválido o expirado.',
        });
      }
      if (intent.status === 'completed') {
        return reply.send({
          success: true,
          alreadyProcessed: true,
          dashboardUrl: getDashboardUrl(),
        });
      }
      if (intent.userId && intent.userId !== userId) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Este checkout no corresponde al usuario autenticado.',
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          isSuperAdmin: true,
        },
      });
      if (!user) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Usuario no encontrado',
        });
      }

      if (!intent.userId || !intent.workspaceId) {
        if (intent.email && normalizeEmail(intent.email) !== normalizeEmail(user.email)) {
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: 'El email de este checkout no coincide con el usuario autenticado.',
          });
        }

        const memberships = await ensureWorkspaceForUser({
          id: user.id,
          firstName: user.firstName,
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
        });
        const workspace = memberships[0]?.workspace;

        if (!workspace) {
          return reply.code(400).send({
            error: 'WORKSPACE_REQUIRED',
            message: 'No se encontró un workspace asociado para continuar el checkout.',
          });
        }

        const normalizedPlan = normalizePlanInput(intent.plan) || workspace.plan;
        await fastify.prisma.workspace.update({
          where: { id: workspace.id },
          data: {
            plan: normalizedPlan,
            status: 'suspended',
          },
        });

        intent = await fastify.prisma.billingCheckoutIntent.update({
          where: { id: intent.id },
          data: {
            email: user.email,
            userId: user.id,
            workspaceId: workspace.id,
            status:
              intent.status === 'pending_auth' || intent.status === 'pending_verification'
                ? 'verified'
                : intent.status,
          },
        });
      }

      if (!intent.workspaceId) {
        return reply.code(400).send({
          error: 'WORKSPACE_REQUIRED',
          message: 'Primero completá el registro/verificación.',
        });
      }

      let preapproval: MercadoPagoPreapproval;
      try {
        preapproval = await createMercadoPagoSubscription({
          intent: {
            flowToken: intent.flowToken,
            plan: intent.plan,
            months: intent.months,
            amount: intent.amount,
          },
          email: user.email,
        });
      } catch (error) {
        request.log.error({ error }, 'MercadoPago preapproval creation failed');
        const message = isMercadoPagoConfigError(error)
          ? 'Mercado Pago no está configurado. Revisá MP_SUBSCRIPTIONS_ACCESS_TOKEN en el entorno de la API.'
          : 'No se pudo crear la suscripción en Mercado Pago.';
        return reply.code(500).send({
          error: 'MERCADOPAGO_SUBSCRIPTION_ERROR',
          message,
        });
      }

      if (!preapproval.initPoint) {
        return reply.code(500).send({
          error: 'MERCADOPAGO_INIT_POINT_MISSING',
          message: 'Mercado Pago no devolvió una URL válida para continuar el pago.',
        });
      }

      await fastify.prisma.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          status: 'checkout_created',
          stripeCheckoutSessionId: preapproval.id,
          stripeCustomerId: preapproval.payerId || preapproval.payerEmail,
          metadata: {
            ...readIntentMetadata(intent.metadata),
            provider: 'mercadopago',
            preapprovalStatus: preapproval.status,
          } as Prisma.InputJsonValue,
        },
      });

      return reply.send({
        checkoutUrl: preapproval.initPoint,
        sessionId: preapproval.id,
      });
    }
  );

  fastify.post(
    '/checkout/finalize',
    {
      preHandler: [fastify.authenticate],
      config: { allowMissingWorkspace: true, allowSuspendedWorkspace: true },
    },
    async (request, reply) => {
      const body = finalizeCheckoutSchema.parse(request.body);
      const userId = request.user!.sub;
      const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
        where: { flowToken: body.flowToken },
      });

      if (!intent || intent.userId !== userId) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Intent no encontrado.',
        });
      }

      if (intent.status === 'completed') {
        return reply.send({ success: true, alreadyProcessed: true });
      }

      const preapprovalId = body.sessionId || intent.stripeCheckoutSessionId;
      if (!preapprovalId) {
        return reply.code(400).send({
          error: 'INVALID_SESSION',
          message: 'No se encontró el identificador de suscripción para este checkout.',
        });
      }

      let preapproval: MercadoPagoPreapproval;
      try {
        preapproval = await getMercadoPagoPreapproval(preapprovalId);
      } catch (error) {
        request.log.error({ error }, 'MercadoPago preapproval retrieve failed');
        const message = isMercadoPagoConfigError(error)
          ? 'Mercado Pago no está configurado. Revisá MP_SUBSCRIPTIONS_ACCESS_TOKEN en el entorno de la API.'
          : 'No se pudo validar el estado de la suscripción en Mercado Pago.';
        return reply.code(500).send({
          error: 'MERCADOPAGO_SUBSCRIPTION_ERROR',
          message,
        });
      }
      if (
        intent.stripeCheckoutSessionId &&
        preapproval.id !== intent.stripeCheckoutSessionId
      ) {
        return reply.code(400).send({
          error: 'INVALID_SESSION',
          message: 'La suscripción no coincide con el checkout.',
        });
      }
      if (preapproval.status !== 'authorized') {
        return reply.code(400).send({
          error: 'PAYMENT_NOT_COMPLETED',
          message:
            preapproval.status === 'pending'
              ? 'La suscripción todavía está pendiente en Mercado Pago.'
              : 'El pago todavía no fue confirmado por Mercado Pago.',
        });
      }

      await markIntentAsPaid({
        flowToken: intent.flowToken,
        preapproval,
      });

      return reply.send({
        success: true,
        dashboardUrl: getDashboardUrl(),
      });
    }
  );

  fastify.get(
    '/checkout/session/:sessionId',
    {
      preHandler: [fastify.authenticate],
      config: { allowMissingWorkspace: true, allowSuspendedWorkspace: true },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      let preapproval: MercadoPagoPreapproval;
      try {
        preapproval = await getMercadoPagoPreapproval(sessionId);
      } catch (error) {
        request.log.error({ error }, 'MercadoPago preapproval status failed');
        const message = isMercadoPagoConfigError(error)
          ? 'Mercado Pago no está configurado. Revisá MP_SUBSCRIPTIONS_ACCESS_TOKEN en el entorno de la API.'
          : 'No se pudo consultar el estado de la suscripción en Mercado Pago.';
        return reply.code(500).send({
          error: 'MERCADOPAGO_SUBSCRIPTION_ERROR',
          message,
        });
      }
      return reply.send({
        session: {
          id: preapproval.id,
          status: preapproval.status,
          paymentStatus: preapproval.status === 'authorized' ? 'paid' : preapproval.status,
        },
      });
    }
  );

  fastify.post('/webhook', async (request, reply) => {
    const payload = (request.body as Record<string, unknown>) || {};
    const data = isRecord(payload.data) ? payload.data : {};
    const dataId = readString(data.id);
    const eventType =
      readString(payload.type) ||
      readString(payload.topic) ||
      readString(payload.action) ||
      'unknown';

    try {
      const config = ensureMercadoPagoConfigured();
      const signature = request.headers['x-signature'];
      const requestId = request.headers['x-request-id'];

      if (
        config.webhookSecret &&
        typeof signature === 'string' &&
        signature.trim() &&
        typeof requestId === 'string' &&
        requestId.trim() &&
        dataId
      ) {
        const isValid = verifyMercadoPagoWebhookSignature({
          requestId,
          dataId,
          signatureHeader: signature,
          secret: config.webhookSecret,
        });
        if (!isValid) {
          request.log.warn({ eventType, dataId }, 'Invalid MercadoPago webhook signature');
          return reply.code(401).send({ error: 'INVALID_SIGNATURE' });
        }
      }
    } catch (error) {
      request.log.error({ error }, 'MercadoPago webhook config error');
      return reply.code(503).send({ error: 'WEBHOOK_NOT_CONFIGURED' });
    }

    try {
      const normalizedEvent = eventType.toLowerCase();

      if (
        dataId &&
        (normalizedEvent.includes('subscription_preapproval') ||
          normalizedEvent.includes('preapproval') ||
          normalizedEvent === 'created' ||
          normalizedEvent === 'updated')
      ) {
        const preapproval = await getMercadoPagoPreapproval(dataId);
        const flowToken = preapproval.externalReference;

        if (preapproval.status === 'authorized' && flowToken) {
          await markIntentAsPaid({
            flowToken,
            preapproval,
          });
        } else {
          await setWorkspaceStatusFromSubscription({
            preapprovalId: preapproval.id,
            preapprovalStatus: preapproval.status,
            nextPaymentDate: preapproval.nextPaymentDate,
          });
        }
      }

      if (
        dataId &&
        (normalizedEvent.includes('subscription_authorized_payment') ||
          normalizedEvent.includes('authorized_payment'))
      ) {
        const authorizedPayment = await getMercadoPagoAuthorizedPayment(dataId);
        await recordRecurringAuthorizedPayment(authorizedPayment);
      }
    } catch (error) {
      request.log.error({ error, eventType, dataId }, 'Failed to process MercadoPago billing webhook');
      return reply.send({ received: true, processed: false });
    }

    return reply.send({ received: true, processed: true });
  });
};
