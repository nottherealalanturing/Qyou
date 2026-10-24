import { makeCategory, makeCity, makeLocation, makeTask } from './reference.js';
import { client, createUser, ownerPrisma, type TestContext, type TestUser } from './test-app.js';

type Api = ReturnType<typeof client>;
const as = (user: { token: string }) => ({ token: user.token });

let phoneCounter = 0;
/** A unique, valid Nigerian mobile number. */
export function uniquePhone(): string {
  phoneCounter += 1;
  return `0803${String(Date.now() % 1_000_000)
    .padStart(6, '0')
    .slice(-3)}${String(phoneCounter).padStart(4, '0')}`.slice(0, 11);
}

/** City + category + three tasks (one of each eligibility) — the minimum catalog an assistant needs. */
export async function makeCatalog() {
  const city = await makeCity({
    slug: `lagos-${phoneCounter}-${Date.now().toString(36)}`,
    name: `Lagos ${Date.now().toString(36)}`,
    state: `Lagos ${Math.random()}`,
  });
  const category = await makeCategory();
  const hold = await makeTask(category.id, { slug: 'hold', name: 'Hold your place', sortOrder: 1 });
  const docs = await makeTask(category.id, {
    slug: 'docs',
    name: 'Submit documents',
    sortOrder: 2,
    eligibility: 'REQUIRES_AUTHORIZATION',
    authorizationNotes: 'Signed letter.',
  });
  const bio = await makeTask(category.id, {
    slug: 'bio',
    name: 'Biometrics',
    sortOrder: 3,
    eligibility: 'NOT_DELEGABLE',
    requiresPersonalPresence: true,
    restrictionNotes: 'In person only.',
  });
  return { city, category, hold, docs, bio };
}
export type Catalog = Awaited<ReturnType<typeof makeCatalog>>;

export const PROFILE_BIO =
  'I have queued at banks and government offices in Lagos for years and I am punctual and honest.';

export interface Applicant {
  user: TestUser;
  profileId: string;
  slug: string;
  phone: string;
}

/** A verified customer who has started an application (DRAFT). */
export async function startApplication(api: Api, displayName = 'Ada O.'): Promise<Applicant> {
  const user = await createUser(api, { verified: true });
  const res = await api.post('/assistants/me', { displayName }, as(user)).expect(201);
  const profile = await ownerPrisma().assistantProfile.findUniqueOrThrow({
    where: { userId: user.id },
  });
  return { user, profileId: profile.id, slug: res.body.profile.slug, phone: '' };
}

/** Fills every onboarding section except phone verification. */
export async function completeProfile(
  api: Api,
  applicant: Applicant,
  catalog: Catalog,
  over: { phone?: string; legalName?: string } = {},
) {
  const phone = over.phone ?? uniquePhone();
  const token = as(applicant.user);
  await api
    .patch(
      '/assistants/me',
      { bio: PROFILE_BIO, languages: ['en', 'yo'], availabilityNote: 'Weekday mornings are best.' },
      token,
    )
    .expect(200);
  await api
    .put(
      '/assistants/me/services',
      { cityIds: [catalog.city.id], taskIds: [catalog.hold.id, catalog.docs.id] },
      token,
    )
    .expect(200);
  await api
    .put(
      '/assistants/me/availability',
      {
        windows: [
          { dayOfWeek: 1, start: '08:00', end: '12:00' },
          { dayOfWeek: 3, start: '13:00', end: '17:00' },
        ],
      },
      token,
    )
    .expect(200);
  await api
    .put('/assistants/me/private', { legalName: over.legalName ?? 'Adaeze Obi', phone }, token)
    .expect(200);
  applicant.phone = phone;
}

/** Requests a code and reads it from the simulated-SMS email, exactly as a developer would from Mailpit. */
export async function requestPhoneCode(
  ctx: TestContext,
  api: Api,
  applicant: Applicant,
): Promise<string> {
  const before = ctx.mail.sent.length;
  await api.post('/assistants/me/phone/code', {}, as(applicant.user)).expect(200);
  const mail = ctx.mail.sent.slice(before).find((m) => /SIMULATED SMS/.test(m.subject));
  const code = mail ? /code is (\d{6})/.exec(mail.text)?.[1] : undefined;
  if (!code) throw new Error('No simulated SMS captured');
  return code;
}

export async function verifyPhone(ctx: TestContext, api: Api, applicant: Applicant): Promise<void> {
  const code = await requestPhoneCode(ctx, api, applicant);
  await api.post('/assistants/me/phone/verify', { code }, as(applicant.user)).expect(200);
}

/** DRAFT → SUBMITTED with a complete profile and a verified phone. */
export async function submitted(
  ctx: TestContext,
  api: Api,
  catalog: Catalog,
  displayName?: string,
): Promise<Applicant> {
  const applicant = await startApplication(api, displayName);
  await completeProfile(api, applicant, catalog);
  await verifyPhone(ctx, api, applicant);
  await api.post('/assistants/me/submit', {}, as(applicant.user)).expect(200);
  return applicant;
}

export const move = (
  api: Api,
  admin: { token: string },
  profileId: string,
  to: string,
  reason?: string,
) =>
  api.post(
    `/admin/assistants/${profileId}/transitions`,
    { to, ...(reason ? { reason } : {}) },
    as(admin),
  );

export const recordIdentity = (
  api: Api,
  admin: { token: string },
  profileId: string,
  result = 'PASSED',
  extra: Record<string, unknown> = {},
) =>
  api.post(
    `/admin/assistants/${profileId}/identity-checks`,
    { result, evidenceRef: 'VID-2026-1042', notes: 'Checked by video call.', ...extra },
    as(admin),
  );

/** The full happy path: applied, verified, reviewed, identity passed, APPROVED. */
export async function approvedAssistant(
  ctx: TestContext,
  api: Api,
  admin: TestUser,
  catalog: Catalog,
  displayName?: string,
): Promise<Applicant> {
  const applicant = await submitted(ctx, api, catalog, displayName);
  await move(api, admin, applicant.profileId, 'UNDER_REVIEW').expect(200);
  await recordIdentity(api, admin, applicant.profileId).expect(201);
  await move(
    api,
    admin,
    applicant.profileId,
    'APPROVED',
    'Identity passed and profile is complete.',
  ).expect(200);
  return applicant;
}

export { makeLocation };
