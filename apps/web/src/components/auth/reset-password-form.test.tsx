// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { ResetPasswordForm } from './reset-password-form';

const TOKEN = 'A'.repeat(43);

function renderStrict() {
  return render(
    <StrictMode>
      <ResetPasswordForm />
    </StrictMode>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('ResetPasswordForm', () => {
  it('reads the token from the fragment under StrictMode and removes it from the URL', async () => {
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);
    renderStrict();
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(screen.queryByText(/invalid or has expired/i)).toBeNull();
  });

  it('shows the invalid-link state with a way to request a new one when there is no token', async () => {
    window.history.replaceState(null, '', '/reset-password');
    renderStrict();
    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /request a new link/i }).getAttribute('href')).toBe(
      '/forgot-password',
    );
  });

  it('blocks a short password client-side without calling the API', async () => {
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    renderStrict();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByText('Use at least 10 characters')).toBeTruthy();
    expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits the token and new password, then shows success', async () => {
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderStrict();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'a-brand-new-passphrase-42');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(screen.getByText(/password has been updated/i)).toBeTruthy());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/password-reset/confirm');
    expect(JSON.parse(String(init.body))).toEqual({
      token: TOKEN,
      password: 'a-brand-new-passphrase-42',
    });
  });

  it('turns an API 400 for the token into the request-a-new-link state', async () => {
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ statusCode: 400, message: 'x' }), { status: 400 }),
      ),
    );
    renderStrict();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'a-brand-new-passphrase-42');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
  });
});
