import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { IdentityCheckForm, TransitionForm } from '@/components/assistant/admin-actions';
import { Section } from '@/components/assistant/section';
import { UnavailableState } from '@/components/catalog/states';
import { EligibilityBadge } from '@/components/catalog/eligibility-badge';
import { Alert } from '@/components/ui/alert';
import { DAY_NAMES, STATUS_COPY, type AdminDetail } from '@/lib/assistants';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Review application · Admin', robots: { index: false } };

const yes = (ok: boolean) =>
  ok ? <span className="text-success">✓ Yes</span> : <span className="text-danger">✕ No</span>;

export default async function AdminAssistantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await apiAuthed<AdminDetail>(`/admin/assistants/${encodeURIComponent(id)}`);
  if (result.status === 'unauthenticated') redirect(`/login?next=/admin/assistants/${id}`);
  if (result.status === 'forbidden' || result.status === 'not_found') notFound();
  if (result.status !== 'ok')
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="this application" />
      </main>
    );
  const d = result.data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/admin/assistants" className="underline underline-offset-2">
          Applications
        </Link>{' '}
        / {d.profile.displayName}
      </nav>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">{d.profile.displayName}</h1>
      <p className="mt-1 text-ink-muted">
        Status: <strong className="text-ink">{STATUS_COPY[d.status].title}</strong>
        {d.statusReason ? ` — “${d.statusReason}”` : ''}
      </p>
      <div className="mt-4">
        <Alert tone="info">
          You are viewing private details (legal name, phone, email). This view has been recorded in
          the audit log.
        </Alert>
      </div>

      <div className="mt-6 space-y-6">
        <Section id="requirements" title="Approval requirements">
          <ul className="space-y-1 text-sm">
            <li>Email verified: {yes(d.requirements.emailVerified)}</li>
            <li>Phone verified: {yes(d.requirements.phoneVerified)}</li>
            <li>Identity review passed: {yes(d.requirements.identityPassed)}</li>
            <li>Profile complete: {yes(d.requirements.profileComplete)}</li>
          </ul>
          {d.requirements.missing.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-ink-muted">
              {d.requirements.missing.map((m) => (
                <li key={m.key}>{m.message}</li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section id="applicant" title="Applicant (private)">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Account name</dt>
              <dd className="font-medium">{d.applicant.name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Email</dt>
              <dd className="font-medium break-all">{d.applicant.email}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Legal name</dt>
              <dd className="font-medium">{d.private.legalName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Mobile</dt>
              <dd className="font-medium">
                {d.private.phone ?? '—'}{' '}
                {d.private.phone ? (d.private.phoneVerified ? '(verified)' : '(not verified)') : ''}
              </dd>
            </div>
          </dl>
        </Section>

        <Section id="profile" title="Public profile">
          <p className="whitespace-pre-line text-sm">
            {d.profile.bio || <em className="text-ink-muted">No bio yet</em>}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Languages: {d.profile.languages.join(', ') || '—'} · Cities:{' '}
            {d.services.cities.map((c) => c.name).join(', ') || '—'}
          </p>
          <ul className="mt-3 space-y-2">
            {d.services.tasks.map((t) => (
              <li
                key={t.slug}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {t.category}: <strong>{t.name}</strong>
                </span>
                <EligibilityBadge eligibility={t.eligibility} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-muted">
            Declared times:{' '}
            {d.availability.length === 0
              ? '—'
              : d.availability
                  .map((w) => `${DAY_NAMES[w.dayOfWeek]?.slice(0, 3)} ${w.start}–${w.end}`)
                  .join(', ')}
          </p>
        </Section>

        <Section id="identity" title="Identity review (manual — outcomes only)">
          {d.identityChecks.length === 0 ? (
            <p className="text-sm text-ink-muted">No outcome recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.identityChecks.map((c) => (
                <li key={c.id} className="rounded-xl border border-line p-3">
                  <strong>{c.result.charAt(0) + c.result.slice(1).toLowerCase()}</strong> ·{' '}
                  {c.method.replace('_', ' ').toLowerCase()} · by {c.checkedBy} ·{' '}
                  {new Date(c.createdAt).toLocaleDateString('en-NG')}
                  {c.evidenceRef ? (
                    <span className="block text-ink-muted">Reference: {c.evidenceRef}</span>
                  ) : null}
                  {c.notes ? <span className="block text-ink-muted">{c.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {d.status === 'UNDER_REVIEW' ? (
            <div className="mt-5 border-t border-line pt-5">
              <IdentityCheckForm id={d.id} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">
              Outcomes can be recorded while the application is under review.
            </p>
          )}
        </Section>

        <Section id="decision" title="Decision">
          <TransitionForm
            key={d.status}
            id={d.id}
            status={d.status}
            allowed={d.allowedTransitions}
            requirementsKey={d.requirements.missing.map((m) => m.key).join(',')}
          />
        </Section>
      </div>
    </main>
  );
}
