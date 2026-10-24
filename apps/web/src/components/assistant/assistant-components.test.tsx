// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Category, City, Task } from '@/lib/catalog';
import type { OwnDashboard } from '@/lib/assistants';
import { IdentityCheckForm, TransitionForm } from './admin-actions';
import { AssistantCard } from './assistant-card';
import { Checklist } from './checklist';
import { PrivateDetailsForm } from './private-details-form';
import { ProfileForm } from './profile-form';
import { ServicesForm, type CatalogForForm } from './services-form';
import { StatusBanner } from './status-banner';
import { SubmitPanel } from './submit-panel';

const refresh = vi.fn<() => void>();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn<() => void>() }),
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn<typeof fetch>(async (url, init) => handler(String(url), init ?? {}));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastBody = (fn: ReturnType<typeof mockFetch>) => {
  const call = fn.mock.calls.at(-1) as unknown as [string, RequestInit];
  return JSON.parse(String(call[1].body));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const city = (id: string, name: string): City => ({
  id,
  slug: name.toLowerCase(),
  name,
  state: name,
  latitude: 1,
  longitude: 1,
  timezone: 'Africa/Lagos',
  locationCount: 0,
});
const task = (
  id: string,
  name: string,
  eligibility: Task['eligibility'],
  restrictionNotes: string | null = null,
): Task => ({
  id,
  slug: id,
  name,
  description: 'd',
  kind: 'ERRAND',
  eligibility,
  requiresPersonalPresence: eligibility === 'NOT_DELEGABLE',
  requiresCredentials: false,
  authorizationNotes: eligibility === 'REQUIRES_AUTHORIZATION' ? 'Letter' : null,
  restrictionNotes,
});
const category: Category = {
  id: 'c1',
  slug: 'banks',
  name: 'Banks',
  description: 'd',
  iconKey: 'bank',
  taskCount: 3,
  locationCount: 0,
};
const catalog: CatalogForForm = {
  cities: [city('city-1', 'Lagos'), city('city-2', 'Kano')],
  categories: [
    {
      category,
      tasks: [
        task('t-hold', 'Hold your place', 'ELIGIBLE'),
        task('t-docs', 'Submit documents', 'REQUIRES_AUTHORIZATION'),
        task('t-bio', 'Biometrics', 'NOT_DELEGABLE', 'You must be there in person.'),
      ],
    },
  ],
};
const emptyServices: NonNullable<OwnDashboard['services']> = { cities: [], tasks: [] };

describe('ServicesForm', () => {
  it('shows non-delegable tasks disabled, with the reason, and never lets them be selected', async () => {
    render(<ServicesForm catalog={catalog} current={emptyServices} locked={false} />);
    const bio = screen.getByRole('checkbox', { name: /Biometrics/ }) as HTMLInputElement;
    expect(bio.disabled).toBe(true);
    expect(screen.getByText(/Can’t be offered: You must be there in person\./)).toBeTruthy();
    await userEvent.setup().click(bio);
    expect(bio.checked).toBe(false);
  });

  it('submits exactly the chosen cities and delegable tasks', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(<ServicesForm catalog={catalog} current={emptyServices} locked={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Lagos' }));
    await user.click(screen.getByRole('checkbox', { name: /Hold your place/ }));
    await user.click(screen.getByRole('checkbox', { name: /Submit documents/ }));
    await user.click(screen.getByRole('button', { name: /save services/i }));
    await waitFor(() => expect(screen.getByText('Services saved.')).toBeTruthy());
    expect(lastBody(fetchMock)).toEqual({ cityIds: ['city-1'], taskIds: ['t-hold', 't-docs'] });
    expect((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].method).toBe('PUT');
    expect(refresh).toHaveBeenCalled();
  });

  it('drops a stale offer (task no longer offered) from what it submits', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    const current: NonNullable<OwnDashboard['services']> = {
      cities: [{ id: 'city-1', slug: 'lagos', name: 'Lagos', active: true }],
      tasks: [
        {
          id: 't-hold',
          slug: 'hold',
          name: 'Hold',
          category: { slug: 'banks', name: 'Banks' },
          eligibility: 'ELIGIBLE',
          stillOffered: true,
        },
        {
          id: 't-old',
          slug: 'old',
          name: 'Old',
          category: { slug: 'banks', name: 'Banks' },
          eligibility: 'NOT_DELEGABLE',
          stillOffered: false,
        },
      ],
    };
    render(<ServicesForm catalog={catalog} current={current} locked={false} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /save services/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody(fetchMock).taskIds).toEqual(['t-hold']);
  });

  it('shows the API’s field error and disables everything when locked', async () => {
    mockFetch(() =>
      json(400, {
        message: 'Validation failed',
        issues: [
          {
            path: 'taskIds',
            message: 'Some selected tasks cannot be delegated, so they cannot be offered',
          },
        ],
      }),
    );
    render(<ServicesForm catalog={catalog} current={emptyServices} locked={false} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /save services/i }));
    expect(await screen.findByText(/cannot be delegated, so they cannot be offered/)).toBeTruthy();
    cleanup();
    render(<ServicesForm catalog={catalog} current={emptyServices} locked />);
    expect(
      (screen.getByRole('button', { name: /save services/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // A disabled <fieldset> disables its controls via the :disabled state (the input's own property stays false).
    expect(screen.getByRole('checkbox', { name: 'Lagos' }).matches(':disabled')).toBe(true);
  });
});

describe('ProfileForm edit scopes', () => {
  const profile = {
    slug: 'ada-1',
    displayName: 'Ada O.',
    bio: 'x'.repeat(60),
    languages: ['en'],
    availabilityNote: null,
    publicUrl: null,
  };

  it('after approval the display name is locked and is NOT sent', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(<ProfileForm profile={profile} editScope="limited" />);
    expect((screen.getByLabelText('Display name') as HTMLInputElement).disabled).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: /save profile/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toEqual({ bio: profile.bio, languages: ['en'] });
  });

  it('is fully read-only while the application is under review', () => {
    render(<ProfileForm profile={profile} editScope="none" />);
    expect(
      (screen.getByRole('button', { name: /save profile/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('About you') as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe('PrivateDetailsForm and phone verification', () => {
  const base = { legalName: 'Adaeze Obi', phone: '+2348031234567', phoneVerified: false };

  it('explains that the details are private, and offers verification only once a number is saved', () => {
    render(
      <PrivateDetailsForm
        details={{ legalName: null, phone: null, phoneVerified: false }}
        editScope="full"
        canVerifyPhone
      />,
    );
    expect(screen.getByText(/never shown on your profile/i)).toBeTruthy();
    expect(screen.getByText(/Save your mobile number first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send me a code/i })).toBeNull();
  });

  it('sends a code, labels the development transport honestly, and only enables Verify for six digits', async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith('/phone/code')
        ? json(200, {
            status: 'sent',
            transport: 'simulated-dev',
            expiresInSeconds: 600,
            resendAfterSeconds: 60,
          })
        : json(200, { status: 'verified' }),
    );
    render(<PrivateDetailsForm details={base} editScope="full" canVerifyPhone />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /send me a code/i }));
    expect(await screen.findByText(/no SMS was sent/i)).toBeTruthy();
    const verify = screen.getByRole('button', { name: /^verify$/i }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    await user.type(screen.getByLabelText('6-digit code'), '12ab34567');
    expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('123456'); // non-digits stripped, capped at six
    expect(verify.disabled).toBe(false);
    await user.click(verify);
    await waitFor(() => expect(lastBody(fetchMock)).toEqual({ code: '123456' }));
  });

  it('says plainly when no SMS provider is configured (503) instead of implying a message was sent', async () => {
    mockFetch(() =>
      json(503, {
        message: 'Phone verification is not available yet. We will let you know when it is',
      }),
    );
    render(<PrivateDetailsForm details={base} editScope="full" canVerifyPhone />);
    await userEvent.setup().click(screen.getByRole('button', { name: /send me a code/i }));
    expect(await screen.findByText(/not available yet/i)).toBeTruthy();
    expect(screen.queryByText(/we sent a 6-digit code/i)).toBeNull();
  });

  it('shows a wrong-code error on the code field, and a verified number as verified', async () => {
    mockFetch(() =>
      json(400, {
        message: 'Validation failed',
        issues: [{ path: 'code', message: 'That code is incorrect or has expired' }],
      }),
    );
    render(<PrivateDetailsForm details={base} editScope="full" canVerifyPhone />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByText('That code is incorrect or has expired')).toBeTruthy();
    cleanup();
    render(
      <PrivateDetailsForm
        details={{ ...base, phoneVerified: true }}
        editScope="limited"
        canVerifyPhone
      />,
    );
    expect(screen.getByText(/Number verified/)).toBeTruthy();
    expect((screen.getByLabelText('Legal name') as HTMLInputElement).disabled).toBe(true); // locked after approval
  });

  it('does not offer verification to rejected or suspended applications', () => {
    render(<PrivateDetailsForm details={base} editScope="none" canVerifyPhone={false} />);
    expect(screen.getByText(/isn’t available for this application/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send me a code/i })).toBeNull();
  });
});

describe('SubmitPanel', () => {
  const application = (
    over: Partial<NonNullable<OwnDashboard['application']>>,
  ): NonNullable<OwnDashboard['application']> => ({
    status: 'DRAFT',
    statusReason: null,
    statusChangedAt: '',
    submittedAt: null,
    approvedAt: null,
    editScope: 'full',
    canSubmit: false,
    missing: [],
    ...over,
  });

  it('lists what is missing and disables the button until the API says it can be submitted', () => {
    render(
      <SubmitPanel
        application={application({
          missing: [{ key: 'bio', message: 'Write a bio of at least 50 characters' }],
        })}
        emailVerified
      />,
    );
    expect(screen.getByText('Write a bio of at least 50 characters')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /submit for review/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('submits when allowed, and says resubmit after changes were requested', async () => {
    const fetchMock = mockFetch(() => json(200, {}));
    render(
      <SubmitPanel
        application={application({ status: 'CHANGES_REQUESTED', canSubmit: true })}
        emailVerified
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /resubmit for review/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/v1/assistants/me/submit',
    );
  });

  it('offers nothing to submit once the application is already with the reviewers', () => {
    render(<SubmitPanel application={application({ status: 'UNDER_REVIEW' })} emailVerified />);
    expect(screen.getByText('Nothing to submit right now.')).toBeTruthy();
  });
});

describe('admin actions', () => {
  it('requires a reason for decisions, posts {to, reason}, and confirms the audited decision', async () => {
    const fetchMock = mockFetch(() => json(200, { status: 'REJECTED' }));
    render(
      <TransitionForm
        id="p1"
        status="UNDER_REVIEW"
        allowed={['CHANGES_REQUESTED', 'APPROVED', 'REJECTED']}
      />,
    );
    expect(
      screen.getByText(/required, at least 10 characters; shown to the applicant/),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Decision'), 'REJECTED');
    await user.type(screen.getByLabelText(/Reason/), 'Identity could not be confirmed.');
    await user.click(screen.getByRole('button', { name: /record decision/i }));
    expect(await screen.findByText('Decision recorded and audited.')).toBeTruthy();
    expect(lastBody(fetchMock)).toEqual({
      to: 'REJECTED',
      reason: 'Identity could not be confirmed.',
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/v1/admin/assistants/p1/transitions',
    );
  });

  it('starting a review needs no reason; reconsidering a rejection does', () => {
    render(<TransitionForm id="p1" status="SUBMITTED" allowed={['UNDER_REVIEW']} />);
    expect(screen.getByText(/Reason \(optional\)/)).toBeTruthy();
    cleanup();
    render(<TransitionForm id="p1" status="REJECTED" allowed={['UNDER_REVIEW']} />);
    expect(screen.getByText(/required, at least 10 characters/)).toBeTruthy();
  });

  it('lists every approval blocker returned by the API', async () => {
    mockFetch(() =>
      json(409, {
        message: 'This application is not ready to be approved',
        blockers: [
          'The identity review has not passed',
          'The applicant has not verified their mobile number',
        ],
      }),
    );
    render(<TransitionForm id="p1" status="UNDER_REVIEW" allowed={['APPROVED']} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Reason/), 'All checks complete and passed.');
    await user.click(screen.getByRole('button', { name: /record decision/i }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('The identity review has not passed')).toBeTruthy();
    expect(
      within(alert).getByText('The applicant has not verified their mobile number'),
    ).toBeTruthy();
    expect(screen.queryByText('Decision recorded and audited.')).toBeNull();
  });

  it('clears stale approval blockers once the requirements change', async () => {
    mockFetch(() =>
      json(409, { message: 'Not ready', blockers: ['The identity review has not passed'] }),
    );
    const props = { id: 'p1', status: 'UNDER_REVIEW' as const, allowed: ['APPROVED' as const] };
    const { rerender } = render(<TransitionForm {...props} requirementsKey="identity" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Reason/), 'All checks complete and passed.');
    await user.click(screen.getByRole('button', { name: /record decision/i }));
    expect(await screen.findByText('The identity review has not passed')).toBeTruthy();
    rerender(<TransitionForm {...props} requirementsKey="" />);
    expect(screen.queryByText('The identity review has not passed')).toBeNull();
  });

  it('offers no decision when the application is in a state with none', () => {
    render(<TransitionForm id="p1" status="DRAFT" allowed={[]} />);
    expect(screen.getByText(/No decision is available/)).toBeTruthy();
  });

  it('identity form records an OUTCOME only, warns against documents, and surfaces ID-number rejection', async () => {
    const fetchMock = mockFetch(() =>
      json(400, {
        message: 'Validation failed',
        issues: [
          {
            path: 'notes',
            message:
              'Do not enter ID, card or phone numbers: record outcomes and opaque references only',
          },
        ],
      }),
    );
    render(<IdentityCheckForm id="p1" />);
    expect(screen.getByText(/stores no documents, photos or ID numbers/)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull(); // there is no way to upload evidence
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Notes/), 'NIN 12345678901');
    await user.click(screen.getByRole('button', { name: /record outcome/i }));
    expect(await screen.findByText(/Do not enter ID, card or phone numbers/)).toBeTruthy();
    expect(lastBody(fetchMock)).toEqual({
      result: 'PASSED',
      evidenceRef: null,
      notes: 'NIN 12345678901',
    });
  });
});

describe('static presentation', () => {
  it('status banner shows the reviewer’s message, and approved copy does not claim jobs exist', () => {
    const rejected = renderToStaticMarkup(
      <StatusBanner status="CHANGES_REQUESTED" reason="Please clarify your languages." />,
    );
    expect(rejected).toContain('Message from Qyou');
    expect(rejected).toContain('Please clarify your languages.');
    expect(renderToStaticMarkup(<StatusBanner status="APPROVED" reason={null} />)).toMatch(
      /once bookings open/,
    );
  });

  it('checklist reports progress accessibly', () => {
    const out = renderToStaticMarkup(
      <Checklist
        steps={[
          { key: 'email', label: 'Verify email', done: true, required: true },
          {
            key: 'identity',
            label: 'Identity review',
            done: false,
            required: true,
            detail: 'PENDING',
          },
        ]}
      />,
    );
    expect(out).toContain('1 of 2 steps complete');
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('not done yet');
    expect(out).toContain('pending');
  });

  it('assistant card renders only public information', () => {
    const out = renderToStaticMarkup(
      <AssistantCard
        assistant={{
          slug: 'ada-1',
          displayName: 'Ada O.',
          summary: 'Punctual.',
          languages: [{ code: 'en', name: 'English' }],
          cities: [{ slug: 'lagos', name: 'Lagos', state: 'Lagos' }],
          categories: [{ slug: 'banks', name: 'Banks', iconKey: 'bank' }],
        }}
      />,
    );
    expect(out).toContain('href="/assistants/ada-1"');
    expect(out).toContain('Ada O.');
    expect(out).toContain('Speaks English');
    expect(out).not.toMatch(/phone|email|legal|@/i);
  });
});
