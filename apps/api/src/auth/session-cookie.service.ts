import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.js';

/**
 * Production uses the `__Host-` prefix: browsers then only accept the cookie when it is Secure,
 * has Path=/ and no Domain attribute, which blocks subdomain/overwrite attacks. Over plain-HTTP
 * localhost the prefix is impossible (it requires Secure), so development uses a plain name.
 */
@Injectable()
export class SessionCookieService {
  readonly name: string;
  private readonly secure: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.name = this.secure ? '__Host-qyou_session' : 'qyou_session';
  }

  read(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[this.name];
    return typeof value === 'string' ? value : undefined;
  }

  set(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.name, token, { ...this.baseOptions(), expires: expiresAt });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.baseOptions());
  }

  private baseOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/' };
  }
}
