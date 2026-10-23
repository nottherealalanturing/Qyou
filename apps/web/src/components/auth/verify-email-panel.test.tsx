// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { VerifyEmailPanel } from './verify-email-panel';

const TOKEN = 'B'.repeat(43);

function renderStrict() {
  return render(
    <StrictMode>
      <VerifyEmailPanel />
    </StrictMode>,
  );
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('VerifyEmailPanel', () => {
  it('submits the fragment token exactly once (even under StrictMode) and strips it from the URL', async () => {
    window.history.replaceState(null, '', `/verify-email#token=${TOKEN}`);
    const fetchMock = mockFetch(200, { status: 'verified' });
    renderStrict();

    expect(await screen.findByText(/is verified|verified\. thank you/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/email-verification/confirm');
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('link', { name: /go to your account/i }).getAttribute('href')).toBe(
      '/account',
    );
  });

  it('shows a friendly message when the link was already used (idempotent replay)', async () => {
    window.history.replaceState(null, '', `/verify-email#token=${TOKEN}`);
    mockFetch(200, { status: 'already_verified' });
    renderStrict();
    expect(await screen.findByText(/already verified/i)).toBeTruthy();
  });

  it('shows the invalid-link state for a 400 response', async () => {
    window.history.replaceState(null, '', `/verify-email#token=${TOKEN}`);
    mockFetch(400, { statusCode: 400, message: 'x' });
    renderStrict();
    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
  });

  it('shows the invalid-link state, without calling the API, when there is no token', async () => {
    window.history.replaceState(null, '', '/verify-email');
    const fetchMock = mockFetch(200, {});
    renderStrict();
    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a retry after a server/network failure', async () => {
    window.history.replaceState(null, '', `/verify-email#token=${TOKEN}`);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('offline'))),
    );
    renderStrict();
    expect(await screen.findByText(/could not reach/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
