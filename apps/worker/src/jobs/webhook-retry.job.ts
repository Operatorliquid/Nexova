/**
 * Webhook Retry Job
 * Re-enqueues failed webhooks for agent processing
 */
import { Job, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AgentProcessPayload, QUEUES, WebhookRetryPayload } from '@nexova/shared';

interface WebhookRetryResult {
  retried: number;
  skipped: number;
}

const MAX_RETRIES = 5;
const SCAN_LIMIT = 50;

function extractSenderPhone(payload: any): string {
  const result = payload?.results?.[0];
  return result?.from || result?.sender || payload?.from || 'unknown';
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
        const payload = webhook.payload as any;
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
