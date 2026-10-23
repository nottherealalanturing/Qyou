import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { UserRole } from '../generated/prisma/client.js';
import { RequireVerifiedEmail } from './verified-email.decorator.js';

export const ROLES_KEY = 'qyou:roles';

/**
 * Restricts a route (or controller) to the listed roles. Evaluated by the global `RolesGuard`
 * AFTER authentication, so an anonymous caller gets 401 and an authenticated caller with the
 * wrong role gets 403. A route without `@Roles` is open to any authenticated user.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Administrator-only, and the administrator's email must be verified. */
export const AdminOnly = () => applyDecorators(Roles('ADMIN'), RequireVerifiedEmail());
