import { Body, Controller, Get, HttpCode, Post, Put, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequireVerifiedEmail } from '../authz/verified-email.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { AssistantEligibilityService } from './assistant-eligibility.service.js';
import { AssistantsService } from './assistants.service.js';
import {
  AvailabilityDto,
  CreateDraftDto,
  PhoneVerifyDto,
  PrivateDetailsDto,
  ServicesDto,
  UpdateProfileDto,
} from './assistants.schemas.js';
import { PhoneVerificationService } from './phone-verification.service.js';

/**
 * The signed-in user's OWN assistant application. There are no ids in these URLs: every operation is
 * scoped to the session's user, so one user can never reach another's application. Anyone with a
 * CUSTOMER or ASSISTANT account may apply; writes need a verified email. Nothing here can grant a role.
 */
@ApiTags('assistant application (own)')
@ApiCookieAuth()
@Controller('assistants/me')
@UseGuards(RateLimitGuard)
export class AssistantsController {
  constructor(
    private readonly assistants: AssistantsService,
    private readonly phone: PhoneVerificationService,
    private readonly eligibility: AssistantEligibilityService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Onboarding dashboard: application status, checklist, private details (own), eligibility',
  })
  dashboard(@CurrentUser() user: PublicUser) {
    return this.assistants.dashboard(user);
  }

  @Get('eligibility')
  @ApiOperation({ summary: 'May I accept paid jobs? Every unmet condition is listed' })
  async eligibilityFor(@CurrentUser() user: PublicUser) {
    return this.eligibility.evaluate(user.id);
  }

  @Post()
  @RequireVerifiedEmail()
  @RateLimit({ name: 'assistant-apply', limit: 10, windowSeconds: 3600 })
  @ApiBody(zodBodySchema(CreateDraftDto))
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateDraftDto, @Req() req: Request) {
    return this.assistants.createDraft(user, dto, requestContext(req));
  }

  @Patch()
  @RequireVerifiedEmail()
  @ApiBody(zodBodySchema(UpdateProfileDto))
  updateProfile(
    @CurrentUser() user: PublicUser,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    return this.assistants.updateProfile(user, dto, requestContext(req));
  }

  @Put('services')
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Replace the cities served and tasks offered (non-delegable tasks are refused)',
  })
  @ApiBody(zodBodySchema(ServicesDto))
  setServices(@CurrentUser() user: PublicUser, @Body() dto: ServicesDto, @Req() req: Request) {
    return this.assistants.setServices(user, dto, requestContext(req));
  }

  @Put('availability')
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Replace preferred working times (a declaration, not a guarantee of work)',
  })
  @ApiBody(zodBodySchema(AvailabilityDto))
  setAvailability(
    @CurrentUser() user: PublicUser,
    @Body() dto: AvailabilityDto,
    @Req() req: Request,
  ) {
    return this.assistants.setAvailability(user, dto, requestContext(req));
  }

  @Put('private')
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Set PRIVATE legal name and mobile number (never public)' })
  @ApiBody(zodBodySchema(PrivateDetailsDto))
  setPrivate(@CurrentUser() user: PublicUser, @Body() dto: PrivateDetailsDto, @Req() req: Request) {
    return this.assistants.setPrivateDetails(user, dto, requestContext(req));
  }

  @Post('phone/code')
  @HttpCode(200)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'assistant-phone-code', limit: 20, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Send a one-time code to your mobile number (503 if no SMS provider is configured)',
  })
  requestPhoneCode(@CurrentUser() user: PublicUser, @Req() req: Request) {
    return this.phone.requestCode(user, requestContext(req));
  }

  @Post('phone/verify')
  @HttpCode(200)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'assistant-phone-verify', limit: 30, windowSeconds: 900 })
  @ApiBody(zodBodySchema(PhoneVerifyDto))
  verifyPhone(@CurrentUser() user: PublicUser, @Body() dto: PhoneVerifyDto, @Req() req: Request) {
    return this.phone.verify(user, dto.code, requestContext(req));
  }

  @Post('submit')
  @HttpCode(200)
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Submit the application for review (requires a complete profile)' })
  submit(@CurrentUser() user: PublicUser, @Req() req: Request) {
    return this.assistants.submit(user, requestContext(req));
  }
}
