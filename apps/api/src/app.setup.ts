import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Application, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env.js';

export const API_PREFIX = 'api/v1';

/** Largest accepted JSON request body. Auth payloads are well under 1 KiB. */
export const JSON_BODY_LIMIT = '16kb';

/**
 * The default body parser is disabled so the explicit size limit below applies. Both `main.ts`
 * and the e2e tests must create the app with these options.
 */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** Shared by main.ts and the e2e tests so both exercise the same configuration. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  (app.getHttpAdapter().getInstance() as Application).set('trust proxy', trustProxy || false);
  (app.getHttpAdapter().getInstance() as Application).disable('x-powered-by');

  // Swagger UI needs inline scripts/styles, so the strict CSP is relaxed for /docs only.
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/docs') ? docs : strict)(req, res, next),
  );
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Qyou API')
      .setDescription('Queue-assistance marketplace API')
      .setVersion('0.1.0')
      .addCookieAuth(
        config.get('NODE_ENV', { infer: true }) === 'production'
          ? '__Host-qyou_session'
          : 'qyou_session',
      )
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}
