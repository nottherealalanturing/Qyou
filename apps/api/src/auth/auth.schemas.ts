import { z } from 'zod';
import { createZodDto } from '../common/zod/create-zod-dto.js';

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou123',
  'letmein1234',
  'welcome1234',
  'admin12345',
  'abcdefghij',
  '0123456789',
  'passw0rd123',
  'qyou123456',
]);

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

const email = z
  .string('Enter your email address')
  .trim()
  .max(254, 'Email address is too long')
  .pipe(z.email('Enter a valid email address'))
  .transform(normalizeEmail);

const newPassword = z
  .string('Enter a password')
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    message: 'That password is too common. Choose something harder to guess',
  });

const resetToken = z
  .string('Missing reset token')
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This reset link is invalid or has expired');

export const registerSchema = z
  .strictObject({
    email,
    name: z
      .string('Enter your name')
      .trim()
      .min(1, 'Enter your name')
      .max(80, 'Name is too long')
      .regex(/^[^\p{C}]+$/u, 'Name contains invalid characters'),
    password: newPassword,
  })
  .refine((value) => value.password.toLowerCase() !== value.email, {
    path: ['password'],
    message: 'Password must not be your email address',
  });

export const loginSchema = z.strictObject({
  email,
  // Deliberately no strength rules at login; the cap only bounds hashing cost.
  password: z.string('Enter your password').min(1, 'Enter your password').max(128),
});

export const passwordResetRequestSchema = z.strictObject({ email });

export const passwordResetConfirmSchema = z.strictObject({
  token: resetToken,
  password: newPassword,
});

export const emailVerificationConfirmSchema = z.strictObject({ token: resetToken });

export const changePasswordSchema = z.strictObject({
  currentPassword: z
    .string('Enter your current password')
    .min(1, 'Enter your current password')
    .max(128),
  newPassword,
});

export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class PasswordResetRequestDto extends createZodDto(passwordResetRequestSchema) {}
export class PasswordResetConfirmDto extends createZodDto(passwordResetConfirmSchema) {}
export class EmailVerificationConfirmDto extends createZodDto(emailVerificationConfirmSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
