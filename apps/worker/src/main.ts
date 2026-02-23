/**
 * Nexova Worker - Background processing
 * Uses new agent runtime and auxiliary queues
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { Worker, type Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { AgentWorker } from '@nexova/agent-runtime';
import { applyTenantPrismaMiddleware, decrypt, logger } from '@nexova/core';
import { EvolutionClient, InfobipClient } from '@nexova/integrations';
import {
  QUEUES,
  type AgentProcessPayload,
  type MessageSendPayload,
  type DebtReminderPayload,
  type AudioTranscriptionPayload,
  type OutboxRelayPayload,
  type ScheduledJobPayload,
  type WebhookRetryPayload,
} from '@nexova/shared';

import { createAudioTranscriptionProcessor } from './jobs/audio-transcription.job.js';
import { createDebtReminderProcessor } from './jobs/debt-reminder.job.js';
import { createOutboxRelayProcessor } from './jobs/outbox-relay.job.js';
import { createScheduledProcessor, scheduleDefaultJobs } from './jobs/scheduled.job.js';
import { createWebhookRetryProcessor } from './jobs/webhook-retry.job.js';

// Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REALTIME_CHANNEL = process.env.REALTIME_CHANNEL || 'nexova:realtime';
const EVOLUTION_INTERACTIVE_TEXT_BACKUP =
  (process.env.EVOLUTION_INTERACTIVE_TEXT_BACKUP || 'false').toLowerCase() === 'true';
const DEPLOY_STAMP = '2026-02-23.worker.10';

const connection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
};

function buildPrismaDatasourceUrl(baseUrl?: string): string | null {
  if (!baseUrl || !baseUrl.trim()) return null;

  try {
    const url = new URL(baseUrl);
    const connectionLimit = (process.env.PRISMA_CONNECTION_LIMIT || '2').trim();
    const poolTimeout = (process.env.PRISMA_POOL_TIMEOUT || '20').trim();

    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

const prismaDatasourceUrl = buildPrismaDatasourceUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient(
  prismaDatasourceUrl
    ? {
        datasources: {
          db: {
            url: prismaDatasourceUrl,
          },
        },
      }
    : undefined
);
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
  provider?: string | null;
}): string {
  const provider = (number.provider || 'infobip').toLowerCase();
  if (provider === 'infobip') {
    // Prefer global key; fallback to legacy per-number credentials only if env is missing.
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
  const cleaned = (apiUrl || '').trim().replace(/\/+$/, '');
  const envUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, '');
  let out = cleaned || envUrl;
  if (out && !/^https?:\/\//i.test(out)) {
    out = `https://${out}`;
  }
  return out;
}

function getEvolutionInstanceName(providerConfig: unknown): string {
  if (!providerConfig || typeof providerConfig !== 'object') return '';
  const cfg = providerConfig as Record<string, unknown>;
  const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
  return typeof value === 'string' ? value.trim() : '';
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

function renderInteractiveFallbackText(content: MessageSendPayload['content']): string {
  const body = (content.text || '').trim();

  if (content.buttons && content.buttons.length > 0) {
    const options = content.buttons
      .map((button, index) => `${index + 1}. ${(button.title || '').trim()}`)
      .filter((line) => line.length > 3);
    const footer = options.length > 0 ? '\n\nRespondé con el número de la opción que necesitás.' : '';
    return `${body}${options.length > 0 ? `\n\n${options.join('\n')}` : ''}${footer}`.trim();
  }

  if (content.listSections && content.listSections.length > 0) {
    const rows = content.listSections.flatMap((section) => section.rows || []);
    const options = rows
      .map((row, index) => {
        const title = (row.title || '').trim();
        const description = (row.description || '').trim();
        return description ? `${index + 1}. ${title} - ${description}` : `${index + 1}. ${title}`;
      })
      .filter((line) => line.length > 3);
    const footer = options.length > 0 ? '\n\nRespondé con el número de la opción que necesitás.' : '';
    return `${body}${options.length > 0 ? `\n\n${options.join('\n')}` : ''}${footer}`.trim();
  }

  return body || 'Te envié opciones para continuar.';
}

async function processSendJob(job: Job<MessageSendPayload>): Promise<void> {
  const { workspaceId, to, messageType, content, correlationId } = job.data;
  const normalizedTo = normalizePhone(to);
  logger.info(`[Worker] Processing send job to: ${normalizedTo}`);

  if (!normalizedTo || normalizedTo === 'unknown' || !/^\+\d+$/.test(normalizedTo)) {
    console.warn(`[Worker] Skipping send job with invalid destination: ${to}`);
    return;
  }

  const whatsappNumber = await prisma.whatsAppNumber.findFirst({
    where: { workspaceId, isActive: true },
  });

  if (!whatsappNumber) {
    throw new Error('No active WhatsApp number for workspace');
  }

  const provider = (whatsappNumber.provider || 'infobip').toLowerCase();
  const apiKey = resolveWhatsAppApiKey(whatsappNumber);

  let result: { messageId: string; status: string; to: string };
  let usageMessageType: string = messageType;

  if (provider === 'evolution') {
    const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
    if (!baseUrl) {
      throw new Error('Evolution baseUrl not configured');
    }
    if (!apiKey) {
      throw new Error('Evolution API key not configured');
    }
    const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
    if (!instanceName) {
      throw new Error('Evolution instanceName not configured');
    }

    const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
    let interactiveBackupText: string | null = null;

    if (messageType === 'text') {
      result = await client.sendText(normalizedTo, content.text || '');
    } else if (messageType === 'template') {
      throw new Error('Template messages are not supported for Evolution provider');
    } else if (messageType === 'media') {
      if (content.mediaType === 'image' && content.mediaUrl) {
        result = await client.sendImage(normalizedTo, content.mediaUrl, content.text);
      } else if (content.mediaType === 'document' && content.mediaUrl) {
        try {
          result = await client.sendDocument(normalizedTo, content.mediaUrl, content.text);
        } catch (error) {
          const fallbackText =
            'No pude adjuntar el archivo directamente. Te dejo el enlace:\n' + content.mediaUrl;
          console.warn(
            `[Worker] Evolution document send failed, falling back to link text: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          result = await client.sendText(normalizedTo, fallbackText);
          usageMessageType = 'text';
        }
      } else {
        throw new Error(`Unsupported media type: ${content.mediaType}`);
      }
    } else if (messageType === 'interactive') {
      try {
        interactiveBackupText = renderInteractiveFallbackText(content);
        if (content.buttons && content.buttons.length > 0) {
          if (provider === 'evolution') {
            const payload = {
              body: truncateText(content.text || '', 1024),
              buttonText: truncateText(content.buttonText || 'Ver opciones', 20),
              sections: [
                {
                  ...(content.header ? { title: truncateText(content.header, 24) } : { title: 'Opciones' }),
                  rows: content.buttons.map((button) => ({
                    id: button.id,
                    title: truncateText(button.title, 24),
                  })),
                },
              ],
              ...(content.header ? { header: content.header } : {}),
              ...(content.footer ? { footer: content.footer } : {}),
            };
            result = await client.sendInteractiveList(normalizedTo, payload);
            usageMessageType = 'interactive-list';
          } else {
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
          }
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
      } catch (error) {
        const fallbackText = renderInteractiveFallbackText(content);
        console.warn(`[Worker] Evolution interactive send failed, falling back to text: ${error instanceof Error ? error.message : String(error)}`);
        result = await client.sendText(normalizedTo, fallbackText);
        usageMessageType = 'text';
      }
    } else {
      throw new Error(`Unsupported message type: ${String(messageType)}`);
    }

    if (
      EVOLUTION_INTERACTIVE_TEXT_BACKUP &&
      interactiveBackupText &&
      (usageMessageType === 'interactive-buttons' || usageMessageType === 'interactive-list')
    ) {
      try {
        await client.sendText(normalizedTo, interactiveBackupText);
        logger.info(`[Worker] Evolution interactive backup text sent to ${normalizedTo}`);
      } catch (backupError) {
        console.warn(
          `[Worker] Evolution interactive backup text failed: ${
            backupError instanceof Error ? backupError.message : String(backupError)
          }`
        );
      }
    }

    const evolutionStatus = String(result.status || '').toLowerCase();
    if (['failed', 'error', 'rejected'].some((token) => evolutionStatus.includes(token))) {
      throw new Error(`Evolution rejected message: ${result.status}`);
    }

    logger.info(
      `[Worker] Evolution send accepted to ${normalizedTo} (type=${usageMessageType}, status=${result.status}, messageId=${result.messageId || 'n/a'})`
    );
  } else {
    if (!apiKey) {
      throw new Error('WhatsApp API key not configured');
    }
    if (!whatsappNumber.phoneNumber) {
      throw new Error('WhatsApp sender number not configured');
    }

    const client = new InfobipClient({
      apiKey,
      baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
      senderNumber: whatsappNumber.phoneNumber,
    });

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
      throw new Error(`Unsupported message type: ${String(messageType)}`);
    }
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

  logger.info(`[Worker] Completed send job to: ${to}`);
}

async function startWorkers(): Promise<void> {
  logger.info('[Worker] Starting workers...');
  logger.info(`[Worker] Redis: ${REDIS_HOST}:${REDIS_PORT}`);

  // Queues
  const agentQueue = new Queue<AgentProcessPayload>(QUEUES.AGENT_PROCESS.name, { connection });
  const messageQueue = new Queue<MessageSendPayload>(QUEUES.MESSAGE_SEND.name, { connection });
  const debtReminderQueue = new Queue<DebtReminderPayload>(QUEUES.DEBT_REMINDER.name, { connection });
  const audioTranscriptionQueue = new Queue<AudioTranscriptionPayload>(QUEUES.AUDIO_TRANSCRIPTION.name, { connection });
  const outboxQueue = new Queue(QUEUES.OUTBOX_RELAY.name, { connection });
  const webhookRetryQueue = new Queue(QUEUES.WEBHOOK_RETRY.name, { connection });
  const scheduledQueue = new Queue<ScheduledJobPayload>(QUEUES.SCHEDULED.name, { connection });

  // New agent runtime worker
  const agentWorker = new AgentWorker(prisma, {
    redisHost: REDIS_HOST,
    redisPort: REDIS_PORT,
    redisPassword: REDIS_PASSWORD,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    concurrency: QUEUES.AGENT_PROCESS.concurrency,
  });
  agentWorker.start();

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
    logger.info(`[Worker] Send job ${job.id} completed`);
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
    logger.info(`[Worker] Debt reminder job ${job.id} completed`);
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

  // Audio transcription worker
  const audioTranscriptionProcessor = createAudioTranscriptionProcessor(prisma, agentQueue, messageQueue);
  const audioTranscriptionWorker = new Worker(
    QUEUES.AUDIO_TRANSCRIPTION.name,
    audioTranscriptionProcessor,
    {
      connection,
      concurrency: QUEUES.AUDIO_TRANSCRIPTION.concurrency,
    }
  );

  audioTranscriptionWorker.on('completed', (job) => {
    logger.info(`[Worker] Audio transcription job ${job.id} completed`);
  });

  audioTranscriptionWorker.on('failed', (job, err) => {
    console.error(`[Worker] Audio transcription job ${job?.id} failed:`, err.message);
  });

  audioTranscriptionWorker.on('error', (err) => {
    console.error('[Worker] Audio transcription worker error:', err);
  });

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

  await scheduleDefaultJobs(scheduledQueue);

  logger.info('[Worker] Workers started successfully');
  logger.info(`[Worker] Deploy stamp: ${DEPLOY_STAMP}`);
  logger.info(`[Worker] Agent worker concurrency: ${QUEUES.AGENT_PROCESS.concurrency}`);
  logger.info(`[Worker] Send worker concurrency: ${QUEUES.MESSAGE_SEND.concurrency}`);
  logger.info(`[Worker] Debt reminder worker concurrency: ${QUEUES.DEBT_REMINDER.concurrency}`);
  logger.info(`[Worker] Audio transcription worker concurrency: ${QUEUES.AUDIO_TRANSCRIPTION.concurrency}`);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[Worker] Received ${signal}, shutting down...`);

    await agentWorker.stop();
    await sendWorker.close();
    await debtReminderWorker.close();
    await outboxWorker.close();
    await webhookRetryWorker.close();
    await scheduledWorker.close();
    await audioTranscriptionWorker.close();
    await agentQueue.close();
    await messageQueue.close();
    await debtReminderQueue.close();
    await outboxQueue.close();
    await webhookRetryQueue.close();
    await scheduledQueue.close();
    await audioTranscriptionQueue.close();
    await realtimePublisher.quit();
    await prisma.$disconnect();

    logger.info('[Worker] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

// Start
startWorkers().catch((err) => {
  console.error('[Worker] Failed to start:', err);
  process.exit(1);
});
