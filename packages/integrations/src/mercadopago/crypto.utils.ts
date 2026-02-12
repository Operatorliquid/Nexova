/**
 * Cryptographic Utilities for Token Encryption
 * Uses AES-256-GCM for secure token storage
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment
 * Key must be 32 bytes (256 bits) for AES-256
 */
function getEncryptionKey(): Buffer {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY environment variable is not set');
  }

  // Key should be base64 encoded 32-byte key
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a 32-byte base64-encoded key');
  }

  return keyBuffer;
}

export interface EncryptedData {
  /** Encrypted data in base64 */
  encrypted: string;
  /** Initialization vector in hex */
  iv: string;
}

/**
 * Encrypt a string value using AES-256-GCM
 */
export function encryptToken(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Append auth tag to encrypted data
  const authTag = cipher.getAuthTag();
  const encryptedWithTag = Buffer.concat([
    Buffer.from(encrypted, 'base64'),
    authTag,
  ]).toString('base64');

  return {
    encrypted: encryptedWithTag,
    iv: iv.toString('hex'),
  };
}

/**
 * Decrypt a string value using AES-256-GCM
 */
export function decryptToken(encryptedData: string, iv: string): string {
  const key = getEncryptionKey();
  const ivBuffer = Buffer.from(iv, 'hex');
  const encryptedBuffer = Buffer.from(encryptedData, 'base64');

  // Extract auth tag from end of encrypted data
  const authTag = encryptedBuffer.subarray(-AUTH_TAG_LENGTH);
  const ciphertext = encryptedBuffer.subarray(0, -AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Generate a new encryption key (for initial setup)
 * Returns a base64-encoded 32-byte key
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Hash a string for webhook signature verification
 */
export function hmacSha256(data: string, secret: string): string {
  const { createHmac } = require('crypto');
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  const { timingSafeEqual } = require('crypto');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
