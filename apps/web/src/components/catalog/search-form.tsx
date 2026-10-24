import type { Category, City } from '@/lib/catalog';

interface SearchFormProps {
  cities: City[];
  categories: Category[];
  values?: { q?: string | undefined; city?: string | undefined; category?: string | undefined };
  /** Hero variant is larger; compact is used above results. */
  variant?: 'hero' | 'compact';
}

const field =
  'h-12 w-full rounded-xl border border-ink/20 bg-surface px-4 text-base text-ink hover:border-ink focus-visible:outline-2';

/**
 * A plain GET form: it works without JavaScript, is fully keyboard/screen-reader accessible, and
 * the resulting URL is shareable. Empty fields are simply ignored by the search page.
 */
export function SearchForm({
  cities,
  categories,
  values = {},
  variant = 'compact',
}: SearchFormProps) {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      aria-label="Find locations"
      className={
        variant === 'hero'
          ? 'grid gap-3 rounded-[1.75rem] border border-line bg-surface p-3 shadow-card md:grid-cols-[1.4fr_1fr_1fr_auto]'
          : 'grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]'
      }
    >
      <div>
        <label
          htmlFor={`q-${variant}`}
          className="mb-1 block px-1 text-xs font-semibold text-ink-muted"
        >
          Place or address
        </label>
        <input
          id={`q-${variant}`}
          name="q"
          type="search"
          defaultValue={values.q ?? ''}
          maxLength={80}
          placeholder="e.g. a branch, office or street"
          autoComplete="off"
          className={field}
        />
      </div>
      <div>
        <label
          htmlFor={`city-${variant}`}
          className="mb-1 block px-1 text-xs font-semibold text-ink-muted"
        >
          City
        </label>
        <select
          id={`city-${variant}`}
          name="city"
          defaultValue={values.city ?? ''}
          className={field}
        >
          <option value="">All cities</option>
          {cities.map((city) => (
            <option key={city.slug} value={city.slug}>
              {city.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          htmlFor={`category-${variant}`}
          className="mb-1 block px-1 text-xs font-semibold text-ink-muted"
        >
          Type of place
        </label>
        <select
          id={`category-${variant}`}
          name="category"
          defaultValue={values.category ?? ''}
          className={field}
        >
          <option value="">All types</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          className="h-12 w-full rounded-xl bg-brand-600 px-8 font-semibold text-white hover:bg-brand-700 md:w-auto"
        >
          Search
        </button>
      </div>
    </form>
  );
}
