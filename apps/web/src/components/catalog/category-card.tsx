import Link from 'next/link';
import type { Category } from '@/lib/catalog';
import { countLabel } from '@/lib/eligibility';
import { CategoryIcon } from './category-icon';

export function CategoryCard({ category }: { category: Category }) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex h-28 items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface/80 shadow-sm transition group-hover:scale-105">
          <CategoryIcon iconKey={category.iconKey} />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold tracking-tight">{category.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{category.description}</p>
        <p className="mt-auto pt-4 text-sm font-medium text-ink">
          {countLabel(category.taskCount, 'task')}
          <span aria-hidden="true"> · </span>
          <span className={category.locationCount === 0 ? 'text-ink-muted' : ''}>
            {category.locationCount === 0
              ? 'no locations yet'
              : countLabel(category.locationCount, 'location')}
          </span>
        </p>
      </div>
    </Link>
  );
}
