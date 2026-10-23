export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest counted hit expires (only meaningful when `allowed` is false). */
  retryAfterSeconds: number;
}

/**
 * In-memory sliding-window limiter.
 *
 * Limitation (documented in ARCHITECTURE.md): state is per process. It is correct for a single
 * API instance; running several instances needs a shared store (Redis/PostgreSQL) — Phase 6.
 * Memory is bounded: expired windows are pruned lazily and the key count is capped.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Records a hit and reports whether it is within `limit` hits per `windowMs`. */
  hit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.now();
    const recent = this.recent(key, windowMs, now);
    if (recent.length >= limit) {
      return { allowed: false, retryAfterSeconds: this.retryAfter(recent, windowMs, now) };
    }
    recent.push(now);
    this.store(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Number of hits currently inside the window (no recording). */
  count(key: string, windowMs: number): number {
    return this.recent(key, windowMs, this.now()).length;
  }

  /** Seconds until a key with `limit` hits would be allowed again; 0 when under the limit. */
  retryAfterSeconds(key: string, limit: number, windowMs: number): number {
    const now = this.now();
    const recent = this.recent(key, windowMs, now);
    return recent.length >= limit ? this.retryAfter(recent, windowMs, now) : 0;
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  reset(): void {
    this.hits.clear();
  }

  private recent(key: string, windowMs: number, now: number): number[] {
    const timestamps = this.hits.get(key);
    if (!timestamps) return [];
    const fresh = timestamps.filter((t) => now - t < windowMs);
    if (fresh.length === 0) this.hits.delete(key);
    else if (fresh.length !== timestamps.length) this.hits.set(key, fresh);
    return fresh;
  }

  private store(key: string, timestamps: number[]): void {
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      // Evict the oldest-inserted key (Map preserves insertion order).
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, timestamps);
  }

  private retryAfter(recent: number[], windowMs: number, now: number): number {
    const oldest = Math.min(...recent);
    return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
  }
}
