import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { PublicCache } from '../common/http/public-cache.decorator.js';
import type { Page } from '../common/pagination.js';
import {
  ServiceLocationsService,
  type PublicCity,
  type PublicLocation,
} from './service-locations.service.js';
import { PublicLocationQuery } from './service-locations.schemas.js';

@Public()
@ApiTags('cities & service locations (public)')
@Controller()
export class ServiceLocationsPublicController {
  constructor(private readonly locations: ServiceLocationsService) {}

  @Get('cities')
  @PublicCache()
  @ApiOperation({
    summary: 'Active launch cities',
    description:
      'A city is a place, not a venue. `locationCount` counts approved venues and is 0 until some are added.',
  })
  @ApiOkResponse({ description: '`{ items: PublicCity[] }`' })
  async cities(): Promise<{ items: PublicCity[] }> {
    return { items: await this.locations.listCities() };
  }

  @Get('cities/:slug')
  @PublicCache()
  async city(@Param('slug') slug: string): Promise<{ city: PublicCity }> {
    return { city: await this.locations.getCity(slug) };
  }

  @Get('service-locations')
  @PublicCache()
  @ApiOperation({
    summary: 'Approved service locations (paginated)',
    description:
      'Only APPROVED locations in active categories and cities. Filters: `city` and `category` (slugs), `q` (case-insensitive match on name or address). `pageSize` is capped at 50.',
  })
  async list(@Query() query: PublicLocationQuery): Promise<Page<PublicLocation>> {
    return this.locations.listLocations(query);
  }

  @Get('service-locations/:slug')
  @PublicCache()
  @ApiOperation({
    summary: 'One approved location, its tasks and venue-specific restrictions',
    description: 'Pending, rejected, archived or hidden locations return 404.',
  })
  async get(@Param('slug') slug: string) {
    return this.locations.getLocation(slug);
  }
}
