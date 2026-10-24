import type { Prisma } from '../generated/prisma/client.js';
import { escapeLike } from './text.js';

/**
 * The single definition of "what the public may see" for locations: approved, in an ACTIVE
 * category and an ACTIVE city. Everything else (pending, rejected, archived, or hidden by an
 * inactive parent) must be indistinguishable from "does not exist".
 */
export function publicLocationWhere(
  filters: {
    city?: string | undefined;
    category?: string | undefined;
    q?: string | undefined;
  } = {},
): Prisma.ServiceLocationWhereInput {
  const { city, category, q } = filters;
  return {
    status: 'APPROVED',
    category: { isActive: true, ...(category ? { slug: category } : {}) },
    city: { isActive: true, ...(city ? { slug: city } : {}) },
    ...(q
      ? {
          OR: [
            { name: { contains: escapeLike(q), mode: 'insensitive' } },
            { address: { contains: escapeLike(q), mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}
