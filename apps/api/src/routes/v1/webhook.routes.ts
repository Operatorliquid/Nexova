/**
 * Webhook Routes
 * Handles incoming webhooks from external providers (Infobip, etc.)
 */
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { type Prisma } from '@prisma/client';
import { type Queue } from 'bullmq';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { decrypt } from '@nexova/core';
import { EvolutionClient, InfobipClient } from '@nexova/integrations';
import {
  QUEUES,
  type AgentProcessPayload,
  type AudioTranscriptionPayload,
  COMMERCE_USAGE_METRICS,
} from '@nexova/shared';

import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getMonthlyUsage } from '../../utils/monthly-usage.js';
import { buildSignedUploadUrl, resolveSignedUploadTtlSeconds } from '../../utils/upload-access.js';
import { resolveUploadDir } from '../../utils/upload-dir.js';

// BullMQ queue - initialized when routes are registered
let agentQueue: Queue;
let audioTranscriptionQueue: Queue | undefined;

function getWebhookSignature(request: FastifyRequest): string | undefined {
  const header = request.headers['x-hub-signature-256']
    || request.headers['x-infobip-signature-256']
    || request.headers['x-infobip-signature'];
  return Array.isArray(header) ? header[0] : header;
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
  const normalize = (value: string): string => {
    let out = (value || '').trim().replace(/\/+$/, '');
    if (out && !/^https?:\/\//i.test(out)) out = `https://${out}`;
    return out;
  };
  const cleaned = normalize(apiUrl || '');
  const envUrl = normalize(process.env.EVOLUTION_BASE_URL || '');
  return cleaned || envUrl;
}

function resolveEvolutionApiKey(number: {
  apiKeyEnc?: string | null;
  apiKeyIv?: string | null;
  provider?: string | null;
}): string {
  const envKey = (process.env.EVOLUTION_API_KEY || '').trim();
  if (envKey) return envKey;
  if (number.apiKeyEnc && number.apiKeyIv) {
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }
  return '';
}

function toPhoneDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

function normalizeToE164(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = toPhoneDigits(value);
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  return `+${digits}`;
}

function normalizeEvolutionSender(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const base = trimmed.includes('@') ? trimmed.split('@')[0] || '' : trimmed;
  const digits = toPhoneDigits(base);
  if (!digits) return null;
  return `+${digits}`;
}

function buildPhoneCandidates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = raw.replace(/\s/g, '');
  const e164 = normalizeToE164(raw);
  const candidates = new Set<string>();

  if (cleaned) {
    candidates.add(cleaned);
    if (cleaned.startsWith('+')) candidates.add(cleaned.slice(1));
  }
  if (e164) {
    candidates.add(e164);
    candidates.add(e164.slice(1));
  }

  return Array.from(candidates).filter(Boolean);
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

function extractInfobipAudioMeta(payload: unknown): {
  isAudio: boolean;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  durationMs?: number;
} {
  const root = asRecord(payload);
  const result = firstRecord(root?.results);
  const content = firstRecord(result?.content);
  const message = asRecord(result?.message);
  const contentType = asLowerTrimmedString(content?.type);
  const messageType = asLowerTrimmedString(message?.type);

  const mediaUrl =
    asTrimmedString(content?.mediaUrl)
    || asTrimmedString(content?.url)
    || asTrimmedString(message?.audioUrl)
    || undefined;

  const mimeType =
    asTrimmedString(content?.mimeType)
    || asTrimmedString(content?.mimetype)
    || asTrimmedString(message?.mimeType)
    || asTrimmedString(message?.mimetype)
    || undefined;

  const fileName =
    asTrimmedString(content?.fileName)
    || asTrimmedString(content?.filename)
    || asTrimmedString(message?.fileName)
    || asTrimmedString(message?.filename)
    || undefined;

  const durationMs =
    toPositiveIntOrNull(content?.durationMs)
    ?? toPositiveIntOrNull(content?.duration)
    ?? toPositiveIntOrNull(message?.durationMs)
    ?? toPositiveIntOrNull(message?.duration)
    ?? toPositiveIntOrNull(message?.audioDuration)
    ?? undefined;

  const isAudioType = ['audio', 'voice', 'voice_message'].includes(contentType)
    || ['audio', 'voice', 'voice_message'].includes(messageType);
  const isAudioMime = typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('audio/');

  return {
    isAudio: isAudioType || isAudioMime || !!mediaUrl,
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(fileName ? { fileName } : {}),
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
  };
}

function extractEvolutionMessages(payload: unknown): UnknownRecord[] {
  const root = asRecord(payload);
  const payloadData = asRecord(root?.data);
  const candidates: unknown[] = [
    payloadData?.messages,
    root?.messages,
    root?.data,
    root?.message,
    payloadData?.message,
  ];

  const out: UnknownRecord[] = [];
  const fallbackKey =
    asRecord(payloadData?.key)
    || asRecord(root?.key)
    || null;

  const wrapMessageIfNeeded = (value: unknown): UnknownRecord | null => {
    const message = asRecord(value);
    if (!message) return null;
    if (asRecord(message.key)) return message;

    const hasRawMessageShape =
      asString(message.conversation)
      || asRecord(message.extendedTextMessage)
      || asRecord(message.imageMessage)
      || asRecord(message.documentMessage)
      || asRecord(message.listResponseMessage)
      || asRecord(message.buttonsResponseMessage);

    if (hasRawMessageShape && fallbackKey) {
      return {
        key: fallbackKey,
        message,
      };
    }

    return null;
  };

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const normalized = wrapMessageIfNeeded(item);
        if (normalized) out.push(normalized);
      }
      continue;
    }
    const normalized = wrapMessageIfNeeded(candidate);
    if (normalized) out.push(normalized);
  }

  return out;
}

function extractEvolutionQrInfo(payload: unknown): { qrCode?: string; qrDataUrl?: string; pairingCode?: string } {
  const getString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

  const pickQr = (value: unknown): string | undefined => {
    const obj = asRecord(value);
    if (!obj) return undefined;

    // Common top-level string fields
    const direct =
      getString(obj?.code)
      || getString(obj?.qrcode)
      || getString(obj?.qrCode)
      || getString(obj?.qr)
      || getString(obj?.base64);
    if (direct) return direct;

    // Some Evolution payloads nest the QR under qrcode/base64
    const qrobj = asRecord(obj.qrcode);
    if (qrobj) {
      const nested =
        getString(qrobj?.base64)
        || getString(qrobj?.qrcode)
        || getString(qrobj?.qrCode)
        || getString(qrobj?.qr)
        || getString(qrobj?.code);
      if (nested) return nested;
    }

    // Some payloads use `qr` as an object
    const qrObj = asRecord(obj.qr);
    if (qrObj) {
      const nested =
        getString(qrObj?.base64)
        || getString(qrObj?.qrcode)
        || getString(qrObj?.qrCode)
        || getString(qrObj?.qr)
        || getString(qrObj?.code);
      if (nested) return nested;
    }

    return undefined;
  };

  const root = asRecord(payload);
  const payloadData = asRecord(root?.data);
  const qrCandidate = pickQr(payloadData) || pickQr(root);

  const isDataUrl = !!qrCandidate && /^data:image\//i.test(qrCandidate);

  const pairingCandidate =
    getString(payloadData?.pairingCode)
    || getString(payloadData?.pairing_code)
    || getString(root?.pairingCode)
    || getString(root?.pairing_code);

  const looksLikeBase64Image =
    !!qrCandidate
    && !isDataUrl
    && qrCandidate.length > 100
    && /^[A-Za-z0-9+/=]+$/.test(qrCandidate)
    && (
      qrCandidate.startsWith('iVBOR') // png
      || qrCandidate.startsWith('/9j/') // jpeg
      || qrCandidate.startsWith('R0lGOD') // gif
      || qrCandidate.startsWith('UklGR') // webp
    );

  const qrDataUrl =
    qrCandidate && isDataUrl
      ? qrCandidate
      : looksLikeBase64Image
        ? `data:image/png;base64,${qrCandidate}`
        : undefined;
  const qrCode = qrCandidate && !isDataUrl && !looksLikeBase64Image ? qrCandidate : undefined;

  const pairingCode = pairingCandidate;

  return {
    ...(qrCode ? { qrCode } : {}),
    ...(qrDataUrl ? { qrDataUrl } : {}),
    ...(pairingCode ? { pairingCode } : {}),
  };
}

function normalizeEvolutionEventName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

const EVOLUTION_MESSAGE_EVENTS = new Set([
  'MESSAGE_UPSERT',
  'MESSAGES_UPSERT',
  'MESSAGE_CREATE',
  'MESSAGES_CREATE',
  'MESSAGE_UPDATE',
  'MESSAGES_UPDATE',
  'MESSAGE_RECEIVED',
  'MESSAGES_RECEIVED',
]);

function extractEvolutionSenderPhone(msg: unknown, payload: unknown): string | null {
  const msgRecord = asRecord(msg);
  const msgKey = asRecord(msgRecord?.key);
  const payloadRecord = asRecord(payload);
  const payloadData = asRecord(payloadRecord?.data);
  const payloadDataKey = asRecord(payloadData?.key);

  const candidates: Array<string | null | undefined> = [
    asString(msgKey?.remoteJid),
    asString(msgKey?.remoteJidAlt),
    asString(msgKey?.senderPn),
    asString(msgKey?.cleanedSenderPn),
    asString(msgKey?.participant),
    asString(msgRecord?.remoteJid),
    asString(payloadDataKey?.remoteJid),
    asString(payloadDataKey?.remoteJidAlt),
    asString(payloadDataKey?.senderPn),
    asString(payloadDataKey?.cleanedSenderPn),
    asString(payloadDataKey?.participant),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeEvolutionSender(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractEvolutionMessageId(msg: unknown): string | null {
  const msgRecord = asRecord(msg);
  const msgKey = asRecord(msgRecord?.key);
  const id =
    asString(msgKey?.id) ||
    asString(msgRecord?.messageId) ||
    asString(msgRecord?.id) ||
    asString(msgRecord?.msgId) ||
    null;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function isEvolutionInboundMessage(msg: unknown): boolean {
  const msgRecord = asRecord(msg);
  const msgKey = asRecord(msgRecord?.key);
  // Baileys-style events include msg.key.fromMe
  const fromMe = msgKey?.fromMe ?? msgRecord?.fromMe;
  if (typeof fromMe === 'boolean') return !fromMe;
  const status = asUpperTrimmedString(msgRecord?.status);
  if (status.endsWith('_ACK') && !asRecord(msgRecord?.message)) return false;
  // If not present, assume inbound
  return true;
}

function extractEvolutionReplyContext(msg: unknown): { isReply: boolean; referredMessageId?: string } {
  const msgRecord = asRecord(msg);
  const message = asRecord(msgRecord?.message);
  const extendedTextMessage = asRecord(message?.extendedTextMessage);
  const buttonsResponseMessage = asRecord(message?.buttonsResponseMessage);
  const listResponseMessage = asRecord(message?.listResponseMessage);
  const imageMessage = asRecord(message?.imageMessage);
  const documentMessage = asRecord(message?.documentMessage);
  const ctx =
    asRecord(extendedTextMessage?.contextInfo)
    || asRecord(buttonsResponseMessage?.contextInfo)
    || asRecord(listResponseMessage?.contextInfo)
    || asRecord(imageMessage?.contextInfo)
    || asRecord(documentMessage?.contextInfo)
    || null;

  const referred =
    (typeof ctx?.stanzaId === 'string' && ctx.stanzaId.trim()) ? ctx.stanzaId.trim()
      : (typeof ctx?.quotedMessageId === 'string' && ctx.quotedMessageId.trim()) ? ctx.quotedMessageId.trim()
        : undefined;

  return { isReply: !!referred, ...(referred ? { referredMessageId: referred } : {}) };
}

export async function webhookRoutes(
  app: FastifyInstance,
  opts: { queue?: Queue; audioQueue?: Queue }
): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const UPLOAD_DIR = resolveUploadDir(__dirname);
  const WHATSAPP_MEDIA_DIR = path.join(UPLOAD_DIR, 'whatsapp-media');

  const sanitizeFilename = (name: string): string =>
    (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);

  const resolvePublicBaseUrlFromEnv = (): string | null => {
    const candidates = [
      process.env.API_BASE_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.PUBLIC_API_URL,
      process.env.API_PUBLIC_URL,
      process.env.NGROK_URL,
      process.env.BASE_URL,
      process.env.API_URL,
    ];
    for (const value of candidates) {
      const trimmed = (value || '').trim().replace(/\/$/, '');
      if (trimmed) return trimmed;
    }
    return null;
  };

  const extractEvolutionInstanceName = (providerConfig: unknown): string => {
    if (!providerConfig || typeof providerConfig !== 'object') return '';
    const cfg = providerConfig as Record<string, unknown>;
    const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
    return typeof value === 'string' ? value.trim() : '';
  };

  const AUDIO_NOT_AVAILABLE_MESSAGE =
    'Los mensajes de audio no están disponibles en tu plan actual. Podés continuar escribiendo en texto.';
  const AUDIO_QUOTA_EXCEEDED_MESSAGE =
    'Alcanzaste el límite mensual de transcripciones de audio. Podés continuar escribiendo en texto.';

  const checkAudioTranscriptionPolicy = async (
    workspaceId: string
  ): Promise<
    | { allowed: true }
    | { allowed: false; reason: 'plan_not_allowed' | 'monthly_quota_exceeded'; message: string }
  > => {
    try {
      const planContext = await getWorkspacePlanContext(app.prisma, workspaceId);
      if (!planContext.capabilities.showWhatsappAudioTranscription) {
        return {
          allowed: false,
          reason: 'plan_not_allowed',
          message: AUDIO_NOT_AVAILABLE_MESSAGE,
        };
      }

      const limits = await getEffectiveCommercePlanLimits(app.prisma, planContext.plan);
      const monthlyLimit = limits.audioTranscriptionsPerMonth;
      if (monthlyLimit === null) return { allowed: true };

      const used = await getMonthlyUsage(app.prisma, {
        workspaceId,
        metric: COMMERCE_USAGE_METRICS.audioTranscriptions,
      });
      if (used >= BigInt(monthlyLimit)) {
        return {
          allowed: false,
          reason: 'monthly_quota_exceeded',
          message: AUDIO_QUOTA_EXCEEDED_MESSAGE,
        };
      }
    } catch (error) {
      app.log.warn(
        { err: error, workspaceId },
        'Audio policy check failed; allowing transcription to avoid message loss'
      );
    }

    return { allowed: true };
  };

  const sendProviderTextReply = async (params: {
    number: {
      provider: string | null;
      phoneNumber: string;
      apiUrl?: string | null;
      apiKeyEnc?: string | null;
      apiKeyIv?: string | null;
      providerConfig?: Prisma.JsonValue;
    };
    to: string;
    text: string;
  }): Promise<void> => {
    const provider = (params.number.provider || 'infobip').toLowerCase();
    if (provider === 'evolution') {
      const baseUrl = resolveEvolutionBaseUrl(params.number.apiUrl);
      const apiKey = resolveEvolutionApiKey(params.number);
      const instanceName = extractEvolutionInstanceName(params.number.providerConfig);
      if (!baseUrl || !apiKey || !instanceName) {
        throw new Error('Evolution sender not configured');
      }
      const evolutionClient = new EvolutionClient({
        baseUrl,
        apiKey,
        instanceName,
      });
      await evolutionClient.sendText(params.to, params.text);
      return;
    }

    const infobipClient = new InfobipClient({
      apiKey: resolveWhatsAppApiKey(params.number),
      baseUrl: resolveInfobipBaseUrl(params.number.apiUrl),
      senderNumber: params.number.phoneNumber,
    });
    await infobipClient.sendText(params.to, params.text);
  };

  const fetchEvolutionMediaBase64 = async (params: {
    baseUrl: string;
    apiKey: string;
    instanceName: string;
    messageId: string;
    message?: unknown;
  }): Promise<{ base64: string; mimetype?: string; filename?: string } | null> => {
    const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(params.instanceName)}`;
    const candidates: Array<Record<string, unknown>> = [];
    const messageRecord = asRecord(params.message);

    // Preferred shape: full webhook message object (some Evolution versions need remoteJid/fromMe).
    if (messageRecord) {
      candidates.push({
        message: messageRecord,
        convertToMp4: false,
      });
    }

    // Fallback: normalized key object.
    const keyFromMessage = asRecord(messageRecord?.key);
    const normalizedKey = {
      id: params.messageId,
      ...(typeof keyFromMessage?.remoteJid === 'string' ? { remoteJid: keyFromMessage.remoteJid } : {}),
      ...(typeof keyFromMessage?.participant === 'string' ? { participant: keyFromMessage.participant } : {}),
      ...(typeof keyFromMessage?.fromMe === 'boolean' ? { fromMe: keyFromMessage.fromMe } : { fromMe: false }),
    };
    candidates.push({
      message: { key: normalizedKey },
      convertToMp4: false,
    });
    candidates.push({
      key: normalizedKey,
      convertToMp4: false,
    });

    let lastStatus = 0;
    let lastBody = '';

    for (const bodyCandidate of candidates) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: params.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(bodyCandidate),
      });

      const text = await response.text();
      if (!response.ok) {
        lastStatus = response.status;
        lastBody = text;
        continue;
      }

      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = null;
        }
      }
      const raw: unknown = json ?? text;

      if (typeof raw === 'string') {
        return { base64: raw };
      }

      const obj = asRecord(raw);
      if (obj) {
        const base64 =
          typeof obj.base64 === 'string'
            ? obj.base64
            : typeof obj.data === 'string'
              ? obj.data
              : typeof obj.media === 'string'
                ? obj.media
                : '';
        if (!base64) continue;
        const mimetype =
          typeof obj.mimetype === 'string'
            ? obj.mimetype
            : typeof obj.mimeType === 'string'
              ? obj.mimeType
              : undefined;
        const filename =
          typeof obj.fileName === 'string'
            ? obj.fileName
            : typeof obj.filename === 'string'
              ? obj.filename
              : undefined;
        return { base64, mimetype, filename };
      }
    }

    app.log.warn(
      { status: lastStatus, body: lastBody, messageId: params.messageId },
      'Evolution media fetch failed'
    );
    return null;
  };

  const persistEvolutionMedia = async (params: {
    workspaceId: string;
    messageId: string;
    base64: string;
    mimetype?: string;
    filenameHint?: string;
  }): Promise<{ fileRef: string; fileType: 'image' | 'pdf' } | null> => {
    const publicBase = resolvePublicBaseUrlFromEnv();
    if (!publicBase) return null;

    const base64Raw = params.base64.trim();
    const cleaned = base64Raw.replace(/^data:[^;]+;base64,/, '');
    if (!cleaned) return null;

    const buffer = Buffer.from(cleaned, 'base64');
    if (!buffer.length) return null;

    const mime = (params.mimetype || '').toLowerCase();
    const fileType: 'image' | 'pdf' = mime.includes('pdf') ? 'pdf' : 'image';
    const ext =
      fileType === 'pdf'
        ? 'pdf'
        : mime.includes('png')
          ? 'png'
          : mime.includes('webp')
            ? 'webp'
            : 'jpg';

    await fs.mkdir(WHATSAPP_MEDIA_DIR, { recursive: true });
    const baseName = sanitizeFilename(params.filenameHint || `wa-${params.workspaceId}-${params.messageId}`);
    const unique = `${baseName}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const fullPath = path.join(WHATSAPP_MEDIA_DIR, unique);
    await fs.writeFile(fullPath, buffer);

    const fileRef = buildSignedUploadUrl({
      baseUrl: publicBase,
      category: 'whatsapp-media',
      filename: unique,
      ttlSeconds: resolveSignedUploadTtlSeconds(),
    });
    return { fileRef, fileType };
  };

  // Capture raw body for signature verification (scoped to webhook routes)
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      request.rawBody = body as Buffer;
      try {
        const json: unknown = JSON.parse((body as Buffer).toString('utf8'));
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // Initialize queue if provided
  if (opts.queue) {
    agentQueue = opts.queue;
  }
  if (opts.audioQueue) {
    audioTranscriptionQueue = opts.audioQueue;
  }

  const createAudioTranscription = async (params: {
    workspaceId: string;
    provider: 'infobip' | 'evolution';
    messageId: string;
    channelId?: string | null;
    correlationId?: string | null;
    webhookInboxId: string;
    mimeType?: string | null;
    fileName?: string | null;
    durationMs?: number | null;
    sizeBytes?: number | null;
    mediaUrl?: string | null;
  }): Promise<void> => {
    try {
      const created = await app.prisma.audioTranscription.create({
        data: {
          workspaceId: params.workspaceId,
          provider: params.provider,
          messageId: params.messageId,
          channelId: params.channelId || null,
          webhookInboxId: params.webhookInboxId,
          status: 'pending',
          mimeType: params.mimeType || null,
          durationMs: params.durationMs || null,
          sizeBytes: params.sizeBytes ? BigInt(params.sizeBytes) : null,
          metadata: {
            ...(params.fileName ? { fileName: params.fileName } : {}),
            ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
            ...(params.correlationId ? { correlationId: params.correlationId } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      if (!audioTranscriptionQueue) {
        app.log.warn(
          {
            messageId: params.messageId,
            workspaceId: params.workspaceId,
            provider: params.provider,
            audioTranscriptionId: created.id,
          },
          'Audio transcription queue not initialized; transcription left pending'
        );
        return;
      }

      const payload: AudioTranscriptionPayload = {
        workspaceId: params.workspaceId,
        audioTranscriptionId: created.id,
        webhookInboxId: params.webhookInboxId,
        messageId: params.messageId,
        provider: params.provider,
        ...(params.channelId ? { channelId: params.channelId } : {}),
        ...(params.correlationId ? { correlationId: params.correlationId } : {}),
        metadata: {
          ...(params.mimeType ? { mimeType: params.mimeType } : {}),
          ...(params.fileName ? { fileName: params.fileName } : {}),
          ...(typeof params.sizeBytes === 'number' ? { sizeBytes: params.sizeBytes } : {}),
          ...(typeof params.durationMs === 'number' ? { durationMs: params.durationMs } : {}),
          ...(params.mediaUrl ? { fileRef: params.mediaUrl } : {}),
        },
      };

      await audioTranscriptionQueue.add(`audio-${params.provider}-${params.messageId}`, payload, {
        attempts: QUEUES.AUDIO_TRANSCRIPTION.attempts,
        backoff: QUEUES.AUDIO_TRANSCRIPTION.backoff,
      });

      app.log.info(
        {
          workspaceId: params.workspaceId,
          provider: params.provider,
          messageId: params.messageId,
          audioTranscriptionId: created.id,
          webhookInboxId: params.webhookInboxId,
          hasMediaRef: Boolean(params.mediaUrl),
        },
        'Audio transcription enqueued'
      );
    } catch (error) {
      app.log.error(
        {
          err: error,
          messageId: params.messageId,
          workspaceId: params.workspaceId,
          provider: params.provider,
          webhookInboxId: params.webhookInboxId,
        },
        'Failed to create/enqueue audio transcription'
      );
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // INFOBIP WHATSAPP WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /webhooks/infobip/:numberId
   * Receives incoming WhatsApp messages from Infobip
   * The numberId in the URL identifies which WhatsApp number received the message
   */
  app.post<{
    Params: { numberId: string };
    Body: unknown;
  }>('/infobip/:numberId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          numberId: { type: 'string' },
        },
        required: ['numberId'],
      },
    },
    handler: async (request, reply) => {
      const { numberId } = request.params;
      const payload = asRecord(request.body);
      const result = firstRecord(payload?.results);
      const eventType = asString(result?.event);

      request.log.info({ numberId, eventType }, 'Received Infobip webhook');

      try {
        if (typeof eventType === 'string' && eventType.toUpperCase() !== 'MO') {
          request.log.info({ numberId, eventType }, 'Ignoring non-MO webhook event');
          return reply.send({ status: 'ignored', reason: 'non_mo_event', eventType });
        }

        // Get WhatsApp number configuration
        const whatsappNumber = await app.prisma.whatsAppNumber.findUnique({
          where: { id: numberId },
        });

        if (!whatsappNumber) {
          request.log.warn({ numberId }, 'WhatsApp number not found');
          return reply.status(404).send({ error: 'Number not found' });
        }

        if (!whatsappNumber.isActive) {
          request.log.warn({ numberId }, 'WhatsApp number is inactive');
          return reply.status(400).send({ error: 'Number inactive' });
        }

        // Verify webhook signature if secret is configured
        if (whatsappNumber.webhookSecret) {
          const signature = getWebhookSignature(request);
          if (!signature) {
            request.log.warn({ numberId }, 'Missing webhook signature');
            return reply.status(401).send({ error: 'Missing signature' });
          }

          const client = new InfobipClient({
            apiKey: resolveWhatsAppApiKey(whatsappNumber),
            baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
            senderNumber: whatsappNumber.phoneNumber,
          });

          const rawBody = request.rawBody || Buffer.from(JSON.stringify(payload));
          const isValid = client.verifyWebhookSignature(
            rawBody,
            signature,
            whatsappNumber.webhookSecret
          );

          if (!isValid) {
            request.log.warn({ numberId }, 'Invalid webhook signature');
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }

        // Parse the incoming message
        const tempClient = new InfobipClient({
          apiKey: '',
          baseUrl: '',
          senderNumber: '',
        });
        const parsed = tempClient.parseIncomingMessage(payload);

        if (!parsed) {
          request.log.warn({ numberId, eventType }, 'Could not parse incoming message');
          // Return 200 to prevent Infobip from retrying
          return reply.send({ status: 'ignored', reason: 'unparseable' });
        }

        // Check for duplicate (idempotency)
        const existingMessage = await app.prisma.webhookInbox.findFirst({
          where: {
            externalId: parsed.messageId,
            workspaceId: whatsappNumber.workspaceId!,
            provider: 'infobip',
          },
        });

        if (existingMessage) {
          request.log.info({ messageId: parsed.messageId }, 'Duplicate message ignored');
          return reply.send({ status: 'duplicate' });
        }

        const workspaceId = whatsappNumber.workspaceId!;
        const infobipAudioMeta = extractInfobipAudioMeta(payload);
        const hasTextContent = typeof parsed.content?.text === 'string' && parsed.content.text.trim().length > 0;
        const isAudioMessage = parsed.content?.type === 'audio' || infobipAudioMeta.isAudio;
        const audioPolicy = isAudioMessage
          ? await checkAudioTranscriptionPolicy(workspaceId)
          : null;
        const storedPayload = isAudioMessage
          ? {
              ...payload,
              __nexova: {
                audio: {
                  provider: 'infobip',
                  messageId: parsed.messageId,
                  ...(infobipAudioMeta.mediaUrl ? { mediaUrl: infobipAudioMeta.mediaUrl } : {}),
                  ...(infobipAudioMeta.mimeType ? { mimeType: infobipAudioMeta.mimeType } : {}),
                  ...(infobipAudioMeta.fileName ? { fileName: infobipAudioMeta.fileName } : {}),
                  ...(typeof infobipAudioMeta.durationMs === 'number' ? { durationMs: infobipAudioMeta.durationMs } : {}),
                  ...(audioPolicy && !audioPolicy.allowed
                    ? {
                        blockedReason: audioPolicy.reason,
                        blockedMessage: audioPolicy.message,
                      }
                    : {}),
                },
              },
            }
          : payload;

        // Store in webhook inbox for processing
        const correlationId = crypto.randomUUID();
        const webhookInbox = await app.prisma.webhookInbox.create({
          data: {
            workspaceId,
            provider: 'infobip',
            externalId: parsed.messageId,
            eventType: 'message.received',
            payload: storedPayload as Prisma.InputJsonValue,
            signature: getWebhookSignature(request) || null,
            status: 'pending',
            correlationId,
          },
        });

        if (isAudioMessage && audioPolicy?.allowed) {
          request.log.info(
            {
              workspaceId,
              messageId: parsed.messageId,
              from: parsed.from,
              provider: 'infobip',
              policy: 'allowed',
              hasTextContent,
            },
            'Inbound audio accepted for transcription'
          );
          await createAudioTranscription({
            workspaceId,
            provider: 'infobip',
            messageId: parsed.messageId,
            channelId: parsed.from,
            correlationId,
            webhookInboxId: webhookInbox.id,
            mimeType: infobipAudioMeta.mimeType || null,
            fileName: infobipAudioMeta.fileName || null,
            durationMs: infobipAudioMeta.durationMs || null,
            mediaUrl: infobipAudioMeta.mediaUrl || null,
          });
        } else if (isAudioMessage && audioPolicy && !audioPolicy.allowed && !hasTextContent) {
          request.log.info(
            {
              workspaceId,
              messageId: parsed.messageId,
              from: parsed.from,
              provider: 'infobip',
              policy: audioPolicy.reason,
            },
            'Inbound audio blocked by policy'
          );
          await app.prisma.webhookInbox.updateMany({
            where: { id: webhookInbox.id, workspaceId },
            data: {
              status: 'completed',
              processedAt: new Date(),
              result: {
                status: 'completed',
                reason: 'audio_blocked_by_policy',
                policyReason: audioPolicy.reason,
              } as Prisma.InputJsonValue,
            },
          });

          try {
            await sendProviderTextReply({
              number: whatsappNumber,
              to: parsed.from,
              text: audioPolicy.message,
            });
          } catch (sendError) {
            request.log.warn(
              { err: sendError, messageId: parsed.messageId, workspaceId },
              'Failed to send audio policy reply'
            );
          }
        } else if (isAudioMessage && hasTextContent) {
          request.log.info(
            {
              workspaceId,
              messageId: parsed.messageId,
              from: parsed.from,
              provider: 'infobip',
              policy: audioPolicy?.allowed ? 'allowed' : audioPolicy?.reason || 'unknown',
            },
            'Inbound audio with text content will continue via text pipeline'
          );
        }

        // Queue for agent processing
        if (agentQueue && (!isAudioMessage || hasTextContent)) {
          const jobPayload: AgentProcessPayload = {
            workspaceId,
            messageId: parsed.messageId,
            channelId: parsed.from,
            channelType: 'whatsapp',
            correlationId,
            metadata: {
              isReply: !!parsed.context?.messageId,
              referredMessageId: parsed.context?.messageId,
            },
          };

          await agentQueue.add(`msg-${parsed.messageId}`, jobPayload, {
            attempts: QUEUES.AGENT_PROCESS.attempts,
            backoff: QUEUES.AGENT_PROCESS.backoff,
          });

          request.log.info(
            { messageId: parsed.messageId, from: parsed.from },
            'Message queued for processing'
          );
        } else {
          request.log.info(
            { messageId: parsed.messageId, isAudioMessage },
            'Message stored but not enqueued to agent'
          );
        }

        return reply.send({
          status: 'queued',
          messageId: parsed.messageId,
          correlationId,
        });
      } catch (error) {
        request.log.error(error, 'Failed to process Infobip webhook');
        // Return 200 to avoid webhook retries for internal errors
        // The message is in webhook inbox for manual retry
        return reply.send({ status: 'error', error: 'Internal processing error' });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // EVOLUTION WHATSAPP WEBHOOK (instance-based)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /webhooks/evolution/:secret OR /whatsapp/evolution/:secret
   * Receives webhooks from Evolution API instances.
   *
   * We secure this endpoint by embedding a per-number secret in the URL and
   * matching it against whatsapp_numbers.webhook_secret.
   */
  const handleEvolutionWebhook = async (
    request: FastifyRequest<{
      Params: { secret: string; eventPath?: string };
      Body: unknown;
    }>,
    reply: FastifyReply
  ): Promise<unknown> => {
    const { secret, eventPath } = request.params;
    const payload = asRecord(request.body);

    request.log.info(
      { provider: 'evolution', event: payload?.event ?? payload?.eventType ?? eventPath, eventPath, instance: payload?.instance },
      'Received Evolution webhook'
    );

    try {
      const whatsappNumber = await app.prisma.whatsAppNumber.findFirst({
        where: {
          provider: 'evolution',
          webhookSecret: secret,
        },
      });

      if (!whatsappNumber || !whatsappNumber.workspaceId) {
        request.log.warn({ secret }, 'Evolution webhook ignored: number not found');
        return reply.send({ status: 'ignored', reason: 'number_not_found' });
      }

      const rawEvent = (payload?.event ?? payload?.eventType ?? eventPath ?? '') as unknown;
      const event = normalizeEvolutionEventName(rawEvent);

      if (event === 'QRCODE_UPDATED') {
        const qr = extractEvolutionQrInfo(payload);
        const currentCfg =
          whatsappNumber.providerConfig && typeof whatsappNumber.providerConfig === 'object'
            ? (whatsappNumber.providerConfig as Record<string, unknown>)
            : {};

        await app.prisma.whatsAppNumber.update({
          where: { id: whatsappNumber.id },
          data: {
            providerConfig: {
              ...currentCfg,
              ...(qr.qrCode ? { qrCode: qr.qrCode } : {}),
              ...(qr.qrDataUrl ? { qrDataUrl: qr.qrDataUrl } : {}),
              ...(qr.pairingCode ? { pairingCode: qr.pairingCode } : {}),
              qrUpdatedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        return reply.send({ status: 'received', event: 'QRCODE_UPDATED', ...qr });
      }

      if (event === 'CONNECTION_UPDATE') {
        const payloadData = asRecord(payload?.data);
        const payloadInstance = asRecord(payload?.instance);
        const rawState =
          asString(payloadData?.state)
          || asString(payload?.state)
          || asString(payloadInstance?.state)
          || '';
        const state = typeof rawState === 'string' ? rawState.trim().toLowerCase() : '';

        // Some Evolution builds include the QR payload in CONNECTION_UPDATE.
        const qr = extractEvolutionQrInfo(payload);
        const currentCfg =
          whatsappNumber.providerConfig && typeof whatsappNumber.providerConfig === 'object'
            ? (whatsappNumber.providerConfig as Record<string, unknown>)
            : {};

        const updateData: Prisma.WhatsAppNumberUpdateInput = {
          providerConfig: {
            ...currentCfg,
            ...(qr.qrCode ? { qrCode: qr.qrCode } : {}),
            ...(qr.qrDataUrl ? { qrDataUrl: qr.qrDataUrl } : {}),
            ...(qr.pairingCode ? { pairingCode: qr.pairingCode } : {}),
            ...(qr.qrCode || qr.qrDataUrl || qr.pairingCode ? { qrUpdatedAt: new Date().toISOString() } : {}),
          } as Prisma.InputJsonValue,
          healthCheckedAt: new Date(),
        };

        if (state === 'open') {
          updateData.isActive = true;
          updateData.healthStatus = 'healthy';
          updateData.status = 'assigned';
          updateData.lastError = null;
          updateData.lastErrorAt = null;
        } else if (state) {
          updateData.isActive = false;
          updateData.healthStatus = state;
        }

        await app.prisma.whatsAppNumber.update({
          where: { id: whatsappNumber.id },
          data: updateData,
        });

        // We keep this endpoint lightweight. The workspace polls status via /whatsapp/evolution/status.
        return reply.send({ status: 'received', event: 'CONNECTION_UPDATE' });
      }

      const messages = extractEvolutionMessages(payload);
      if (event && !EVOLUTION_MESSAGE_EVENTS.has(event) && messages.length === 0) {
        // Ignore other non-message events.
        return reply.send({ status: 'ignored', reason: 'non_message_event', event });
      }
      if (messages.length === 0) {
        return reply.send({ status: 'ignored', reason: 'missing_message' });
      }

      // If we are receiving inbound user messages, the instance is connected.
      // Mark number active so outbound send jobs can resolve this workspace number.
      if (!whatsappNumber.isActive || whatsappNumber.healthStatus !== 'healthy') {
        await app.prisma.whatsAppNumber.update({
          where: { id: whatsappNumber.id },
          data: {
            isActive: true,
            status: 'assigned',
            healthStatus: 'healthy',
            healthCheckedAt: new Date(),
            lastError: null,
            lastErrorAt: null,
          },
        });
      }

      const workspaceId = whatsappNumber.workspaceId;
      let queued = 0;
      for (const msg of messages) {
        if (!isEvolutionInboundMessage(msg)) continue;

        const messageId = extractEvolutionMessageId(msg) || crypto.randomUUID();
        const msgKey = asRecord(msg.key);
        const payloadData = asRecord(payload?.data);
        const payloadDataKey = asRecord(payloadData?.key);
        const remoteJid =
          asString(msgKey?.remoteJid)
          || asString(msgKey?.remoteJidAlt)
          || asString(msg.remoteJid)
          || asString(payloadDataKey?.remoteJid)
          || asString(payloadDataKey?.remoteJidAlt);
        if (typeof remoteJid === 'string' && remoteJid.includes('@g.us')) {
          // Ignore group messages by default
          continue;
        }

        const senderPhone = extractEvolutionSenderPhone(msg, payload);
        if (!senderPhone) {
          request.log.warn(
            { messageId, event, remoteJid, key: msgKey ?? null },
            'Evolution message ignored: sender phone not resolved'
          );
          continue;
        }

        // Dedupe
        const existing = await app.prisma.webhookInbox.findFirst({
          where: {
            externalId: messageId,
            workspaceId,
            provider: 'evolution',
          },
        });
        if (existing) continue;

        const correlationId = crypto.randomUUID();
        let attachment:
          | { fileRef: string; fileType: 'image' | 'pdf' | 'audio'; caption?: string }
          | null = null;

        const rawMsgBody = asRecord(msg.message) || {};
        const msgBody =
          asRecord(asRecord(rawMsgBody.ephemeralMessage)?.message)
          || asRecord(asRecord(rawMsgBody.viewOnceMessage)?.message)
          || asRecord(asRecord(rawMsgBody.viewOnceMessageV2)?.message)
          || asRecord(asRecord(rawMsgBody.viewOnceMessageV2Extension)?.message)
          || rawMsgBody;
        const imageMsg = asRecord(msgBody.imageMessage);
        const docMsg = asRecord(msgBody.documentMessage);
        const stickerMsg = asRecord(msgBody.stickerMessage);
        const audioMsg = asRecord(msgBody.audioMessage) || asRecord(msgBody.pttMessage);
        const audioMime = asTrimmedString(audioMsg?.mimetype);
        const audioDurationSeconds = toPositiveIntOrNull(audioMsg?.seconds);
        const audioDurationMs =
          toPositiveIntOrNull(audioMsg?.durationMs)
          ?? (typeof audioDurationSeconds === 'number' ? audioDurationSeconds * 1000 : null);
        const audioSizeBytes = toPositiveIntOrNull(audioMsg?.fileLength || audioMsg?.fileSize);
        const imageMime = asLowerTrimmedString(imageMsg?.mimetype);
        const imageCaption = asTrimmedString(imageMsg?.caption);
        const looksLikeStickerFromImage = Boolean(imageMsg && imageMime.includes('webp') && !imageCaption);
        const isSticker = Boolean(stickerMsg) || looksLikeStickerFromImage;
        const isAudio = Boolean(audioMsg);
        const hasMedia = Boolean(imageMsg) || Boolean(docMsg);
        const hasTextContent =
          asTrimmedString(msgBody.conversation).length > 0
          || asTrimmedString(asRecord(msgBody.extendedTextMessage)?.text).length > 0
          || asTrimmedString(imageMsg?.caption).length > 0
          || asTrimmedString(docMsg?.caption).length > 0;
        const audioPolicy = isAudio
          ? await checkAudioTranscriptionPolicy(workspaceId)
          : null;

        if (hasMedia && !isSticker) {
          try {
            const instanceName = extractEvolutionInstanceName(whatsappNumber.providerConfig);
            const baseUrl = resolveEvolutionBaseUrl(whatsappNumber.apiUrl);
            const apiKey = resolveEvolutionApiKey(whatsappNumber);

            if (instanceName && baseUrl && apiKey) {
              const media = await fetchEvolutionMediaBase64({
                baseUrl,
                apiKey,
                instanceName,
                messageId,
                message: msg,
              });

              const caption =
                asTrimmedString(imageMsg?.caption)
                || asTrimmedString(docMsg?.caption)
                || undefined;

              const mimetype =
                asTrimmedString(imageMsg?.mimetype)
                || asTrimmedString(docMsg?.mimetype)
                || media?.mimetype;

              const filenameHint =
                asTrimmedString(docMsg?.fileName)
                || media?.filename;

              if (media?.base64) {
                const persisted = await persistEvolutionMedia({
                  workspaceId: whatsappNumber.workspaceId,
                  messageId,
                  base64: media.base64,
                  mimetype,
                  filenameHint,
                });

                if (persisted) {
                  attachment = {
                    fileRef: persisted.fileRef,
                    fileType: persisted.fileType,
                    ...(caption ? { caption } : {}),
                  };
                }
              }
            }
          } catch (err) {
            request.log.warn(err, 'Failed to persist Evolution media (continuing)');
          }
        }

        const nexovaMeta: Record<string, unknown> = {};
        if (attachment) {
          nexovaMeta.attachment = attachment;
        }
        if (!attachment && isSticker) {
          nexovaMeta.sticker = true;
        }
        if (isAudio) {
          nexovaMeta.audio = {
            provider: 'evolution',
            messageId,
            ...(audioMime ? { mimeType: audioMime } : {}),
            ...(typeof audioDurationMs === 'number' ? { durationMs: audioDurationMs } : {}),
            ...(typeof audioSizeBytes === 'number' ? { sizeBytes: audioSizeBytes } : {}),
            ...(audioPolicy && !audioPolicy.allowed
              ? {
                  blockedReason: audioPolicy.reason,
                  blockedMessage: audioPolicy.message,
                }
              : {}),
          };
        }

        const storedPayload = {
          event: payload?.event,
          instance: payload?.instance,
          data: msg,
          ...(Object.keys(nexovaMeta).length > 0 ? { __nexova: nexovaMeta } : {}),
        };
        const webhookInbox = await app.prisma.webhookInbox.create({
          data: {
            workspaceId,
            provider: 'evolution',
            externalId: messageId,
            eventType: 'message.received',
            payload: storedPayload as Prisma.InputJsonValue,
            signature: null,
            status: 'pending',
            correlationId,
          },
        });

        if (isAudio && audioPolicy?.allowed) {
          request.log.info(
            {
              workspaceId,
              messageId,
              from: senderPhone,
              provider: 'evolution',
              policy: 'allowed',
              hasTextContent,
            },
            'Inbound audio accepted for transcription'
          );
          await createAudioTranscription({
            workspaceId,
            provider: 'evolution',
            messageId,
            channelId: senderPhone,
            correlationId,
            webhookInboxId: webhookInbox.id,
            mimeType: audioMime || null,
            durationMs: audioDurationMs || null,
            sizeBytes: audioSizeBytes || null,
          });
        } else if (isAudio && audioPolicy && !audioPolicy.allowed && !hasTextContent) {
          request.log.info(
            {
              workspaceId,
              messageId,
              from: senderPhone,
              provider: 'evolution',
              policy: audioPolicy.reason,
            },
            'Inbound audio blocked by policy'
          );
          await app.prisma.webhookInbox.updateMany({
            where: { id: webhookInbox.id, workspaceId },
            data: {
              status: 'completed',
              processedAt: new Date(),
              result: {
                status: 'completed',
                reason: 'audio_blocked_by_policy',
                policyReason: audioPolicy.reason,
              } as Prisma.InputJsonValue,
            },
          });

          try {
            await sendProviderTextReply({
              number: whatsappNumber,
              to: senderPhone,
              text: audioPolicy.message,
            });
          } catch (sendError) {
            request.log.warn(
              { err: sendError, messageId, workspaceId },
              'Failed to send audio policy reply'
            );
          }
        } else if (isAudio && hasTextContent) {
          request.log.info(
            {
              workspaceId,
              messageId,
              from: senderPhone,
              provider: 'evolution',
              policy: audioPolicy?.allowed ? 'allowed' : audioPolicy?.reason || 'unknown',
            },
            'Inbound audio with text content will continue via text pipeline'
          );
        }

        if (agentQueue && (!isAudio || hasTextContent)) {
          const ctx = extractEvolutionReplyContext(msg);
          const jobPayload: AgentProcessPayload = {
            workspaceId,
            messageId,
            channelId: senderPhone,
            channelType: 'whatsapp',
            correlationId,
            metadata: {
              isReply: ctx.isReply,
              referredMessageId: ctx.referredMessageId,
            },
          };

          await agentQueue.add(`msg-${messageId}`, jobPayload, {
            attempts: QUEUES.AGENT_PROCESS.attempts,
            backoff: QUEUES.AGENT_PROCESS.backoff,
          });
        }

        queued += 1;
      }

      return reply.send({ status: 'queued', queued });
    } catch (error) {
      request.log.error(error, 'Failed to process Evolution webhook');
      return reply.send({ status: 'error', error: 'Internal processing error' });
    }
  };

  app.post<{
    Params: { secret: string };
    Body: unknown;
  }>('/evolution/:secret', {
    schema: {
      params: {
        type: 'object',
        properties: { secret: { type: 'string' } },
        required: ['secret'],
      },
    },
    handler: handleEvolutionWebhook,
  });

  app.post<{
    Params: { secret: string; eventPath: string };
    Body: unknown;
  }>('/evolution/:secret/:eventPath', {
    schema: {
      params: {
        type: 'object',
        properties: {
          secret: { type: 'string' },
          eventPath: { type: 'string' },
        },
        required: ['secret', 'eventPath'],
      },
    },
    handler: handleEvolutionWebhook,
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // INFOBIP DELIVERY REPORT WEBHOOK
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /webhooks/infobip/:numberId/delivery
   * Receives delivery reports for outbound messages
   */
		  app.post<{
    Params: { numberId: string };
    Body: unknown;
	  }>('/infobip/:numberId/delivery', {
		    handler: async (request, reply) => {
		      const { numberId } = request.params;
		      const payload = asRecord(request.body);
        const deliveryResult =
          firstRecord(payload?.results)
          || firstRecord(payload?.messages)
          || payload;
        const deliveryResultRecord = asRecord(deliveryResult);
        const deliveryResultMessage = asRecord(deliveryResultRecord?.message);
        const deliveryResultStatus = asRecord(deliveryResultRecord?.status);
        const deliveryMessageId =
          asString(deliveryResultRecord?.messageId)
          || asString(deliveryResultMessage?.id)
          || asString(deliveryResultRecord?.id)
          || asString(deliveryResultRecord?.externalId)
          || null;

	      request.log.info(
          {
            numberId,
            messageId: deliveryMessageId,
            status: asString(deliveryResultStatus?.name) || asString(deliveryResultRecord?.status) || 'unknown',
          },
          'Received Infobip delivery report'
        );

      try {
        const whatsappNumber = await app.prisma.whatsAppNumber.findUnique({
          where: { id: numberId },
        });

        if (!whatsappNumber || !whatsappNumber.workspaceId) {
          request.log.warn({ numberId }, 'WhatsApp number not found for delivery report');
          return reply.send({ status: 'ignored', reason: 'number_not_found' });
        }

        if (whatsappNumber.webhookSecret) {
          const signature = getWebhookSignature(request);
          if (!signature) {
            request.log.warn({ numberId }, 'Missing webhook signature');
            return reply.status(401).send({ error: 'Missing signature' });
          }

          const client = new InfobipClient({
            apiKey: resolveWhatsAppApiKey(whatsappNumber),
            baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
            senderNumber: whatsappNumber.phoneNumber,
          });

          const rawBody = request.rawBody || Buffer.from(JSON.stringify(payload));
          const isValid = client.verifyWebhookSignature(
            rawBody,
            signature,
            whatsappNumber.webhookSecret
          );

          if (!isValid) {
            request.log.warn({ numberId }, 'Invalid webhook signature');
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }

        const result =
          firstRecord(payload?.results)
          || firstRecord(payload?.messages)
          || payload;
        const resultRecord = asRecord(result);
        const resultMessage = asRecord(resultRecord?.message);
        const resultStatus = asRecord(resultRecord?.status);
        const resultMessageStatus = asRecord(resultMessage?.status);
        const messageId =
          asString(resultRecord?.messageId) ||
          asString(resultMessage?.id) ||
          asString(resultRecord?.id) ||
          asString(resultRecord?.externalId);
        if (!messageId) {
          request.log.warn(
            {
              numberId,
              hasResultsArray: Array.isArray(payload?.results),
              hasMessagesArray: Array.isArray(payload?.messages),
            },
            'Delivery report missing messageId'
          );
          return reply.send({ status: 'ignored', reason: 'missing_message_id' });
        }

        const statusName =
          asString(resultStatus?.name) ||
          asString(resultRecord?.status) ||
          asString(resultMessageStatus?.name) ||
          'unknown';
        const statusGroup =
          asString(resultStatus?.groupName) ||
          asString(resultMessageStatus?.groupName) ||
          '';
        const statusDescription =
          asString(resultStatus?.description) ||
          asString(resultMessageStatus?.description) ||
          '';
        const reportedAtRaw =
          asString(resultRecord?.doneAt) ||
          asString(resultRecord?.timestamp) ||
          asString(resultRecord?.sentAt) ||
          asString(resultRecord?.receivedAt) ||
          asString(resultRecord?.reportTime);
        const reportedAt = reportedAtRaw ? new Date(reportedAtRaw) : new Date();

        await app.prisma.eventOutbox.create({
          data: {
            workspaceId: whatsappNumber.workspaceId,
            eventType: 'message.delivery',
            aggregateType: 'Message',
            aggregateId: String(messageId),
            payload: {
              messageId: String(messageId),
              status: statusName,
              statusGroup,
              statusDescription,
              provider: 'infobip',
              reportedAt: reportedAt.toISOString(),
              raw: (result ?? payload ?? null) as Prisma.InputJsonValue,
            },
            status: 'pending',
            correlationId: null,
          },
        });

        return reply.send({ status: 'received', messageId, deliveryStatus: statusName });
      } catch (error) {
        request.log.error(error, 'Failed to process delivery report');
        return reply.send({ status: 'error', error: 'Internal processing error' });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // UNIFIED WHATSAPP WEBHOOK (auto-detect number)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /webhooks/webhook OR /whatsapp/webhook
   * Unified webhook that auto-detects the WhatsApp number from the payload
   * Use this URL in Infobip: https://your-domain/api/whatsapp/webhook
   *
   * IMPORTANT: This endpoint does NOT process messages synchronously.
   * It validates, deduplicates, stores in WebhookInbox, and enqueues to BullMQ.
   * Returns 200 immediately to prevent Infobip retries.
   */
  app.post('/webhook', {
    handler: async (request, reply) => {
      const payload = asRecord(request.body);
      const payloadRecord = payload ?? {};
      const result = firstRecord(payload?.results);
      const eventType = asUpperTrimmedString(result?.event) || undefined;

      request.log.info({ eventType }, 'Received WhatsApp webhook');

      try {
        // Extract the receiver number from Infobip payload
        // Infobip MO_MESSAGES_API_JSON format uses: destination (not to)
        if (eventType && eventType !== 'MO') {
          request.log.info({ eventType }, 'Ignoring non-MO webhook event');
          return reply.send({ status: 'ignored', reason: 'non_mo_event', eventType });
        }
        let receiverNumber: string | null = null;

        const receiverFromResult = asString(result?.destination) || asString(result?.to);
        const receiverFromPayload = asString(payload?.to);
        if (receiverFromResult) {
          receiverNumber = receiverFromResult;
        } else if (receiverFromPayload) {
          receiverNumber = receiverFromPayload;
        }

        if (!receiverNumber) {
          request.log.warn({ eventType }, 'Could not extract receiver number from payload');
          // Return 200 to prevent Infobip retries
          return reply.send({ status: 'ignored', reason: 'missing_receiver' });
        }

        // Extract message ID for deduplication
        const messageId = asTrimmedString(result?.messageId) || crypto.randomUUID();

        // Normalize the number (remove spaces, ensure + prefix)
        const receiverCandidates = buildPhoneCandidates(receiverNumber);
        const senderRaw = asString(result?.sender) || asString(result?.from) || null;
        const senderCandidates = buildPhoneCandidates(senderRaw);

        type WhatsAppNumberLookup = Awaited<ReturnType<typeof app.prisma.whatsAppNumber.findFirst>>;
        const findNumberByCandidates = async (candidates: string[]): Promise<WhatsAppNumberLookup> => {
          if (candidates.length === 0) return null;
          const exact = await app.prisma.whatsAppNumber.findFirst({
            where: {
              OR: candidates.map((phoneNumber) => ({ phoneNumber })),
              isActive: true,
            },
          });
          if (exact) return exact;

          // Fallback: match by digits only (handles stored formatting like +54-9-xxx or other punctuation).
          const digitsCandidates = Array.from(
            new Set(candidates.map(toPhoneDigits).filter((d) => d.length > 0))
          );
          if (digitsCandidates.length === 0) return null;

          const rows = await app.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM "whatsapp_numbers"
            WHERE "is_active" = true
              AND regexp_replace("phone_number", '[^0-9]', '', 'g') = ANY(${digitsCandidates})
            LIMIT 1
          `;

          const id = rows?.[0]?.id;
          if (!id) return null;
          return app.prisma.whatsAppNumber.findUnique({ where: { id } });
        };

        // Find the WhatsApp number in database (try receiver first; if fields are swapped, fallback to sender).
        let whatsappNumber = await findNumberByCandidates(receiverCandidates);
        let assumedSender = senderRaw;
        if (!whatsappNumber && senderCandidates.length > 0) {
          whatsappNumber = await findNumberByCandidates(senderCandidates);
          if (whatsappNumber) {
            // Some payloads swap from/to. If we matched "sender" as our business number,
            // then the other side is the customer.
            assumedSender = receiverNumber;
          }
        }

        if (!whatsappNumber) {
          request.log.warn(
            { receiverNumber, receiverCandidates, senderRaw, senderCandidates },
            'WhatsApp number not found'
          );
          // Return 200 to prevent Infobip retries
          return reply.send({ status: 'ignored', reason: 'number_not_found' });
        }

        if (!whatsappNumber.workspaceId) {
          request.log.warn({ receiverNumber }, 'WhatsApp number not assigned to workspace');
          return reply.send({ status: 'ignored', reason: 'no_workspace' });
        }

        // Verify webhook signature if secret is configured
        if (whatsappNumber.webhookSecret) {
          const signature = getWebhookSignature(request);
          if (!signature) {
            request.log.warn({ receiverNumber }, 'Missing webhook signature');
            return reply.status(401).send({ error: 'Missing signature' });
          }

        const client = new InfobipClient({
          apiKey: resolveWhatsAppApiKey(whatsappNumber),
          baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
          senderNumber: whatsappNumber.phoneNumber,
        });

          const rawBody = request.rawBody || Buffer.from(JSON.stringify(payload));
          const isValid = client.verifyWebhookSignature(
            rawBody,
            signature,
            whatsappNumber.webhookSecret
          );

          if (!isValid) {
            request.log.warn({ receiverNumber }, 'Invalid webhook signature');
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }

        // Check for duplicate (idempotency) in WebhookInbox
        const existingMessage = await app.prisma.webhookInbox.findFirst({
          where: {
            externalId: messageId,
            workspaceId: whatsappNumber.workspaceId,
            provider: 'infobip',
          },
        });

        if (existingMessage) {
          request.log.info({ messageId }, 'Duplicate message ignored');
          return reply.send({ status: 'duplicate' });
        }

        // Store in webhook inbox for processing (DO NOT process here)
        const correlationId = crypto.randomUUID();
        const infobipAudioMeta = extractInfobipAudioMeta(payload);
        const resultMessage = asRecord(result?.message);
        const resultContent = firstRecord(result?.content);
        const hasTextContent =
          asTrimmedString(resultMessage?.text).length > 0
          || asTrimmedString(resultContent?.text).length > 0;
        const isAudioMessage = infobipAudioMeta.isAudio;
        const storedPayload = isAudioMessage
          ? {
              ...payloadRecord,
              __nexova: {
                audio: {
                  provider: 'infobip',
                  messageId,
                  ...(infobipAudioMeta.mediaUrl ? { mediaUrl: infobipAudioMeta.mediaUrl } : {}),
                  ...(infobipAudioMeta.mimeType ? { mimeType: infobipAudioMeta.mimeType } : {}),
                  ...(infobipAudioMeta.fileName ? { fileName: infobipAudioMeta.fileName } : {}),
                  ...(typeof infobipAudioMeta.durationMs === 'number' ? { durationMs: infobipAudioMeta.durationMs } : {}),
                },
              },
            }
          : payload;

        const webhookInbox = await app.prisma.webhookInbox.create({
          data: {
            workspaceId: whatsappNumber.workspaceId,
            provider: 'infobip',
            externalId: messageId,
            eventType: 'message.received',
            payload: storedPayload as Prisma.InputJsonValue,
            signature: getWebhookSignature(request) || null,
            status: 'pending',
            correlationId,
          },
        });

        // Extract sender for job payload (prefer the inferred one in case payload swaps fields)
        const senderNumber = assumedSender || 'unknown';

        if (isAudioMessage) {
          await createAudioTranscription({
            workspaceId: whatsappNumber.workspaceId,
            provider: 'infobip',
            messageId,
            channelId: senderNumber,
            correlationId,
            webhookInboxId: webhookInbox.id,
            mimeType: infobipAudioMeta.mimeType || null,
            fileName: infobipAudioMeta.fileName || null,
            durationMs: infobipAudioMeta.durationMs || null,
            mediaUrl: infobipAudioMeta.mediaUrl || null,
          });
        }

        // Queue for agent processing (DO NOT call LLM here)
        if (agentQueue && (!isAudioMessage || hasTextContent)) {
          const jobPayload: AgentProcessPayload = {
            workspaceId: whatsappNumber.workspaceId,
            messageId,
            channelId: senderNumber,
            channelType: 'whatsapp',
            correlationId,
            metadata: {
              isReply: Boolean(asString(asRecord(result?.context)?.messageId)),
              referredMessageId: asString(asRecord(result?.context)?.messageId) || undefined,
            },
          };

          await agentQueue.add(`msg-${messageId}`, jobPayload, {
            attempts: QUEUES.AGENT_PROCESS.attempts,
            backoff: QUEUES.AGENT_PROCESS.backoff,
          });

          request.log.info(
            { messageId, from: senderNumber, correlationId },
            'Message queued for processing'
          );
        } else {
          request.log.info(
            { messageId, isAudioMessage },
            'Message stored but not enqueued to agent'
          );
        }

        // Return 200 immediately - processing happens async
        return reply.send({
          status: 'queued',
          messageId,
          correlationId,
        });
      } catch (error) {
        request.log.error(error, 'Failed to process WhatsApp webhook');
        // Return 200 to avoid webhook retries for internal errors
        // The error is logged for debugging
        return reply.send({ status: 'error', error: 'Internal processing error' });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // WEBHOOK HEALTH CHECK
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /webhooks/health
   * Health check for webhook endpoint
   */
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      queueConnected: !!agentQueue,
      audioQueueConnected: !!audioTranscriptionQueue,
    });
  });

  /**
   * POST /webhooks/debug
   * Debug endpoint to capture raw webhook payloads
   */
  const enableWebhookDebug =
    (process.env.WEBHOOK_DEBUG || '').toLowerCase() === 'true'
    || process.env.NODE_ENV === 'development';

  if (enableWebhookDebug) {
    app.post('/debug', async (request, reply) => {
      const serialized = JSON.stringify(request.body ?? {});
      app.log.info(
        {
          route: '/debug',
          bodyBytes: Buffer.byteLength(serialized),
          headerKeys: Object.keys(request.headers),
        },
        'Webhook debug request received'
      );
      return reply.send({ status: 'received', timestamp: new Date().toISOString() });
    });

    /**
     * Catch-all for any unmatched POST requests
     */
    app.post('/*', async (request, reply) => {
      const serialized = JSON.stringify(request.body ?? {});
      app.log.info(
        {
          route: request.url,
          bodyBytes: Buffer.byteLength(serialized),
          headerKeys: Object.keys(request.headers),
        },
        'Webhook catch-all request received'
      );
      return reply.send({ status: 'caught', url: request.url });
    });
  }
}
