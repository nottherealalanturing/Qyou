'use client';

import { useState, type FormEvent } from 'react';
import { postJson } from '@/lib/forms';
import {
  compact,
  validateCurrentPassword,
  validateNewPassword,
  type FieldErrors,
} from '@/lib/validation';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { PasswordField } from './password-field';
import { useFocusOnError } from './use-form-focus';

export function ChangePasswordForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { formRef, alertRef } = useFocusOnError(attempt);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');

    const clientErrors = compact({
      currentPassword: validateCurrentPassword(currentPassword),
      newPassword: validateNewPassword(newPassword),
    });
    setSuccess(false);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(null);
      setAttempt((n) => n + 1);
      return;
    }

    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const result = await postJson('/api/v1/auth/password/change', { currentPassword, newPassword });
    setSubmitting(false);
    if (result.ok) {
      form.reset();
      setSuccess(true);
      return;
    }
    setErrors(result.fieldErrors);
    // A field-level message is enough when the server pointed at a field.
    setFormError(Object.keys(result.fieldErrors).length > 0 ? null : result.message);
    setAttempt((n) => n + 1);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      <PasswordField
        label="Current password"
        name="currentPassword"
        autoComplete="current-password"
        error={errors.currentPassword}
      />
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        hint="At least 10 characters. You will stay logged in here; other devices are logged out."
        error={errors.newPassword}
      />
      {formError ? (
        <Alert tone="error" ref={alertRef}>
          {formError}
        </Alert>
      ) : null}
      {success ? (
        <Alert tone="success">Password updated. All your other devices were logged out.</Alert>
      ) : null}
      <Button type="submit" loading={submitting}>
        {submitting ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}
