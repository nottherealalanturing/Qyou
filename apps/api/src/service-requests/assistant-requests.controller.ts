import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequireAssistantEligibility } from '../assistants/eligibility.guard.js';
import { RequireVerifiedEmail } from '../authz/verified-email.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { AssistantRequestsService } from './assistant-requests.service.js';
import { FeedQuery, SubmitQuoteDto } from './service-requests.schemas.js';

/**
 * The assistant's side of the marketplace. Browsing and quoting need FULL eligibility
 * (`@RequireAssistantEligibility()`), not just the role. Nothing here returns customer identity.
 */
@ApiTags('assistant jobs (own)')
@ApiCookieAuth()
@Controller('assistants/me')
@UseGuards(RateLimitGuard)
export class AssistantRequestsController {
  constructor(private readonly jobs: AssistantRequestsService) {}

  @Get('requests')
  @RequireAssistantEligibility()
  @ApiOperation({
    summary: 'Open requests I can quote on (task offered, city served, venue allows it)',
  })
  feed(@CurrentUser() user: PublicUser, @Query() query: FeedQuery) {
    return this.jobs.feed(user, query);
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'One request I may quote on, or one I already quoted on (404 otherwise)',
  })
  get(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getForAssistant(user, id);
  }

  @Post('requests/:id/quotes')
  @RequireAssistantEligibility()
  @RequireVerifiedEmail()
  @RateLimit({ name: 'quote-submit', limit: 60, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Send a priced proposal (nothing is charged; there is no payment in this milestone)',
  })
  @ApiBody(zodBodySchema(SubmitQuoteDto))
  quote(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitQuoteDto,
    @Req() req: Request,
  ) {
    return this.jobs.submitQuote(user, id, dto, requestContext(req));
  }

  @Get('quotes')
  @ApiOperation({ summary: 'My quotes with the request each is about' })
  quotes(@CurrentUser() user: PublicUser, @Query() query: FeedQuery) {
    return this.jobs.myQuotes(user, query);
  }

  @Post('quotes/:id/withdraw')
  @HttpCode(200)
  @RateLimit({ name: 'quote-withdraw', limit: 60, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Withdraw a pending quote (works even if I am no longer eligible)' })
  withdraw(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.jobs.withdraw(user, id, requestContext(req));
  }
}
