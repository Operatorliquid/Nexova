/**
 * Audio Tools
 * Owner tools for manual audio transcription lifecycle (enqueue + fetch transcript).
 */
import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Queue } from 'bullmq';
import { z } from 'zod';

import {
  type AudioTranscriptionPayload,
  COMMERCE_USAGE_METRICS,
  QUEUES,
  getCommercePlanCapabilities,
} from '@nexova/shared';

import { ToolCategory, type ToolContext, type ToolResult } from '../../types/index.js';
import { getEffectivePlanLimits, resolveWorkspacePlan } from '../../utils/commerce-plan-limits.js';
import { getMonthlyUsage } from '../../utils/monthly-usage.js';
import { BaseTool } from '../base.js';

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

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

function normalizeProvider(value: string | undefined): 'infobip' | 'evolution' | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'infobip' || normalized === 'evolution') return normalized;
  return null;
}

function pickAudioMetaFromWebhook(payload: unknown): {
  channelId?: string;
  mimeType?: string;
  fileName?: string;
  durationMs?: number;
  sizeBytes?: number;
  fileRef?: string;
} {
  const payloadObj = asObject(payload);
  const nexova = asObject(payloadObj.__nexova);
  const audio = asObject(nexova.audio);
  const results0 = Array.isArray(payloadObj.results) ? asObject(payloadObj.results[0]) : {};
  const data = asObject(payloadObj.data);
  const key = asObject(data.key);

  const channelId =
    (typeof results0.from === 'string' && results0.from)
    || (typeof key.remoteJid === 'string'
      ? `+${(key.remoteJid.split('@')[0] || '').replace(/\D/g, '')}`
      : undefined);

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

const TranscribeAudioMessageInputSchema = z
  .object({
    messageId: z.string().trim().min(1).max(255).optional().describe('ID del mensaje webhook (externalId)'),
    webhookInboxId: z.string().uuid().optional().describe('ID interno del webhook_inbox'),
    provider: z.enum(['infobip', 'evolution']).optional().describe('Proveedor WhatsApp esperado'),
    force: z.boolean().optional().describe('Forzar re-proceso aunque ya exista transcripción'),
  })
  .refine((value) => !!value.messageId || !!value.webhookInboxId, {
    message: 'Debe enviar messageId o webhookInboxId',
    path: ['messageId'],
  });

type TranscribeAudioMessageInput = z.infer<typeof TranscribeAudioMessageInputSchema>;

const GetAudioTranscriptInputSchema = z
  .object({
    audioTranscriptionId: z.string().uuid().optional().describe('ID de audio_transcriptions'),
    messageId: z.string().trim().min(1).max(255).optional().describe('ID externo del mensaje'),
    provider: z.enum(['infobip', 'evolution']).optional().describe('Proveedor WhatsApp'),
  })
  .refine((value) => !!value.audioTranscriptionId || !!value.messageId, {
    message: 'Debe enviar audioTranscriptionId o messageId',
    path: ['audioTranscriptionId'],
  });

type GetAudioTranscriptInput = z.infer<typeof GetAudioTranscriptInputSchema>;

class AudioToolBase {
  protected prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  ownerGuard(context: ToolContext): ToolResult | null {
    if (!context.isOwner) {
      return {
        success: false,
        error: 'Esta herramienta está disponible solo para el owner.',
      };
    }
    return null;
  }

  async enforceAudioCapability(context: ToolContext): Promise<ToolResult | null> {
    const plan = await resolveWorkspacePlan(this.prisma, context.workspaceId);
    const capabilities = getCommercePlanCapabilities(plan);
    if (!capabilities.showWhatsappAudioTranscription) {
      return {
        success: false,
        error: 'Tu plan actual no incluye transcripción de audio en WhatsApp.',
      };
    }
    return null;
  }

  async enforceQuota(context: ToolContext): Promise<ToolResult | null> {
    const plan = await resolveWorkspacePlan(this.prisma, context.workspaceId);
    const limits = await getEffectivePlanLimits(this.prisma, plan);
    const monthlyLimit = limits.audioTranscriptionsPerMonth;
    if (monthlyLimit === null) return null;

    const used = await getMonthlyUsage(this.prisma, {
      workspaceId: context.workspaceId,
      metric: COMMERCE_USAGE_METRICS.audioTranscriptions,
    });

    if (used >= BigInt(monthlyLimit)) {
      return {
        success: false,
        error: `Alcanzaste el límite mensual de transcripciones de audio (${monthlyLimit}).`,
      };
    }

    return null;
  }
}

export class TranscribeAudioMessageTool extends BaseTool<typeof TranscribeAudioMessageInputSchema> {
  private prisma: PrismaClient;
  private audioQueue: Queue<AudioTranscriptionPayload> | null;
  private base: AudioToolBase;

  constructor(
    prisma: PrismaClient,
    audioQueue?: Queue<AudioTranscriptionPayload> | null
  ) {
    super({
      name: 'transcribe_audio_message',
      description: 'Encola la transcripción de un audio de WhatsApp por messageId o webhookInboxId (solo owner, plan Pro).',
      category: ToolCategory.MUTATION,
      inputSchema: TranscribeAudioMessageInputSchema,
    });
    this.prisma = prisma;
    this.audioQueue = audioQueue ?? null;
    this.base = new AudioToolBase(prisma);
  }

  async execute(input: TranscribeAudioMessageInput, context: ToolContext): Promise<ToolResult> {
    const ownerGuard = this.base.ownerGuard(context);
    if (ownerGuard) return ownerGuard;
    if (!this.audioQueue) {
      return {
        success: false,
        error: 'No hay cola de transcripción configurada.',
      };
    }

    const capabilityGuard = await this.base.enforceAudioCapability(context);
    if (capabilityGuard) return capabilityGuard;

    const providerFilter = normalizeProvider(input.provider);

    const webhook = input.webhookInboxId
      ? await this.prisma.webhookInbox.findFirst({
          where: {
            id: input.webhookInboxId,
            workspaceId: context.workspaceId,
            ...(providerFilter ? { provider: providerFilter } : {}),
          },
          select: {
            id: true,
            workspaceId: true,
            provider: true,
            externalId: true,
            payload: true,
            correlationId: true,
          },
        })
      : await this.prisma.webhookInbox.findFirst({
          where: {
            workspaceId: context.workspaceId,
            externalId: input.messageId!,
            ...(providerFilter ? { provider: providerFilter } : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            workspaceId: true,
            provider: true,
            externalId: true,
            payload: true,
            correlationId: true,
          },
        });

    if (!webhook) {
      return { success: false, error: 'Mensaje webhook no encontrado para transcribir.' };
    }

    const provider = normalizeProvider(webhook.provider || undefined);
    if (!provider) {
      return { success: false, error: `Proveedor no soportado para transcripción: ${webhook.provider}` };
    }

    const audioMeta = pickAudioMetaFromWebhook(webhook.payload);
    let transcription = await this.prisma.audioTranscription.findFirst({
      where: {
        workspaceId: context.workspaceId,
        provider,
        messageId: webhook.externalId,
      },
    });

    if (transcription?.status === 'completed' && !input.force) {
      return {
        success: true,
        data: {
          status: 'already_completed',
          audioTranscriptionId: transcription.id,
          messageId: transcription.messageId,
          transcript: transcription.transcript,
        },
      };
    }

    const quotaGuard = await this.base.enforceQuota(context);
    if (quotaGuard) return quotaGuard;

    if (!transcription) {
      transcription = await this.prisma.audioTranscription.create({
        data: {
          workspaceId: context.workspaceId,
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
    } else if (input.force) {
      transcription = await this.prisma.audioTranscription.update({
        where: { id: transcription.id },
        data: {
          status: 'pending',
          startedAt: null,
          completedAt: null,
          errorMessage: null,
        },
      });
    }

    await this.audioQueue.add(
      `audio-tool-${provider}-${webhook.externalId}-${Date.now()}`,
      {
        workspaceId: context.workspaceId,
        audioTranscriptionId: transcription.id,
        webhookInboxId: webhook.id,
        messageId: webhook.externalId,
        provider,
        channelId: audioMeta.channelId,
        correlationId: webhook.correlationId || context.correlationId,
        force: input.force || false,
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

    return {
      success: true,
      data: {
        status: 'queued',
        audioTranscriptionId: transcription.id,
        messageId: webhook.externalId,
        provider,
      },
    };
  }
}

export class GetAudioTranscriptTool extends BaseTool<typeof GetAudioTranscriptInputSchema> {
  private prisma: PrismaClient;
  private base: AudioToolBase;

  constructor(prisma: PrismaClient) {
    super({
      name: 'get_audio_transcript',
      description: 'Obtiene el estado o texto transcripto de un audio de WhatsApp (solo owner, plan Pro).',
      category: ToolCategory.QUERY,
      inputSchema: GetAudioTranscriptInputSchema,
    });
    this.prisma = prisma;
    this.base = new AudioToolBase(prisma);
  }

  async execute(input: GetAudioTranscriptInput, context: ToolContext): Promise<ToolResult> {
    const ownerGuard = this.base.ownerGuard(context);
    if (ownerGuard) return ownerGuard;

    const capabilityGuard = await this.base.enforceAudioCapability(context);
    if (capabilityGuard) return capabilityGuard;

    const providerFilter = normalizeProvider(input.provider);

    const transcription = input.audioTranscriptionId
      ? await this.prisma.audioTranscription.findFirst({
          where: {
            id: input.audioTranscriptionId,
            workspaceId: context.workspaceId,
          },
        })
      : await this.prisma.audioTranscription.findFirst({
          where: {
            workspaceId: context.workspaceId,
            messageId: input.messageId!,
            ...(providerFilter ? { provider: providerFilter } : {}),
          },
          orderBy: { createdAt: 'desc' },
        });

    if (!transcription) {
      return { success: false, error: 'Transcripción no encontrada.' };
    }

    return {
      success: true,
      data: {
        audioTranscriptionId: transcription.id,
        provider: transcription.provider,
        messageId: transcription.messageId,
        status: transcription.status,
        transcript: transcription.transcript,
        language: transcription.language,
        confidence: transcription.confidence,
        errorMessage: transcription.errorMessage,
        attemptCount: transcription.attemptCount,
        startedAt: transcription.startedAt,
        completedAt: transcription.completedAt,
        createdAt: transcription.createdAt,
        updatedAt: transcription.updatedAt,
      },
    };
  }
}

export interface AudioToolsDependencies {
  prisma: PrismaClient;
  queue?: Queue<AudioTranscriptionPayload> | null;
}

export function createAudioTools(deps: AudioToolsDependencies): Array<BaseTool<z.ZodSchema, unknown>> {
  return [
    new TranscribeAudioMessageTool(deps.prisma, deps.queue ?? null),
    new GetAudioTranscriptTool(deps.prisma),
  ];
}
