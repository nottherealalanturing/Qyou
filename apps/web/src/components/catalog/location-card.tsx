import Link from 'next/link';
import type { Location } from '@/lib/catalog';
import { placeLabel } from '@/lib/eligibility';
import { CategoryIcon } from './category-icon';

export function LocationCard({ location }: { location: Location }) {
  return (
    <Link
      href={`/locations/${location.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex h-24 items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700">
        <CategoryIcon iconKey={location.category.iconKey} className="h-9 w-9" />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          {location.category.name}
        </p>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">{location.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{location.address}</p>
        <p className="mt-auto pt-4 text-sm font-medium">{placeLabel(location.city)}</p>
      </div>
    </Link>
  );
}
