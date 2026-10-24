import type { EligibleTask } from '../generated/prisma/client.js';
import { applyVenueRestrictions, type VenueRestriction } from './venue-rules.js';

function task(over: Partial<EligibleTask> = {}): EligibleTask {
  return {
    id: 't1',
    categoryId: 'c1',
    slug: 'hold-place-in-line',
    name: 'Hold place in line',
    nameKey: 'hold place in line',
    description: 'd',
    kind: 'QUEUE_HOLDING',
    eligibility: 'ELIGIBLE',
    requiresPersonalPresence: false,
    requiresCredentials: false,
    authorizationNotes: null,
    restrictionNotes: null,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}
const r = (
  rule: VenueRestriction['rule'],
  taskId: string | null,
  note = 'n',
): VenueRestriction => ({ rule, taskId, note });

describe('applyVenueRestrictions', () => {
  it('leaves an unrestricted task unchanged', () => {
    const out = applyVenueRestrictions(task(), []);
    expect(out.effectiveEligibility).toBe('ELIGIBLE');
    expect(out.venueNotes).toEqual([]);
  });

  it('a venue-wide PROHIBITED rule blocks every task there', () => {
    expect(applyVenueRestrictions(task(), [r('PROHIBITED', null)]).effectiveEligibility).toBe(
      'NOT_DELEGABLE',
    );
    expect(
      applyVenueRestrictions(
        task({ eligibility: 'REQUIRES_AUTHORIZATION', authorizationNotes: 'x' }),
        [r('PROHIBITED', null)],
      ).effectiveEligibility,
    ).toBe('NOT_DELEGABLE');
  });

  it('a task-specific rule only affects that task', () => {
    expect(applyVenueRestrictions(task(), [r('PROHIBITED', 'other')]).effectiveEligibility).toBe(
      'ELIGIBLE',
    );
    expect(applyVenueRestrictions(task(), [r('PROHIBITED', 't1')]).effectiveEligibility).toBe(
      'NOT_DELEGABLE',
    );
  });

  it('REQUIRES_AUTHORIZATION tightens ELIGIBLE but is not applied twice', () => {
    expect(
      applyVenueRestrictions(task(), [r('REQUIRES_AUTHORIZATION', 't1')]).effectiveEligibility,
    ).toBe('REQUIRES_AUTHORIZATION');
    expect(
      applyVenueRestrictions(
        task({ eligibility: 'REQUIRES_AUTHORIZATION', authorizationNotes: 'x' }),
        [r('REQUIRES_AUTHORIZATION', 't1')],
      ).effectiveEligibility,
    ).toBe('REQUIRES_AUTHORIZATION');
  });

  it('never loosens a NOT_DELEGABLE task, whatever the venue says', () => {
    const nd = task({
      eligibility: 'NOT_DELEGABLE',
      restrictionNotes: 'why',
      requiresPersonalPresence: true,
    });
    for (const rule of ['ADVISORY', 'REQUIRES_AUTHORIZATION', 'PROHIBITED'] as const) {
      expect(applyVenueRestrictions(nd, [r(rule, null)]).effectiveEligibility).toBe(
        'NOT_DELEGABLE',
      );
    }
  });

  it('ADVISORY adds a note without changing eligibility; notes are ordered strictest first', () => {
    const out = applyVenueRestrictions(task(), [
      r('ADVISORY', null, 'Go early'),
      r('REQUIRES_AUTHORIZATION', 't1', 'Bring a letter'),
    ]);
    expect(out.effectiveEligibility).toBe('REQUIRES_AUTHORIZATION');
    expect(out.venueNotes.map((n) => n.rule)).toEqual(['REQUIRES_AUTHORIZATION', 'ADVISORY']);
    expect(applyVenueRestrictions(task(), [r('ADVISORY', null)]).effectiveEligibility).toBe(
      'ELIGIBLE',
    );
  });
});
