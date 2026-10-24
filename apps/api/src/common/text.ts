import { z } from 'zod';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Collapses runs of whitespace and trims. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Case-insensitive uniqueness key for names ("Banks" and " banks " collide). */
export function nameKey(value: string): string {
  return normalizeText(value).normalize('NFKC').toLowerCase();
}

/** URL slug from free text: ASCII lowercase words joined by single hyphens. May return ''. */
export function slugify(value: string, max = 60): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * Escapes the LIKE/ILIKE metacharacters (`\`, `%`, `_`) so user search text always matches
 * literally. Prisma's `contains` does not do this itself.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** A single-line name: no control characters, whitespace normalised. */
export const nameField = (min: number, max: number, label = 'Name') =>
  z
    .string(`${label} is required`)
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .min(min, `${label} is required`)
        .max(max, `${label} must be at most ${max} characters`)
        .regex(/^[^\p{C}]+$/u, `${label} contains invalid characters`),
    );

/** Free text that may contain newlines but no other control characters. */
export const textField = (max: number, label = 'Text') =>
  z
    .string(`${label} is required`)
    .transform((value) => value.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be at most ${max} characters`)
        .regex(/^(?:[^\p{C}]|\n)+$/u, `${label} contains invalid characters`),
    );

export const slugField = (max = 60) =>
  z
    .string('Slug is required')
    .min(2, 'Slug must be at least 2 characters')
    .max(max, `Slug must be at most ${max} characters`)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens');
