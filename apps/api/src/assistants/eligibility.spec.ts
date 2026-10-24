import { decideEligibility, type EligibilityInput } from './eligibility.js';

const ok: EligibilityInput = {
  userStatus: 'ACTIVE',
  userRole: 'ASSISTANT',
  emailVerified: true,
  profile: {
    status: 'APPROVED',
    identityOutcome: 'PASSED',
    phoneVerified: true,
    activeAreaCount: 1,
    effectiveOfferCount: 2,
  },
};

const withProfile = (
  over: Partial<NonNullable<EligibilityInput['profile']>>,
): EligibilityInput => ({
  ...ok,
  profile: { ...(ok.profile as NonNullable<EligibilityInput['profile']>), ...over },
});

describe('decideEligibility', () => {
  it('is eligible only when every condition holds', () => {
    expect(decideEligibility(ok)).toEqual({ eligibleForPaidJobs: true, reasons: [] });
  });

  it.each([
    ['inactive account', { ...ok, userStatus: 'SUSPENDED' as const }, 'ACCOUNT_INACTIVE'],
    ['wrong role', { ...ok, userRole: 'CUSTOMER' as const }, 'NOT_ASSISTANT_ROLE'],
    ['unverified email', { ...ok, emailVerified: false }, 'EMAIL_UNVERIFIED'],
    ['no application', { ...ok, profile: null }, 'NO_APPLICATION'],
    ['unverified phone', withProfile({ phoneVerified: false }), 'PHONE_UNVERIFIED'],
    ['no service area', withProfile({ activeAreaCount: 0 }), 'NO_SERVICE_AREA'],
    ['no offered tasks', withProfile({ effectiveOfferCount: 0 }), 'NO_OFFERED_TASKS'],
  ])('denies %s', (_label, input, code) => {
    const result = decideEligibility(input);
    expect(result.eligibleForPaidJobs).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(code);
  });

  it.each([
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'CHANGES_REQUESTED',
    'REJECTED',
    'SUSPENDED',
  ] as const)('denies an application that is %s, however complete everything else is', (status) => {
    const result = decideEligibility(withProfile({ status }));
    expect(result.eligibleForPaidJobs).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('NOT_APPROVED');
  });

  it.each(['PENDING', 'FAILED', 'INCONCLUSIVE'] as const)(
    'denies an identity outcome of %s',
    (identityOutcome) => {
      expect(
        decideEligibility(withProfile({ identityOutcome })).reasons.map((r) => r.code),
      ).toEqual(['IDENTITY_NOT_PASSED']);
    },
  );

  it('reports every failing condition, not just the first', () => {
    const result = decideEligibility({
      userStatus: 'ACTIVE',
      userRole: 'CUSTOMER',
      emailVerified: false,
      profile: {
        status: 'DRAFT',
        identityOutcome: 'PENDING',
        phoneVerified: false,
        activeAreaCount: 0,
        effectiveOfferCount: 0,
      },
    });
    expect(result.reasons.map((r) => r.code)).toEqual([
      'NOT_ASSISTANT_ROLE',
      'EMAIL_UNVERIFIED',
      'NOT_APPROVED',
      'PHONE_UNVERIFIED',
      'IDENTITY_NOT_PASSED',
      'NO_SERVICE_AREA',
      'NO_OFFERED_TASKS',
    ]);
  });
});
