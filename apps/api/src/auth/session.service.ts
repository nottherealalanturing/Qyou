import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  type AuthContext,
} from './auth.types.js';
import { generateToken, hashToken, isWellFormedToken } from './tokens.js';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a session and returns the raw token (shown to the client once; only its hash is stored). */
  async create(
    userId: string,
    userAgent: string | undefined,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS);
    const session = await tx.session.create({
      data: { userId, tokenHash: hashToken(token), userAgent: userAgent ?? null, expiresAt },
      select: { id: true },
    });
    return { token, sessionId: session.id, expiresAt };
  }

  /** Resolves a cookie token to an authenticated context, or null if it is not currently valid. */
  async resolve(token: string | undefined): Promise<AuthContext | null> {
    if (!isWellFormedToken(token)) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;

    const now = Date.now();
    const valid =
      session.revokedAt === null &&
      session.expiresAt.getTime() > now &&
      now - session.lastSeenAt.getTime() < SESSION_IDLE_TTL_MS &&
      session.user.status === 'ACTIVE';
    if (!valid) return null;

    if (now - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      await this.prisma.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: new Date(now) },
      });
    }

    const { user } = session;
    return {
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
        createdAt: user.createdAt,
      },
    };
  }

  /** Revokes the session for a raw token. Returns the user id if a live session was revoked. */
  async revokeByToken(
    token: string | undefined,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null> {
    if (!isWellFormedToken(token)) return null;
    const tokenHash = hashToken(token);
    const session = await tx.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return null;
    const { count } = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1 ? session.userId : null;
  }

  async revokeAllForUser(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const { count } = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Housekeeping: removes sessions that can never be valid again. */
  async deleteExpired(): Promise<number> {
    const now = Date.now();
    const { count } = await this.prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now) } },
          { revokedAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } },
          { lastSeenAt: { lt: new Date(now - SESSION_IDLE_TTL_MS) } },
        ],
      },
    });
    return count;
  }
}
