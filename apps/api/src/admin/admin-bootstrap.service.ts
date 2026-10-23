import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ADMIN_INVITE_TTL_MS } from '../auth/auth.types.js';
import { AuthService } from '../auth/auth.service.js';
import { normalizeEmail } from '../auth/auth.schemas.js';
import { PasswordService } from '../auth/password.service.js';
import type { Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { adminInviteEmail } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const inputSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()).transform(normalizeEmail),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\p{C}]+$/u),
});

export type BootstrapResult =
  | { status: 'created'; userId: string; emailSent: boolean }
  | { status: 'refused'; reason: 'admin_exists' | 'email_in_use' }
  | { status: 'invalid'; problems: string[] };

/**
 * Creates an administrator account. This is the ONLY way an ADMIN comes into existence: there is
 * no HTTP path, and registration/role-assignment reject the role.
 *
 * Credential handling: the operator never supplies or sees a password. The account is created
 * with a random password nobody knows, email pre-verified, and a single-use set-password link
 * (24 h) is emailed to the administrator, who chooses their own password.
 *
 * Fail-closed behaviour: refuses if any administrator already exists (unless `allowAdditional`),
 * refuses if the email already belongs to ANY account (it never promotes or edits an existing
 * user), and serialises concurrent runs with an advisory lock.
 */
@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async bootstrap(input: {
    email: string;
    name: string;
    allowAdditional?: boolean;
  }): Promise<BootstrapResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: 'invalid',
        problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    const { email, name } = parsed.data;
    const allowAdditional = input.allowAdditional === true;

    // A random password nobody ever sees: the account cannot be logged into until the invited
    // administrator sets their own through the emailed link.
    const unusableHash = await this.passwords.hash(randomBytes(32).toString('base64url'));

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('qyou:admin-bootstrap'))`;

      if (!allowAdditional && (await tx.user.count({ where: { role: 'ADMIN' } })) > 0) {
        return { kind: 'refused' as const, reason: 'admin_exists' as const };
      }
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        return { kind: 'refused' as const, reason: 'email_in_use' as const };
      }

      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash: unusableHash,
          role: 'ADMIN',
          emailVerifiedAt: new Date(),
        },
      });
      const token = await this.auth.createPasswordResetToken(tx, user.id, ADMIN_INVITE_TTL_MS);
      await this.audit.record(
        {
          action: 'admin.bootstrap',
          targetType: 'user',
          targetId: user.id,
          metadata: { via: 'cli', additional: allowAdditional, operator: safeOsUser() },
        },
        tx,
      );
      return { kind: 'created' as const, user, token };
    });

    if (outcome.kind === 'refused') return { status: 'refused', reason: outcome.reason };

    let emailSent = true;
    try {
      const link = `${this.config.get('WEB_BASE_URL', { infer: true })}/reset-password#token=${outcome.token}`;
      await this.mail.send(
        adminInviteEmail({
          to: outcome.user.email,
          name: outcome.user.name,
          link,
          expiresInHours: ADMIN_INVITE_TTL_MS / 3_600_000,
        }),
      );
    } catch {
      // The account exists; the operator can trigger a fresh link from /forgot-password.
      emailSent = false;
    }
    return { status: 'created', userId: outcome.user.id, emailSent };
  }
}

function safeOsUser(): string {
  try {
    return userInfo().username.slice(0, 64);
  } catch {
    return 'unknown';
  }
}
