// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordForm } from './change-password-form';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(current: string, next: string) {
  const user = userEvent.setup();
  if (current) await user.type(screen.getByLabelText('Current password'), current);
  if (next) await user.type(screen.getByLabelText('New password'), next);
  await user.click(screen.getByRole('button', { name: /update password/i }));
}

describe('ChangePasswordForm', () => {
  it('validates both fields client-side without calling the API', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    render(<ChangePasswordForm />);
    await fill('', 'short');
    expect(await screen.findByText('Enter your password')).toBeTruthy();
    expect(screen.getByText('Use at least 10 characters')).toBeTruthy();
    expect(screen.getByLabelText('Current password').getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server’s field error on the current-password field and keeps the form usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              message: 'Validation failed',
              issues: [{ path: 'currentPassword', message: 'Your current password is incorrect' }],
            }),
            { status: 400 },
          ),
      ),
    );
    render(<ChangePasswordForm />);
    await fill('wrong-password', 'a-brand-new-passphrase-42');
    expect(await screen.findByText('Your current password is incorrect')).toBeTruthy();
    expect(screen.getByLabelText('Current password').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(/password updated/i)).toBeNull();
  });

  it('shows a rate-limit message on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ retryAfterSeconds: 600 }), { status: 429 }),
      ),
    );
    render(<ChangePasswordForm />);
    await fill('whatever-123', 'a-brand-new-passphrase-42');
    expect(await screen.findByText(/too many attempts.*10 minutes/i)).toBeTruthy();
  });

  it('posts both passwords, then confirms success and clears the fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ user: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ChangePasswordForm />);
    await fill('old-passphrase-123', 'a-brand-new-passphrase-42');
    await waitFor(() => expect(screen.getByText(/other devices were logged out/i)).toBeTruthy());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/password/change');
    expect(JSON.parse(String(init.body))).toEqual({
      currentPassword: 'old-passphrase-123',
      newPassword: 'a-brand-new-passphrase-42',
    });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });
});
