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

export async function webhookRoutes(
  app: FastifyInstance,
  opts: { queue?: Queue }
): Promise<void> {
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
