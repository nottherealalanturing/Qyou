import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends (only meaningful when `allowed` is false). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter whose counters live in PostgreSQL (`rate_limit_counters`), so limits
 * are shared by every API instance and survive restarts.
 *
 * - `hit` is a single atomic `INSERT … ON CONFLICT DO UPDATE … WHERE count < limit`: concurrent
 *   requests (on any instance) can never push the counter past the limit, and blocked attempts
 *   are not counted.
 * - Semantics are *fixed* windows: a client can burst up to 2× the limit across a window
 *   boundary. Acceptable for these abuse limits; documented in DECISIONS.md (D-017).
 * - Keys are hashed (SHA-256) before storage, so no raw emails or IPs sit in the table.
 * - Cost: one extra query per limited request. The limiter fails closed: if the database is
 *   unreachable the request errors (the API cannot do anything useful without it anyway).
 */
@Injectable()
export class RateLimiter {
  constructor(private readonly prisma: PrismaService) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const hashed = hashKey(key);
    const windowStart = currentWindowStart(windowMs);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_counters ("key", "windowStart", "count")
      VALUES (${hashed}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = rate_limit_counters."count" + 1
        WHERE rate_limit_counters."count" < ${limit}
      RETURNING "count"`;
    if (rows.length > 0) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: secondsUntilWindowEnd(windowStart, windowMs) };
  }

  /** Hits recorded in the current window (no recording). */
  async count(key: string, windowMs: number): Promise<number> {
    const row = await this.prisma.rateLimitCounter.findUnique({
      where: {
        key_windowStart: { key: hashKey(key), windowStart: currentWindowStart(windowMs) },
      },
      select: { count: true },
    });
    return row?.count ?? 0;
  }

  /** Seconds until a key at `limit` hits is allowed again; 0 when under the limit. */
  async retryAfterSeconds(key: string, limit: number, windowMs: number): Promise<number> {
    const used = await this.count(key, windowMs);
    return used >= limit ? secondsUntilWindowEnd(currentWindowStart(windowMs), windowMs) : 0;
  }

  /** Forgets every window of a key (e.g. after a successful login). */
  async clear(key: string): Promise<void> {
    await this.prisma.rateLimitCounter.deleteMany({ where: { key: hashKey(key) } });
  }

  /** Test helper and operational escape hatch: forgets all counters. */
  async reset(): Promise<void> {
    await this.prisma.rateLimitCounter.deleteMany();
  }

  /** Housekeeping: windows are at most an hour long, so day-old rows are dead. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.rateLimitCounter.deleteMany({
      where: { windowStart: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return count;
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function currentWindowStart(windowMs: number): Date {
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

function secondsUntilWindowEnd(windowStart: Date, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));
}
