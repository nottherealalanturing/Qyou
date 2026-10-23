import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import { MailService, type MailMessage } from './mail.service.js';

@Injectable()
export class SmtpMailService extends MailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }) ?? 'localhost',
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      ...(user && pass ? { auth: { user, pass } } : {}),
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
