import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
export const PHONE_CODE_MAX_ATTEMPTS = 5;

/** Six digits from the OS CSPRNG (uniform; no modulo bias). */
export function generatePhoneCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * A 6-digit code has only 10^6 possibilities, so a plain hash would be reversible instantly from a
 * database leak. The HMAC key (a server-side pepper that is NOT in the database) plus binding the
 * token id and phone number make a leaked row useless without the pepper.
 */
export function hashPhoneCode(
  pepper: string,
  tokenId: string,
  phone: string,
  code: string,
): string {
  return createHmac('sha256', pepper).update(`${tokenId}|${phone}|${code}`).digest('hex');
}

export function phoneCodeMatches(expectedHash: string, actualHash: string): boolean {
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(actualHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
