import { z } from 'zod';
import { pageParams } from '../common/pagination.js';
import { nameField, slugField, textField } from '../common/text.js';
import { createZodDto } from '../common/zod/create-zod-dto.js';

const latitude = z.number('Latitude must be a number').min(-90).max(90);
const longitude = z.number('Longitude must be a number').min(-180).max(180);
const sortOrder = z.number('Sort order must be a number').int().min(0).max(10_000);

const timezone = z
  .string('Timezone is required')
  .max(40)
  .refine(
    (value) => {
      try {
        return Boolean(new Intl.DateTimeFormat('en', { timeZone: value }));
      } catch {
        return false;
      }
    },
    { message: 'Use an IANA timezone such as Africa/Lagos' },
  );

// ── cities ────────────────────────────────────────────────────────────────────
export const createCitySchema = z.strictObject({
  name: nameField(2, 80),
  slug: slugField().optional(),
  state: nameField(2, 80, 'State'),
  latitude,
  longitude,
  timezone: timezone.default('Africa/Lagos'),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});

export const updateCitySchema = z
  .strictObject({
    name: nameField(2, 80),
    state: nameField(2, 80, 'State'),
    latitude,
    longitude,
    timezone,
    sortOrder,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field' });

// ── locations ─────────────────────────────────────────────────────────────────
const LOCATION_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;

export const createLocationSchema = z
  .strictObject({
    cityId: z.uuid('cityId must be a UUID'),
    categoryId: z.uuid('categoryId must be a UUID'),
    name: nameField(2, 120),
    slug: slugField(100).optional(),
    address: textField(250, 'Address'),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    /** New records start in review; an administrator may approve at creation. */
    status: z.enum(['PENDING_REVIEW', 'APPROVED']).default('PENDING_REVIEW'),
  })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    path: ['latitude'],
    message: 'Provide both latitude and longitude, or neither',
  });

/** City, category and slug are immutable: URLs stay stable and restrictions stay consistent. */
export const updateLocationSchema = z
  .strictObject({
    name: nameField(2, 120),
    address: textField(250, 'Address'),
    latitude: latitude.nullable(),
    longitude: longitude.nullable(),
    status: z.enum(LOCATION_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field' });

export const createRestrictionSchema = z.strictObject({
  /** Omit or null for a rule that applies to the whole venue. */
  taskId: z.uuid('taskId must be a UUID').nullish(),
  rule: z.enum(['PROHIBITED', 'REQUIRES_AUTHORIZATION', 'ADVISORY'], 'Choose a rule'),
  note: textField(500, 'Note'),
});

// ── queries ───────────────────────────────────────────────────────────────────
const slugFilter = z
  .string()
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'Invalid slug')
  .optional();

export const publicLocationQuerySchema = z.object({
  city: slugFilter,
  category: slugFilter,
  q: z
    .string()
    .transform((v) => v.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(80, 'Search is limited to 80 characters'))
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  ...pageParams,
});

export const adminLocationQuerySchema = z.object({
  city: slugFilter,
  category: slugFilter,
  status: z.enum(LOCATION_STATUSES).optional(),
  q: publicLocationQuerySchema.shape.q,
  ...pageParams,
});

export const adminCityListSchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export class CreateCityDto extends createZodDto(createCitySchema) {}
export class UpdateCityDto extends createZodDto(updateCitySchema) {}
export class CreateLocationDto extends createZodDto(createLocationSchema) {}
export class UpdateLocationDto extends createZodDto(updateLocationSchema) {}
export class CreateRestrictionDto extends createZodDto(createRestrictionSchema) {}
export class PublicLocationQuery extends createZodDto(publicLocationQuerySchema) {}
export class AdminLocationQuery extends createZodDto(adminLocationQuerySchema) {}
export class AdminCityListQuery extends createZodDto(adminCityListSchema) {}
