import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SessionService } from './session.service.js';

/** Global guard: every route requires a valid session unless marked `@Public()`. */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.sessions.resolve(this.cookies.read(req));
    if (!auth) throw new UnauthorizedException('Authentication required');
    req.auth = auth;
    return true;
  }
}
