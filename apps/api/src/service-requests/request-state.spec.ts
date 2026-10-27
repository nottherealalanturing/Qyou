import { describe, expect, it } from 'vitest';
import type { QuoteStatus, ServiceRequestStatus } from '../generated/prisma/client.js';
import {
  acceptsQuotes,
  allowedQuoteTransition,
  allowedRequestTransition,
  effectiveStatus,
  QUOTE_TRANSITIONS,
  REQUEST_TRANSITIONS,
} from './request-state.js';

const REQUEST: ServiceRequestStatus[] = ['OPEN', 'QUOTED', 'QUOTE_ACCEPTED', 'CANCELLED'];
const QUOTE: QuoteStatus[] = ['PENDING', 'ACCEPTED', 'NOT_SELECTED', 'WITHDRAWN', 'REQUEST_CLOSED'];

describe('request transitions', () => {
  it('allows exactly the documented moves', () => {
    const allowed = REQUEST.flatMap((from) =>
      REQUEST.filter((to) => allowedRequestTransition(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.toSorted()).toEqual(
      [
        'OPEN>QUOTED',
        'OPEN>CANCELLED',
        'QUOTED>OPEN',
        'QUOTED>QUOTE_ACCEPTED',
        'QUOTED>CANCELLED',
        'QUOTE_ACCEPTED>CANCELLED',
      ].toSorted(),
    );
  });

  it('cannot accept straight from OPEN, reopen, or leave CANCELLED', () => {
    expect(allowedRequestTransition('OPEN', 'QUOTE_ACCEPTED')).toBe(false);
    expect(allowedRequestTransition('CANCELLED', 'OPEN')).toBe(false);
    expect(allowedRequestTransition('QUOTE_ACCEPTED', 'OPEN')).toBe(false);
    expect(REQUEST_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe('quote transitions', () => {
  it('allows exactly the documented moves', () => {
    const allowed = QUOTE.flatMap((from) =>
      QUOTE.filter((to) => allowedQuoteTransition(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.toSorted()).toEqual(
      [
        'PENDING>ACCEPTED',
        'PENDING>NOT_SELECTED',
        'PENDING>WITHDRAWN',
        'PENDING>REQUEST_CLOSED',
        'ACCEPTED>REQUEST_CLOSED',
      ].toSorted(),
    );
  });

  it('losing, withdrawn and closed quotes are final', () => {
    for (const s of ['NOT_SELECTED', 'WITHDRAWN', 'REQUEST_CLOSED'] as const)
      expect(QUOTE_TRANSITIONS[s]).toEqual([]);
  });
});

describe('expiry is derived, never stored', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const past = new Date('2026-10-24T11:59:59Z');
  const future = new Date('2026-10-24T12:00:01Z');

  it('turns live requests into EXPIRED once expiresAt passes (boundary included)', () => {
    expect(effectiveStatus('OPEN', past, now)).toBe('EXPIRED');
    expect(effectiveStatus('QUOTED', now, now)).toBe('EXPIRED');
    expect(effectiveStatus('OPEN', future, now)).toBe('OPEN');
  });

  it('never rewrites accepted or cancelled requests', () => {
    expect(effectiveStatus('QUOTE_ACCEPTED', past, now)).toBe('QUOTE_ACCEPTED');
    expect(effectiveStatus('CANCELLED', past, now)).toBe('CANCELLED');
  });

  it('accepts quotes only while OPEN/QUOTED and unexpired', () => {
    expect(acceptsQuotes('OPEN', future, now)).toBe(true);
    expect(acceptsQuotes('QUOTED', future, now)).toBe(true);
    expect(acceptsQuotes('OPEN', past, now)).toBe(false);
    expect(acceptsQuotes('QUOTE_ACCEPTED', future, now)).toBe(false);
    expect(acceptsQuotes('CANCELLED', future, now)).toBe(false);
  });
});
