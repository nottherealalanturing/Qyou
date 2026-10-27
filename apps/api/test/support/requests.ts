import type { AuditLog } from '../../src/generated/prisma/client.js';
import { approvedAssistant, type Applicant, type Catalog } from './assistants.js';
import { client, createUser, ownerPrisma, type TestContext, type TestUser } from './test-app.js';

type Api = ReturnType<typeof client>;
export const as = (user: { token: string }) => ({ token: user.token });

export const DESCRIPTION =
  'Please hold my place in the morning line at the Ikeja branch until I arrive.';

/** A valid request body for the catalog's delegable task, overridable field by field. */
export const requestBody = (catalog: Catalog, over: Record<string, unknown> = {}) => ({
  taskId: catalog.hold.id,
  cityId: catalog.city.id,
  description: DESCRIPTION,
  schedule: { kind: 'FLEXIBLE' },
  ...over,
});

export const quoteBody = (over: Record<string, unknown> = {}) => ({
  amountKobo: 250_000,
  message: 'I can be there from 7am and will stay until you arrive.',
  ...over,
});

export const customer = (api: Api) => createUser(api, { verified: true });

export const postRequest = (api: Api, user: TestUser, body: Record<string, unknown>) =>
  api.post('/service-requests', body, as(user));

/** Creates an OPEN request and returns its id. */
export async function openRequest(
  api: Api,
  owner: TestUser,
  catalog: Catalog,
  over: Record<string, unknown> = {},
): Promise<string> {
  const res = await postRequest(api, owner, requestBody(catalog, over)).expect(201);
  return res.body.request.id as string;
}

export const sendQuote = (
  api: Api,
  assistant: Applicant,
  requestId: string,
  over: Record<string, unknown> = {},
) => api.post(`/assistants/me/requests/${requestId}/quotes`, quoteBody(over), as(assistant.user));

export const selectQuote = (api: Api, owner: TestUser, requestId: string, quoteId: string) =>
  api.post(`/service-requests/${requestId}/quotes/${quoteId}/select`, {}, as(owner));

export const cancelRequest = (
  api: Api,
  owner: TestUser,
  requestId: string,
  body: Record<string, unknown> = {},
) => api.post(`/service-requests/${requestId}/cancel`, body, as(owner));

/** Everything a marketplace test needs: an admin, a catalog, and the helper to mint approved assistants. */
export async function newAssistant(
  ctx: TestContext,
  api: Api,
  admin: TestUser,
  catalog: Catalog,
  name = 'Ada O.',
): Promise<Applicant> {
  return approvedAssistant(ctx, api, admin, catalog, name);
}

export async function auditRows(action: string): Promise<AuditLog[]> {
  return ownerPrisma().auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
}

/** All audit rows, as one string, for "this secret never appears" assertions. */
export async function auditDump(): Promise<string> {
  const rows = await ownerPrisma().auditLog.findMany();
  return JSON.stringify(rows);
}

/** A date `days` from today as YYYY-MM-DD in UTC (safe for ON_DATE schedules ≤ 60 days away). */
export function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
