import Link from 'next/link';
import type { PublicAssistantCard } from '@/lib/assistants';
import { CategoryIcon } from '../catalog/category-icon';

export function Avatar({
  name,
  className = 'h-14 w-14 text-xl',
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700 ${className}`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function AssistantCard({ assistant }: { assistant: PublicAssistantCard }) {
  return (
    <Link
      href={`/assistants/${assistant.slug}`}
      className="group flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-center gap-3">
        <Avatar name={assistant.displayName} />
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold tracking-tight">{assistant.displayName}</h3>
          <p className="truncate text-sm text-ink-muted">
            {assistant.cities.map((c) => c.name).join(', ')}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-ink-muted">{assistant.summary}</p>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Types of place">
        {assistant.categories.map((c) => (
          <li
            key={c.slug}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
          >
            <CategoryIcon iconKey={c.iconKey} className="h-3.5 w-3.5" />
            {c.name}
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-4 text-xs text-ink-muted">
        Speaks {assistant.languages.map((l) => l.name).join(', ')}
      </p>
    </Link>
  );
}
