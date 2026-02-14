/**
 * Outbox Relay Job
 * Publishes pending outbox events (placeholder relay)
 */
import { Job } from 'bullmq';
import { PrismaClient, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { OutboxRelayPayload } from '@nexova/shared';
import { EvolutionClient, InfobipClient } from '@nexova/integrations';
import { decrypt } from '@nexova/core';

interface OutboxRelayResult {
  processed: number;
  failed: number;
}

const DEFAULT_REALTIME_CHANNEL = 'nexova:realtime';
const OWNER_WHATSAPP_NOTIFICATION_EVENT = 'owner.whatsapp_notification';

function resolveWhatsAppApiKey(number: {
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

function resolveInfobipBaseUrl(apiUrl?: string | null): string {
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

function resolveEvolutionBaseUrl(apiUrl?: string | null): string {
  const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
  const envUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/$/, '');
  return cleaned || envUrl;
}

function getEvolutionInstanceName(providerConfig: unknown): string {
  if (!providerConfig || typeof providerConfig !== 'object') return '';
  const cfg = providerConfig as Record<string, unknown>;
  const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
  return typeof value === 'string' ? value.trim() : '';
}

async function sendOwnerWhatsAppNotification(
  prisma: PrismaClient,
  params: { workspaceId: string; to: string; text: string }
): Promise<void> {
  const whatsappNumber = await prisma.whatsAppNumber.findFirst({
    where: { workspaceId: params.workspaceId, isActive: true },
    select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true, providerConfig: true },
  });

  if (!whatsappNumber) {
    throw new Error('WhatsApp not configured');
  }

  const apiKey = resolveWhatsAppApiKey(whatsappNumber);
  if (!apiKey) {
    throw new Error('WhatsApp API key not configured');
  }

  const provider = (whatsappNumber.provider || 'infobip').toLowerCase();
  if (provider === 'evolution') {
    const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
    const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
    if (!baseUrl || !instanceName) {
      throw new Error('Evolution not configured (baseUrl/instanceName missing)');
    }
    const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
    await client.sendText(params.to, params.text);
    return;
  }

  const client = new InfobipClient({
    apiKey,
    baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
    senderNumber: whatsappNumber.phoneNumber,
  });

  await client.sendText(params.to, params.text);
}

export function createOutboxRelayProcessor(
  prisma: PrismaClient,
  publisher: Redis,
  channel = DEFAULT_REALTIME_CHANNEL
) {
  return async (job: Job<OutboxRelayPayload>): Promise<OutboxRelayResult> => {
    const batchSize = job.data.batchSize || 50;
    const maxAgeMs = job.data.maxAge;
    const now = new Date();

    const where: Prisma.EventOutboxWhereInput = {
      status: 'pending',
      ...(maxAgeMs ? { createdAt: { lte: new Date(Date.now() - maxAgeMs) } } : {}),
    };

    const events = await prisma.eventOutbox.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let processed = 0;
    let failed = 0;

    for (const event of events) {
      try {
        if (event.eventType === OWNER_WHATSAPP_NOTIFICATION_EVENT) {
          const payload = (event.payload as Record<string, unknown>) || {};
          const to = typeof payload.to === 'string' ? payload.to : '';
          const content = (payload.content as Record<string, unknown>) || {};
          const text = typeof content.text === 'string' ? content.text : '';

          if (!to.trim() || !text.trim()) {
            throw new Error('Invalid owner WhatsApp notification payload');
          }

          await sendOwnerWhatsAppNotification(prisma, {
            workspaceId: event.workspaceId,
            to,
            text,
          });

          await prisma.eventOutbox.updateMany({
            where: { id: event.id, workspaceId: event.workspaceId },
            data: {
              status: 'published',
              publishedAt: now,
              errorMessage: null,
            },
          });

          processed++;
          continue;
        }

        const payload = {
          id: event.id,
          workspaceId: event.workspaceId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          correlationId: event.correlationId,
          createdAt: event.createdAt,
        };

        await publisher.publish(channel, JSON.stringify(payload));

        await prisma.eventOutbox.updateMany({
          where: { id: event.id, workspaceId: event.workspaceId },
          data: {
            status: 'published',
            publishedAt: now,
            errorMessage: null,
          },
        });
        processed++;
      } catch (error) {
        failed++;
        await prisma.eventOutbox.updateMany({
          where: { id: event.id, workspaceId: event.workspaceId },
          data: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            retryCount: { increment: 1 },
          },
        });
      }
    }

    return { processed, failed };
  };
}
