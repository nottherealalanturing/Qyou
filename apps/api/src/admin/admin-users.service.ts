import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { lockAssistantForChange } from '../assistants/eligibility-locks.js';
import type { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AssignedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Changes a non-administrator's role. Rules (all enforced here, not in the UI):
   *  - an administrator cannot change their own role;
   *  - administrator accounts cannot be changed through this API at all, and ADMIN cannot be
   *    granted through it (the schema rejects it) — administrators only come from the CLI;
   *  - ASSISTANT / BUSINESS_STAFF require a verified email address;
   *  - the update is conditional on the role we read, so concurrent changes cannot interleave.
   */
  async assignRole(
    actor: PublicUser,
    targetId: string,
    role: Exclude<UserRole, 'ADMIN'>,
    ctx: RequestContext,
  ): Promise<AssignedUser> {
    return this.prisma.$transaction((tx) =>
      this.assignRoleInTransaction(tx, actor, targetId, role, ctx),
    );
  }

  /**
   * The single implementation of every role rule, runnable inside a caller's transaction so a
   * higher-level workflow (e.g. approving an assistant application) can change its own state and the
   * role atomically — and still goes through the SAME checks as the admin endpoint.
   */
  async assignRoleInTransaction(
    tx: Prisma.TransactionClient,
    actor: PublicUser,
    targetId: string,
    role: Exclude<UserRole, 'ADMIN'>,
    ctx: RequestContext,
  ): Promise<AssignedUser> {
    if (actor.id === targetId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    await lockAssistantForChange(tx, targetId);
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'ADMIN') {
      throw new ForbiddenException('Administrator accounts cannot be changed here');
    }
    if (role !== 'CUSTOMER' && !target.emailVerifiedAt) {
      throw new ConflictException('The user must verify their email address first');
    }

    if (target.role !== role) {
      const updated = await tx.user.updateMany({
        where: { id: targetId, role: target.role },
        data: { role },
      });
      if (updated.count !== 1) {
        throw new ConflictException('The user was changed by someone else. Try again.');
      }
      await this.audit.record(
        {
          action: 'admin.role_changed',
          actorUserId: actor.id,
          targetType: 'user',
          targetId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { from: target.role, to: role },
        },
        tx,
      );
    }
    return { id: target.id, email: target.email, name: target.name, role };
  }
}
