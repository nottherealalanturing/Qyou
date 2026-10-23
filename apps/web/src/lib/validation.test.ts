import {
  compact,
  validateCurrentPassword,
  validateEmail,
  validateName,
  validateNewPassword,
} from './validation';

describe('validation', () => {
  it('validates email', () => {
    expect(validateEmail('')).toBe('Enter your email address');
    expect(validateEmail('  ')).toBe('Enter your email address');
    expect(validateEmail('nope')).toBe('Enter a valid email address');
    expect(validateEmail('a@b')).toBe('Enter a valid email address');
    expect(validateEmail(' ada@example.com ')).toBeUndefined();
  });

  it('validates name', () => {
    expect(validateName('  ')).toBe('Enter your name');
    expect(validateName('x'.repeat(81))).toBe('Name is too long');
    expect(validateName('Ada')).toBeUndefined();
  });

  it('validates new passwords by length', () => {
    expect(validateNewPassword('')).toBe('Enter a password');
    expect(validateNewPassword('123456789')).toBe('Use at least 10 characters');
    expect(validateNewPassword('x'.repeat(129))).toBe('Use at most 128 characters');
    expect(validateNewPassword('1234567890')).toBeUndefined();
  });

  it('only requires a non-empty current password', () => {
    expect(validateCurrentPassword('')).toBe('Enter your password');
    expect(validateCurrentPassword('x')).toBeUndefined();
  });

  it('compact drops empty entries', () => {
    expect(compact({ a: 'bad', b: undefined })).toEqual({ a: 'bad' });
  });
});
