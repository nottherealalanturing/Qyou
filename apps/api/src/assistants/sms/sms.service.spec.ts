import { MailService, type MailMessage } from '../../mail/mail.service.js';
import { DevSmsService } from './dev-sms.service.js';
import { UnconfiguredSmsService } from './unconfigured-sms.service.js';

class CapturingMail extends MailService {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

describe('SMS transports', () => {
  it('the dev transport is available but labels the message as simulated', async () => {
    const mail = new CapturingMail();
    const sms = new DevSmsService(mail);
    expect(sms.isAvailable()).toBe(true);
    await sms.send('+2348031234567', 'Your Qyou code is 123456.');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.subject).toMatch(/SIMULATED SMS/);
    expect(mail.sent[0]?.text).toMatch(/nothing was sent to a phone/);
    expect(mail.sent[0]?.text).toContain('123456');
  });

  it('the unconfigured transport is unavailable and refuses to send', async () => {
    const sms = new UnconfiguredSmsService();
    expect(sms.isAvailable()).toBe(false);
    expect(sms.transport).toBe('none');
    await expect(sms.send()).rejects.toThrow(/not available/);
  });
});
