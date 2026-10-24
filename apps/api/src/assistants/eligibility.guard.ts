import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AssistantEligibilityService } from './assistant-eligibility.service.js';

export const REQUIRE_ASSISTANT_ELIGIBILITY_KEY = 'qyou:require-assistant-eligibility';

/**
 * Marks a route as paid assistant work (e.g. "accept a job", Phase 2). The global guard then
 * requires the full eligibility check; role alone is never enough.
 */
export const RequireAssistantEligibility = () =>
  SetMetadata(REQUIRE_ASSISTANT_ELIGIBILITY_KEY, true);

@Injectable()
export class AssistantEligibilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly eligibility: AssistantEligibilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_ASSISTANT_ELIGIBILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    // Authentication runs first; a missing session here is a wiring bug, so fail closed.
    if (!auth) throw new ForbiddenException('You do not have permission to do this');

    const result = await this.eligibility.evaluate(auth.user.id);
    if (!result.eligibleForPaidJobs) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'ASSISTANT_NOT_ELIGIBLE',
        message: 'You cannot accept paid jobs yet',
        reasons: result.reasons,
      });
    }
    return true;
  }
}
