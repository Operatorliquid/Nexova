/**
 * Password hashing with Argon2id
 */
import * as argon2 from 'argon2';

// Argon2id parameters (OWASP recommended)
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 threads
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('La contraseña debe tener al menos 8 caracteres');
  }
  if (password.length > 128) {
    errors.push('La contraseña debe tener como máximo 128 caracteres');
  }

  const missing: string[] = [];
  if (!/[a-z]/.test(password)) missing.push('una letra minúscula');
  if (!/[A-Z]/.test(password)) missing.push('una letra mayúscula');
  if (!/[0-9]/.test(password)) missing.push('un número');

  if (missing.length === 1) {
    errors.push(`La contraseña debe contener al menos ${missing[0]}`);
  } else if (missing.length === 2) {
    errors.push(`La contraseña debe contener al menos ${missing[0]} y ${missing[1]}`);
  } else if (missing.length >= 3) {
    errors.push(`La contraseña debe contener al menos ${missing[0]}, ${missing[1]} y ${missing[2]}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
