import { getJson, type Eligibility } from './catalog';

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED';

export const LANGUAGE_OPTIONS = [
  { code: 'en', name: 'English' },
  { code: 'ha', name: 'Hausa' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'pcm', name: 'Nigerian Pidgin' },
  { code: 'ff', name: 'Fulfulde' },
  { code: 'fr', name: 'French' },
  { code: 'ar', name: 'Arabic' },
] as const;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// ── public ────────────────────────────────────────────────────────────────────
export interface PublicAssistantCard {
  slug: string;
  displayName: string;
  summary: string;
  languages: { code: string; name: string }[];
  cities: { slug: string; name: string; state: string }[];
  categories: { slug: string; name: string; iconKey: string }[];
}

export interface PublicAssistantProfile {
  slug: string;
  displayName: string;
  bio: string;
  languages: { code: string; name: string }[];
  serviceAreas: { slug: string; name: string; state: string }[];
  offers: {
    category: { slug: string; name: string; iconKey: string };
    tasks: { slug: string; name: string; eligibility: Eligibility }[];
  }[];
  availability: {
    note: string | null;
    timezone: string;
    windows: TimeWindow[];
    disclaimer: string;
  };
  verification: { email: boolean; phone: boolean; identity: string };
  memberSince: string | null;
}

export interface TimeWindow {
  dayOfWeek: number;
  start: string;
  end: string;
}

export interface AssistantPage {
  items: PublicAssistantCard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const fetchAssistants = (query: string) =>
  getJson<AssistantPage>(`/assistants${query ? `?${query}` : ''}`);
export const fetchAssistant = (slug: string) =>
  getJson<{ assistant: PublicAssistantProfile }>(`/assistants/${encodeURIComponent(slug)}`);

// ── the signed-in user's own application ──────────────────────────────────────
export interface OnboardingStep {
  key: string;
  label: string;
  done: boolean;
  required: boolean;
  detail?: string;
}

export interface OwnDashboard {
  application: null | {
    status: ApplicationStatus;
    statusReason: string | null;
    statusChangedAt: string;
    submittedAt: string | null;
    approvedAt: string | null;
    editScope: 'full' | 'limited' | 'none';
    canSubmit: boolean;
    missing: { key: string; message: string }[];
  };
  profile: null | {
    slug: string;
    displayName: string;
    bio: string;
    languages: string[];
    availabilityNote: string | null;
    publicUrl: string | null;
  };
  private: null | { legalName: string | null; phone: string | null; phoneVerified: boolean };
  services: null | {
    cities: { id: string; slug: string; name: string; active: boolean }[];
    tasks: {
      id: string;
      slug: string;
      name: string;
      category: { slug: string; name: string };
      eligibility: Eligibility;
      stillOffered: boolean;
    }[];
  };
  availability: null | {
    note: string | null;
    timezone: string;
    windows: TimeWindow[];
    disclaimer: string;
  };
  onboarding: { canApply: boolean; steps: OnboardingStep[] };
  eligibility: { eligibleForPaidJobs: boolean; reasons: { code: string; message: string }[] };
}

/** What each application status means to the applicant, in plain words. */
export const STATUS_COPY: Record<
  ApplicationStatus,
  { title: string; body: string; tone: 'info' | 'success' | 'error' }
> = {
  DRAFT: {
    title: 'Draft',
    body: 'Finish the steps below, then submit your application for review.',
    tone: 'info',
  },
  SUBMITTED: {
    title: 'Submitted',
    body: 'Your application is in the queue for review. You can still verify your phone number while you wait.',
    tone: 'info',
  },
  UNDER_REVIEW: {
    title: 'Under review',
    body: 'A member of the Qyou team is reviewing your application and will record an identity review. Editing is paused until they decide.',
    tone: 'info',
  },
  CHANGES_REQUESTED: {
    title: 'Changes requested',
    body: 'Please make the changes described below and submit again.',
    tone: 'error',
  },
  APPROVED: {
    title: 'Approved',
    body: 'Your profile is public. Paid jobs will be available to you once bookings open.',
    tone: 'success',
  },
  REJECTED: {
    title: 'Not approved',
    body: 'We could not approve this application.',
    tone: 'error',
  },
  SUSPENDED: {
    title: 'Suspended',
    body: 'Your assistant account is suspended and your profile is hidden.',
    tone: 'error',
  },
};

// ── availability editing helpers (pure, unit-tested) ──────────────────────────
export type DayWindows = Record<number, { start: string; end: string }[]>;

export function windowsToDays(windows: TimeWindow[]): DayWindows {
  const days: DayWindows = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const w of windows) days[w.dayOfWeek]?.push({ start: w.start, end: w.end });
  return days;
}

export function daysToWindows(days: DayWindows): TimeWindow[] {
  return Object.entries(days).flatMap(([day, list]) =>
    list
      .filter((w) => w.start && w.end)
      .map((w) => ({ dayOfWeek: Number(day), start: w.start, end: w.end })),
  );
}

// ── admin ─────────────────────────────────────────────────────────────────────
export interface AdminListItem {
  id: string;
  slug: string;
  displayName: string;
  applicantName: string;
  status: ApplicationStatus;
  identityOutcome: 'PENDING' | 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
  emailVerified: boolean;
  phoneVerified: boolean;
  submittedAt: string | null;
  statusChangedAt: string;
}

export interface AdminList {
  items: AdminListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminDetail {
  id: string;
  slug: string;
  status: ApplicationStatus;
  statusReason: string | null;
  statusChangedAt: string;
  identityOutcome: AdminListItem['identityOutcome'];
  applicant: { name: string; email: string; role: string; accountStatus: string };
  profile: {
    displayName: string;
    bio: string;
    languages: string[];
    availabilityNote: string | null;
  };
  private: { legalName: string | null; phone: string | null; phoneVerified: boolean };
  services: {
    cities: { slug: string; name: string }[];
    tasks: { slug: string; name: string; category: string; eligibility: Eligibility }[];
  };
  availability: TimeWindow[];
  identityChecks: {
    id: string;
    result: string;
    method: string;
    evidenceRef: string | null;
    notes: string | null;
    checkedBy: string;
    createdAt: string;
  }[];
  requirements: {
    emailVerified: boolean;
    phoneVerified: boolean;
    identityPassed: boolean;
    profileComplete: boolean;
    missing: { key: string; message: string }[];
  };
  allowedTransitions: ApplicationStatus[];
}
