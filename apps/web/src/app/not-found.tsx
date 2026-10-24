import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">We couldn’t find that page</h1>
      <p className="mt-3 text-ink-muted">
        The link may be out of date, or the place may no longer be listed.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/" className={buttonClasses('primary', 'md')}>
          Back to home
        </Link>
        <Link href="/search" className={buttonClasses('secondary', 'md')}>
          Find locations
        </Link>
      </div>
    </main>
  );
}
