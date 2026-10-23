import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  let time: number;
  let limiter: RateLimiter;

  beforeEach(() => {
    time = 1_000_000;
    limiter = new RateLimiter(() => time, 3);
  });

  it('allows up to the limit then blocks with a retry hint', () => {
    for (let i = 0; i < 3; i++) expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
    const blocked = limiter.hit('k', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('does not count blocked attempts against the window', () => {
    for (let i = 0; i < 5; i++) limiter.hit('k', 3, 60_000);
    expect(limiter.count('k', 60_000)).toBe(3);
  });

  it('frees capacity as hits leave the sliding window', () => {
    limiter.hit('k', 2, 10_000);
    time += 6_000;
    limiter.hit('k', 2, 10_000);
    expect(limiter.hit('k', 2, 10_000).allowed).toBe(false);
    time += 5_000; // first hit is now 11s old
    expect(limiter.hit('k', 2, 10_000).allowed).toBe(true);
  });

  it('keeps keys independent and supports clear/reset', () => {
    limiter.hit('a', 1, 1000);
    expect(limiter.hit('b', 1, 1000).allowed).toBe(true);
    expect(limiter.hit('a', 1, 1000).allowed).toBe(false);
    limiter.clear('a');
    expect(limiter.hit('a', 1, 1000).allowed).toBe(true);
    limiter.reset();
    expect(limiter.count('a', 1000)).toBe(0);
  });

  it('bounds memory by evicting the oldest key', () => {
    limiter.hit('1', 1, 1000);
    limiter.hit('2', 1, 1000);
    limiter.hit('3', 1, 1000);
    limiter.hit('4', 1, 1000); // cap is 3 → evicts '1'
    expect(limiter.count('1', 1000)).toBe(0);
    expect(limiter.count('4', 1000)).toBe(1);
  });

  it('reports retryAfterSeconds without recording', () => {
    limiter.hit('k', 1, 30_000);
    expect(limiter.retryAfterSeconds('k', 1, 30_000)).toBe(30);
    expect(limiter.retryAfterSeconds('k', 2, 30_000)).toBe(0);
    expect(limiter.count('k', 30_000)).toBe(1);
  });
});
