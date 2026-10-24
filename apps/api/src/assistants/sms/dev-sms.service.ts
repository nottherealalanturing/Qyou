import { Injectable } from '@nestjs/common';
import { MailService } from '../../mail/mail.service.js';
import { SmsService } from './sms.service.js';

/**
 * LOCAL DEVELOPMENT ONLY (SMS_PROVIDER=dev, rejected by env validation in production).
 * Nothing is sent to a phone: the "SMS" is delivered as an email to the Mailpit inbox, loudly
 * labelled as simulated, so a developer can read the code without it appearing in any log.
 */
@Injectable()
export class DevSmsService extends SmsService {
  readonly transport = 'simulated-dev';

  constructor(private readonly mail: MailService) {
    super();
  }

  isAvailable(): boolean {
    return true;
  }

  async send(toE164: string, text: string): Promise<void> {
    await this.mail.send({
      to: `sms+${toE164.replace('+', '')}@sms.qyou.local`,
      subject: `[SIMULATED SMS to ${toE164}] — not sent to any phone`,
      text: `SIMULATED SMS (local development only — nothing was sent to a phone)\n\nTo: ${toE164}\n\n${text}\n`,
      html: `<p><strong>SIMULATED SMS</strong> (local development only — nothing was sent to a phone)</p><p>To: ${toE164}</p><pre>${text.replace(/</g, '&lt;')}</pre>`,
    });
  }
}
