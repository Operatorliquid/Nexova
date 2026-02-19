/**
 * Agent Worker
 * BullMQ worker that processes incoming messages
 *
 * Features:
 * - Processes messages from agent:process queue
 * - Idempotent via WebhookInbox correlation
 * - DLQ for exhausted jobs
 * - Handoff after 2 consecutive failures
 */
import { scryptSync, timingSafeEqual } from 'crypto';

import Anthropic from '@anthropic-ai/sdk';
import { type PrismaClient, type Prisma, type WebhookInbox } from '@prisma/client';
import { Worker, type Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';



import { decrypt, logger, runWithContext } from '@nexova/core';
import {
  QUEUES,
  type AgentProcessPayload,
  type MessageSendPayload,
  type AudioTranscriptionPayload,
  getCommercePlanCapabilities,
  resolveCommercePlan,
} from '@nexova/shared';

import {
  extractAudioTranscriptFromPayload,
  isAwaitingAudioTranscriptionPayload,
} from './payload-audio.utils.js';
import { type RetailAgent, createRetailAgent } from '../core/agent.js';
import { MemoryService } from '../core/memory-service.js';
import { LocalFileUploader } from '../utils/file-uploader.js';

// Max consecutive failures before triggering handoff
const MAX_FAILURES_BEFORE_HANDOFF = 2;
const DEFAULT_COALESCE_ENABLED = (process.env.AGENT_COALESCE_ENABLED || 'true').toLowerCase() === 'true';
// WhatsApp users often send 2-3 short messages back-to-back (within a few seconds).
// Coalescing reduces double replies by waiting a bit before processing.
const DEFAULT_COALESCE_WINDOW_MS = Number.parseInt(process.env.AGENT_COALESCE_WINDOW_MS || '7500', 10);
const DEFAULT_COALESCE_MAX_MESSAGES = Number.parseInt(process.env.AGENT_COALESCE_MAX_MESSAGES || '5', 10);
const DEFAULT_COALESCE_JOINER = process.env.AGENT_COALESCE_JOINER || '\n';
const DEFAULT_SESSION_LOCK_ENABLED =
  (process.env.AGENT_SESSION_LOCK_ENABLED || 'true').toLowerCase() === 'true';
const DEFAULT_SESSION_LOCK_TTL_MS = Number.parseInt(process.env.AGENT_SESSION_LOCK_TTL_MS || '15000', 10);
const DEFAULT_SESSION_LOCK_RETRY_MS = Number.parseInt(process.env.AGENT_SESSION_LOCK_RETRY_MS || '500', 10);
const DEFAULT_INTERACTIVE_REPLY_TTL_SECONDS = Number.parseInt(
  process.env.AGENT_INTERACTIVE_REPLY_TTL_SECONDS || '1800',
  10
);
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const OWNER_AGENT_AUTH_TTL_SECONDS = Number.parseInt(process.env.OWNER_AGENT_AUTH_TTL_SECONDS || '604800', 10); // 7d
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE?.trim() || 'America/Argentina/Buenos_Aires';
const OFF_HOURS_AUTO_REPLY = 'no estamos trabajando en este momento.';
const DEFAULT_WORKING_DAYS: WorkingDayCode[] = ['lun', 'mar', 'mie', 'jue', 'vie'];
const VALID_WORKING_DAYS = new Set<WorkingDayCode>(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']);
const WEEKDAY_EN_TO_WORKING_DAY: Record<string, WorkingDayCode> = {
  mon: 'lun',
  tue: 'mar',
  wed: 'mie',
  thu: 'jue',
  fri: 'vie',
  sat: 'sab',
  sun: 'dom',
};

type WorkingDayCode = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom';

function toPhoneDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

function phonesMatch(a: string, b: string): boolean {
  const aDigits = toPhoneDigits(a);
  const bDigits = toPhoneDigits(b);
  if (!aDigits || !bDigits) return false;
  if (aDigits === bDigits) return true;

  // Allow matching when one side is missing country code (common when users type local numbers in settings).
  // Guard with a minimum length to reduce accidental matches.
  const MIN_SUFFIX_MATCH_DIGITS = 8;
  if (aDigits.length < MIN_SUFFIX_MATCH_DIGITS || bDigits.length < MIN_SUFFIX_MATCH_DIGITS) {
    return false;
  }
  return aDigits.endsWith(bDigits) || bDigits.endsWith(aDigits);
}

function verifyOwnerPin(pin: string, storedHash: string): boolean {
  const cleaned = (storedHash || '').trim();
  const attempt = (pin || '').trim();
  if (!cleaned || !attempt) return false;

  // Back-compat: if someone stored a plain pin, allow it (avoid bricking existing setups).
  if (!cleaned.startsWith('scrypt$')) {
    return cleaned === attempt;
  }

  const parts = cleaned.split('$');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1] || '', 'base64');
  const hash = Buffer.from(parts[2] || '', 'base64');
  if (salt.length === 0 || hash.length === 0) return false;

  const computed = scryptSync(attempt, salt, hash.length);
  if (computed.length !== hash.length) return false;
  return timingSafeEqual(computed, hash);
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  if (!candidate) return fallback;
  return isValidTimeZone(candidate) ? candidate : fallback;
}

function normalizeWorkingDays(value: unknown, fallback: WorkingDayCode[]): WorkingDayCode[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const dedup = new Set<WorkingDayCode>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const code = item.trim().toLowerCase() as WorkingDayCode;
    if (VALID_WORKING_DAYS.has(code)) dedup.add(code);
  }

  return dedup.size > 0 ? Array.from(dedup) : [...fallback];
}

function normalizeTimeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  const parsed = parseTimeToMinutes(candidate);
  if (parsed == null) return fallback;
  return candidate;
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinTimeWindow(current: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function resolveLocalWorkingSnapshot(
  date: Date,
  timeZone: string
): { dayCode: WorkingDayCode | null; minutesOfDay: number | null } {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const weekdayToken = (map.get('weekday') || '').slice(0, 3).toLowerCase();
    const dayCode = WEEKDAY_EN_TO_WORKING_DAY[weekdayToken] || null;

    const rawHour = Number(map.get('hour'));
    const minute = Number(map.get('minute'));
    if (!Number.isFinite(rawHour) || !Number.isFinite(minute)) {
      return { dayCode, minutesOfDay: null };
    }

    const hour = rawHour === 24 ? 0 : rawHour;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { dayCode, minutesOfDay: null };
    }

    return { dayCode, minutesOfDay: hour * 60 + minute };
  } catch {
    return { dayCode: null, minutesOfDay: null };
  }
}

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

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstRecord(value: unknown): UnknownRecord | null {
  return asRecord(asArray(value)[0]);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asLowerTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function asUpperTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().trim() : '';
}

function unwrapNestedMessage(value: unknown): UnknownRecord | null {
  const root = asRecord(value);
  if (!root) return null;

  const ephemeral = asRecord(root.ephemeralMessage);
  const ephemeralMessage = asRecord(ephemeral?.message);
  if (ephemeralMessage) return ephemeralMessage;

  const viewOnce = asRecord(root.viewOnceMessage);
  const viewOnceMessage = asRecord(viewOnce?.message);
  if (viewOnceMessage) return viewOnceMessage;

  const viewOnceV2 = asRecord(root.viewOnceMessageV2);
  const viewOnceV2Message = asRecord(viewOnceV2?.message);
  if (viewOnceV2Message) return viewOnceV2Message;

  return root;
}

async function recordUsage(
  prisma: PrismaClient,
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
    const existing = await prisma.usageRecord.findFirst({
      where: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        periodStart: start,
        periodEnd: end,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await prisma.usageRecord.updateMany({
        where: { id: existing.id, workspaceId: params.workspaceId },
        data: { quantity: { increment: amount } },
      });
      return;
    }

    await prisma.usageRecord.create({
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
    logger.error({ error }, '[UsageRecord] Failed to record usage');
  }
}

export interface WorkerConfig {
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  anthropicApiKey: string;
  concurrency?: number;
}

interface AgentRuntimeSettings {
  coalesceEnabled: boolean;
  coalesceWindowMs: number;
  coalesceMaxMessages: number;
  coalesceJoiner: string;
  sessionLockEnabled: boolean;
  sessionLockTtlMs: number;
  sessionLockRetryMs: number;
  timezone: string;
  workingDays: WorkingDayCode[];
  continuousHours: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  morningShiftStart: string;
  morningShiftEnd: string;
  afternoonShiftStart: string;
  afternoonShiftEnd: string;
  ownerAgentEnabled: boolean;
  ownerAgentNumber: string;
  ownerAgentPinHash: string;
}

export class AgentWorker {
  private worker: Worker | null = null;
  private dlqQueue: Queue | null = null;
  private messageQueue: Queue<MessageSendPayload> | null = null;
  private agentQueue: Queue<AgentProcessPayload> | null = null;
  private audioTranscriptionQueue: Queue<AudioTranscriptionPayload> | null = null;
  private prisma: PrismaClient;
  private redis: InstanceType<typeof Redis>;
  private agent: RetailAgent;
  private memoryService: MemoryService;
  private config: WorkerConfig;
  private redisConnection: { host: string; port: number; password?: string };
  private settingsCache = new Map<string, { value: AgentRuntimeSettings; expiresAt: number }>();

  constructor(prisma: PrismaClient, config: WorkerConfig) {
    this.prisma = prisma;
    this.config = config;

    // Redis connection config (reused for BullMQ and memory)
    this.redisConnection = {
      host: config.redisHost,
      port: config.redisPort,
    };
    if (config.redisPassword) {
      this.redisConnection.password = config.redisPassword;
    }

    this.messageQueue = new Queue(QUEUES.MESSAGE_SEND.name, {
      connection: this.redisConnection,
    });
    this.agentQueue = new Queue(QUEUES.AGENT_PROCESS.name, {
      connection: this.redisConnection,
    });
    this.audioTranscriptionQueue = new Queue(QUEUES.AUDIO_TRANSCRIPTION.name, {
      connection: this.redisConnection,
    });

    // Create Redis connection for memory manager
    this.redis = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword || undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
    });

    // Create agent
    this.agent = createRetailAgent(this.prisma, this.redis, {
      anthropicApiKey: config.anthropicApiKey,
    }, {
      catalogDeps: this.messageQueue
        ? { messageQueue: this.messageQueue, fileUploader: new LocalFileUploader() }
        : undefined,
      audioDeps: this.audioTranscriptionQueue
        ? { queue: this.audioTranscriptionQueue }
        : undefined,
    });

    const memoryAnthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.memoryService = new MemoryService(this.prisma, memoryAnthropic);
  }

  /**
   * Start the worker
   */
  start(): void {
    // Initialize agent
    this.agent.initialize();

    // Create DLQ queue for exhausted jobs
    this.dlqQueue = new Queue(QUEUES.DLQ.name, {
      connection: this.redisConnection,
    });

    // Create worker
    this.worker = new Worker(
      QUEUES.AGENT_PROCESS.name,
      async (job: Job<AgentProcessPayload>) => {
        return this.processJob(job);
      },
      {
        connection: this.redisConnection,
        concurrency: this.config.concurrency || 5,
        limiter: {
          max: 10,
          duration: 1000, // 10 jobs per second max
        },
      }
    );

    // Event handlers
    this.worker.on('completed', (job) => {
      logger.info(`[AgentWorker] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, error) => {
      logger.error(
        {
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          maxAttempts: QUEUES.AGENT_PROCESS.attempts,
          errorMessage: error.message,
        },
        '[AgentWorker] Job failed'
      );

      // Check if job exhausted all attempts
      if (job && job.attemptsMade >= QUEUES.AGENT_PROCESS.attempts) {
        const typedJob = job as Job<AgentProcessPayload>;
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        void this.handleExhaustedJob(typedJob, normalizedError);
      }
    });

    this.worker.on('error', (error) => {
      logger.error({ error }, '[AgentWorker] Worker error');
    });

    logger.info('[AgentWorker] Started with DLQ support');
  }

  /**
   * Handle a job that has exhausted all retry attempts
   * - Move to DLQ
   * - Trigger handoff for the session
   */
  private async handleExhaustedJob(job: Job<AgentProcessPayload>, error: Error): Promise<void> {
    const { workspaceId, correlationId, channelId } = job.data;

    logger.info(`[AgentWorker] Job ${job.id} exhausted, moving to DLQ and triggering handoff`);

    try {
      await runWithContext(
        {
          userId: 'system',
          workspaceId,
          permissions: [],
          isSuperAdmin: false,
          requestId: correlationId || String(job.id ?? 'agent-worker'),
        },
        async () => {
          // 1. Move to DLQ
          if (this.dlqQueue) {
            await this.dlqQueue.add(`dlq-${job.id}`, {
              originalJob: job.data,
              error: error.message,
              failedAt: new Date().toISOString(),
              attempts: job.attemptsMade,
            });
          }

          // 2. Update WebhookInbox status
          await this.prisma.webhookInbox.updateMany({
            where: { correlationId, workspaceId },
            data: {
              status: 'dlq',
              errorMessage: `Exhausted after ${job.attemptsMade} attempts: ${error.message}`,
            },
          });

          // 3. Find session and trigger handoff
          const session = await this.prisma.agentSession.findFirst({
            where: {
              workspaceId,
              channelId,
              endedAt: null,
            },
          });

          if (session) {
            await this.prisma.agentSession.updateMany({
              where: { id: session.id, workspaceId },
              data: {
                agentActive: false,
                lastFailure: 'processing_failure',
                currentState: 'HANDOFF',
                failureCount: { increment: 1 },
              },
            });

            logger.info(`[AgentWorker] Session ${session.id} marked for handoff due to processing failure`);

            // Log audit entry
            await this.prisma.auditLog.create({
              data: {
                workspaceId,
                action: 'agent.handoff_triggered',
                resourceType: 'session',
                resourceId: session.id,
                actorType: 'system',
                actorId: 'agent-worker',
                status: 'success',
                metadata: {
                  reason: 'processing_failure',
                  error: error.message,
                  attempts: job.attemptsMade,
                  correlationId,
                },
              },
            });
          }
        }
      );
    } catch (dlqError) {
      logger.error({ error: dlqError }, '[AgentWorker] Failed to handle exhausted job');
    }
  }

  /**
   * Process a job
   */
  private async processJob(job: Job<AgentProcessPayload>): Promise<unknown> {
    const { workspaceId, messageId, channelId, channelType, correlationId } = job.data;

    logger.info(`[AgentWorker] Processing message ${messageId} for workspace ${workspaceId} (attempt ${job.attemptsMade + 1})`);

    try {
      return await runWithContext(
        {
          userId: 'system',
          workspaceId,
          permissions: [],
          isSuperAdmin: false,
          requestId: correlationId || String(job.id ?? 'agent-worker'),
        },
        async () => {
          let runtimeSettings = await this.getWorkspaceRuntimeSettings(workspaceId);

          // Get the message from webhook inbox (allow retrying failed messages)
          const webhookMessage = await this.prisma.webhookInbox.findFirst({
            where: {
              workspaceId,
              correlationId,
              status: { in: ['pending', 'failed'] },
            },
          });

          if (!webhookMessage) {
            logger.warn(`[AgentWorker] Webhook message not found or already processed: ${correlationId}`);
            return { status: 'skipped', reason: 'message_not_found' };
          }

          // Parse message content from payload
          const payload: unknown = webhookMessage.payload;
          const messageContent = this.extractMessageContent(payload);

          if (!messageContent) {
            if (this.isAwaitingAudioTranscription(payload)) {
              logger.info(
                `[AgentWorker] Audio message ${webhookMessage.externalId} awaiting transcription, skipping`
              );
              await this.prisma.webhookInbox.updateMany({
                where: { id: webhookMessage.id, workspaceId },
                data: {
                  status: 'pending',
                  errorMessage: null,
                },
              });
              return { status: 'skipped', reason: 'awaiting_audio_transcription' };
            }
            logger.warn(`[AgentWorker] Could not extract message content from payload`);
            await this.prisma.webhookInbox.updateMany({
              where: { id: webhookMessage.id, workspaceId },
              data: {
                status: 'failed',
                errorMessage: 'Could not extract message content',
              },
            });
            return { status: 'failed', reason: 'no_content' };
          }

          // Sender and session lookup
          const rawSenderPhone = channelId || this.extractSenderPhone(payload);
          const normalizedSenderPhone = channelType === 'whatsapp'
            ? this.normalizePhone(rawSenderPhone)
            : rawSenderPhone;
          const ownerDigits = toPhoneDigits(runtimeSettings.ownerAgentNumber);
          const senderDigits = toPhoneDigits(normalizedSenderPhone);
          const isOwner =
            (channelType || 'whatsapp') === 'whatsapp' &&
            runtimeSettings.ownerAgentEnabled &&
            ownerDigits.length > 0 &&
            senderDigits.length > 0 &&
            phonesMatch(senderDigits, ownerDigits);

          const lockKey = this.buildSessionLockKey(workspaceId, normalizedSenderPhone, channelType || 'whatsapp');
          const lockToken = runtimeSettings.sessionLockEnabled
            ? await this.acquireSessionLock(lockKey, runtimeSettings.sessionLockTtlMs)
            : null;

          if (runtimeSettings.sessionLockEnabled && !lockToken) {
            await this.requeueJob(job.data, runtimeSettings.sessionLockRetryMs);
            return { status: 'requeued', reason: 'session_locked' };
          }

          let batchIds: string[] = [];

          try {
            let batchWebhooks: Array<{ webhook: typeof webhookMessage; content: string }> = [];

          // Mark primary webhook as processing
          await this.prisma.webhookInbox.updateMany({
            where: { id: webhookMessage.id, workspaceId },
            data: {
              status: 'processing',
              lastAttemptAt: new Date(),
              retryCount: webhookMessage.retryCount + 1,
            },
          });
          batchIds = [webhookMessage.id];

          const isWhatsAppChannel = (channelType || 'whatsapp') === 'whatsapp';
          const effectiveCoalesceWindowMs =
            !isOwner && isWhatsAppChannel
              ? Math.max(3500, runtimeSettings.coalesceWindowMs)
              : runtimeSettings.coalesceWindowMs;
          const shouldCoalesce =
            isWhatsAppChannel && (runtimeSettings.coalesceEnabled || !isOwner) && effectiveCoalesceWindowMs > 0;

          if (shouldCoalesce) {
            // Sleep slightly longer than the query window (windowMs + 500)
            // so we don't query before late-arriving messages in the same burst.
            await this.sleep(effectiveCoalesceWindowMs + 550);
          }

          batchWebhooks = await this.collectBatchWebhooks({
            workspaceId,
            primary: webhookMessage,
            primaryContent: messageContent,
            senderPhone: normalizedSenderPhone,
            channelType: channelType || 'whatsapp',
            provider: webhookMessage.provider || 'infobip',
            maxMessages: runtimeSettings.coalesceMaxMessages,
            windowMs: shouldCoalesce ? effectiveCoalesceWindowMs : 0,
          });
          batchIds = batchWebhooks.map((b) => b.webhook.id);

          const customerId = await this.agent.getOrCreateCustomer(
            workspaceId,
            rawSenderPhone,
            isOwner
              ? {
                  silent: true,
                  deletedAt: new Date(),
                  metadata: { internalActor: 'owner_agent' },
                }
              : undefined
          );

          // Get or create session
          const sessionId = await this.agent.getOrCreateSession(
            workspaceId,
            customerId,
            rawSenderPhone,
            channelType || 'whatsapp'
          );

          const sortedBatch = batchWebhooks.length > 0
            ? [...batchWebhooks].sort((a, b) => a.webhook.createdAt.getTime() - b.webhook.createdAt.getTime())
            : [{ webhook: webhookMessage, content: messageContent }];
          const batchMessageId = sortedBatch[sortedBatch.length - 1]?.webhook.externalId || messageId;
          batchIds = sortedBatch.map((b) => b.webhook.id);

          if (sortedBatch.length > 1) {
            await recordUsage(this.prisma, {
              workspaceId,
              metric: 'messages.coalesced',
              quantity: sortedBatch.length,
              metadata: { channelType: channelType || 'whatsapp' },
            });
            if (isOwner) {
              await recordUsage(this.prisma, {
                workspaceId,
                metric: 'owner_agent.messages.coalesced',
                quantity: sortedBatch.length,
                metadata: { channelType: channelType || 'whatsapp' },
              });
            }
          }

          for (const batch of sortedBatch) {
            if ((batch.webhook.retryCount ?? 0) === 0) {
              await recordUsage(this.prisma, {
                workspaceId,
                metric: 'messages.inbound',
                quantity: 1,
                metadata: { channelType: channelType || 'whatsapp' },
              });
              if (isOwner) {
                await recordUsage(this.prisma, {
                  workspaceId,
                  metric: 'owner_agent.messages.inbound',
                  quantity: 1,
                  metadata: { channelType: channelType || 'whatsapp' },
                });
              }
            }
            await this.storeInboundMessage(sessionId, batch.content, batch.webhook.externalId);
          }

          // Check if agent is active for this session
          const session = await this.prisma.agentSession.findFirst({
            where: { id: sessionId, workspaceId },
          });

          if (!session?.agentActive && !isOwner) {
            logger.info(`[AgentWorker] Agent not active for session ${sessionId}, skipping`);
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { lastActivityAt: new Date() },
            });
            await this.prisma.webhookInbox.updateMany({
              where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
              data: {
                status: 'completed',
                processedAt: new Date(),
                result: { status: 'skipped', reason: 'agent_inactive' },
              },
            });
            return { status: 'skipped', reason: 'agent_inactive' };
          }

          if (!session?.agentActive && isOwner) {
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { agentActive: true, lastActivityAt: new Date() },
            });
          }

          // Check if session has too many consecutive failures - trigger handoff
          if (session && session.failureCount >= MAX_FAILURES_BEFORE_HANDOFF && !isOwner) {
            logger.info(`[AgentWorker] Session ${sessionId} exceeded failure threshold, triggering handoff`);
            await this.triggerHandoff(session.id, workspaceId, 'consecutive_failures', correlationId);
            await this.prisma.webhookInbox.updateMany({
              where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
              data: {
                status: 'completed',
                processedAt: new Date(),
                result: { status: 'handoff', reason: 'consecutive_failures' },
              },
            });
            return { status: 'handoff', reason: 'consecutive_failures' };
          }

          if (!isOwner && !this.isWithinBusinessHours(runtimeSettings, new Date())) {
            // Re-read settings once (without cache) to avoid stale cache false negatives
            // right after users update business schedule from dashboard.
            runtimeSettings = await this.getWorkspaceRuntimeSettings(workspaceId, true);
          }

          if (!isOwner && !this.isWithinBusinessHours(runtimeSettings, new Date())) {
            logger.info(
              `[AgentWorker] Outside working hours for workspace ${workspaceId} ` +
              `(tz=${runtimeSettings.timezone}, continuous=${runtimeSettings.continuousHours}, ` +
              `days=${runtimeSettings.workingDays.join(',')}, ` +
              `hours=${runtimeSettings.workingHoursStart}-${runtimeSettings.workingHoursEnd}, ` +
              `morning=${runtimeSettings.morningShiftStart}-${runtimeSettings.morningShiftEnd}, ` +
              `afternoon=${runtimeSettings.afternoonShiftStart}-${runtimeSettings.afternoonShiftEnd})`
            );
            await this.storeAssistantMessage(
              sessionId,
              OFF_HOURS_AUTO_REPLY,
              `${correlationId}:outside_hours`
            );
            await this.sendWhatsAppMessage(
              workspaceId,
              normalizedSenderPhone,
              OFF_HOURS_AUTO_REPLY,
              correlationId,
              sessionId
            );
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { lastActivityAt: new Date() },
            });
            await this.prisma.webhookInbox.updateMany({
              where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
              data: {
                status: 'completed',
                processedAt: new Date(),
                result: { status: 'completed', reason: 'outside_working_hours' },
              },
            });
            return { status: 'completed', reason: 'outside_working_hours' };
          }

          const stickerOnlyBatch =
            !isOwner &&
            sortedBatch.length > 0 &&
            sortedBatch.every((entry) => this.isStickerPlaceholder(entry.content));

          if (stickerOnlyBatch) {
            const stickerReply = '🙂';
            await this.storeAssistantMessage(
              sessionId,
              stickerReply,
              `${correlationId}:sticker_auto_reply`
            );
            await this.sendWhatsAppMessage(
              workspaceId,
              normalizedSenderPhone,
              stickerReply,
              correlationId,
              sessionId
            );
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { lastActivityAt: new Date() },
            });
            await this.prisma.webhookInbox.updateMany({
              where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
              data: {
                status: 'completed',
                processedAt: new Date(),
                result: { status: 'completed', reason: 'sticker_auto_reply', batchSize: sortedBatch.length },
              },
            });
            return { status: 'completed', reason: 'sticker_auto_reply' };
          }

          let combinedMessage = this.buildCoalescedMessage(sortedBatch, runtimeSettings.coalesceJoiner);
          if (!isOwner && isWhatsAppChannel) {
            combinedMessage = await this.resolveInteractiveReplyInput(
              workspaceId,
              normalizedSenderPhone,
              combinedMessage
            );
          }

          if (isOwner && runtimeSettings.ownerAgentPinHash.trim()) {
            const authKey = this.buildOwnerAuthKey(workspaceId, senderDigits);
            const unlocked = await this.redis.get(authKey);
            if (!unlocked) {
              const split = (() => {
                const normalized = combinedMessage.trim();
                if (!normalized) return null;
                const re = /(?:^|\b)(pin|clave)\s*[:-]?\s*(\d{4,12})\b/i;
                const match = normalized.match(re);
                if (!match) {
                  // Convenience: allow sending the PIN as a bare numeric message (e.g. "4444").
                  // Only applies in owner-mode auth gate.
                  if (/^\d{4,12}$/.test(normalized)) {
                    return { pin: normalized, remainder: '' };
                  }
                  return null;
                }
                if (!match || match.index == null) return null;
                const pin = match[2] || '';
                const remainder = (normalized.slice(0, match.index) + normalized.slice(match.index + match[0].length)).trim();
                return { pin, remainder };
              })();

              if (!split) {
                const response =
                  'Para acceder como dueño, enviá tu PIN así: PIN 1234 (reemplazá 1234 por tu PIN). ' +
                  'Si no lo recordás, podés cambiarlo en Configuración -> Mi negocio.';
                await this.storeAssistantMessage(sessionId, response, `${correlationId}:owner_pin_required`);
                await this.sendWhatsAppMessage(workspaceId, normalizedSenderPhone, response, correlationId, sessionId);
                await recordUsage(this.prisma, {
                  workspaceId,
                  metric: 'owner_agent.messages.outbound',
                  quantity: 1,
                  metadata: { channelType: 'whatsapp', messageType: 'text' },
                });
                await recordUsage(this.prisma, {
                  workspaceId,
                  metric: 'owner_agent.auth.required',
                  quantity: 1,
                  metadata: { channelType: 'whatsapp' },
                });
                await this.prisma.agentSession.updateMany({
                  where: { id: sessionId, workspaceId },
                  data: { currentState: 'IDLE', lastActivityAt: new Date(), agentActive: true },
                });
                await this.prisma.webhookInbox.updateMany({
                  where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
                  data: {
                    status: 'completed',
                    processedAt: new Date(),
                    result: { status: 'completed', reason: 'owner_pin_required' },
                  },
                });
                return { status: 'completed', reason: 'owner_pin_required' };
              }

              const ok = verifyOwnerPin(split.pin, runtimeSettings.ownerAgentPinHash);
              if (!ok) {
                const response = 'PIN incorrecto. Enviá: PIN 1234 (reemplazá 1234 por tu PIN).';
                await this.storeAssistantMessage(sessionId, response, `${correlationId}:owner_pin_invalid`);
                await this.sendWhatsAppMessage(workspaceId, normalizedSenderPhone, response, correlationId, sessionId);
                await recordUsage(this.prisma, {
                  workspaceId,
                  metric: 'owner_agent.messages.outbound',
                  quantity: 1,
                  metadata: { channelType: 'whatsapp', messageType: 'text' },
                });
                await recordUsage(this.prisma, {
                  workspaceId,
                  metric: 'owner_agent.auth.failed',
                  quantity: 1,
                  metadata: { channelType: 'whatsapp' },
                });
                await this.prisma.agentSession.updateMany({
                  where: { id: sessionId, workspaceId },
                  data: { currentState: 'IDLE', lastActivityAt: new Date(), agentActive: true },
                });
                await this.prisma.webhookInbox.updateMany({
                  where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
                  data: {
                    status: 'completed',
                    processedAt: new Date(),
                    result: { status: 'completed', reason: 'owner_pin_invalid' },
                  },
                });
                return { status: 'completed', reason: 'owner_pin_invalid' };
              }

              await this.redis.set(authKey, '1', 'EX', Math.max(60, OWNER_AGENT_AUTH_TTL_SECONDS));
              await recordUsage(this.prisma, {
                workspaceId,
                metric: 'owner_agent.auth.success',
                quantity: 1,
                metadata: { channelType: 'whatsapp' },
              });

              if (!split.remainder) {
                const response = 'Listo, ya estás autenticado como dueño. ¿Qué querés consultar?';
                await this.storeAssistantMessage(sessionId, response, `${correlationId}:owner_pin_ok`);
                await this.sendWhatsAppMessage(workspaceId, normalizedSenderPhone, response, correlationId, sessionId);
                await recordUsage(this.prisma, {
                  workspaceId,
                  metric: 'owner_agent.messages.outbound',
                  quantity: 1,
                  metadata: { channelType: 'whatsapp', messageType: 'text' },
                });
                await this.prisma.agentSession.updateMany({
                  where: { id: sessionId, workspaceId },
                  data: { currentState: 'IDLE', lastActivityAt: new Date(), agentActive: true },
                });
                await this.prisma.webhookInbox.updateMany({
                  where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
                  data: {
                    status: 'completed',
                    processedAt: new Date(),
                    result: { status: 'completed', reason: 'owner_pin_ok' },
                  },
                });
                return { status: 'completed', reason: 'owner_pin_ok' };
              }

              combinedMessage = split.remainder;
            }
          }

          const result = await this.agent.processMessage({
            workspaceId,
            sessionId,
            customerId,
            channelId: normalizedSenderPhone,
            channelType: channelType || 'whatsapp',
            message: combinedMessage,
            messageId: batchMessageId,
            correlationId,
            isOwner,
          });

          await recordUsage(this.prisma, {
            workspaceId,
            metric: 'agent.invocations',
            quantity: 1,
            metadata: { channelType: channelType || 'whatsapp' },
          });
          if (isOwner) {
            await recordUsage(this.prisma, {
              workspaceId,
              metric: 'owner_agent.invocations',
              quantity: 1,
              metadata: { channelType: channelType || 'whatsapp' },
            });
          }

          if (result.tokensUsed > 0) {
            await recordUsage(this.prisma, {
              workspaceId,
              metric: 'llm.tokens',
              quantity: result.tokensUsed,
              metadata: { channelType: channelType || 'whatsapp' },
            });
            if (isOwner) {
              await recordUsage(this.prisma, {
                workspaceId,
                metric: 'owner_agent.llm.tokens',
                quantity: result.tokensUsed,
                metadata: { channelType: channelType || 'whatsapp' },
              });
            }
          }

          void this.memoryService.updateFromTurn({ sessionId, workspaceId })
            .catch((error) => {
              logger.error({ error }, '[AgentWorker] Memory update failed');
            });

          // Success! Reset failure count
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { failureCount: 0 },
          });

          // Send response if needed
          if (result.shouldSendMessage && result.response) {
            if (
              result.responseType === 'interactive-buttons' &&
              result.responsePayload &&
              'buttons' in result.responsePayload
            ) {
              const responseText = result.response?.trim() || '';
              const payloadBody =
                typeof result.responsePayload.body === 'string'
                  ? result.responsePayload.body.trim()
                  : '';
              const bodyMatches = responseText && payloadBody && responseText === payloadBody;
              const shouldPreface =
                !bodyMatches &&
                (responseText.includes('🛒') ||
                  responseText.includes('Tu pedido actual') ||
                  responseText.includes('Total:'));
              if (shouldPreface) {
                await this.sendWhatsAppMessage(
                  workspaceId,
                  normalizedSenderPhone,
                  result.response,
                  correlationId,
                  sessionId
                );
              }

              await this.sendWhatsAppInteractiveButtons(
                workspaceId,
                normalizedSenderPhone,
                result.responsePayload,
                result.response,
                correlationId,
                sessionId
              );
            } else if (
              result.responseType === 'interactive-list' &&
              result.responsePayload &&
              'buttonText' in result.responsePayload
            ) {
              await this.sendWhatsAppInteractiveList(
                workspaceId,
                normalizedSenderPhone,
                result.responsePayload,
                result.response,
                correlationId,
                sessionId
              );
            } else {
              await this.sendWhatsAppMessage(workspaceId, normalizedSenderPhone, result.response, correlationId, sessionId);
            }
          }

          // Mark webhook batch as completed
          await this.prisma.webhookInbox.updateMany({
            where: { id: { in: sortedBatch.map((b) => b.webhook.id) }, workspaceId },
            data: {
              status: 'completed',
              processedAt: new Date(),
              result: {
                sessionId,
                state: result.state,
                toolsUsed: result.toolsUsed.length,
                tokens: result.tokensUsed,
                batchSize: sortedBatch.length,
              },
            },
          });

          return {
            status: 'completed',
            sessionId,
            response: result.response,
            state: result.state,
          };
        } catch (error) {
          if (batchIds.length > 0) {
            await this.prisma.webhookInbox.updateMany({
              where: { id: { in: batchIds }, workspaceId },
              data: {
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
          throw error;
        } finally {
          if (lockToken) {
            await this.releaseSessionLock(lockKey, lockToken);
          }
        }
        }
      );
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Error processing job');

      // Increment session failure count
      const normalizedChannelId = (channelType || 'whatsapp') === 'whatsapp'
        ? this.normalizePhone(channelId)
        : channelId;
      await this.incrementSessionFailureCount(workspaceId, normalizedChannelId, correlationId);

      // Mark webhook as failed (will be retried by BullMQ)
      await this.prisma.webhookInbox.updateMany({
        where: { correlationId, status: 'processing', workspaceId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }

  /**
   * Increment failure count for session and check if handoff needed
   */
  private async incrementSessionFailureCount(
    workspaceId: string,
    channelId: string,
    correlationId: string
  ): Promise<void> {
    try {
      const session = await this.prisma.agentSession.findFirst({
        where: {
          workspaceId,
          channelId,
          endedAt: null,
        },
      });

      if (session) {
        const newFailureCount = session.failureCount + 1;

        await this.prisma.agentSession.updateMany({
          where: { id: session.id, workspaceId },
          data: { failureCount: newFailureCount },
        });

        // If reached threshold, trigger handoff
        if (newFailureCount >= MAX_FAILURES_BEFORE_HANDOFF) {
          logger.info(`[AgentWorker] Session ${session.id} reached ${newFailureCount} failures, triggering handoff`);
          await this.triggerHandoff(session.id, workspaceId, 'consecutive_failures', correlationId);
        }
      }
    } catch (err) {
      logger.error({ error: err }, '[AgentWorker] Failed to increment failure count');
    }
  }

  /**
   * Trigger handoff for a session
   */
  private async triggerHandoff(
    sessionId: string,
    workspaceId: string,
    reason: string,
    correlationId: string
  ): Promise<void> {
    await this.prisma.agentSession.updateMany({
      where: { id: sessionId, workspaceId },
      data: {
        agentActive: false,
        lastFailure: reason,
        currentState: 'HANDOFF',
      },
    });

    // Log audit entry
    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        action: 'agent.handoff_triggered',
        resourceType: 'session',
        resourceId: sessionId,
        actorType: 'system',
        actorId: 'agent-worker',
        status: 'success',
        metadata: {
          reason,
          correlationId,
        },
      },
    });

    logger.info(`[AgentWorker] Handoff triggered for session ${sessionId}: ${reason}`);
  }

  private async storeInboundMessage(
    sessionId: string,
    content: string,
    externalId?: string
  ): Promise<void> {
    if (!content) return;

    if (externalId) {
      const existing = await this.prisma.agentMessage.findFirst({
        where: { sessionId, externalId },
        select: { id: true },
      });
      if (existing) return;
    }

    await this.prisma.agentMessage.create({
      data: {
        sessionId,
        role: 'user',
        content,
        externalId: externalId ?? null,
      },
    });
  }

  private async storeAssistantMessage(
    sessionId: string,
    content: string,
    externalId?: string
  ): Promise<void> {
    if (!content) return;

    if (externalId) {
      const existing = await this.prisma.agentMessage.findFirst({
        where: { sessionId, externalId },
        select: { id: true },
      });
      if (existing) return;
    }

    await this.prisma.agentMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content,
        externalId: externalId ?? null,
      },
    });
  }

  private buildOwnerAuthKey(workspaceId: string, senderDigits: string): string {
    return `owner:auth:${workspaceId}:${senderDigits}`;
  }

  private extractOwnerPin(message: string): string | null {
    const normalized = (message || '').trim();
    if (!normalized) return null;
    const match = normalized.match(/(?:^|\b)(pin|clave)\s*[:-]?\s*(\d{4,12})\b/i);
    return match?.[2] || null;
  }

  private buildSessionLockKey(workspaceId: string, channelId: string, channelType: string): string {
    return `agent:lock:${workspaceId}:${channelType}:${channelId}`;
  }

  private buildInteractiveReplyKey(workspaceId: string, phone: string): string {
    return `agent:interactive:${workspaceId}:${this.normalizePhone(phone)}`;
  }

  private async storeInteractiveReplyMap(
    workspaceId: string,
    phone: string,
    options: Array<{ id: string; title: string }>
  ): Promise<void> {
    if (!options.length) return;
    const payload = options
      .map((option, index) => ({
        index: index + 1,
        id: (option.id || '').trim(),
        title: (option.title || '').trim(),
      }))
      .filter((option) => option.id || option.title);
    if (!payload.length) return;

    const key = this.buildInteractiveReplyKey(workspaceId, phone);
    try {
      await this.redis.set(
        key,
        JSON.stringify({ options: payload }),
        'EX',
        Math.max(60, DEFAULT_INTERACTIVE_REPLY_TTL_SECONDS)
      );
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to store interactive reply map');
    }
  }

  private async resolveInteractiveReplyInput(
    workspaceId: string,
    phone: string,
    text: string
  ): Promise<string> {
    const normalized = (text || '').trim();
    if (!normalized) return text;
    if (!/^\d{1,2}$/.test(normalized)) return text;

    const selectedIndex = Number.parseInt(normalized, 10);
    if (!Number.isFinite(selectedIndex) || selectedIndex < 1) return text;

    const key = this.buildInteractiveReplyKey(workspaceId, phone);
    try {
      const raw = await this.redis.get(key);
      if (!raw) return text;
      const parsed = JSON.parse(raw) as {
        options?: Array<{ index: number; id?: string; title?: string }>;
      };
      const options = Array.isArray(parsed?.options) ? parsed.options : [];
      const selected = options.find((option) => option.index === selectedIndex);
      if (!selected) return text;

      await this.redis.del(key);
      const mapped = (selected.id || selected.title || '').trim();
      return mapped || text;
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to resolve interactive numeric reply');
      return text;
    }
  }

  private async acquireSessionLock(lockKey: string, ttlMs: number): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    return result ? token : null;
  }

  private async releaseSessionLock(lockKey: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(script, 1, lockKey, token);
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to release session lock');
    }
  }

  private async requeueJob(payload: AgentProcessPayload, delayMs: number): Promise<void> {
    if (!this.agentQueue) return;
    const jobId = `requeue-${payload.correlationId || 'no-corr'}-${Date.now()}`;
    await this.agentQueue.add(jobId, payload, {
      delay: Math.max(0, delayMs),
      attempts: QUEUES.AGENT_PROCESS.attempts,
      backoff: QUEUES.AGENT_PROCESS.backoff,
    });
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async getWorkspaceRuntimeSettings(
    workspaceId: string,
    forceRefresh = false
  ): Promise<AgentRuntimeSettings> {
    const cached = this.settingsCache.get(workspaceId);
    const now = Date.now();
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.value;
    }

    const base: AgentRuntimeSettings = {
      coalesceEnabled: DEFAULT_COALESCE_ENABLED,
      coalesceWindowMs: DEFAULT_COALESCE_WINDOW_MS,
      coalesceMaxMessages: DEFAULT_COALESCE_MAX_MESSAGES,
      coalesceJoiner: DEFAULT_COALESCE_JOINER,
      sessionLockEnabled: DEFAULT_SESSION_LOCK_ENABLED,
      sessionLockTtlMs: DEFAULT_SESSION_LOCK_TTL_MS,
      sessionLockRetryMs: DEFAULT_SESSION_LOCK_RETRY_MS,
      timezone: DEFAULT_TIMEZONE,
      workingDays: [...DEFAULT_WORKING_DAYS],
      continuousHours: true,
      workingHoursStart: '09:00',
      workingHoursEnd: '18:00',
      morningShiftStart: '09:00',
      morningShiftEnd: '13:00',
      afternoonShiftStart: '14:00',
      afternoonShiftEnd: '18:00',
      ownerAgentEnabled: false,
      ownerAgentNumber: '',
      ownerAgentPinHash: '',
    };

    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true, plan: true },
      });
      const settings = (workspace?.settings as Record<string, unknown>) || {};
      const plan = resolveCommercePlan({
        workspacePlan: workspace?.plan,
        settingsPlan: settings.commercePlan,
        fallback: 'pro',
      });
      const planCapabilities = getCommercePlanCapabilities(plan);

      const parseBool = (value: unknown, fallback: boolean): boolean => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          if (['true', '1', 'yes', 'si', 'on'].includes(normalized)) return true;
          if (['false', '0', 'no', 'off'].includes(normalized)) return false;
        }
        return fallback;
      };
      const parseNumber = (value: unknown, fallback: number): number => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : fallback;
        }
        return fallback;
      };
      const parseString = (value: unknown, fallback: string): string => {
        return typeof value === 'string' && value.trim() ? value : fallback;
      };

      const coalesceEnabled = parseBool(settings.agentCoalesceEnabled, base.coalesceEnabled);
      let coalesceWindowMs = parseNumber(settings.agentCoalesceWindowMs, base.coalesceWindowMs);
      if (coalesceEnabled && coalesceWindowMs <= 0) {
        coalesceWindowMs = base.coalesceWindowMs;
      }
      coalesceWindowMs = Math.max(0, coalesceWindowMs);

      const resolved: AgentRuntimeSettings = {
        coalesceEnabled,
        coalesceWindowMs,
        coalesceMaxMessages: parseNumber(settings.agentCoalesceMaxMessages, base.coalesceMaxMessages),
        coalesceJoiner: parseString(settings.agentCoalesceJoiner, base.coalesceJoiner),
        sessionLockEnabled: parseBool(settings.agentSessionLockEnabled, base.sessionLockEnabled),
        sessionLockTtlMs: parseNumber(settings.agentSessionLockTtlMs, base.sessionLockTtlMs),
        sessionLockRetryMs: parseNumber(settings.agentSessionLockRetryMs, base.sessionLockRetryMs),
        timezone: normalizeTimeZone(settings.timezone, base.timezone),
        workingDays: normalizeWorkingDays(settings.workingDays, base.workingDays),
        continuousHours: parseBool(settings.continuousHours, base.continuousHours),
        workingHoursStart: normalizeTimeString(settings.workingHoursStart, base.workingHoursStart),
        workingHoursEnd: normalizeTimeString(settings.workingHoursEnd, base.workingHoursEnd),
        morningShiftStart: normalizeTimeString(settings.morningShiftStart, base.morningShiftStart),
        morningShiftEnd: normalizeTimeString(settings.morningShiftEnd, base.morningShiftEnd),
        afternoonShiftStart: normalizeTimeString(settings.afternoonShiftStart, base.afternoonShiftStart),
        afternoonShiftEnd: normalizeTimeString(settings.afternoonShiftEnd, base.afternoonShiftEnd),
        ownerAgentEnabled:
          planCapabilities.showOwnerWhatsappAgentSettings &&
          parseBool(settings.ownerAgentEnabled, base.ownerAgentEnabled),
        ownerAgentNumber: parseString(settings.ownerAgentNumber, base.ownerAgentNumber),
        ownerAgentPinHash: parseString(settings.ownerAgentPinHash, base.ownerAgentPinHash),
      };

      this.settingsCache.set(workspaceId, {
        value: resolved,
        expiresAt: now + SETTINGS_CACHE_TTL_MS,
      });
      return resolved;
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to load workspace settings');
    }

    this.settingsCache.set(workspaceId, {
      value: base,
      expiresAt: now + SETTINGS_CACHE_TTL_MS,
    });
    return base;
  }

  private isWithinBusinessHours(settings: AgentRuntimeSettings, now: Date): boolean {
    const local = resolveLocalWorkingSnapshot(now, settings.timezone);
    if (!local.dayCode || local.minutesOfDay == null) {
      // Fail-open if timezone parsing fails; better to answer than silently block.
      return true;
    }

    if (settings.workingDays.length > 0 && !settings.workingDays.includes(local.dayCode)) {
      return false;
    }

    if (settings.continuousHours) {
      const start = parseTimeToMinutes(settings.workingHoursStart);
      const end = parseTimeToMinutes(settings.workingHoursEnd);
      if (start == null || end == null) return true;
      return isWithinTimeWindow(local.minutesOfDay, start, end);
    }

    const morningStart = parseTimeToMinutes(settings.morningShiftStart);
    const morningEnd = parseTimeToMinutes(settings.morningShiftEnd);
    const afternoonStart = parseTimeToMinutes(settings.afternoonShiftStart);
    const afternoonEnd = parseTimeToMinutes(settings.afternoonShiftEnd);

    const hasMorning = morningStart != null && morningEnd != null;
    const hasAfternoon = afternoonStart != null && afternoonEnd != null;

    if (!hasMorning && !hasAfternoon) {
      return true;
    }

    const inMorning =
      hasMorning && isWithinTimeWindow(local.minutesOfDay, morningStart, morningEnd);
    const inAfternoon =
      hasAfternoon && isWithinTimeWindow(local.minutesOfDay, afternoonStart, afternoonEnd);

    return inMorning || inAfternoon;
  }

  private async collectBatchWebhooks(params: {
    workspaceId: string;
    primary: WebhookInbox;
    primaryContent: string;
    senderPhone: string;
    channelType: string;
    provider: string;
    maxMessages: number;
    windowMs: number;
  }): Promise<Array<{ webhook: WebhookInbox; content: string }>> {
    const entries: Array<{ webhook: WebhookInbox; content: string }> = [
      { webhook: params.primary, content: params.primaryContent },
    ];

    if (params.maxMessages <= 1) return entries;
    if (params.channelType !== 'whatsapp') return entries;
    if (params.windowMs <= 0) return entries;

    const windowStart = params.primary.createdAt;
    const windowEnd = new Date(windowStart.getTime() + params.windowMs + 500);

    // We can't index/filter by senderPhone at DB level (it's inside JSON payload),
    // so fetch more candidates and then filter in-memory to avoid missing the right sender.
    const candidateLimit = Math.min(50, Math.max(25, params.maxMessages * 10));
    const candidates = await this.prisma.webhookInbox.findMany({
      where: {
        workspaceId: params.workspaceId,
        provider: params.provider,
        eventType: 'message.received',
        status: { in: ['pending', 'failed'] },
        id: { not: params.primary.id },
        createdAt: {
          gte: windowStart,
          lte: windowEnd,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: candidateLimit,
    });

    const toProcess: typeof candidates = [];
    const toFail: typeof candidates = [];

    for (const candidate of candidates) {
      const payload: unknown = candidate.payload;
      const sender = this.extractSenderPhone(payload);
      const normalizedSender =
        params.channelType === 'whatsapp' ? this.normalizePhone(sender) : sender;

      if (normalizedSender !== params.senderPhone) {
        continue;
      }

      const content = this.extractMessageContent(payload);
      if (!content) {
        if (this.isAwaitingAudioTranscription(payload)) {
          continue;
        }
        toFail.push(candidate);
        continue;
      }

      entries.push({ webhook: candidate, content });
      toProcess.push(candidate);
      if (entries.length >= params.maxMessages) break;
    }

    if (toProcess.length > 0) {
      await this.prisma.webhookInbox.updateMany({
        where: { id: { in: toProcess.map((c) => c.id) }, workspaceId: params.workspaceId },
        data: {
          status: 'processing',
          lastAttemptAt: new Date(),
          retryCount: { increment: 1 },
        },
      });
    }

    if (toFail.length > 0) {
      await this.prisma.webhookInbox.updateMany({
        where: { id: { in: toFail.map((c) => c.id) }, workspaceId: params.workspaceId },
        data: {
          status: 'failed',
          errorMessage: 'Could not extract message content',
        },
      });
    }

    return entries;
  }

  private buildCoalescedMessage(
    batch: Array<{ content: string }>,
    joiner: string
  ): string {
    if (!batch.length) return '';
    if (batch.length === 1) return batch[0].content;
    const separator = joiner || '\n';
    return batch
      .map((b, index) => `Mensaje ${index + 1}: ${b.content}`)
      .join(separator);
  }

  private isStickerPlaceholder(content: string): boolean {
    const normalized = (content || '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized.includes('cliente envió un sticker') || normalized.includes('cliente envio un sticker');
  }

  private isAwaitingAudioTranscription(payload: unknown): boolean {
    return isAwaitingAudioTranscriptionPayload(payload);
  }

  /**
   * Extract message content from provider payload (Infobip / Evolution)
   */
  private extractMessageContent(payload: unknown): string | null {
    const root = asRecord(payload);
    const nexovaMeta = asRecord(root?.__nexova);
    if (nexovaMeta?.sticker === true) {
      return 'El cliente envió un sticker.';
    }
    const audioTranscript = extractAudioTranscriptFromPayload(payload) || '';
    if (audioTranscript) {
      return audioTranscript;
    }

    // Evolution (Baileys) webhook format (we store one message per webhook row under payload.data)
    const evoEvent = asUpperTrimmedString(root?.event);
    const evoMsg = asRecord(root?.data);
    const evoMsgMessage = asRecord(evoMsg?.message);
    const evoMsgKey = asRecord(evoMsg?.key);
    const looksEvolutionPayload =
      Boolean(evoMsg && (
        evoMsgMessage
        || asString(evoMsgKey?.remoteJid)
        || asString(evoMsg?.status)
        || asString(evoMsg?.conversation)
        || asRecord(evoMsg?.extendedTextMessage)
        || asRecord(evoMsg?.imageMessage)
        || asRecord(evoMsg?.documentMessage)
      ));
    if ((evoEvent === 'MESSAGES_UPSERT' || looksEvolutionPayload) && evoMsg) {
      const attachment = this.extractAttachment(payload);
      const attachmentText = attachment
        ? `El cliente envió un archivo adjunto (${attachment.fileType}). fileRef: ${attachment.fileRef}${attachment.caption ? `\nMensaje: ${attachment.caption}` : ''}`
        : null;

      const message = unwrapNestedMessage(evoMsgMessage ?? evoMsg);
      if (message) {
        const stickerMessage = asRecord(message.stickerMessage);
        const imageMessage = asRecord(message.imageMessage);
        const imageMime = asLowerTrimmedString(imageMessage?.mimetype);
        const imageCaption = asTrimmedString(imageMessage?.caption);
        const looksLikeStickerFromImage = Boolean(imageMessage && imageMime.includes('webp') && !imageCaption);
        if (stickerMessage || looksLikeStickerFromImage) {
          return 'El cliente envió un sticker.';
        }

        const listResponseMessage = asRecord(message.listResponseMessage);
        const singleSelectReply = asRecord(listResponseMessage?.singleSelectReply);
        const selectedRowId = asTrimmedString(singleSelectReply?.selectedRowId);

        const buttonsResponseMessage = asRecord(message.buttonsResponseMessage);
        const selectedButtonId = asTrimmedString(buttonsResponseMessage?.selectedButtonId);
        const selectedDisplayText = asTrimmedString(buttonsResponseMessage?.selectedDisplayText);
        const interactiveText = selectedRowId || selectedButtonId || selectedDisplayText || null;

        if (interactiveText) {
          return attachmentText ? `${interactiveText}\n\n${attachmentText}` : interactiveText;
        }

        const extendedTextMessage = asRecord(message.extendedTextMessage);
        const documentMessage = asRecord(message.documentMessage);
        const text =
          asTrimmedString(message.conversation)
          || asTrimmedString(extendedTextMessage?.text)
          || imageCaption
          || asTrimmedString(documentMessage?.caption)
          || null;

        if (text) {
          return attachmentText ? `${text}\n\n${attachmentText}` : text;
        }
      }

      if (attachmentText) {
        return attachmentText;
      }
    }

    // Infobip MO format
    const result = firstRecord(root?.results);
    if (result) {
      const attachment = this.extractAttachment(payload);
      const attachmentText = attachment
        ? `El cliente envió un archivo adjunto (${attachment.fileType}). fileRef: ${attachment.fileRef}${attachment.caption ? `\nMensaje: ${attachment.caption}` : ''}`
        : null;

      const content = firstRecord(result.content);
      const message = asRecord(result.message);
      const contentType = asUpperTrimmedString(content?.type);
      const messageType = asUpperTrimmedString(message?.type);
      const interactiveType = messageType || contentType;

      if (interactiveType.includes('INTERACTIVE') || interactiveType.includes('BUTTON_REPLY')) {
        const replyId =
          asString(message?.id) ||
          asString(content?.id) ||
          asString(message?.payload) ||
          asString(content?.payload);
        const replyTitle =
          asString(message?.title) ||
          asString(content?.title) ||
          asString(message?.text) ||
          asString(content?.text);
        const replyText = replyId || replyTitle;
        if (replyText) {
          return attachmentText ? `${replyText}\n\n${attachmentText}` : replyText;
        }
      }

      // Text message
      const contentText = asString(content?.text);
      if (contentText) {
        return attachmentText
          ? `${contentText}\n\n${attachmentText}`
          : contentText;
      }
      // Legacy format
      const messageText = asString(message?.text);
      if (messageText) {
        return attachmentText
          ? `${messageText}\n\n${attachmentText}`
          : messageText;
      }
      if (attachmentText) {
        return attachmentText;
      }
    }

    // Direct text
    const directText = asString(root?.text);
    if (directText) {
      return directText;
    }

    const attachment = this.extractAttachment(payload);
    if (attachment) {
      return `El cliente envió un archivo adjunto (${attachment.fileType}). fileRef: ${attachment.fileRef}${attachment.caption ? `\nMensaje: ${attachment.caption}` : ''}`;
    }

    return null;
  }

  private extractAttachment(payload: unknown): { fileRef: string; fileType: 'image' | 'pdf'; caption?: string } | null {
    const root = asRecord(payload);
    const nexovaMeta = asRecord(root?.__nexova);
    const pre = asRecord(nexovaMeta?.attachment);
    if (nexovaMeta?.sticker === true) {
      return null;
    }
    if (pre) {
      const fileRef = asTrimmedString(pre.fileRef);
      const fileTypeRaw = asLowerTrimmedString(pre.fileType);
      const caption = asString(pre.caption) ?? undefined;
      const fileType = fileTypeRaw === 'pdf' ? 'pdf' : fileTypeRaw === 'image' ? 'image' : null;
      if (fileRef && fileType) {
        return { fileRef, fileType, ...(caption ? { caption } : {}) };
      }
    }

    const result = firstRecord(root?.results);
    if (!result) return null;

    const content = firstRecord(result.content);
    const message = asRecord(result.message);
    const mediaUrl =
      asTrimmedString(content?.mediaUrl)
      || asTrimmedString(content?.url)
      || '';
    const contentType = asLowerTrimmedString(content?.type);
    const messageType = asLowerTrimmedString(message?.type);
    const mediaMime =
      asLowerTrimmedString(content?.mimetype)
      || asLowerTrimmedString(content?.mimeType)
      || asLowerTrimmedString(content?.mediaType);
    const caption = asString(content?.caption) ?? undefined;
    const looksLikeSticker =
      contentType.includes('sticker')
      || messageType.includes('sticker')
      || (mediaMime.includes('webp') && !caption);
    if (looksLikeSticker) {
      return null;
    }
    if (mediaUrl) {
      const type = contentType;
      if (type === 'image') {
        return { fileRef: mediaUrl, fileType: 'image', ...(caption ? { caption } : {}) };
      }
      if (type === 'document') {
        return {
          fileRef: mediaUrl,
          fileType: this.inferFileType(mediaUrl),
          ...(caption ? { caption } : {}),
        };
      }
      // Fallback: infer from URL if type missing
      return {
        fileRef: mediaUrl,
        fileType: this.inferFileType(mediaUrl),
        ...(caption ? { caption } : {}),
      };
    }

    const imageUrl = asTrimmedString(message?.imageUrl);
    const messageCaption = asString(message?.caption) ?? undefined;
    if (imageUrl) {
      return {
        fileRef: imageUrl,
        fileType: 'image',
        ...(messageCaption ? { caption: messageCaption } : {}),
      };
    }

    const documentUrl = asTrimmedString(message?.documentUrl);
    if (documentUrl) {
      return {
        fileRef: documentUrl,
        fileType: this.inferFileType(documentUrl),
        ...(messageCaption ? { caption: messageCaption } : {}),
      };
    }

    return null;
  }

  private inferFileType(url: string): 'image' | 'pdf' {
    const lower = url.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
      return 'image';
    }
    if (lower.endsWith('.pdf')) {
      return 'pdf';
    }
    // Default to pdf for documents since receipt flow supports image/pdf
    return 'pdf';
  }

  /**
   * Extract sender phone from Infobip payload
   */
  private extractSenderPhone(payload: unknown): string {
    const root = asRecord(payload);
    const result = firstRecord(root?.results);
    if (result) {
      return asString(result.sender) || asString(result.from) || asString(root?.from) || 'unknown';
    }

    // Evolution payload (Baileys) - try remoteJid
    const payloadData = asRecord(root?.data);
    const payloadDataKey = asRecord(payloadData?.key);
    const payloadKey = asRecord(root?.key);
    const remoteJid =
      asString(payloadDataKey?.remoteJid)
      || asString(payloadData?.remoteJid)
      || asString(payloadKey?.remoteJid)
      || asString(root?.remoteJid)
      || null;
    if (typeof remoteJid === 'string') {
      const base = remoteJid.split('@')[0] || '';
      const digits = base.replace(/\D/g, '');
      if (digits) return `+${digits}`;
    }

    return asString(root?.from) || 'unknown';
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  }

  /**
   * Send WhatsApp message via Infobip
   */
  private async sendWhatsAppMessage(
    workspaceId: string,
    to: string,
    message: string,
    correlationId?: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const queued = await this.enqueueMessage({
        workspaceId,
        sessionId: sessionId || '',
        to,
        messageType: 'text',
        content: { text: message },
        correlationId: correlationId || '',
      });
      if (queued) {
        return;
      }

      // Get WhatsApp number for this workspace
      const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
      });

      if (!whatsappNumber) {
        logger.warn(`[AgentWorker] No active WhatsApp number for workspace ${workspaceId}`);
        return;
      }

      const apiKey = resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        logger.error('[AgentWorker] WhatsApp API key not configured');
        return;
      }

      // Dynamic import to avoid circular dependencies
      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();

      if (provider === 'evolution') {
        const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
        const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
        if (!baseUrl || !instanceName) {
          logger.error('[AgentWorker] Evolution not configured (baseUrl/instanceName missing)');
          return;
        }

        const { EvolutionClient } = await import('@nexova/integrations');
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        const result = await client.sendText(to, message);
        logger.info(`[AgentWorker] Sent message to ${to}`);

        await this.prisma.eventOutbox.create({
          data: {
            workspaceId,
            eventType: 'message.sent',
            aggregateType: 'Message',
            aggregateId: result.messageId || `${Date.now()}`,
            payload: {
              to,
              content: { text: message },
              status: result.status,
            },
            status: 'pending',
            correlationId: correlationId || null,
          },
        });

        await recordUsage(this.prisma, {
          workspaceId,
          metric: 'messages.outbound',
          quantity: 1,
          metadata: { channelType: 'whatsapp', messageType: 'text' },
        });

        return;
      }

      const { InfobipClient } = await import('@nexova/integrations');
      const client = new InfobipClient({
        apiKey,
        baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
        senderNumber: whatsappNumber.phoneNumber,
      });

      const result = await client.sendText(to, message);
      logger.info(`[AgentWorker] Sent message to ${to}`);

      await this.prisma.eventOutbox.create({
        data: {
          workspaceId,
          eventType: 'message.sent',
          aggregateType: 'Message',
          aggregateId: result.messageId,
          payload: {
            to,
            content: { text: message },
            status: result.status,
          },
          status: 'pending',
          correlationId: correlationId || null,
        },
      });

      await recordUsage(this.prisma, {
        workspaceId,
        metric: 'messages.outbound',
        quantity: 1,
        metadata: { channelType: 'whatsapp', messageType: 'text' },
      });
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to send WhatsApp message');
    }
  }

  private async sendWhatsAppInteractiveList(
    workspaceId: string,
    to: string,
    payload: {
      body: string;
      buttonText: string;
      sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
      header?: string;
      footer?: string;
    },
    fallbackText: string,
    correlationId?: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const sanitizedPayload = {
        body: this.truncateText(payload.body, 1024),
        buttonText: this.truncateText(payload.buttonText, 20),
        sections: payload.sections.map((section) => ({
          title: this.truncateText(section.title || 'Opciones', 24),
          rows: section.rows.map((row) => ({
            id: row.id,
            title: this.truncateText(row.title, 24),
            ...(row.description ? { description: this.truncateText(row.description, 72) } : {}),
          })),
        })),
        ...(payload.header ? { header: payload.header } : {}),
        ...(payload.footer ? { footer: payload.footer } : {}),
      };

      await this.storeInteractiveReplyMap(
        workspaceId,
        to,
        sanitizedPayload.sections.flatMap((section) =>
          section.rows.map((row) => ({ id: row.id, title: row.title }))
        )
      );

      const queued = await this.enqueueMessage({
        workspaceId,
        sessionId: sessionId || '',
        to,
        messageType: 'interactive',
        content: {
          text: sanitizedPayload.body,
          buttonText: sanitizedPayload.buttonText,
          listSections: sanitizedPayload.sections,
          header: sanitizedPayload.header,
          footer: sanitizedPayload.footer,
        },
        correlationId: correlationId || '',
      });
      if (queued) {
        return;
      }

      const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
      });

      if (!whatsappNumber) {
        logger.warn(`[AgentWorker] No active WhatsApp number for workspace ${workspaceId}`);
        return;
      }

      const apiKey = resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        logger.error('[AgentWorker] WhatsApp API key not configured');
        return;
      }

      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();

      if (provider === 'evolution') {
        const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
        const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
        if (!baseUrl || !instanceName) {
          logger.error('[AgentWorker] Evolution not configured (baseUrl/instanceName missing)');
          return;
        }
        const { EvolutionClient } = await import('@nexova/integrations');
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        const result = await client.sendInteractiveList(to, sanitizedPayload);
        logger.info(`[AgentWorker] Sent interactive list to ${to}`);

        await this.prisma.eventOutbox.create({
          data: {
            workspaceId,
            eventType: 'message.sent',
            aggregateType: 'Message',
            aggregateId: result.messageId || `${Date.now()}`,
            payload: {
              to,
              content: sanitizedPayload,
              status: result.status,
            },
            status: 'pending',
            correlationId: correlationId || null,
          },
        });

        await recordUsage(this.prisma, {
          workspaceId,
          metric: 'messages.outbound',
          quantity: 1,
          metadata: { channelType: 'whatsapp', messageType: 'interactive-list' },
        });

        return;
      }

      const { InfobipClient } = await import('@nexova/integrations');
      const client = new InfobipClient({
        apiKey,
        baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
        senderNumber: whatsappNumber.phoneNumber,
      });

      const result = await client.sendInteractiveList(to, sanitizedPayload);
      logger.info(`[AgentWorker] Sent interactive list to ${to}`);

      await this.prisma.eventOutbox.create({
        data: {
          workspaceId,
          eventType: 'message.sent',
          aggregateType: 'Message',
          aggregateId: result.messageId,
          payload: {
            to,
            content: sanitizedPayload,
            status: result.status,
          },
          status: 'pending',
          correlationId: correlationId || null,
        },
      });

      await recordUsage(this.prisma, {
        workspaceId,
        metric: 'messages.outbound',
        quantity: 1,
        metadata: { channelType: 'whatsapp', messageType: 'interactive-list' },
      });
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to send interactive list');
      if (fallbackText) {
        await this.sendWhatsAppMessage(workspaceId, to, fallbackText, correlationId, sessionId);
      }
    }
  }

  private async sendWhatsAppInteractiveButtons(
    workspaceId: string,
    to: string,
    payload: {
      body: string;
      buttons: Array<{ id: string; title: string }>;
      header?: string;
      footer?: string;
    },
    fallbackText: string,
    correlationId?: string,
    sessionId?: string
  ): Promise<void> {
    try {
      await this.storeInteractiveReplyMap(
        workspaceId,
        to,
        payload.buttons.map((button) => ({ id: button.id, title: button.title }))
      );

      const queued = await this.enqueueMessage({
        workspaceId,
        sessionId: sessionId || '',
        to,
        messageType: 'interactive',
        content: {
          text: payload.body,
          buttons: payload.buttons,
          header: payload.header,
          footer: payload.footer,
        },
        correlationId: correlationId || '',
      });
      if (queued) {
        return;
      }

      const sanitizedPayload = {
        ...payload,
        buttons: payload.buttons.map((button) => ({
          ...button,
          title: this.truncateButtonTitle(button.title, 20),
        })),
      };

      const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
      });

      if (!whatsappNumber) {
        logger.warn(`[AgentWorker] No active WhatsApp number for workspace ${workspaceId}`);
        return;
      }

      const apiKey = resolveWhatsAppApiKey(whatsappNumber);
      if (!apiKey) {
        logger.error('[AgentWorker] WhatsApp API key not configured');
        return;
      }

      const provider = (whatsappNumber.provider || 'infobip').toLowerCase();

      if (provider === 'evolution') {
        const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
        const instanceName = getEvolutionInstanceName(whatsappNumber.providerConfig);
        if (!baseUrl || !instanceName) {
          logger.error('[AgentWorker] Evolution not configured (baseUrl/instanceName missing)');
          return;
        }
        const { EvolutionClient } = await import('@nexova/integrations');
        const client = new EvolutionClient({ apiKey, baseUrl, instanceName });
        const result = await client.sendInteractiveButtons(to, sanitizedPayload);
        logger.info(`[AgentWorker] Sent interactive buttons to ${to}`);

        await this.prisma.eventOutbox.create({
          data: {
            workspaceId,
            eventType: 'message.sent',
            aggregateType: 'Message',
            aggregateId: result.messageId || `${Date.now()}`,
            payload: {
              to,
              content: sanitizedPayload,
              status: result.status,
            },
            status: 'pending',
            correlationId: correlationId || null,
          },
        });

        await recordUsage(this.prisma, {
          workspaceId,
          metric: 'messages.outbound',
          quantity: 1,
          metadata: { channelType: 'whatsapp', messageType: 'interactive-buttons' },
        });

        return;
      }

      const { InfobipClient } = await import('@nexova/integrations');
      const client = new InfobipClient({
        apiKey,
        baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
        senderNumber: whatsappNumber.phoneNumber,
      });

      const result = await client.sendInteractiveButtons(to, sanitizedPayload);
      logger.info(`[AgentWorker] Sent interactive buttons to ${to}`);

      await this.prisma.eventOutbox.create({
        data: {
          workspaceId,
          eventType: 'message.sent',
          aggregateType: 'Message',
          aggregateId: result.messageId,
          payload: {
            to,
            content: sanitizedPayload,
            status: result.status,
          },
          status: 'pending',
          correlationId: correlationId || null,
        },
      });

      await recordUsage(this.prisma, {
        workspaceId,
        metric: 'messages.outbound',
        quantity: 1,
        metadata: { channelType: 'whatsapp', messageType: 'interactive-buttons' },
      });
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to send interactive buttons');
      if (fallbackText) {
        await this.sendWhatsAppMessage(workspaceId, to, fallbackText, correlationId, sessionId);
      }
    }
  }

  private truncateButtonTitle(title: string, maxLength: number): string {
    const trimmed = title.trim();
    if (!trimmed) return trimmed;
    const chars = Array.from(trimmed);
    if (chars.length <= maxLength) return trimmed;
    return chars.slice(0, maxLength).join('');
  }

  private truncateText(value: string, maxLength: number): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    const chars = Array.from(trimmed);
    if (chars.length <= maxLength) return trimmed;
    return chars.slice(0, maxLength).join('');
  }

  private async enqueueMessage(payload: MessageSendPayload): Promise<boolean> {
    if (!this.messageQueue) return false;
    try {
      await this.messageQueue.add(
        `message-${payload.correlationId || Date.now().toString()}`,
        payload,
        {
          attempts: QUEUES.MESSAGE_SEND.attempts,
          backoff: QUEUES.MESSAGE_SEND.backoff,
        }
      );
      return true;
    } catch (error) {
      logger.error({ error }, '[AgentWorker] Failed to enqueue message');
      return false;
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.dlqQueue) {
      await this.dlqQueue.close();
      this.dlqQueue = null;
    }

    if (this.messageQueue) {
      await this.messageQueue.close();
      this.messageQueue = null;
    }
    if (this.agentQueue) {
      await this.agentQueue.close();
      this.agentQueue = null;
    }
    if (this.audioTranscriptionQueue) {
      await this.audioTranscriptionQueue.close();
      this.audioTranscriptionQueue = null;
    }

    await this.redis.quit();
    logger.info('[AgentWorker] Stopped');
  }
}

/**
 * Create and start an agent worker
 */
export function createAgentWorker(
  prisma: PrismaClient,
  config: WorkerConfig
): AgentWorker {
  const worker = new AgentWorker(prisma, config);
  worker.start();
  return worker;
}
