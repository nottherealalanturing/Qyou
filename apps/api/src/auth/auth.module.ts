import { Module, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { PasswordService } from './password.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SessionService } from './session.service.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    SessionCookieService,
    // Order matters: CSRF origin check first, then session authentication.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [SessionService],
})
export class AuthModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuthModule.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      this.auth.purgeExpired().catch((error: unknown) => {
        this.logger.error(`Purge failed (${error instanceof Error ? error.name : 'error'})`);
      });
    }, PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
