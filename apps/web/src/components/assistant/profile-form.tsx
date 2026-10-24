'use client';

import { useId, useState, type FormEvent } from 'react';
import { LANGUAGE_OPTIONS, type OwnDashboard } from '@/lib/assistants';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';
import { useApiAction } from './use-api-action';

export function ProfileForm({
  profile,
  editScope,
}: {
  profile: NonNullable<OwnDashboard['profile']>;
  editScope: 'full' | 'limited' | 'none';
}) {
  const { run, pending, error, fieldErrors, notice } = useApiAction();
  const [bio, setBio] = useState(profile.bio);
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const bioId = useId();
  const locked = editScope === 'none';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('displayName') ?? '');
    await run(
      'PATCH',
      '/api/v1/assistants/me',
      { ...(editScope === 'full' ? { displayName: name } : {}), bio, languages },
      { success: 'Profile saved.' },
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <TextField
        label="Display name"
        name="displayName"
        defaultValue={profile.displayName}
        disabled={editScope !== 'full'}
        error={fieldErrors.displayName}
        hint={
          editScope === 'limited'
            ? 'Locked after approval. Contact support to change it.'
            : 'Shown publicly. Use the name customers will recognise.'
        }
      />
      <div>
        <label htmlFor={bioId} className="mb-1.5 block text-sm font-semibold">
          About you
        </label>
        <textarea
          id={bioId}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={locked}
          rows={5}
          maxLength={600}
          aria-invalid={fieldErrors.bio ? true : undefined}
          className="w-full rounded-xl border border-ink/25 bg-surface p-4 text-base disabled:opacity-60"
        />
        <p className="mt-1.5 text-sm text-ink-muted">
          {bio.trim().length}/600 characters · at least 50 · public
        </p>
        {fieldErrors.bio ? (
          <p className="mt-1 text-sm font-medium text-danger">▲ {fieldErrors.bio}</p>
        ) : null}
      </div>
      <fieldset disabled={locked}>
        <legend className="mb-2 text-sm font-semibold">Languages you speak</legend>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map((lang) => {
            const checked = languages.includes(lang.code);
            return (
              <label
                key={lang.code}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${checked ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25'}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() =>
                    setLanguages((cur) =>
                      checked ? cur.filter((c) => c !== lang.code) : [...cur, lang.code],
                    )
                  }
                />
                {checked ? <span aria-hidden="true">✓</span> : null}
                {lang.name}
              </label>
            );
          })}
        </div>
        {fieldErrors.languages ? (
          <p className="mt-1 text-sm font-medium text-danger">▲ {fieldErrors.languages}</p>
        ) : null}
      </fieldset>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Button type="submit" loading={pending} disabled={locked}>
        {pending ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
