import { formatMinutes, parseTime, validateWindows } from './availability.js';

describe('time parsing', () => {
  it('parses and formats 24-hour times', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('08:30')).toBe(510);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBe(1440);
    expect(formatMinutes(510)).toBe('08:30');
    expect(formatMinutes(1440)).toBe('24:00');
  });

  it.each(['', '8:30', '24:01', '25:00', '12:60', '12:5', 'noon', '12:30pm', '-1:00'])(
    'rejects %j',
    (value) => {
      expect(parseTime(value)).toBeNull();
    },
  );
});

describe('validateWindows', () => {
  const w = (dayOfWeek: number, start: string, end: string) => ({ dayOfWeek, start, end });

  it('accepts and sorts a valid weekly declaration', () => {
    const result = validateWindows([
      w(2, '13:00', '17:00'),
      w(1, '08:00', '12:00'),
      w(2, '08:00', '12:00'),
    ]);
    expect(result).toEqual({
      ok: true,
      windows: [
        { dayOfWeek: 1, startMinute: 480, endMinute: 720 },
        { dayOfWeek: 2, startMinute: 480, endMinute: 720 },
        { dayOfWeek: 2, startMinute: 780, endMinute: 1020 },
      ],
    });
  });

  it('allows an empty declaration and windows that touch end-to-start', () => {
    expect(validateWindows([])).toEqual({ ok: true, windows: [] });
    expect(validateWindows([w(1, '08:00', '12:00'), w(1, '12:00', '24:00')]).ok).toBe(true);
  });

  it('rejects bad times, reversed ranges and a start of 24:00', () => {
    for (const bad of [
      w(1, '8am', '12:00'),
      w(1, '12:00', '08:00'),
      w(1, '10:00', '10:00'),
      w(1, '24:00', '24:00'),
    ]) {
      expect(validateWindows([bad]).ok).toBe(false);
    }
  });

  it('rejects overlapping windows on the same day but not on different days', () => {
    expect(validateWindows([w(1, '08:00', '12:00'), w(1, '11:59', '14:00')]).ok).toBe(false);
    expect(validateWindows([w(1, '08:00', '12:00'), w(2, '08:00', '12:00')]).ok).toBe(true);
  });

  it('caps windows per day and in total', () => {
    const five = ['01:00', '03:00', '05:00', '07:00', '09:00'].map((s, i) =>
      w(1, s, ['02:00', '04:00', '06:00', '08:00', '10:00'][i] as string),
    );
    expect(validateWindows(five).ok).toBe(false);
    const tooMany = Array.from({ length: 29 }, (_, i) => w(i % 7, '08:00', '09:00'));
    expect(validateWindows(tooMany).ok).toBe(false);
  });
});
