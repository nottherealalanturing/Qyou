import type { Prisma } from '../generated/prisma/client.js';
import { LANGUAGES } from '../assistants/assistants.schemas.js';
import { effectiveStatus, acceptsQuotes } from './request-state.js';

/** Everything a request view needs, selected explicitly so no stray column can leak. */
export const REQUEST_INCLUDE = {
  task: {
    select: {
      slug: true,
      name: true,
      eligibility: true,
      authorizationNotes: true,
      category: { select: { slug: true, name: true } },
    },
  },
  city: { select: { slug: true, name: true, state: true } },
  location: { select: { slug: true, name: true, address: true } },
  _count: { select: { quotes: { where: { status: 'PENDING' as const } } } },
} satisfies Prisma.ServiceRequestInclude;

export type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/**
 * The request as seen by its OWNER or by a matching assistant. Deliberately has no customer fields
 * at all (no id, name or email): assistants never learn who is asking. `acceptingQuotes` is derived
 * from the clock, so a stale OPEN row past its expiry reads as expired.
 */
export function toRequestView(row: RequestRow, now: Date) {
  const status = effectiveStatus(row.status, row.expiresAt, now);
  const requiresAuthorization =
    row.authorizationConfirmedAt !== null || row.task.eligibility === 'REQUIRES_AUTHORIZATION';
  return {
    id: row.id,
    status,
    acceptingQuotes: acceptsQuotes(row.status, row.expiresAt, now),
    task: {
      slug: row.task.slug,
      name: row.task.name,
      category: row.task.category,
    },
    city: row.city,
    location: row.location,
    description: row.description,
    constraints: row.constraints,
    schedule: {
      kind: row.scheduleKind,
      date: row.preferredDate ? row.preferredDate.toISOString().slice(0, 10) : null,
      period: row.preferredPeriod,
    },
    authorization: {
      required: requiresAuthorization,
      confirmed: row.authorizationConfirmedAt !== null,
      notes: requiresAuthorization ? row.task.authorizationNotes : null,
    },
    pendingQuoteCount: row._count.quotes,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    closureReason: row.closureReason,
  };
}

export type RequestView = ReturnType<typeof toRequestView>;

export const QUOTE_SELECT = {
  id: true,
  amountKobo: true,
  currency: true,
  message: true,
  status: true,
  createdAt: true,
  statusChangedAt: true,
  assistant: { select: { userId: true, slug: true, displayName: true, languages: true } },
} satisfies Prisma.QuoteSelect;

export type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof QUOTE_SELECT }>;

const languageNames = (codes: string[]) =>
  codes.map((code) => ({ code, name: LANGUAGES[code as keyof typeof LANGUAGES] ?? code }));

/**
 * A quote as the REQUEST OWNER sees it. The assistant is identified only by public profile data;
 * the profile link is given only while the quote can still be selected (the profile is public only
 * for currently eligible assistants).
 */
export function toOwnerQuoteView(row: QuoteRow, selectable: boolean) {
  return {
    id: row.id,
    status: row.status,
    amountKobo: row.amountKobo,
    currency: row.currency,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    selectable,
    assistant: {
      displayName: row.assistant.displayName,
      slug: selectable ? row.assistant.slug : null,
      languages: languageNames(row.assistant.languages),
    },
  };
}

/** A quote as its ASSISTANT sees it (their own; no customer data). */
export function toAssistantQuoteView(
  row: Pick<QuoteRow, 'id' | 'amountKobo' | 'currency' | 'message' | 'status' | 'createdAt'>,
) {
  return {
    id: row.id,
    status: row.status,
    amountKobo: row.amountKobo,
    currency: row.currency,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}
