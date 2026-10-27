import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { UnavailableState } from '@/components/catalog/states';
import { CancelRequestForm, SelectQuoteButton } from '@/components/requests/quote-actions';
import { RequestFacts, StatusPill } from '@/components/requests/request-summary';
import { Alert } from '@/components/ui/alert';
import { requireUser } from '@/lib/guard';
import {
  formatNaira,
  QUOTE_STATUS_LABEL,
  REQUEST_STATUS_COPY,
  type OwnRequestDetail,
} from '@/lib/requests';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Request' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auth = await requireUser(`/requests/${id}`);
  if ('unavailable' in auth)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );

  const result = await apiAuthed<OwnRequestDetail>(`/service-requests/${id}`);
  if (result.status === 'unauthenticated') redirect(`/login?next=/requests/${id}`);
  if (result.status === 'not_found' || result.status === 'forbidden') notFound();
  if (result.status !== 'ok')
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="this request" />
      </main>
    );

  const { request, quotes } = result.data;
  const copy = REQUEST_STATUS_COPY[request.status];
  // Pending quotes first, cheapest first; history after, newest first.
  const pending = quotes
    .filter((q) => q.status === 'PENDING')
    .toSorted((a, b) => a.amountKobo - b.amountKobo);
  const accepted = quotes.filter((q) => q.status === 'ACCEPTED');
  const history = quotes
    .filter((q) => q.status !== 'PENDING' && q.status !== 'ACCEPTED')
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const canCancel = request.status !== 'CANCELLED';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-muted">
        <Link href="/requests" className="underline underline-offset-2">
          My requests
        </Link>{' '}
        / {request.task.name}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{request.task.name}</h1>
        <StatusPill status={request.status} />
      </div>
      <p className="mt-2 text-ink-muted">{copy.hint}</p>
      {request.status === 'CANCELLED' && request.closureReason ? (
        <p className="mt-2 text-sm">
          <strong>Reason: </strong>
          {request.closureReason}
        </p>
      ) : null}

      <section
        className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card"
        aria-label="Request details"
      >
        <RequestFacts request={request} />
      </section>

      {accepted.map((q) => (
        <section key={q.id} className="mt-6" aria-labelledby="accepted-heading">
          <h2 id="accepted-heading" className="text-xl font-bold tracking-tight">
            Accepted quote
          </h2>
          <div className="mt-3 rounded-card border border-success/40 bg-success/5 p-5">
            <p className="text-2xl font-bold">{formatNaira(q.amountKobo)}</p>
            <p className="mt-1 text-sm">
              from <strong>{q.assistant.displayName}</strong>
            </p>
            {q.message ? <p className="mt-3 whitespace-pre-line text-sm">{q.message}</p> : null}
            <p className="mt-3 text-sm text-ink-muted">
              Nothing has been charged and no booking exists yet: payment, confirmation and in-app
              messaging are not available. This is as far as a request can go for now.
            </p>
          </div>
        </section>
      ))}

      {request.status === 'OPEN' || request.status === 'QUOTED' || pending.length > 0 ? (
        <section className="mt-8" aria-labelledby="quotes-heading">
          <h2 id="quotes-heading" className="text-xl font-bold tracking-tight">
            Quotes
          </h2>
          {pending.length === 0 ? (
            <p className="mt-3 rounded-card border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-ink-muted">
              No quotes yet. Assistants who serve {request.city.name} and offer this task can see
              your request and reply. Check back later; we don’t send notifications yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-4">
              {pending.map((q) => (
                <li
                  key={q.id}
                  className="rounded-card border border-line bg-surface p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-2xl font-bold">{formatNaira(q.amountKobo)}</p>
                      <p className="mt-1 text-sm">
                        {q.assistant.slug ? (
                          <Link
                            href={`/assistants/${q.assistant.slug}`}
                            className="font-semibold underline underline-offset-2"
                          >
                            {q.assistant.displayName}
                          </Link>
                        ) : (
                          <strong>{q.assistant.displayName}</strong>
                        )}
                        <span className="text-ink-muted">
                          {' '}
                          · speaks {q.assistant.languages.map((l) => l.name).join(', ')}
                        </span>
                      </p>
                    </div>
                  </div>
                  {q.message ? (
                    <p className="mt-3 whitespace-pre-line text-sm">{q.message}</p>
                  ) : null}
                  <div className="mt-4">
                    {q.selectable && request.acceptingQuotes ? (
                      <SelectQuoteButton requestId={request.id} quote={q} />
                    ) : (
                      <Alert tone="info">
                        {request.acceptingQuotes
                          ? 'This assistant can’t take this job right now, so the quote can’t be accepted.'
                          : 'This request is no longer accepting decisions.'}
                      </Alert>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="mt-8" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-lg font-semibold">
            Other quotes
          </h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface text-sm">
            {history.map((q) => (
              <li key={q.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>
                  {q.assistant.displayName} · {formatNaira(q.amountKobo)}
                </span>
                <span className="text-ink-muted">{QUOTE_STATUS_LABEL[q.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canCancel ? (
        <section
          className="mt-10 rounded-card border border-line bg-surface p-6"
          aria-label="Cancel request"
        >
          <CancelRequestForm
            requestId={request.id}
            status={request.status === 'EXPIRED' ? 'OPEN' : request.status}
          />
        </section>
      ) : null}
    </main>
  );
}
