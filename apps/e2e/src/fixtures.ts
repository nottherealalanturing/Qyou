import { call, ok, register, type Account } from './api.js';
import { db, resetRateLimits } from './db.js';
import { PASSWORD } from './env.js';

let counter = 0;
/** Short, unique-per-process suffix so fixtures made in one run never collide. */
export const uid = () => `${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export interface Catalog {
  cityA: { id: string; slug: string; name: string };
  cityB: { id: string; slug: string; name: string };
  category: { id: string; slug: string; name: string };
  hold: { id: string; slug: string; name: string };
  docs: { id: string; slug: string; name: string };
  bio: { id: string; slug: string; name: string };
  venue: { id: string; slug: string; name: string; address: string };
}

/**
 * City A + City B, one category, three tasks (eligible / needs authorization / not delegable) and an
 * approved venue in City A. Inserted as the DB owner: reference data is administered through an
 * admin API the suite is not about, and ids/updatedAt have no database defaults (Prisma sets them).
 */
export async function seedCatalog(): Promise<Catalog> {
  const u = uid();
  const city = async (name: string, state: string) => {
    const slug = `${name.toLowerCase()}-${u}`;
    const { rows } = await db().query(
      `INSERT INTO cities (id, slug, name, state, latitude, longitude, timezone, "isActive", "sortOrder", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 6.5244, 3.3792, 'Africa/Lagos', true, 0, now())
       RETURNING id`,
      [slug, `${name} ${u}`, `${state} ${u}`],
    );
    return { id: rows[0].id as string, slug, name: `${name} ${u}` };
  };
  const cityA = await city('Lagos', 'Lagos State');
  const cityB = await city('Abuja', 'FCT');

  const categoryName = `Banking ${u}`;
  const categorySlug = `banking-${u}`;
  const cat = await db().query(
    `INSERT INTO service_categories (id, slug, name, "nameKey", description, "iconKey", "isActive", "sortOrder", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'Branch and counter queues.', 'landmark', true, 0, now())
     RETURNING id`,
    [categorySlug, categoryName, categoryName.toLowerCase()],
  );
  const category = { id: cat.rows[0].id as string, slug: categorySlug, name: categoryName };

  const task = async (
    slug: string,
    name: string,
    eligibility: 'ELIGIBLE' | 'REQUIRES_AUTHORIZATION' | 'NOT_DELEGABLE',
    sortOrder: number,
  ) => {
    const full = `${name} ${u}`;
    const { rows } = await db().query(
      `INSERT INTO eligible_tasks (id, "categoryId", slug, name, "nameKey", description, kind, eligibility,
         "requiresPersonalPresence", "requiresCredentials", "authorizationNotes", "restrictionNotes", "isActive", "sortOrder", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'A task used by the browser tests.', 'QUEUE_HOLDING', $5::"TaskEligibility",
         $6, false, $7, $8, true, $9, now())
       RETURNING id`,
      [
        category.id,
        `${slug}-${u}`,
        full,
        full.toLowerCase(),
        eligibility,
        eligibility === 'NOT_DELEGABLE',
        eligibility === 'REQUIRES_AUTHORIZATION' ? 'A signed letter is needed.' : null,
        eligibility === 'NOT_DELEGABLE' ? 'In person only.' : null,
        sortOrder,
      ],
    );
    return { id: rows[0].id as string, slug: `${slug}-${u}`, name: full };
  };
  const hold = await task('hold', 'Hold my place', 'ELIGIBLE', 1);
  const docs = await task('docs', 'Submit my documents', 'REQUIRES_AUTHORIZATION', 2);
  const bio = await task('bio', 'Biometric capture', 'NOT_DELEGABLE', 3);

  const venueName = `Ikeja Branch ${u}`;
  const venueSlug = `ikeja-branch-${u}`;
  const address = `${u} Allen Avenue`;
  const loc = await db().query(
    `INSERT INTO service_locations (id, "cityId", "categoryId", slug, name, address, status, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'APPROVED', now()) RETURNING id`,
    [cityA.id, category.id, venueSlug, venueName, address],
  );
  const venue = { id: loc.rows[0].id as string, slug: venueSlug, name: venueName, address };
  return { cityA, cityB, category, hold, docs, bio, venue };
}

/** A real account created through the registration API, with its email marked verified. */
export async function createCustomer(name = 'Chidi Customer'): Promise<Account> {
  await resetRateLimits();
  const account = await register(`customer-${uid()}@example.test`, name);
  await db().query('UPDATE users SET "emailVerifiedAt" = now() WHERE id = $1', [account.id]);
  return account;
}

export async function createAdmin(): Promise<Account> {
  await resetRateLimits();
  const account = await register(`admin-${uid()}@example.test`, 'Ops Admin');
  await db().query(`UPDATE users SET role = 'ADMIN', "emailVerifiedAt" = now() WHERE id = $1`, [
    account.id,
  ]);
  return account;
}

export interface Assistant {
  account: Account;
  profileId: string;
  slug: string;
  displayName: string;
  legalName: string;
  phone: string;
}

export interface AssistantOptions {
  displayName: string;
  cityIds: string[];
  taskIds: string[];
  /** Stop before approval to produce an applicant who must not be able to quote. */
  stopAt?: 'DRAFT' | 'APPROVED';
}

let phoneCounter = 0;

/**
 * An assistant onboarded through the REAL application workflow (draft → profile → services →
 * availability → private details → submit → admin review → identity outcome → approval). Only the
 * two things that need an external provider are set directly in the database, exactly as the API
 * e2e suite does: email verification and phone ownership (no real SMS in tests).
 */
export async function createApprovedAssistant(
  admin: Account,
  options: AssistantOptions,
): Promise<Assistant> {
  await resetRateLimits();
  const account = await register(`assistant-${uid()}@example.test`, options.displayName);
  await db().query('UPDATE users SET "emailVerifiedAt" = now() WHERE id = $1', [account.id]);
  const t = account.token;
  await ok(201, 'POST', '/assistants/me', { displayName: options.displayName }, t);
  const profile = await db().query('SELECT id, slug FROM assistant_profiles WHERE "userId" = $1', [
    account.id,
  ]);
  const profileId = profile.rows[0].id as string;
  const slug = profile.rows[0].slug as string;

  phoneCounter += 1;
  const phone = `0803${String(Date.now() % 1000).padStart(3, '0')}${String(phoneCounter).padStart(4, '0')}`;
  const legalName = `Private Legalname${phoneCounter}`;
  await ok(
    200,
    'PATCH',
    '/assistants/me',
    {
      bio: 'I have queued at banks and government offices in Lagos for years and I am punctual and honest.',
      languages: ['en', 'yo'],
      availabilityNote: 'Weekday mornings are best.',
    },
    t,
  );
  await ok(
    200,
    'PUT',
    '/assistants/me/services',
    { cityIds: options.cityIds, taskIds: options.taskIds },
    t,
  );
  await ok(
    200,
    'PUT',
    '/assistants/me/availability',
    { windows: [{ dayOfWeek: 1, start: '08:00', end: '12:00' }] },
    t,
  );
  await ok(200, 'PUT', '/assistants/me/private', { legalName, phone }, t);
  await db().query(
    `UPDATE assistant_private_details SET "phoneVerifiedAt" = now() WHERE "profileId" = $1`,
    [profileId],
  );
  const result: Assistant = {
    account,
    profileId,
    slug,
    displayName: options.displayName,
    legalName,
    phone,
  };
  if (options.stopAt === 'DRAFT') return result;

  await ok(200, 'POST', '/assistants/me/submit', {}, t);
  await ok(
    200,
    'POST',
    `/admin/assistants/${profileId}/transitions`,
    { to: 'UNDER_REVIEW' },
    admin.token,
  );
  await ok(
    201,
    'POST',
    `/admin/assistants/${profileId}/identity-checks`,
    { result: 'PASSED', evidenceRef: 'VID-E2E-1', notes: 'Checked by video call.' },
    admin.token,
  );
  await ok(
    200,
    'POST',
    `/admin/assistants/${profileId}/transitions`,
    { to: 'APPROVED', reason: 'Identity passed and profile is complete.' },
    admin.token,
  );
  return result;
}

/** Suspends an approved assistant through the admin API (the real review workflow). */
export async function suspend(admin: Account, assistant: Assistant): Promise<void> {
  await ok(
    200,
    'POST',
    `/admin/assistants/${assistant.profileId}/transitions`,
    { to: 'SUSPENDED', reason: 'Suspended while we investigate.' },
    admin.token,
  );
}

export const DESCRIPTION =
  'Please hold my place in the morning line at the Ikeja branch until I arrive.';

/** Posts a request through the real API as `owner`; returns its id. */
export async function postRequest(
  owner: Account,
  catalog: Catalog,
  over: Record<string, unknown> = {},
): Promise<string> {
  const res = await ok(
    201,
    'POST',
    '/service-requests',
    {
      taskId: catalog.hold.id,
      cityId: catalog.cityA.id,
      description: DESCRIPTION,
      schedule: { kind: 'FLEXIBLE' },
      ...over,
    },
    owner.token,
  );
  return res.body.request.id as string;
}

/** Submits a quote through the real API as `assistant`; returns its id. */
export async function postQuote(
  assistant: Assistant,
  requestId: string,
  amountKobo: number,
  message = 'I can be there from 7am and stay until you arrive.',
): Promise<string> {
  const res = await ok(
    201,
    'POST',
    `/assistants/me/requests/${requestId}/quotes`,
    { amountKobo, message },
    assistant.account.token,
  );
  return res.body.quote.id as string;
}

/**
 * A request whose expiry has already passed. Requests cannot be edited (a database trigger), and
 * the server clock cannot be faked from a browser, so the row is INSERTED already expired, as the
 * DB owner, with creation dated in the past so every CHECK constraint still holds.
 */
export async function insertExpiredRequest(
  owner: Account,
  catalog: Catalog,
  description = 'An old request that nobody answered in time.',
): Promise<string> {
  const { rows } = await db().query(
    `INSERT INTO service_requests (id, "customerId", "taskId", "cityId", description, "scheduleKind",
       "expiresAt", "createdAt", "updatedAt", "statusChangedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'FLEXIBLE'::"ScheduleKind",
       now() - interval '1 day', now() - interval '15 days', now() - interval '15 days', now() - interval '15 days')
     RETURNING id`,
    [owner.id, catalog.hold.id, catalog.cityA.id, description],
  );
  return rows[0].id as string;
}

export { call, PASSWORD };

/**
 * A pending quote on a request that has ALREADY expired. The API refuses this (correctly), so the
 * state is only reachable by a quote that was sent before expiry; the row is inserted as the DB owner.
 */
export async function insertQuoteRow(
  assistant: Assistant,
  requestId: string,
  amountKobo: number,
  message = 'I sent this before the request expired.',
): Promise<string> {
  const { rows } = await db().query(
    `INSERT INTO quotes (id, "requestId", "assistantId", "amountKobo", message, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now()) RETURNING id`,
    [requestId, assistant.profileId, amountKobo, message],
  );
  return rows[0].id as string;
}
