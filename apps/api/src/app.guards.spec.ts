import { APP_GUARD } from '@nestjs/core';
import { GLOBAL_GUARDS } from './app.guards.js';

describe('GLOBAL_GUARDS', () => {
  it('registers every guard as APP_GUARD, in the required order', () => {
    const providers = GLOBAL_GUARDS as { provide: unknown; useClass: { name: string } }[];
    expect(providers.every((p) => p.provide === APP_GUARD)).toBe(true);
    // Order is security-relevant: CSRF → authenticate → roles → verified email. Authorization
    // guards read `req.auth`, which only SessionAuthGuard sets; anonymous callers must get 401,
    // not 403, and a cross-site request must be rejected before anything else runs.
    expect(providers.map((p) => p.useClass.name)).toEqual([
      'CsrfGuard',
      'SessionAuthGuard',
      'RolesGuard',
      'VerifiedEmailGuard',
    ]);
  });
});
