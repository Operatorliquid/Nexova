/**
 * MercadoPago Integration Module
 * OAuth, payment links, and webhook handling
 */

// Main service (recommended entry point)
export {
  MercadoPagoIntegrationService,
  IntegrationServiceError,
  type IntegrationStatus,
} from './integration.service.js';

// Individual components (for advanced usage)
export { MercadoPagoClient, MercadoPagoError } from './mercadopago.client.js';
export { MercadoPagoOAuthService, OAuthServiceError } from './oauth.service.js';
export { MercadoPagoWebhookHandler, generateWebhookSecret, type ProcessedWebhook } from './webhook.handler.js';

// Crypto utilities
export {
  encryptToken,
  decryptToken,
  generateEncryptionKey,
  hmacSha256,
  secureCompare,
} from './crypto.utils.js';

// Types
export type {
  MercadoPagoConfig,
  MercadoPagoTokens,
  CreatePreferenceRequest,
  PreferenceResponse,
  PreferenceItem,
  PreferencePayer,
  PreferenceBackUrls,
  PaymentResponse,
  PaymentStatus,
  PaymentStatusDetail,
  WebhookNotification,
  WebhookTopic,
  WebhookAction,
  UserInfoResponse,
  CreatePaymentLinkResult,
  PaymentDetails,
  OAuthTokenResponse,
  OAuthError,
} from './types.js';
