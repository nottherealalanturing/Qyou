import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { PublicCache } from '../common/http/public-cache.decorator.js';
import { ServiceCategoriesService } from './service-categories.service.js';
import type { PublicCategory, PublicTask } from './serializers.js';

@Public()
@ApiTags('service categories (public)')
@Controller('service-categories')
export class ServiceCategoriesPublicController {
  constructor(private readonly categories: ServiceCategoriesService) {}

  @Get()
  @PublicCache()
  @ApiOperation({
    summary: 'Active service categories',
    description:
      'Ordered by sortOrder. `locationCount` counts only approved locations in active cities; it is 0 until locations are added.',
  })
  @ApiOkResponse({ description: '`{ items: PublicCategory[] }`' })
  async list(): Promise<{ items: PublicCategory[] }> {
    return { items: await this.categories.listPublic() };
  }

  @Get(':slug')
  @PublicCache()
  @ApiOperation({
    summary: 'One active category with its active tasks and their eligibility',
    description: 'Inactive or unknown categories return 404.',
  })
  async get(
    @Param('slug') slug: string,
  ): Promise<{ category: PublicCategory; tasks: PublicTask[] }> {
    return this.categories.getPublicBySlug(slug);
  }
}
