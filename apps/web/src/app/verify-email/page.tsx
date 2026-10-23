import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

export const metadata: Metadata = { title: 'Verify your email', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Verify your email" subtitle="Confirming that this address is yours.">
      <VerifyEmailPanel />
    </AuthShell>
  );
}
