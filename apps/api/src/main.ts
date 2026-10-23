import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, APP_OPTIONS);
configureApp(app);

const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true });
await app.listen(port);
new Logger('Bootstrap').log(`Qyou API listening on :${port} (docs at /docs)`);
