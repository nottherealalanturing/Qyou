export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Transport boundary for outgoing email. Implementations must not log message bodies. */
export abstract class MailService {
  abstract send(message: MailMessage): Promise<void>;
}
