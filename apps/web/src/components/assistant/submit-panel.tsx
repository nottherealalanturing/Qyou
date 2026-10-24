'use client';

import type { OwnDashboard } from '@/lib/assistants';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { useApiAction } from './use-api-action';

export function SubmitPanel({
  application,
  emailVerified,
}: {
  application: NonNullable<OwnDashboard['application']>;
  emailVerified: boolean;
}) {
  const { run, pending, error, fieldErrors } = useApiAction();
  const canSubmitState =
    application.status === 'DRAFT' || application.status === 'CHANGES_REQUESTED';
  if (!canSubmitState)
    return <p className="text-sm text-ink-muted">Nothing to submit right now.</p>;

  return (
    <div className="space-y-4">
      {!emailVerified ? (
        <Alert tone="error">Verify your email address before submitting.</Alert>
      ) : null}
      {application.missing.length > 0 ? (
        <div>
          <p className="text-sm font-semibold">Still to do before you can submit:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {application.missing.map((m) => (
              <li key={m.key}>{m.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Everything required is filled in. You can submit now. Phone verification can finish while
          you wait for review, but you cannot be approved without it.
        </p>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {Object.keys(fieldErrors).length > 0 ? (
        <Alert tone="error">Some required items are still missing.</Alert>
      ) : null}
      <Button
        type="button"
        loading={pending}
        disabled={!application.canSubmit}
        onClick={() => run('POST', '/api/v1/assistants/me/submit', {})}
      >
        {pending
          ? 'Submitting…'
          : application.status === 'CHANGES_REQUESTED'
            ? 'Resubmit for review'
            : 'Submit for review'}
      </Button>
    </div>
  );
}
