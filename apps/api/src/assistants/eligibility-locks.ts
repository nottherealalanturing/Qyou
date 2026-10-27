import type { Prisma } from '../generated/prisma/client.js';

/**
 * The eligibility locking protocol (D-052). Quoting and quote selection DECIDE eligibility from
 * several rows; every mutation that can INVALIDATE that decision must conflict with them.
 *
 *   readers (quote submit, quote select)       writers (anything that can revoke eligibility)
 *   ------------------------------------       -------------------------------------------
 *   1. request row           FOR UPDATE        - assistant-scoped writers: `lockAssistantForChange`
 *   2. catalog rows          FOR SHARE            = the assistant's `users` row FOR NO KEY UPDATE
 *      (task, its category, city, venue)       - catalog writers: a plain UPDATE of the task /
 *   3. assistant `users` row FOR SHARE            category / city / venue row (implicit row lock),
 *                                                 or `lockVenueForChange` for restriction edits
 *
 * FOR SHARE conflicts with FOR NO KEY UPDATE / UPDATE, so a writer and a decision on the same
 * assistant (or catalog row) run one after the other. Readers do not conflict with each other
 * (FOR SHARE vs FOR SHARE), so unrelated quotes are not serialised. NO KEY UPDATE does not block
 * foreign-key inserts (sessions, quotes), so ordinary traffic is unaffected.
 *
 * The locks are taken BEFORE the eligibility reads and the transaction runs at PostgreSQL's
 * default READ COMMITTED level, where each statement sees everything committed so far. So after
 * the lock is held, `canServe` sees the latest committed state, and nothing that can revoke it can
 * commit until this transaction ends.
 *
 * Order: request → catalog (tasks+categories, cities, venues) → assistant user. Every writer takes
 * at most ONE of these locks before its own writes, so no cycle can form and no retry is needed.
 */
export interface EligibilityLockTarget {
  taskId: string;
  cityId: string;
  locationId: string | null;
}

/** Reader side: call after `lockRequest`, before `canServe`, in the same transaction. */
export async function lockForEligibilityDecision(
  tx: Prisma.TransactionClient,
  assistantUserId: string,
  target: EligibilityLockTarget,
): Promise<void> {
  await tx.$queryRaw`
    SELECT t."id" FROM "eligible_tasks" t
    JOIN "service_categories" c ON c."id" = t."categoryId"
    WHERE t."id" = ${target.taskId}::uuid
    FOR SHARE OF t, c`;
  await tx.$queryRaw`SELECT "id" FROM "cities" WHERE "id" = ${target.cityId}::uuid FOR SHARE`;
  if (target.locationId)
    await tx.$queryRaw`
      SELECT "id" FROM "service_locations" WHERE "id" = ${target.locationId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${assistantUserId}::uuid FOR SHARE`;
}

/**
 * Writer side: take this FIRST in any transaction that changes the user's role, the assistant
 * profile's status or identity outcome, phone verification (when revoked), service areas or offers.
 * Re-entrant within a transaction.
 */
export async function lockAssistantForChange(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
}

/** Writer side for venue restriction edits (they insert/delete child rows, not the venue row). */
export async function lockVenueForChange(
  tx: Prisma.TransactionClient,
  locationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "service_locations" WHERE "id" = ${locationId}::uuid FOR NO KEY UPDATE`;
}
