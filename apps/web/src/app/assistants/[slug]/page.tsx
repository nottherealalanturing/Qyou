import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/assistant/assistant-card';
import { CategoryIcon } from '@/components/catalog/category-icon';
import { EligibilityBadge } from '@/components/catalog/eligibility-badge';
import { UnavailableState } from '@/components/catalog/states';
import { DAY_NAMES, fetchAssistant } from '@/lib/assistants';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await fetchAssistant((await params).slug);
  return { title: result.status === 'ok' ? result.data.assistant.displayName : 'Assistant' };
}

export default async function AssistantProfilePage({ params }: Props) {
  const { slug } = await params;
  const result = await fetchAssistant(slug);
  if (result.status === 'not_found') notFound();
  if (result.status === 'unavailable') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <UnavailableState what="this profile" />
      </main>
    );
  }
  const a = result.data.assistant;
  const byDay = DAY_NAMES.map((name, day) => ({
    name,
    windows: a.availability.windows.filter((w) => w.dayOfWeek === day),
  }));
  const since = a.memberSince
    ? new Date(`${a.memberSince}-01T00:00:00Z`).toLocaleDateString('en-NG', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/assistants" className="underline underline-offset-2">
          Assistants
        </Link>{' '}
        / {a.displayName}
      </nav>

      <header className="mt-5 flex items-center gap-5">
        <Avatar name={a.displayName} className="h-20 w-20 text-3xl" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{a.displayName}</h1>
          <p className="mt-1 text-ink-muted">
            {a.serviceAreas.map((c) => c.name).join(', ')}
            {since ? ` · On Qyou since ${since}` : ''}
          </p>
        </div>
      </header>

      <section
        aria-labelledby="verified-heading"
        className="mt-6 rounded-card border border-line bg-surface p-5"
      >
        <h2 id="verified-heading" className="font-semibold">
          What Qyou has checked
        </h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>{' '}
            Email verified
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>{' '}
            Phone verified
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>{' '}
            Identity: {a.verification.identity}
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-muted">
          Contact details and verification records are private and are never shown on profiles.
        </p>
      </section>

      <section className="mt-8" aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-xl font-bold tracking-tight">
          About
        </h2>
        <p className="mt-2 whitespace-pre-line">{a.bio}</p>
        <p className="mt-3 text-sm text-ink-muted">
          Speaks {a.languages.map((l) => l.name).join(', ')}
        </p>
      </section>

      <section className="mt-8" aria-labelledby="offers-heading">
        <h2 id="offers-heading" className="text-xl font-bold tracking-tight">
          What they can help with
        </h2>
        <div className="mt-4 space-y-6">
          {a.offers.map((group) => (
            <div key={group.category.slug}>
              <h3 className="flex items-center gap-2 font-semibold text-brand-700">
                <CategoryIcon iconKey={group.category.iconKey} className="h-5 w-5" />
                <Link
                  href={`/categories/${group.category.slug}`}
                  className="underline-offset-2 hover:underline"
                >
                  {group.category.name}
                </Link>
              </h3>
              <ul className="mt-2 space-y-2">
                {group.tasks.map((task) => (
                  <li
                    key={task.slug}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm"
                  >
                    <span className="font-medium">{task.name}</span>
                    <EligibilityBadge eligibility={task.eligibility} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="hours-heading">
        <h2 id="hours-heading" className="text-xl font-bold tracking-tight">
          Preferred working times
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{a.availability.disclaimer}</p>
        {a.availability.windows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No preferred times declared.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">
              Preferred working times by day ({a.availability.timezone})
            </caption>
            <tbody>
              {byDay.map((day) => (
                <tr key={day.name} className="border-t border-line">
                  <th scope="row" className="w-32 py-2 text-left font-medium">
                    {day.name}
                  </th>
                  <td className="py-2 text-ink-muted">
                    {day.windows.length === 0
                      ? '—'
                      : day.windows.map((w) => `${w.start}–${w.end}`).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {a.availability.note ? <p className="mt-3 text-sm">{a.availability.note}</p> : null}
      </section>

      <p className="mt-10 rounded-card border border-line bg-surface p-5 text-sm text-ink-muted">
        Booking isn’t available yet, and there are no reviews or completed jobs on Qyou so far. This
        page shows who {a.displayName} is and what they’ll be able to do once bookings open.
      </p>
    </main>
  );
}
