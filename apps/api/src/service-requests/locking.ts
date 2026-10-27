import type { Prisma, ServiceRequestStatus } from '../generated/prisma/client.js';

export interface LockedRequest {
  id: string;
  customerId: string;
  status: ServiceRequestStatus;
  expiresAt: Date;
  taskId: string;
  cityId: string;
  locationId: string | null;
}

/**
 * Takes a row lock on the request for the rest of the transaction and returns its CURRENT state.
 * Every submit / withdraw / select / cancel starts here, so two concurrent actions on one request
 * run one after the other and the second sees what the first did. Returns `null` when the id does
 * not exist (the caller decides whether that is a 404).
 */
export async function lockRequest(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<LockedRequest | null> {
  const rows = await tx.$queryRaw<LockedRequest[]>`
    SELECT "id", "customerId", "status"::text AS "status", "expiresAt", "taskId", "cityId", "locationId"
    FROM "service_requests"
    WHERE "id" = ${id}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}
