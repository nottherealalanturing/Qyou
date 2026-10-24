import type { Metadata } from 'next';
import Link from 'next/link';
import { LocationCard } from '@/components/catalog/location-card';
import { Pagination } from '@/components/catalog/pagination';
import { SearchForm } from '@/components/catalog/search-form';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { fetchCategories, fetchCities, fetchLocations, parseSearchParams } from '@/lib/catalog';
import { countLabel } from '@/lib/eligibility';

export const metadata: Metadata = { title: 'Find locations' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseSearchParams(await searchParams);
  const [categories, cities, results] = await Promise.all([
    fetchCategories(),
    fetchCities(),
    fetchLocations(params),
  ]);
  const categoryList = categories.status === 'ok' ? categories.data.items : [];
  const cityList = cities.status === 'ok' ? cities.data.items : [];
  const filtered = Boolean(params.q || params.city || params.category);
  const cityName = cityList.find((c) => c.slug === params.city)?.name;
  const categoryName = categoryList.find((c) => c.slug === params.category)?.name;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Find locations</h1>
      <div className="mt-6">
        <SearchForm
          cities={cityList}
          categories={categoryList}
          values={{ q: params.q, city: params.city, category: params.category }}
        />
      </div>

      <section className="mt-8" aria-live="polite" aria-labelledby="results-heading">
        {results.status === 'unavailable' ? (
          <UnavailableState what="locations" />
        ) : results.status === 'not_found' ? (
          <UnavailableState what="locations" />
        ) : results.data.total === 0 ? (
          <>
            <h2 id="results-heading" className="sr-only">
              Results
            </h2>
            <EmptyState
              title={
                filtered ? 'No locations match your search' : 'No locations have been added yet'
              }
              {...(filtered
                ? { action: { href: '/search', label: 'Clear filters' } }
                : { action: { href: '/', label: 'Browse types of place' } })}
            >
              {filtered ? (
                <>
                  Try a different word, city or type of place. We only list locations that our team
                  has reviewed, so a place you know may not be here yet.
                </>
              ) : (
                <>
                  We’re adding real, reviewed locations city by city. You can still see what
                  assistants can and can’t do for each type of place.
                </>
              )}
            </EmptyState>
          </>
        ) : (
          <>
            <h2 id="results-heading" className="text-lg font-semibold">
              {countLabel(results.data.total, 'location')}
              {cityName ? ` in ${cityName}` : ''}
              {categoryName ? ` · ${categoryName}` : ''}
              {params.q ? ` matching “${params.q}”` : ''}
            </h2>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.data.items.map((location) => (
                <li key={location.id}>
                  <LocationCard location={location} />
                </li>
              ))}
            </ul>
            <Pagination
              page={results.data.page}
              totalPages={results.data.totalPages}
              params={params}
            />
          </>
        )}
      </section>

      {categoryName ? (
        <p className="mt-10 text-sm text-ink-muted">
          Curious what assistants can do for this type of place?{' '}
          <Link
            href={`/categories/${params.category}`}
            className="font-semibold text-brand-700 underline underline-offset-2"
          >
            See the rules for {categoryName}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
