'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { postJson } from '@/lib/forms';
import {
  compact,
  validateEmail,
  validateName,
  validateNewPassword,
  type FieldErrors,
} from '@/lib/validation';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';
import { PasswordField } from './password-field';
import { useFocusOnError } from './use-form-focus';

/** Used only if the response body is missing the message; normally the API's own words are shown. */
const REGISTRATION_SENT_FALLBACK =
  'Thanks. Check your inbox for an email from Qyou with what to do next. It can take a few minutes. Then log in to continue.';

export function RegisterForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { formRef, alertRef } = useFocusOnError(attempt);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '');
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    const clientErrors = compact({
      name: validateName(name),
      email: validateEmail(email),
      password: validateNewPassword(password),
    });
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(null);
      setAttempt((n) => n + 1);
      return;
    }

    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const result = await postJson('/api/v1/auth/register', { name, email, password });
    if (result.ok) {
      // The same panel and the same words for every address: the server answers identically
      // whether or not the address was already registered (D-056), so the page must too.
      const body = result.data as { message?: unknown } | undefined;
      setSentMessage(typeof body?.message === 'string' ? body.message : REGISTRATION_SENT_FALLBACK);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setErrors(result.fieldErrors);
    setFormError(result.message);
    setAttempt((n) => n + 1);
  }

  if (sentMessage) {
    return (
      <div role="status" className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Check your email</h2>
        <p className="text-ink-muted">{sentMessage}</p>
        <Link
          href="/login"
          className="inline-block font-semibold text-brand-700 underline underline-offset-2"
        >
          Go to log in
        </Link>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      <TextField label="Full name" name="name" autoComplete="name" autoFocus error={errors.name} />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        hint="At least 10 characters. A few unrelated words make a strong password."
        error={errors.password}
      />
      {formError ? (
        <Alert tone="error" ref={alertRef}>
          {formError}
        </Alert>
      ) : null}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
