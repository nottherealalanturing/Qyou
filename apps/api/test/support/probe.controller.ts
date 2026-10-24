import { Controller, Get } from '@nestjs/common';
import { RequireAssistantEligibility } from '../../src/assistants/eligibility.guard.js';
import { Public } from '../../src/auth/public.decorator.js';
import { Roles } from '../../src/authz/roles.decorator.js';
import { RequireVerifiedEmail } from '../../src/authz/verified-email.decorator.js';

/**
 * TEST-ONLY controller (registered by the e2e module, never by the application). It gives the
 * authorization tests routes with every decorator combination without adding fake endpoints to
 * the production API.
 */
@Controller('probe')
export class ProbeController {
  @Get('any-authenticated')
  anyAuthenticated() {
    return { ok: true };
  }

  @Get('assistant')
  @Roles('ASSISTANT')
  assistantOnly() {
    return { ok: true };
  }

  @Get('customer-or-assistant')
  @Roles('CUSTOMER', 'ASSISTANT')
  customerOrAssistant() {
    return { ok: true };
  }

  @Get('business')
  @Roles('BUSINESS_STAFF')
  businessOnly() {
    return { ok: true };
  }

  @Get('verified')
  @RequireVerifiedEmail()
  verifiedOnly() {
    return { ok: true };
  }

  @Get('assistant-verified')
  @Roles('ASSISTANT')
  @RequireVerifiedEmail()
  assistantVerified() {
    return { ok: true };
  }

  /** Paid assistant work: role AND full eligibility are required. */
  @Get('paid-job')
  @Roles('ASSISTANT')
  @RequireAssistantEligibility()
  paidJob() {
    return { ok: true };
  }

  /** Eligibility alone (no @Roles): the guard itself must refuse anyone who is not fully eligible. */
  @Get('paid-job-guard-only')
  @RequireAssistantEligibility()
  paidJobGuardOnly() {
    return { ok: true };
  }

  /** Misconfiguration that must fail closed: public AND role-restricted. */
  @Public()
  @Get('public-but-roles')
  @Roles('ADMIN')
  publicButRoles() {
    return { ok: true };
  }

  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }
}
