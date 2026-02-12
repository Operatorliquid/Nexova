/**
 * Authentication Service
 * Handles user registration, login, token refresh, and logout
 */
import { PrismaClient, User } from '@prisma/client';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password.service.js';
import {
  generateTokenPair,
  verifyRefreshToken,
  hashToken,
  TokenPair,
} from './token.service.js';

export interface RegisterInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthResult {
  user: Omit<User, 'passwordHash' | 'mfaSecret' | 'mfaBackupCodes'>;
  tokens: TokenPair;
}

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    // Validate password strength
    const validation = validatePasswordStrength(input.password);
    if (!validation.valid) {
      throw new AuthError('WEAK_PASSWORD', validation.errors.join('. '));
    }

    // Check if email already exists
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existing) {
      throw new AuthError('EMAIL_EXISTS', 'An account with this email already exists');
    }

    // Hash password and create user
    const passwordHash = await hashPassword(input.password);

    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: 'active', // For MVP, skip email verification
        emailVerifiedAt: new Date(),
      },
    });

    // Generate tokens
    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });

    // Store refresh token
    await this.storeRefreshToken(user.id, tokens);

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (!user) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AuthError(
        'ACCOUNT_LOCKED',
        `Account is locked until ${user.lockedUntil.toISOString()}`
      );
    }

    // Check if account is suspended
    if (user.status === 'suspended') {
      throw new AuthError('ACCOUNT_SUSPENDED', 'Account has been suspended');
    }

    // Verify password
    const isValid = await verifyPassword(user.passwordHash, input.password);

    if (!isValid) {
      // Increment failed login count
      const failedCount = user.failedLoginCount + 1;
      const lockUntil = failedCount >= 5
        ? new Date(Date.now() + 15 * 60 * 1000) // Lock for 15 minutes
        : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failedCount,
          lockedUntil: lockUntil,
        },
      });

      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Reset failed login count and update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Generate tokens
    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });

    // Store refresh token
    await this.storeRefreshToken(user.id, tokens, input.ipAddress, input.userAgent);

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async refresh(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuthResult> {
    // Verify the token
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AuthError('INVALID_TOKEN', 'Invalid or expired refresh token');
    }

    const tokenHash = hashToken(refreshToken);

    // Find the stored token
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      // Token not found - might be a reuse attack
      // Revoke all tokens in this family
      await this.prisma.refreshToken.updateMany({
        where: { family: payload.family },
        data: { revokedAt: new Date(), revokeReason: 'token_reuse_detected' },
      });
      throw new AuthError('INVALID_TOKEN', 'Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      // Token was already revoked - possible replay attack
      // Revoke all tokens in this family
      await this.prisma.refreshToken.updateMany({
        where: { family: storedToken.family },
        data: { revokedAt: new Date(), revokeReason: 'token_reuse_detected' },
      });
      throw new AuthError('TOKEN_REVOKED', 'Token has been revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new AuthError('TOKEN_EXPIRED', 'Refresh token has expired');
    }

    // Revoke the old token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date(), revokeReason: 'rotated' },
    });

    // Generate new tokens (same family for rotation tracking)
    const user = storedToken.user;
    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });

    // Store new refresh token with same family
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(tokens.refreshToken),
        family: storedToken.family, // Keep same family
        expiresAt: tokens.refreshTokenExpiresAt,
        ipAddress,
        deviceInfo: userAgent,
      },
    });

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date(), revokeReason: 'logout' },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'logout_all' },
    });
  }

  async getUser(userId: string): Promise<Omit<User, 'passwordHash' | 'mfaSecret' | 'mfaBackupCodes'> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    return user ? this.sanitizeUser(user) : null;
  }

  private async storeRefreshToken(
    userId: string,
    tokens: TokenPair,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(tokens.refreshToken),
        family: tokens.tokenFamily,
        expiresAt: tokens.refreshTokenExpiresAt,
        ipAddress,
        deviceInfo: userAgent,
      },
    });
  }

  private sanitizeUser(user: User): Omit<User, 'passwordHash' | 'mfaSecret' | 'mfaBackupCodes'> {
    const { passwordHash, mfaSecret, mfaBackupCodes, ...sanitized } = user;
    return sanitized;
  }
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
