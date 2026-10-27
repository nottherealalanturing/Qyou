import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { UnavailableState } from '@/components/catalog/states';
import { QuoteForm, WithdrawQuoteButton } from '@/components/requests/quote-form';
import { RequestFacts, StatusPill } from '@/components/requests/request-summary';
import { Alert } from '@/components/ui/alert';
import { requireUser } from '@/lib/guard';
import {
  formatNaira,
  ASSISTANT_QUOTE_STATUS_LABEL,
  type AssistantRequestDetail,
} from '@/lib/requests';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Request' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssistantRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auth = await requireUser(`/assistant/requests/${id}`);
  if ('unavailable' in auth)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );
  const result = await apiAuthed<AssistantRequestDetail>(`/assistants/me/requests/${id}`);
  if (result.status === 'unauthenticated') redirect(`/login?next=/assistant/requests/${id}`);
  if (result.status === 'not_found' || result.status === 'forbidden') notFound();
  if (result.status !== 'ok')
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="this request" />
      </main>
    );

  const { request, myQuotes } = result.data;
  const active = myQuotes.find((q) => q.status === 'PENDING' || q.status === 'ACCEPTED');
  const past = myQuotes.filter((q) => q !== active);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-muted">
        <Link href="/assistant/requests" className="underline underline-offset-2">
          Open requests
        </Link>{' '}
        / {request.task.name}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{request.task.name}</h1>
        <StatusPill status={request.status} />
      </div>
      <section
        className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card"
        aria-label="Request details"
      >
        <RequestFacts request={request} />
        <p className="mt-4 text-xs text-ink-muted">
          The customer’s identity and contact details are not shared. {request.pendingQuoteCount}{' '}
          {request.pendingQuoteCount === 1 ? 'quote has' : 'quotes have'} been sent so far.
        </p>
      </section>

      {active ? (
        <section
          className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card"
          aria-labelledby="mine-heading"
        >
          <h2 id="mine-heading" className="text-xl font-bold tracking-tight">
            Your quote
          </h2>
          <p className="mt-2 text-2xl font-bold">{formatNaira(active.amountKobo)}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {ASSISTANT_QUOTE_STATUS_LABEL[active.status]}
          </p>
          {active.message ? (
            <p className="mt-3 whitespace-pre-line text-sm">{active.message}</p>
          ) : null}
          {active.status === 'PENDING' ? (
            <div className="mt-4">
              <WithdrawQuoteButton quoteId={active.id} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">
              The customer accepted your quote. Payment, booking confirmation and messaging aren’t
              available yet, so there is nothing more to do here for now.
            </p>
          )}
        </section>
      ) : request.acceptingQuotes ? (
        <section
          className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card"
          aria-labelledby="quote-heading"
        >
          <h2 id="quote-heading" className="text-xl font-bold tracking-tight">
            Send a quote
          </h2>
          <div className="mt-4">
            <QuoteForm requestId={request.id} />
          </div>
        </section>
      ) : (
        <div className="mt-6">
          <Alert tone="info">This request is no longer accepting quotes.</Alert>
        </div>
      )}

      {past.length > 0 ? (
        <section className="mt-8" aria-labelledby="past-heading">
          <h2 id="past-heading" className="text-lg font-semibold">
            Your earlier quotes on this request
          </h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface text-sm">
            {past.map((q) => (
              <li key={q.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>{formatNaira(q.amountKobo)}</span>
                <span className="text-ink-muted">{ASSISTANT_QUOTE_STATUS_LABEL[q.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
