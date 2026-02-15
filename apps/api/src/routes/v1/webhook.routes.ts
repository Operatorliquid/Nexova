/**
 * Webhook Routes
 * Handles incoming webhooks from external providers (Infobip, etc.)
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { QUEUES, AgentProcessPayload } from '@nexova/shared';
import { InfobipClient } from '@nexova/integrations';
import { decrypt } from '@nexova/core';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// BullMQ queue - initialized when routes are registered
let agentQueue: Queue;

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

function extractEvolutionMessages(payload: any): any[] {
  const data = payload?.data ?? payload?.message ?? payload?.messages;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return [data];
}

function extractEvolutionQrInfo(payload: any): { qrCode?: string; qrDataUrl?: string; pairingCode?: string } {
  const getString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

  const qrCandidate =
    getString(payload?.data?.qrcode)
    || getString(payload?.data?.qrCode)
    || getString(payload?.data?.code)
    || getString(payload?.qrcode)
    || getString(payload?.qrCode)
    || getString(payload?.code);

  const isDataUrl = !!qrCandidate && /^data:image\//i.test(qrCandidate);

  const pairingCandidate =
    getString(payload?.data?.pairingCode)
    || getString(payload?.data?.pairing_code)
    || getString(payload?.pairingCode)
    || getString(payload?.pairing_code);

  const qrCode = qrCandidate && !isDataUrl ? qrCandidate : undefined;
  const qrDataUrl = qrCandidate && isDataUrl ? qrCandidate : undefined;

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

function evolutionRemoteJidToE164(remoteJid: string | null | undefined): string | null {
  if (!remoteJid || typeof remoteJid !== 'string') return null;
  // remoteJid example: "553198296801@s.whatsapp.net"
  const base = remoteJid.split('@')[0] || '';
  const digits = toPhoneDigits(base);
  if (!digits) return null;
  return `+${digits}`;
}

function extractEvolutionMessageId(msg: any): string | null {
  const id =
    msg?.key?.id ||
    msg?.messageId ||
    msg?.id ||
    msg?.msgId ||
    null;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function isEvolutionInboundMessage(msg: any): boolean {
  // Baileys-style events include msg.key.fromMe
  const fromMe = msg?.key?.fromMe;
  if (typeof fromMe === 'boolean') return !fromMe;
  // If not present, assume inbound
  return true;
}

function extractEvolutionReplyContext(msg: any): { isReply: boolean; referredMessageId?: string } {
  const ctx =
    msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.buttonsResponseMessage?.contextInfo
    || msg?.message?.listResponseMessage?.contextInfo
    || msg?.message?.imageMessage?.contextInfo
    || msg?.message?.documentMessage?.contextInfo
    || null;

  const referred =
    (typeof ctx?.stanzaId === 'string' && ctx.stanzaId.trim()) ? ctx.stanzaId.trim()
      : (typeof ctx?.quotedMessageId === 'string' && ctx.quotedMessageId.trim()) ? ctx.quotedMessageId.trim()
        : undefined;

  return { isReply: !!referred, ...(referred ? { referredMessageId: referred } : {}) };
}

export async function webhookRoutes(
  app: FastifyInstance,
  opts: { queue?: Queue }
): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
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

  const fetchEvolutionMediaBase64 = async (params: {
    baseUrl: string;
    apiKey: string;
    instanceName: string;
    messageId: string;
  }): Promise<{ base64: string; mimetype?: string; filename?: string } | null> => {
    const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(params.instanceName)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: params.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        message: { key: { id: params.messageId } },
        convertToMp4: false,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      app.log.warn({ status: response.status, body: text }, 'Evolution media fetch failed');
      return null;
    }

    const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
    const raw = json ?? text;

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
      if (!base64) return null;
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

    const fileRef = `${publicBase}/uploads/whatsapp-media/${unique}`;
    return { fileRef, fileType };
  };

  // Capture raw body for signature verification (scoped to webhook routes)
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      request.rawBody = body as Buffer;
      try {
        const json = JSON.parse((body as Buffer).toString('utf8'));
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
    Body: any;
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
      const payload = request.body as any;

      request.log.info({ numberId, payload }, 'Received Infobip webhook');

      try {
        const eventType = payload?.results?.[0]?.event;
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
          request.log.warn({ payload }, 'Could not parse incoming message');
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

        // Store in webhook inbox for processing
        const correlationId = crypto.randomUUID();
        await app.prisma.webhookInbox.create({
          data: {
            workspaceId: whatsappNumber.workspaceId!,
            provider: 'infobip',
            externalId: parsed.messageId,
            eventType: 'message.received',
            payload: payload as Prisma.InputJsonValue,
            signature: getWebhookSignature(request) || null,
            status: 'pending',
            correlationId,
          },
        });

        // Queue for agent processing
        if (agentQueue) {
          const jobPayload: AgentProcessPayload = {
            workspaceId: whatsappNumber.workspaceId!,
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
          request.log.warn('Agent queue not initialized, message stored but not queued');
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
  app.post<{
    Params: { secret: string };
    Body: any;
  }>('/evolution/:secret', {
    schema: {
      params: {
        type: 'object',
        properties: { secret: { type: 'string' } },
        required: ['secret'],
      },
    },
    handler: async (request, reply) => {
      const { secret } = request.params;
      const payload = request.body as any;

      request.log.info({ provider: 'evolution', event: payload?.event, instance: payload?.instance }, 'Received Evolution webhook');

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

        const rawEvent = (payload?.event ?? payload?.eventType ?? '') as unknown;
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
          // Some Evolution builds include the QR payload in CONNECTION_UPDATE.
          const qr = extractEvolutionQrInfo(payload);
          if (qr.qrCode || qr.qrDataUrl || qr.pairingCode) {
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
          }

          // We keep this endpoint lightweight. The workspace polls status via /whatsapp/evolution/status.
          return reply.send({ status: 'received', event: 'CONNECTION_UPDATE' });
        }

        if (event && event !== 'MESSAGES_UPSERT') {
          // Ignore other non-message events.
          return reply.send({ status: 'ignored', reason: 'non_message_event', event });
        }

        const messages = extractEvolutionMessages(payload);
        if (messages.length === 0) {
          return reply.send({ status: 'ignored', reason: 'missing_message' });
        }

        let queued = 0;
        for (const msg of messages) {
          if (!isEvolutionInboundMessage(msg)) continue;

          const messageId = extractEvolutionMessageId(msg) || crypto.randomUUID();
          const remoteJid = msg?.key?.remoteJid || msg?.remoteJid || payload?.data?.key?.remoteJid;
          if (typeof remoteJid === 'string' && remoteJid.includes('@g.us')) {
            // Ignore group messages by default
            continue;
          }

          const senderPhone = evolutionRemoteJidToE164(remoteJid) || 'unknown';

          // Dedupe
          const existing = await app.prisma.webhookInbox.findFirst({
            where: {
              externalId: messageId,
              workspaceId: whatsappNumber.workspaceId,
              provider: 'evolution',
            },
          });
          if (existing) continue;

          const correlationId = crypto.randomUUID();
          let attachment:
            | { fileRef: string; fileType: 'image' | 'pdf'; caption?: string }
            | null = null;

          const msgBody = msg?.message || {};
          const imageMsg = msgBody?.imageMessage;
          const docMsg = msgBody?.documentMessage;
          const hasMedia = !!imageMsg || !!docMsg;

          if (hasMedia) {
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
                });

                const caption =
                  (typeof imageMsg?.caption === 'string' && imageMsg.caption.trim())
                    ? imageMsg.caption.trim()
                    : (typeof docMsg?.caption === 'string' && docMsg.caption.trim())
                      ? docMsg.caption.trim()
                      : undefined;

                const mimetype =
                  (typeof imageMsg?.mimetype === 'string' && imageMsg.mimetype.trim())
                    ? imageMsg.mimetype.trim()
                    : (typeof docMsg?.mimetype === 'string' && docMsg.mimetype.trim())
                      ? docMsg.mimetype.trim()
                      : media?.mimetype;

                const filenameHint =
                  (typeof docMsg?.fileName === 'string' && docMsg.fileName.trim())
                    ? docMsg.fileName.trim()
                    : media?.filename;

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

          const storedPayload = {
            event: payload?.event,
            instance: payload?.instance,
            data: msg,
            ...(attachment ? { __nexova: { attachment } } : {}),
          };
          await app.prisma.webhookInbox.create({
            data: {
              workspaceId: whatsappNumber.workspaceId,
              provider: 'evolution',
              externalId: messageId,
              eventType: 'message.received',
              payload: storedPayload as Prisma.InputJsonValue,
              signature: null,
              status: 'pending',
              correlationId,
            },
          });

          if (agentQueue) {
            const ctx = extractEvolutionReplyContext(msg);
            const jobPayload: AgentProcessPayload = {
              workspaceId: whatsappNumber.workspaceId,
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
    },
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
    Body: any;
  }>('/infobip/:numberId/delivery', {
	    handler: async (request, reply) => {
	      const { numberId } = request.params;
	      const payload = request.body as any;

	      request.log.info({ numberId, payload }, 'Received Infobip delivery report');

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

        const result = payload?.results?.[0] ?? payload?.messages?.[0] ?? payload;
        const messageId =
          result?.messageId ||
          result?.message?.id ||
          result?.id ||
          result?.externalId;
        if (!messageId) {
          request.log.warn({ numberId, payload }, 'Delivery report missing messageId');
          return reply.send({ status: 'ignored', reason: 'missing_message_id' });
        }

        const statusName =
          result?.status?.name ||
          result?.status ||
          result?.message?.status?.name ||
          'unknown';
        const statusGroup =
          result?.status?.groupName ||
          result?.message?.status?.groupName ||
          '';
        const statusDescription =
          result?.status?.description ||
          result?.message?.status?.description ||
          '';
        const reportedAtRaw =
          result?.doneAt ||
          result?.timestamp ||
          result?.sentAt ||
          result?.receivedAt ||
          result?.reportTime;
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
              raw: result ?? payload,
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
      const payload = request.body as any;

      request.log.info({ payload }, 'Received WhatsApp webhook');

      try {
        // Extract the receiver number from Infobip payload
        // Infobip MO_MESSAGES_API_JSON format uses: destination (not to)
        const result = payload?.results?.[0];
        const eventType = typeof result?.event === 'string' ? result.event.toUpperCase() : undefined;
        if (eventType && eventType !== 'MO') {
          request.log.info({ eventType }, 'Ignoring non-MO webhook event');
          return reply.send({ status: 'ignored', reason: 'non_mo_event', eventType });
        }
        let receiverNumber: string | null = null;

        if (result?.destination) {
          receiverNumber = result.destination;
        } else if (result?.to) {
          receiverNumber = result.to;
        } else if (payload?.to) {
          receiverNumber = payload.to;
        }

        if (!receiverNumber) {
          request.log.warn({ payload }, 'Could not extract receiver number from payload');
          // Return 200 to prevent Infobip retries
          return reply.send({ status: 'ignored', reason: 'missing_receiver' });
        }

        // Extract message ID for deduplication
        const messageId = result?.messageId || crypto.randomUUID();

        // Normalize the number (remove spaces, ensure + prefix)
        const receiverCandidates = buildPhoneCandidates(receiverNumber);
        const senderRaw = result?.sender || result?.from || null;
        const senderCandidates = buildPhoneCandidates(senderRaw);

        const findNumberByCandidates = async (candidates: string[]) => {
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
        await app.prisma.webhookInbox.create({
          data: {
            workspaceId: whatsappNumber.workspaceId,
            provider: 'infobip',
            externalId: messageId,
            eventType: 'message.received',
            payload: payload as Prisma.InputJsonValue,
            signature: getWebhookSignature(request) || null,
            status: 'pending',
            correlationId,
          },
        });

        // Extract sender for job payload (prefer the inferred one in case payload swaps fields)
        const senderNumber = assumedSender || 'unknown';

        // Queue for agent processing (DO NOT call LLM here)
        if (agentQueue) {
          const jobPayload: AgentProcessPayload = {
            workspaceId: whatsappNumber.workspaceId,
            messageId,
            channelId: senderNumber,
            channelType: 'whatsapp',
            correlationId,
            metadata: {
              isReply: !!result?.context?.messageId,
              referredMessageId: result?.context?.messageId,
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
          request.log.warn('Agent queue not initialized, message stored but not queued');
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
      console.log('=== DEBUG WEBHOOK RECEIVED ===');
      console.log('Headers:', JSON.stringify(request.headers, null, 2));
      console.log('Body:', JSON.stringify(request.body, null, 2));
      console.log('==============================');
      return reply.send({ status: 'received', timestamp: new Date().toISOString() });
    });

    /**
     * Catch-all for any unmatched POST requests
     */
    app.post('/*', async (request, reply) => {
      console.log('=== CATCH-ALL WEBHOOK ===');
      console.log('URL:', request.url);
      console.log('Body:', JSON.stringify(request.body, null, 2));
      console.log('=========================');
      return reply.send({ status: 'caught', url: request.url });
    });
  }
}
