import { STATUS_COPY, daysToWindows, windowsToDays, type ApplicationStatus } from './assistants';

describe('availability helpers', () => {
  const windows = [
    { dayOfWeek: 1, start: '08:00', end: '12:00' },
    { dayOfWeek: 3, start: '13:00', end: '17:00' },
    { dayOfWeek: 1, start: '14:00', end: '16:00' },
  ];

  it('groups windows by day with all seven days present', () => {
    const days = windowsToDays(windows);
    expect(Object.keys(days)).toHaveLength(7);
    expect(days[1]).toEqual([
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '16:00' },
    ]);
    expect(days[0]).toEqual([]);
  });

  it('round-trips, and drops half-filled rows instead of sending them', () => {
    const roundTrip = daysToWindows(windowsToDays(windows));
    expect(
      roundTrip.toSorted((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start)),
    ).toEqual(
      windows.toSorted((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start)),
    );
    const days = windowsToDays([]);
    days[2] = [
      { start: '09:00', end: '' },
      { start: '', end: '10:00' },
      { start: '09:00', end: '10:00' },
    ];
    expect(daysToWindows(days)).toEqual([{ dayOfWeek: 2, start: '09:00', end: '10:00' }]);
  });
});

describe('status copy', () => {
  it('describes every status and never promises more than is true', () => {
    const all: ApplicationStatus[] = [
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'CHANGES_REQUESTED',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
    ];
    for (const status of all) {
      expect(STATUS_COPY[status].title).toBeTruthy();
      expect(STATUS_COPY[status].body.endsWith('.')).toBe(true);
    }
    // Approval copy must not claim jobs exist today.
    expect(STATUS_COPY.APPROVED.body).toMatch(/once bookings open/);
    expect(STATUS_COPY.UNDER_REVIEW.body).toMatch(/Editing is paused/);
  });
});
