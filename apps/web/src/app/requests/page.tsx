import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination } from '@/components/catalog/pagination';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { RequestRow } from '@/components/requests/request-summary';
import { buttonClasses } from '@/components/ui/button';
import { requireUser } from '@/lib/guard';
import {
  REQUEST_STATUS_COPY,
  type Paged,
  type RequestStatus,
  type RequestView,
} from '@/lib/requests';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = { title: 'My requests' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function hrefFor(target: number, filter?: string) {
  const q = new URLSearchParams();
  if (filter) q.set('status', filter);
  if (target > 1) q.set('page', String(target));
  return q.size > 0 ? `/requests?${q.toString()}` : '/requests';
}

const FILTERS: (RequestStatus | 'ALL')[] = [
  'ALL',
  'OPEN',
  'QUOTED',
  'QUOTE_ACCEPTED',
  'EXPIRED',
  'CANCELLED',
];

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireUser('/requests');
  if ('unavailable' in auth)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );

  const raw = await searchParams;
  const status = FILTERS.find((f) => f === one(raw.status) && f !== 'ALL');
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(raw.page) ?? '1', 10) || 1));
  const query = new URLSearchParams({ pageSize: '10', page: String(page) });
  if (status) query.set('status', status);

  const result = await apiAuthed<Paged<RequestView>>(`/service-requests?${query.toString()}`);
  if (result.status === 'unauthenticated') redirect('/login?next=/requests');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">My requests</h1>
        <Link href="/requests/new" className={buttonClasses('primary', 'sm')}>
          Post a request
        </Link>
      </div>
      <nav aria-label="Filter by status" className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f === 'ALL' && !status) || f === status;
          return (
            <Link
              key={f}
              href={hrefFor(1, f === 'ALL' ? undefined : f)}
              aria-current={active ? 'page' : undefined}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25 hover:border-ink'}`}
            >
              {f === 'ALL' ? 'All' : REQUEST_STATUS_COPY[f].label}
            </Link>
          );
        })}
      </nav>

      <section className="mt-6" aria-live="polite">
        {result.status !== 'ok' ? (
          <UnavailableState what="your requests" />
        ) : result.data.total === 0 ? (
          <EmptyState
            title={status ? 'No requests with that status' : 'You haven’t posted a request yet'}
            action={{ href: '/requests/new', label: 'Post a request' }}
          >
            {status
              ? 'Try another filter.'
              : 'Tell us what you need done and approved assistants who serve your area can send you quotes.'}
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-4">
              {result.data.items.map((r) => (
                <li key={r.id}>
                  <RequestRow request={r} href={`/requests/${r.id}`} />
                </li>
              ))}
            </ul>
            <Pagination
              page={result.data.page}
              totalPages={result.data.totalPages}
              hrefFor={(target) => hrefFor(target, status)}
            />
          </>
        )}
      </section>
    </main>
  );
}
