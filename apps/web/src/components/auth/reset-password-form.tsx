'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { postJson } from '@/lib/forms';
import { validateNewPassword } from '@/lib/validation';
import { Alert } from '../ui/alert';
import { Button, buttonClasses } from '../ui/button';
import { PasswordField } from './password-field';
import { useFocusOnError } from './use-form-focus';

type TokenState =
  { status: 'reading' } | { status: 'missing' } | { status: 'ready'; token: string };

export function ResetPasswordForm() {
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'reading' });
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { formRef, alertRef } = useFocusOnError(attempt);

  // The token arrives in the URL fragment (#token=…), which browsers never send to any server.
  // Read it once, then strip it from the address bar and history entry. The ref makes this
  // idempotent: React StrictMode runs effects twice in development, and the second run would
  // otherwise find the fragment already removed and wrongly report a missing token.
  const tokenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (tokenRef.current === undefined) {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
      tokenRef.current = token;
      if (token) window.history.replaceState(null, '', window.location.pathname);
    }
    const token = tokenRef.current;
    // Reading the URL fragment is synchronisation with an external system (the browser
    // location) and it is unavailable during SSR, so state must be set after mount.
    // oxlint-disable-next-line react/set-state-in-effect
    setTokenState(token ? { status: 'ready', token } : { status: 'missing' });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tokenState.status !== 'ready') return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    const problem = validateNewPassword(password);
    if (problem) {
      setPasswordError(problem);
      setFormError(null);
      setAttempt((n) => n + 1);
      return;
    }
    setPasswordError(undefined);
    setFormError(null);
    setSubmitting(true);
    const result = await postJson('/api/v1/auth/password-reset/confirm', {
      token: tokenState.token,
      password,
    });
    setSubmitting(false);
    if (result.ok) {
      setDone(true);
      return;
    }
    if (result.status === 400 && !result.fieldErrors.password) {
      // Token problem (used, expired or malformed): the user needs a new link.
      setLinkInvalid(true);
      return;
    }
    setPasswordError(result.fieldErrors.password);
    setFormError(result.message);
    setAttempt((n) => n + 1);
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success">
          Your password has been updated. All other devices were logged out.
        </Alert>
        <Link href="/login?reset=1" className={buttonClasses('primary', 'md', true)}>
          Log in
        </Link>
      </div>
    );
  }

  if (tokenState.status === 'reading') {
    return (
      <p role="status" className="text-ink-muted">
        Checking your reset link…
      </p>
    );
  }

  if (tokenState.status === 'missing' || linkInvalid) {
    return (
      <div className="space-y-5">
        <Alert tone="error">
          This reset link is invalid or has expired. Reset links work once.
        </Alert>
        <Link href="/forgot-password" className={buttonClasses('primary', 'md', true)}>
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        autoFocus
        hint="At least 10 characters. A few unrelated words make a strong password."
        error={passwordError}
      />
      {formError ? (
        <Alert tone="error" ref={alertRef}>
          {formError}
        </Alert>
      ) : null}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
