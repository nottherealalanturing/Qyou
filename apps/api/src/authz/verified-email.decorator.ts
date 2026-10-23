import { SetMetadata } from '@nestjs/common';

export const VERIFIED_EMAIL_KEY = 'qyou:verified-email';

/**
 * The caller's email address must be verified. Use it on actions that create a commitment or
 * contact another person (see docs/ARCHITECTURE.md → "Email verification policy").
 */
export const RequireVerifiedEmail = () => SetMetadata(VERIFIED_EMAIL_KEY, true);
