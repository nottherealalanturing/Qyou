'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { postJson } from '@/lib/forms';
import {
  compact,
  validateCurrentPassword,
  validateEmail,
  type FieldErrors,
} from '@/lib/validation';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';
import { PasswordField } from './password-field';
import { useFocusOnError } from './use-form-focus';

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { formRef, alertRef } = useFocusOnError(attempt);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    const clientErrors = compact({
      email: validateEmail(email),
      password: validateCurrentPassword(password),
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
    const result = await postJson('/api/v1/auth/login', { email, password });
    if (result.ok) {
      router.replace(next);
      router.refresh();
      return; // keep the loading state while navigating
    }
    setSubmitting(false);
    setErrors(result.fieldErrors);
    setFormError(result.message);
    setAttempt((n) => n + 1);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoFocus
        error={errors.email}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        error={errors.password}
      />
      {formError ? (
        <Alert tone="error" ref={alertRef}>
          {formError}
        </Alert>
      ) : null}
      <Button type="submit" fullWidth loading={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </Button>
      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="font-semibold text-brand-700 underline underline-offset-2"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
