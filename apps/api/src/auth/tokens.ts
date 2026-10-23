import { createHash, randomBytes } from 'node:crypto';

/** 256 bits from the OS CSPRNG, base64url (43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are high-entropy random values, so a fast hash is appropriate (no salt/stretching). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}
