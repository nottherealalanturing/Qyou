import { z } from 'zod';
import { createZodDto } from '../common/zod/create-zod-dto.js';
import { nameField, slugField, textField } from '../common/text.js';

const iconKey = z
  .string('Icon is required')
  .regex(/^[a-z][a-z0-9-]{1,29}$/, 'Use a lowercase icon key such as "landmark"');
const sortOrder = z.number('Sort order must be a number').int().min(0).max(10_000);

// ── categories ────────────────────────────────────────────────────────────────
export const createCategorySchema = z.strictObject({
  name: nameField(2, 80),
  /** Optional: derived from the name when omitted. Immutable after creation. */
  slug: slugField().optional(),
  description: textField(500, 'Description'),
  iconKey,
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});

/** No `slug`: slugs are immutable so public URLs never break. */
export const updateCategorySchema = z
  .strictObject({
    name: nameField(2, 80),
    description: textField(500, 'Description'),
    iconKey,
    sortOrder,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field' });

// ── tasks ─────────────────────────────────────────────────────────────────────
const optionalNote = z.union([textField(1000, 'Note'), z.null()]).optional();

const taskShape = {
  name: nameField(2, 100),
  description: textField(500, 'Description'),
  kind: z.enum(['QUEUE_HOLDING', 'ERRAND'], 'Choose QUEUE_HOLDING or ERRAND'),
  eligibility: z.enum(
    ['ELIGIBLE', 'REQUIRES_AUTHORIZATION', 'NOT_DELEGABLE'],
    'Choose ELIGIBLE, REQUIRES_AUTHORIZATION or NOT_DELEGABLE',
  ),
  requiresPersonalPresence: z.boolean(),
  requiresCredentials: z.boolean(),
  authorizationNotes: optionalNote,
  restrictionNotes: optionalNote,
  sortOrder,
  isActive: z.boolean(),
};

export const createTaskSchema = z.strictObject({
  name: taskShape.name,
  slug: slugField().optional(),
  description: taskShape.description,
  kind: taskShape.kind,
  eligibility: taskShape.eligibility,
  requiresPersonalPresence: taskShape.requiresPersonalPresence.default(false),
  requiresCredentials: taskShape.requiresCredentials.default(false),
  authorizationNotes: taskShape.authorizationNotes,
  restrictionNotes: taskShape.restrictionNotes,
  sortOrder: taskShape.sortOrder.default(0),
  isActive: taskShape.isActive.default(true),
});

export const updateTaskSchema = z
  .strictObject(taskShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field' });

// ── queries ───────────────────────────────────────────────────────────────────
export const adminListSchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
export class CreateTaskDto extends createZodDto(createTaskSchema) {}
export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}
export class AdminListQuery extends createZodDto(adminListSchema) {}
