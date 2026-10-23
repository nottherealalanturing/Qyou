import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { HealthService, ReadinessReport } from './health.service.js';

function controllerWith(report: ReadinessReport) {
  const service = { readiness: async () => report } as unknown as HealthService;
  return new HealthController(service);
}

describe('HealthController', () => {
  it('reports liveness without touching dependencies', () => {
    expect(controllerWith({} as ReadinessReport).live()).toEqual({ status: 'ok' });
  });

  it('returns the report when the database is up', async () => {
    const report: ReadinessReport = { status: 'ok', checks: { database: 'up' }, timestamp: 't' };
    await expect(controllerWith(report).ready()).resolves.toEqual(report);
  });

  it('responds 503 when the database is down', async () => {
    const report: ReadinessReport = {
      status: 'error',
      checks: { database: 'down' },
      timestamp: 't',
    };
    const error = await controllerWith(report)
      .ready()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
  });
});
