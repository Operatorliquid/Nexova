/**
 * Evolution API (v2) WhatsApp Client
 * Sends WhatsApp messages through an Evolution API server (Baileys / WhatsApp Business engine).
 *
 * Docs: https://doc.evolution-api.com/v2/en/get-started/introduction
 */

export type EvolutionIntegrationEngine = 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS';

export interface EvolutionAdminConfig {
  apiKey: string;
  baseUrl: string;
}

export interface EvolutionInstanceConfig extends EvolutionAdminConfig {
  instanceName: string;
}

export interface EvolutionSendResponse {
  messageId: string;
  status: string;
  to: string;
  raw?: unknown;
}

export interface EvolutionConnectResponse {
  pairingCode?: string;
  code?: string;
  count?: number;
}

export interface EvolutionConnectionStateResponse {
  instance?: { instanceName?: string; state?: string };
}

export interface EvolutionCreateInstanceResponse {
  instance?: {
    instanceName?: string;
    instanceId?: string;
    status?: string;
  };
  hash?: { apikey?: string };
  settings?: Record<string, unknown>;
}

export interface EvolutionWebhookConfig {
  url: string;
  events: string[];
  enabled: boolean;
  webhookByEvents: boolean;
  webhookBase64: boolean;
}

export interface EvolutionInteractiveListPayload {
  body: string;
  buttonText: string;
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
  header?: string;
  footer?: string;
}

export interface EvolutionInteractiveButtonsPayload {
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
}

function stripTrailingSlash(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalized.replace(/\/+$/, '');
}

function toDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

function inferMimeTypeFromUrl(url: string, fallback: string): string {
  const lower = (url || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return fallback;
}

function inferFileNameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last || fallback;
  } catch {
    const last = (url || '').split('/').filter(Boolean).pop();
    return last || fallback;
  }
}

export class EvolutionError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = 'EvolutionError';
  }
}

export class EvolutionAdminClient {
  protected baseUrl: string;
  protected apiKey: string;

  constructor(config: EvolutionAdminConfig) {
    this.baseUrl = stripTrailingSlash(config.baseUrl);
    this.apiKey = (config.apiKey || '').trim();
  }

  protected async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'apikey': this.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const json = text ? (safeJsonParse(text) ?? null) : null;

    if (!response.ok) {
      throw new EvolutionError(
        `Evolution API request failed: ${response.status}`,
        response.status,
        text
      );
    }

    return (json ?? ({} as unknown)) as T;
  }

  async createInstance(params: {
    instanceName: string;
    integration: EvolutionIntegrationEngine;
    token?: string;
    qrcode?: boolean;
    number?: string;
    groupsIgnore?: boolean;
    rejectCall?: boolean;
    alwaysOnline?: boolean;
    readMessages?: boolean;
    readStatus?: boolean;
    syncFullHistory?: boolean;
    webhook?: {
      url: string;
      byEvents?: boolean;
      base64?: boolean;
      headers?: Record<string, string>;
      events?: string[];
    };
  }): Promise<EvolutionCreateInstanceResponse> {
    return this.request<EvolutionCreateInstanceResponse>('POST', '/instance/create', params);
  }

  async connectInstance(instanceName: string, opts?: { number?: string }): Promise<EvolutionConnectResponse> {
    const q = opts?.number ? `?number=${encodeURIComponent(opts.number)}` : '';
    return this.request<EvolutionConnectResponse>('GET', `/instance/connect/${encodeURIComponent(instanceName)}${q}`);
  }

  async getConnectionState(instanceName: string): Promise<EvolutionConnectionStateResponse> {
    return this.request<EvolutionConnectionStateResponse>('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  }

  async fetchInstances(query?: { instanceName?: string; instanceId?: string }): Promise<any> {
    const params = new URLSearchParams();
    if (query?.instanceName) params.set('instanceName', query.instanceName);
    if (query?.instanceId) params.set('instanceId', query.instanceId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<any>('GET', `/instance/fetchInstances${suffix}`);
  }

  async setWebhook(instanceName: string, webhook: EvolutionWebhookConfig): Promise<any> {
    return this.request<any>('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, webhook);
  }

  async logoutInstance(instanceName: string): Promise<any> {
    return this.request<any>('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async deleteInstance(instanceName: string): Promise<any> {
    return this.request<any>('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
  }
}

export class EvolutionClient extends EvolutionAdminClient {
  private instanceName: string;

  constructor(config: EvolutionInstanceConfig) {
    super(config);
    this.instanceName = (config.instanceName || '').trim();
  }

  async sendText(to: string, text: string): Promise<EvolutionSendResponse> {
    const number = toDigits(to);
    const data = await this.request<any>('POST', `/message/sendText/${encodeURIComponent(this.instanceName)}`, {
      number,
      text,
    });

    return {
      messageId: data?.key?.id || '',
      status: data?.status || 'PENDING',
      to: number,
      raw: data,
    };
  }

  async sendInteractiveButtons(to: string, payload: EvolutionInteractiveButtonsPayload): Promise<EvolutionSendResponse> {
    // Buttons are not reliable on the Baileys engine; we convert to a List message instead.
    const asList: EvolutionInteractiveListPayload = {
      body: payload.body,
      buttonText: payload.footer || 'Ver opciones',
      sections: [
        {
          title: payload.header || 'Opciones',
          rows: payload.buttons.map((b) => ({ id: b.id, title: b.title })),
        },
      ],
      ...(payload.header ? { header: payload.header } : {}),
      ...(payload.footer ? { footer: payload.footer } : {}),
    };

    return this.sendInteractiveList(to, asList);
  }

  async sendInteractiveList(to: string, payload: EvolutionInteractiveListPayload): Promise<EvolutionSendResponse> {
    const number = toDigits(to);
    const title = (payload.header || 'Nexova').trim();
    const description = (payload.body || '').trim();
    const buttonText = (payload.buttonText || 'Ver opciones').trim();
    const footerText = (payload.footer || '').trim();

    const data = await this.request<any>('POST', `/message/sendList/${encodeURIComponent(this.instanceName)}`, {
      number,
      title,
      description,
      buttonText,
      footerText,
      values: payload.sections.map((section) => ({
        title: (section.title || '').trim(),
        rows: section.rows.map((row) => ({
          title: (row.title || '').trim(),
          description: (row.description || '').trim(),
          rowId: row.id,
        })),
      })),
    });

    return {
      messageId: data?.key?.id || '',
      status: data?.status || 'PENDING',
      to: number,
      raw: data,
    };
  }

  async sendDocument(to: string, mediaUrl: string, caption?: string): Promise<EvolutionSendResponse> {
    return this.sendMedia(to, {
      mediaType: 'document',
      mediaUrl,
      caption,
      mimetype: inferMimeTypeFromUrl(mediaUrl, 'application/pdf'),
      fileName: inferFileNameFromUrl(mediaUrl, 'document.pdf'),
    });
  }

  async sendImage(to: string, mediaUrl: string, caption?: string): Promise<EvolutionSendResponse> {
    return this.sendMedia(to, {
      mediaType: 'image',
      mediaUrl,
      caption,
      mimetype: inferMimeTypeFromUrl(mediaUrl, 'image/png'),
      fileName: inferFileNameFromUrl(mediaUrl, 'image.png'),
    });
  }

  private async sendMedia(
    to: string,
    params: {
      mediaType: 'image' | 'document' | 'video';
      mediaUrl: string;
      caption?: string;
      mimetype: string;
      fileName: string;
    }
  ): Promise<EvolutionSendResponse> {
    const number = toDigits(to);
    const data = await this.request<any>('POST', `/message/sendMedia/${encodeURIComponent(this.instanceName)}`, {
      number,
      mediatype: params.mediaType,
      mimetype: params.mimetype,
      caption: (params.caption || '').trim(),
      media: params.mediaUrl,
      fileName: params.fileName,
    });

    return {
      messageId: data?.key?.id || '',
      status: data?.status || 'PENDING',
      to: number,
      raw: data,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string; state?: string }> {
    try {
      const res = await this.getConnectionState(this.instanceName);
      const state = res?.instance?.state || 'unknown';
      const healthy = String(state).toLowerCase() === 'open';
      return { healthy, state };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
