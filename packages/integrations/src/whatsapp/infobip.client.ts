/**
 * Infobip WhatsApp Client
 * Handles sending and receiving WhatsApp messages via Infobip
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface InfobipConfig {
  apiKey: string;
  baseUrl: string;
  senderNumber: string;
}

export interface WhatsAppMessage {
  to: string;
  content: {
    type: 'text' | 'image' | 'document' | 'template';
    text?: string;
    mediaUrl?: string;
    caption?: string;
    templateName?: string;
    templateData?: Record<string, string>;
  };
}

export interface WhatsAppMessageResponse {
  messageId: string;
  status: string;
  to: string;
}

export interface InteractiveListPayload {
  body: string;
  buttonText: string;
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
  header?: string;
  footer?: string;
}

export interface InteractiveButtonsPayload {
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
}

export interface IncomingWhatsAppMessage {
  messageId: string;
  from: string;
  to: string;
  receivedAt: Date;
  content: {
    type: 'text' | 'image' | 'document' | 'audio' | 'location' | 'contact';
    text?: string;
    mediaUrl?: string;
    caption?: string;
    mimeType?: string;
    fileName?: string;
    durationMs?: number;
    latitude?: number;
    longitude?: number;
  };
  context?: {
    messageId: string;
  };
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function firstObject(value: unknown): JsonObject | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return asObject(value[0]);
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function pickFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function parseReceivedAt(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export class InfobipClient {
  private baseUrl: string;
  private apiKey: string;
  private senderNumber: string;

  constructor(config: InfobipConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    // Infobip requires numbers WITHOUT the + prefix. Also strip any invisible/unicode
    // marks or formatting characters to avoid REJECTED_SOURCE errors.
    this.senderNumber = (config.senderNumber || '').replace(/\D/g, '');
  }

  /**
   * Send a text message
   */
  async sendText(to: string, text: string): Promise<WhatsAppMessageResponse> {
    return this.sendMessage({
      to,
      content: { type: 'text', text },
    });
  }

  /**
   * Send an image
   */
  async sendImage(to: string, mediaUrl: string, caption?: string): Promise<WhatsAppMessageResponse> {
    return this.sendMessage({
      to,
      content: { type: 'image', mediaUrl, caption },
    });
  }

  /**
   * Send a document
   */
  async sendDocument(to: string, mediaUrl: string, caption?: string): Promise<WhatsAppMessageResponse> {
    return this.sendMessage({
      to,
      content: { type: 'document', mediaUrl, caption },
    });
  }

  /**
   * Send a template message (HSM)
   */
  async sendTemplate(
    to: string,
    templateName: string,
    templateData: Record<string, string>
  ): Promise<WhatsAppMessageResponse> {
    return this.sendMessage({
      to,
      content: { type: 'template', templateName, templateData },
    });
  }

  /**
   * Send an interactive list message
   */
  async sendInteractiveList(to: string, payload: InteractiveListPayload): Promise<WhatsAppMessageResponse> {
    const normalizedTo = this.normalizeTo(to);
    const endpoint = `${this.baseUrl}/whatsapp/1/message/interactive/list`;
    const body = {
      from: this.senderNumber,
      to: normalizedTo,
      content: {
        body: {
          text: payload.body,
        },
        action: {
          title: payload.buttonText,
          sections: payload.sections,
        },
        ...(payload.header
          ? {
              header: {
                type: 'TEXT',
                text: payload.header,
              },
            }
          : {}),
        ...(payload.footer
          ? {
              footer: {
                text: payload.footer,
              },
            }
          : {}),
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `App ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new InfobipError(
        `Failed to send message: ${response.status}`,
        response.status,
        error
      );
    }

    const data = await response.json() as {
      messages?: Array<{ messageId?: string; status?: { name?: string; groupName?: string; description?: string } }>;
      messageId?: string;
      status?: { name?: string; groupName?: string; description?: string };
    };

    const messageId = data.messages?.[0]?.messageId || data.messageId || '';
    const statusName = data.messages?.[0]?.status?.name || data.status?.name || 'PENDING';
    const statusGroup = data.messages?.[0]?.status?.groupName || data.status?.groupName || '';
    const statusDescription = data.messages?.[0]?.status?.description || data.status?.description || '';

    if (
      statusGroup.toUpperCase() === 'REJECTED' ||
      statusName.toUpperCase().startsWith('REJECTED')
    ) {
      throw new InfobipError(
        `Message rejected: ${statusName}${statusDescription ? ` (${statusDescription})` : ''}`,
        response.status,
        JSON.stringify(data)
      );
    }

    return {
      messageId,
      status: statusName,
      to: normalizedTo,
    };
  }

  /**
   * Send an interactive buttons message
   */
  async sendInteractiveButtons(to: string, payload: InteractiveButtonsPayload): Promise<WhatsAppMessageResponse> {
    const normalizedTo = this.normalizeTo(to);
    const endpoint = `${this.baseUrl}/whatsapp/1/message/interactive/buttons`;
    const body = {
      from: this.senderNumber,
      to: normalizedTo,
      content: {
        body: {
          text: payload.body,
        },
        action: {
          buttons: payload.buttons.map((button) => ({
            type: 'REPLY',
            id: button.id,
            title: button.title,
          })),
        },
        ...(payload.header
          ? {
              header: {
                type: 'TEXT',
                text: payload.header,
              },
            }
          : {}),
        ...(payload.footer
          ? {
              footer: {
                text: payload.footer,
              },
            }
          : {}),
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `App ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new InfobipError(
        `Failed to send message: ${response.status}`,
        response.status,
        error
      );
    }

    const data = await response.json() as {
      messages?: Array<{ messageId?: string; status?: { name?: string; groupName?: string; description?: string } }>;
      messageId?: string;
      status?: { name?: string; groupName?: string; description?: string };
    };

    const messageId = data.messages?.[0]?.messageId || data.messageId || '';
    const statusName = data.messages?.[0]?.status?.name || data.status?.name || 'PENDING';
    const statusGroup = data.messages?.[0]?.status?.groupName || data.status?.groupName || '';
    const statusDescription = data.messages?.[0]?.status?.description || data.status?.description || '';

    if (
      statusGroup.toUpperCase() === 'REJECTED' ||
      statusName.toUpperCase().startsWith('REJECTED')
    ) {
      throw new InfobipError(
        `Message rejected: ${statusName}${statusDescription ? ` (${statusDescription})` : ''}`,
        response.status,
        JSON.stringify(data)
      );
    }

    return {
      messageId,
      status: statusName,
      to: normalizedTo,
    };
  }

  /**
   * Send a message via Infobip API
   */
  async sendMessage(message: WhatsAppMessage): Promise<WhatsAppMessageResponse> {
    const endpointType = message.content.type;
    let body: Record<string, unknown>;
    const normalizedTo = this.normalizeTo(message.to);

    if (message.content.type === 'text') {
      body = {
        from: this.senderNumber,
        to: normalizedTo,
        content: {
          text: message.content.text,
        },
      };
    } else if (message.content.type === 'image' || message.content.type === 'document') {
      body = {
        from: this.senderNumber,
        to: normalizedTo,
        content: {
          mediaUrl: message.content.mediaUrl,
          caption: message.content.caption,
        },
      };
    } else if (message.content.type === 'template') {
      body = {
        from: this.senderNumber,
        to: normalizedTo,
        content: {
          templateName: message.content.templateName,
          templateData: {
            body: {
              placeholders: Object.values(message.content.templateData || {}),
            },
          },
          language: 'es',
        },
      };
    } else {
      throw new Error(`Unsupported message type: ${String(endpointType)}`);
    }

    const endpoint = `${this.baseUrl}/whatsapp/1/message/${endpointType}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `App ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new InfobipError(
        `Failed to send message: ${response.status}`,
        response.status,
        error
      );
    }

    const data = await response.json() as {
      messages?: Array<{ messageId?: string; status?: { name?: string; groupName?: string; description?: string } }>;
      messageId?: string;
      status?: { name?: string; groupName?: string; description?: string };
    };

    const messageId = data.messages?.[0]?.messageId || data.messageId || '';
    const statusName = data.messages?.[0]?.status?.name || data.status?.name || 'PENDING';
    const statusGroup = data.messages?.[0]?.status?.groupName || data.status?.groupName || '';
    const statusDescription = data.messages?.[0]?.status?.description || data.status?.description || '';

    if (
      statusGroup.toUpperCase() === 'REJECTED' ||
      statusName.toUpperCase().startsWith('REJECTED')
    ) {
      throw new InfobipError(
        `Message rejected: ${statusName}${statusDescription ? ` (${statusDescription})` : ''}`,
        response.status,
        JSON.stringify(data)
      );
    }

    return {
      messageId,
      status: statusName,
      to: normalizedTo,
    };
  }

  /**
   * Parse incoming webhook payload
   */
  parseIncomingMessage(payload: unknown): IncomingWhatsAppMessage | null {
    try {
      const payloadObj = asObject(payload);
      const result = firstObject(payloadObj?.results);
      if (!result) return null;

      const eventType = pickString(result.event)?.toUpperCase() ?? null;
      if (eventType && eventType !== 'MO') return null;

      const messageObj = asObject(result.message);
      const content = firstObject(result.content);
      const context = asObject(result.context);

      const messageId = pickString(result.messageId);
      const from = pickString(result.from, result.sender);
      const to = pickString(result.to, result.destination);

      if (!messageId || !from || !to) return null;

      const message: IncomingWhatsAppMessage = {
        messageId,
        from,
        to,
        receivedAt: parseReceivedAt(result.receivedAt),
        content: {
          type: 'text',
        },
      };

      // Parse content based on type (support legacy and new formats)
      const contentType = pickString(content?.type)?.toUpperCase() ?? '';
      const messageType = pickString(messageObj?.type)?.toUpperCase() ?? '';
      const interactiveType = messageType || contentType;
      const mediaUrl = pickString(content?.mediaUrl, content?.url, messageObj?.url, messageObj?.mediaUrl);
      const mimeType = pickString(content?.mimeType, content?.mimetype, messageObj?.mimeType, messageObj?.mimetype);
      const fileName = pickString(content?.fileName, content?.filename, messageObj?.fileName, messageObj?.filename);
      const durationValue = pickFiniteNumber(content?.duration, messageObj?.duration, messageObj?.durationMs, messageObj?.audioDuration);
      const durationMs = durationValue !== undefined ? Math.trunc(durationValue) : undefined;
      const isAudioType =
        contentType === 'AUDIO'
        || contentType === 'VOICE'
        || contentType === 'VOICE_MESSAGE'
        || messageType === 'AUDIO'
        || messageType === 'VOICE'
        || messageType === 'VOICE_MESSAGE';
      const isAudioMime = typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('audio/');

      if (interactiveType.includes('INTERACTIVE') || interactiveType.includes('BUTTON_REPLY')) {
        const replyId = pickString(messageObj?.id, content?.id, messageObj?.payload, content?.payload);
        const replyTitle = pickString(messageObj?.title, content?.title, messageObj?.text, content?.text);
        message.content = {
          type: 'text',
          text: replyId || replyTitle,
        };
      } else if (pickString(content?.text, messageObj?.text)) {
        message.content = {
          type: 'text',
          text: pickString(content?.text, messageObj?.text),
        };
      } else if (
        (mediaUrl || pickString(messageObj?.audioUrl)) &&
        (isAudioType || isAudioMime || Boolean(pickString(messageObj?.audioUrl)))
      ) {
        message.content = {
          type: 'audio',
          mediaUrl: mediaUrl || pickString(messageObj?.audioUrl),
          mimeType,
          fileName,
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
      } else if (
        mediaUrl &&
        contentType.toLowerCase() === 'image'
      ) {
        message.content = {
          type: 'image',
          mediaUrl,
          caption: pickString(content?.caption),
        };
      } else if (
        mediaUrl &&
        contentType.toLowerCase() === 'document'
      ) {
        message.content = {
          type: 'document',
          mediaUrl,
          caption: pickString(content?.caption),
        };
      } else if (pickString(messageObj?.imageUrl)) {
        message.content = {
          type: 'image',
          mediaUrl: pickString(messageObj?.imageUrl),
          caption: pickString(messageObj?.caption),
        };
      } else if (pickString(messageObj?.documentUrl)) {
        message.content = {
          type: 'document',
          mediaUrl: pickString(messageObj?.documentUrl),
          caption: pickString(messageObj?.caption),
        };
      } else if (asObject(messageObj?.location)) {
        const location = asObject(messageObj?.location);
        const latitude = pickFiniteNumber(location?.latitude);
        const longitude = pickFiniteNumber(location?.longitude);
        if (latitude === undefined || longitude === undefined) return message;
        message.content = {
          type: 'location',
          latitude,
          longitude,
        };
      }

      // Context for replies
      const contextMessageId = pickString(context?.messageId);
      if (contextMessageId) {
        message.context = {
          messageId: contextMessageId,
        };
      }

      return message;
    } catch {
      return null;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean {
    // Infobip uses HMAC-SHA256 for webhook signatures
    const provided = (signature.startsWith('sha256=') ? signature.slice(7) : signature)
      .trim()
      .toLowerCase();
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(provided), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  /**
   * Check if the connection is healthy
   */
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/whatsapp/1/senders`, {
        headers: {
          'Authorization': `App ${this.apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        return { healthy: true };
      }

      return {
        healthy: false,
        message: `API returned ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private normalizeTo(to: string): string {
    const digits = to.replace(/\D/g, '');
    return digits || to;
  }
}

export class InfobipError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = 'InfobipError';
  }
}
