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
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminOnly } from '../authz/roles.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { AssistantsAdminService } from './assistants.admin.service.js';
import { AdminAssistantQuery, IdentityCheckDto, TransitionDto } from './assistants.schemas.js';

@ApiTags('assistants (admin review)')
@ApiCookieAuth()
@AdminOnly()
@Controller('admin/assistants')
export class AssistantsAdminController {
  constructor(private readonly admin: AssistantsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Review queue (no private details in the list)' })
  list(@Query() query: AdminAssistantQuery) {
    return this.admin.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Application detail incl. private details and identity outcomes (the read is audited)',
  })
  get(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.admin.get(actor, id, requestContext(req));
  }

  @Post(':id/identity-checks')
  @ApiOperation({
    summary: 'Record the OUTCOME of a manual identity review',
    description:
      'Outcomes only: no documents, photos or ID numbers are accepted or stored. `evidenceRef` is an opaque pointer to where the evidence is held off-system.',
  })
  @ApiBody(zodBodySchema(IdentityCheckDto))
  recordIdentityCheck(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IdentityCheckDto,
    @Req() req: Request,
  ) {
    return this.admin.recordIdentityCheck(actor, id, dto, requestContext(req));
  }

  @Post(':id/transitions')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Move an application through its lifecycle (every decision needs a reason and is audited)',
    description:
      'Legal moves: SUBMITTED→UNDER_REVIEW; UNDER_REVIEW→CHANGES_REQUESTED|APPROVED|REJECTED; REJECTED→UNDER_REVIEW; APPROVED→SUSPENDED; SUSPENDED→APPROVED|REJECTED. APPROVED grants the ASSISTANT role and SUSPENDED revokes it, atomically.',
  })
  @ApiBody(zodBodySchema(TransitionDto))
  transition(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @Req() req: Request,
  ) {
    return this.admin.transition(actor, id, dto, requestContext(req));
  }
}
