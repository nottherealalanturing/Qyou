import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses } from '../ui/button';

/** Honest empty state: says what is true ("nothing here yet"), never implies hidden content. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <div className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{children}</div>
      {action ? (
        <Link href={action.href} className={`${buttonClasses('secondary', 'sm')} mt-6`}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function UnavailableState({ what }: { what: string }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-danger/30 bg-danger/5 px-6 py-8 text-center"
    >
      <p className="font-semibold text-danger">We couldn’t load {what} right now.</p>
      <p className="mt-1 text-sm text-ink-muted">
        This is on our side. Please try again in a moment.
      </p>
    </div>
  );
}
