/**
 * JWT Token Service
 * Handles access and refresh token generation/verification
 */
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';

export interface AccessTokenPayload {
  sub: string; // user ID
  email: string;
  isSuperAdmin: boolean;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string; // user ID
  family: string; // token family for rotation detection
  type: 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  tokenFamily: string;
}

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required');
  return secret;
}

function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is required');
  return secret;
}

export function generateTokenPair(user: {
  id: string;
  email: string;
  isSuperAdmin: boolean;
}): TokenPair {
  const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
  const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

  const tokenFamily = randomBytes(16).toString('hex');

  const accessPayload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    type: 'access',
  };

  const refreshPayload: RefreshTokenPayload = {
    sub: user.id,
    family: tokenFamily,
    type: 'refresh',
  };

  const accessToken = jwt.sign(accessPayload, getAccessSecret(), {
    expiresIn: accessExpiresIn as jwt.SignOptions['expiresIn'],
  });

  const refreshToken = jwt.sign(refreshPayload, getRefreshSecret(), {
    expiresIn: refreshExpiresIn as jwt.SignOptions['expiresIn'],
  });

  // Calculate expiry dates
  const accessDecoded = jwt.decode(accessToken) as { exp: number };
  const refreshDecoded = jwt.decode(refreshToken) as { exp: number };

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(accessDecoded.exp * 1000),
    refreshTokenExpiresAt: new Date(refreshDecoded.exp * 1000),
    tokenFamily,
  };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, getAccessSecret()) as AccessTokenPayload;

  if (payload.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, getRefreshSecret()) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return payload;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSecureToken(length = 32): string {
  return randomBytes(length).toString('hex');
}
