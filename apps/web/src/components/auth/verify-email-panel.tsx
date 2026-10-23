'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { postJson } from '@/lib/forms';
import { Alert } from '../ui/alert';
import { Button, Spinner, buttonClasses } from '../ui/button';
import { useFragmentToken } from './use-fragment-token';

type Phase =
  | { name: 'verifying' }
  | { name: 'done'; already: boolean }
  | { name: 'invalid' }
  | { name: 'error'; message: string };

/**
 * Landing page for the emailed verification link. The token is read from the URL fragment and
 * submitted automatically (a POST, so mail scanners that merely fetch the URL — and never run
 * scripts or see the fragment — cannot consume it).
 */
export function VerifyEmailPanel() {
  const fragment = useFragmentToken();
  const [phase, setPhase] = useState<Phase>({ name: 'verifying' });
  // Submit at most once per mount, even under StrictMode's double effect.
  const submitted = useRef(false);

  const confirm = useCallback(async (token: string) => {
    setPhase({ name: 'verifying' });
    const result = await postJson<{ status: 'verified' | 'already_verified' }>(
      '/api/v1/auth/email-verification/confirm',
      { token },
    );
    if (result.ok) {
      setPhase({ name: 'done', already: result.data.status === 'already_verified' });
    } else if (result.status === 400) {
      setPhase({ name: 'invalid' });
    } else {
      setPhase({ name: 'error', message: result.message });
    }
  }, []);

  useEffect(() => {
    if (fragment.status === 'ready' && !submitted.current) {
      submitted.current = true;
      // Submitting the token is the point of this page: a one-shot side effect on mount.
      // oxlint-disable-next-line react/set-state-in-effect
      void confirm(fragment.token);
    }
  }, [fragment, confirm]);

  if (fragment.status === 'missing') {
    return <InvalidLink />;
  }
  if (fragment.status === 'reading' || phase.name === 'verifying') {
    return (
      <p role="status" className="flex items-center gap-2 text-ink-muted">
        <Spinner /> Verifying your email address…
      </p>
    );
  }
  if (phase.name === 'done') {
    return (
      <div className="space-y-5">
        <Alert tone="success">
          {phase.already
            ? 'This email address is already verified.'
            : 'Your email address is verified. Thank you!'}
        </Alert>
        <Link href="/account" className={buttonClasses('primary', 'md', true)}>
          Go to your account
        </Link>
      </div>
    );
  }
  if (phase.name === 'invalid') return <InvalidLink />;

  return (
    <div className="space-y-5">
      <Alert tone="error">{phase.message}</Alert>
      {fragment.status === 'ready' ? (
        <Button type="button" fullWidth onClick={() => void confirm(fragment.token)}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function InvalidLink() {
  return (
    <div className="space-y-5">
      <Alert tone="error">
        This verification link is invalid or has expired. Verification links work once.
      </Alert>
      <p className="text-sm text-ink-muted">
        Log in and request a new link from your account page.
      </p>
      <Link href="/account" className={buttonClasses('primary', 'md', true)}>
        Go to your account
      </Link>
    </div>
  );
}
