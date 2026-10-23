import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { tooManyRequests } from '../common/rate-limit/rate-limit.guard.js';
import { RateLimiter } from '../common/rate-limit/rate-limiter.js';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { emailVerificationEmail } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EMAIL_VERIFICATION_TTL_MS, type PublicUser, type RequestContext } from './auth.types.js';
import { generateToken, hashToken } from './tokens.js';

const RESENDS_PER_USER_PER_HOUR = 3;
const INVALID_LINK = 'This verification link is invalid or has expired.';

export type VerificationOutcome = 'verified' | 'already_verified';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Creates a fresh token for the user's CURRENT email inside the caller's transaction and
   * invalidates any older unused ones (newest link wins). Returns the raw token, which exists
   * only in memory until it is emailed; the database keeps its hash.
   */
  async createToken(
    tx: Prisma.TransactionClient,
    user: { id: string; email: string },
  ): Promise<string> {
    const token = generateToken();
    await tx.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.emailVerificationToken.create({
      data: {
        userId: user.id,
        email: user.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    return token;
  }

  /** Fire-and-forget delivery; failures are logged by error name only (D-020). */
  sendEmail(user: { email: string; name: string }, token: string): void {
    const link = `${this.config.get('WEB_BASE_URL', { infer: true })}/verify-email#token=${token}`;
    void this.mail
      .send(
        emailVerificationEmail({
          to: user.email,
          name: user.name,
          link,
          expiresInHours: EMAIL_VERIFICATION_TTL_MS / 3_600_000,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to send verification email (${error instanceof Error ? error.name : 'error'})`,
        );
      });
  }

  /** Authenticated resend. Idempotent for already-verified users; rate-limited per user. */
  async resend(user: PublicUser, ctx: RequestContext): Promise<'sent' | 'already_verified'> {
    if (user.emailVerified) return 'already_verified';

    const limit = await this.limiter.hit(
      `verify-resend:${user.id}`,
      RESENDS_PER_USER_PER_HOUR,
      60 * 60 * 1000,
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);

    const token = await this.prisma.$transaction(async (tx) => {
      const created = await this.createToken(tx, user);
      await this.audit.record(
        {
          action: 'auth.email_verification.requested',
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return created;
    });
    this.sendEmail(user, token);
    return 'sent';
  }

  /**
   * Public (the link may be opened in a different browser than the one with the session).
   * Possession of the token is the credential. The same response for unknown, expired, malformed
   * and superseded tokens, so nothing about accounts is revealed.
   *
   * Concurrency: the single-use claim is one atomic `UPDATE … WHERE usedAt IS NULL AND expiresAt
   * > now()`. Of N concurrent requests exactly one gets count = 1 ("verified"); the others wait
   * on the row lock, then see the committed result and return "already_verified" (idempotent).
   */
  async confirm(token: string, ctx: RequestContext): Promise<VerificationOutcome> {
    const tokenHash = hashToken(token);
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      const record = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
      });
      // A token only ever verifies the exact address it was sent to.
      if (!record || record.email !== record.user.email) {
        throw new BadRequestException(INVALID_LINK);
      }

      if (claimed.count === 1) {
        await tx.user.updateMany({
          where: { id: record.userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: now },
        });
        await this.audit.record(
          {
            action: 'auth.email_verified',
            actorUserId: record.userId,
            targetType: 'user',
            targetId: record.userId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { via: 'verification_link' },
          },
          tx,
        );
        return 'verified';
      }

      // Replaying a link that already did its job is harmless success, not an error.
      if (record.usedAt && record.user.emailVerifiedAt) return 'already_verified';
      throw new BadRequestException(INVALID_LINK);
    });
  }

  async purgeExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.prisma.emailVerificationToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
    });
  }
}
