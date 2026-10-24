import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AvailabilityForm } from '@/components/assistant/availability-form';
import { Checklist } from '@/components/assistant/checklist';
import { PrivateDetailsForm } from '@/components/assistant/private-details-form';
import { ProfileForm } from '@/components/assistant/profile-form';
import { Section } from '@/components/assistant/section';
import { ServicesForm, type CatalogForForm } from '@/components/assistant/services-form';
import { StartApplication } from '@/components/assistant/start-application';
import { StatusBanner } from '@/components/assistant/status-banner';
import { SubmitPanel } from '@/components/assistant/submit-panel';
import { UnavailableState } from '@/components/catalog/states';
import { Alert } from '@/components/ui/alert';
import { buttonClasses } from '@/components/ui/button';
import type { OwnDashboard } from '@/lib/assistants';
import { fetchCategories, fetchCategory, fetchCities } from '@/lib/catalog';
import { apiAuthed } from '@/lib/server-api';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Become an assistant' };

async function loadCatalog(): Promise<CatalogForForm | null> {
  const [cities, categories] = await Promise.all([fetchCities(), fetchCategories()]);
  if (cities.status !== 'ok' || categories.status !== 'ok') return null;
  const detailed = await Promise.all(categories.data.items.map((c) => fetchCategory(c.slug)));
  return {
    cities: cities.data.items,
    categories: detailed.flatMap((d) =>
      d.status === 'ok' ? [{ category: d.data.category, tasks: d.data.tasks }] : [],
    ),
  };
}

export default async function AssistantDashboardPage() {
  const session = await getSession();
  if (session.state === 'anonymous') redirect('/login?next=/assistant');
  if (session.state === 'unavailable')
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );
  const user = session.user;

  const result = await apiAuthed<OwnDashboard>('/assistants/me');
  if (result.status === 'unauthenticated') redirect('/login?next=/assistant');
  if (result.status !== 'ok')
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your application" />
      </main>
    );
  const dash = result.data;

  if (!dash.onboarding.canApply) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Alert tone="info">
          This type of account can’t apply to be an assistant. Each Qyou account has a single role.
        </Alert>
      </main>
    );
  }

  if (!dash.application || !dash.profile) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Become a Qyou assistant</h1>
        <p className="mt-2 text-ink-muted">
          Help people get their time back by holding their place in line or running eligible
          errands.
        </p>
        <div className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card">
          <h2 className="font-semibold">What we require</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li>A verified email address and a verified Nigerian mobile number.</li>
            <li>
              A manual identity review by the Qyou team. We record the outcome only; we never store
              your ID documents.
            </li>
            <li>
              Approval by an administrator. A complete profile on its own never grants access.
            </li>
            <li>
              Only tasks that can legitimately be delegated. Anything that needs you in person, or
              someone else’s credentials, isn’t allowed.
            </li>
          </ul>
          <div className="mt-6">
            <StartApplication emailVerified={user.emailVerified} />
          </div>
        </div>
      </main>
    );
  }

  const { application, profile } = dash;
  const catalog = await loadCatalog();
  const scope = application.editScope;
  const locked = scope === 'none';
  const canVerifyPhone = application.status !== 'REJECTED' && application.status !== 'SUSPENDED';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Assistant application</h1>
      <div className="mt-5">
        <StatusBanner status={application.status} reason={application.statusReason} />
      </div>
      {profile.publicUrl ? (
        <p className="mt-4">
          <Link href={profile.publicUrl} className={buttonClasses('secondary', 'sm')}>
            View my public profile
          </Link>
        </p>
      ) : null}

      <div className="mt-8 space-y-6">
        <Section id="progress" title="Your progress">
          <Checklist steps={dash.onboarding.steps} />
        </Section>

        <Section
          id="eligibility"
          title="Paid jobs"
          description="Paid jobs aren’t open yet. When they are, you can accept them only if every condition below is met."
        >
          {dash.eligibility.eligibleForPaidJobs ? (
            <p className="flex items-center gap-2 font-medium text-success">
              <span aria-hidden="true">✓</span> You meet every requirement to accept paid jobs.
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {dash.eligibility.reasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          )}
        </Section>

        {locked ? (
          <Alert tone="info">Editing is paused while your application is in this status.</Alert>
        ) : null}
        {scope === 'limited' ? (
          <Alert tone="info">
            Your name is locked after approval. You can still update your bio, languages, services
            and availability.
          </Alert>
        ) : null}

        <Section id="profile" title="Public profile" description="This is what customers see.">
          <ProfileForm
            key={profile.bio + profile.displayName + profile.languages.join()}
            profile={profile}
            editScope={scope}
          />
        </Section>

        <Section
          id="services"
          title="Cities and tasks"
          description="Choose where you work and what you offer."
        >
          {catalog && dash.services ? (
            <ServicesForm
              key={
                dash.services.tasks.map((t) => t.id).join() +
                dash.services.cities.map((c) => c.id).join()
              }
              catalog={catalog}
              current={dash.services}
              locked={locked}
            />
          ) : (
            <UnavailableState what="the list of cities and tasks" />
          )}
        </Section>

        <Section id="availability" title="Availability">
          {dash.availability ? (
            <AvailabilityForm
              key={JSON.stringify(dash.availability.windows) + (dash.availability.note ?? '')}
              current={dash.availability}
              locked={locked}
            />
          ) : null}
        </Section>

        <Section id="private" title="Private details and phone verification">
          {dash.private ? (
            <PrivateDetailsForm
              key={`${dash.private.legalName}${dash.private.phone}${dash.private.phoneVerified}`}
              details={dash.private}
              editScope={scope}
              canVerifyPhone={canVerifyPhone}
            />
          ) : null}
        </Section>

        <Section id="submit" title="Submit for review">
          <SubmitPanel application={application} emailVerified={user.emailVerified} />
        </Section>
      </div>
    </main>
  );
}
