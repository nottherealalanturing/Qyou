import Link from 'next/link';
import { searchQueryString, type SearchParams } from '@/lib/catalog';

/** Previous/next links (plain anchors, so pagination works without JavaScript). */
export function Pagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: SearchParams;
}) {
  if (totalPages <= 1) return null;
  const href = (target: number) => {
    const query = searchQueryString({ ...params, page: target });
    return query ? `/search?${query}` : '/search';
  };
  const base =
    'inline-flex h-10 items-center rounded-xl border border-ink/25 px-4 text-sm font-semibold hover:border-ink';
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={base}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-ink-muted">
        Page {page} of {totalPages}
      </p>
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className={base}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
