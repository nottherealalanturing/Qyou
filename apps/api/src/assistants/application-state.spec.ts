import type { ApplicationStatus } from '../generated/prisma/client.js';
import {
  TRANSITIONS,
  allowedTransition,
  canVerifyPhone,
  editScope,
  missingForSubmission,
  nextStatuses,
  reasonRequired,
  roleForStatus,
} from './application-state.js';

const ALL: ApplicationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
];

describe('application state machine', () => {
  it('allows exactly the documented transitions, by the documented actor', () => {
    const legal: [ApplicationStatus, ApplicationStatus, 'assistant' | 'admin'][] = [
      ['DRAFT', 'SUBMITTED', 'assistant'],
      ['CHANGES_REQUESTED', 'SUBMITTED', 'assistant'],
      ['SUBMITTED', 'UNDER_REVIEW', 'admin'],
      ['UNDER_REVIEW', 'CHANGES_REQUESTED', 'admin'],
      ['UNDER_REVIEW', 'APPROVED', 'admin'],
      ['UNDER_REVIEW', 'REJECTED', 'admin'],
      ['REJECTED', 'UNDER_REVIEW', 'admin'],
      ['APPROVED', 'SUSPENDED', 'admin'],
      ['SUSPENDED', 'APPROVED', 'admin'],
      ['SUSPENDED', 'REJECTED', 'admin'],
    ];
    for (const [from, to, who] of legal) expect(allowedTransition(from, to)).toBe(who);

    const count = ALL.flatMap((f) => ALL.map((t) => allowedTransition(f, t))).filter(
      Boolean,
    ).length;
    expect(count).toBe(legal.length); // nothing else is allowed
  });

  it('never lets an application skip review or approve itself from a draft', () => {
    expect(allowedTransition('DRAFT', 'APPROVED')).toBeNull();
    expect(allowedTransition('SUBMITTED', 'APPROVED')).toBeNull();
    expect(allowedTransition('CHANGES_REQUESTED', 'APPROVED')).toBeNull();
    expect(allowedTransition('REJECTED', 'APPROVED')).toBeNull();
    expect(allowedTransition('APPROVED', 'DRAFT')).toBeNull();
    expect(allowedTransition('APPROVED', 'APPROVED')).toBeNull();
  });

  it('an assistant can only ever move their own application to SUBMITTED', () => {
    for (const status of ALL) {
      const mine = nextStatuses(status, 'assistant');
      expect(mine.every((to) => to === 'SUBMITTED')).toBe(true);
    }
    expect(Object.keys(TRANSITIONS)).toHaveLength(ALL.length);
  });

  it('requires a reason for every decision except starting a review', () => {
    expect(reasonRequired('SUBMITTED', 'UNDER_REVIEW')).toBe(false);
    for (const [from, to] of [
      ['UNDER_REVIEW', 'APPROVED'],
      ['UNDER_REVIEW', 'REJECTED'],
      ['UNDER_REVIEW', 'CHANGES_REQUESTED'],
      ['APPROVED', 'SUSPENDED'],
      ['SUSPENDED', 'APPROVED'],
      ['REJECTED', 'UNDER_REVIEW'],
    ] as const) {
      expect(reasonRequired(from, to)).toBe(true);
    }
  });

  it('keeps the ASSISTANT role tied to APPROVED only', () => {
    for (const status of ALL)
      expect(roleForStatus(status)).toBe(status === 'APPROVED' ? 'ASSISTANT' : 'CUSTOMER');
  });

  it('locks edits while under review and after rejection or suspension', () => {
    expect(editScope('DRAFT')).toBe('full');
    expect(editScope('CHANGES_REQUESTED')).toBe('full');
    expect(editScope('APPROVED')).toBe('limited');
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'SUSPENDED'] as const)
      expect(editScope(status)).toBe('none');
    expect(canVerifyPhone('UNDER_REVIEW')).toBe(true);
    expect(canVerifyPhone('SUSPENDED')).toBe(false);
    expect(canVerifyPhone('REJECTED')).toBe(false);
  });
});

describe('missingForSubmission', () => {
  const complete = {
    displayName: 'Ada O.',
    bio: 'x'.repeat(60),
    languages: ['en'],
    areaCount: 1,
    offerCount: 2,
    windowCount: 3,
    legalName: 'Ada Obi',
    phone: '+2348031234567',
  };

  it('reports nothing for a complete profile', () => {
    expect(missingForSubmission(complete)).toEqual([]);
  });

  it('reports each missing piece by key', () => {
    const keys = missingForSubmission({
      displayName: ' ',
      bio: 'short',
      languages: [],
      areaCount: 0,
      offerCount: 0,
      windowCount: 0,
      legalName: null,
      phone: null,
    }).map((m) => m.key);
    expect(keys).toEqual([
      'displayName',
      'bio',
      'languages',
      'serviceAreas',
      'tasks',
      'availability',
      'legalName',
      'phone',
    ]);
  });
});
