import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import type { UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Authorization by role. It never authenticates: it relies on `SessionAuthGuard` (which runs
 * first) having attached `req.auth`, and fails closed if a route is both `@Public()` and
 * `@Roles()` — that combination is a programming error, not an open route.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth || !roles.includes(auth.user.role)) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
