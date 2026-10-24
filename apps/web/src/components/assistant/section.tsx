import type { ReactNode } from 'react';

/** A titled card used by every dashboard section. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-card border border-line bg-surface p-6 shadow-card"
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function FieldNote({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-sm text-ink-muted">{children}</p>;
}
