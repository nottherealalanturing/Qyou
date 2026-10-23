import type { MailMessage } from './mail.service.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function passwordResetEmail(input: {
  to: string;
  name: string;
  link: string;
  expiresInMinutes: number;
}): MailMessage {
  const { to, name, link, expiresInMinutes } = input;
  return {
    to,
    subject: 'Reset your Qyou password',
    text: [
      `Hi ${name},`,
      '',
      'We received a request to reset your Qyou password. Open this link to choose a new one:',
      link,
      '',
      `The link works once and expires in ${expiresInMinutes} minutes.`,
      "If you didn't ask for this, you can ignore this email — your password stays the same.",
    ].join('\n'),
    html: `<p>Hi ${escapeHtml(name)},</p>
<p>We received a request to reset your Qyou password.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#d13f29;color:#ffffff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">Choose a new password</a></p>
<p>The link works once and expires in ${expiresInMinutes} minutes.</p>
<p>If you didn't ask for this, you can ignore this email — your password stays the same.</p>`,
  };
}
