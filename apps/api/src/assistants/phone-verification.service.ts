import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { validationFailed } from '../common/http/validation-error.js';
import { tooManyRequests } from '../common/rate-limit/rate-limit.guard.js';
import { RateLimiter } from '../common/rate-limit/rate-limiter.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { canVerifyPhone } from './application-state.js';
import {
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_TTL_MS,
  generatePhoneCode,
  hashPhoneCode,
  phoneCodeMatches,
} from './phone-code.js';
import { SmsService } from './sms/sms.service.js';

const HOUR = 60 * 60 * 1000;
const wrongCode = () =>
  validationFailed([{ path: 'code', message: 'That code is incorrect or has expired' }]);

export type PhoneRequestResult =
  | { status: 'sent'; expiresInSeconds: number; resendAfterSeconds: number; transport: string }
  | { status: 'already_verified' };

@Injectable()
export class PhoneVerificationService {
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('PHONE_CODE_PEPPER', { infer: true });
  }

  private async load(userId: string) {
    const profile = await this.prisma.assistantProfile.findUnique({
      where: { userId },
      include: { privateDetails: true },
    });
    if (!profile)
      throw validationFailed([{ path: 'phone', message: 'Start your application first' }]);
    if (!canVerifyPhone(profile.status))
      throw new ConflictException('Phone verification is not available for this application');
    return profile;
  }

  /**
   * Sends a one-time code to the number on the application. Fails closed: if no SMS transport is
   * available the request is refused (503) BEFORE any code is created, so the system never claims
   * a message went out that did not.
   */
  async requestCode(user: PublicUser, ctx: RequestContext): Promise<PhoneRequestResult> {
    const profile = await this.load(user.id);
    const phone = profile.privateDetails?.phoneE164;
    if (!phone)
      throw validationFailed([{ path: 'phone', message: 'Add your mobile number first' }]);
    if (profile.privateDetails?.phoneVerifiedAt) return { status: 'already_verified' };

    if (!this.sms.isAvailable()) {
      throw new ServiceUnavailableException(
        'Phone verification is not available yet. We will let you know when it is',
      );
    }

    // Layered limits: a cooldown, a per-user cap, and a per-NUMBER cap (so Qyou cannot be used to spam a number).
    const checks = [
      await this.limiter.hit(`phone-code-cooldown:${user.id}`, 1, 60_000),
      await this.limiter.hit(`phone-code-user:${user.id}`, 5, HOUR),
      await this.limiter.hit(`phone-code-number:${phone}`, 3, HOUR),
    ];
    const blocked = checks.find((c) => !c.allowed);
    if (blocked) throw tooManyRequests(blocked.retryAfterSeconds);

    const code = generatePhoneCode();
    const tokenId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.phoneVerificationToken.updateMany({
        where: { profileId: profile.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.phoneVerificationToken.create({
        data: {
          id: tokenId,
          profileId: profile.id,
          phoneE164: phone,
          codeHash: hashPhoneCode(this.pepper, tokenId, phone, code),
          expiresAt: new Date(Date.now() + PHONE_CODE_TTL_MS),
        },
      });
    });

    try {
      await this.sms.send(
        phone,
        `Your Qyou verification code is ${code}. It expires in 10 minutes. Never share it with anyone.`,
      );
    } catch {
      // Not delivered: discard the code so a "sent" state can never exist for a message that was not.
      await this.prisma.phoneVerificationToken.deleteMany({ where: { id: tokenId } });
      throw new ServiceUnavailableException(
        'We could not send the code. Please try again in a moment',
      );
    }

    await this.audit.record({
      action: 'assistant.phone.code_requested',
      actorUserId: user.id,
      targetType: 'assistant_profile',
      targetId: profile.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { transport: this.sms.transport, last4: phone.slice(-4) },
    });
    return {
      status: 'sent',
      expiresInSeconds: PHONE_CODE_TTL_MS / 1000,
      resendAfterSeconds: 60,
      transport: this.sms.transport,
    };
  }

  /**
   * Verifies a code. Single-use (atomic claim), expiring, attempt-limited (atomic counter, so
   * parallel guesses cannot exceed the cap), and rate-limited per user.
   */
  async verify(
    user: PublicUser,
    code: string,
    ctx: RequestContext,
  ): Promise<{ status: 'verified' | 'already_verified' }> {
    const profile = await this.load(user.id);
    const phone = profile.privateDetails?.phoneE164;
    if (!phone)
      throw validationFailed([{ path: 'phone', message: 'Add your mobile number first' }]);
    if (profile.privateDetails?.phoneVerifiedAt) return { status: 'already_verified' };

    const limit = await this.limiter.hit(`phone-verify-user:${user.id}`, 10, 15 * 60_000);
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);

    const now = new Date();
    const token = await this.prisma.phoneVerificationToken.findFirst({
      where: { profileId: profile.id, phoneE164: phone, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) throw wrongCode();

    // Count the attempt BEFORE comparing: concurrent guesses cannot slip past the cap.
    const counted = await this.prisma.phoneVerificationToken.updateMany({
      where: {
        id: token.id,
        usedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: PHONE_CODE_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) throw wrongCode();

    const expected = hashPhoneCode(this.pepper, token.id, token.phoneE164, code);
    if (!phoneCodeMatches(token.codeHash, expected)) {
      await this.audit.record({
        action: 'assistant.phone.verification_failed',
        actorUserId: user.id,
        targetType: 'assistant_profile',
        targetId: profile.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw wrongCode();
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.phoneVerificationToken.updateMany({
          where: { id: token.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw wrongCode();
        const verified = await tx.assistantPrivateDetails.updateMany({
          where: { profileId: profile.id, phoneE164: token.phoneE164, phoneVerifiedAt: null },
          data: { phoneVerifiedAt: new Date() },
        });
        if (verified.count !== 1) throw wrongCode(); // the number was changed while the code was in flight
        await this.audit.record(
          {
            action: 'assistant.phone.verified',
            actorUserId: user.id,
            targetType: 'assistant_profile',
            targetId: profile.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { last4: phone.slice(-4) },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('This number cannot be used for verification');
      // A concurrent request with the same correct code may have just succeeded: that is success, not an error.
      const current = await this.prisma.assistantPrivateDetails.findUnique({
        where: { profileId: profile.id },
        select: { phoneE164: true, phoneVerifiedAt: true },
      });
      if (current?.phoneVerifiedAt && current.phoneE164 === phone)
        return { status: 'already_verified' };
      throw error;
    }
    return { status: 'verified' };
  }

  async purgeExpired(): Promise<void> {
    await this.prisma.phoneVerificationToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * HOUR) } },
    });
  }
}
