/**
 * Infobip WhatsApp Client
 * Handles sending and receiving WhatsApp messages via Infobip
 */

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
    type: 'text' | 'image' | 'document' | 'location' | 'contact';
    text?: string;
    mediaUrl?: string;
    caption?: string;
    latitude?: number;
    longitude?: number;
  };
  context?: {
    messageId: string;
  };
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
    let endpointType = message.content.type;
    let body: any;
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
      throw new Error(`Unsupported message type: ${message.content.type}`);
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
  parseIncomingMessage(payload: any): IncomingWhatsAppMessage | null {
    try {
      const result = payload.results?.[0];
      if (!result) return null;
      const eventType = typeof result.event === 'string' ? result.event.toUpperCase() : null;
      if (eventType && eventType !== 'MO') return null;

      const message: IncomingWhatsAppMessage = {
        messageId: result.messageId,
        from: result.from || result.sender,
        to: result.to || result.destination,
        receivedAt: new Date(result.receivedAt),
        content: {
          type: 'text',
        },
      };

      // Parse content based on type (support legacy and new formats)
      const content = result.content?.[0];

      const contentType = typeof content?.type === 'string' ? content.type.toUpperCase() : '';
      const messageType = typeof result.message?.type === 'string' ? result.message.type.toUpperCase() : '';
      const interactiveType = messageType || contentType;

      if (interactiveType.includes('INTERACTIVE') || interactiveType.includes('BUTTON_REPLY')) {
        const replyId = result.message?.id || content?.id || result.message?.payload || content?.payload;
        const replyTitle = result.message?.title || content?.title || result.message?.text || content?.text;
        message.content = {
          type: 'text',
          text: replyId || replyTitle,
        };
      } else if (content?.text || result.message?.text) {
        message.content = {
          type: 'text',
          text: content?.text || result.message.text,
        };
      } else if (
        (content?.mediaUrl || content?.url) &&
        content?.type?.toLowerCase() === 'image'
      ) {
        message.content = {
          type: 'image',
          mediaUrl: content.mediaUrl || content.url,
          caption: content.caption,
        };
      } else if (
        (content?.mediaUrl || content?.url) &&
        content?.type?.toLowerCase() === 'document'
      ) {
        message.content = {
          type: 'document',
          mediaUrl: content.mediaUrl || content.url,
          caption: content.caption,
        };
      } else if (result.message?.imageUrl) {
        message.content = {
          type: 'image',
          mediaUrl: result.message.imageUrl,
          caption: result.message.caption,
        };
      } else if (result.message?.documentUrl) {
        message.content = {
          type: 'document',
          mediaUrl: result.message.documentUrl,
          caption: result.message.caption,
        };
      } else if (result.message?.location) {
        message.content = {
          type: 'location',
          latitude: result.message.location.latitude,
          longitude: result.message.location.longitude,
        };
      }

      // Context for replies
      if (result.context?.messageId) {
        message.context = {
          messageId: result.context.messageId,
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
    const crypto = require('crypto');
    const provided = (signature.startsWith('sha256=') ? signature.slice(7) : signature)
      .trim()
      .toLowerCase();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expectedSignature));
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
