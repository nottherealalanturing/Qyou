/**
 * Scheduling preference for a request: a calendar DATE in the city's timezone (plus a coarse time of
 * day), or "flexible". Dates avoid timezone arithmetic in the UI. The only instant we compute is
 * `expiresAt`, the moment a request stops accepting quotes, and it is computed here, never by clients.
 */
export const FLEXIBLE_TTL_DAYS = 14;
export const MAX_ADVANCE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a strict YYYY-MM-DD calendar date; `null` for malformed or impossible dates (e.g. 2026-02-30). */
export function parseDate(value: string): { y: number; m: number; d: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d)
    return null;
  return { y, m, d };
}

export const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

/** Offset (local − UTC, in ms) of `timeZone` at the instant `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** Today's calendar date (YYYY-MM-DD) in `timeZone`. */
export function localToday(now: Date, timeZone: string): string {
  return formatDate(new Date(now.getTime() + offsetMs(now, timeZone)));
}

/** The instant the given local calendar date ENDS (the next local midnight) in `timeZone`. */
export function endOfLocalDate(date: string, timeZone: string): Date {
  const parsed = parseDate(date);
  if (!parsed) throw new Error('endOfLocalDate needs a valid YYYY-MM-DD date');
  const nextMidnightAsUtc = Date.UTC(parsed.y, parsed.m - 1, parsed.d + 1);
  // Two passes so a DST change between the guess and the answer cannot leave the result an hour off.
  const first = nextMidnightAsUtc - offsetMs(new Date(nextMidnightAsUtc), timeZone);
  return new Date(nextMidnightAsUtc - offsetMs(new Date(first), timeZone));
}

export interface ScheduleInput {
  kind: 'FLEXIBLE' | 'ON_DATE';
  date?: string | undefined;
  period?: 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING' | undefined;
}

export type ScheduleResult =
  | {
      ok: true;
      scheduleKind: 'FLEXIBLE' | 'ON_DATE';
      preferredDate: Date | null;
      preferredPeriod: 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING';
      expiresAt: Date;
    }
  | { ok: false; path: string; message: string };

export function resolveSchedule(input: ScheduleInput, now: Date, timeZone: string): ScheduleResult {
  if (input.kind === 'FLEXIBLE') {
    if (input.date)
      return { ok: false, path: 'schedule.date', message: 'A flexible request has no date' };
    return {
      ok: true,
      scheduleKind: 'FLEXIBLE',
      preferredDate: null,
      preferredPeriod: 'ANY',
      expiresAt: new Date(now.getTime() + FLEXIBLE_TTL_DAYS * DAY_MS),
    };
  }
  if (!input.date || !parseDate(input.date))
    return { ok: false, path: 'schedule.date', message: 'Choose a valid date' };
  const today = localToday(now, timeZone);
  if (input.date < today)
    return { ok: false, path: 'schedule.date', message: 'Choose today or a later date' };
  const latest = formatDate(new Date(Date.parse(`${today}T00:00:00Z`) + MAX_ADVANCE_DAYS * DAY_MS));
  if (input.date > latest)
    return {
      ok: false,
      path: 'schedule.date',
      message: `Choose a date within the next ${MAX_ADVANCE_DAYS} days`,
    };
  return {
    ok: true,
    scheduleKind: 'ON_DATE',
    preferredDate: new Date(`${input.date}T00:00:00Z`),
    preferredPeriod: input.period ?? 'ANY',
    expiresAt: endOfLocalDate(input.date, timeZone),
  };
}
