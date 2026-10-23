'use client';

import { useState, type FormEvent } from 'react';
import { postJson } from '@/lib/forms';
import { validateEmail } from '@/lib/validation';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';
import { useFocusOnError } from './use-form-focus';

export function ForgotPasswordForm() {
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { formRef, alertRef } = useFocusOnError(attempt);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const problem = validateEmail(email);
    if (problem) {
      setEmailError(problem);
      setAttempt((n) => n + 1);
      return;
    }
    setEmailError(undefined);
    setFormError(null);
    setSubmitting(true);
    const result = await postJson('/api/v1/auth/password-reset/request', { email });
    setSubmitting(false);
    if (result.ok) {
      setSentTo(email.trim());
      return;
    }
    setEmailError(result.fieldErrors.email);
    setFormError(result.message);
    setAttempt((n) => n + 1);
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          If an account exists for <strong className="break-all">{sentTo}</strong>, we have sent a
          link to reset the password. It expires in 30 minutes.
        </Alert>
        <p className="text-sm text-ink-muted">
          Nothing in your inbox? Check spam, or{' '}
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            try a different address
          </button>
          .
        </p>
        {process.env.NODE_ENV !== 'production' ? (
          <p className="rounded-xl bg-canvas p-3 text-sm text-ink-muted">
            <strong>Local development:</strong> emails are caught by Mailpit —{' '}
            <a
              href="http://localhost:8052"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-700 underline"
            >
              open the inbox
            </a>
            .
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoFocus
        error={emailError}
      />
      {formError ? (
        <Alert tone="error" ref={alertRef}>
          {formError}
        </Alert>
      ) : null}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
