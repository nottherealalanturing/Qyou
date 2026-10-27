import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { GLOBAL_GUARDS } from './app.guards.js';
import { AssistantsModule } from './assistants/assistants.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { ZodValidationPipe } from './common/zod/zod-validation.pipe.js';
import { parseEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { SeedModule } from './seed/seed.module.js';
import { ServiceCategoriesModule } from './service-categories/service-categories.module.js';
import { ServiceLocationsModule } from './service-locations/service-locations.module.js';
import { ServiceRequestsModule } from './service-requests/service-requests.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: parseEnv }),
    PrismaModule,
    RateLimitModule,
    AuditModule,
    MailModule,
    AuthModule,
    AdminModule,
    ServiceCategoriesModule,
    ServiceLocationsModule,
    AssistantsModule,
    ServiceRequestsModule,
    SeedModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ...GLOBAL_GUARDS,
  ],
})
export class AppModule {}
