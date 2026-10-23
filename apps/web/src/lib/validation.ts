// Client-side validation gives instant feedback only. The API validates everything again and is
// the source of truth; keep these messages in step with apps/api/src/auth/auth.schemas.ts.

export type FieldErrors = Partial<Record<string, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Enter your email address';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return 'Enter a valid email address';
  return undefined;
}

export function validateName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter your name';
  if (name.length > 80) return 'Name is too long';
  return undefined;
}

export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Enter a password';
  if (value.length < 10) return 'Use at least 10 characters';
  if (value.length > 128) return 'Use at most 128 characters';
  return undefined;
}

export function validateCurrentPassword(value: string): string | undefined {
  return value ? undefined : 'Enter your password';
}

export function compact(errors: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
}
