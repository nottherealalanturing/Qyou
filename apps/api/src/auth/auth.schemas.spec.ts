import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import {
  LoginDto,
  RegisterDto,
  loginSchema,
  normalizeEmail,
  passwordResetConfirmSchema,
  registerSchema,
} from './auth.schemas.js';

const valid = { email: 'Ada@Example.com', name: 'Ada', password: 'a-long-enough-passphrase' };

describe('auth schemas', () => {
  it('normalises email (trim, lower-case, NFKC)', () => {
    expect(normalizeEmail('  ＡＤＡ@Example.COM ')).toBe('ada@example.com');
    expect(registerSchema.parse({ ...valid, email: '  Ada@Example.com ' }).email).toBe(
      'ada@example.com',
    );
  });

  it('trims the name and rejects unknown keys (no role injection)', () => {
    expect(registerSchema.parse({ ...valid, name: '  Ada  ' }).name).toBe('Ada');
    expect(registerSchema.safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, id: 'x' }).success).toBe(false);
  });

  it('enforces password length and rejects common passwords', () => {
    expect(registerSchema.safeParse({ ...valid, password: '123456789' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'Password123' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'x'.repeat(128) }).success).toBe(true);
  });

  it('does not apply strength rules at login (only a size cap)', () => {
    expect(loginSchema.safeParse({ email: valid.email, password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: valid.email, password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: valid.email, password: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });

  it('requires a well-formed 43-char reset token', () => {
    const password = 'a-long-enough-passphrase';
    expect(passwordResetConfirmSchema.safeParse({ token: 'A'.repeat(43), password }).success).toBe(
      true,
    );
    expect(passwordResetConfirmSchema.safeParse({ token: 'A'.repeat(42), password }).success).toBe(
      false,
    );
    expect(
      passwordResetConfirmSchema.safeParse({ token: `${'A'.repeat(42)}=`, password }).success,
    ).toBe(false);
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();
  const attempt = () =>
    pipe.transform(
      { email: 'bad', password: 'secret-VALUE-123', name: '' },
      { type: 'body', metatype: LoginDto },
    );

  it('returns the parsed (normalised, stripped) value for DTO-typed params', () => {
    const out = pipe.transform(valid, { type: 'body', metatype: RegisterDto });
    expect(out).toEqual({ email: 'ada@example.com', name: 'Ada', password: valid.password });
  });

  it('throws 400 with paths and messages, never echoing submitted values', () => {
    expect(attempt).toThrow(BadRequestException);
    const error = (() => {
      try {
        attempt();
      } catch (e) {
        return e as BadRequestException;
      }
      return undefined;
    })();
    const body = error?.getResponse() as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toContain('email');
    expect(JSON.stringify(body)).not.toContain('secret-VALUE-123');
  });

  it('treats a missing body as an empty object (so required-field errors surface)', () => {
    expect(() => pipe.transform(undefined, { type: 'body', metatype: LoginDto })).toThrow(
      BadRequestException,
    );
  });

  it('leaves parameters without a DTO untouched', () => {
    expect(pipe.transform('raw', { type: 'query', metatype: String })).toBe('raw');
  });
});
