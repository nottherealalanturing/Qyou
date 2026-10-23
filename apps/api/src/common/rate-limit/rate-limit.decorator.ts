import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  /** Bucket name; combined with the client IP to form the key. */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_KEY = 'qyou:rate-limit';

/** Per-client-IP rate limit for a route. Enforced by `RateLimitGuard` (add via `@UseGuards`). */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
