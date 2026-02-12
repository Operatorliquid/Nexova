/**
 * Nexova Worker - Background processing
 * Uses new agent runtime and auxiliary queues
 */
import { Worker, Job, Queue } from 'bullmq';
import { PrismaClient, Prisma } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  QUEUES,
  MessageSendPayload,
  OutboxRelayPayload,
  WebhookRetryPayload,
} from '@nexova/shared';
import { AgentWorker } from '@nexova/agent-runtime';
import { InfobipClient } from '@nexova/integrations';
import { decrypt, applyTenantPrismaMiddleware } from '@nexova/core';
import { createDebtReminderProcessor } from './jobs/debt-reminder.job.js';
import { createOutboxRelayProcessor } from './jobs/outbox-relay.job.js';
import { createWebhookRetryProcessor } from './jobs/webhook-retry.job.js';
import { createScheduledProcessor, scheduleDefaultJobs } from './jobs/scheduled.job.js';

// Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REALTIME_CHANNEL = process.env.REALTIME_CHANNEL || 'nexova:realtime';

const connection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
};

const prisma = new PrismaClient();
applyTenantPrismaMiddleware(prisma);
const realtimePublisher = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
});
realtimePublisher.on('error', (err) => {
  console.error('[Worker] Realtime Redis publisher error:', err);
});

function resolveWhatsAppApiKey(number: {
  apiKeyEnc?: string | null;
  apiKeyIv?: string | null;
}): string {
  if (!number.apiKeyEnc || !number.apiKeyIv) {
    return '';
  }
  return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
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

function getUsagePeriod(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

function normalizeUsageQuantity(quantity: number | bigint): bigint {
  if (typeof quantity === 'bigint') return quantity;
  if (!Number.isFinite(quantity)) return 0n;
  const normalized = Math.floor(quantity);
  if (normalized <= 0) return 0n;
  return BigInt(normalized);
}

async function recordUsage(
  prismaClient: PrismaClient,
  params: {
    workspaceId: string;
    metric: string;
    quantity: number | bigint;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
  }
): Promise<void> {
  const amount = normalizeUsageQuantity(params.quantity);
  if (amount <= 0n) return;

  const { start, end } = getUsagePeriod(params.occurredAt ?? new Date());

  try {
    const existing = await prismaClient.usageRecord.findFirst({
      where: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        periodStart: start,
        periodEnd: end,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await prismaClient.usageRecord.updateMany({
        where: { id: existing.id, workspaceId: params.workspaceId },
        data: { quantity: { increment: amount } },
      });
      return;
    }

    await prismaClient.usageRecord.create({
      data: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        quantity: amount,
        periodStart: start,
        periodEnd: end,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error('[UsageRecord] Failed to record usage:', error);
  }
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  return `+${digits}`;
}

function truncateButtonTitle(title: string, maxLength: number): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;
  const chars = Array.from(trimmed);
  if (chars.length <= maxLength) return trimmed;
  return chars.slice(0, maxLength).join('');
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const chars = Array.from(trimmed);
  if (chars.length <= maxLength) return trimmed;
  return chars.slice(0, maxLength).join('');
}

async function processSendJob(job: Job<MessageSendPayload>): Promise<void> {
  const { workspaceId, to, messageType, content, correlationId } = job.data;
  const normalizedTo = normalizePhone(to);
  console.log(`[Worker] Processing send job to: ${normalizedTo}`);

  const whatsappNumber = await prisma.whatsAppNumber.findFirst({
    where: { workspaceId, isActive: true },
  });

  if (!whatsappNumber) {
    throw new Error('No active WhatsApp number for workspace');
  }

  const apiKey = resolveWhatsAppApiKey(whatsappNumber);
  if (!apiKey) {
    throw new Error('WhatsApp API key not configured');
  }

  const client = new InfobipClient({
    apiKey,
    baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
    senderNumber: whatsappNumber.phoneNumber,
  });

  let result: { messageId: string; status: string; to: string };
  let usageMessageType: string = messageType;

  if (messageType === 'text') {
    result = await client.sendText(normalizedTo, content.text || '');
  } else if (messageType === 'template') {
    result = await client.sendTemplate(
      normalizedTo,
      content.templateId || '',
      content.templateParams || {}
    );
  } else if (messageType === 'media') {
    if (content.mediaType === 'image' && content.mediaUrl) {
      result = await client.sendImage(normalizedTo, content.mediaUrl, content.text);
    } else if (content.mediaType === 'document' && content.mediaUrl) {
      result = await client.sendDocument(normalizedTo, content.mediaUrl, content.text);
    } else {
      throw new Error(`Unsupported media type: ${content.mediaType}`);
    }
  } else if (messageType === 'interactive') {
    if (content.buttons && content.buttons.length > 0) {
      const payload = {
        body: content.text || '',
        buttons: content.buttons.map((button) => ({
          ...button,
          title: truncateButtonTitle(button.title, 20),
        })),
        ...(content.header ? { header: content.header } : {}),
        ...(content.footer ? { footer: content.footer } : {}),
      };
      result = await client.sendInteractiveButtons(normalizedTo, payload);
      usageMessageType = 'interactive-buttons';
    } else if (content.listSections && content.listSections.length > 0) {
      const payload = {
        body: truncateText(content.text || '', 1024),
        buttonText: truncateText(content.buttonText || 'Ver opciones', 20),
        sections: content.listSections.map((section) => ({
          ...(section.title ? { title: truncateText(section.title, 24) } : {}),
          rows: section.rows.map((row) => ({
            id: row.id,
            title: truncateText(row.title, 24),
            ...(row.description ? { description: truncateText(row.description, 72) } : {}),
          })),
        })),
        ...(content.header ? { header: content.header } : {}),
        ...(content.footer ? { footer: content.footer } : {}),
      };
      result = await client.sendInteractiveList(normalizedTo, payload);
      usageMessageType = 'interactive-list';
    } else {
      throw new Error('Interactive message requires buttons or listSections');
    }
  } else {
    throw new Error(`Unsupported message type: ${messageType}`);
  }

  await prisma.eventOutbox.create({
    data: {
      workspaceId,
      eventType: 'message.sent',
      aggregateType: 'Message',
      aggregateId: result.messageId,
      payload: {
        to: normalizedTo,
        content,
        status: result.status,
      },
      status: 'pending',
      correlationId,
    },
  });

  await recordUsage(prisma, {
    workspaceId,
    metric: 'messages.outbound',
    quantity: 1,
    metadata: { channelType: 'whatsapp', messageType: usageMessageType },
  });

  console.log(`[Worker] Completed send job to: ${to}`);
}

async function startWorkers(): Promise<void> {
  console.log('[Worker] Starting workers...');
  console.log(`[Worker] Redis: ${REDIS_HOST}:${REDIS_PORT}`);

  // Queues
  const agentQueue = new Queue(QUEUES.AGENT_PROCESS.name, { connection });
  const messageQueue = new Queue(QUEUES.MESSAGE_SEND.name, { connection });
  const debtReminderQueue = new Queue(QUEUES.DEBT_REMINDER.name, { connection });
  const outboxQueue = new Queue(QUEUES.OUTBOX_RELAY.name, { connection });
  const webhookRetryQueue = new Queue(QUEUES.WEBHOOK_RETRY.name, { connection });
  const scheduledQueue = new Queue(QUEUES.SCHEDULED.name, { connection });

  // New agent runtime worker
  const agentWorker = new AgentWorker(prisma, {
    redisHost: REDIS_HOST,
    redisPort: REDIS_PORT,
    redisPassword: REDIS_PASSWORD,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    concurrency: QUEUES.AGENT_PROCESS.concurrency,
  });
  await agentWorker.start();

  // Message send worker
  const sendWorker = new Worker(
    QUEUES.MESSAGE_SEND.name,
    processSendJob,
    {
      connection,
      concurrency: QUEUES.MESSAGE_SEND.concurrency,
    }
  );

  sendWorker.on('completed', (job) => {
    console.log(`[Worker] Send job ${job.id} completed`);
  });

  sendWorker.on('failed', (job, err) => {
    console.error(`[Worker] Send job ${job?.id} failed:`, err.message);
  });

  sendWorker.on('error', (err) => {
    console.error('[Worker] Send worker error:', err);
  });

  // Debt reminder worker
  const debtReminderProcessor = createDebtReminderProcessor(prisma, messageQueue);
  const debtReminderWorker = new Worker(
    QUEUES.DEBT_REMINDER.name,
    debtReminderProcessor,
    {
      connection,
      concurrency: QUEUES.DEBT_REMINDER.concurrency,
    }
  );

  debtReminderWorker.on('completed', (job) => {
    console.log(`[Worker] Debt reminder job ${job.id} completed`);
  });

  debtReminderWorker.on('failed', (job, err) => {
    console.error(`[Worker] Debt reminder job ${job?.id} failed:`, err.message);
  });

  debtReminderWorker.on('error', (err) => {
    console.error('[Worker] Debt reminder worker error:', err);
  });

  // Outbox relay worker
  const outboxRelayProcessor = createOutboxRelayProcessor(
    prisma,
    realtimePublisher,
    REALTIME_CHANNEL
  );
  const outboxWorker = new Worker(
    QUEUES.OUTBOX_RELAY.name,
    outboxRelayProcessor,
    {
      connection,
      concurrency: QUEUES.OUTBOX_RELAY.concurrency,
    }
  );

  // Webhook retry worker
  const webhookRetryProcessor = createWebhookRetryProcessor(prisma, agentQueue);
  const webhookRetryWorker = new Worker(
    QUEUES.WEBHOOK_RETRY.name,
    webhookRetryProcessor,
    {
      connection,
      concurrency: QUEUES.WEBHOOK_RETRY.concurrency,
    }
  );

  // Scheduled jobs worker
  const scheduledProcessor = createScheduledProcessor(prisma);
  const scheduledWorker = new Worker(
    QUEUES.SCHEDULED.name,
    scheduledProcessor,
    {
      connection,
      concurrency: QUEUES.SCHEDULED.concurrency,
    }
  );

  // Schedule repeating jobs
  await debtReminderQueue.add(
    'daily-reminder',
    { workspaceId: '*' },
    {
      repeat: {
        pattern: '0 9 * * *',
        tz: 'America/Argentina/Buenos_Aires',
      },
      jobId: 'debt-reminder-daily',
    }
  );

  await outboxQueue.add(
    'relay',
    { batchSize: 100 } as OutboxRelayPayload,
    { repeat: { every: 5000 }, jobId: 'outbox-relay' }
  );

  await webhookRetryQueue.add(
    'scan',
    { scan: true } as WebhookRetryPayload,
    { repeat: { every: 60 * 1000 }, jobId: 'webhook-retry-scan' }
  );

  await scheduleDefaultJobs(scheduledQueue as unknown as { add: Function });

  console.log('[Worker] Workers started successfully');
  console.log(`[Worker] Agent worker concurrency: ${QUEUES.AGENT_PROCESS.concurrency}`);
  console.log(`[Worker] Send worker concurrency: ${QUEUES.MESSAGE_SEND.concurrency}`);
  console.log(`[Worker] Debt reminder worker concurrency: ${QUEUES.DEBT_REMINDER.concurrency}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down...`);

    await agentWorker.stop();
    await sendWorker.close();
    await debtReminderWorker.close();
    await outboxWorker.close();
    await webhookRetryWorker.close();
    await scheduledWorker.close();
    await agentQueue.close();
    await messageQueue.close();
    await debtReminderQueue.close();
    await outboxQueue.close();
    await webhookRetryQueue.close();
    await scheduledQueue.close();
    await realtimePublisher.quit();
    await prisma.$disconnect();

    console.log('[Worker] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Start
startWorkers().catch((err) => {
  console.error('[Worker] Failed to start:', err);
  process.exit(1);
});
