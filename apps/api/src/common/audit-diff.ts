export interface FieldChanges {
  [field: string]: { from: unknown; to: unknown };
}

/**
 * Computes the fields of `patch` that actually differ from `current`. Used so updates write (and
 * audit) only real changes, and a PATCH that changes nothing is a harmless no-op.
 */
export function changedFields<T extends object>(current: T, patch: Partial<T>): FieldChanges {
  const changes: FieldChanges = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    const from = (current as Record<string, unknown>)[key];
    if (!Object.is(from, to) && JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from, to };
    }
  }
  return changes;
}

/** `{field: to}` for a Prisma `data` object, from a changes map. */
export function changesToData(changes: FieldChanges): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).map(([key, { to }]) => [key, to]));
}
