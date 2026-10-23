// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogoutEverywhere } from './logout-everywhere';

const replace = vi.fn<(path: string) => void>();
const refresh = vi.fn<() => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
  refresh.mockReset();
});

describe('LogoutEverywhere', () => {
  it('asks for confirmation first and does nothing until confirmed', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    render(<LogoutEverywhere />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /log out of all devices/i }));
    expect(screen.getByText(/ends every session, including this one/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /log out of all devices/i })).toBeTruthy();
  });

  it('calls the API, then sends the user to the login page', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LogoutEverywhere />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /log out of all devices/i }));
    await user.click(screen.getByRole('button', { name: /yes, log out everywhere/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/auth/logout-all');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows an error and stays on the page when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 500 })),
    );
    render(<LogoutEverywhere />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /log out of all devices/i }));
    await user.click(screen.getByRole('button', { name: /yes, log out everywhere/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
