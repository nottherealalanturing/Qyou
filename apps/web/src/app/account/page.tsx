import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { LogoutButton } from '@/components/auth/logout-button';
import { LogoutEverywhere } from '@/components/auth/logout-everywhere';
import { ResendVerification } from '@/components/auth/resend-verification';
import { Alert } from '@/components/ui/alert';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Your account' };

const ROLE_LABELS = {
  CUSTOMER: 'Customer',
  ASSISTANT: 'Assistant',
  BUSINESS_STAFF: 'Business staff',
  ADMIN: 'Administrator',
} as const;

const card = 'rounded-card border border-line bg-surface p-6 shadow-card';

export default async function AccountPage() {
  const session = await getSession();

  if (session.state === 'anonymous') redirect('/login?next=/account');
  if (session.state === 'unavailable') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <Alert tone="error">
          We can’t reach Qyou right now, so we can’t check your session. Please try again in a
          moment.
        </Alert>
      </main>
    );
  }

  const { user } = session;
  const memberSince = new Date(user.createdAt).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Hi, {user.name.split(' ')[0]}</h1>
      <p className="mt-2 text-ink-muted">You’re logged in on this device.</p>

      <section aria-labelledby="profile-heading" className={`mt-8 ${card}`}>
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-700"
          >
            {user.name.trim().charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 id="profile-heading" className="text-lg font-semibold">
              {user.name}
            </h2>
            <p className="text-ink-muted">{user.email}</p>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-muted">Account type</dt>
            <dd className="font-medium">{ROLE_LABELS[user.role]}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Member since</dt>
            <dd className="font-medium">{memberSince}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="verification-heading" className={`mt-6 ${card}`}>
        <h2 id="verification-heading" className="text-lg font-semibold">
          Email verification
        </h2>
        {user.emailVerified ? (
          <p className="mt-1 flex items-center gap-2 font-medium text-success">
            <span aria-hidden="true">✓</span> {user.email} is verified
          </p>
        ) : (
          <div className="mt-2 space-y-4">
            <Alert tone="info">
              Verify your email address to post requests and receive quotes. We sent a link to{' '}
              <strong className="break-all">{user.email}</strong>.
            </Alert>
            <ResendVerification email={user.email} />
          </div>
        )}
      </section>

      <section aria-labelledby="requests-heading" className={`mt-6 ${card}`}>
        <h2 id="requests-heading" className="text-lg font-semibold">
          Requests
        </h2>
        <p className="mt-1 text-ink-muted">
          Post what you need done and approved assistants send you quotes. Nothing is charged yet.
        </p>
        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="/requests"
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            My requests
          </Link>
          <Link
            href="/requests/new"
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            Post a request
          </Link>
          {user.role === 'ASSISTANT' ? (
            <Link
              href="/assistant/requests"
              className="font-semibold text-brand-700 underline underline-offset-2"
            >
              Open requests I can quote on
            </Link>
          ) : null}
        </p>
      </section>

      <section aria-labelledby="assistant-heading" className={`mt-6 ${card}`}>
        <h2 id="assistant-heading" className="text-lg font-semibold">
          Work as an assistant
        </h2>
        <p className="mt-1 text-ink-muted">
          Hold places in line for others. Applications are reviewed by the Qyou team.
        </p>
        <p className="mt-4">
          <Link
            href="/assistant"
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            {user.role === 'ASSISTANT'
              ? 'Open my assistant dashboard'
              : 'Start or continue my application'}
          </Link>
          {user.role === 'ADMIN' ? (
            <span className="ml-4">
              <Link
                href="/admin/assistants"
                className="font-semibold text-brand-700 underline underline-offset-2"
              >
                Review applications
              </Link>
            </span>
          ) : null}
        </p>
      </section>

      <section aria-labelledby="password-heading" className={`mt-6 ${card}`}>
        <h2 id="password-heading" className="text-lg font-semibold">
          Change password
        </h2>
        <div className="mt-4 max-w-md">
          <ChangePasswordForm />
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          Forgot your current password?{' '}
          <Link
            href="/forgot-password"
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            Reset it by email
          </Link>
        </p>
      </section>

      <section aria-labelledby="sessions-heading" className={`mt-6 ${card}`}>
        <h2 id="sessions-heading" className="text-lg font-semibold">
          Sessions
        </h2>
        <p className="mt-1 text-ink-muted">
          Log out here, or sign out of every device if you suspect someone else has access.
        </p>
        <div className="mt-5 flex flex-wrap items-start gap-3">
          <LogoutButton />
          <LogoutEverywhere />
        </div>
      </section>
    </main>
  );
}
