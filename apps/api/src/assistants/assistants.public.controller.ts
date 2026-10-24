import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { PublicCache } from '../common/http/public-cache.decorator.js';
import { AssistantsPublicService } from './assistants-public.service.js';
import { PublicAssistantQuery } from './assistants.schemas.js';

@Public()
@ApiTags('assistants (public)')
@Controller('assistants')
export class AssistantsPublicController {
  constructor(private readonly assistants: AssistantsPublicService) {}

  @Get()
  @PublicCache()
  @ApiOperation({
    summary: 'Approved, fully verified assistants (paginated)',
    description:
      'Only assistants who are approved, have a passed identity review and a verified phone and email. Contact details and verification evidence are never included.',
  })
  list(@Query() query: PublicAssistantQuery) {
    return this.assistants.list(query);
  }

  @Get(':slug')
  @PublicCache()
  @ApiOperation({ summary: 'One public assistant profile (404 unless fully eligible)' })
  get(@Param('slug') slug: string) {
    return this.assistants.get(slug);
  }
}
