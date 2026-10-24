import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminOnly } from '../authz/roles.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { ServiceCategoriesAdminService } from './service-categories.admin.service.js';
import {
  AdminListQuery,
  CreateCategoryDto,
  CreateTaskDto,
  UpdateCategoryDto,
  UpdateTaskDto,
} from './service-categories.schemas.js';

/** Administrator-only management of categories and their eligible tasks. Every write is audited. */
@ApiTags('service categories (admin)')
@ApiCookieAuth()
@AdminOnly()
@Controller('admin')
export class ServiceCategoriesAdminController {
  constructor(private readonly service: ServiceCategoriesAdminService) {}

  @Get('service-categories')
  @ApiOperation({
    summary: 'All categories, including inactive (set includeInactive=false to hide them)',
  })
  async list(@Query() query: AdminListQuery) {
    return { items: await this.service.list(query.includeInactive) };
  }

  @Get('service-categories/:id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { category: await this.service.get(id) };
  }

  @Post('service-categories')
  @ApiOperation({
    summary: 'Create a category (slug derived from the name unless given; immutable)',
  })
  @ApiBody(zodBodySchema(CreateCategoryDto))
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Name or slug already exists' })
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() dto: CreateCategoryDto,
    @Req() req: Request,
  ) {
    return { category: await this.service.create(actor, dto, requestContext(req)) };
  }

  @Patch('service-categories/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update a category (deactivate with isActive=false; there is no delete)',
  })
  @ApiBody(zodBodySchema(UpdateCategoryDto))
  async update(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request,
  ) {
    return { category: await this.service.update(actor, id, dto, requestContext(req)) };
  }

  @Get('service-categories/:id/tasks')
  async listTasks(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminListQuery) {
    return { items: await this.service.listTasks(id, query.includeInactive) };
  }

  @Post('service-categories/:id/tasks')
  @ApiOperation({
    summary: 'Create an eligible task in a category',
    description:
      'Delegation rules are enforced: personal presence or credentials ⇒ NOT_DELEGABLE; REQUIRES_AUTHORIZATION needs authorizationNotes; NOT_DELEGABLE needs restrictionNotes.',
  })
  @ApiBody(zodBodySchema(CreateTaskDto))
  async createTask(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) categoryId: string,
    @Body() dto: CreateTaskDto,
    @Req() req: Request,
  ) {
    return { task: await this.service.createTask(actor, categoryId, dto, requestContext(req)) };
  }

  @Patch('eligible-tasks/:id')
  @HttpCode(200)
  @ApiBody(zodBodySchema(UpdateTaskDto))
  async updateTask(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: Request,
  ) {
    return { task: await this.service.updateTask(actor, id, dto, requestContext(req)) };
  }
}
