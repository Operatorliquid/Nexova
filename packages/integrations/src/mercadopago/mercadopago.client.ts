/**
 * MercadoPago API Client
 * Handles payment link generation and payment status queries
 */

import type {
  MercadoPagoConfig,
  MercadoPagoTokens,
  CreatePreferenceRequest,
  PreferenceResponse,
  PaymentResponse,
  UserInfoResponse,
  CreatePaymentLinkResult,
  PaymentDetails,
} from './types.js';

const MP_API_BASE = 'https://api.mercadopago.com';

export class MercadoPagoClient {
  private config: MercadoPagoConfig;
  private tokens: MercadoPagoTokens | null = null;

  constructor(config: MercadoPagoConfig) {
    this.config = config;
  }

  /**
   * Set OAuth tokens (retrieved from database)
   */
  setTokens(tokens: MercadoPagoTokens): void {
    this.tokens = tokens;
  }

  /**
   * Get current tokens
   */
  getTokens(): MercadoPagoTokens | null {
    return this.tokens;
  }

  /**
   * Check if tokens are expired
   */
  isTokenExpired(): boolean {
    if (!this.tokens) return true;
    // Consider expired if less than 5 minutes remaining
    return this.tokens.expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  }

  /**
   * Create a payment preference (payment link)
   */
  async createPreference(
    request: CreatePreferenceRequest
  ): Promise<PreferenceResponse> {
    this.ensureTokens();

    const response = await fetch(`${MP_API_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': request.external_reference || crypto.randomUUID(),
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new MercadoPagoError(
        `Failed to create preference: ${response.status}`,
        response.status,
        error
      );
    }

    return response.json() as Promise<PreferenceResponse>;
  }

  /**
   * Get payment details by ID
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    this.ensureTokens();

    const response = await fetch(`${MP_API_BASE}/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new MercadoPagoError(
        `Failed to get payment: ${response.status}`,
        response.status,
        error
      );
    }

    return response.json() as Promise<PaymentResponse>;
  }

  /**
   * Get user info for connected account
   */
  async getUserInfo(): Promise<UserInfoResponse> {
    this.ensureTokens();

    const response = await fetch(`${MP_API_BASE}/users/me`, {
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new MercadoPagoError(
        `Failed to get user info: ${response.status}`,
        response.status,
        error
      );
    }

    return response.json() as Promise<UserInfoResponse>;
  }

  /**
   * Create a payment link for an order
   */
  async createPaymentLink(options: {
    amount: number;
    description: string;
    externalReference: string;
    payerEmail?: string;
    payerName?: string;
    notificationUrl?: string;
    backUrls?: {
      success?: string;
      failure?: string;
      pending?: string;
    };
    expirationMinutes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<CreatePaymentLinkResult> {
    const now = new Date();
    const expiresAt = options.expirationMinutes
      ? new Date(now.getTime() + options.expirationMinutes * 60 * 1000)
      : undefined;

    const preference = await this.createPreference({
      items: [
        {
          title: options.description,
          quantity: 1,
          unit_price: options.amount / 100, // Convert from cents to currency
          currency_id: 'ARS',
        },
      ],
      payer: options.payerEmail
        ? {
            email: options.payerEmail,
            name: options.payerName?.split(' ')[0],
            surname: options.payerName?.split(' ').slice(1).join(' '),
          }
        : undefined,
      external_reference: options.externalReference,
      notification_url: options.notificationUrl,
      back_urls: options.backUrls || undefined,
      auto_return: options.backUrls ? 'approved' : undefined,
      expires: !!expiresAt,
      expiration_date_from: now.toISOString(),
      expiration_date_to: expiresAt?.toISOString(),
      metadata: options.metadata,
    });

    return {
      paymentId: preference.id,
      preferenceId: preference.id,
      paymentUrl: this.config.sandbox
        ? preference.sandbox_init_point
        : preference.init_point,
      sandboxUrl: preference.sandbox_init_point,
      expiresAt,
      externalReference: options.externalReference,
    };
  }

  /**
   * Parse payment response to simpler format
   */
  parsePaymentDetails(payment: PaymentResponse): PaymentDetails {
    const fee = payment.fee_details?.reduce((sum, f) => sum + f.amount, 0) || 0;

    return {
      id: payment.id.toString(),
      status: payment.status,
      statusDetail: payment.status_detail,
      amount: Math.round(payment.transaction_amount * 100), // Convert to cents
      netAmount: Math.round((payment.net_received_amount || payment.transaction_amount - fee) * 100),
      currency: payment.currency_id,
      method: payment.payment_method_id,
      methodType: payment.payment_type_id,
      externalReference: payment.external_reference,
      payerEmail: payment.payer?.email,
      fee: Math.round(fee * 100),
      createdAt: new Date(payment.date_created),
      approvedAt: payment.date_approved ? new Date(payment.date_approved) : undefined,
    };
  }

  /**
   * Health check for the connection
   */
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      if (!this.tokens) {
        return { healthy: false, message: 'No tokens configured' };
      }

      if (this.isTokenExpired()) {
        return { healthy: false, message: 'Tokens expired' };
      }

      await this.getUserInfo();
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection check failed',
      };
    }
  }

  private ensureTokens(): void {
    if (!this.tokens) {
      throw new MercadoPagoError('No tokens configured', 401, {
        error: 'unauthorized',
        message: 'OAuth tokens not set',
      });
    }
  }
}

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MercadoPagoError';
  }
}
