import { z } from 'zod';
import { pageParams } from '../common/pagination.js';
import { nameField, textField } from '../common/text.js';
import { createZodDto } from '../common/zod/create-zod-dto.js';
import { MAX_WINDOWS_TOTAL } from './availability.js';
import { looksLikeIdentifier } from './identifiers.js';

/** Languages an assistant can declare (codes are stable; names are for display). */
export const LANGUAGES = {
  en: 'English',
  ha: 'Hausa',
  yo: 'Yoruba',
  ig: 'Igbo',
  pcm: 'Nigerian Pidgin',
  ff: 'Fulfulde',
  fr: 'French',
  ar: 'Arabic',
} as const;
const languageCodes = Object.keys(LANGUAGES) as [
  keyof typeof LANGUAGES,
  ...(keyof typeof LANGUAGES)[],
];

const bio = z
  .string('Bio must be text')
  .transform((v) => v.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .max(600, 'Bio must be at most 600 characters')
      .regex(/^(?:[^\p{C}]|\n)*$/u, 'Bio contains invalid characters'),
  );

const languages = z
  .array(z.enum(languageCodes, 'Choose from the listed languages'))
  .max(8)
  .transform((list) => [...new Set(list)]);

// ── the assistant's own profile ──────────────────────────────────────────────
export const createDraftSchema = z.strictObject({ displayName: nameField(2, 60, 'Display name') });

export const updateProfileSchema = z
  .strictObject({
    displayName: nameField(2, 60, 'Display name'),
    bio,
    languages,
    availabilityNote: z.union([textField(200, 'Note'), z.null()]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

export const servicesSchema = z.strictObject({
  cityIds: z
    .array(z.uuid('Each city id must be a UUID'))
    .max(10)
    .transform((l) => [...new Set(l)]),
  taskIds: z
    .array(z.uuid('Each task id must be a UUID'))
    .max(60)
    .transform((l) => [...new Set(l)]),
});

export const availabilitySchema = z.strictObject({
  windows: z
    .array(
      z.strictObject({
        dayOfWeek: z.number('Day must be a number').int().min(0).max(6),
        start: z.string().max(5),
        end: z.string().max(5),
      }),
    )
    .max(MAX_WINDOWS_TOTAL),
  note: z.union([textField(200, 'Note'), z.null()]).optional(),
});

/** PRIVATE details: returned only to the owner and reviewing administrators. */
export const privateDetailsSchema = z
  .strictObject({
    legalName: nameField(2, 120, 'Legal name').optional(),
    phone: z.string('Enter your mobile number').max(30).optional(),
  })
  .refine((v) => v.legalName !== undefined || v.phone !== undefined, {
    message: 'Provide at least one field',
  });

export const phoneVerifySchema = z.strictObject({
  code: z.string('Enter the 6-digit code').regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// ── administration ───────────────────────────────────────────────────────────
const safeText = (max: number) =>
  textField(max, 'Text').refine((v) => !looksLikeIdentifier(v), {
    message: 'Do not enter ID, card or phone numbers: record outcomes and opaque references only',
  });

export const identityCheckSchema = z.strictObject({
  result: z.enum(['PASSED', 'FAILED', 'INCONCLUSIVE'], 'Choose PASSED, FAILED or INCONCLUSIVE'),
  /** Opaque pointer to where the reviewer's evidence is held OFF-SYSTEM (never the evidence itself). */
  evidenceRef: z.union([safeText(120), z.null()]).optional(),
  notes: z.union([safeText(500), z.null()]).optional(),
});

export const transitionSchema = z.strictObject({
  to: z.enum(
    ['UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'],
    'Choose a valid status',
  ),
  reason: safeText(500).optional(),
});

const STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;

export const adminAssistantQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  ...pageParams,
});

// ── public ───────────────────────────────────────────────────────────────────
const slugFilter = z
  .string()
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'Invalid slug')
  .optional();
export const publicAssistantQuerySchema = z.object({
  city: slugFilter,
  category: slugFilter,
  ...pageParams,
});

export class CreateDraftDto extends createZodDto(createDraftSchema) {}
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
export class ServicesDto extends createZodDto(servicesSchema) {}
export class AvailabilityDto extends createZodDto(availabilitySchema) {}
export class PrivateDetailsDto extends createZodDto(privateDetailsSchema) {}
export class PhoneVerifyDto extends createZodDto(phoneVerifySchema) {}
export class IdentityCheckDto extends createZodDto(identityCheckSchema) {}
export class TransitionDto extends createZodDto(transitionSchema) {}
export class AdminAssistantQuery extends createZodDto(adminAssistantQuerySchema) {}
export class PublicAssistantQuery extends createZodDto(publicAssistantQuerySchema) {}
