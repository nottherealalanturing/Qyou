'use client';

import { useState, type FormEvent } from 'react';
import { formatNaira, nairaToKobo, validateQuoteAmount } from '@/lib/requests';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { useApiAction } from '../assistant/use-api-action';

/**
 * An assistant's quote. The amount is typed in naira and converted to whole kobo with integer
 * arithmetic (no floats). The price is the assistant's proposal for this job only: Qyou charges
 * nothing, and fees and payment terms are not defined yet.
 */
export function QuoteForm({ requestId }: { requestId: string }) {
  const { run, pending, error, fieldErrors, notice } = useApiAction();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateQuoteAmount(amount);
    setAmountError(problem);
    const kobo = nairaToKobo(amount);
    if (problem || kobo === null) return;
    const res = await run(
      'POST',
      `/api/v1/assistants/me/requests/${requestId}/quotes`,
      { amountKobo: kobo, currency: 'NGN', ...(message.trim() ? { message } : {}) },
      { success: 'Quote sent.' },
    );
    if (res.ok) {
      setAmount('');
      setMessage('');
    }
  }

  const shown = amountError ?? fieldErrors.amountKobo;
  const kobo = nairaToKobo(amount);
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="amount" className="mb-1.5 block text-sm font-semibold">
          Your price (₦)
        </label>
        <input
          id="amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={shown ? true : undefined}
          aria-describedby="amount-hint"
          className={`h-12 w-full rounded-xl border bg-surface px-4 text-base ${shown ? 'border-danger' : 'border-ink/25'}`}
        />
        <p id="amount-hint" className="mt-1.5 text-sm text-ink-muted">
          {kobo !== null && !validateQuoteAmount(amount)
            ? `You will be quoting ${formatNaira(kobo)}.`
            : 'The total you propose for this job, in naira. Qyou fees are not defined yet.'}
        </p>
        {shown ? <p className="mt-1.5 text-sm font-medium text-danger">▲ {shown}</p> : null}
      </div>
      <div>
        <label htmlFor="quote-message" className="mb-1.5 block text-sm font-semibold">
          Message <span className="font-normal">(optional)</span>
        </label>
        <textarea
          id="quote-message"
          value={message}
          maxLength={1000}
          rows={4}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={fieldErrors.message ? true : undefined}
          className={`w-full rounded-xl border bg-surface p-3 text-base ${fieldErrors.message ? 'border-danger' : 'border-ink/25'}`}
        />
        <p className="mt-1.5 text-sm text-ink-muted">
          Say when you can be there and anything the customer should know. No phone numbers, email
          addresses or links.
        </p>
        {fieldErrors.message ? (
          <p className="mt-1.5 text-sm font-medium text-danger">▲ {fieldErrors.message}</p>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Button type="submit" loading={pending}>
        {pending ? 'Sending…' : 'Send quote'}
      </Button>
    </form>
  );
}

export function WithdrawQuoteButton({ quoteId }: { quoteId: string }) {
  const { run, pending, error } = useApiAction();
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() => run('POST', `/api/v1/assistants/me/quotes/${quoteId}/withdraw`, {})}
      >
        {pending ? 'Withdrawing…' : 'Withdraw quote'}
      </Button>
      {error ? (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </div>
  );
}
