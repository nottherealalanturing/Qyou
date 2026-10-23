import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { HealthService, type ReadinessReport } from './health.service.js';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the process is running' })
  @ApiOkResponse({ description: 'Process is alive' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: dependencies (PostgreSQL) are reachable' })
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is down' })
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
