/**
 * Audio Transcription Job
 * Downloads inbound WhatsApp audio and generates transcript text.
 */
import { randomUUID } from 'crypto';

import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Job, type Queue } from 'bullmq';

import { decrypt, logger } from '@nexova/core';
import {
  type AgentProcessPayload,
  type AudioTranscriptionPayload,
  COMMERCE_USAGE_METRICS,
  type MessageSendPayload,
  QUEUES,
} from '@nexova/shared';

import { fetchBinaryWithGuards } from '../utils/remote-fetch-guard.js';

const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
const OPENAI_TIMEOUT_MS_RAW = Number.parseInt(process.env.AUDIO_TRANSCRIPTION_TIMEOUT_MS || '30000', 10);
const MAX_DIRECT_DOWNLOAD_BYTES_RAW = Number.parseInt(
  process.env.AUDIO_TRANSCRIPTION_MAX_BYTES || String(25 * 1024 * 1024),
  10
);
const OPENAI_TIMEOUT_MS = Number.isFinite(OPENAI_TIMEOUT_MS_RAW) && OPENAI_TIMEOUT_MS_RAW > 0
  ? OPENAI_TIMEOUT_MS_RAW
  : 30000;
const MAX_DIRECT_DOWNLOAD_BYTES = Number.isFinite(MAX_DIRECT_DOWNLOAD_BYTES_RAW) && MAX_DIRECT_DOWNLOAD_BYTES_RAW > 0
  ? MAX_DIRECT_DOWNLOAD_BYTES_RAW
  : 25 * 1024 * 1024;

interface AudioBlob {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
  durationMs?: number | null;
  sizeBytes?: number | null;
}

interface AudioTranscriptionResult {
  audioTranscriptionId: string;
  status: 'completed' | 'skipped';
  transcript?: string;
  language?: string | null;
  confidence?: number | null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function firstObjectFromArray(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const [first] = value as unknown[];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  return first as Record<string, unknown>;
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

function parseFilenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = /filename="?([^"]+)"?/i.exec(header);
  return basicMatch?.[1] || undefined;
}

function sanitizeFileName(name: string | undefined, fallback = 'audio'): string {
  const raw = (name || fallback).trim();
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

function inferAudioExtension(mimeType?: string): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('aac')) return 'aac';
  return 'bin';
}

const OPENAI_SUPPORTED_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'm4a',
  'wav',
  'webm',
  'ogg',
]);

function normalizeAudioExtensionForOpenAi(extension: string): string {
  const ext = extension.trim().toLowerCase().replace(/^\./, '');
  if (!ext) return '';
  if (ext === 'oga' || ext === 'opus') return 'ogg';
  return ext;
}

function normalizeMimeTypeForUpload(mimeType?: string): string {
  const raw = (mimeType || '').trim();
  if (!raw) return 'application/octet-stream';
  const normalized = raw.split(';')[0]?.trim();
  return normalized || 'application/octet-stream';
}

function buildOpenAiUploadFilename(fileName: string | undefined, mimeType?: string): string {
  const sanitized = sanitizeFileName(fileName, 'audio');
  const dotIndex = sanitized.lastIndexOf('.');
  const base = dotIndex > 0 ? sanitized.slice(0, dotIndex) : sanitized;
  const currentExt = dotIndex > 0 ? sanitized.slice(dotIndex + 1) : '';

  const normalizedCurrent = normalizeAudioExtensionForOpenAi(currentExt);
  if (normalizedCurrent && OPENAI_SUPPORTED_AUDIO_EXTENSIONS.has(normalizedCurrent)) {
    return `${base}.${normalizedCurrent}`;
  }

  const inferred = normalizeAudioExtensionForOpenAi(inferAudioExtension(mimeType));
  if (inferred && OPENAI_SUPPORTED_AUDIO_EXTENSIONS.has(inferred)) {
    return `${base}.${inferred}`;
  }

  // Fallback to a widely accepted extension for STT upload.
  return `${base}.webm`;
}

function resolveInfobipApiKey(number: {
  apiKeyEnc?: string | null;
  apiKeyIv?: string | null;
}): string {
  const envKey = (process.env.INFOBIP_API_KEY || '').trim();
  if (envKey) return envKey;
  if (number.apiKeyEnc && number.apiKeyIv) {
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }
  return '';
}

function resolveInfobipBaseUrl(apiUrl?: string | null): string {
  const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
  const envUrl = (process.env.INFOBIP_BASE_URL || '').trim().replace(/\/$/, '');
  const defaultUrl = 'https://api.infobip.com';
  if (cleaned && cleaned.toLowerCase() !== defaultUrl) return cleaned;
  if (envUrl) return envUrl;
  return cleaned || defaultUrl;
}

function resolveEvolutionApiKey(number: {
  apiKeyEnc?: string | null;
  apiKeyIv?: string | null;
}): string {
  const envKey = (process.env.EVOLUTION_API_KEY || '').trim();
  if (envKey) return envKey;
  if (number.apiKeyEnc && number.apiKeyIv) {
    return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
  }
  return '';
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

function parseHost(value?: string | null): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildAllowedMediaHostMatcher(baseUrl: string, configuredApiUrl?: string | null): (host: string) => boolean {
  const baseHost = parseHost(baseUrl);
  const configuredHost = parseHost(configuredApiUrl);
  const envHosts = (process.env.AUDIO_MEDIA_ALLOWED_HOSTS || process.env.RECEIPT_PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map((entry) => parseHost(entry))
    .filter(Boolean) as string[];
  const trustedHosts = new Set<string>([
    ...envHosts,
    ...(baseHost ? [baseHost] : []),
    ...(configuredHost ? [configuredHost] : []),
  ]);

  return (host: string): boolean => {
    const normalized = host.toLowerCase();
    if (normalized === 'infobip.com' || normalized.endsWith('.infobip.com')) return true;
    return trustedHosts.has(normalized);
  };
}

function extractEvolutionInstanceName(providerConfig: unknown): string {
  const cfg = asObject(providerConfig);
  const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadFromUrl(
  url: string,
  isAllowedHost: (host: string) => boolean,
  headers?: Record<string, string>
): Promise<AudioBlob> {
  const { buffer, contentType } = await fetchBinaryWithGuards({
    url,
    headers,
    isAllowedHost,
    allowedContentTypes: ['audio/*', 'application/octet-stream', 'video/mp4'],
    maxBytes: MAX_DIRECT_DOWNLOAD_BYTES,
    timeoutMs: OPENAI_TIMEOUT_MS,
  });

  if (buffer.length === 0) {
    throw new Error('Downloaded media is empty');
  }

  const fileName = (() => {
    try {
      const parsed = new URL(url);
      const pathName = parsed.pathname.split('/').pop() || '';
      return sanitizeFileName(pathName || undefined, 'audio');
    } catch {
      return undefined;
    }
  })();

  return {
    buffer,
    ...(contentType ? { mimeType: contentType } : {}),
    ...(fileName ? { fileName } : {}),
    sizeBytes: buffer.length,
  };
}

async function downloadInfobipAudio(params: {
  apiKey: string;
  baseUrl: string;
  messageId: string;
  mediaUrl?: string;
  isAllowedHost: (host: string) => boolean;
}): Promise<AudioBlob> {
  // 1) Try direct media URL if available.
  if (params.mediaUrl) {
    try {
      return await downloadFromUrl(
        params.mediaUrl,
        params.isAllowedHost,
        params.apiKey ? { Authorization: `App ${params.apiKey}` } : undefined
      );
    } catch {
      // Fall through to provider media endpoint.
    }
  }

  if (!params.apiKey) {
    throw new Error('Infobip API key not configured');
  }

  // 2) Download from Infobip media endpoint by messageId.
  const endpoint = `${params.baseUrl.replace(/\/+$/, '')}/whatsapp/1/media/${encodeURIComponent(params.messageId)}`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'GET',
      headers: {
        Authorization: `App ${params.apiKey}`,
        Accept: '*/*',
      },
    },
    OPENAI_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Infobip media download failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    const json = await response.json() as Record<string, unknown>;
    const mediaUrl = typeof json.mediaUrl === 'string'
      ? json.mediaUrl
      : typeof json.url === 'string'
        ? json.url
        : '';
    const base64 = typeof json.base64 === 'string' ? json.base64 : '';
    if (base64) {
      const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleaned, 'base64');
      return {
        buffer,
        mimeType: typeof json.mimeType === 'string' ? json.mimeType : undefined,
        fileName: typeof json.fileName === 'string' ? json.fileName : undefined,
        sizeBytes: buffer.length,
      };
    }
    if (mediaUrl) {
      return downloadFromUrl(mediaUrl, params.isAllowedHost);
    }
    throw new Error('Infobip media response does not include downloadable content');
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_DIRECT_DOWNLOAD_BYTES) {
    throw new Error(`Audio file too large (${contentLength} bytes)`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error('Downloaded media is empty');
  }
  if (buffer.length > MAX_DIRECT_DOWNLOAD_BYTES) {
    throw new Error(`Audio file too large (${buffer.length} bytes)`);
  }

  return {
    buffer,
    mimeType: response.headers.get('content-type') || undefined,
    fileName: parseFilenameFromDisposition(response.headers.get('content-disposition')),
    sizeBytes: buffer.length,
  };
}

async function fetchEvolutionMediaBase64(params: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  messageId: string;
  message?: unknown;
}): Promise<{ base64: string; mimetype?: string; filename?: string } | null> {
  const endpoint = `${params.baseUrl.replace(/\/+$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(params.instanceName)}`;
  const candidates: Array<Record<string, unknown>> = [];
  const message = params.message && typeof params.message === 'object' && !Array.isArray(params.message)
    ? (params.message as Record<string, unknown>)
    : null;

  if (message) {
    candidates.push({ message, convertToMp4: false });
  }

  const keyFromMessage = message ? asObject(message['key']) : null;
  const normalizedKey = {
    id: params.messageId,
    ...(typeof keyFromMessage?.['remoteJid'] === 'string' ? { remoteJid: keyFromMessage['remoteJid'] } : {}),
    ...(typeof keyFromMessage?.['participant'] === 'string' ? { participant: keyFromMessage['participant'] } : {}),
    ...(typeof keyFromMessage?.['fromMe'] === 'boolean' ? { fromMe: keyFromMessage['fromMe'] } : { fromMe: false }),
  };
  candidates.push({ message: { key: normalizedKey }, convertToMp4: false });
  candidates.push({ key: normalizedKey, convertToMp4: false });

  for (const bodyCandidate of candidates) {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          apikey: params.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(bodyCandidate),
      },
      OPENAI_TIMEOUT_MS
    );

    const text = await response.text();
    if (!response.ok) continue;

    const parsed = text ? safeJsonParse(text) : null;
    const raw = parsed ?? text;

    if (typeof raw === 'string') {
      return { base64: raw };
    }

    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
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

  return null;
}

async function downloadEvolutionAudio(params: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  messageId: string;
  message?: unknown;
  mimeType?: string | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
}): Promise<AudioBlob> {
  const media = await fetchEvolutionMediaBase64({
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    instanceName: params.instanceName,
    messageId: params.messageId,
    message: params.message,
  });

  if (!media?.base64) {
    throw new Error('Evolution media fetch returned empty payload');
  }

  const cleaned = media.base64.trim().replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleaned, 'base64');
  if (!buffer.length) {
    throw new Error('Evolution media payload is empty');
  }
  if (buffer.length > MAX_DIRECT_DOWNLOAD_BYTES) {
    throw new Error(`Audio file too large (${buffer.length} bytes)`);
  }

  return {
    buffer,
    mimeType: media.mimetype || params.mimeType || undefined,
    fileName: media.filename,
    durationMs: params.durationMs || null,
    sizeBytes: params.sizeBytes || buffer.length,
  };
}

async function transcribeAudio(params: {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
  languageHint?: string | null;
}): Promise<{ text: string; language?: string | null; confidence?: number | null }> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const fileName = buildOpenAiUploadFilename(params.fileName, params.mimeType);
  const mimeType = normalizeMimeTypeForUpload(params.mimeType);

  const form = new FormData();
  form.append('model', OPENAI_TRANSCRIPTION_MODEL);
  form.append('file', new Blob([params.buffer], { type: mimeType }), fileName);
  if (params.languageHint && params.languageHint.trim()) {
    form.append('language', params.languageHint.trim());
  }

  const response = await fetchWithTimeout(
    `${OPENAI_API_BASE}/audio/transcriptions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    },
    OPENAI_TIMEOUT_MS
  );

  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI transcription failed (${response.status}): ${textBody}`);
  }

  const json = textBody ? safeJsonParse(textBody) : null;
  const jsonObject = asObject(json);
  const transcript = typeof jsonObject.text === 'string' ? jsonObject.text.trim() : '';
  if (!transcript) {
    throw new Error('OpenAI transcription returned empty text');
  }

  const language = typeof jsonObject.language === 'string' ? jsonObject.language : null;
  const confidenceValue = jsonObject.confidence;
  const confidence =
    typeof confidenceValue === 'number' && Number.isFinite(confidenceValue)
      ? confidenceValue
      : null;

  return {
    text: transcript,
    ...(language ? { language } : {}),
    ...(confidence !== null ? { confidence } : {}),
  };
}

async function enqueueAgentAfterTranscription(params: {
  agentQueue: Queue<AgentProcessPayload>;
  workspaceId: string;
  messageId: string;
  channelId: string;
  correlationId: string;
}): Promise<void> {
  const jobPayload: AgentProcessPayload = {
    workspaceId: params.workspaceId,
    messageId: params.messageId,
    channelId: params.channelId,
    channelType: 'whatsapp',
    correlationId: params.correlationId,
  };

  await params.agentQueue.add(`audio-msg-${params.messageId}-${Date.now()}`, jobPayload, {
    attempts: QUEUES.AGENT_PROCESS.attempts,
    backoff: QUEUES.AGENT_PROCESS.backoff,
  });
}

async function enqueueTranscriptionFailureMessage(params: {
  messageQueue: Queue<MessageSendPayload> | null;
  workspaceId: string;
  webhookInboxId?: string | null;
  channelId: string;
  correlationId: string;
}): Promise<void> {
  if (!params.messageQueue) return;
  await params.messageQueue.add(
    `audio-fallback-${randomUUID().slice(0, 8)}`,
    {
      workspaceId: params.workspaceId,
      sessionId: params.webhookInboxId || `audio-fallback-${randomUUID().slice(0, 8)}`,
      to: params.channelId,
      messageType: 'text',
      content: {
        text: 'No pude interpretar ese audio. ¿Podés escribirlo por texto?',
      },
      correlationId: params.correlationId,
    },
    {
      attempts: QUEUES.MESSAGE_SEND.attempts,
      backoff: QUEUES.MESSAGE_SEND.backoff,
    }
  );
}

export function createAudioTranscriptionProcessor(
  prisma: PrismaClient,
  agentQueue: Queue<AgentProcessPayload>,
  messageQueue?: Queue<MessageSendPayload> | null
) {
  return async (job: Job<AudioTranscriptionPayload>): Promise<AudioTranscriptionResult> => {
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? QUEUES.AUDIO_TRANSCRIPTION.attempts ?? 1;
    const startedAtMs = Date.now();

    const transcription = await prisma.audioTranscription.findUnique({
      where: { id: job.data.audioTranscriptionId },
    });

    if (!transcription || transcription.workspaceId !== job.data.workspaceId) {
      return {
        audioTranscriptionId: job.data.audioTranscriptionId,
        status: 'skipped',
      };
    }

    logger.info(
      `[AudioTranscription] Start transcription ${transcription.id} (${transcription.provider}/${transcription.messageId}) ` +
      `workspace=${transcription.workspaceId} attempt=${attempt}/${maxAttempts}`
    );

    if (transcription.status === 'completed' && !job.data.force) {
      return {
        audioTranscriptionId: transcription.id,
        status: 'skipped',
        transcript: transcription.transcript || undefined,
      };
    }

    await prisma.audioTranscription.update({
      where: { id: transcription.id },
      data: {
        status: 'processing',
        startedAt: new Date(),
        errorMessage: null,
        attemptCount: { increment: 1 },
      },
    });

    let resolvedChannelId: string | null = transcription.channelId || job.data.channelId || null;
    let resolvedCorrelationId: string = job.data.correlationId || randomUUID();

    try {
      const webhook = await prisma.webhookInbox.findFirst({
        where: transcription.webhookInboxId
          ? { id: transcription.webhookInboxId, workspaceId: transcription.workspaceId }
          : {
              workspaceId: transcription.workspaceId,
              provider: transcription.provider,
              externalId: transcription.messageId,
            },
      });

      if (!webhook) {
        throw new Error('Webhook message not found for audio transcription');
      }

      const payload = asObject(webhook.payload);
      const nexovaMeta = asObject(payload['__nexova']);
      const audioMeta = asObject(nexovaMeta['audio']);
      const firstResult = firstObjectFromArray(payload['results']);
      const languageHintRaw = audioMeta.languageHint ?? (job.data.metadata?.languageHint);
      const languageHint = typeof languageHintRaw === 'string' && languageHintRaw.trim()
        ? languageHintRaw.trim()
        : null;
      const channelId =
        transcription.channelId
        || (typeof job.data.channelId === 'string' ? job.data.channelId : null)
        || (typeof firstResult?.['from'] === 'string' ? firstResult['from'] : null)
        || null;
      const correlationId =
        (typeof webhook.correlationId === 'string' && webhook.correlationId.trim())
          ? webhook.correlationId
          : randomUUID();
      resolvedCorrelationId = correlationId;
      if (channelId) resolvedChannelId = channelId;

      const number = await prisma.whatsAppNumber.findFirst({
        where: {
          workspaceId: transcription.workspaceId,
          provider: transcription.provider,
          isActive: true,
        },
      });

      let audioBlob: AudioBlob | null = null;

      if (transcription.provider === 'infobip') {
        const apiKey = number ? resolveInfobipApiKey(number) : (process.env.INFOBIP_API_KEY || '').trim();
        const baseUrl = resolveInfobipBaseUrl(number?.apiUrl || null);
        const isAllowedHost = buildAllowedMediaHostMatcher(baseUrl, number?.apiUrl || null);
        const mediaUrl =
          typeof audioMeta.mediaUrl === 'string'
            ? audioMeta.mediaUrl
            : typeof job.data.metadata?.fileRef === 'string'
              ? job.data.metadata.fileRef
              : undefined;

        audioBlob = await downloadInfobipAudio({
          apiKey,
          baseUrl,
          messageId: transcription.messageId,
          mediaUrl,
          isAllowedHost,
        });
      } else if (transcription.provider === 'evolution') {
        const apiKey = number ? resolveEvolutionApiKey(number) : (process.env.EVOLUTION_API_KEY || '').trim();
        const baseUrl = resolveEvolutionBaseUrl(number?.apiUrl || null);
        const instanceName = extractEvolutionInstanceName(number?.providerConfig);
        if (!apiKey) throw new Error('Evolution API key not configured');
        if (!baseUrl) throw new Error('Evolution baseUrl not configured');
        if (!instanceName) throw new Error('Evolution instanceName not configured');

        audioBlob = await downloadEvolutionAudio({
          apiKey,
          baseUrl,
          instanceName,
          messageId: transcription.messageId,
          message: payload['data'],
          mimeType: typeof audioMeta.mimeType === 'string' ? audioMeta.mimeType : null,
          durationMs: toPositiveIntOrNull(audioMeta.durationMs),
          sizeBytes: toPositiveIntOrNull(audioMeta.sizeBytes),
        });
      } else {
        throw new Error(`Unsupported audio provider: ${transcription.provider}`);
      }

      if (!audioBlob?.buffer?.length) {
        throw new Error('Audio download failed or returned empty content');
      }

      const stt = await transcribeAudio({
        buffer: audioBlob.buffer,
        mimeType: audioBlob.mimeType,
        fileName: audioBlob.fileName,
        languageHint,
      });

      await prisma.audioTranscription.update({
        where: { id: transcription.id },
        data: {
          status: 'completed',
          transcript: stt.text,
          language: stt.language || null,
          confidence: stt.confidence ?? null,
          mimeType: audioBlob.mimeType || transcription.mimeType,
          durationMs: audioBlob.durationMs || transcription.durationMs,
          sizeBytes: audioBlob.sizeBytes ? BigInt(audioBlob.sizeBytes) : transcription.sizeBytes,
          completedAt: new Date(),
          metadata: {
            ...asObject(transcription.metadata),
            sttProvider: 'openai',
            sttModel: OPENAI_TRANSCRIPTION_MODEL,
            fileName: audioBlob.fileName || asObject(transcription.metadata).fileName || null,
            sizeBytes: audioBlob.sizeBytes || transcription.sizeBytes || null,
          } as Prisma.InputJsonValue,
        },
      });

      const updatedAudioMeta = {
        ...audioMeta,
        transcript: stt.text,
        transcriptionProvider: 'openai',
        transcriptionModel: OPENAI_TRANSCRIPTION_MODEL,
        transcriptionCompletedAt: new Date().toISOString(),
        ...(stt.language ? { language: stt.language } : {}),
        ...(stt.confidence !== null && stt.confidence !== undefined ? { confidence: stt.confidence } : {}),
      };

      const updatedPayload = {
        ...payload,
        __nexova: {
          ...nexovaMeta,
          audio: updatedAudioMeta,
        },
      };

      await prisma.webhookInbox.updateMany({
        where: { id: webhook.id, workspaceId: transcription.workspaceId },
        data: {
          payload: updatedPayload as Prisma.InputJsonValue,
          status: 'pending',
          errorMessage: null,
          lastAttemptAt: new Date(),
          correlationId,
        },
      });

      if (channelId) {
        await enqueueAgentAfterTranscription({
          agentQueue,
          workspaceId: transcription.workspaceId,
          messageId: transcription.messageId,
          channelId,
          correlationId,
        });
      }

      await prisma.usageRecord.create({
        data: {
          workspaceId: transcription.workspaceId,
          metric: COMMERCE_USAGE_METRICS.audioTranscriptions,
          quantity: 1n,
          periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0, 0)),
          periodEnd: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59, 999)),
          metadata: {
            provider: transcription.provider,
            audioTranscriptionId: transcription.id,
            messageId: transcription.messageId,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => undefined);

      logger.info(
        `[AudioTranscription] Completed transcription ${transcription.id} ` +
        `workspace=${transcription.workspaceId} provider=${transcription.provider} ` +
        `durationMs=${Date.now() - startedAtMs} transcriptChars=${stt.text.length}`
      );

      return {
        audioTranscriptionId: transcription.id,
        status: 'completed',
        transcript: stt.text,
        language: stt.language || null,
        confidence: stt.confidence ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isFinalAttempt = attempt >= maxAttempts;

      await prisma.audioTranscription.update({
        where: { id: transcription.id },
        data: {
          status: 'failed',
          errorMessage: message.slice(0, 4000),
          ...(isFinalAttempt ? { completedAt: new Date() } : {}),
        },
      });

      if (isFinalAttempt && transcription.webhookInboxId) {
        await prisma.webhookInbox.updateMany({
          where: { id: transcription.webhookInboxId, workspaceId: transcription.workspaceId },
          data: {
            status: 'completed',
            errorMessage: `Audio transcription failed: ${message}`.slice(0, 4000),
            lastAttemptAt: new Date(),
            processedAt: new Date(),
            result: {
              status: 'failed',
              reason: 'audio_transcription_failed',
              error: message.slice(0, 4000),
            } as Prisma.InputJsonValue,
          },
        }).catch(() => undefined);
      }

      if (isFinalAttempt && resolvedChannelId) {
        await enqueueTranscriptionFailureMessage({
          messageQueue: messageQueue ?? null,
          workspaceId: transcription.workspaceId,
          webhookInboxId: transcription.webhookInboxId,
          channelId: resolvedChannelId,
          correlationId: resolvedCorrelationId,
        }).catch(() => undefined);
      }

      console.error(
        `[AudioTranscription] Failed transcription ${transcription.id} workspace=${transcription.workspaceId} ` +
        `provider=${transcription.provider} attempt=${attempt}/${maxAttempts} final=${isFinalAttempt} ` +
        `durationMs=${Date.now() - startedAtMs}: ${message}`
      );

      throw error;
    }
  };
}
