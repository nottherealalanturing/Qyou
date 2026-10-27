import { z } from 'zod';
import { pageParams } from '../common/pagination.js';
import { textField } from '../common/text.js';
import { createZodDto } from '../common/zod/create-zod-dto.js';
import { CONTACT_DETAILS_MESSAGE, containsContactDetails } from './contact-guard.js';

/** Sanity bounds for a proposal, NOT a pricing policy (fees and currency policy are undecided). */
export const MIN_QUOTE_KOBO = 10_000; // ₦100
export const MAX_QUOTE_KOBO = 50_000_000; // ₦500,000

const noContactDetails = (value: string) => !containsContactDetails(value);

const description = textField(1000, 'Description')
  .refine((v) => v.length >= 10, 'Describe what you need in at least 10 characters')
  .refine(noContactDetails, CONTACT_DETAILS_MESSAGE);

const constraints = z.union([
  textField(500, 'Constraints').refine(noContactDetails, CONTACT_DETAILS_MESSAGE),
  z.null(),
]);

const scheduleSchema = z.strictObject({
  kind: z.enum(['FLEXIBLE', 'ON_DATE'], 'Choose flexible or a specific date'),
  /** YYYY-MM-DD in the city's timezone. */
  date: z.string().max(10).optional(),
  period: z.enum(['ANY', 'MORNING', 'AFTERNOON', 'EVENING']).optional(),
});

export const createRequestSchema = z
  .strictObject({
    taskId: z.uuid('Choose a task'),
    cityId: z.uuid().optional(),
    locationId: z.union([z.uuid(), z.null()]).optional(),
    description,
    constraints: constraints.optional(),
    schedule: scheduleSchema,
    /** Required when the task needs the customer's authorization (checked against the task, not trusted). */
    confirmsAuthorization: z.boolean().optional(),
  })
  .refine((v) => v.cityId || v.locationId, {
    message: 'Choose a city or a venue',
    path: ['cityId'],
  });

export const cancelRequestSchema = z.strictObject({
  reason: textField(300, 'Reason').optional(),
});

const REQUEST_VIEWS = ['OPEN', 'QUOTED', 'QUOTE_ACCEPTED', 'CANCELLED', 'EXPIRED'] as const;
export const listRequestsSchema = z.object({
  status: z.enum(REQUEST_VIEWS).optional(),
  ...pageParams,
});

export const submitQuoteSchema = z.strictObject({
  amountKobo: z
    .number('Enter an amount')
    .int('Amounts are whole kobo')
    .min(MIN_QUOTE_KOBO, 'The minimum quote is ₦100')
    .max(MAX_QUOTE_KOBO, 'The maximum quote is ₦500,000'),
  currency: z.literal('NGN', 'Only Nigerian naira (NGN) quotes are supported').default('NGN'),
  message: z
    .union([textField(1000, 'Message').refine(noContactDetails, CONTACT_DETAILS_MESSAGE), z.null()])
    .optional(),
});

export const feedQuerySchema = z.object({ ...pageParams });

export class CreateRequestDto extends createZodDto(createRequestSchema) {}
export class CancelRequestDto extends createZodDto(cancelRequestSchema) {}
export class ListRequestsQuery extends createZodDto(listRequestsSchema) {}
export class SubmitQuoteDto extends createZodDto(submitQuoteSchema) {}
export class FeedQuery extends createZodDto(feedQuerySchema) {}
