import { createHash, randomBytes, randomUUID } from 'crypto';
import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  WorkspaceService,
  generateTokenPair,
  hashPassword,
  hashToken,
  validatePasswordStrength,
} from '@nexova/core';
import {
  BILLING_PLAN_CATALOG,
  normalizeCommercePlan,
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
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
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
  sessionId: z.string().min(5).max(255),
});

type AuthTokens = ReturnType<typeof generateTokenPair>;
type PendingRegistrationDraft = {
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  tokenHash: string;
  tokenExpiresAt: string;
  createdAt: string;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const hashPlainToken = (value: string) => createHash('sha256').update(value).digest('hex');

const randomToken = (size = 32) => randomBytes(size).toString('hex');

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
    tokenHash,
    tokenExpiresAt,
    createdAt,
  };
};

const formatWorkspaceName = (params: { firstName?: string | null; email?: string | null }) => {
  const first = params.firstName?.trim();
  if (first) return first;
  const prefix = params.email?.split('@')[0]?.trim();
  if (prefix) return prefix;
  return `workspace-${Date.now()}`;
};

const formatWorkspaceSlug = (name: string) => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'workspace';
};

const buildStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }
  return new Stripe(secretKey);
};

const isStripeConfigError = (error: unknown) => {
  return (
    error instanceof Error &&
    (error.message.includes('STRIPE_SECRET_KEY') ||
      error.message.toLowerCase().includes('api key'))
  );
};

const readGoogleConfig = () => {
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

const authCookieSameSiteRaw = (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
const authCookieSameSite: 'lax' | 'strict' | 'none' =
  authCookieSameSiteRaw === 'none' || authCookieSameSiteRaw === 'strict' || authCookieSameSiteRaw === 'lax'
    ? authCookieSameSiteRaw
    : 'lax';
const authCookieSecure = process.env.NODE_ENV === 'production' || authCookieSameSite === 'none';

const setAuthCookies = (
  reply: import('fastify').FastifyReply,
  tokens: AuthTokens
) => {
  const base = {
    httpOnly: true,
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    path: '/',
  };
  reply.setCookie('accessToken', tokens.accessToken, {
    ...base,
    expires: tokens.accessTokenExpiresAt,
  });
  reply.setCookie('refreshToken', tokens.refreshToken, {
    ...base,
    expires: tokens.refreshTokenExpiresAt,
  });
};

const isIntentExpired = (expiresAt: Date) => expiresAt.getTime() <= Date.now();

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  const workspaceService = new WorkspaceService(fastify.prisma);

  const fetchMemberships = async (userId: string) => {
    return fastify.prisma.membership.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'active'] },
      },
      include: {
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
      },
    });
  };

  const mapWorkspaces = (memberships: Awaited<ReturnType<typeof fetchMemberships>>) => {
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
    email?: string | null;
    isSuperAdmin?: boolean;
  }) => {
    let memberships = await fetchMemberships(params.id);
    if (memberships.length === 0 && !params.isSuperAdmin) {
      const workspaceName = formatWorkspaceName({
        firstName: params.firstName,
        email: params.email,
      });
      const workspaceSlug = `${formatWorkspaceSlug(workspaceName)}-${Date.now()}`;

      await workspaceService.create({
        name: workspaceName,
        slug: workspaceSlug,
        ownerId: params.id,
      });
      memberships = await fetchMemberships(params.id);
    }
    return memberships;
  };

  const issueTokensForUser = async (params: {
    user: { id: string; email: string; isSuperAdmin: boolean };
    ipAddress?: string;
    userAgent?: string;
  }) => {
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

  const markIntentAsPaid = async (params: {
    flowToken: string;
    stripeSession: Stripe.Checkout.Session;
  }) => {
    const { flowToken, stripeSession } = params;

    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
    });

    if (!intent || !intent.workspaceId) {
      throw new Error('Checkout intent not found');
    }

    const paidAt = new Date();
    const currentPeriodStart = paidAt;
    const currentPeriodEnd = addMonths(currentPeriodStart, intent.months);

    await fastify.prisma.$transaction(async (tx) => {
      const existing = await tx.billingPayment.findUnique({
        where: { stripeCheckoutSessionId: stripeSession.id },
        select: { id: true },
      });

      if (!existing) {
        await tx.billingPayment.create({
          data: {
            workspaceId: intent.workspaceId!,
            userId: intent.userId,
            checkoutIntentId: intent.id,
            stripeCheckoutSessionId: stripeSession.id,
            stripePaymentIntentId:
              typeof stripeSession.payment_intent === 'string'
                ? stripeSession.payment_intent
                : stripeSession.payment_intent?.id || null,
            stripeCustomerId:
              typeof stripeSession.customer === 'string'
                ? stripeSession.customer
                : stripeSession.customer?.id || null,
            amount: intent.amount,
            currency: intent.currency,
            plan: intent.plan,
            months: intent.months,
            status: 'paid',
            paidAt,
            nextChargeAt: currentPeriodEnd,
            metadata: {
              mode: stripeSession.mode,
              paymentStatus: stripeSession.payment_status,
            },
          },
        });
      }

      await tx.workspaceSubscription.upsert({
        where: { workspaceId: intent.workspaceId! },
        create: {
          workspaceId: intent.workspaceId!,
          userId: intent.userId,
          plan: intent.plan,
          status: 'active',
          billingCycleMonths: intent.months,
          currentPeriodStart,
          currentPeriodEnd,
          nextChargeAt: currentPeriodEnd,
          stripeCustomerId:
            typeof stripeSession.customer === 'string'
              ? stripeSession.customer
              : stripeSession.customer?.id || null,
        },
        update: {
          userId: intent.userId,
          plan: intent.plan,
          status: 'active',
          billingCycleMonths: intent.months,
          currentPeriodStart,
          currentPeriodEnd,
          nextChargeAt: currentPeriodEnd,
          stripeCustomerId:
            typeof stripeSession.customer === 'string'
              ? stripeSession.customer
              : stripeSession.customer?.id || null,
          cancelledAt: null,
        },
      });

      await tx.workspace.update({
        where: { id: intent.workspaceId! },
        data: {
          plan: intent.plan,
          status: 'active',
        },
      });

      await tx.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          status: 'completed',
          stripeCheckoutSessionId: stripeSession.id,
          stripePaymentIntentId:
            typeof stripeSession.payment_intent === 'string'
              ? stripeSession.payment_intent
              : stripeSession.payment_intent?.id || null,
          stripeCustomerId:
            typeof stripeSession.customer === 'string'
              ? stripeSession.customer
              : stripeSession.customer?.id || null,
          completedAt: paidAt,
        },
      });
    });
  };

  fastify.get('/catalog', async (_request, reply) => {
    const plans = buildBillingCatalog();
    reply.send({
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
        currency: 'USD',
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
      firstName: body.firstName?.trim() || null,
      lastName: body.lastName?.trim() || null,
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

    const verifyUrl = `${getLandingUrl()}/verify-email?token=${encodeURIComponent(
      plainToken
    )}&flowToken=${encodeURIComponent(flowToken)}`;

    const subject = 'Confirmá tu email para continuar el checkout en Nexova';
    const text = `Hola ${body.firstName?.trim() || ''}, confirmá tu email para continuar: ${verifyUrl}`;
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
          next: `${getLandingUrl()}/checkout/continue?flowToken=${encodeURIComponent(flowToken)}`,
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
      next: `${getLandingUrl()}/checkout/continue?flowToken=${encodeURIComponent(flowToken)}`,
    });
  });

  fastify.get('/auth/google/start', async (request, reply) => {
    const { flowToken } = request.query as { flowToken?: string };
    if (!flowToken) {
      return reply.code(400).send({
        error: 'FLOW_TOKEN_REQUIRED',
        message: 'flowToken requerido',
      });
    }

    const intent = await fastify.prisma.billingCheckoutIntent.findUnique({
      where: { flowToken },
      select: { flowToken: true, expiresAt: true },
    });
    if (!intent || isIntentExpired(intent.expiresAt)) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        message: 'Intent inválido o expirado.',
      });
    }

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
        redirectUri: `${getLandingUrl()}/checkout/continue?flowToken=${encodeURIComponent(flowToken)}`,
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
          firstName: profile.given_name || null,
          lastName: profile.family_name || null,
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
          firstName: user.firstName || profile.given_name || null,
          lastName: user.lastName || profile.family_name || null,
        },
      });
    }

    const memberships = await ensureWorkspaceForUser({
      id: user.id,
      firstName: user.firstName,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });
    const workspace = memberships[0]?.workspace || null;

      if (oauthState.flowToken && workspace) {
        const checkoutIntent = await fastify.prisma.billingCheckoutIntent.findUnique({
          where: { flowToken: oauthState.flowToken },
          select: { id: true, plan: true, metadata: true },
        });

        if (checkoutIntent) {
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

    const nextUrl = oauthState.redirectUri || `${getLandingUrl()}/checkout/continue`;
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

      let session: Stripe.Checkout.Session;
      try {
        const stripe = buildStripe();
        const planConfig = BILLING_PLAN_CATALOG[intent.plan as CommercePlan];
        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: intent.amount,
                product_data: {
                  name: `Nexova ${planConfig?.name || intent.plan}`,
                  description: `${intent.months} mes(es)`,
                },
              },
            },
          ],
          success_url: `${getLandingUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}&flowToken=${encodeURIComponent(
            intent.flowToken
          )}`,
          cancel_url: `${getLandingUrl()}/cart?plan=${encodeURIComponent(
            intent.plan
          )}&months=${intent.months}`,
          customer_email: user.email,
          metadata: {
            flowToken: intent.flowToken,
            workspaceId: intent.workspaceId,
            userId,
            plan: intent.plan,
            months: String(intent.months),
          },
        });
      } catch (error) {
        request.log.error({ error }, 'Stripe checkout session creation failed');
        const message = isStripeConfigError(error)
          ? 'Stripe no está configurado. Revisá STRIPE_SECRET_KEY en el entorno de la API.'
          : 'No se pudo crear la sesión de pago en Stripe.';
        return reply.code(500).send({
          error: 'STRIPE_CHECKOUT_ERROR',
          message,
        });
      }

      await fastify.prisma.billingCheckoutIntent.update({
        where: { id: intent.id },
        data: {
          status: 'checkout_created',
          stripeCheckoutSessionId: session.id,
        },
      });

      return reply.send({
        checkoutUrl: session.url,
        sessionId: session.id,
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

      let stripeSession: Stripe.Checkout.Session;
      try {
        const stripe = buildStripe();
        stripeSession = await stripe.checkout.sessions.retrieve(body.sessionId);
      } catch (error) {
        request.log.error({ error }, 'Stripe checkout session retrieve failed');
        const message = isStripeConfigError(error)
          ? 'Stripe no está configurado. Revisá STRIPE_SECRET_KEY en el entorno de la API.'
          : 'No se pudo validar la sesión de pago en Stripe.';
        return reply.code(500).send({
          error: 'STRIPE_CHECKOUT_ERROR',
          message,
        });
      }
      if (!stripeSession || stripeSession.id !== intent.stripeCheckoutSessionId) {
        return reply.code(400).send({
          error: 'INVALID_SESSION',
          message: 'La sesión de pago no coincide con el checkout.',
        });
      }
      if (stripeSession.payment_status !== 'paid') {
        return reply.code(400).send({
          error: 'PAYMENT_NOT_COMPLETED',
          message: 'El pago todavía no fue confirmado por Stripe.',
        });
      }

      await markIntentAsPaid({
        flowToken: intent.flowToken,
        stripeSession,
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
      let session: Stripe.Checkout.Session;
      try {
        const stripe = buildStripe();
        session = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (error) {
        request.log.error({ error }, 'Stripe checkout session status failed');
        const message = isStripeConfigError(error)
          ? 'Stripe no está configurado. Revisá STRIPE_SECRET_KEY en el entorno de la API.'
          : 'No se pudo consultar el estado de la sesión en Stripe.';
        return reply.code(500).send({
          error: 'STRIPE_CHECKOUT_ERROR',
          message,
        });
      }
      reply.send({
        session: {
          id: session.id,
          status: session.status,
          paymentStatus: session.payment_status,
        },
      });
    }
  );

  fastify.post('/webhook', async (request, reply) => {
    const event = request.body as Stripe.Event;
    if (!event || typeof event !== 'object') {
      return reply.code(400).send({ error: 'INVALID_EVENT' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const flowToken = session.metadata?.flowToken;
      if (flowToken && session.payment_status === 'paid') {
        try {
          await markIntentAsPaid({
            flowToken,
            stripeSession: session,
          });
        } catch (error) {
          request.log.error({ error }, 'Failed to process billing webhook');
        }
      }
    }

    return reply.send({ received: true });
  });
};
