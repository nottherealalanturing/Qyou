import { describe, expect, it } from 'vitest';
import { endOfLocalDate, localToday, parseDate, resolveSchedule } from './schedule.js';

/** Narrowing helper: fails the test (without a conditional expect) when scheduling was refused. */
function accepted(result: ReturnType<typeof resolveSchedule>) {
  if (!result.ok) throw new Error(`schedule refused: ${result.message}`);
  return result;
}

const LAGOS = 'Africa/Lagos'; // UTC+1, no daylight saving

describe('parseDate', () => {
  it('accepts real dates only', () => {
    expect(parseDate('2026-10-24')).toEqual({ y: 2026, m: 10, d: 24 });
    expect(parseDate('2028-02-29')).not.toBeNull();
    for (const bad of [
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-1-1',
      '24/10/2026',
      '',
      '2026-10-24T10:00',
    ])
      expect(parseDate(bad)).toBeNull();
  });
});

describe('local dates', () => {
  it('uses the city timezone, not UTC, to decide "today"', () => {
    // 23:30 UTC is already 00:30 the next day in Lagos.
    expect(localToday(new Date('2026-10-24T23:30:00Z'), LAGOS)).toBe('2026-10-25');
    expect(localToday(new Date('2026-10-24T22:30:00Z'), LAGOS)).toBe('2026-10-24');
  });

  it('ends a local date at the next local midnight', () => {
    expect(endOfLocalDate('2026-10-24', LAGOS).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(endOfLocalDate('2026-12-31', LAGOS).toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});

describe('resolveSchedule', () => {
  const now = new Date('2026-10-24T09:00:00Z');

  it('flexible requests expire 14 days after creation and carry no date', () => {
    const r = resolveSchedule({ kind: 'FLEXIBLE' }, now, LAGOS);
    expect(r).toMatchObject({
      ok: true,
      scheduleKind: 'FLEXIBLE',
      preferredDate: null,
      preferredPeriod: 'ANY',
    });
    expect(accepted(r).expiresAt.toISOString()).toBe('2026-11-07T09:00:00.000Z');
  });

  it('rejects a date on a flexible request', () => {
    expect(resolveSchedule({ kind: 'FLEXIBLE', date: '2026-10-25' }, now, LAGOS)).toMatchObject({
      ok: false,
    });
  });

  it('on-date requests expire at the end of the chosen local day', () => {
    const r = resolveSchedule(
      { kind: 'ON_DATE', date: '2026-10-26', period: 'MORNING' },
      now,
      LAGOS,
    );
    expect(r).toMatchObject({ ok: true, scheduleKind: 'ON_DATE', preferredPeriod: 'MORNING' });
    expect(accepted(r).expiresAt.toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('allows today but not yesterday, and caps how far ahead you can book', () => {
    expect(resolveSchedule({ kind: 'ON_DATE', date: '2026-10-24' }, now, LAGOS)).toMatchObject({
      ok: true,
    });
    expect(resolveSchedule({ kind: 'ON_DATE', date: '2026-10-23' }, now, LAGOS)).toMatchObject({
      ok: false,
    });
    expect(resolveSchedule({ kind: 'ON_DATE', date: '2026-12-23' }, now, LAGOS)).toMatchObject({
      ok: true,
    });
    expect(resolveSchedule({ kind: 'ON_DATE', date: '2026-12-24' }, now, LAGOS)).toMatchObject({
      ok: false,
    });
  });

  it('requires a valid date for ON_DATE', () => {
    expect(resolveSchedule({ kind: 'ON_DATE' }, now, LAGOS)).toMatchObject({
      ok: false,
      path: 'schedule.date',
    });
    expect(resolveSchedule({ kind: 'ON_DATE', date: '2026-02-30' }, now, LAGOS)).toMatchObject({
      ok: false,
    });
  });
});
