import type {
  ApplicationStatus,
  IdentityOutcome,
  UserRole,
  UserStatus,
} from '../generated/prisma/client.js';

export interface EligibilityInput {
  userStatus: UserStatus;
  userRole: UserRole;
  emailVerified: boolean;
  /** `null` when the user has no assistant profile. */
  profile: null | {
    status: ApplicationStatus;
    identityOutcome: IdentityOutcome;
    phoneVerified: boolean;
    activeAreaCount: number;
    effectiveOfferCount: number;
  };
}

export interface EligibilityReason {
  code:
    | 'ACCOUNT_INACTIVE'
    | 'NOT_ASSISTANT_ROLE'
    | 'EMAIL_UNVERIFIED'
    | 'NO_APPLICATION'
    | 'NOT_APPROVED'
    | 'PHONE_UNVERIFIED'
    | 'IDENTITY_NOT_PASSED'
    | 'NO_SERVICE_AREA'
    | 'NO_OFFERED_TASKS';
  message: string;
}

export interface Eligibility {
  eligibleForPaidJobs: boolean;
  reasons: EligibilityReason[];
}

/**
 * THE definition of "may accept paid jobs". Every condition must hold; each failure is reported so
 * the assistant (and tests) can see exactly why. Pure: callers load the facts.
 *
 * Note it deliberately does NOT look at profile completeness: completeness gates submission and
 * approval, but a complete profile on its own grants nothing.
 */
export function decideEligibility(input: EligibilityInput): Eligibility {
  const reasons: EligibilityReason[] = [];
  const fail = (code: EligibilityReason['code'], message: string) =>
    reasons.push({ code, message });

  if (input.userStatus !== 'ACTIVE') fail('ACCOUNT_INACTIVE', 'Your account is not active');
  if (input.userRole !== 'ASSISTANT')
    fail('NOT_ASSISTANT_ROLE', 'Your account is not an assistant account');
  if (!input.emailVerified) fail('EMAIL_UNVERIFIED', 'Verify your email address');

  const profile = input.profile;
  if (!profile) {
    fail('NO_APPLICATION', 'You have not applied to become an assistant');
  } else {
    if (profile.status !== 'APPROVED')
      fail(
        'NOT_APPROVED',
        `Your application is ${profile.status.toLowerCase().replace('_', ' ')}, not approved`,
      );
    if (!profile.phoneVerified) fail('PHONE_UNVERIFIED', 'Verify your mobile number');
    if (profile.identityOutcome !== 'PASSED')
      fail('IDENTITY_NOT_PASSED', 'Your identity review has not passed');
    if (profile.activeAreaCount === 0)
      fail('NO_SERVICE_AREA', 'Choose at least one active city you serve');
    if (profile.effectiveOfferCount === 0)
      fail('NO_OFFERED_TASKS', 'Choose at least one task you can offer');
  }
  return { eligibleForPaidJobs: reasons.length === 0, reasons };
}
