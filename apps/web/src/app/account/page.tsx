import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/auth/logout-button';
import { Alert } from '@/components/ui/alert';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Your account' };

const ROLE_LABELS = {
  CUSTOMER: 'Customer',
  ASSISTANT: 'Assistant',
  BUSINESS_STAFF: 'Business staff',
  ADMIN: 'Administrator',
} as const;

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

      <section
        aria-labelledby="profile-heading"
        className="mt-8 rounded-card border border-line bg-surface p-6 shadow-card"
      >
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

      <section
        aria-labelledby="security-heading"
        className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card"
      >
        <h2 id="security-heading" className="text-lg font-semibold">
          Security
        </h2>
        <p className="mt-1 text-ink-muted">
          Changing your password by email logs you out everywhere.{' '}
          <Link
            href="/forgot-password"
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            Reset password
          </Link>
        </p>
        <div className="mt-5 flex items-center gap-3">
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
