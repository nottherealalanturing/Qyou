import { apiBaseUrl } from './api';

// Response shapes of the public reference-data API (apps/api). The API's e2e tests assert these
// exact field sets, so a drift on either side fails a test (a shared contracts package is
// deferred, DECISIONS D-007).

export type Eligibility = 'ELIGIBLE' | 'REQUIRES_AUTHORIZATION' | 'NOT_DELEGABLE';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconKey: string;
  taskCount: number;
  locationCount: number;
}

export interface Task {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'QUEUE_HOLDING' | 'ERRAND';
  eligibility: Eligibility;
  requiresPersonalPresence: boolean;
  requiresCredentials: boolean;
  authorizationNotes: string | null;
  restrictionNotes: string | null;
}

export interface VenueNote {
  rule: 'PROHIBITED' | 'REQUIRES_AUTHORIZATION' | 'ADVISORY';
  note: string;
}

export interface EffectiveTask extends Task {
  effectiveEligibility: Eligibility;
  venueNotes: VenueNote[];
}

export interface City {
  id: string;
  slug: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  timezone: string;
  locationCount: number;
}

export interface Location {
  id: string;
  slug: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  city: { slug: string; name: string; state: string };
  category: { slug: string; name: string; iconKey: string };
}

export interface LocationPage {
  items: Location[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface LocationDetail {
  location: Location;
  tasks: EffectiveTask[];
  restrictions: {
    rule: VenueNote['rule'];
    note: string;
    task: { slug: string; name: string } | null;
  }[];
}

/** A failed API call is data, not an exception: pages render an honest state for each case. */
export type Fetched<T> =
  { status: 'ok'; data: T } | { status: 'not_found' } | { status: 'unavailable' };

export async function getJson<T>(
  path: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = apiBaseUrl(),
): Promise<Fetched<T>> {
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      // Matches the API's own 60 s public cache, so a deactivated record leaves within a minute.
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    } as RequestInit);
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };
    return { status: 'ok', data: (await response.json()) as T };
  } catch {
    return { status: 'unavailable' };
  }
}

export const fetchCategories = () => getJson<{ items: Category[] }>('/service-categories');
export const fetchCategory = (slug: string) =>
  getJson<{ category: Category; tasks: Task[] }>(`/service-categories/${encodeURIComponent(slug)}`);
export const fetchCities = () => getJson<{ items: City[] }>('/cities');
export const fetchLocation = (slug: string) =>
  getJson<LocationDetail>(`/service-locations/${encodeURIComponent(slug)}`);
export const fetchLocations = (params: SearchParams) =>
  getJson<LocationPage>(`/service-locations?${searchQueryString(params, { pageSize: PAGE_SIZE })}`);

// ── search parameters ────────────────────────────────────────────────────────
export const PAGE_SIZE = 12;

export interface SearchParams {
  q?: string | undefined;
  city?: string | undefined;
  category?: string | undefined;
  page: number;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** Turns untrusted URL parameters into safe API parameters; anything invalid is dropped. */
export function parseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): SearchParams {
  const q = first(raw.q)?.replace(/\s+/g, ' ').slice(0, 80);
  const city = first(raw.city);
  const category = first(raw.category);
  const page = Number.parseInt(first(raw.page) ?? '1', 10);
  return {
    q: q || undefined,
    city: city && SLUG.test(city) && city.length <= 100 ? city : undefined,
    category: category && SLUG.test(category) && category.length <= 100 ? category : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query string for `/search` links and for the API call (omits empty and default values). */
export function searchQueryString(
  params: Partial<SearchParams>,
  extra: { pageSize?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.city) query.set('city', params.city);
  if (params.category) query.set('category', params.category);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  if (extra.pageSize) query.set('pageSize', String(extra.pageSize));
  return query.toString();
}
