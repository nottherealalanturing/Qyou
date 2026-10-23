'use client';

import { useState } from 'react';
import { postJson } from '@/lib/forms';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';

export function ResendVerification({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  async function resend() {
    setPending(true);
    setResult(null);
    const response = await postJson<{ status: 'sent' | 'already_verified' }>(
      '/api/v1/auth/email-verification/request',
      {},
    );
    setPending(false);
    if (response.ok) {
      setResult(
        response.data.status === 'already_verified'
          ? {
              tone: 'success',
              message: 'Your email address is already verified. Refresh the page.',
            }
          : { tone: 'success', message: `We sent a new verification link to ${email}.` },
      );
    } else {
      setResult({ tone: 'error', message: response.message });
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="secondary" size="sm" loading={pending} onClick={resend}>
        {pending ? 'Sending…' : 'Send verification email'}
      </Button>
      {result ? <Alert tone={result.tone}>{result.message}</Alert> : null}
    </div>
  );
}
