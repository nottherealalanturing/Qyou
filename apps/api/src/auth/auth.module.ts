import { Module, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AccountController } from './account.controller.js';
import { AccountSecurityService } from './account-security.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { PasswordService } from './password.service.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SessionService } from './session.service.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

@Module({
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    AccountSecurityService,
    EmailVerificationService,
    PasswordService,
    SessionService,
    SessionCookieService,
  ],
  exports: [SessionService, SessionCookieService, AuthService, PasswordService],
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
