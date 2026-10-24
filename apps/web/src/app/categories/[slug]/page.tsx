import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CategoryIcon } from '@/components/catalog/category-icon';
import { TaskList } from '@/components/catalog/task-list';
import { UnavailableState } from '@/components/catalog/states';
import { buttonClasses } from '@/components/ui/button';
import { fetchCategory } from '@/lib/catalog';
import { countLabel } from '@/lib/eligibility';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await fetchCategory((await params).slug);
  return { title: result.status === 'ok' ? result.data.category.name : 'Category' };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const result = await fetchCategory(slug);
  if (result.status === 'not_found') notFound();
  if (result.status === 'unavailable') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <UnavailableState what="this category" />
      </main>
    );
  }
  const { category, tasks } = result.data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/" className="underline underline-offset-2">
          Home
        </Link>{' '}
        / {category.name}
      </nav>
      <header className="mt-5 flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <CategoryIcon iconKey={category.iconKey} />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
          <p className="mt-1 text-ink-muted">{category.description}</p>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={`/search?category=${category.slug}`} className={buttonClasses('primary', 'md')}>
          {category.locationCount === 0
            ? 'Find locations'
            : `See ${countLabel(category.locationCount, 'location')}`}
        </Link>
        {category.locationCount === 0 ? (
          <p className="text-sm text-ink-muted">No locations of this type have been added yet.</p>
        ) : null}
      </div>

      <section className="mt-12" aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="text-2xl font-bold tracking-tight">
          What assistants can and can’t do
        </h2>
        <p className="mt-1 text-ink-muted">
          These rules apply to every {category.name.toLowerCase()} location. A specific venue may be
          stricter, and its page will say so.
        </p>
        <div className="mt-6">
          <TaskList tasks={tasks.map((t) => ({ ...t }))} />
        </div>
      </section>
    </main>
  );
}
