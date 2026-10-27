import type { Eligibility } from './catalog';

// Response shapes of the authenticated request/quote API (apps/api/src/service-requests). The API's
// e2e tests assert these field sets, so drift on either side fails a test (D-007).

export type RequestStatus = 'OPEN' | 'QUOTED' | 'QUOTE_ACCEPTED' | 'CANCELLED' | 'EXPIRED';
export type QuoteStatus = 'PENDING' | 'ACCEPTED' | 'NOT_SELECTED' | 'WITHDRAWN' | 'REQUEST_CLOSED';
export type TimePeriod = 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING';

export interface RequestView {
  id: string;
  status: RequestStatus;
  acceptingQuotes: boolean;
  task: { slug: string; name: string; category: { slug: string; name: string } };
  city: { slug: string; name: string; state: string };
  location: { slug: string; name: string; address: string } | null;
  description: string;
  constraints: string | null;
  schedule: { kind: 'FLEXIBLE' | 'ON_DATE'; date: string | null; period: TimePeriod };
  authorization: { required: boolean; confirmed: boolean; notes: string | null };
  pendingQuoteCount: number;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
  closureReason: string | null;
}

export interface OwnerQuote {
  id: string;
  status: QuoteStatus;
  amountKobo: number;
  currency: string;
  message: string | null;
  createdAt: string;
  selectable: boolean;
  assistant: {
    displayName: string;
    slug: string | null;
    languages: { code: string; name: string }[];
  };
}

export interface AssistantQuote {
  id: string;
  status: QuoteStatus;
  amountKobo: number;
  currency: string;
  message: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type FeedItem = RequestView & { myQuote: AssistantQuote | null };
export interface OwnRequestDetail {
  request: RequestView;
  quotes: OwnerQuote[];
}
export interface AssistantRequestDetail {
  request: RequestView;
  myQuotes: AssistantQuote[];
}
export interface MyQuoteItem {
  quote: AssistantQuote;
  request: RequestView;
}

export const REQUEST_STATUS_COPY: Record<
  RequestStatus,
  { label: string; tone: 'info' | 'success' | 'error' | 'neutral'; hint: string }
> = {
  OPEN: {
    label: 'Open for quotes',
    tone: 'info',
    hint: 'Eligible assistants who serve this area can send you a quote.',
  },
  QUOTED: {
    label: 'Quotes received',
    tone: 'info',
    hint: 'Compare the quotes below and accept one.',
  },
  QUOTE_ACCEPTED: {
    label: 'Quote accepted',
    tone: 'success',
    hint: 'You chose a quote. Payment and booking confirmation are not available yet, so nothing has been charged.',
  },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', hint: 'This request was cancelled.' },
  EXPIRED: {
    label: 'Expired',
    tone: 'neutral',
    hint: 'This request is past its date and no longer accepts quotes. You can cancel it and post a new one.',
  },
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  PENDING: 'Waiting for your decision',
  ACCEPTED: 'Accepted',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn by the assistant',
  REQUEST_CLOSED: 'Closed with the request',
};

/** The same statuses worded for the assistant who sent the quote. */
export const ASSISTANT_QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  PENDING: 'Waiting for the customer to decide',
  ACCEPTED: 'Accepted by the customer',
  NOT_SELECTED: 'The customer chose a different quote',
  WITHDRAWN: 'You withdrew this quote',
  REQUEST_CLOSED: 'Closed: the request was cancelled',
};

export const PERIOD_LABEL: Record<TimePeriod, string> = {
  ANY: 'Any time of day',
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
};

/** "Saturday 31 October 2026"; the date is a calendar date, so it is formatted in UTC. */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function describeSchedule(schedule: RequestView['schedule']): string {
  if (schedule.kind === 'FLEXIBLE' || !schedule.date)
    return 'Flexible: any time in the next two weeks';
  const day = formatCalendarDate(schedule.date);
  return schedule.period === 'ANY' ? day : `${day}, ${PERIOD_LABEL[schedule.period].toLowerCase()}`;
}

// ── money: integer kobo only, never floats ───────────────────────────────────
export const MIN_QUOTE_KOBO = 10_000;
export const MAX_QUOTE_KOBO = 50_000_000;

/** "₦2,500" or "₦2,500.50". Pure integer arithmetic. */
export function formatNaira(kobo: number): string {
  const whole = Math.trunc(kobo / 100);
  const fraction = Math.abs(kobo % 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${grouped}${fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`}`;
}

/**
 * Parses what a person types ("2500", "2,500", "2500.5", "₦2,500.50") into whole kobo, or null when
 * it is not a plain amount with at most two decimals. No parseFloat: 19.99 * 100 is 1998.9999…
 */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦\s,]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const kobo = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(kobo) ? kobo : null;
}

export function validateQuoteAmount(input: string): string | undefined {
  if (!input.trim()) return 'Enter your price in naira';
  const kobo = nairaToKobo(input);
  if (kobo === null) return 'Enter an amount like 2500 or 2,500.50';
  if (kobo < MIN_QUOTE_KOBO) return `The minimum quote is ${formatNaira(MIN_QUOTE_KOBO)}`;
  if (kobo > MAX_QUOTE_KOBO) return `The maximum quote is ${formatNaira(MAX_QUOTE_KOBO)}`;
  return undefined;
}

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

// ── assistant search: one "service" select carries category and optional task ─
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `category` or `category/task` → the two API parameters. Anything malformed is dropped. */
export function parseService(value: string | undefined): { category?: string; task?: string } {
  if (!value) return {};
  const [category, task, ...rest] = value.split('/');
  if (rest.length > 0 || !category || !SLUG.test(category)) return {};
  if (task === undefined) return { category };
  return SLUG.test(task) ? { category, task } : { category };
}

export const serviceValue = (category?: string, task?: string): string =>
  category ? (task ? `${category}/${task}` : category) : '';

export interface AssistantSearchParams {
  city?: string | undefined;
  service?: string | undefined;
  language?: string | undefined;
  q?: string | undefined;
  page: number;
}

/** Untrusted URL parameters → safe values; invalid entries are dropped, never forwarded. */
export function parseAssistantSearch(
  raw: Record<string, string | string[] | undefined>,
  languageCodes: readonly string[],
): AssistantSearchParams {
  const city = first(raw.city);
  const service = first(raw.service);
  const language = first(raw.language);
  const q = first(raw.q)?.replace(/\s+/g, ' ').slice(0, 80);
  const page = Number.parseInt(first(raw.page) ?? '1', 10);
  const parsed = parseService(service);
  return {
    city: city && SLUG.test(city) && city.length <= 100 ? city : undefined,
    service: parsed.category ? serviceValue(parsed.category, parsed.task) : undefined,
    language: language && languageCodes.includes(language) ? language : undefined,
    q: q || undefined,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query string for the page links (keeps `service`) and, via `forApi`, for the API call. */
export function assistantQueryString(
  params: Partial<AssistantSearchParams>,
  options: { forApi?: boolean; pageSize?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.city) query.set('city', params.city);
  if (options.forApi) {
    const { category, task } = parseService(params.service);
    if (category) query.set('category', category);
    if (task) query.set('task', task);
  } else if (params.service) {
    query.set('service', params.service);
  }
  if (params.language) query.set('language', params.language);
  if (params.q) query.set('q', params.q);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  return query.toString();
}

export const eligibilityNeedsAuthorization = (e: Eligibility) => e === 'REQUIRES_AUTHORIZATION';

/** YYYY-MM-DD "today" in Lagos, computed on the server and passed down so SSR and hydration agree. */
export function todayInLagos(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now);
}
