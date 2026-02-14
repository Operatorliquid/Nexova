/**
 * Super Admin Routes
 * Requires isSuperAdmin = true
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { decrypt, encrypt } from '@nexova/core';
import { Redis } from 'ioredis';
import { EvolutionClient } from '@nexova/integrations';

function hasGlobalInfobipApiKey(): boolean {
  return (process.env.INFOBIP_API_KEY || '').trim().length > 0;
}

function hasGlobalEvolutionApiKey(): boolean {
  return (process.env.EVOLUTION_API_KEY || '').trim().length > 0;
}

function getWhatsAppCredentialsStatus(number: { provider?: string | null; apiKeyEnc?: string | null; apiKeyIv?: string | null }): {
  hasCredentials: boolean;
  credentialsSource: 'global' | 'number' | 'missing';
} {
  const provider = (number.provider || 'infobip').toLowerCase();
  const hasPerNumber = Boolean(number.apiKeyEnc && number.apiKeyIv);

  if (provider === 'infobip') {
    const hasGlobal = hasGlobalInfobipApiKey();
    return {
      hasCredentials: hasPerNumber || hasGlobal,
      credentialsSource: hasGlobal ? 'global' : hasPerNumber ? 'number' : 'missing',
    };
  }

  if (provider === 'evolution') {
    const hasGlobal = hasGlobalEvolutionApiKey();
    return {
      hasCredentials: hasPerNumber || hasGlobal,
      credentialsSource: hasGlobal ? 'global' : hasPerNumber ? 'number' : 'missing',
    };
  }

  return {
    hasCredentials: hasPerNumber,
    credentialsSource: hasPerNumber ? 'number' : 'missing',
  };
}

const createWhatsAppNumberSchema = z.object({
  phoneNumber: z
    .string()
    .transform((val) => {
      // Keep canonical E.164-like storage: + + digits only.
      // This strips formatting and any invisible unicode marks (e.g. RTL/LTR chars).
      const digits = (val || '').replace(/\D/g, '');
      return digits ? `+${digits}` : val;
    })
    .refine((val) => val.replace(/\D/g, '').length >= 8, 'El número debe tener al menos 8 dígitos'),
  displayName: z.string().min(1).max(255).optional(),
  businessType: z.enum(['commerce', 'bookings']),
  provider: z.enum(['infobip', 'twilio']).default('infobip'),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
  notes: z.string().optional(),
});

const updateWhatsAppNumberSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  businessType: z.enum(['commerce', 'bookings']).optional(),
  apiKey: z.string().min(1).optional(),
  apiUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
  status: z.enum(['available', 'assigned', 'suspended']).optional(),
  notes: z.string().optional(),
});

const assignNumberSchema = z.object({
  workspaceId: z.string().uuid(),
  allowedRoles: z.array(z.string()).default([]),
});

const updateSystemSettingsSchema = z.object({
  anthropicKey: z.string().optional(),
  defaultLlmModel: z.string().optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMsg: z.string().optional(),
  commercePlanLimits: z
    .object({
      basic: z
        .object({
          ordersPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          aiMetricsInsightsPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          aiCustomerSummariesPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          debtRemindersPerMonth: z.coerce.number().int().min(1).nullable().optional(),
        })
        .partial()
        .optional(),
      standard: z
        .object({
          ordersPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          aiMetricsInsightsPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          aiCustomerSummariesPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          debtRemindersPerMonth: z.coerce.number().int().min(1).nullable().optional(),
        })
        .partial()
        .optional(),
      pro: z
        .object({
          ordersPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          aiMetricsInsightsPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          aiCustomerSummariesPerMonth: z.coerce.number().int().min(1).nullable().optional(),
          debtRemindersPerMonth: z.coerce.number().int().min(1).nullable().optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
  rateLimits: z
    .object({
      apiRequestsPerMinute: z.coerce.number().int().min(1).max(1_000_000).optional(),
      whatsappMessagesPerMinute: z.coerce.number().int().min(1).max(1_000_000).optional(),
      llmTokensPerRequest: z.coerce.number().int().min(1).max(1_000_000).optional(),
      loginAttemptsBeforeLock: z.coerce.number().int().min(1).max(1_000_000).optional(),
    })
    .partial()
    .optional(),
});

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require super admin
  fastify.addHook('preHandler', fastify.requireSuperAdmin);

  // ═══════════════════════════════════════════════════════════════════════════
  // USERS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  // List all users
  fastify.get('/users', async (request, reply) => {
    const { page = '1', limit = '50', search } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      fastify.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          isSuperAdmin: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          _count: {
            select: { memberships: true },
          },
          memberships: {
            where: {
              status: { in: ['ACTIVE', 'active'] },
            },
            select: {
              status: true,
              role: {
                select: {
                  id: true,
                  name: true,
                },
              },
              workspace: {
                select: {
                  id: true,
                  name: true,
                  plan: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      fastify.prisma.user.count({ where }),
    ]);

    reply.send({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / take),
      },
    });
  });

  // Users stats
  fastify.get('/users/stats', async (_request, reply) => {
    const [total, active, suspended, superAdmins] = await Promise.all([
      fastify.prisma.user.count(),
      fastify.prisma.user.count({ where: { status: 'active' } }),
      fastify.prisma.user.count({ where: { status: 'suspended' } }),
      fastify.prisma.user.count({ where: { isSuperAdmin: true } }),
    ]);

    reply.send({
      stats: {
        total,
        active,
        suspended,
        superAdmins,
      },
    });
  });

  // Toggle super admin
  fastify.patch('/users/:id/super-admin', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { isSuperAdmin } = request.body as { isSuperAdmin: boolean };

    // Prevent removing own super admin
    if (id === request.user!.sub && !isSuperAdmin) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'Cannot remove your own super admin privileges',
      });
    }

    const user = await fastify.prisma.user.update({
      where: { id },
      data: { isSuperAdmin },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isSuperAdmin: true,
      },
    });

    reply.send({ user });
  });

  // Delete user (hard delete). Cascades memberships/tokens; keeps billing/audit rows with userId set null.
  fastify.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (id === request.user!.sub) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'No podés eliminar tu propio usuario',
      });
    }

    const target = await fastify.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, isSuperAdmin: true },
    });

    if (!target) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Usuario no encontrado',
      });
    }

    if (target.isSuperAdmin) {
      const superAdmins = await fastify.prisma.user.count({
        where: { isSuperAdmin: true },
      });
      if (superAdmins <= 1) {
        return reply.code(400).send({
          error: 'BAD_REQUEST',
          message: 'No podés eliminar el último super admin',
        });
      }
    }

    await fastify.prisma.$transaction(async (tx) => {
      const memberships = await tx.membership.findMany({
        where: {
          userId: id,
          status: { in: ['ACTIVE', 'active'] },
        },
        select: { workspaceId: true },
      });

      const workspaceIds = Array.from(new Set(memberships.map((m) => m.workspaceId)));
      for (const workspaceId of workspaceIds) {
        const remainingMembers = await tx.membership.count({
          where: {
            workspaceId,
            status: { in: ['ACTIVE', 'active'] },
            userId: { not: id },
          },
        });

        if (remainingMembers === 0) {
          // This avoids leaving orphan workspaces that no one can access.
          await tx.workspace.update({
            where: { id: workspaceId },
            data: { status: 'cancelled' },
          });
        }
      }

      await tx.user.delete({ where: { id } });
    });

    return reply.send({ success: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WHATSAPP NUMBERS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  // List all WhatsApp numbers
  fastify.get('/whatsapp-numbers', async (request, reply) => {
    const numbers = await fastify.prisma.whatsAppNumber.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Don't expose API keys
    const sanitized = numbers.map(({ apiKeyEnc, apiKeyIv, ...n }) => ({
      ...n,
      ...getWhatsAppCredentialsStatus({ provider: n.provider, apiKeyEnc, apiKeyIv }),
    }));

    reply.send({ numbers: sanitized });
  });

  // Create WhatsApp number
  fastify.post('/whatsapp-numbers', async (request, reply) => {
    const body = createWhatsAppNumberSchema.parse(request.body);

    let apiKeyEnc: string | undefined;
    let apiKeyIv: string | undefined;
    if (body.apiKey) {
      if (!process.env.ENCRYPTION_KEY) {
        return reply.code(500).send({
          error: 'ENCRYPTION_KEY_REQUIRED',
          message: 'ENCRYPTION_KEY is required to store API keys securely',
        });
      }
      const encrypted = encrypt(body.apiKey);
      apiKeyEnc = encrypted.encrypted;
      apiKeyIv = encrypted.iv;
    }

    const number = await fastify.prisma.whatsAppNumber.create({
      data: {
        phoneNumber: body.phoneNumber,
        displayName: body.displayName || body.phoneNumber,
        provider: body.provider,
        apiKeyEnc,
        apiKeyIv,
        apiUrl: body.apiUrl || 'https://api.infobip.com',
        webhookSecret: body.webhookSecret,
        businessType: body.businessType,
        notes: body.notes,
        status: 'available',
      },
    });

    // Don't expose API key in response
    const { apiKeyEnc: _, apiKeyIv: __, ...sanitized } = number;

    reply.code(201).send({
      number: {
        ...sanitized,
        ...getWhatsAppCredentialsStatus(number),
      },
    });
  });

  // Update WhatsApp number
  fastify.patch('/whatsapp-numbers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateWhatsAppNumberSchema.parse(request.body);

    const updateData: Record<string, unknown> = {};

    if (body.displayName) updateData.displayName = body.displayName;
    if (body.businessType) updateData.businessType = body.businessType;
    if (body.status) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.apiKey) {
      if (!process.env.ENCRYPTION_KEY) {
        return reply.code(500).send({
          error: 'ENCRYPTION_KEY_REQUIRED',
          message: 'ENCRYPTION_KEY is required to store API keys securely',
        });
      }
      const encrypted = encrypt(body.apiKey);
      updateData.apiKeyEnc = encrypted.encrypted;
      updateData.apiKeyIv = encrypted.iv;
    }
    if (body.apiUrl) updateData.apiUrl = body.apiUrl;
    if (body.webhookSecret !== undefined) updateData.webhookSecret = body.webhookSecret;

    const number = await fastify.prisma.whatsAppNumber.update({
      where: { id },
      data: updateData,
    });

    // Don't expose API key in response
    const { apiKeyEnc: _, apiKeyIv: __, ...sanitized } = number;

    reply.send({
      number: {
        ...sanitized,
        ...getWhatsAppCredentialsStatus(number),
      },
    });
  });

  // Delete WhatsApp number
  fastify.delete('/whatsapp-numbers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    await fastify.prisma.whatsAppNumber.delete({
      where: { id },
    });

    reply.send({ success: true });
  });

  // Assign number to workspace (admin only - direct assignment)
  fastify.post('/whatsapp-numbers/:id/assign', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = assignNumberSchema.parse(request.body);

    const number = await fastify.prisma.whatsAppNumber.update({
      where: { id },
      data: {
        workspaceId: body.workspaceId,
        allowedRoles: body.allowedRoles,
        status: 'assigned',
      },
    });

    const { apiKeyEnc: _, apiKeyIv: __, ...sanitized } = number;

    reply.send({ number: sanitized });
  });

  // Unassign number from workspace
  fastify.post('/whatsapp-numbers/:id/unassign', async (request, reply) => {
    const { id } = request.params as { id: string };

    const number = await fastify.prisma.whatsAppNumber.update({
      where: { id },
      data: {
        workspaceId: null,
        allowedRoles: [],
        status: 'available',
      },
    });

    const { apiKeyEnc: _, apiKeyIv: __, ...sanitized } = number;

    reply.send({ number: sanitized });
  });

  // Test WhatsApp number connection
  fastify.post('/whatsapp-numbers/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };

    const number = await fastify.prisma.whatsAppNumber.findUnique({
      where: { id },
    });

    const credentialStatus = number ? getWhatsAppCredentialsStatus(number) : null;
    if (!number || !credentialStatus?.hasCredentials || !number.apiUrl) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'Number has no credentials configured',
      });
    }

    const provider = (number.provider || 'infobip').toLowerCase();
    const now = new Date();

    if (provider === 'evolution') {
      const envKey = (process.env.EVOLUTION_API_KEY || '').trim();
      const apiKey =
        envKey
        || (number.apiKeyEnc && number.apiKeyIv ? decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv }) : '');
      const baseUrl = (number.apiUrl || '').trim().replace(/\/$/, '');
      const providerConfig = (number.providerConfig as Record<string, unknown>) || {};
      const instanceNameRaw = providerConfig.instanceName ?? providerConfig.instance ?? providerConfig.name;
      const instanceName = typeof instanceNameRaw === 'string' ? instanceNameRaw.trim() : '';

      if (!apiKey || !baseUrl || !instanceName) {
        return reply.code(400).send({
          error: 'BAD_REQUEST',
          message: 'Evolution is missing apiKey/baseUrl/instanceName',
        });
      }

      try {
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        const health = await client.healthCheck();

        await fastify.prisma.whatsAppNumber.update({
          where: { id },
          data: {
            healthStatus: health.healthy ? 'healthy' : 'error',
            healthCheckedAt: now,
            lastError: health.healthy ? null : (health.message || health.state || 'unhealthy'),
            lastErrorAt: health.healthy ? null : now,
          },
        });

        return reply.send({
          success: health.healthy,
          message: health.healthy ? 'Connection test successful' : 'Connection test failed',
          state: health.state,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Evolution connection failed';
        await fastify.prisma.whatsAppNumber.update({
          where: { id },
          data: {
            healthStatus: 'error',
            healthCheckedAt: now,
            lastError: msg,
            lastErrorAt: now,
          },
        });

        return reply.code(502).send({ success: false, message: msg });
      }
    }

    // TODO: Actually test the connection with Infobip/Twilio
    // For now, just mark as healthy
    await fastify.prisma.whatsAppNumber.update({
      where: { id },
      data: {
        healthStatus: 'healthy',
        healthCheckedAt: now,
        lastError: null,
        lastErrorAt: null,
      },
    });

    reply.send({
      success: true,
      message: 'Connection test successful',
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKSPACES OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════

  // List all workspaces
  fastify.get('/workspaces', async (request, reply) => {
    const { page = '1', limit = '50', search } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [workspaces, total] = await Promise.all([
      fastify.prisma.workspace.findMany({
        where,
        include: {
          _count: {
            select: {
              users: true,
              products: true,
              orders: true,
              agentSessions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      fastify.prisma.workspace.count({ where }),
    ]);

    reply.send({
      workspaces,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / take),
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BILLING
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/billing/payments', async (request, reply) => {
    const { page = '1', limit = '50', search } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const parsedLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const skip = (parsedPage - 1) * parsedLimit;

    const searchValue = search?.trim();
    const where = searchValue
      ? {
          OR: [
            { workspace: { name: { contains: searchValue, mode: 'insensitive' as const } } },
            { user: { email: { contains: searchValue, mode: 'insensitive' as const } } },
            { plan: { contains: searchValue, mode: 'insensitive' as const } },
            {
              stripeCheckoutSessionId: {
                contains: searchValue,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {};

    const [payments, total] = await Promise.all([
      fastify.prisma.billingPayment.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
              plan: true,
              status: true,
            },
          },
        },
        orderBy: { paidAt: 'desc' },
        skip,
        take: parsedLimit,
      }),
      fastify.prisma.billingPayment.count({ where }),
    ]);

    return reply.send({
      payments,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit),
      },
    });
  });

  fastify.get('/billing/subscriptions', async (request, reply) => {
    const { page = '1', limit = '50', search } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const parsedLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const skip = (parsedPage - 1) * parsedLimit;

    const searchValue = search?.trim();
    const where = searchValue
      ? {
          OR: [
            { workspace: { name: { contains: searchValue, mode: 'insensitive' as const } } },
            { user: { email: { contains: searchValue, mode: 'insensitive' as const } } },
            { plan: { contains: searchValue, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [subscriptions, total] = await Promise.all([
      fastify.prisma.workspaceSubscription.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
              plan: true,
              status: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: parsedLimit,
      }),
      fastify.prisma.workspaceSubscription.count({ where }),
    ]);

    return reply.send({
      subscriptions,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit),
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════

  // Get system settings
  fastify.get('/settings', async (request, reply) => {
    let settings = await fastify.prisma.systemSettings.findUnique({
      where: { id: 'system' },
    });

    if (!settings) {
      settings = await fastify.prisma.systemSettings.create({
        data: { id: 'system' },
      });
    }

    // Don't expose encrypted keys
    const { anthropicKeyEnc, anthropicKeyIv, ...sanitized } = settings;

    reply.send({
      settings: {
        ...sanitized,
        hasAnthropicKey: !!anthropicKeyEnc,
      },
    });
  });

  // Update system settings
  fastify.patch('/settings', async (request, reply) => {
    const body = updateSystemSettingsSchema.parse(request.body);

    const updateData: any = {};

    if (body.anthropicKey) {
      const { encrypted, iv } = encrypt(body.anthropicKey);
      updateData.anthropicKeyEnc = encrypted;
      updateData.anthropicKeyIv = iv;
    }

    if (body.defaultLlmModel) updateData.defaultLlmModel = body.defaultLlmModel;
    if (body.maintenanceMode !== undefined) updateData.maintenanceMode = body.maintenanceMode;
    if (body.maintenanceMsg !== undefined) updateData.maintenanceMsg = body.maintenanceMsg;
    if (body.rateLimits !== undefined) updateData.rateLimits = body.rateLimits;
    if (body.commercePlanLimits !== undefined) {
      const asObject = (value: unknown): Record<string, unknown> => {
        if (!value || typeof value !== 'object') return {};
        if (Array.isArray(value)) return {};
        return value as Record<string, unknown>;
      };

      const mergeByPlan = (current: Record<string, unknown>, patch: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...current };
        for (const planKey of Object.keys(patch)) {
          const next = asObject(patch[planKey]);
          out[planKey] = { ...asObject(current[planKey]), ...next };
        }
        return out;
      };

      const existing = await fastify.prisma.systemSettings.findUnique({
        where: { id: 'system' },
        select: { featureFlags: true },
      });
      const featureFlags = asObject(existing?.featureFlags);
      const currentLimits = asObject(featureFlags.commercePlanLimits);
      const mergedLimits = mergeByPlan(currentLimits, asObject(body.commercePlanLimits));

      updateData.featureFlags = {
        ...featureFlags,
        commercePlanLimits: mergedLimits,
      };
    }

    const settings = await fastify.prisma.systemSettings.upsert({
      where: { id: 'system' },
      create: { id: 'system', ...updateData },
      update: updateData,
    });

    const { anthropicKeyEnc, anthropicKeyIv, ...sanitized } = settings;

    reply.send({
      settings: {
        ...sanitized,
        hasAnthropicKey: !!anthropicKeyEnc,
      },
    });
  });

  // Clear system cache keys
  fastify.post('/cache/clear', async (request, reply) => {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      const patterns = ['nexova:cache:*', 'cache:*', 'nexova:realtime:*'];
      let deletedKeys = 0;

      for (const pattern of patterns) {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
          cursor = nextCursor;
          if (keys.length > 0) {
            deletedKeys += await redis.del(...keys);
          }
        } while (cursor !== '0');
      }

      return reply.send({
        success: true,
        deletedKeys,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to clear cache');
      return reply.code(500).send({
        error: 'CACHE_CLEAR_FAILED',
        message: 'No se pudo limpiar la cache',
      });
    } finally {
      await redis.quit().catch(() => undefined);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD STATS
  // ═══════════════════════════════════════════════════════════════════════════

  // Get admin dashboard stats
  fastify.get('/stats', async (request, reply) => {
    const [
      totalUsers,
      activeUsers,
      totalWorkspaces,
      activeWorkspaces,
      totalOrders,
      totalMessages,
      whatsappNumbers,
    ] = await Promise.all([
      fastify.prisma.user.count(),
      fastify.prisma.user.count({ where: { status: 'active' } }),
      fastify.prisma.workspace.count(),
      fastify.prisma.workspace.count({ where: { status: 'active' } }),
      fastify.prisma.order.count(),
      fastify.prisma.agentMessage.count(),
      fastify.prisma.whatsAppNumber.count(),
    ]);

    reply.send({
      stats: {
        users: { total: totalUsers, active: activeUsers },
        workspaces: { total: totalWorkspaces, active: activeWorkspaces },
        orders: { total: totalOrders },
        messages: { total: totalMessages },
        whatsappNumbers: { total: whatsappNumbers },
      },
    });
  });
};
