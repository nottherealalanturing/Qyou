import Link from 'next/link';
import type { PublicAssistantCard } from '@/lib/assistants';

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

const MAX_TASKS_SHOWN = 4;

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
          <p className="text-sm text-ink-muted">
            <span className="sr-only">Serves </span>
            {assistant.cities.map((c) => c.name).join(', ')}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-ink-muted">{assistant.summary}</p>
      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Can help with
      </h4>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Tasks offered">
        {assistant.tasks.slice(0, MAX_TASKS_SHOWN).map((t) => (
          <li
            key={`${t.categorySlug}/${t.slug}`}
            className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
          >
            {t.name}
          </li>
        ))}
        {assistant.tasks.length > MAX_TASKS_SHOWN ? (
          <li className="rounded-full px-1 py-1 text-xs font-medium text-ink-muted">
            +{assistant.tasks.length - MAX_TASKS_SHOWN} more
          </li>
        ) : null}
      </ul>
      <p className="mt-auto pt-4 text-xs text-ink-muted">
        Speaks {assistant.languages.map((l) => l.name).join(', ')}
      </p>
    </Link>
  );
}
