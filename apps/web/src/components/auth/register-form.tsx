'use client';

import { useRouter } from 'next/navigation';
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

export function RegisterForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
      router.replace('/account');
      router.refresh();
      return;
    }
    setSubmitting(false);
    setErrors(
      result.status === 409
        ? { email: 'An account with this email already exists' }
        : result.fieldErrors,
    );
    setFormError(
      result.status === 409
        ? 'This email is already registered. Try logging in instead.'
        : result.message,
    );
    setAttempt((n) => n + 1);
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
