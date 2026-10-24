/** Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/** Prisma foreign-key violation (P2003). */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2003'
  );
}
