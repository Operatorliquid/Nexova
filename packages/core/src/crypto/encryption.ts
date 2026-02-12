/**
 * AES-256-GCM encryption for sensitive data (API keys, credentials)
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  // Key should be 32 bytes (256 bits) for AES-256
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (256 bits) base64 encoded');
  }
  return keyBuffer;
}

export interface EncryptedData {
  encrypted: string; // base64
  iv: string; // hex
}

export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Append auth tag to encrypted data
  const encryptedWithTag = Buffer.concat([
    Buffer.from(encrypted, 'base64'),
    authTag,
  ]).toString('base64');

  return {
    encrypted: encryptedWithTag,
    iv: iv.toString('hex'),
  };
}

export function decrypt(encryptedData: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedData.iv, 'hex');

  const encryptedBuffer = Buffer.from(encryptedData.encrypted, 'base64');

  // Extract auth tag from end of encrypted data
  const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);
  const encrypted = encryptedBuffer.subarray(0, encryptedBuffer.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Generate a secure encryption key (run once to generate ENCRYPTION_KEY)
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}
