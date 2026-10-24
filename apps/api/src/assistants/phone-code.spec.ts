import { generatePhoneCode, hashPhoneCode, phoneCodeMatches } from './phone-code.js';

describe('phone codes', () => {
  it('generates six-digit numeric strings, including leading zeros', () => {
    const codes = Array.from({ length: 2000 }, generatePhoneCode);
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1900); // not constant, not tiny-range
  });

  it('hashes with a keyed HMAC bound to the token and phone', () => {
    const hash = hashPhoneCode('pepper-1', 'tok-1', '+2348031234567', '123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
    expect(hashPhoneCode('pepper-1', 'tok-1', '+2348031234567', '123456')).toBe(hash);
    for (const different of [
      hashPhoneCode('pepper-2', 'tok-1', '+2348031234567', '123456'),
      hashPhoneCode('pepper-1', 'tok-2', '+2348031234567', '123456'),
      hashPhoneCode('pepper-1', 'tok-1', '+2348031234568', '123456'),
      hashPhoneCode('pepper-1', 'tok-1', '+2348031234567', '123457'),
    ]) {
      expect(different).not.toBe(hash);
    }
  });

  it('compares in constant time and tolerates malformed input', () => {
    const hash = hashPhoneCode('p', 't', '+2348031234567', '000000');
    expect(phoneCodeMatches(hash, hash)).toBe(true);
    expect(phoneCodeMatches(hash, hashPhoneCode('p', 't', '+2348031234567', '000001'))).toBe(false);
    expect(phoneCodeMatches(hash, 'abc')).toBe(false);
    expect(phoneCodeMatches('', '')).toBe(true);
  });
});
