import { Global, Module } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimiter } from './rate-limiter.js';

@Global()
@Module({
  providers: [{ provide: RateLimiter, useFactory: () => new RateLimiter() }, RateLimitGuard],
  exports: [RateLimiter, RateLimitGuard],
})
export class RateLimitModule {}
