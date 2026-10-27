import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination } from '@/components/catalog/pagination';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { StatusPill } from '@/components/requests/request-summary';
import { requireUser } from '@/lib/guard';
import {
  formatNaira,
  ASSISTANT_QUOTE_STATUS_LABEL,
  type MyQuoteItem,
  type Paged,
} from '@/lib/requests';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = { title: 'My quotes' };

export default async function MyQuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireUser('/assistant/quotes');
  if ('unavailable' in auth)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );
  const raw = await searchParams;
  const pageParam = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(pageParam ?? '1', 10) || 1));
  const result = await apiAuthed<Paged<MyQuoteItem>>(
    `/assistants/me/quotes?pageSize=10&page=${page}`,
  );
  if (result.status === 'unauthenticated') redirect('/login?next=/assistant/quotes');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-muted">
        <Link href="/assistant/requests" className="underline underline-offset-2">
          Open requests
        </Link>{' '}
        / My quotes
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">My quotes</h1>
      <section className="mt-6" aria-live="polite">
        {result.status !== 'ok' ? (
          <UnavailableState what="your quotes" />
        ) : result.data.total === 0 ? (
          <EmptyState
            title="You haven’t sent any quotes yet"
            action={{ href: '/assistant/requests', label: 'See open requests' }}
          >
            Quotes you send appear here with their status.
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-4">
              {result.data.items.map(({ quote, request }) => (
                <li key={quote.id}>
                  <Link
                    href={`/assistant/requests/${request.id}`}
                    className="block rounded-card border border-line bg-surface p-5 shadow-card hover:shadow-lg"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold">{request.task.name}</h2>
                      <StatusPill status={request.status} />
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{request.city.name}</p>
                    <p className="mt-3 text-xl font-bold">{formatNaira(quote.amountKobo)}</p>
                    <p className="text-sm text-ink-muted">
                      {ASSISTANT_QUOTE_STATUS_LABEL[quote.status]}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={result.data.page}
              totalPages={result.data.totalPages}
              hrefFor={(target) =>
                target > 1 ? `/assistant/quotes?page=${target}` : '/assistant/quotes'
              }
            />
          </>
        )}
      </section>
    </main>
  );
}
