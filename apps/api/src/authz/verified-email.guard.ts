import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { VERIFIED_EMAIL_KEY } from './verified-email.decorator.js';

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(VERIFIED_EMAIL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth?.user.emailVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address to do this',
      });
    }
    return true;
  }
}
