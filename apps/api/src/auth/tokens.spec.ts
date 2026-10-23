import { generateToken, hashToken, isWellFormedToken } from './tokens.js';

describe('tokens', () => {
  it('generates unique, well-formed 256-bit tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(isWellFormedToken(token)).toBe(true);
  });

  it('hashes deterministically to 64 hex chars and never equals the token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'short', 'a'.repeat(44), `${'a'.repeat(42)}!`, 42, null, undefined]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});
