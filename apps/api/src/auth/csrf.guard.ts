import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { SessionCookieService } from './session-cookie.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions (OWASP "verify origin with standard headers"), layered on top
 * of SameSite=Lax cookies:
 *  - any state-changing request that carries an `Origin` header must come from an allowed origin
 *    (browsers always send Origin on cross-site POSTs, including login CSRF attempts);
 *  - a state-changing request that carries our session cookie but no `Origin` is rejected.
 * Non-browser clients without the cookie (curl, mobile, tests) are unaffected.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    config: ConfigService<Env, true>,
    private readonly cookies: SessionCookieService,
  ) {
    this.allowedOrigins = new Set(config.get('CORS_ORIGINS', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (typeof origin === 'string' && this.allowedOrigins.has(origin)) return true;
      throw new ForbiddenException('Cross-site request blocked');
    }
    if (this.cookies.read(req) !== undefined) {
      throw new ForbiddenException('Cross-site request blocked');
    }
    return true;
  }
}
