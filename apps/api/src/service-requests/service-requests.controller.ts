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
import { Roles } from '../authz/roles.decorator.js';
import { RequireVerifiedEmail } from '../authz/verified-email.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { ServiceRequestsService } from './service-requests.service.js';
import {
  CancelRequestDto,
  CreateRequestDto,
  ListRequestsQuery,
} from './service-requests.schemas.js';

/**
 * The signed-in customer's OWN requests. A request that is not yours is a 404, the same as one that
 * does not exist. Statuses are never accepted from the client: the only ways to change one are the
 * two actions below. An assistant account may also post requests (it is a customer too, D-025).
 */
@ApiTags('service requests (customer)')
@ApiCookieAuth()
@Roles('CUSTOMER', 'ASSISTANT')
@Controller('service-requests')
@UseGuards(RateLimitGuard)
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Post()
  @RequireVerifiedEmail()
  @RateLimit({ name: 'service-request-create', limit: 30, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Post a request for a delegable task',
    description:
      'The task must be delegable, active, and consistent with the city and optional venue. Free text must not contain contact details. Nothing is charged.',
  })
  @ApiBody(zodBodySchema(CreateRequestDto))
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateRequestDto, @Req() req: Request) {
    return this.requests.create(user, dto, requestContext(req));
  }

  @Get()
  @ApiOperation({ summary: 'My requests (newest first), optionally by status' })
  list(@CurrentUser() user: PublicUser, @Query() query: ListRequestsQuery) {
    return this.requests.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my requests with every quote on it (404 unless it is mine)' })
  get(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.getMine(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'service-request-cancel', limit: 60, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Cancel my request (closes every live quote)',
    description: 'A reason is required once a quote has been accepted.',
  })
  @ApiBody(zodBodySchema(CancelRequestDto))
  cancel(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRequestDto,
    @Req() req: Request,
  ) {
    return this.requests.cancel(user, id, dto, requestContext(req));
  }

  @Post(':id/quotes/:quoteId/select')
  @HttpCode(200)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'quote-select', limit: 60, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Accept one quote (all others become not-selected, atomically). No payment is taken.',
  })
  select(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Req() req: Request,
  ) {
    return this.requests.selectQuote(user, id, quoteId, requestContext(req));
  }
}
