import type { Metadata } from 'next';
import Link from 'next/link';
import { AssistantCard } from '@/components/assistant/assistant-card';
import { Pagination } from '@/components/catalog/pagination';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { buttonClasses } from '@/components/ui/button';
import { fetchAssistants, LANGUAGE_OPTIONS } from '@/lib/assistants';
import { loadCatalog } from '@/lib/catalog-tree';
import { countLabel } from '@/lib/eligibility';
import {
  assistantQueryString,
  parseAssistantSearch,
  parseService,
  serviceValue,
} from '@/lib/requests';

export const metadata: Metadata = { title: 'Find an assistant' };

const control =
  'mt-1 h-12 w-full rounded-xl border border-ink/20 bg-surface px-4 text-base font-normal';

export default async function AssistantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseAssistantSearch(
    await searchParams,
    LANGUAGE_OPTIONS.map((l) => l.code),
  );
  const [catalog, result] = await Promise.all([
    loadCatalog(),
    fetchAssistants(assistantQueryString(params, { forApi: true, pageSize: 12 })),
  ]);
  const filtered = Boolean(params.city || params.service || params.language || params.q);
  const { category, task } = parseService(params.service);
  // Where a request would be posted from here: carry the chosen task and city.
  const requestHref = `/requests/new${(() => {
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if (task) query.set('task', task);
    if (params.city) query.set('city', params.city);
    return query.size > 0 ? `?${query.toString()}` : '';
  })()}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Find an assistant</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Every assistant listed here has been approved by the Qyou team, with a verified email and
        phone number and a manual identity review. Contact details and verification records are
        never shown. Prices are set by assistants when they quote on your request.
      </p>

      <form
        action="/assistants"
        method="get"
        role="search"
        aria-label="Filter assistants"
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto]"
      >
        <label className="text-sm font-semibold">
          City
          <select name="city" defaultValue={params.city ?? ''} className={control}>
            <option value="">All cities</option>
            {(catalog?.cities ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          What do you need?
          <select name="service" defaultValue={params.service ?? ''} className={control}>
            <option value="">Anything</option>
            {(catalog?.categories ?? []).map(({ category: c, tasks }) => (
              <optgroup key={c.slug} label={c.name}>
                <option value={serviceValue(c.slug)}>Anything at {c.name.toLowerCase()}</option>
                {tasks
                  .filter((t) => t.eligibility !== 'NOT_DELEGABLE')
                  .map((t) => (
                    <option key={t.slug} value={serviceValue(c.slug, t.slug)}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Language
          <select name="language" defaultValue={params.language ?? ''} className={control}>
            <option value="">Any language</option>
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Name or keyword
          <input
            name="q"
            type="search"
            maxLength={80}
            defaultValue={params.q ?? ''}
            placeholder="e.g. Ada"
            className={control}
          />
        </label>
        <button
          type="submit"
          className="h-12 self-end rounded-xl bg-brand-600 px-8 font-semibold text-white hover:bg-brand-700"
        >
          Search
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
              ? 'Try another city, task or language. You can still post a request: assistants who serve that area and offer the task can quote on it once they are approved.'
              : 'We verify every assistant before they appear here, so the list starts empty. Check back soon.'}
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {countLabel(result.data.total, 'assistant')}
              </h2>
              <Link href={requestHref} className={buttonClasses('secondary', 'sm')}>
                Post a request instead
              </Link>
            </div>
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
              hrefFor={(target) => {
                const query = assistantQueryString({ ...params, page: target });
                return query ? `/assistants?${query}` : '/assistants';
              }}
            />
          </>
        )}
      </section>
    </main>
  );
}
