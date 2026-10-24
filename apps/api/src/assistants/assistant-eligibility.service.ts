import { Injectable } from '@nestjs/common';
import { publicLocationWhere } from '../common/public-visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyVenueRestrictions } from '../service-locations/venue-rules.js';
import { decideEligibility, type Eligibility } from './eligibility.js';

export interface ServeDecision {
  allowed: boolean;
  reason?: string;
}

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

  async evaluate(userId: string): Promise<Eligibility> {
    const user = await this.prisma.user.findUnique({
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
        this.prisma.assistantServiceArea.count({
          where: { profileId: profile.id, city: { isActive: true } },
        }),
        this.prisma.assistantTaskOffer.count({ where: this.effectiveOfferWhere(profile.id) }),
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
   * task that is non-delegable at a venue (or generally) can never be accepted there. Phase 2
   * booking must call this before an assistant can accept a job.
   */
  async canServeTask(userId: string, taskId: string, locationId: string): Promise<ServeDecision> {
    const eligibility = await this.evaluate(userId);
    if (!eligibility.eligibleForPaidJobs) {
      return {
        allowed: false,
        reason: eligibility.reasons[0]?.message ?? 'Not eligible for paid jobs',
      };
    }

    const profile = await this.prisma.assistantProfile.findUniqueOrThrow({
      where: { userId },
      select: { id: true },
    });
    const offer = await this.prisma.assistantTaskOffer.findFirst({
      where: { ...this.effectiveOfferWhere(profile.id), taskId },
      include: { task: true },
    });
    if (!offer) return { allowed: false, reason: 'You do not offer this task' };

    const location = await this.prisma.serviceLocation.findFirst({
      where: { id: locationId, ...publicLocationWhere() },
      include: { restrictions: true },
    });
    if (!location) return { allowed: false, reason: 'This location is not available' };
    if (location.categoryId !== offer.task.categoryId)
      return { allowed: false, reason: 'This task is not available at this location' };

    const inArea = await this.prisma.assistantServiceArea.count({
      where: { profileId: profile.id, cityId: location.cityId, city: { isActive: true } },
    });
    if (inArea === 0)
      return { allowed: false, reason: 'This location is outside your service areas' };

    const effective = applyVenueRestrictions(offer.task, location.restrictions);
    if (effective.effectiveEligibility === 'NOT_DELEGABLE') {
      return { allowed: false, reason: 'This task cannot be delegated at this location' };
    }
    return { allowed: true };
  }
}
