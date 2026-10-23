import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { tooManyRequests } from '../common/rate-limit/rate-limit.guard.js';
import { RateLimiter } from '../common/rate-limit/rate-limiter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SessionGrant } from './auth.service.js';
import { SESSION_IDLE_TTL_MS, type PublicUser, type RequestContext } from './auth.types.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const WINDOW_MS = 15 * 60 * 1000;
/** Wrong "current password" guesses allowed per account per window (stolen-session defence). */
const MAX_CURRENT_PASSWORD_FAILURES = 5;

export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
  current: boolean;
}

function fieldError(path: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    issues: [{ path, message }],
  });
}

@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Changes the password of a signed-in user.
   *
   * Session policy: every session of the user — including the current one — is revoked and the
   * current device immediately receives a brand-new session (token rotation). The device stays
   * logged in; every other device, and any copy of the old token, is logged out.
   */
  async changePassword(
    user: PublicUser,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ): Promise<SessionGrant> {
    const failKey = `pwchange-fail:${user.id}`;
    const blockedFor = await this.limiter.retryAfterSeconds(
      failKey,
      MAX_CURRENT_PASSWORD_FAILURES,
      WINDOW_MS,
    );
    if (blockedFor > 0) throw tooManyRequests(blockedFor);

    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw new NotFoundException();

    const currentOk = await this.passwords.verify(record.passwordHash, input.currentPassword);
    if (!currentOk) {
      await this.limiter.hit(failKey, MAX_CURRENT_PASSWORD_FAILURES, WINDOW_MS);
      await this.audit.record({
        action: 'auth.password_change.failure',
        actorUserId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw fieldError('currentPassword', 'Your current password is incorrect');
    }
    if (input.newPassword === input.currentPassword) {
      throw fieldError('newPassword', 'Choose a password different from your current one');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);

    return this.prisma.$transaction(async (tx) => {
      // Optimistic concurrency: only succeed if the password is still the one we verified, so
      // two simultaneous changes (or a reset in between) cannot silently overwrite each other.
      const updated = await tx.user.updateMany({
        where: { id: user.id, passwordHash: record.passwordHash },
        data: { passwordHash },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Your password was just changed elsewhere. Please try again.');
      }
      const revoked = await this.sessions.revokeAllForUser(user.id, tx);
      const session = await this.sessions.create(user.id, ctx.userAgent, tx);
      await this.audit.record(
        {
          action: 'auth.password_changed',
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { sessionsRevoked: revoked },
        },
        tx,
      );
      await this.limiter.clear(failKey);
      return { user, token: session.token, expiresAt: session.expiresAt };
    });
  }

  /** Revokes every session of the user, including the current one. */
  async logoutEverywhere(user: PublicUser, ctx: RequestContext): Promise<number> {
    const revoked = await this.sessions.revokeAllForUser(user.id);
    await this.audit.record({
      action: 'auth.logout_all',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { sessionsRevoked: revoked },
    });
    return revoked;
  }

  async listSessions(user: PublicUser, currentSessionId: string): Promise<SessionSummary[]> {
    const now = Date.now();
    const rows = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        lastSeenAt: { gt: new Date(now - SESSION_IDLE_TTL_MS) },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true },
    });
    return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
  }

  /**
   * Resource-level authorization example: the query itself is scoped to the caller
   * (`userId: user.id`). Someone else's session id is indistinguishable from a non-existent one
   * (404), so ids cannot be probed.
   */
  async revokeSession(user: PublicUser, sessionId: string, ctx: RequestContext): Promise<void> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) throw new NotFoundException('Session not found');
    await this.audit.record({
      action: 'auth.session_revoked',
      actorUserId: user.id,
      targetType: 'session',
      targetId: sessionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}
