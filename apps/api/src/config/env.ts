import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: 'DATABASE_URL must be a postgresql:// connection string',
      }),
    /** Public base URL of the web app; used to build links in emails. */
    WEB_BASE_URL: z.url().default('http://localhost:3000'),
    /**
     * Number of reverse proxies in front of the API whose X-Forwarded-For is trusted.
     * 0 = trust none (req.ip is the socket address). Must be accurate: rate limiting and audit
     * logs depend on the client IP.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    MAIL_FROM: z.string().min(3).default('Qyou <no-reply@qyou.local>'),
    /**
     * Phone-verification transport. `dev` (non-production only) delivers the code as a clearly
     * labelled simulated SMS email to Mailpit; `none` means no provider is configured, so the
     * endpoints answer 503 and create no code. Defaults: dev outside production, none in production.
     * A real provider needs an approved selection and explicit configuration (see DECISIONS D-038).
     */
    SMS_PROVIDER: z.enum(['dev', 'none']).optional(),
    /** Secret key for HMAC-hashing phone codes. Required (≥ 32 chars) in production. */
    PHONE_CODE_PEPPER: z
      .string()
      .min(32, 'PHONE_CODE_PEPPER must be at least 32 characters')
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required in production',
        });
      }
      if (!env.WEB_BASE_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_BASE_URL'],
          message: 'WEB_BASE_URL must be https in production',
        });
      }
      if (!env.PHONE_CODE_PEPPER) {
        ctx.addIssue({
          code: 'custom',
          path: ['PHONE_CODE_PEPPER'],
          message: 'PHONE_CODE_PEPPER is required in production',
        });
      }
      if (env.SMS_PROVIDER === 'dev') {
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_PROVIDER'],
          message: 'SMS_PROVIDER=dev simulates SMS and is not allowed in production',
        });
      }
      if (env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS must all be https in production',
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    SMS_PROVIDER:
      env.SMS_PROVIDER ?? (env.NODE_ENV === 'production' ? ('none' as const) : ('dev' as const)),
    // Non-production fallback so local setups work without configuration; it is not a secret.
    PHONE_CODE_PEPPER: env.PHONE_CODE_PEPPER ?? 'dev-only-pepper-not-a-secret-0000000000',
  }));

export type Env = z.infer<typeof envSchema>;

/** Validates raw environment variables; throws one readable error listing every problem. */
export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
