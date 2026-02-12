/**
 * MercadoPago Integration Types
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface MercadoPagoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Sandbox mode for testing */
  sandbox?: boolean;
}

export interface MercadoPagoTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userId: string;
  publicKey?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH
// ═══════════════════════════════════════════════════════════════════════════════

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
  public_key: string;
}

export interface OAuthError {
  error: string;
  error_description?: string;
  message?: string;
  status?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREFERENCES (Payment Links)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PreferenceItem {
  id?: string;
  title: string;
  description?: string;
  picture_url?: string;
  category_id?: string;
  quantity: number;
  currency_id?: string;
  unit_price: number;
}

export interface PreferencePayer {
  name?: string;
  surname?: string;
  email?: string;
  phone?: {
    area_code?: string;
    number?: string;
  };
  identification?: {
    type?: string;
    number?: string;
  };
  address?: {
    street_name?: string;
    street_number?: number;
    zip_code?: string;
  };
}

export interface PreferenceBackUrls {
  success?: string;
  pending?: string;
  failure?: string;
}

export interface CreatePreferenceRequest {
  items: PreferenceItem[];
  payer?: PreferencePayer;
  back_urls?: PreferenceBackUrls;
  auto_return?: 'approved' | 'all';
  notification_url?: string;
  external_reference?: string;
  expires?: boolean;
  expiration_date_from?: string;
  expiration_date_to?: string;
  metadata?: Record<string, unknown>;
}

export interface PreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point: string;
  date_created: string;
  external_reference?: string;
  items: PreferenceItem[];
  collector_id: number;
  operation_type: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export type PaymentStatus =
  | 'pending'
  | 'approved'
  | 'authorized'
  | 'in_process'
  | 'in_mediation'
  | 'rejected'
  | 'cancelled'
  | 'refunded'
  | 'charged_back';

export type PaymentStatusDetail =
  | 'accredited'
  | 'pending_contingency'
  | 'pending_review_manual'
  | 'cc_rejected_bad_filled_date'
  | 'cc_rejected_bad_filled_other'
  | 'cc_rejected_bad_filled_security_code'
  | 'cc_rejected_blacklist'
  | 'cc_rejected_call_for_authorize'
  | 'cc_rejected_card_disabled'
  | 'cc_rejected_duplicated_payment'
  | 'cc_rejected_high_risk'
  | 'cc_rejected_insufficient_amount'
  | 'cc_rejected_invalid_installments'
  | 'cc_rejected_max_attempts'
  | 'cc_rejected_other_reason'
  | string;

export interface PaymentResponse {
  id: number;
  date_created: string;
  date_approved?: string;
  date_last_updated?: string;
  money_release_date?: string;
  status: PaymentStatus;
  status_detail: PaymentStatusDetail;
  operation_type: string;
  issuer_id?: string;
  payment_method_id: string;
  payment_type_id: string;
  transaction_amount: number;
  transaction_amount_refunded: number;
  currency_id: string;
  description?: string;
  external_reference?: string;
  payer: {
    id?: string;
    email?: string;
    identification?: {
      type?: string;
      number?: string;
    };
    first_name?: string;
    last_name?: string;
  };
  metadata?: Record<string, unknown>;
  fee_details?: Array<{
    type: string;
    amount: number;
    fee_payer: string;
  }>;
  net_received_amount?: number;
  collector_id: number;
  installments?: number;
  card?: {
    first_six_digits?: string;
    last_four_digits?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS (IPN)
// ═══════════════════════════════════════════════════════════════════════════════

export type WebhookTopic =
  | 'payment'
  | 'merchant_order'
  | 'chargebacks'
  | 'point_integration_wh';

export type WebhookAction =
  | 'payment.created'
  | 'payment.updated'
  | 'created'
  | 'state_FINISHED'
  | 'state_CANCELED'
  | 'state_ERROR';

export interface WebhookNotification {
  id: number;
  live_mode: boolean;
  type: WebhookTopic;
  date_created: string;
  user_id: string;
  api_version: string;
  action: WebhookAction;
  data: {
    id: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER INFO
// ═══════════════════════════════════════════════════════════════════════════════

export interface UserInfoResponse {
  id: number;
  nickname: string;
  registration_date: string;
  first_name: string;
  last_name: string;
  email: string;
  site_id: string;
  phone: {
    area_code: string;
    number: string;
  };
  status: {
    site_status: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreatePaymentLinkResult {
  paymentId: string;
  preferenceId: string;
  paymentUrl: string;
  sandboxUrl?: string;
  expiresAt?: Date;
  externalReference: string;
}

export interface PaymentDetails {
  id: string;
  status: PaymentStatus;
  statusDetail: PaymentStatusDetail;
  amount: number;
  netAmount: number;
  currency: string;
  method: string;
  methodType: string;
  externalReference?: string;
  payerEmail?: string;
  fee: number;
  createdAt: Date;
  approvedAt?: Date;
}
