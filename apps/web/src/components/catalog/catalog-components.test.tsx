import { renderToStaticMarkup } from 'react-dom/server';
import type { Category, City } from '@/lib/catalog';
import { CategoryCard } from './category-card';
import { EligibilityBadge } from './eligibility-badge';
import { Pagination } from './pagination';
import { SearchForm } from './search-form';
import { EmptyState, UnavailableState } from './states';
import { TaskList, type TaskRow } from './task-list';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const category = (over: Partial<Category> = {}): Category => ({
  id: '1',
  slug: 'banks-and-payments',
  name: 'Banks & payment offices',
  description: 'Branch queues.',
  iconKey: 'bank',
  taskCount: 5,
  locationCount: 0,
  ...over,
});

const city = (slug: string, name: string): City => ({
  id: slug,
  slug,
  name,
  state: name,
  latitude: 1,
  longitude: 1,
  timezone: 'Africa/Lagos',
  locationCount: 0,
});

describe('CategoryCard', () => {
  it('links to the category and says plainly when there are no locations', () => {
    const out = html(<CategoryCard category={category()} />);
    expect(out).toContain('href="/categories/banks-and-payments"');
    expect(out).toContain('5 tasks');
    expect(out).toContain('no locations yet');
  });

  it('pluralises and shows real location counts', () => {
    expect(html(<CategoryCard category={category({ taskCount: 1, locationCount: 1 })} />)).toMatch(
      /1 task.*1 location/s,
    );
    expect(html(<CategoryCard category={category({ locationCount: 12 })} />)).toContain(
      '12 locations',
    );
  });
});

describe('EligibilityBadge', () => {
  it('uses text and an icon, never colour alone', () => {
    expect(html(<EligibilityBadge eligibility="ELIGIBLE" />)).toMatch(/✓.*Available/s);
    expect(html(<EligibilityBadge eligibility="REQUIRES_AUTHORIZATION" />)).toContain(
      'Needs your authorization',
    );
    expect(html(<EligibilityBadge eligibility="NOT_DELEGABLE" />)).toMatch(/✕.*Not available/s);
  });
});

describe('TaskList', () => {
  const tasks: TaskRow[] = [
    {
      id: 'n',
      name: 'Biometrics',
      description: 'd',
      eligibility: 'NOT_DELEGABLE',
      authorizationNotes: null,
      restrictionNotes: 'You must be there in person.',
    },
    {
      id: 'a',
      name: 'Hold your place',
      description: 'd',
      eligibility: 'ELIGIBLE',
      authorizationNotes: null,
      restrictionNotes: null,
    },
    {
      id: 'r',
      name: 'Submit documents',
      description: 'd',
      eligibility: 'REQUIRES_AUTHORIZATION',
      authorizationNotes: 'Signed letter and ID copy.',
      restrictionNotes: null,
    },
  ];

  it('orders groups available → needs authorization → not available', () => {
    const out = html(<TaskList tasks={tasks} />);
    const order = ['Hold your place', 'Submit documents', 'Biometrics'].map((n) => out.indexOf(n));
    expect(order).toEqual(order.toSorted((x, y) => x - y));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('shows what to provide only for authorization tasks and the reason only for unavailable ones', () => {
    const out = html(<TaskList tasks={tasks} />);
    expect(out).toContain('What you’d need to provide: </strong>Signed letter and ID copy.');
    expect(out).toContain('Why not: </strong>You must be there in person.');
    expect(html(<TaskList tasks={[tasks[1] as TaskRow]} />)).not.toMatch(/Why not|need to provide/);
  });

  it('flags when a venue is stricter than the usual rule, and lists venue notes', () => {
    const out = html(
      <TaskList
        tasks={[
          {
            id: 'v',
            name: 'Hold your place',
            description: 'd',
            eligibility: 'REQUIRES_AUTHORIZATION',
            taskEligibility: 'ELIGIBLE',
            authorizationNotes: 'Bring a letter.',
            restrictionNotes: null,
            venueNotes: [{ rule: 'ADVISORY', note: 'Mondays are busiest.' }],
          },
        ]}
      />,
    );
    expect(out).toContain('Stricter at this venue');
    expect(out).toContain('Good to know: </strong>Mondays are busiest.');
  });

  it('renders nothing for an empty list', () => {
    expect(html(<TaskList tasks={[]} />)).not.toContain('<li');
  });
});

describe('SearchForm', () => {
  const props = {
    cities: [city('kaduna', 'Kaduna'), city('lagos', 'Lagos')],
    categories: [category()],
  };

  it('is a plain GET form to /search (works without JavaScript) with labelled fields', () => {
    const out = html(<SearchForm {...props} />);
    expect(out).toMatch(/<form[^>]*action="\/search"[^>]*method="get"/);
    for (const name of ['q', 'city', 'category']) expect(out).toContain(`name="${name}"`);
    for (const label of ['Place or address', 'City', 'Type of place']) expect(out).toContain(label);
    expect(out).toContain('value="kaduna"');
    expect(out).toContain('All cities');
  });

  it('preselects the current filters', () => {
    const out = html(<SearchForm {...props} values={{ q: 'main', city: 'lagos' }} />);
    expect(out).toContain('value="main"');
    expect(out).toMatch(/<option value="lagos" selected/);
  });
});

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    expect(html(<Pagination page={1} totalPages={1} params={{ page: 1 }} />)).toBe('');
  });

  it('links previous/next while preserving the filters', () => {
    const out = html(
      <Pagination page={2} totalPages={3} params={{ q: 'a b', city: 'lagos', page: 2 }} />,
    );
    expect(out).toContain('href="/search?q=a+b&amp;city=lagos"'); // page 1 omits ?page
    expect(out).toContain('href="/search?q=a+b&amp;city=lagos&amp;page=3"');
    expect(out).toContain('Page 2 of 3');
  });

  it('hides previous on the first page and next on the last', () => {
    expect(html(<Pagination page={1} totalPages={2} params={{ page: 1 }} />)).not.toContain(
      'Previous',
    );
    expect(html(<Pagination page={2} totalPages={2} params={{ page: 2 }} />)).not.toContain('Next');
  });
});

describe('states', () => {
  it('empty state shows its message and optional action', () => {
    const out = html(
      <EmptyState title="Nothing here yet" action={{ href: '/', label: 'Go home' }}>
        We have not added any.
      </EmptyState>,
    );
    expect(out).toContain('Nothing here yet');
    expect(out).toContain('href="/"');
  });

  it('unavailable state is announced as an alert and blames us, not the user', () => {
    const out = html(<UnavailableState what="the categories" />);
    expect(out).toContain('role="alert"');
    expect(out).toContain('couldn’t load the categories');
    expect(out).toContain('on our side');
  });
});
