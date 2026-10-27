import type { QuoteStatus, ServiceRequestStatus } from '../generated/prisma/client.js';

/**
 * The request lifecycle. Mirrored by a database trigger (service_requests_before_update), so an
 * invalid move fails even if a service forgets to check. Terminal: CANCELLED. There is no reopen.
 */
export const REQUEST_TRANSITIONS: Record<ServiceRequestStatus, readonly ServiceRequestStatus[]> = {
  OPEN: ['QUOTED', 'CANCELLED'],
  QUOTED: ['OPEN', 'QUOTE_ACCEPTED', 'CANCELLED'],
  QUOTE_ACCEPTED: ['CANCELLED'],
  CANCELLED: [],
};

export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  PENDING: ['ACCEPTED', 'NOT_SELECTED', 'WITHDRAWN', 'REQUEST_CLOSED'],
  ACCEPTED: ['REQUEST_CLOSED'],
  NOT_SELECTED: [],
  WITHDRAWN: [],
  REQUEST_CLOSED: [],
};

export const allowedRequestTransition = (from: ServiceRequestStatus, to: ServiceRequestStatus) =>
  REQUEST_TRANSITIONS[from].includes(to);
export const allowedQuoteTransition = (from: QuoteStatus, to: QuoteStatus) =>
  QUOTE_TRANSITIONS[from].includes(to);

/** Status as shown to people: an OPEN/QUOTED request past `expiresAt` reads EXPIRED (derived, never stored). */
export type EffectiveStatus = ServiceRequestStatus | 'EXPIRED';

export function effectiveStatus(
  status: ServiceRequestStatus,
  expiresAt: Date,
  now: Date,
): EffectiveStatus {
  return (status === 'OPEN' || status === 'QUOTED') && expiresAt.getTime() <= now.getTime()
    ? 'EXPIRED'
    : status;
}

/** New quotes may be submitted, and one selected, only while the request is live. */
export function acceptsQuotes(status: ServiceRequestStatus, expiresAt: Date, now: Date): boolean {
  const effective = effectiveStatus(status, expiresAt, now);
  return effective === 'OPEN' || effective === 'QUOTED';
}

/** Quote rows that still count as "live": they block a duplicate and are closed with the request. */
export const LIVE_QUOTE_STATUSES: readonly QuoteStatus[] = ['PENDING', 'ACCEPTED'];

export const MAX_LIVE_REQUESTS_PER_CUSTOMER = 10;
export const MAX_PENDING_QUOTES_PER_REQUEST = 20;
export const MAX_QUOTES_PER_ASSISTANT_PER_REQUEST = 3;
