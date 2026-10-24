import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { UnavailableState, EmptyState } from '@/components/catalog/states';
import { Alert } from '@/components/ui/alert';
import { STATUS_COPY, type AdminList, type ApplicationStatus } from '@/lib/assistants';
import { countLabel } from '@/lib/eligibility';
import { apiAuthed } from '@/lib/server-api';

export const metadata: Metadata = {
  title: 'Assistant applications · Admin',
  robots: { index: false },
};

const STATUSES: ApplicationStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'SUSPENDED',
  'REJECTED',
  'DRAFT',
];

export default async function AdminAssistantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status, page } = await searchParams;
  const valid = STATUSES.find((s) => s === status);
  const pageNumber = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const query = new URLSearchParams({
    pageSize: '25',
    page: String(pageNumber),
    ...(valid ? { status: valid } : {}),
  });
  const result = await apiAuthed<AdminList>(`/admin/assistants?${query}`);

  if (result.status === 'unauthenticated') redirect('/login?next=/admin/assistants');
  // Non-administrators are shown nothing: the page does not even confirm that it exists.
  if (result.status === 'forbidden' && result.code !== 'EMAIL_NOT_VERIFIED') notFound();
  if (result.status === 'forbidden') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <Alert tone="error">Verify your email address to use the administration pages.</Alert>
      </main>
    );
  }
  if (result.status !== 'ok')
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="applications" />
      </main>
    );
  const list = result.data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Assistant applications</h1>
      <p className="mt-1 text-ink-muted">
        Oldest status change first. Private details are not shown here; opening an application is
        logged.
      </p>
      <nav aria-label="Filter by status" className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/admin/assistants"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium ${!valid ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25'}`}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/assistants?status=${s}`}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${valid === s ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25'}`}
          >
            {STATUS_COPY[s].title}
          </Link>
        ))}
      </nav>

      <section className="mt-6" aria-live="polite">
        {list.total === 0 ? (
          <EmptyState title="No applications here">Nothing matches this filter yet.</EmptyState>
        ) : (
          <>
            <p className="text-sm font-semibold">{countLabel(list.total, 'application')}</p>
            <div className="mt-3 overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">Assistant applications</caption>
                <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th scope="col" className="p-3">
                      Assistant
                    </th>
                    <th scope="col" className="p-3">
                      Status
                    </th>
                    <th scope="col" className="p-3">
                      Identity
                    </th>
                    <th scope="col" className="p-3">
                      Email
                    </th>
                    <th scope="col" className="p-3">
                      Phone
                    </th>
                    <th scope="col" className="p-3">
                      <span className="sr-only">Review</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((item) => (
                    <tr key={item.id} className="border-t border-line">
                      <th scope="row" className="p-3 text-left font-medium">
                        {item.displayName}
                        <span className="block text-xs font-normal text-ink-muted">
                          {item.applicantName}
                        </span>
                      </th>
                      <td className="p-3">{STATUS_COPY[item.status].title}</td>
                      <td className="p-3">
                        {item.identityOutcome.charAt(0) +
                          item.identityOutcome.slice(1).toLowerCase()}
                      </td>
                      <td className="p-3">{item.emailVerified ? '✓ Verified' : 'Not verified'}</td>
                      <td className="p-3">{item.phoneVerified ? '✓ Verified' : 'Not verified'}</td>
                      <td className="p-3 text-right">
                        <Link
                          href={`/admin/assistants/${item.id}`}
                          className="font-semibold text-brand-700 underline underline-offset-2"
                        >
                          Review<span className="sr-only"> {item.displayName}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.totalPages > 1 ? (
              <p className="mt-4 flex items-center justify-between text-sm">
                {pageNumber > 1 ? (
                  <Link
                    href={`/admin/assistants?${new URLSearchParams({ ...(valid ? { status: valid } : {}), page: String(pageNumber - 1) })}`}
                    className="font-semibold underline"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-ink-muted">
                  Page {list.page} of {list.totalPages}
                </span>
                {pageNumber < list.totalPages ? (
                  <Link
                    href={`/admin/assistants?${new URLSearchParams({ ...(valid ? { status: valid } : {}), page: String(pageNumber + 1) })}`}
                    className="font-semibold underline"
                  >
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
