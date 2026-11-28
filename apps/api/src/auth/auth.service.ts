import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { tooManyRequests } from '../common/rate-limit/rate-limit.guard.js';
import { RateLimiter } from '../common/rate-limit/rate-limiter.js';
import type { Env } from '../config/env.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { accountExistsEmail, passwordResetEmail } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PASSWORD_RESET_TTL_MS, type PublicUser, type RequestContext } from './auth.types.js';
import { EmailVerificationService } from './email-verification.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { generateToken, hashToken } from './tokens.js';

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** Failed logins allowed per (email, IP) and per email (any IP) inside the window. */
const MAX_FAILURES_PER_EMAIL_AND_IP = 5;
const MAX_FAILURES_PER_EMAIL = 20;
const RESET_EMAILS_PER_ADDRESS_PER_HOUR = 3;
/** Registration attempts per address (new and existing alike) before further ones are silently dropped. */
const REGISTRATIONS_PER_ADDRESS_PER_HOUR = 3;

const INVALID_RESET_LINK = 'This reset link is invalid or has expired.';

export interface SessionGrant {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

function toPublicUser(
  user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt' | 'emailVerifiedAt'>,
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limiter: RateLimiter,
    private readonly verification: EmailVerificationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Enumeration-safe registration (D-056). Every well-formed request ends the same way for the
   * caller (no session, the same 202 body, no error for a taken address), whether the address is new,
   * already registered, verified, unverified or suspended. What differs happens only in the owner's
   * inbox: a new address gets a verification link; an existing, active account gets a "you already
   * have an account" note with login and reset links; anything else gets nothing.
   *
   * - The password is hashed FIRST on every path, so the dominant cost does not depend on whether the
   *   account exists (the remaining difference is a few database round trips; see ARCHITECTURE).
   * - A per-address limiter counts new and existing addresses alike. Over the limit the request is
   *   silently dropped: no account, no mail, same response, so the limit is not an oracle and the
   *   endpoint cannot be used to flood someone's inbox.
   * - The unique index stays the source of truth: losing a concurrent race is treated as "existing".
   */
  async register(
    input: { email: string; name: string; password: string },
    ctx: RequestContext,
  ): Promise<void> {
    // Hash before anything else: it is slow, must not hold a DB connection, and equalises timing.
    const passwordHash = await this.passwords.hash(input.password);

    const withinAddressLimit = (
      await this.limiter.hit(
        `register-address:${input.email}`,
        REGISTRATIONS_PER_ADDRESS_PER_HOUR,
        60 * 60 * 1000,
      )
    ).allowed;
    if (!withinAddressLimit) return;

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await this.noteExistingAccount(existing, ctx);
      return;
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash },
        });
        const emailToken = await this.verification.createToken(tx, user);
        await this.audit.record(
          {
            action: 'auth.register',
            actorUserId: user.id,
            targetType: 'user',
            targetId: user.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
        return { user, verificationToken: emailToken };
      });
      // After commit, so a rolled-back registration never sends mail.
      this.verification.sendEmail(created.user, created.verificationToken);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.user.findUnique({ where: { email: input.email } });
      if (raced) await this.noteExistingAccount(raced, ctx);
    }
  }

  /** Audits the attempt and, for an active account, tells its owner (only) what happened. */
  private async noteExistingAccount(user: User, ctx: RequestContext): Promise<void> {
    await this.audit.record({
      action: 'auth.register.existing_account',
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    if (user.status !== 'ACTIVE') return;
    const base = this.config.get('WEB_BASE_URL', { infer: true });
    void this.mail
      .send(
        accountExistsEmail({
          to: user.email,
          name: user.name,
          loginLink: `${base}/login`,
          resetLink: `${base}/forgot-password`,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to send account-exists email (${error instanceof Error ? error.name : 'error'})`,
        );
      });
  }

  async login(
    input: { email: string; password: string },
    ctx: RequestContext,
    previousSessionToken: string | undefined,
  ): Promise<SessionGrant> {
    const pairKey = `login-fail:${ctx.ip ?? 'unknown'}:${input.email}`;
    const accountKey = `login-fail-account:${input.email}`;

    const blockedFor = Math.max(
      await this.limiter.retryAfterSeconds(
        pairKey,
        MAX_FAILURES_PER_EMAIL_AND_IP,
        FAILURE_WINDOW_MS,
      ),
      await this.limiter.retryAfterSeconds(accountKey, MAX_FAILURES_PER_EMAIL, FAILURE_WINDOW_MS),
    );
    if (blockedFor > 0) {
      await this.audit.record({
        action: 'auth.login.blocked',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw tooManyRequests(blockedFor);
    }

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    let passwordOk: boolean;
    if (user) {
      passwordOk = await this.passwords.verify(user.passwordHash, input.password);
    } else {
      await this.passwords.verifyAgainstDummy(input.password);
      passwordOk = false;
    }

    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      await this.limiter.hit(pairKey, MAX_FAILURES_PER_EMAIL_AND_IP, FAILURE_WINDOW_MS);
      await this.limiter.hit(accountKey, MAX_FAILURES_PER_EMAIL, FAILURE_WINDOW_MS);
      await this.audit.record({
        action: 'auth.login.failure',
        actorUserId: user?.id ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        // Reason is internal only; the client always gets the same generic message.
        metadata: { reason: !user ? 'unknown_account' : !passwordOk ? 'bad_password' : 'inactive' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.limiter.clear(pairKey);

    // Session rotation: a successful login never reuses a session token. If the browser already
    // had a session, it is revoked atomically with issuing the new one (prevents fixation).
    return this.prisma.$transaction(async (tx) => {
      await this.sessions.revokeByToken(previousSessionToken, tx);
      const session = await this.sessions.create(user.id, ctx.userAgent, tx);
      await this.audit.record(
        {
          action: 'auth.login.success',
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return { user: toPublicUser(user), token: session.token, expiresAt: session.expiresAt };
    });
  }

  /** Idempotent: logging out without (or with an already-revoked) session is not an error. */
  async logout(token: string | undefined, ctx: RequestContext): Promise<void> {
    const userId = await this.sessions.revokeByToken(token);
    if (userId) {
      await this.audit.record({
        action: 'auth.logout',
        actorUserId: userId,
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }
  }

  /**
   * Always completes the same way regardless of whether the account exists, and never waits for
   * email delivery, so neither the response body nor its timing reveals account existence.
   */
  async requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
    const withinEmailLimit = (
      await this.limiter.hit(
        `reset-request:${email}`,
        RESET_EMAILS_PER_ADDRESS_PER_HOUR,
        60 * 60 * 1000,
      )
    ).allowed;
    // Over the per-address limit: silently do nothing (a visible error would be an oracle and a
    // way to harass a victim's inbox only if we kept sending).
    if (!withinEmailLimit) return;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    let token = '';
    await this.prisma.$transaction(async (tx) => {
      token = await this.createPasswordResetToken(tx, user.id, PASSWORD_RESET_TTL_MS);
      await this.audit.record(
        {
          action: 'auth.password_reset.requested',
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    // The token travels only in the email, inside the URL fragment (never sent to servers or
    // Referer headers). It is deliberately not logged anywhere.
    const link = `${this.config.get('WEB_BASE_URL', { infer: true })}/reset-password#token=${token}`;
    void this.mail
      .send(
        passwordResetEmail({
          to: user.email,
          name: user.name,
          link,
          expiresInMinutes: PASSWORD_RESET_TTL_MS / 60_000,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to send password reset email (${error instanceof Error ? error.name : 'error'})`,
        );
      });
  }

  /**
   * Issues a single-use reset token inside the caller's transaction. Concurrent requests for the
   * same user are serialised by a row lock so "only the newest link works" holds. Returns the raw
   * token (emailed, never stored); the database keeps only its hash.
   */
  async createPasswordResetToken(
    tx: Prisma.TransactionClient,
    userId: string,
    ttlMs: number,
  ): Promise<string> {
    const token = generateToken();
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  async confirmPasswordReset(
    input: { token: string; password: string },
    ctx: RequestContext,
  ): Promise<void> {
    // Hash first so valid and invalid tokens cost the same.
    const passwordHash = await this.passwords.hash(input.password);
    const tokenHash = hashToken(input.token);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Atomic single-use claim: of N concurrent requests with the same token exactly one matches
      // `usedAt IS NULL` and gets count 1; the others re-evaluate after the row lock and get 0.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException(INVALID_RESET_LINK);

      const record = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      // Receiving the reset email proves control of the mailbox, so it also verifies the address.
      const verified = await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      if (verified.count === 1) {
        await this.audit.record(
          {
            action: 'auth.email_verified',
            actorUserId: record.userId,
            targetType: 'user',
            targetId: record.userId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { via: 'password_reset' },
          },
          tx,
        );
      }
      // A reset means the old credentials may be compromised: end every session and any other
      // outstanding reset links.
      await this.sessions.revokeAllForUser(record.userId, tx);
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
      await this.audit.record(
        {
          action: 'auth.password_reset.completed',
          actorUserId: record.userId,
          targetType: 'user',
          targetId: record.userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /** Housekeeping for rows that can never be used again. */
  async purgeExpired(): Promise<void> {
    await this.sessions.deleteExpired();
    await this.verification.purgeExpired();
    await this.limiter.purgeExpired();
    await this.prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          { usedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        ],
      },
    });
  }
}
