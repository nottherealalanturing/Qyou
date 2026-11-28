// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterForm } from './register-form';

const SENT = 'Thanks. Check your inbox for an email from Qyou with what to do next. Then log in.';

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fill(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RegisterForm (enumeration-safe, D-056)', () => {
  it('shows one "check your email" panel with the API message and does not sign the user in', async () => {
    const fetchMock = mockFetch(202, { message: SENT });
    render(<RegisterForm />);
    await fill('ada@example.test');

    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText(SENT)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to log in' }).getAttribute('href')).toBe('/login');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/register');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      password: 'correct-horse-battery-staple',
    });
  });

  it('renders exactly the same page for any address, because the API answers the same', async () => {
    const texts: string[] = [];
    for (const email of ['new@example.test', 'already-registered@example.test']) {
      mockFetch(202, { message: SENT });
      const { container, unmount } = render(<RegisterForm />);
      await fill(email);
      await screen.findByText('Check your email');
      texts.push(container.innerHTML);
      expect(container.textContent).not.toContain(email);
      expect(container.textContent).not.toMatch(/already|exists|taken|registered|log in instead/i);
      unmount();
      cleanup();
    }
    expect(texts[0]).toBe(texts[1]);
  });

  it('has no status-specific wording left for a taken address', async () => {
    // Even if a (legacy) 409 arrived, nothing about the address is claimed.
    mockFetch(409, { message: 'Something unexpected' });
    render(<RegisterForm />);
    await fill('ada@example.test');
    await waitFor(() => expect(screen.getByText('Something unexpected')).toBeTruthy());
    expect(screen.queryByText(/already registered|already exists/i)).toBeNull();
  });

  it('shows field messages for invalid input and a retry hint when rate limited', async () => {
    mockFetch(400, {
      message: 'Validation failed',
      issues: [
        {
          path: 'password',
          message: 'That password is too common. Choose something harder to guess',
        },
      ],
    });
    const first = render(<RegisterForm />);
    await fill('ada@example.test');
    expect(await screen.findByText(/too common/)).toBeTruthy();
    first.unmount();
    cleanup();

    mockFetch(429, { retryAfterSeconds: 120 });
    render(<RegisterForm />);
    await fill('ada@example.test');
    expect(
      await screen.findByText(/Too many attempts\. Try again in about 2 minutes/),
    ).toBeTruthy();
  });

  it('validates locally without calling the API', async () => {
    const fetchMock = mockFetch(202, { message: SENT });
    render(<RegisterForm />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create account' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
