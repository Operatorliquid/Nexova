/**
 * Webhook Retry Job
 * Re-enqueues failed webhooks for agent processing
 */
import { randomUUID } from 'crypto';

import { type PrismaClient } from '@prisma/client';
import { type Job, type Queue } from 'bullmq';

import { type AgentProcessPayload, QUEUES, type WebhookRetryPayload } from '@nexova/shared';

interface WebhookRetryResult {
  retried: number;
  skipped: number;
}

const MAX_RETRIES = 5;
const SCAN_LIMIT = 50;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toPhoneDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

function normalizeToE164(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const base = trimmed.includes('@') ? (trimmed.split('@')[0] || '') : trimmed;
  let digits = toPhoneDigits(base);
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  return `+${digits}`;
}

function extractSenderPhone(payload: unknown): string {
  const payloadObject = asObject(payload);
  const firstResult = Array.isArray(payloadObject?.['results'])
    ? asObject((payloadObject['results'] as unknown[])[0])
    : null;
  const fromResult = typeof firstResult?.['from'] === 'string' ? firstResult['from'] : null;
  const senderResult = typeof firstResult?.['sender'] === 'string' ? firstResult['sender'] : null;
  const fromPayload = typeof payloadObject?.['from'] === 'string' ? payloadObject['from'] : null;
  const infobipSender = fromResult || senderResult || fromPayload;
  if (infobipSender) {
    return infobipSender;
  }

  // Evolution payload fallback (Baileys-style)
  const payloadData = asObject(payloadObject?.['data']);
  const payloadDataKey = asObject(payloadData?.['key']);
  const payloadKey = asObject(payloadObject?.['key']);
  const candidates = [
    payloadDataKey?.['remoteJid'],
    payloadDataKey?.['remoteJidAlt'],
    payloadDataKey?.['senderPn'],
    payloadDataKey?.['cleanedSenderPn'],
    payloadDataKey?.['participant'],
    payloadData?.['remoteJid'],
    payloadKey?.['remoteJid'],
    payloadKey?.['remoteJidAlt'],
    payloadKey?.['senderPn'],
    payloadKey?.['cleanedSenderPn'],
    payloadKey?.['participant'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeToE164(candidate);
    if (normalized) return normalized;
  }

  return 'unknown';
}

export function createWebhookRetryProcessor(
  prisma: PrismaClient,
  agentQueue: Queue<AgentProcessPayload>
) {
  return async (job: Job<WebhookRetryPayload>): Promise<WebhookRetryResult> => {
    const shouldScan = job.data?.scan || job.data?.webhookInboxId === '*' || !job.data?.webhookInboxId;

    const webhookRecords = shouldScan
      ? await prisma.webhookInbox.findMany({
          where: {
            status: 'failed',
            retryCount: { lt: MAX_RETRIES },
          },
          orderBy: { lastAttemptAt: 'asc' },
          take: SCAN_LIMIT,
        })
      : await prisma.webhookInbox.findMany({
          where: {
            id: job.data.webhookInboxId,
            status: 'failed',
          },
          take: 1,
        });

    let retried = 0;
    let skipped = 0;

    for (const webhook of webhookRecords) {
      try {
        const payload = webhook.payload as unknown;
        const senderPhone = extractSenderPhone(payload);
        const correlationId = webhook.correlationId || randomUUID();
        if (!webhook.correlationId) {
          await prisma.webhookInbox.updateMany({
            where: { id: webhook.id, workspaceId: webhook.workspaceId },
            data: { correlationId },
          });
        }

        const jobPayload: AgentProcessPayload = {
          workspaceId: webhook.workspaceId,
          messageId: webhook.externalId,
          channelId: senderPhone,
          channelType: 'whatsapp',
          correlationId,
        };

        await agentQueue.add(`retry-${webhook.id}-${webhook.externalId}`, jobPayload, {
          attempts: QUEUES.AGENT_PROCESS.attempts,
          backoff: QUEUES.AGENT_PROCESS.backoff,
        });

        await prisma.webhookInbox.updateMany({
          where: { id: webhook.id, workspaceId: webhook.workspaceId },
          data: {
            status: 'pending',
            lastAttemptAt: new Date(),
            errorMessage: null,
          },
        });

        retried++;
      } catch {
        skipped++;
        await prisma.webhookInbox.updateMany({
          where: { id: webhook.id, workspaceId: webhook.workspaceId },
          data: {
            retryCount: { increment: 1 },
            errorMessage: 'Failed to enqueue retry',
          },
        });
      }
    }

    return { retried, skipped };
  };
}
