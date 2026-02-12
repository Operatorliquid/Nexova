/**
 * MercadoPago Webhook Handler
 * Processes IPN (Instant Payment Notification) from MercadoPago
 */

import { hmacSha256, secureCompare } from './crypto.utils.js';
import type { WebhookNotification, PaymentResponse, PaymentStatus } from './types.js';
import { MercadoPagoClient } from './mercadopago.client.js';

export interface ProcessedWebhook {
  type: 'payment' | 'merchant_order' | 'unknown';
  action: string;
  resourceId: string;
  payment?: {
    id: string;
    status: PaymentStatus;
    statusDetail: string;
    amount: number;
    netAmount: number;
    currency: string;
    externalReference?: string;
    payerEmail?: string;
    method: string;
    fee: number;
    isApproved: boolean;
    isPending: boolean;
    isRejected: boolean;
    isCancelled: boolean;
  };
  raw: WebhookNotification;
}

export class MercadoPagoWebhookHandler {
  private client: MercadoPagoClient;

  constructor(client: MercadoPagoClient) {
    this.client = client;
  }

  /**
   * Verify webhook signature
   * MercadoPago uses x-signature header with format: ts=xxx,v1=xxx
   */
  verifySignature(
    requestId: string,
    dataId: string,
    signature: string,
    secret: string
  ): boolean {
    // Parse signature header
    const parts = signature.split(',');
    const ts = parts.find((p) => p.startsWith('ts='))?.split('=')[1];
    const v1 = parts.find((p) => p.startsWith('v1='))?.split('=')[1];

    if (!ts || !v1) {
      return false;
    }

    // Build manifest
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

    // Calculate expected signature
    const expectedSignature = hmacSha256(manifest, secret);

    return secureCompare(v1, expectedSignature);
  }

  /**
   * Parse webhook notification payload
   */
  parseNotification(payload: unknown): WebhookNotification | null {
    const data = payload as Record<string, unknown>;

    if (
      typeof data.id !== 'number' &&
      typeof data.id !== 'string'
    ) {
      return null;
    }

    if (typeof data.type !== 'string') {
      return null;
    }

    if (!data.data || typeof (data.data as Record<string, unknown>).id !== 'string') {
      return null;
    }

    return {
      id: typeof data.id === 'number' ? data.id : parseInt(data.id as string, 10),
      live_mode: data.live_mode === true,
      type: data.type as WebhookNotification['type'],
      date_created: (data.date_created as string) || new Date().toISOString(),
      user_id: String(data.user_id || ''),
      api_version: (data.api_version as string) || 'v1',
      action: (data.action as WebhookNotification['action']) || 'payment.updated',
      data: {
        id: String((data.data as Record<string, unknown>).id),
      },
    };
  }

  /**
   * Process a webhook notification
   * Fetches additional data from MercadoPago API if needed
   */
  async processNotification(
    notification: WebhookNotification
  ): Promise<ProcessedWebhook> {
    const result: ProcessedWebhook = {
      type: 'unknown',
      action: notification.action,
      resourceId: notification.data.id,
      raw: notification,
    };

    if (notification.type === 'payment') {
      result.type = 'payment';

      try {
        // Fetch payment details from API
        const payment = await this.client.getPayment(notification.data.id);
        result.payment = this.extractPaymentInfo(payment);
      } catch {
        // If we can't fetch payment details, return with what we have
        result.payment = {
          id: notification.data.id,
          status: 'pending',
          statusDetail: 'unknown',
          amount: 0,
          netAmount: 0,
          currency: 'ARS',
          method: 'unknown',
          fee: 0,
          isApproved: false,
          isPending: true,
          isRejected: false,
          isCancelled: false,
        };
      }
    } else if (notification.type === 'merchant_order') {
      result.type = 'merchant_order';
      // Merchant orders contain multiple payments
      // For now, we handle individual payment notifications
    }

    return result;
  }

  /**
   * Check if a payment status indicates success
   */
  isPaymentApproved(status: PaymentStatus): boolean {
    return status === 'approved';
  }

  /**
   * Check if a payment status indicates pending
   */
  isPaymentPending(status: PaymentStatus): boolean {
    return status === 'pending' || status === 'in_process' || status === 'authorized';
  }

  /**
   * Check if a payment status indicates failure
   */
  isPaymentRejected(status: PaymentStatus): boolean {
    return status === 'rejected';
  }

  /**
   * Check if a payment status indicates cancellation
   */
  isPaymentCancelled(status: PaymentStatus): boolean {
    return status === 'cancelled' || status === 'refunded' || status === 'charged_back';
  }

  private extractPaymentInfo(payment: PaymentResponse): ProcessedWebhook['payment'] {
    const fee = payment.fee_details?.reduce((sum, f) => sum + f.amount, 0) || 0;
    const netAmount = payment.net_received_amount || payment.transaction_amount - fee;

    return {
      id: payment.id.toString(),
      status: payment.status,
      statusDetail: payment.status_detail,
      amount: Math.round(payment.transaction_amount * 100), // Convert to cents
      netAmount: Math.round(netAmount * 100),
      currency: payment.currency_id,
      externalReference: payment.external_reference,
      payerEmail: payment.payer?.email,
      method: payment.payment_method_id,
      fee: Math.round(fee * 100),
      isApproved: this.isPaymentApproved(payment.status),
      isPending: this.isPaymentPending(payment.status),
      isRejected: this.isPaymentRejected(payment.status),
      isCancelled: this.isPaymentCancelled(payment.status),
    };
  }
}

/**
 * Utility to generate a webhook secret
 */
export function generateWebhookSecret(): string {
  const { randomBytes } = require('crypto');
  return randomBytes(32).toString('hex');
}
