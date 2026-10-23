import { APP_GUARD } from '@nestjs/core';
import type { Provider } from '@nestjs/common';
import { CsrfGuard } from './auth/csrf.guard.js';
import { SessionAuthGuard } from './auth/session-auth.guard.js';
import { RolesGuard } from './authz/roles.guard.js';
import { VerifiedEmailGuard } from './authz/verified-email.guard.js';

/**
 * Global guards, in execution order. Authentication (who are you?) strictly precedes
 * authorization (may you?):
 *   1. CsrfGuard          – reject cross-site state-changing requests
 *   2. SessionAuthGuard   – authenticate; private by default unless @Public()
 *   3. RolesGuard         – @Roles(...)
 *   4. VerifiedEmailGuard – @RequireVerifiedEmail()
 * Resource-level checks (does THIS record belong to the caller?) live in services, because they
 * need the loaded resource — see docs/ARCHITECTURE.md → "Authorization".
 */
export const GLOBAL_GUARDS: Provider[] = [
  CsrfGuard,
  SessionAuthGuard,
  RolesGuard,
  VerifiedEmailGuard,
].map((useClass) => ({ provide: APP_GUARD, useClass }));
