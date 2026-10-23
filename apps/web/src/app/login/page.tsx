import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { safeNextPath } from '@/lib/safe-redirect';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; reset?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if ((await getSession()).state === 'authenticated') redirect(next);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your bookings."
      footer={
        <>
          New to Qyou?{' '}
          <Link
            href="/register"
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm
        next={next}
        {...(params.reset ? { notice: 'Password updated. Log in with your new password.' } : {})}
      />
    </AuthShell>
  );
}
