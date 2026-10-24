import type { Metadata } from 'next';
import { AssistantCard } from '@/components/assistant/assistant-card';
import { Pagination } from '@/components/catalog/pagination';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { fetchAssistants } from '@/lib/assistants';
import { fetchCategories, fetchCities, parseSearchParams, searchQueryString } from '@/lib/catalog';
import { countLabel } from '@/lib/eligibility';

export const metadata: Metadata = { title: 'Assistants' };

export default async function AssistantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseSearchParams(await searchParams);
  const query = searchQueryString(
    { city: params.city, category: params.category, page: params.page },
    { pageSize: 12 },
  );
  const [categories, cities, result] = await Promise.all([
    fetchCategories(),
    fetchCities(),
    fetchAssistants(query),
  ]);
  const filtered = Boolean(params.city || params.category);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Assistants</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Every assistant listed here has been approved by the Qyou team, with a verified email and
        phone number and a manual identity review. Contact details and verification records are
        never shown.
      </p>
      <form
        action="/assistants"
        method="get"
        role="search"
        aria-label="Filter assistants"
        className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
      >
        <label className="text-sm font-semibold">
          City
          <select
            name="city"
            defaultValue={params.city ?? ''}
            className="mt-1 h-12 w-full rounded-xl border border-ink/20 bg-surface px-4 text-base font-normal"
          >
            <option value="">All cities</option>
            {(cities.status === 'ok' ? cities.data.items : []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Type of place
          <select
            name="category"
            defaultValue={params.category ?? ''}
            className="mt-1 h-12 w-full rounded-xl border border-ink/20 bg-surface px-4 text-base font-normal"
          >
            <option value="">All types</option>
            {(categories.status === 'ok' ? categories.data.items : []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-12 self-end rounded-xl bg-brand-600 px-8 font-semibold text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      <section className="mt-8" aria-live="polite">
        {result.status !== 'ok' ? (
          <UnavailableState what="assistants" />
        ) : result.data.total === 0 ? (
          <EmptyState
            title={
              filtered
                ? 'No assistants match those filters'
                : 'No assistants have been approved yet'
            }
            action={
              filtered
                ? { href: '/assistants', label: 'Clear filters' }
                : { href: '/', label: 'Back to home' }
            }
          >
            {filtered
              ? 'Try another city or type of place.'
              : 'We verify every assistant before they appear here, so the list starts empty. Check back soon.'}
          </EmptyState>
        ) : (
          <>
            <h2 className="text-lg font-semibold">{countLabel(result.data.total, 'assistant')}</h2>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {result.data.items.map((a) => (
                <li key={a.slug}>
                  <AssistantCard assistant={a} />
                </li>
              ))}
            </ul>
            <Pagination
              page={result.data.page}
              totalPages={result.data.totalPages}
              params={params}
              basePath="/assistants"
            />
          </>
        )}
      </section>
    </main>
  );
}
