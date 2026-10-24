import type { ApplicationStatus } from '../generated/prisma/client.js';

export type Actor = 'assistant' | 'admin';

/**
 * The ONLY legal application transitions and who may perform them. Anything not listed is a 409.
 * Mirrors docs/ARCHITECTURE.md "Application state machine".
 */
export const TRANSITIONS: Record<ApplicationStatus, Partial<Record<ApplicationStatus, Actor>>> = {
  DRAFT: { SUBMITTED: 'assistant' },
  CHANGES_REQUESTED: { SUBMITTED: 'assistant' },
  SUBMITTED: { UNDER_REVIEW: 'admin' },
  UNDER_REVIEW: { CHANGES_REQUESTED: 'admin', APPROVED: 'admin', REJECTED: 'admin' },
  REJECTED: { UNDER_REVIEW: 'admin' },
  APPROVED: { SUSPENDED: 'admin' },
  SUSPENDED: { APPROVED: 'admin', REJECTED: 'admin' },
};

export function allowedTransition(from: ApplicationStatus, to: ApplicationStatus): Actor | null {
  return TRANSITIONS[from][to] ?? null;
}

export function nextStatuses(from: ApplicationStatus, actor: Actor): ApplicationStatus[] {
  return (Object.entries(TRANSITIONS[from]) as [ApplicationStatus, Actor][])
    .filter(([, who]) => who === actor)
    .map(([to]) => to);
}

/** Starting a review needs no explanation; every other administrative decision does. */
export function reasonRequired(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return !(from === 'SUBMITTED' && to === 'UNDER_REVIEW');
}

export type EditScope = 'full' | 'limited' | 'none';

/**
 * What the assistant may edit in each state. Locked states prevent edits racing with a review.
 * `limited` (approved assistants): bio, languages, availability, areas and offers — display name and
 * legal name stay locked.
 */
export function editScope(status: ApplicationStatus): EditScope {
  if (status === 'DRAFT' || status === 'CHANGES_REQUESTED') return 'full';
  if (status === 'APPROVED') return 'limited';
  return 'none';
}

/** Phone verification is allowed except for terminal/suspended states. */
export function canVerifyPhone(status: ApplicationStatus): boolean {
  return status !== 'REJECTED' && status !== 'SUSPENDED';
}

/** The ASSISTANT role exists if and only if the application is approved. */
export function roleForStatus(status: ApplicationStatus): 'ASSISTANT' | 'CUSTOMER' {
  return status === 'APPROVED' ? 'ASSISTANT' : 'CUSTOMER';
}

export interface ProfileSnapshot {
  displayName: string;
  bio: string;
  languages: string[];
  areaCount: number;
  offerCount: number;
  windowCount: number;
  legalName: string | null;
  phone: string | null;
}

export const MIN_BIO_LENGTH = 50;

export interface MissingItem {
  key: string;
  message: string;
}

/** What is still missing before an application can be submitted (and approved). */
export function missingForSubmission(p: ProfileSnapshot): MissingItem[] {
  const missing: MissingItem[] = [];
  if (p.displayName.trim().length < 2)
    missing.push({ key: 'displayName', message: 'Add a display name' });
  if (p.bio.trim().length < MIN_BIO_LENGTH)
    missing.push({ key: 'bio', message: `Write a bio of at least ${MIN_BIO_LENGTH} characters` });
  if (p.languages.length === 0)
    missing.push({ key: 'languages', message: 'Choose at least one language' });
  if (p.areaCount === 0)
    missing.push({ key: 'serviceAreas', message: 'Choose at least one city you serve' });
  if (p.offerCount === 0)
    missing.push({ key: 'tasks', message: 'Choose at least one task you can do' });
  if (p.windowCount === 0)
    missing.push({ key: 'availability', message: 'Add at least one availability window' });
  if (!p.legalName || p.legalName.trim().length < 2)
    missing.push({ key: 'legalName', message: 'Enter your legal name (kept private)' });
  if (!p.phone) missing.push({ key: 'phone', message: 'Enter your mobile number (kept private)' });
  return missing;
}
