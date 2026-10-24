import { parseEnv } from './env.js';

const valid = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('coerces PORT and splits CORS_ORIGINS', () => {
    const env = parseEnv({
      ...valid,
      PORT: '8080',
      CORS_ORIGINS: 'https://a.test, https://b.test',
    });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => parseEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });
});

describe('parseEnv (auth/mail settings)', () => {
  const prod = {
    ...valid,
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.example.com',
    WEB_BASE_URL: 'https://qyou.example',
    CORS_ORIGINS: 'https://qyou.example',
    PHONE_CODE_PEPPER: 'p'.repeat(40),
  };

  it('accepts a complete production configuration', () => {
    expect(parseEnv(prod).SMTP_HOST).toBe('smtp.example.com');
  });

  it('requires SMTP_HOST in production', () => {
    const { SMTP_HOST: _omit, ...rest } = prod;
    expect(() => parseEnv(rest)).toThrow(/SMTP_HOST/);
  });

  it('requires https web and CORS origins in production', () => {
    expect(() => parseEnv({ ...prod, WEB_BASE_URL: 'http://qyou.example' })).toThrow(
      /WEB_BASE_URL/,
    );
    expect(() => parseEnv({ ...prod, CORS_ORIGINS: 'http://qyou.example' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('defaults TRUST_PROXY to 0 and rejects negatives', () => {
    expect(parseEnv(valid).TRUST_PROXY).toBe(0);
    expect(() => parseEnv({ ...valid, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/);
  });
});

describe('parseEnv (phone verification)', () => {
  const prodEnv = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.example.com',
    WEB_BASE_URL: 'https://qyou.example',
    CORS_ORIGINS: 'https://qyou.example',
    PHONE_CODE_PEPPER: 'p'.repeat(40),
  };

  it('defaults to the simulated transport outside production and "none" in production', () => {
    expect(parseEnv({ DATABASE_URL: prodEnv.DATABASE_URL }).SMS_PROVIDER).toBe('dev');
    expect(parseEnv({ DATABASE_URL: prodEnv.DATABASE_URL, NODE_ENV: 'test' }).SMS_PROVIDER).toBe(
      'dev',
    );
    expect(parseEnv(prodEnv).SMS_PROVIDER).toBe('none');
  });

  it('forbids the simulated transport in production', () => {
    expect(() => parseEnv({ ...prodEnv, SMS_PROVIDER: 'dev' })).toThrow(/SMS_PROVIDER/);
    expect(parseEnv({ ...prodEnv, SMS_PROVIDER: 'none' }).SMS_PROVIDER).toBe('none');
  });

  it('requires a strong pepper in production, and supplies a non-secret default elsewhere', () => {
    const { PHONE_CODE_PEPPER: _omit, ...withoutPepper } = prodEnv;
    expect(() => parseEnv(withoutPepper)).toThrow(/PHONE_CODE_PEPPER/);
    expect(() => parseEnv({ ...prodEnv, PHONE_CODE_PEPPER: 'short' })).toThrow(/PHONE_CODE_PEPPER/);
    expect(
      parseEnv({ DATABASE_URL: prodEnv.DATABASE_URL }).PHONE_CODE_PEPPER.length,
    ).toBeGreaterThanOrEqual(32);
  });

  it('rejects unknown SMS providers', () => {
    expect(() => parseEnv({ DATABASE_URL: prodEnv.DATABASE_URL, SMS_PROVIDER: 'twilio' })).toThrow(
      /SMS_PROVIDER/,
    );
  });
});
