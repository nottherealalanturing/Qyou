import { apiBaseUrl, getApiStatus, type ReadinessReport } from './api';

const ok: ReadinessReport = { status: 'ok', checks: { database: 'up' }, timestamp: 't' };
const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('getApiStatus', () => {
  it('returns the report when the API is ready', async () => {
    await expect(getApiStatus('http://api', json(ok))).resolves.toEqual({
      reachable: true,
      report: ok,
    });
  });

  it('surfaces a 503 report (dependency down) as reachable', async () => {
    const down: ReadinessReport = { status: 'error', checks: { database: 'down' }, timestamp: 't' };
    const result = await getApiStatus('http://api', json(down, 503));
    expect(result).toEqual({ reachable: true, report: down });
  });

  it('reports unreachable instead of throwing on network failure', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(getApiStatus('http://api', failing)).resolves.toEqual({
      reachable: false,
      reason: 'ECONNREFUSED',
    });
  });

  it('reports unreachable on an unexpected response', async () => {
    const result = await getApiStatus('http://api', json({ nope: true }, 500));
    expect(result.reachable).toBe(false);
  });
});

describe('apiBaseUrl', () => {
  it('defaults and trims trailing slashes', () => {
    expect(apiBaseUrl({})).toBe('http://localhost:4000/api/v1');
    expect(apiBaseUrl({ API_BASE_URL: 'https://x.test/api/v1//' })).toBe('https://x.test/api/v1');
  });
});
