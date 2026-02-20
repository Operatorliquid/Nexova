/**
 * Outbox Relay Job
 * Publishes pending outbox events (placeholder relay)
 */
import { type PrismaClient, type Prisma } from '@prisma/client';
import { type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { decrypt } from '@nexova/core';
import { EvolutionClient, InfobipClient } from '@nexova/integrations';
import { type OutboxRelayPayload } from '@nexova/shared';

interface OutboxRelayResult {
  processed: number;
  failed: number;
}

const DEFAULT_REALTIME_CHANNEL = 'nexova:realtime';
const OWNER_WHATSAPP_NOTIFICATION_EVENT = 'owner.whatsapp_notification';
const COMMUNICATION_BROADCAST_EVENT = 'communications.broadcast_send';
const MAX_OUTBOX_RETRIES = 10;

function formatMoneyCents(value: number): string {
  return Math.round(value / 100).toLocaleString('es-AR');
}

function formatDateLabel(value: Date): string {
  return value.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPromotionRules(metadata: unknown): { buyQuantity: number; payQuantity: number } | null {
  const metadataRecord = asRecord(metadata);
  const rulesRecord = asRecord(metadataRecord?.promoRules) || asRecord(metadataRecord?.rules);
  if (!rulesRecord) return null;

  const buyRaw = rulesRecord.buyQuantity;
  const payRaw = rulesRecord.payQuantity;
  const buyQuantity =
    typeof buyRaw === 'number' && Number.isFinite(buyRaw)
      ? Math.trunc(buyRaw)
      : typeof buyRaw === 'string' && Number.isFinite(Number(buyRaw))
        ? Math.trunc(Number(buyRaw))
        : null;
  const payQuantity =
    typeof payRaw === 'number' && Number.isFinite(payRaw)
      ? Math.trunc(payRaw)
      : typeof payRaw === 'string' && Number.isFinite(Number(payRaw))
        ? Math.trunc(Number(payRaw))
        : null;
  if (!buyQuantity || !payQuantity) return null;
  return { buyQuantity, payQuantity };
}

function buildPromotionValueLabel(params: {
  promoType: string;
  value: number;
  productPrice: number;
  metadata: unknown;
}): string {
  const { promoType, value, productPrice, metadata } = params;
  if (promoType === 'percentage') {
    return `${Math.max(0, Math.min(100, value))}% OFF`;
  }
  if (promoType === 'fixed_price') {
    return `Precio promo $${formatMoneyCents(Math.max(0, value))}`;
  }
  if (promoType === 'second_unit_percentage') {
    const percent = Math.max(0, Math.min(100, value));
    return `${percent}% OFF en la 2da unidad`;
  }
  if (promoType === 'buy_x_pay_y') {
    const rules = readPromotionRules(metadata) || { buyQuantity: 2, payQuantity: 1 };
    return `${rules.buyQuantity}x${rules.payQuantity}`;
  }
  if (productPrice > 0) {
    return `Promo activa`;
  }
  return `${value}`;
}

function buildBroadcastMessageText(campaign: {
  name: string;
  message: string;
  promotion: {
    name: string;
    promoType: string;
    value: number;
    endsAt: Date;
    metadata: unknown;
    product: {
      name: string;
      price: number;
      unit?: string | null;
      unitValue?: string | null;
      secondaryUnit?: string | null;
      secondaryUnitValue?: string | null;
    } | null;
  } | null;
}): string {
  const lines: string[] = [];
  const campaignName = campaign.name.trim();
  if (campaignName) {
    lines.push(`📢 *${campaignName}*`);
  }

  if (campaign.promotion) {
    const promotion = campaign.promotion;
    lines.push(`🔥 Promo: *${promotion.name}*`);
    if (promotion.product) {
      const product = promotion.product;
      const unitSuffix =
        product.unitValue && product.unit ? ` ${product.unitValue} ${product.unit}` : '';
      lines.push(`🛍️ Producto: ${product.name}${unitSuffix}`.trim());
      const valueLabel = buildPromotionValueLabel({
        promoType: promotion.promoType,
        value: promotion.value,
        productPrice: product.price,
        metadata: promotion.metadata,
      });
      lines.push(`💸 Beneficio: ${valueLabel}`);
    }
    lines.push(`⏳ Vigencia: hasta ${formatDateLabel(promotion.endsAt)}`);
  }

  const trimmedMessage = campaign.message.trim();
  if (trimmedMessage) {
    if (lines.length > 0) lines.push('');
    lines.push(trimmedMessage);
  }

  return lines.join('\n').trim();
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

async function sendWhatsAppMessage(
  prisma: PrismaClient,
  params: { workspaceId: string; to: string; text: string; imageUrl?: string | null }
): Promise<{ provider: string; messageId: string }> {
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
    const result = params.imageUrl
      ? await client.sendImage(params.to, params.imageUrl, params.text)
      : await client.sendText(params.to, params.text);
    return { provider, messageId: result.messageId };
  }

  const client = new InfobipClient({
    apiKey,
    baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
    senderNumber: whatsappNumber.phoneNumber,
  });

  const result = params.imageUrl
    ? await client.sendImage(params.to, params.imageUrl, params.text)
    : await client.sendText(params.to, params.text);
  return { provider, messageId: result.messageId };
}

async function refreshBroadcastCampaignStatus(
  prisma: PrismaClient,
  params: { workspaceId: string; campaignId: string; now: Date }
): Promise<void> {
  const counts = await prisma.broadcastRecipient.groupBy({
    by: ['status'],
    where: {
      workspaceId: params.workspaceId,
      campaignId: params.campaignId,
    },
    _count: { _all: true },
  });

  let pending = 0;
  let sent = 0;
  let failed = 0;
  for (const row of counts) {
    if (row.status === 'pending') pending = row._count._all;
    if (row.status === 'sent') sent = row._count._all;
    if (row.status === 'failed') failed = row._count._all;
  }

  let status = 'processing';
  let finishedAt: Date | null = null;
  if (pending === 0) {
    finishedAt = params.now;
    if (sent > 0 && failed === 0) status = 'completed';
    else if (sent > 0 && failed > 0) status = 'partial';
    else if (sent === 0 && failed > 0) status = 'failed';
  }

  await prisma.broadcastCampaign.updateMany({
    where: { id: params.campaignId, workspaceId: params.workspaceId },
    data: {
      totalRecipients: sent + failed + pending,
      sentCount: sent,
      failedCount: failed,
      status,
      finishedAt,
    },
  });
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
      OR: [
        { status: 'pending' },
        { status: 'failed', retryCount: { lt: MAX_OUTBOX_RETRIES } },
      ],
      ...(maxAgeMs ? { createdAt: { lte: new Date(Date.now() - maxAgeMs) } } : {}),
    };

    const events = await prisma.eventOutbox.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let processed = 0;
    let failed = 0;
    const campaignMessageCache = new Map<string, { message: string; imageUrl: string | null }>();

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

        if (event.eventType === COMMUNICATION_BROADCAST_EVENT) {
          const payload = (event.payload as Record<string, unknown>) || {};
          const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : '';
          const recipientId = typeof payload.recipientId === 'string' ? payload.recipientId : '';
          const to = typeof payload.to === 'string' ? payload.to : '';
          if (!campaignId || !recipientId || !to.trim()) {
            throw new Error('Invalid broadcast payload');
          }

          const recipient = await prisma.broadcastRecipient.findFirst({
            where: {
              id: recipientId,
              campaignId,
              workspaceId: event.workspaceId,
            },
            select: {
              id: true,
              status: true,
            },
          });

          if (!recipient) {
            throw new Error('Broadcast recipient not found');
          }

          if (recipient.status === 'sent') {
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

          let campaignMessage = campaignMessageCache.get(campaignId);
          if (!campaignMessage) {
            const campaign = await prisma.broadcastCampaign.findFirst({
              where: {
                id: campaignId,
                workspaceId: event.workspaceId,
              },
              select: {
                id: true,
                name: true,
                message: true,
                imageUrl: true,
                promotion: {
                  select: {
                    name: true,
                    promoType: true,
                    value: true,
                    endsAt: true,
                    metadata: true,
                    product: {
                      select: {
                        name: true,
                        price: true,
                        unit: true,
                        unitValue: true,
                        secondaryUnit: true,
                        secondaryUnitValue: true,
                      },
                    },
                  },
                },
              },
            });
            if (!campaign) {
              throw new Error('Broadcast campaign not found');
            }
            campaignMessage = {
              message: buildBroadcastMessageText({
                name: campaign.name,
                message: campaign.message,
                promotion: campaign.promotion
                  ? {
                      name: campaign.promotion.name,
                      promoType: campaign.promotion.promoType,
                      value: campaign.promotion.value,
                      endsAt: campaign.promotion.endsAt,
                      metadata: campaign.promotion.metadata,
                      product: campaign.promotion.product,
                    }
                  : null,
              }),
              imageUrl: campaign.imageUrl || null,
            };
            campaignMessageCache.set(campaignId, campaignMessage);
          }

          try {
            const sendResult = await sendWhatsAppMessage(prisma, {
              workspaceId: event.workspaceId,
              to,
              text: campaignMessage.message,
              imageUrl: campaignMessage.imageUrl,
            });

            await prisma.broadcastRecipient.updateMany({
              where: {
                id: recipientId,
                campaignId,
                workspaceId: event.workspaceId,
              },
              data: {
                status: 'sent',
                provider: sendResult.provider,
                providerMessageId: sendResult.messageId,
                errorMessage: null,
                sentAt: now,
              },
            });

            await refreshBroadcastCampaignStatus(prisma, {
              workspaceId: event.workspaceId,
              campaignId,
              now,
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
          } catch (error) {
            await prisma.broadcastRecipient.updateMany({
              where: {
                id: recipientId,
                campaignId,
                workspaceId: event.workspaceId,
              },
              data: {
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              },
            });

            await refreshBroadcastCampaignStatus(prisma, {
              workspaceId: event.workspaceId,
              campaignId,
              now,
            });

            throw error;
          }
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
