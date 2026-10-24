import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminUsersService } from '../admin/admin-users.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { validationFailed } from '../common/http/validation-error.js';
import { skipTake, toPage } from '../common/pagination.js';
import type { ApplicationStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  allowedTransition,
  missingForSubmission,
  nextStatuses,
  reasonRequired,
} from './application-state.js';
import { formatMinutes } from './availability.js';
import type { AdminAssistantQuery, IdentityCheckDto, TransitionDto } from './assistants.schemas.js';

const MIN_REASON = 10;

export interface Requirements {
  emailVerified: boolean;
  phoneVerified: boolean;
  identityPassed: boolean;
  profileComplete: boolean;
  missing: { key: string; message: string }[];
}

@Injectable()
export class AssistantsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly roles: AdminUsersService,
  ) {}

  /** Facts needed to approve. Loaded inside the decision transaction so they cannot go stale. */
  private async requirements(
    tx: Prisma.TransactionClient,
    profileId: string,
  ): Promise<Requirements> {
    const profile = await tx.assistantProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: { user: { select: { emailVerifiedAt: true } }, privateDetails: true },
    });
    const [areaCount, offerCount, windowCount] = await Promise.all([
      tx.assistantServiceArea.count({ where: { profileId, city: { isActive: true } } }),
      tx.assistantTaskOffer.count({
        where: {
          profileId,
          task: {
            isActive: true,
            eligibility: { not: 'NOT_DELEGABLE' },
            category: { isActive: true },
          },
        },
      }),
      tx.assistantAvailabilityWindow.count({ where: { profileId } }),
    ]);
    const missing = missingForSubmission({
      displayName: profile.displayName,
      bio: profile.bio,
      languages: profile.languages,
      areaCount,
      offerCount,
      windowCount,
      legalName: profile.privateDetails?.legalName ?? null,
      phone: profile.privateDetails?.phoneE164 ?? null,
    });
    return {
      emailVerified: profile.user.emailVerifiedAt !== null,
      phoneVerified: profile.privateDetails?.phoneVerifiedAt != null,
      identityPassed: profile.identityOutcome === 'PASSED',
      profileComplete: missing.length === 0,
      missing,
    };
  }

  // ── review queue ──────────────────────────────────────────────────────────
  /** List view: deliberately no phone, legal name, email or evidence — those need an explicit, audited detail read. */
  async list(query: AdminAssistantQuery) {
    const where: Prisma.AssistantProfileWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.assistantProfile.findMany({
        where,
        select: {
          id: true,
          slug: true,
          displayName: true,
          status: true,
          identityOutcome: true,
          submittedAt: true,
          statusChangedAt: true,
          user: { select: { name: true, emailVerifiedAt: true } },
          privateDetails: { select: { phoneVerifiedAt: true } },
        },
        orderBy: [{ statusChangedAt: 'asc' }, { id: 'asc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.assistantProfile.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      applicantName: r.user.name,
      status: r.status,
      identityOutcome: r.identityOutcome,
      emailVerified: r.user.emailVerifiedAt !== null,
      phoneVerified: r.privateDetails?.phoneVerifiedAt != null,
      submittedAt: r.submittedAt,
      statusChangedAt: r.statusChangedAt,
    }));
    return toPage(items, total, query.page, query.pageSize);
  }

  /** Full review view. Reading the private fields is itself an audited event. */
  async get(actor: PublicUser, id: string, ctx: RequestContext) {
    const profile = await this.prisma.assistantProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
          },
        },
        privateDetails: true,
        serviceAreas: { include: { city: true } },
        taskOffers: { include: { task: { include: { category: true } } } },
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
        identityChecks: {
          orderBy: { createdAt: 'desc' },
          include: { checkedBy: { select: { name: true } } },
        },
      },
    });
    if (!profile) throw new NotFoundException('Application not found');

    await this.audit.record({
      action: 'admin.assistant.private_viewed',
      actorUserId: actor.id,
      targetType: 'assistant_profile',
      targetId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const requirements = await this.requirements(this.prisma, id);
    return {
      id: profile.id,
      slug: profile.slug,
      status: profile.status,
      statusReason: profile.statusReason,
      statusChangedAt: profile.statusChangedAt,
      submittedAt: profile.submittedAt,
      approvedAt: profile.approvedAt,
      identityOutcome: profile.identityOutcome,
      applicant: {
        name: profile.user.name,
        email: profile.user.email,
        role: profile.user.role,
        accountStatus: profile.user.status,
      },
      profile: {
        displayName: profile.displayName,
        bio: profile.bio,
        languages: profile.languages,
        availabilityNote: profile.availabilityNote,
      },
      private: {
        legalName: profile.privateDetails?.legalName ?? null,
        phone: profile.privateDetails?.phoneE164 ?? null,
        phoneVerified: profile.privateDetails?.phoneVerifiedAt != null,
      },
      services: {
        cities: profile.serviceAreas.map((a) => ({ slug: a.city.slug, name: a.city.name })),
        tasks: profile.taskOffers.map((o) => ({
          slug: o.task.slug,
          name: o.task.name,
          category: o.task.category.name,
          eligibility: o.task.eligibility,
        })),
      },
      availability: profile.availability.map((w) => ({
        dayOfWeek: w.dayOfWeek,
        start: formatMinutes(w.startMinute),
        end: formatMinutes(w.endMinute),
      })),
      // Outcomes only. There is no document, image or ID number anywhere in this system to show.
      identityChecks: profile.identityChecks.map((c) => ({
        id: c.id,
        result: c.result,
        method: c.method,
        evidenceRef: c.evidenceRef,
        notes: c.notes,
        checkedBy: c.checkedBy.name,
        createdAt: c.createdAt,
      })),
      requirements,
      allowedTransitions: nextStatuses(profile.status, 'admin'),
    };
  }

  // ── identity outcome ──────────────────────────────────────────────────────
  async recordIdentityCheck(
    actor: PublicUser,
    id: string,
    dto: IdentityCheckDto,
    ctx: RequestContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.assistantProfile.findUnique({ where: { id } });
      if (!profile) throw new NotFoundException('Application not found');
      if (profile.userId === actor.id)
        throw new ForbiddenException('You cannot review your own application');
      if (profile.status !== 'UNDER_REVIEW') {
        throw new ConflictException(
          'Identity outcomes can only be recorded while an application is under review',
        );
      }

      const check = await tx.identityCheck.create({
        data: {
          profileId: id,
          result: dto.result,
          method: 'MANUAL_REVIEW',
          evidenceRef: dto.evidenceRef ?? null,
          notes: dto.notes ?? null,
          checkedByUserId: actor.id,
        },
      });
      await tx.assistantProfile.update({ where: { id }, data: { identityOutcome: dto.result } });
      await this.audit.record(
        {
          action: 'admin.assistant.identity_check_recorded',
          actorUserId: actor.id,
          targetType: 'assistant_profile',
          targetId: id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            result: dto.result,
            method: 'MANUAL_REVIEW',
            hasEvidenceRef: dto.evidenceRef != null,
          },
        },
        tx,
      );
      return {
        id: check.id,
        result: check.result,
        method: check.method,
        createdAt: check.createdAt,
      };
    });
  }

  // ── decisions ─────────────────────────────────────────────────────────────
  /**
   * Applies one administrative transition atomically: status change + role change + audit row in a
   * single transaction. The role is granted/revoked ONLY through `AdminUsersService` (same rules as
   * the admin role endpoint), keeping the invariant "ASSISTANT role ⇔ application APPROVED".
   */
  async transition(actor: PublicUser, id: string, dto: TransitionDto, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.assistantProfile.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!profile) throw new NotFoundException('Application not found');
      if (profile.userId === actor.id)
        throw new ForbiddenException('You cannot review your own application');

      const from = profile.status;
      const to = dto.to as ApplicationStatus;
      if (allowedTransition(from, to) !== 'admin') {
        throw new ConflictException(
          `An application that is ${from.toLowerCase().replace('_', ' ')} cannot be moved to ${to.toLowerCase().replace('_', ' ')}`,
        );
      }
      if (reasonRequired(from, to) && (dto.reason?.trim().length ?? 0) < MIN_REASON) {
        throw validationFailed([
          { path: 'reason', message: `Give a reason of at least ${MIN_REASON} characters` },
        ]);
      }

      if (to === 'APPROVED') {
        const req = await this.requirements(tx, id);
        const blockers: string[] = [];
        if (!req.emailVerified) blockers.push('The applicant has not verified their email address');
        if (!req.phoneVerified) blockers.push('The applicant has not verified their mobile number');
        if (!req.identityPassed) blockers.push('The identity review has not passed');
        for (const m of req.missing) blockers.push(m.message);
        if (profile.user.role !== 'CUSTOMER' && profile.user.role !== 'ASSISTANT')
          blockers.push('This account type cannot be an assistant');
        if (blockers.length > 0) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'This application is not ready to be approved',
            blockers,
          });
        }
      }

      const now = new Date();
      const moved = await tx.assistantProfile.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          statusReason: dto.reason?.trim() ?? null,
          statusChangedAt: now,
          ...(to === 'APPROVED' ? { approvedAt: profile.approvedAt ?? now } : {}),
        },
      });
      if (moved.count !== 1)
        throw new ConflictException(
          'The application changed while you were reviewing it. Refresh and try again',
        );

      // The role follows the status, through the one authorised service, in the same transaction.
      if (to === 'APPROVED')
        await this.roles.assignRoleInTransaction(tx, actor, profile.userId, 'ASSISTANT', ctx);
      if (to === 'SUSPENDED')
        await this.roles.assignRoleInTransaction(tx, actor, profile.userId, 'CUSTOMER', ctx);

      await this.audit.record(
        {
          action: `admin.assistant.${to.toLowerCase()}`,
          actorUserId: actor.id,
          targetType: 'assistant_profile',
          targetId: id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { from, to, ...(dto.reason ? { reason: dto.reason.trim() } : {}) },
        },
        tx,
      );
      return { id, status: to, statusReason: dto.reason?.trim() ?? null, statusChangedAt: now };
    });
  }
}
