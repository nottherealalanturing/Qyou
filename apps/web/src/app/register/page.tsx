import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Create your account' };

export default async function RegisterPage() {
  if ((await getSession()).state === 'authenticated') redirect('/account');

  return (
    <AuthShell
      title="Create your account"
      subtitle="Book trusted people to wait in line for you."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-brand-700 underline underline-offset-2">
            Log in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
