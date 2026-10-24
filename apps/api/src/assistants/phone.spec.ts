import { maskPhone, normalizeNigerianPhone } from './phone.js';

describe('normalizeNigerianPhone', () => {
  it.each([
    ['08031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
    ['0803-123-4567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['+234 803 123 4567', '+2348031234567'],
    ['+2347012345678', '+2347012345678'],
    ['(0903) 123 4567', '+2349031234567'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected);
  });

  it.each([
    '',
    '123',
    '0803123456', // too short
    '080312345678', // too long
    '+14155550123', // not Nigerian
    '+2341234567890', // not a mobile range (starts with 1)
    '0603123456789',
    'not a number',
    '+234803123456a',
    '08031234567; DROP TABLE users',
  ])('rejects %j', (input) => {
    expect(normalizeNigerianPhone(input)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('keeps the country code and last four digits only', () => {
    expect(maskPhone('+2348031234567')).toBe('+234••••••4567');
    expect(maskPhone('+2348031234567')).not.toContain('803');
  });
});
