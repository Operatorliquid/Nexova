/**
 * MercadoPago Integration Service
 * High-level service that coordinates OAuth, tokens, and database persistence
 */

import { PrismaClient, Prisma, type WorkspaceIntegration } from '@prisma/client';
import { MercadoPagoClient, MercadoPagoError } from './mercadopago.client.js';
import { MercadoPagoOAuthService, OAuthServiceError } from './oauth.service.js';
import { MercadoPagoWebhookHandler, type ProcessedWebhook } from './webhook.handler.js';
import { encryptToken, decryptToken } from './crypto.utils.js';
import type { MercadoPagoConfig, MercadoPagoTokens, CreatePaymentLinkResult } from './types.js';

const PROVIDER_NAME = 'mercadopago';

export interface IntegrationStatus {
  connected: boolean;
  status: string;
  externalUserId?: string;
  externalEmail?: string;
  connectedAt?: Date;
  tokenExpiresAt?: Date;
  stats?: {
    linksGenerated: number;
    paymentsReceived: number;
    amountCollected: number;
  };
}

export class MercadoPagoIntegrationService {
  private prisma: PrismaClient;
  private config: MercadoPagoConfig;
  private oauthService: MercadoPagoOAuthService;

  constructor(prisma: PrismaClient, config: MercadoPagoConfig) {
    this.prisma = prisma;
    this.config = config;
    this.oauthService = new MercadoPagoOAuthService(config);
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(workspaceId: string): { url: string; state: string } {
    const state = this.oauthService.generateState(workspaceId);
    const url = this.oauthService.getAuthorizationUrl(state);
    return { url, state };
  }

  /**
   * Handle OAuth callback - exchange code for tokens and store
   */
  async handleOAuthCallback(
    code: string,
    state: string
  ): Promise<{ workspaceId: string; integration: WorkspaceIntegration }> {
    // Validate state
    const parsedState = this.oauthService.parseState(state);
    if (!parsedState) {
      throw new IntegrationServiceError('Invalid or expired state parameter', 'INVALID_STATE');
    }

    const { workspaceId } = parsedState;

    // Exchange code for tokens
    const tokens = await this.oauthService.exchangeCodeForTokens(code);

    // Get user info
    const client = this.createClientWithTokens(tokens);
    const userInfo = await client.getUserInfo();

    // Store tokens (encrypted)
    const integration = await this.storeTokens(workspaceId, tokens, {
      email: userInfo.email,
      firstName: userInfo.first_name,
      lastName: userInfo.last_name,
    });

    return { workspaceId, integration };
  }

  /**
   * Get integration status for a workspace
   */
  async getStatus(workspaceId: string): Promise<IntegrationStatus> {
    const integration = await this.getIntegration(workspaceId);

    if (!integration) {
      return {
        connected: false,
        status: 'disconnected',
      };
    }

    return {
      connected: integration.status === 'connected',
      status: integration.status,
      externalUserId: integration.externalUserId || undefined,
      externalEmail: integration.externalEmail || undefined,
      connectedAt: integration.connectedAt || undefined,
      tokenExpiresAt: integration.tokenExpiresAt || undefined,
      stats: {
        linksGenerated: integration.linksGenerated,
        paymentsReceived: integration.paymentsReceived,
        amountCollected: Number(integration.amountCollected),
      },
    };
  }

  /**
   * Disconnect MercadoPago integration
   */
  async disconnect(workspaceId: string): Promise<void> {
    const integration = await this.getIntegration(workspaceId);
    if (!integration) return;

    await this.prisma.workspaceIntegration.updateMany({
      where: { id: integration.id, workspaceId },
      data: {
        status: 'disconnected',
        accessTokenEnc: null,
        accessTokenIv: null,
        refreshTokenEnc: null,
        refreshTokenIv: null,
        tokenExpiresAt: null,
        disconnectedAt: new Date(),
      },
    });
  }

  /**
   * Get a client instance for a workspace (with token refresh if needed)
   */
  async getClient(workspaceId: string): Promise<MercadoPagoClient> {
    const integration = await this.getIntegration(workspaceId);

    if (!integration || integration.status !== 'connected') {
      throw new IntegrationServiceError(
        'MercadoPago not connected for this workspace',
        'NOT_CONNECTED'
      );
    }

    const tokens = this.decryptTokens(integration);

    // Check if tokens need refresh
    if (this.shouldRefreshTokens(integration)) {
      try {
        const newTokens = await this.oauthService.refreshAccessToken(tokens.refreshToken);
        await this.storeTokens(workspaceId, newTokens);
        return this.createClientWithTokens(newTokens);
      } catch (error) {
        if (error instanceof OAuthServiceError && error.isInvalidRefreshToken()) {
          // Mark as disconnected - user needs to re-authorize
          await this.prisma.workspaceIntegration.updateMany({
            where: { id: integration.id, workspaceId },
            data: {
              status: 'expired',
            },
          });
          throw new IntegrationServiceError(
            'MercadoPago session expired. Please reconnect.',
            'TOKEN_EXPIRED'
          );
        }
        throw error;
      }
    }

    return this.createClientWithTokens(tokens);
  }

  /**
   * Create a payment link
   */
  async createPaymentLink(
    workspaceId: string,
    options: {
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
    }
  ): Promise<CreatePaymentLinkResult> {
    const client = await this.getClient(workspaceId);
    const result = await client.createPaymentLink(options);

    // Update stats
    await this.incrementStat(workspaceId, 'linksGenerated');

    return result;
  }

  /**
   * Process a webhook notification
   */
  async processWebhook(
    workspaceId: string,
    payload: unknown,
    headers: {
      'x-signature'?: string;
      'x-request-id'?: string;
    }
  ): Promise<ProcessedWebhook> {
    const client = await this.getClient(workspaceId);
    const handler = new MercadoPagoWebhookHandler(client);

    // Parse notification
    const notification = handler.parseNotification(payload);
    if (!notification) {
      throw new IntegrationServiceError('Invalid webhook payload', 'INVALID_WEBHOOK');
    }

    // Verify signature if secret is configured
    const integration = await this.getIntegration(workspaceId);
    if (integration?.webhookSecretEnc && integration?.webhookSecretIv) {
      const secret = decryptToken(integration.webhookSecretEnc, integration.webhookSecretIv);
      const signature = headers['x-signature'];
      const requestId = headers['x-request-id'];

      if (!signature || !requestId) {
        throw new IntegrationServiceError('Missing webhook signature', 'MISSING_SIGNATURE');
      }

      const isValid = handler.verifySignature(
        requestId,
        notification.data.id,
        signature,
        secret
      );

      if (!isValid) {
        throw new IntegrationServiceError('Invalid webhook signature', 'INVALID_SIGNATURE');
      }
    }

    // Process the notification
    const result = await handler.processNotification(notification);

    // Update stats if payment approved
    if (result.payment?.isApproved) {
      await this.prisma.workspaceIntegration.updateMany({
        where: {
          workspaceId,
          provider: PROVIDER_NAME,
        },
        data: {
          paymentsReceived: { increment: 1 },
          amountCollected: { increment: result.payment.amount },
          lastUsedAt: new Date(),
        },
      });
    }

    return result;
  }

  /**
   * Health check for the integration
   */
  async healthCheck(workspaceId: string): Promise<{ healthy: boolean; message?: string }> {
    try {
      const client = await this.getClient(workspaceId);
      return client.healthCheck();
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return { healthy: false, message: error.message };
      }
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  private async getIntegration(workspaceId: string): Promise<WorkspaceIntegration | null> {
    return this.prisma.workspaceIntegration.findFirst({
      where: {
        workspaceId,
        provider: PROVIDER_NAME,
      },
    });
  }

  private async storeTokens(
    workspaceId: string,
    tokens: MercadoPagoTokens,
    userInfo?: { email?: string; firstName?: string; lastName?: string }
  ): Promise<WorkspaceIntegration> {
    const accessTokenEncrypted = encryptToken(tokens.accessToken);
    const refreshTokenEncrypted = encryptToken(tokens.refreshToken);

    const data = {
      status: 'connected',
      accessTokenEnc: accessTokenEncrypted.encrypted,
      accessTokenIv: accessTokenEncrypted.iv,
      refreshTokenEnc: refreshTokenEncrypted.encrypted,
      refreshTokenIv: refreshTokenEncrypted.iv,
      tokenExpiresAt: tokens.expiresAt,
      externalUserId: tokens.userId,
      externalEmail: userInfo?.email,
      connectedAt: new Date(),
      disconnectedAt: null,
      providerData: {
        publicKey: tokens.publicKey,
        userName: userInfo?.firstName
          ? `${userInfo.firstName} ${userInfo.lastName || ''}`.trim()
          : undefined,
      },
    };

    const existing = await this.prisma.workspaceIntegration.findFirst({
      where: {
        workspaceId,
        provider: PROVIDER_NAME,
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.workspaceIntegration.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      return await this.prisma.workspaceIntegration.create({
        data: {
          workspaceId,
          provider: PROVIDER_NAME,
          ...data,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const fallback = await this.prisma.workspaceIntegration.findFirst({
          where: { workspaceId, provider: PROVIDER_NAME },
          select: { id: true },
        });
        if (fallback) {
          return this.prisma.workspaceIntegration.update({
            where: { id: fallback.id },
            data,
          });
        }
      }
      throw error;
    }
  }

  private decryptTokens(integration: WorkspaceIntegration): MercadoPagoTokens {
    if (
      !integration.accessTokenEnc ||
      !integration.accessTokenIv ||
      !integration.refreshTokenEnc ||
      !integration.refreshTokenIv
    ) {
      throw new IntegrationServiceError('Tokens not found', 'TOKENS_NOT_FOUND');
    }

    return {
      accessToken: decryptToken(integration.accessTokenEnc, integration.accessTokenIv),
      refreshToken: decryptToken(integration.refreshTokenEnc, integration.refreshTokenIv),
      expiresAt: integration.tokenExpiresAt || new Date(),
      userId: integration.externalUserId || '',
    };
  }

  private shouldRefreshTokens(integration: WorkspaceIntegration): boolean {
    if (!integration.tokenExpiresAt) return true;
    // Refresh if less than 30 minutes remaining
    return integration.tokenExpiresAt.getTime() < Date.now() + 30 * 60 * 1000;
  }

  private createClientWithTokens(tokens: MercadoPagoTokens): MercadoPagoClient {
    const client = new MercadoPagoClient(this.config);
    client.setTokens(tokens);
    return client;
  }

  private async incrementStat(
    workspaceId: string,
    stat: 'linksGenerated' | 'paymentsReceived'
  ): Promise<void> {
    await this.prisma.workspaceIntegration.updateMany({
      where: {
        workspaceId,
        provider: PROVIDER_NAME,
      },
      data: {
        [stat]: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }
}

export class IntegrationServiceError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'IntegrationServiceError';
  }
}

// Re-export for convenience
export { MercadoPagoClient, MercadoPagoError };
export { MercadoPagoOAuthService, OAuthServiceError };
export { MercadoPagoWebhookHandler, type ProcessedWebhook };
export * from './types.js';
export * from './crypto.utils.js';
