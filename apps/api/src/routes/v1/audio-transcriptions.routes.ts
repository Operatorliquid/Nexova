import { randomUUID } from 'crypto';

import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Queue } from 'bullmq';
import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';


import {
  type AudioTranscriptionPayload,
  COMMERCE_USAGE_METRICS,
  QUEUES,
} from '@nexova/shared';

import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getMonthlyUsage } from '../../utils/monthly-usage.js';

const enqueueTranscriptionSchema = z
  .object({
    messageId: z.string().trim().min(1).max(255).optional(),
    webhookInboxId: z.string().uuid().optional(),
    provider: z.enum(['infobip', 'evolution']).optional(),
    force: z.boolean().optional(),
  })
  .refine((v) => !!v.messageId || !!v.webhookInboxId, {
    message: 'Debe enviar messageId o webhookInboxId',
    path: ['messageId'],
  });

const retryTranscriptionSchema = z.object({
  force: z.boolean().optional(),
});

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type PlanValue = Awaited<ReturnType<typeof getWorkspacePlanContext>>['plan'];
type PlanAccessDenied = {
  ok: false;
  statusCode: number;
  payload: { error: string; message: string };
};
type PlanAccessResult = { ok: true; plan: PlanValue } | PlanAccessDenied;
type PlanQuotaResult = { ok: true } | PlanAccessDenied;

function toPositiveIntOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function ensureWorkspaceAccess(
  request: { workspaceId?: string; user?: { isSuperAdmin?: boolean } },
  targetWorkspaceId: string
): { ok: true } | { ok: false; statusCode: number; payload: { error: string; message: string } } {
  if (request.user?.isSuperAdmin) return { ok: true };
  if (!request.workspaceId) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' },
    };
  }
  if (request.workspaceId !== targetWorkspaceId) {
    return {
      ok: false,
      statusCode: 403,
      payload: { error: 'FORBIDDEN', message: 'Workspace mismatch' },
    };
  }
  return { ok: true };
}

async function getRoleNameForWorkspace(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: {
      workspaceId,
      userId,
      status: { in: ['ACTIVE', 'active'] },
    },
    include: { role: { select: { name: true } } },
  });
  return membership?.role?.name || null;
}

function pickAudioMetaFromWebhook(payload: unknown): {
  channelId?: string;
  mimeType?: string;
  fileName?: string;
  durationMs?: number;
  sizeBytes?: number;
  fileRef?: string;
} {
  const payloadObject = asObject(payload);
  const nexova = asObject(payloadObject.__nexova);
  const audio = asObject(nexova.audio);
  let channelId: string | undefined;
  const results = payloadObject.results;
  if (Array.isArray(results) && results.length > 0) {
    const firstResult = asObject(results[0]);
    if (typeof firstResult.from === 'string') {
      channelId = firstResult.from;
    }
  }
  if (!channelId) {
    const remoteJid = asObject(asObject(payloadObject.data).key).remoteJid;
    if (typeof remoteJid === 'string') {
      channelId = `+${(remoteJid.split('@')[0] || '').replace(/\D/g, '')}`;
    }
  }

  const mimeType = typeof audio.mimeType === 'string' ? audio.mimeType : undefined;
  const fileName = typeof audio.fileName === 'string' ? audio.fileName : undefined;
  const durationMs = toPositiveIntOrNull(audio.durationMs) || undefined;
  const sizeBytes = toPositiveIntOrNull(audio.sizeBytes) || undefined;
  const fileRef = typeof audio.mediaUrl === 'string' ? audio.mediaUrl : undefined;

  return {
    ...(channelId ? { channelId } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(fileName ? { fileName } : {}),
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
    ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
    ...(fileRef ? { fileRef } : {}),
  };
}

export const audioTranscriptionsRoutes: FastifyPluginAsync<{
  queue?: Queue<AudioTranscriptionPayload>;
}> = async (fastify, opts) => {
  const audioQueue = opts.queue;

  const enforcePlanAccess = async (workspaceId: string, userId: string): Promise<PlanAccessResult> => {
    const roleName = await getRoleNameForWorkspace(fastify.prisma, workspaceId, userId);
    const planContext = await getWorkspacePlanContext(fastify.prisma, workspaceId, roleName);
    if (!planContext.capabilities.showWhatsappAudioTranscription) {
      return {
        ok: false as const,
        statusCode: 403,
        payload: {
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye transcripción de audio en WhatsApp',
        },
      };
    }

    return {
      ok: true as const,
      plan: planContext.plan,
    };
  };

  const enforcePlanQuota = async (workspaceId: string, userId: string): Promise<PlanQuotaResult> => {
    const planAccess = await enforcePlanAccess(workspaceId, userId);
    if (!planAccess.ok) return planAccess;

    const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planAccess.plan);
    const monthlyLimit = limits.audioTranscriptionsPerMonth;
    if (monthlyLimit === null) return { ok: true as const };

    const used = await getMonthlyUsage(fastify.prisma, {
      workspaceId,
      metric: COMMERCE_USAGE_METRICS.audioTranscriptions,
    });
    if (used >= BigInt(monthlyLimit)) {
      return {
        ok: false as const,
        statusCode: 429,
        payload: {
          error: 'PLAN_QUOTA_EXCEEDED',
          message: `Alcanzaste el límite mensual de transcripciones de audio (${monthlyLimit}).`,
        },
      };
    }

    return { ok: true as const };
  };

  fastify.post<{
    Params: { workspaceId: string };
    Body: z.infer<typeof enqueueTranscriptionSchema>;
  }>('/:workspaceId/audio/transcriptions', {
    preHandler: [fastify.requirePermission('sessions:takeover')],
    handler: async (request, reply) => {
      const { workspaceId } = request.params;
      const access = ensureWorkspaceAccess(request, workspaceId);
      if (!access.ok) return reply.code(access.statusCode).send(access.payload);

      const userId = request.user?.sub;
      if (!userId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Usuario no autenticado' });
      }
      if (!audioQueue) {
        return reply.code(503).send({ error: 'QUEUE_UNAVAILABLE', message: 'Audio queue no disponible' });
      }

      const planCheck = await enforcePlanAccess(workspaceId, userId);
      if (!planCheck.ok) return reply.code(planCheck.statusCode).send(planCheck.payload);

      const body = enqueueTranscriptionSchema.parse(request.body);

      let webhook = null as Awaited<ReturnType<typeof fastify.prisma.webhookInbox.findFirst>>;
      if (body.webhookInboxId) {
        webhook = await fastify.prisma.webhookInbox.findFirst({
          where: {
            id: body.webhookInboxId,
            workspaceId,
            provider: body.provider || undefined,
          },
        });
      } else {
        webhook = await fastify.prisma.webhookInbox.findFirst({
          where: {
            workspaceId,
            externalId: body.messageId!,
            provider: body.provider || undefined,
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (!webhook) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Mensaje webhook no encontrado para transcribir',
        });
      }

      const provider = (webhook.provider || '').toLowerCase();
      if (provider !== 'infobip' && provider !== 'evolution') {
        return reply.code(400).send({
          error: 'UNSUPPORTED_PROVIDER',
          message: `Proveedor no soportado para transcripción: ${webhook.provider}`,
        });
      }

      const webhookPayload: unknown = webhook.payload;
      const audioMeta = pickAudioMetaFromWebhook(webhookPayload);

      let transcription = await fastify.prisma.audioTranscription.findFirst({
        where: {
          workspaceId,
          provider,
          messageId: webhook.externalId,
        },
      });

      if (!transcription) {
        transcription = await fastify.prisma.audioTranscription.create({
          data: {
            workspaceId,
            provider,
            messageId: webhook.externalId,
            webhookInboxId: webhook.id,
            channelId: audioMeta.channelId || null,
            mimeType: audioMeta.mimeType || null,
            durationMs: audioMeta.durationMs || null,
            sizeBytes: audioMeta.sizeBytes ? BigInt(audioMeta.sizeBytes) : null,
            status: 'pending',
            metadata: {
              ...(audioMeta.fileName ? { fileName: audioMeta.fileName } : {}),
              ...(audioMeta.fileRef ? { mediaUrl: audioMeta.fileRef } : {}),
            } as Prisma.InputJsonValue,
          },
        });
      } else if (body.force) {
        transcription = await fastify.prisma.audioTranscription.update({
          where: { id: transcription.id },
          data: {
            status: 'pending',
            startedAt: null,
            completedAt: null,
            errorMessage: null,
            webhookInboxId: webhook.id,
          },
        });
      } else if (transcription.status === 'completed') {
        return reply.send({
          status: 'already_completed',
          audioTranscriptionId: transcription.id,
          messageId: webhook.externalId,
          provider,
        });
      }

      const quotaCheck = await enforcePlanQuota(workspaceId, userId);
      if (!quotaCheck.ok) return reply.code(quotaCheck.statusCode).send(quotaCheck.payload);

      await audioQueue.add(
        `audio-manual-${provider}-${webhook.externalId}-${Date.now()}`,
        {
          workspaceId,
          audioTranscriptionId: transcription.id,
          webhookInboxId: webhook.id,
          messageId: webhook.externalId,
          provider,
          channelId: audioMeta.channelId,
          correlationId: webhook.correlationId || undefined,
          force: body.force || false,
          metadata: {
            ...(audioMeta.fileRef ? { fileRef: audioMeta.fileRef } : {}),
            ...(audioMeta.mimeType ? { mimeType: audioMeta.mimeType } : {}),
            ...(audioMeta.fileName ? { fileName: audioMeta.fileName } : {}),
            ...(typeof audioMeta.sizeBytes === 'number' ? { sizeBytes: audioMeta.sizeBytes } : {}),
            ...(typeof audioMeta.durationMs === 'number' ? { durationMs: audioMeta.durationMs } : {}),
          },
        },
        {
          attempts: QUEUES.AUDIO_TRANSCRIPTION.attempts,
          backoff: QUEUES.AUDIO_TRANSCRIPTION.backoff,
        }
      );

      return reply.send({
        status: 'queued',
        audioTranscriptionId: transcription.id,
        messageId: webhook.externalId,
        provider,
      });
    },
  });

  fastify.get<{
    Params: { workspaceId: string; id: string };
  }>('/:workspaceId/audio/transcriptions/:id', {
    preHandler: [fastify.requirePermission('sessions:read')],
    handler: async (request, reply) => {
      const { workspaceId, id } = request.params;
      const access = ensureWorkspaceAccess(request, workspaceId);
      if (!access.ok) return reply.code(access.statusCode).send(access.payload);

      const userId = request.user?.sub;
      if (!userId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Usuario no autenticado' });
      }

      const planCheck = await enforcePlanAccess(workspaceId, userId);
      if (!planCheck.ok) return reply.code(planCheck.statusCode).send(planCheck.payload);

      const transcription = await fastify.prisma.audioTranscription.findFirst({
        where: { id, workspaceId },
        include: {
          webhookInbox: {
            select: { id: true, externalId: true, provider: true, status: true, createdAt: true },
          },
        },
      });

      if (!transcription) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Transcripción no encontrada',
        });
      }

      return reply.send({
        transcription: {
          id: transcription.id,
          workspaceId: transcription.workspaceId,
          provider: transcription.provider,
          messageId: transcription.messageId,
          channelId: transcription.channelId,
          status: transcription.status,
          mimeType: transcription.mimeType,
          sizeBytes: transcription.sizeBytes ? Number(transcription.sizeBytes) : null,
          durationMs: transcription.durationMs,
          language: transcription.language,
          transcript: transcription.transcript,
          confidence: transcription.confidence,
          errorMessage: transcription.errorMessage,
          attemptCount: transcription.attemptCount,
          startedAt: transcription.startedAt,
          completedAt: transcription.completedAt,
          createdAt: transcription.createdAt,
          updatedAt: transcription.updatedAt,
          webhook: transcription.webhookInbox,
          metadata: transcription.metadata,
        },
      });
    },
  });

  fastify.post<{
    Params: { workspaceId: string; id: string };
    Body: z.infer<typeof retryTranscriptionSchema>;
  }>('/:workspaceId/audio/transcriptions/:id/retry', {
    preHandler: [fastify.requirePermission('sessions:takeover')],
    handler: async (request, reply) => {
      const { workspaceId, id } = request.params;
      const access = ensureWorkspaceAccess(request, workspaceId);
      if (!access.ok) return reply.code(access.statusCode).send(access.payload);

      const userId = request.user?.sub;
      if (!userId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Usuario no autenticado' });
      }
      if (!audioQueue) {
        return reply.code(503).send({ error: 'QUEUE_UNAVAILABLE', message: 'Audio queue no disponible' });
      }

      const planCheck = await enforcePlanQuota(workspaceId, userId);
      if (!planCheck.ok) return reply.code(planCheck.statusCode).send(planCheck.payload);

      const body = retryTranscriptionSchema.parse(request.body || {});

      const transcription = await fastify.prisma.audioTranscription.findFirst({
        where: { id, workspaceId },
      });
      if (!transcription) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Transcripción no encontrada',
        });
      }

      const updated = await fastify.prisma.audioTranscription.update({
        where: { id: transcription.id },
        data: {
          status: 'pending',
          startedAt: null,
          completedAt: null,
          errorMessage: null,
        },
      });

      await audioQueue.add(
        `audio-retry-${transcription.provider}-${transcription.messageId}-${Date.now()}`,
        {
          workspaceId,
          audioTranscriptionId: transcription.id,
          webhookInboxId: transcription.webhookInboxId || undefined,
          messageId: transcription.messageId,
          provider: transcription.provider,
          channelId: transcription.channelId || undefined,
          correlationId: randomUUID(),
          force: body.force ?? true,
        },
        {
          attempts: QUEUES.AUDIO_TRANSCRIPTION.attempts,
          backoff: QUEUES.AUDIO_TRANSCRIPTION.backoff,
        }
      );

      return reply.send({
        status: 'queued',
        audioTranscriptionId: updated.id,
        messageId: updated.messageId,
        provider: updated.provider,
      });
    },
  });
};
