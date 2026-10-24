import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CategoryIcon } from '@/components/catalog/category-icon';
import { UnavailableState } from '@/components/catalog/states';
import { TaskList } from '@/components/catalog/task-list';
import { fetchLocation } from '@/lib/catalog';
import { placeLabel } from '@/lib/eligibility';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await fetchLocation((await params).slug);
  return { title: result.status === 'ok' ? result.data.location.name : 'Location' };
}

export default async function LocationPage({ params }: Props) {
  const { slug } = await params;
  const result = await fetchLocation(slug);
  if (result.status === 'not_found') notFound();
  if (result.status === 'unavailable') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <UnavailableState what="this location" />
      </main>
    );
  }
  const { location, tasks, restrictions } = result.data;
  const venueWide = restrictions.filter((r) => r.task === null);
  // Venue-wide advisories are shown once, in the box above; don't repeat them under every task.
  const shownAbove = new Set(venueWide.filter((r) => r.rule === 'ADVISORY').map((r) => r.note));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/search" className="underline underline-offset-2">
          Locations
        </Link>{' '}
        / {location.city.name}
      </nav>
      <header className="mt-5 flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <CategoryIcon iconKey={location.category.iconKey} />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            <Link href={`/categories/${location.category.slug}`}>{location.category.name}</Link>
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{location.name}</h1>
          <p className="mt-1 text-ink-muted">
            {location.address} · {placeLabel(location.city)}
          </p>
        </div>
      </header>

      {venueWide.length > 0 ? (
        <section
          className="mt-8 rounded-card border border-warning/30 bg-warning/5 p-5"
          aria-labelledby="venue-rules-heading"
        >
          <h2 id="venue-rules-heading" className="font-semibold">
            Rules specific to this venue
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {venueWide.map((r) => (
              <li key={`${r.rule}-${r.note}`}>{r.note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="text-2xl font-bold tracking-tight">
          What assistants can do here
        </h2>
        <div className="mt-6">
          <TaskList
            tasks={tasks.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              eligibility: t.effectiveEligibility,
              taskEligibility: t.eligibility,
              authorizationNotes: t.authorizationNotes,
              restrictionNotes: t.restrictionNotes,
              venueNotes: t.venueNotes.filter(
                (n) => !(n.rule === 'ADVISORY' && shownAbove.has(n.note)),
              ),
            }))}
          />
        </div>
      </section>

      <p className="mt-10 rounded-card border border-line bg-surface p-5 text-sm text-ink-muted">
        Booking an assistant isn’t available yet. There are no assistants on Qyou so far; this page
        shows what will be possible here.
      </p>
    </main>
  );
}
