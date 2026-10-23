import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: { database: 'up' | 'down' };
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<ReadinessReport> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      database = 'down';
      this.logger.error(
        'Database readiness check failed',
        error instanceof Error ? error.stack : error,
      );
    }
    return {
      status: database === 'up' ? 'ok' : 'error',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }
}
