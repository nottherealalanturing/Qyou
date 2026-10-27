import { Injectable } from '@nestjs/common';
import type { Prisma, RestrictionRule } from '../generated/prisma/client.js';
import { publicLocationWhere } from '../common/public-visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyVenueRestrictions } from '../service-locations/venue-rules.js';
import { decideEligibility, type Eligibility } from './eligibility.js';

export interface ServeDecision {
  allowed: boolean;
  reason?: string;
}

/** What a job is about: the task, the city, and optionally the venue. */
export interface ServeTarget {
  taskId: string;
  /** Omit to use the venue's city. Required when there is no venue. */
  cityId?: string | undefined;
  locationId?: string | null | undefined;
}

/** The shared client or a transaction client, so callers can check eligibility inside their own transaction. */
type Db = Prisma.TransactionClient;

/**
 * Loads the facts and applies `decideEligibility`. This is the one place future booking code must
 * ask "may this user accept paid work?" — directly or via `@RequireAssistantEligibility()`.
 */
@Injectable()
export class AssistantEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tasks the assistant offers that are STILL delegable, active and in an active category. */
  private effectiveOfferWhere(profileId: string) {
    return {
      profileId,
      task: {
        isActive: true,
        eligibility: { not: 'NOT_DELEGABLE' as const },
        category: { isActive: true },
      },
    };
  }

  async evaluate(userId: string, tx?: Db): Promise<Eligibility> {
    const db: Db = tx ?? this.prisma;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        role: true,
        emailVerifiedAt: true,
        assistantProfile: {
          select: {
            id: true,
            status: true,
            identityOutcome: true,
            privateDetails: { select: { phoneVerifiedAt: true } },
          },
        },
      },
    });
    if (!user)
      return decideEligibility({
        userStatus: 'SUSPENDED',
        userRole: 'CUSTOMER',
        emailVerified: false,
        profile: null,
      });

    const profile = user.assistantProfile;
    let counts = { areas: 0, offers: 0 };
    if (profile) {
      const [areas, offers] = await Promise.all([
        db.assistantServiceArea.count({
          where: { profileId: profile.id, city: { isActive: true } },
        }),
        db.assistantTaskOffer.count({ where: this.effectiveOfferWhere(profile.id) }),
      ]);
      counts = { areas, offers };
    }

    return decideEligibility({
      userStatus: user.status,
      userRole: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      profile: profile
        ? {
            status: profile.status,
            identityOutcome: profile.identityOutcome,
            phoneVerified: profile.privateDetails?.phoneVerifiedAt != null,
            activeAreaCount: counts.areas,
            effectiveOfferCount: counts.offers,
          }
        : null,
    });
  }

  /**
   * May this assistant serve THIS task at THIS venue? Reuses the M1.3 venue-restriction logic, so a
   * task that is non-delegable at a venue (or generally) can never be accepted there.
   */
  async canServeTask(
    userId: string,
    taskId: string,
    locationId: string,
    tx?: Db,
  ): Promise<ServeDecision> {
    return this.canServe(userId, { taskId, locationId }, tx);
  }

  /**
   * May this assistant serve this job (task + city, and venue when there is one)? The ONE check used
   * for quoting and for selecting a quote: full eligibility, the task is offered, the city is served,
   * and venue restrictions do not forbid the task there.
   */
  async canServe(userId: string, target: ServeTarget, tx?: Db): Promise<ServeDecision> {
    const db: Db = tx ?? this.prisma;
    const eligibility = await this.evaluate(userId, tx);
    if (!eligibility.eligibleForPaidJobs) {
      return {
        allowed: false,
        reason: eligibility.reasons[0]?.message ?? 'Not eligible for paid jobs',
      };
    }

    const profile = await db.assistantProfile.findUniqueOrThrow({
      where: { userId },
      select: { id: true },
    });
    const offer = await db.assistantTaskOffer.findFirst({
      where: { ...this.effectiveOfferWhere(profile.id), taskId: target.taskId },
      include: { task: true },
    });
    if (!offer) return { allowed: false, reason: 'You do not offer this task' };

    let cityId = target.cityId;
    let restrictions: { taskId: string | null; rule: RestrictionRule; note: string }[] = [];
    if (target.locationId) {
      const location = await db.serviceLocation.findFirst({
        where: { id: target.locationId, ...publicLocationWhere() },
        include: { restrictions: true },
      });
      if (!location) return { allowed: false, reason: 'This location is not available' };
      if (location.categoryId !== offer.task.categoryId)
        return { allowed: false, reason: 'This task is not available at this location' };
      if (cityId !== undefined && cityId !== location.cityId)
        return { allowed: false, reason: 'This location is not available' };
      cityId = location.cityId;
      restrictions = location.restrictions;
    }
    if (cityId === undefined) return { allowed: false, reason: 'This city is not available' };

    const inArea = await db.assistantServiceArea.count({
      where: { profileId: profile.id, cityId, city: { isActive: true } },
    });
    if (inArea === 0)
      return { allowed: false, reason: 'This location is outside your service areas' };

    const effective = applyVenueRestrictions(offer.task, restrictions);
    if (effective.effectiveEligibility === 'NOT_DELEGABLE') {
      return { allowed: false, reason: 'This task cannot be delegated at this location' };
    }
    return { allowed: true };
  }
}
