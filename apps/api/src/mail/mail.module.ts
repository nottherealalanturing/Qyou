import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { SmtpMailService } from './smtp-mail.service.js';

@Global()
@Module({
  providers: [{ provide: MailService, useClass: SmtpMailService }],
  exports: [MailService],
})
export class MailModule {}
