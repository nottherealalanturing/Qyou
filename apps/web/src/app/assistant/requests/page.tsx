import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination } from '@/components/catalog/pagination';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { RequestRow } from '@/components/requests/request-summary';
import { Alert } from '@/components/ui/alert';
import { buttonClasses } from '@/components/ui/button';
import { requireUser } from '@/lib/guard';
import {
  ASSISTANT_QUOTE_STATUS_LABEL,
  formatNaira,
  type FeedItem,
  type Paged,
} from '@/lib/requests';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Open requests' };

export default async function AssistantRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireUser('/assistant/requests');
  if ('unavailable' in auth)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );
  const raw = await searchParams;
  const pageParam = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(pageParam ?? '1', 10) || 1));

  const result = await apiAuthed<Paged<FeedItem>>(
    `/assistants/me/requests?pageSize=10&page=${page}`,
  );
  if (result.status === 'unauthenticated') redirect('/login?next=/assistant/requests');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Open requests</h1>
        <Link href="/assistant/quotes" className={buttonClasses('secondary', 'sm')}>
          My quotes
        </Link>
      </div>
      <p className="mt-2 text-ink-muted">
        Requests for tasks you offer, in cities you serve, that are still open for quotes. You never
        see who posted a request.
      </p>

      <section className="mt-6" aria-live="polite">
        {result.status === 'forbidden' ? (
          <Alert tone="info">
            You can browse and quote on requests once your assistant application is approved and
            fully verified.{' '}
            <Link href="/assistant" className="underline">
              See your application
            </Link>
            .
          </Alert>
        ) : result.status !== 'ok' ? (
          <UnavailableState what="open requests" />
        ) : result.data.total === 0 ? (
          <EmptyState title="No open requests match what you offer right now">
            New requests appear here as customers post them. We don’t send notifications yet, so
            check back later. You can widen what you offer from{' '}
            <Link href="/assistant" className="underline">
              your application
            </Link>
            .
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-4">
              {result.data.items.map((r) => (
                <li key={r.id}>
                  <RequestRow request={r} href={`/assistant/requests/${r.id}`} />
                  {r.myQuote ? (
                    <p className="mt-1 px-1 text-sm text-ink-muted">
                      Your quote: {formatNaira(r.myQuote.amountKobo)} ·{' '}
                      {ASSISTANT_QUOTE_STATUS_LABEL[r.myQuote.status]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pagination
              page={result.data.page}
              totalPages={result.data.totalPages}
              hrefFor={(target) =>
                target > 1 ? `/assistant/requests?page=${target}` : '/assistant/requests'
              }
            />
          </>
        )}
      </section>
    </main>
  );
}
