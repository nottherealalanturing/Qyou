import { getJson, parseSearchParams, searchQueryString } from './catalog';

const respond = (status: number, body: unknown = {}) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe('getJson', () => {
  it('returns data on success and calls the given base URL', async () => {
    const fetchMock = respond(200, { items: [] });
    await expect(getJson('/cities', fetchMock, 'http://api')).resolves.toEqual({
      status: 'ok',
      data: { items: [] },
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://api/cities');
  });

  it('maps 404 to not_found and every other failure to unavailable (never throws)', async () => {
    await expect(getJson('/x', respond(404), 'http://api')).resolves.toEqual({
      status: 'not_found',
    });
    for (const status of [400, 429, 500, 503]) {
      await expect(getJson('/x', respond(status), 'http://api')).resolves.toEqual({
        status: 'unavailable',
      });
    }
    const down = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('ECONNREFUSED')));
    await expect(getJson('/x', down, 'http://api')).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats a malformed JSON body as unavailable', async () => {
    const bad = vi.fn<typeof fetch>(async () => new Response('<html>', { status: 200 }));
    await expect(getJson('/x', bad, 'http://api')).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('parseSearchParams', () => {
  it('defaults to page 1 and nothing selected', () => {
    expect(parseSearchParams({})).toEqual({
      q: undefined,
      city: undefined,
      category: undefined,
      page: 1,
    });
  });

  it('normalises the query and keeps valid slugs and pages', () => {
    expect(
      parseSearchParams({
        q: '  main   branch ',
        city: 'lagos',
        category: 'banks-and-payments',
        page: '3',
      }),
    ).toEqual({
      q: 'main branch',
      city: 'lagos',
      category: 'banks-and-payments',
      page: 3,
    });
  });

  it('drops anything invalid instead of passing it to the API', () => {
    const parsed = parseSearchParams({
      q: '   ',
      city: 'Not A Slug',
      category: '../etc',
      page: '-4',
    });
    expect(parsed).toEqual({ q: undefined, city: undefined, category: undefined, page: 1 });
    expect(parseSearchParams({ page: 'abc' }).page).toBe(1);
    expect(parseSearchParams({ page: '1.5' }).page).toBe(1);
    expect(parseSearchParams({ page: '99999' }).page).toBe(1);
    expect(parseSearchParams({ q: 'x'.repeat(200) }).q).toHaveLength(80);
  });

  it('uses the first value of repeated parameters', () => {
    expect(parseSearchParams({ city: ['kano', 'lagos'] }).city).toBe('kano');
  });
});

describe('searchQueryString', () => {
  it('omits empty values and page 1, and encodes text', () => {
    expect(searchQueryString({ page: 1 })).toBe('');
    expect(searchQueryString({ q: 'a & b', city: 'lagos', page: 2 })).toBe(
      'q=a+%26+b&city=lagos&page=2',
    );
    expect(searchQueryString({ page: 1 }, { pageSize: 12 })).toBe('pageSize=12');
  });
});
