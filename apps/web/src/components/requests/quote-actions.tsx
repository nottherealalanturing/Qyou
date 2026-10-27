'use client';

import { useState } from 'react';
import { formatNaira, type OwnerQuote, type RequestStatus } from '@/lib/requests';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { useApiAction } from '../assistant/use-api-action';

/** Accept one quote. Confirms first because it closes the others; the API re-checks everything. */
export function SelectQuoteButton({ requestId, quote }: { requestId: string; quote: OwnerQuote }) {
  const { run, pending, error } = useApiAction();
  const [confirming, setConfirming] = useState(false);

  if (!confirming)
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        Accept this quote
        <span className="sr-only"> from {quote.assistant.displayName}</span>
      </Button>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Accept {formatNaira(quote.amountKobo)} from <strong>{quote.assistant.displayName}</strong>?
        The other quotes will be closed. Nothing is charged: payment isn’t available yet.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={async () => {
            const res = await run(
              'POST',
              `/api/v1/service-requests/${requestId}/quotes/${quote.id}/select`,
              {},
            );
            if (!res.ok) setConfirming(false);
          }}
        >
          {pending ? 'Accepting…' : 'Yes, accept'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}

/** Cancel the request. A reason is required once a quote has been accepted (the API enforces it). */
export function CancelRequestForm({
  requestId,
  status,
}: {
  requestId: string;
  status: RequestStatus;
}) {
  const { run, pending, error, fieldErrors } = useApiAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const needsReason = status === 'QUOTE_ACCEPTED';

  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Cancel this request
      </Button>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        await run(
          'POST',
          `/api/v1/service-requests/${requestId}/cancel`,
          reason.trim() ? { reason } : {},
        );
      }}
    >
      <label htmlFor="cancel-reason" className="block text-sm font-semibold">
        Reason {needsReason ? '(required: an assistant was chosen)' : '(optional)'}
      </label>
      <textarea
        id="cancel-reason"
        value={reason}
        maxLength={300}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
        aria-invalid={fieldErrors.reason ? true : undefined}
        className="w-full rounded-xl border border-ink/25 bg-surface p-3 text-sm"
      />
      {fieldErrors.reason ? (
        <p className="text-sm font-medium text-danger">▲ {fieldErrors.reason}</p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p className="text-sm text-ink-muted">Cancelling closes every quote and can’t be undone.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {pending ? 'Cancelling…' : 'Cancel request'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}
