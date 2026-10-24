'use client';

import type { FormEvent } from 'react';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';
import { useApiAction } from './use-api-action';

export function StartApplication({ emailVerified }: { emailVerified: boolean }) {
  const { run, pending, error, fieldErrors } = useApiAction();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run('POST', '/api/v1/assistants/me', {
      displayName: String(new FormData(event.currentTarget).get('displayName') ?? ''),
    });
  }
  return (
    <form onSubmit={onSubmit} noValidate className="max-w-md space-y-5">
      {!emailVerified ? (
        <Alert tone="info">
          Verify your email address on your account page first. It’s the first requirement.
        </Alert>
      ) : null}
      <TextField
        label="Display name"
        name="displayName"
        disabled={!emailVerified}
        error={fieldErrors.displayName}
        hint="Shown publicly on your profile."
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" loading={pending} disabled={!emailVerified}>
        {pending ? 'Starting…' : 'Start my application'}
      </Button>
    </form>
  );
}
