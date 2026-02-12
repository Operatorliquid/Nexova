/**
 * MercadoPago OAuth Service
 * Handles OAuth flow: authorization URL generation, token exchange, and refresh
 */

import type {
  MercadoPagoConfig,
  MercadoPagoTokens,
  OAuthTokenResponse,
  OAuthError,
} from './types.js';

const MP_AUTH_URL = 'https://auth.mercadopago.com/authorization';
const MP_TOKEN_URL = 'https://api.mercadopago.com/oauth/token';

export class MercadoPagoOAuthService {
  private config: MercadoPagoConfig;

  constructor(config: MercadoPagoConfig) {
    this.config = config;
  }

  /**
   * Generate OAuth authorization URL
   * User will be redirected to MercadoPago to authorize the app
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: this.config.redirectUri,
      state,
    });

    return `${MP_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access tokens
   * Called after user authorizes and is redirected back with a code
   */
  async exchangeCodeForTokens(code: string): Promise<MercadoPagoTokens> {
    const response = await fetch(MP_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as OAuthError;
      throw new OAuthServiceError(
        `Failed to exchange code: ${error.error_description || error.error || response.status}`,
        response.status,
        error
      );
    }

    const data = (await response.json()) as OAuthTokenResponse;

    return this.parseTokenResponse(data);
  }

  /**
   * Refresh access token using refresh token
   * Should be called before token expires
   */
  async refreshAccessToken(refreshToken: string): Promise<MercadoPagoTokens> {
    const response = await fetch(MP_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as OAuthError;
      throw new OAuthServiceError(
        `Failed to refresh token: ${error.error_description || error.error || response.status}`,
        response.status,
        error
      );
    }

    const data = (await response.json()) as OAuthTokenResponse;

    return this.parseTokenResponse(data);
  }

  /**
   * Revoke tokens (disconnect integration)
   * Note: MercadoPago doesn't have a formal revoke endpoint,
   * but we can effectively revoke by clearing stored tokens
   */
  async revokeTokens(_accessToken: string): Promise<void> {
    // MercadoPago doesn't have a token revocation endpoint
    // The tokens will simply become invalid when the user
    // revokes access from their MercadoPago account settings
    // or when we delete them from our database
  }

  /**
   * Validate state parameter (for CSRF protection)
   * State should be generated before redirect and validated on callback
   */
  generateState(workspaceId: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    // Format: workspaceId.timestamp.random
    return `${workspaceId}.${timestamp}.${random}`;
  }

  /**
   * Parse and validate state parameter
   */
  parseState(state: string): { workspaceId: string; timestamp: number } | null {
    const parts = state.split('.');
    if (parts.length !== 3) return null;

    const [workspaceId, timestampStr] = parts;
    const timestamp = parseInt(timestampStr, 36);

    // Validate timestamp (must be within 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (isNaN(timestamp) || timestamp < oneHourAgo) {
      return null;
    }

    return { workspaceId, timestamp };
  }

  private parseTokenResponse(data: OAuthTokenResponse): MercadoPagoTokens {
    // expires_in is in seconds
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      userId: data.user_id.toString(),
      publicKey: data.public_key,
    };
  }
}

export class OAuthServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: OAuthError
  ) {
    super(message);
    this.name = 'OAuthServiceError';
  }

  /**
   * Check if error indicates invalid/expired refresh token
   */
  isInvalidRefreshToken(): boolean {
    return (
      this.statusCode === 400 &&
      (this.details?.error === 'invalid_grant' ||
        this.details?.error === 'invalid_token')
    );
  }
}
