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

function button(link: string, label: string): string {
  return `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#d13f29;color:#ffffff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
}

export function emailVerificationEmail(input: {
  to: string;
  name: string;
  link: string;
  expiresInHours: number;
}): MailMessage {
  const { to, name, link, expiresInHours } = input;
  return {
    to,
    subject: 'Verify your Qyou email address',
    text: [
      `Hi ${name},`,
      '',
      'Confirm that this is your email address to finish setting up your Qyou account:',
      link,
      '',
      `The link works once and expires in ${expiresInHours} hours.`,
      "If you didn't create a Qyou account, you can ignore this email.",
    ].join('\n'),
    html: `<p>Hi ${escapeHtml(name)},</p>
<p>Confirm that this is your email address to finish setting up your Qyou account.</p>
${button(link, 'Verify email address')}
<p>The link works once and expires in ${expiresInHours} hours.</p>
<p>If you didn't create a Qyou account, you can ignore this email.</p>`,
  };
}

export function adminInviteEmail(input: {
  to: string;
  name: string;
  link: string;
  expiresInHours: number;
}): MailMessage {
  const { to, name, link, expiresInHours } = input;
  return {
    to,
    subject: 'Your Qyou administrator account',
    text: [
      `Hi ${name},`,
      '',
      'An administrator account has been created for you on Qyou. Set your password here:',
      link,
      '',
      `The link works once and expires in ${expiresInHours} hours.`,
      "If you weren't expecting this, do not use the link and tell your platform owner.",
    ].join('\n'),
    html: `<p>Hi ${escapeHtml(name)},</p>
<p>An administrator account has been created for you on Qyou.</p>
${button(link, 'Set your password')}
<p>The link works once and expires in ${expiresInHours} hours.</p>
<p>If you weren't expecting this, do not use the link and tell your platform owner.</p>`,
  };
}

export function accountExistsEmail(input: {
  to: string;
  name: string;
  loginLink: string;
  resetLink: string;
}): MailMessage {
  const { to, name, loginLink, resetLink } = input;
  return {
    to,
    subject: 'You already have a Qyou account',
    text: [
      `Hi ${name},`,
      '',
      'Someone, possibly you, tried to create a Qyou account with this email address.',
      'You already have one, so nothing was changed.',
      '',
      `Log in: ${loginLink}`,
      `Forgot your password? ${resetLink}`,
      '',
      "If this wasn't you, you can ignore this email.",
    ].join('\n'),
    html: `<p>Hi ${escapeHtml(name)},</p>
<p>Someone, possibly you, tried to create a Qyou account with this email address. You already have one, so nothing was changed.</p>
${button(loginLink, 'Log in')}
<p><a href="${escapeHtml(resetLink)}">Forgot your password?</a></p>
<p>If this wasn't you, you can ignore this email.</p>`,
  };
}
