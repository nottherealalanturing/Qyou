import Link from 'next/link';
import { CategoryCard } from '@/components/catalog/category-card';
import { SearchForm } from '@/components/catalog/search-form';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { fetchCategories, fetchCities } from '@/lib/catalog';
import { countLabel } from '@/lib/eligibility';

export default async function HomePage() {
  const [categories, cities] = await Promise.all([fetchCategories(), fetchCities()]);
  const categoryList = categories.status === 'ok' ? categories.data.items : [];
  const cityList = cities.status === 'ok' ? cities.data.items : [];

  return (
    <main>
      <section className="border-b border-line bg-gradient-to-b from-brand-50 to-canvas">
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-14 sm:px-6 sm:pt-20">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Skip the wait.
            <span className="block text-brand-700">Get your time back.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Find the places where a trusted person can hold your spot in line — and see exactly what
            they can and can’t do for you before you decide.
          </p>
          <div className="mt-8 max-w-4xl">
            <SearchForm cities={cityList} categories={categoryList} variant="hero" />
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-6xl px-4 py-14 sm:px-6"
        aria-labelledby="categories-heading"
      >
        <h2 id="categories-heading" className="text-2xl font-bold tracking-tight">
          Browse by type of place
        </h2>
        <p className="mt-1 text-ink-muted">
          Each type lists what an assistant can do there — and what they can’t.
        </p>
        <div className="mt-6">
          {categories.status !== 'ok' ? (
            <UnavailableState what="the categories" />
          ) : categoryList.length === 0 ? (
            <EmptyState title="Categories are on the way">
              We haven’t published any categories yet. Please check back soon.
            </EmptyState>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {categoryList.map((category) => (
                <li key={category.id}>
                  <CategoryCard category={category} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="border-t border-line bg-surface" aria-labelledby="cities-heading">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="cities-heading" className="text-2xl font-bold tracking-tight">
            Where we’re starting
          </h2>
          <p className="mt-1 text-ink-muted">
            We’re adding real locations city by city. Counts below are exactly what’s listed today.
          </p>
          <div className="mt-6">
            {cities.status !== 'ok' ? (
              <UnavailableState what="the cities" />
            ) : cityList.length === 0 ? (
              <EmptyState title="No cities yet">
                We haven’t opened any cities. Please check back soon.
              </EmptyState>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cityList.map((city) => (
                  <li key={city.id}>
                    <Link
                      href={`/search?city=${city.slug}`}
                      className="block rounded-card border border-line bg-canvas p-5 transition hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-card"
                    >
                      <p className="text-lg font-semibold">{city.name}</p>
                      <p className="text-sm text-ink-muted">{city.state}</p>
                      <p className="mt-4 text-sm font-medium">
                        {city.locationCount === 0 ? (
                          <span className="text-ink-muted">No locations added yet</span>
                        ) : (
                          countLabel(city.locationCount, 'location')
                        )}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="status-heading">
        <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
          <h2 id="status-heading" className="text-xl font-bold tracking-tight">
            What’s live today
          </h2>
          <ul className="mt-3 space-y-2 text-ink-muted">
            <li>
              <strong className="text-ink">Available now:</strong> browse places, see what can and
              can’t be delegated, find approved assistants, post a request and compare the quotes
              you receive.
            </li>
            <li>
              <strong className="text-ink">Not available yet:</strong> payment, booking confirmation
              and messaging. Accepting a quote doesn’t charge anything, and there are no completed
              bookings, reviews or ratings on Qyou yet.
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
