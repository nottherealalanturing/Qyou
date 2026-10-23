import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" subtitle="Pick something you don’t use anywhere else.">
      <ResetPasswordForm />
    </AuthShell>
  );
}
