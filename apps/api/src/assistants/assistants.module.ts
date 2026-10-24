import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module.js';
import type { Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { AssistantEligibilityGuard } from './eligibility.guard.js';
import { AssistantEligibilityService } from './assistant-eligibility.service.js';
import { AssistantsAdminController } from './assistants.admin.controller.js';
import { AssistantsAdminService } from './assistants.admin.service.js';
import { AssistantsController } from './assistants.controller.js';
import { AssistantsPublicController } from './assistants.public.controller.js';
import { AssistantsPublicService } from './assistants-public.service.js';
import { AssistantsService } from './assistants.service.js';
import { PhoneVerificationService } from './phone-verification.service.js';
import { DevSmsService } from './sms/dev-sms.service.js';
import { SmsService } from './sms/sms.service.js';
import { UnconfiguredSmsService } from './sms/unconfigured-sms.service.js';

@Module({
  imports: [AdminModule],
  // `assistants/me` must be registered before the public `assistants/:slug` route.
  controllers: [AssistantsController, AssistantsPublicController, AssistantsAdminController],
  providers: [
    AssistantsService,
    AssistantsPublicService,
    AssistantsAdminService,
    PhoneVerificationService,
    AssistantEligibilityService,
    AssistantEligibilityGuard,
    {
      // No real SMS provider exists (DECISIONS D-038): "dev" simulates delivery for local work only,
      // anything else is honestly unavailable.
      provide: SmsService,
      inject: [ConfigService, MailService],
      useFactory: (config: ConfigService<Env, true>, mail: MailService): SmsService =>
        config.get('SMS_PROVIDER', { infer: true }) === 'dev'
          ? new DevSmsService(mail)
          : new UnconfiguredSmsService(),
    },
  ],
  exports: [
    AssistantEligibilityService,
    AssistantEligibilityGuard,
    SmsService,
    PhoneVerificationService,
  ],
})
export class AssistantsModule {}
