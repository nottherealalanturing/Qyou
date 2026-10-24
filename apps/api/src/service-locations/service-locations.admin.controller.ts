import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ServiceLocationsAdminService } from './service-locations.admin.service.js';
import {
  AdminCityListQuery,
  AdminLocationQuery,
  CreateCityDto,
  CreateLocationDto,
  CreateRestrictionDto,
  UpdateCityDto,
  UpdateLocationDto,
} from './service-locations.schemas.js';

/** Administrator-only management of cities, locations and venue restrictions. Every write is audited. */
@ApiTags('cities & service locations (admin)')
@ApiCookieAuth()
@AdminOnly()
@Controller('admin')
export class ServiceLocationsAdminController {
  constructor(private readonly service: ServiceLocationsAdminService) {}

  // cities
  @Get('cities')
  async listCities(@Query() query: AdminCityListQuery) {
    return { items: await this.service.listCities(query.includeInactive) };
  }

  @Post('cities')
  @ApiBody(zodBodySchema(CreateCityDto))
  async createCity(
    @CurrentUser() actor: PublicUser,
    @Body() dto: CreateCityDto,
    @Req() req: Request,
  ) {
    return { city: await this.service.createCity(actor, dto, requestContext(req)) };
  }

  @Patch('cities/:id')
  @HttpCode(200)
  @ApiBody(zodBodySchema(UpdateCityDto))
  async updateCity(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCityDto,
    @Req() req: Request,
  ) {
    return { city: await this.service.updateCity(actor, id, dto, requestContext(req)) };
  }

  // locations
  @Get('service-locations')
  @ApiOperation({
    summary: 'All locations in every status (filter with status, city, category, q)',
  })
  async listLocations(@Query() query: AdminLocationQuery) {
    return this.service.listLocations(query);
  }

  @Get('service-locations/:id')
  async getLocation(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getLocation(id);
  }

  @Post('service-locations')
  @ApiOperation({
    summary: 'Create a location (starts PENDING_REVIEW unless status APPROVED is given)',
    description:
      'City, category and slug cannot be changed afterwards. Never enter a venue you have not verified.',
  })
  @ApiBody(zodBodySchema(CreateLocationDto))
  async createLocation(
    @CurrentUser() actor: PublicUser,
    @Body() dto: CreateLocationDto,
    @Req() req: Request,
  ) {
    return { location: await this.service.createLocation(actor, dto, requestContext(req)) };
  }

  @Patch('service-locations/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update a location or move it through its lifecycle',
    description:
      'Status transitions: PENDING_REVIEW→APPROVED|REJECTED, APPROVED→ARCHIVED, REJECTED→PENDING_REVIEW, ARCHIVED→APPROVED. Others return 409.',
  })
  @ApiBody(zodBodySchema(UpdateLocationDto))
  async updateLocation(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
    @Req() req: Request,
  ) {
    return { location: await this.service.updateLocation(actor, id, dto, requestContext(req)) };
  }

  // restrictions
  @Post('service-locations/:id/restrictions')
  @ApiBody(zodBodySchema(CreateRestrictionDto))
  async addRestriction(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRestrictionDto,
    @Req() req: Request,
  ) {
    return { restriction: await this.service.addRestriction(actor, id, dto, requestContext(req)) };
  }

  @Delete('service-locations/:id/restrictions/:restrictionId')
  @HttpCode(204)
  async removeRestriction(
    @CurrentUser() actor: PublicUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('restrictionId', ParseUUIDPipe) restrictionId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.removeRestriction(actor, id, restrictionId, requestContext(req));
  }
}
