import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { PublicUser } from '../auth/auth.types.js';
import { AdminOnly } from '../authz/roles.decorator.js';
import { clientIp, clientUserAgent } from '../common/http/request-context.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { AdminUsersService, type AssignedUser } from './admin-users.service.js';
import { AssignRoleDto } from './admin.schemas.js';

@ApiTags('admin')
@ApiCookieAuth()
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly users: AdminUsersService) {}

  @Patch('users/:id/role')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a user’s role (CUSTOMER, ASSISTANT or BUSINESS_STAFF)',
    description:
      'Administrator only (verified email). Cannot target yourself or another administrator, and ' +
      'cannot grant ADMIN — administrators are created with the bootstrap CLI only.',
  })
  @ApiBody(zodBodySchema(AssignRoleDto))
  @ApiResponse({ status: 200, description: 'Role set' })
  @ApiResponse({ status: 403, description: 'Not an administrator / forbidden target' })
  async assignRole(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
    @Req() req: Request,
  ): Promise<{ user: AssignedUser }> {
    const user = await this.users.assignRole(actor, id, dto.role, {
      ip: clientIp(req),
      userAgent: clientUserAgent(req),
    });
    return { user };
  }
}
