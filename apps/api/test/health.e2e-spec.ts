import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_OPTIONS, configureApp } from '../src/app.setup.js';

describe('Health (e2e, real PostgreSQL)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live -> 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready -> 200 with database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.checks.database).toBe('up');
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);
    expect(res.body.paths['/api/v1/health/ready']).toBeDefined();
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /api/v1/health/ready -> 503 when the database is down', async () => {
    const prisma = app.get(PrismaService);
    const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection lost'));
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(res.body.checks.database).toBe('down');
    spy.mockRestore();
    quiet.mockRestore();
  });
});
