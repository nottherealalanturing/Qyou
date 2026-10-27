import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, UnavailableState } from '@/components/catalog/states';
import { NewRequestForm, type VenueForForm } from '@/components/requests/new-request-form';
import { Alert } from '@/components/ui/alert';
import { fetchLocation } from '@/lib/catalog';
import { loadCatalog } from '@/lib/catalog-tree';
import { requireUser } from '@/lib/guard';
import { todayInLagos } from '@/lib/requests';

export const metadata: Metadata = { title: 'Post a request' };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const slug = (key: string) => {
    const value = Array.isArray(raw[key]) ? raw[key]?.[0] : (raw[key] as string | undefined);
    return value && SLUG.test(value) && value.length <= 100 ? value : undefined;
  };
  const carried = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  ).toString();
  const next = carried ? `/requests/new?${carried}` : '/requests/new';

  const auth = await requireUser(next);
  if ('unavailable' in auth)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="your account" />
      </main>
    );

  const catalog = await loadCatalog();
  if (!catalog)
    return (
      <main className="mx-auto max-w-3xl px-4 py-14">
        <UnavailableState what="the list of tasks and cities" />
      </main>
    );

  let venue: VenueForForm | null = null;
  const locationSlug = slug('location');
  if (locationSlug) {
    const found = await fetchLocation(locationSlug);
    if (found.status === 'ok')
      venue = {
        id: found.data.location.id,
        name: found.data.location.name,
        address: found.data.location.address,
        city: found.data.location.city,
        category: found.data.location.category,
        tasks: found.data.tasks,
      };
  }

  const category = catalog.categories.find((c) => c.category.slug === slug('category'));
  const wantedTask = (venue ? venue.tasks : (category?.tasks ?? [])).find(
    (t) => t.slug === slug('task'),
  );
  const city = catalog.cities.find((c) => c.slug === slug('city'));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Post a request</h1>
      <p className="mt-2 text-ink-muted">
        Describe the job. Approved assistants who serve your area and offer this task can send you a
        quote, and you choose one.{' '}
        <Link href="/assistants" className="underline underline-offset-2">
          Browse assistants
        </Link>{' '}
        first if you like.
      </p>
      <div className="mt-6">
        {!auth.user.emailVerified ? (
          <Alert tone="info">
            Verify your email address to post a request. We sent you a link when you signed up; you
            can send another from{' '}
            <Link href="/account" className="underline">
              your account
            </Link>
            .
          </Alert>
        ) : catalog.categories.length === 0 ? (
          <EmptyState title="No tasks are available yet">
            Requests open once the list of tasks has been set up.
          </EmptyState>
        ) : (
          <div className="rounded-card border border-line bg-surface p-6 shadow-card">
            <NewRequestForm
              catalog={catalog}
              venue={venue}
              today={todayInLagos()}
              initial={{ taskId: wantedTask?.id, cityId: city?.id }}
            />
          </div>
        )}
      </div>
    </main>
  );
}
