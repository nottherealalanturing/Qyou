// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogTree } from '@/lib/catalog-tree';
import type { Task } from '@/lib/catalog';
import type { OwnerQuote, RequestView } from '@/lib/requests';
import { NewRequestForm, type VenueForForm } from './new-request-form';
import { CancelRequestForm, SelectQuoteButton } from './quote-actions';
import { QuoteForm, WithdrawQuoteButton } from './quote-form';
import { RequestFacts, RequestRow, StatusPill } from './request-summary';

const push = vi.fn<(path: string) => void>();
const refresh = vi.fn<() => void>();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn<() => void>() }),
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn<typeof fetch>(async (url, init) => handler(String(url), init ?? {}));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastCall = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.at(-1) as unknown as [string, RequestInit];
const lastBody = (fn: ReturnType<typeof mockFetch>) => JSON.parse(String(lastCall(fn)[1].body));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

const task = (id: string, name: string, eligibility: Task['eligibility']): Task => ({
  id,
  slug: id,
  name,
  description: 'd',
  kind: 'QUEUE_HOLDING',
  eligibility,
  requiresPersonalPresence: false,
  requiresCredentials: false,
  authorizationNotes: eligibility === 'REQUIRES_AUTHORIZATION' ? 'A signed letter from you.' : null,
  restrictionNotes: eligibility === 'NOT_DELEGABLE' ? 'In person only.' : null,
});
const catalog: CatalogTree = {
  cities: [
    {
      id: 'city-1',
      slug: 'lagos',
      name: 'Lagos',
      state: 'Lagos',
      latitude: 1,
      longitude: 1,
      timezone: 'Africa/Lagos',
      locationCount: 0,
    },
  ],
  categories: [
    {
      category: {
        id: 'cat-1',
        slug: 'banks',
        name: 'Banks',
        description: 'd',
        iconKey: 'bank',
        taskCount: 3,
        locationCount: 0,
      },
      tasks: [
        task('hold', 'Hold your place', 'ELIGIBLE'),
        task('docs', 'Submit documents', 'REQUIRES_AUTHORIZATION'),
        task('bio', 'Biometrics', 'NOT_DELEGABLE'),
      ],
    },
  ],
};
const created = { request: { id: 'req-123' }, quotes: [] };

async function fillBasics(user: ReturnType<typeof userEvent.setup>, taskName = 'Hold your place') {
  await user.selectOptions(screen.getByLabelText('City'), 'city-1');
  await user.selectOptions(screen.getByLabelText('What do you need done?'), taskName);
  await user.type(
    screen.getByLabelText('Describe the job'),
    'Hold my place in the morning line please.',
  );
}

describe('NewRequestForm', () => {
  it('never offers a non-delegable task', () => {
    render(<NewRequestForm catalog={catalog} venue={null} today="2026-10-24" initial={{}} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Hold your place');
    expect(options).toContain('Submit documents');
    expect(options).not.toContain('Biometrics');
  });

  it('posts a flexible request and goes to the new request page', async () => {
    const fetchMock = mockFetch(() => json(201, created));
    render(<NewRequestForm catalog={catalog} venue={null} today="2026-10-24" initial={{}} />);
    const user = userEvent.setup();
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: 'Post request' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/requests/req-123'));
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/service-requests');
    expect(lastBody(fetchMock)).toEqual({
      taskId: 'hold',
      cityId: 'city-1',
      description: 'Hold my place in the morning line please.',
      schedule: { kind: 'FLEXIBLE' },
    });
  });

  it('shows the authorization checkbox only for tasks that need it and sends the confirmation', async () => {
    const fetchMock = mockFetch(() => json(201, created));
    render(<NewRequestForm catalog={catalog} venue={null} today="2026-10-24" initial={{}} />);
    const user = userEvent.setup();
    await fillBasics(user);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.selectOptions(screen.getByLabelText('What do you need done?'), 'Submit documents');
    expect(screen.getByText('A signed letter from you.')).toBeTruthy();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Post request' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toMatchObject({ taskId: 'docs', confirmsAuthorization: true });
  });

  it('sends a dated schedule with the chosen time of day and restricts the date picker to today onwards', async () => {
    const fetchMock = mockFetch(() => json(201, created));
    render(<NewRequestForm catalog={catalog} venue={null} today="2026-10-24" initial={{}} />);
    const user = userEvent.setup();
    await fillBasics(user);
    await user.click(screen.getByLabelText('On a specific day'));
    expect(screen.getByLabelText('Day').getAttribute('min')).toBe('2026-10-24');
    await user.type(screen.getByLabelText('Day'), '2026-10-30');
    await user.selectOptions(screen.getByLabelText('Time of day'), 'Morning');
    await user.click(screen.getByRole('button', { name: 'Post request' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(lastBody(fetchMock).schedule).toEqual({
      kind: 'ON_DATE',
      date: '2026-10-30',
      period: 'MORNING',
    });
  });

  it('does not call the API without a task, and shows API field errors without navigating', async () => {
    const fetchMock = mockFetch(() =>
      json(400, {
        message: 'Validation failed',
        issues: [{ path: 'description', message: 'Please remove phone numbers, email addresses.' }],
      }),
    );
    render(<NewRequestForm catalog={catalog} venue={null} today="2026-10-24" initial={{}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Post request' }));
    expect(await screen.findByText('Choose what you need done.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: 'Post request' }));
    expect(await screen.findByText(/Please remove phone numbers/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('at a venue: sends locationId (not cityId) and lists only tasks the venue allows', async () => {
    const venue: VenueForForm = {
      id: 'venue-1',
      name: 'Ikeja Branch',
      address: '1 Test Street',
      city: { slug: 'lagos', name: 'Lagos', state: 'Lagos' },
      category: { slug: 'banks', name: 'Banks' },
      tasks: [
        {
          ...task('hold', 'Hold your place', 'ELIGIBLE'),
          effectiveEligibility: 'NOT_DELEGABLE',
          venueNotes: [{ rule: 'PROHIBITED', note: 'No line holding here.' }],
        },
        {
          ...task('docs', 'Submit documents', 'REQUIRES_AUTHORIZATION'),
          effectiveEligibility: 'REQUIRES_AUTHORIZATION',
          venueNotes: [],
        },
      ],
    };
    const fetchMock = mockFetch(() => json(201, created));
    render(<NewRequestForm catalog={catalog} venue={venue} today="2026-10-24" initial={{}} />);
    expect(screen.getByText('Ikeja Branch')).toBeTruthy();
    expect(screen.queryByLabelText('City')).toBeNull();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Hold your place');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('What do you need done?'), 'Submit documents');
    await user.type(
      screen.getByLabelText('Describe the job'),
      'Submit my prepared documents please.',
    );
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Post request' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = lastBody(fetchMock);
    expect(body).toMatchObject({
      taskId: 'docs',
      locationId: 'venue-1',
      confirmsAuthorization: true,
    });
    expect(body).not.toHaveProperty('cityId');
  });

  it('warns that contact details are not allowed and that nothing is charged', () => {
    render(<NewRequestForm catalog={catalog} venue={null} today="2026-10-24" initial={{}} />);
    expect(
      screen.getByText(/Don’t include phone numbers, email addresses, links or ID numbers/),
    ).toBeTruthy();
    expect(screen.getByText(/nothing is charged/i)).toBeTruthy();
  });
});

const quote = (over: Partial<OwnerQuote> = {}): OwnerQuote => ({
  id: 'q1',
  status: 'PENDING',
  amountKobo: 250_050,
  currency: 'NGN',
  message: null,
  createdAt: '2026-10-24T10:00:00.000Z',
  selectable: true,
  assistant: { displayName: 'Ada O.', slug: 'ada-1', languages: [{ code: 'en', name: 'English' }] },
  ...over,
});

describe('SelectQuoteButton', () => {
  it('asks for confirmation, says nothing is charged, then posts the selection', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(<SelectQuoteButton requestId="r1" quote={quote()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Accept this quote/ }));
    expect(fetchMock).not.toHaveBeenCalled(); // one click is not enough
    expect(screen.getByText(/₦2,500\.50/)).toBeTruthy();
    expect(screen.getByText(/Nothing is charged/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Yes, accept' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/service-requests/r1/quotes/q1/select');
    expect(lastCall(fetchMock)[1].method).toBe('POST');
  });

  it('shows the API’s conflict message and returns to the first step', async () => {
    mockFetch(() => json(409, { message: 'A quote has already been accepted for this request' }));
    render(<SelectQuoteButton requestId="r1" quote={quote()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Accept this quote/ }));
    await user.click(screen.getByRole('button', { name: 'Yes, accept' }));
    expect(await screen.findByRole('button', { name: /Accept this quote/ })).toBeTruthy();
  });
});

describe('CancelRequestForm', () => {
  it('makes the reason optional before acceptance and posts it when given', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(<CancelRequestForm requestId="r1" status="QUOTED" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel this request' }));
    expect(screen.getByText(/Reason \(optional\)/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Reason/), 'No longer needed.');
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/service-requests/r1/cancel');
    expect(lastBody(fetchMock)).toEqual({ reason: 'No longer needed.' });
  });

  it('sends no reason at all when the box holds only whitespace (the API decides, never the client)', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(<CancelRequestForm requestId="r1" status="QUOTED" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel this request' }));
    await user.type(screen.getByLabelText(/Reason/), '   ');
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toEqual({});
  });

  it('says the reason is required after a quote was accepted and surfaces the API error', async () => {
    mockFetch(() =>
      json(400, {
        message: 'Validation failed',
        issues: [{ path: 'reason', message: 'Say why you are cancelling after accepting a quote' }],
      }),
    );
    render(<CancelRequestForm requestId="r1" status="QUOTE_ACCEPTED" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel this request' }));
    expect(screen.getByText(/required: an assistant was chosen/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText(/Say why you are cancelling/)).toBeTruthy();
  });
});

describe('QuoteForm', () => {
  it('converts naira to whole kobo exactly and sends NGN', async () => {
    const fetchMock = mockFetch(() => json(201, {}));
    render(<QuoteForm requestId="r1" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your price (₦)'), '2,500.50');
    expect(screen.getByText('You will be quoting ₦2,500.50.')).toBeTruthy();
    await user.type(screen.getByLabelText(/Message/), 'I can be there from 7am.');
    await user.click(screen.getByRole('button', { name: 'Send quote' }));
    expect(await screen.findByText('Quote sent.')).toBeTruthy();
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/assistants/me/requests/r1/quotes');
    expect(lastBody(fetchMock)).toEqual({
      amountKobo: 250_050,
      currency: 'NGN',
      message: 'I can be there from 7am.',
    });
  });

  it('rejects bad amounts locally without calling the API', async () => {
    const fetchMock = mockFetch(() => json(201, {}));
    render(<QuoteForm requestId="r1" />);
    const user = userEvent.setup();
    for (const [typed, message] of [
      ['', /Enter your price/],
      ['abc', /like 2500/],
      ['50', /minimum quote/],
      ['600000', /maximum quote/],
    ] as const) {
      const input = screen.getByLabelText('Your price (₦)');
      await user.clear(input);
      if (typed) await user.type(input, typed);
      await user.click(screen.getByRole('button', { name: 'Send quote' }));
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an assistant who is no longer eligible (403)',
      403,
      { code: 'ASSISTANT_NOT_ELIGIBLE', message: 'You cannot accept paid jobs yet', reasons: [] },
      /not currently eligible/,
    ],
    ['a session that ended (401)', 401, {}, /log in again/],
    [
      'a request that closed or changed (404)',
      404,
      { message: 'Request not found' },
      /could not find that/,
    ],
    ['a server failure (500)', 500, { message: 'ECONNREFUSED 10.0.0.5:5432' }, /on our side/],
  ])('gives clear, safe feedback for %s', async (_name, status, body, expected) => {
    mockFetch(() => json(status, body));
    render(<QuoteForm requestId="r1" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your price (₦)'), '2500');
    await user.click(screen.getByRole('button', { name: 'Send quote' }));
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.queryByText(/blocked/)).toBeNull();
    expect(screen.queryByText(/ECONNREFUSED|10\.0\.0\.5/)).toBeNull();
  });

  it('shows the API’s message for conflicts (e.g. a duplicate quote)', async () => {
    mockFetch(() => json(409, { message: 'You already have an active quote on this request' }));
    render(<QuoteForm requestId="r1" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your price (₦)'), '2500');
    await user.click(screen.getByRole('button', { name: 'Send quote' }));
    expect(await screen.findByText(/already have an active quote/)).toBeTruthy();
  });
});

describe('WithdrawQuoteButton', () => {
  it('posts the withdrawal', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(<WithdrawQuoteButton quoteId="q9" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Withdraw quote' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/assistants/me/quotes/q9/withdraw');
  });
});

const request = (over: Partial<RequestView> = {}): RequestView => ({
  id: 'r1',
  status: 'QUOTED',
  acceptingQuotes: true,
  task: { slug: 'hold', name: 'Hold your place', category: { slug: 'banks', name: 'Banks' } },
  city: { slug: 'lagos', name: 'Lagos', state: 'Lagos' },
  location: null,
  description: 'Hold my place please.',
  constraints: 'Bring a stool.',
  schedule: { kind: 'ON_DATE', date: '2026-10-31', period: 'MORNING' },
  authorization: { required: false, confirmed: false, notes: null },
  pendingQuoteCount: 2,
  expiresAt: '2026-10-31T23:00:00.000Z',
  createdAt: '2026-10-24T10:00:00.000Z',
  acceptedAt: null,
  closedAt: null,
  closureReason: null,
  ...over,
});

describe('request summary', () => {
  it('renders the facts and the schedule in words', () => {
    const out = renderToStaticMarkup(<RequestFacts request={request()} />);
    expect(out).toContain('Hold your place');
    expect(out).toContain('Saturday, 31 October 2026, morning');
    expect(out).toContain('Bring a stool.');
  });

  it('labels every status honestly, including expired', () => {
    for (const [status, label] of [
      ['OPEN', 'Open for quotes'],
      ['QUOTED', 'Quotes received'],
      ['QUOTE_ACCEPTED', 'Quote accepted'],
      ['CANCELLED', 'Cancelled'],
      ['EXPIRED', 'Expired'],
    ] as const)
      expect(renderToStaticMarkup(<StatusPill status={status} />)).toContain(label);
  });

  it('shows waiting quotes on a live request but not on a cancelled one', () => {
    expect(renderToStaticMarkup(<RequestRow request={request()} href="/requests/r1" />)).toContain(
      '2 quotes waiting',
    );
    expect(
      renderToStaticMarkup(
        <RequestRow request={request({ status: 'CANCELLED' })} href="/requests/r1" />,
      ),
    ).not.toContain('waiting');
  });
});
