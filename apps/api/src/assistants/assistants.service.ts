import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { changedFields } from '../common/audit-diff.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { validationFailed, type FieldIssue } from '../common/http/validation-error.js';
import { slugify } from '../common/text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssistantEligibilityService } from './assistant-eligibility.service.js';
import {
  allowedTransition,
  editScope,
  missingForSubmission,
  nextStatuses,
  type MissingItem,
} from './application-state.js';
import { formatMinutes, validateWindows } from './availability.js';
import { normalizeNigerianPhone } from './phone.js';
import type {
  AvailabilityDto,
  CreateDraftDto,
  PrivateDetailsDto,
  ServicesDto,
  UpdateProfileDto,
} from './assistants.schemas.js';

const LOCKED_MESSAGE: Record<string, string> = {
  SUBMITTED: 'Your application is waiting for review and cannot be edited right now',
  UNDER_REVIEW: 'Your application is being reviewed and cannot be edited right now',
  REJECTED: 'This application was rejected. Contact support to discuss next steps',
  SUSPENDED: 'Your assistant account is suspended. Contact support',
};

type OwnProfile = Prisma.AssistantProfileGetPayload<{ include: { privateDetails: true } }>;

@Injectable()
export class AssistantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: AssistantEligibilityService,
  ) {}

  // ── helpers ───────────────────────────────────────────────────────────────
  private assertMayApply(user: PublicUser): void {
    if (user.role !== 'CUSTOMER' && user.role !== 'ASSISTANT') {
      throw new ForbiddenException('This account type cannot apply as an assistant');
    }
  }

  async requireProfile(userId: string): Promise<OwnProfile> {
    const profile = await this.prisma.assistantProfile.findUnique({
      where: { userId },
      include: { privateDetails: true },
    });
    if (!profile) throw new NotFoundException('You have not started an application');
    return profile;
  }

  private assertEditable(profile: OwnProfile): 'full' | 'limited' {
    const scope = editScope(profile.status);
    if (scope === 'none')
      throw new ConflictException(
        LOCKED_MESSAGE[profile.status] ?? 'This application cannot be edited',
      );
    return scope;
  }

  private record(
    action: string,
    user: PublicUser,
    profileId: string,
    ctx: RequestContext,
    metadata: Prisma.InputJsonObject = {},
    tx?: Prisma.TransactionClient,
  ) {
    return this.audit.record(
      {
        action,
        actorUserId: user.id,
        targetType: 'assistant_profile',
        targetId: profileId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata,
      },
      tx,
    );
  }

  // ── the owner's dashboard view ────────────────────────────────────────────
  async dashboard(user: PublicUser) {
    const profile = await this.prisma.assistantProfile.findUnique({
      where: { userId: user.id },
      include: {
        privateDetails: true,
        serviceAreas: { include: { city: true }, orderBy: { city: { sortOrder: 'asc' } } },
        taskOffers: { include: { task: { include: { category: true } } } },
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
      },
    });
    const eligibility = await this.eligibility.evaluate(user.id);
    if (!profile) {
      return {
        application: null,
        profile: null,
        private: null,
        services: null,
        availability: null,
        onboarding: {
          steps: [
            {
              key: 'email',
              label: 'Verify your email address',
              done: user.emailVerified,
              required: true,
            },
          ],
          canApply: user.role === 'CUSTOMER' || user.role === 'ASSISTANT',
        },
        eligibility,
      };
    }

    const priv = profile.privateDetails;
    const snapshot = {
      displayName: profile.displayName,
      bio: profile.bio,
      languages: profile.languages,
      areaCount: profile.serviceAreas.length,
      offerCount: profile.taskOffers.length,
      windowCount: profile.availability.length,
      legalName: priv?.legalName ?? null,
      phone: priv?.phoneE164 ?? null,
    };
    const missing: MissingItem[] = missingForSubmission(snapshot);
    const phoneVerified = priv?.phoneVerifiedAt != null;
    const scope = editScope(profile.status);
    const submitted = !['DRAFT', 'CHANGES_REQUESTED'].includes(profile.status);

    const basicsDone = !missing.some((m) => ['displayName', 'bio', 'languages'].includes(m.key));
    return {
      application: {
        status: profile.status,
        statusReason: profile.statusReason,
        statusChangedAt: profile.statusChangedAt,
        submittedAt: profile.submittedAt,
        approvedAt: profile.approvedAt,
        editScope: scope,
        canSubmit:
          allowedTransition(profile.status, 'SUBMITTED') === 'assistant' &&
          user.emailVerified &&
          missing.length === 0,
        missing,
        nextActions: nextStatuses(profile.status, 'assistant'),
      },
      profile: {
        slug: profile.slug,
        displayName: profile.displayName,
        bio: profile.bio,
        languages: profile.languages,
        availabilityNote: profile.availabilityNote,
        publicUrl: profile.status === 'APPROVED' ? `/assistants/${profile.slug}` : null,
      },
      private: {
        legalName: priv?.legalName ?? null,
        phone: priv?.phoneE164 ?? null,
        phoneVerified,
      },
      services: {
        cities: profile.serviceAreas.map((a) => ({
          id: a.city.id,
          slug: a.city.slug,
          name: a.city.name,
          active: a.city.isActive,
        })),
        tasks: profile.taskOffers.map((o) => ({
          id: o.task.id,
          slug: o.task.slug,
          name: o.task.name,
          category: { slug: o.task.category.slug, name: o.task.category.name },
          eligibility: o.task.eligibility,
          // An offer can go stale if an administrator later changes the task; flag it, never advertise it.
          stillOffered:
            o.task.isActive && o.task.eligibility !== 'NOT_DELEGABLE' && o.task.category.isActive,
        })),
      },
      availability: {
        note: profile.availabilityNote,
        timezone: profile.timezone,
        windows: profile.availability.map((w) => ({
          dayOfWeek: w.dayOfWeek,
          start: formatMinutes(w.startMinute),
          end: formatMinutes(w.endMinute),
        })),
        disclaimer:
          'Preferred working times only. They do not guarantee that any job is available.',
      },
      onboarding: {
        canApply: true,
        steps: [
          {
            key: 'email',
            label: 'Verify your email address',
            done: user.emailVerified,
            required: true,
          },
          {
            key: 'profile',
            label: 'Complete your public profile',
            done: basicsDone,
            required: true,
          },
          {
            key: 'services',
            label: 'Choose the cities and tasks you offer',
            done: snapshot.areaCount > 0 && snapshot.offerCount > 0,
            required: true,
          },
          {
            key: 'availability',
            label: 'Declare your preferred working times',
            done: snapshot.windowCount > 0,
            required: true,
          },
          {
            key: 'private',
            label: 'Add your legal name and mobile number (kept private)',
            done: Boolean(priv?.legalName && priv?.phoneE164),
            required: true,
          },
          { key: 'phone', label: 'Verify your mobile number', done: phoneVerified, required: true },
          { key: 'submit', label: 'Submit your application', done: submitted, required: true },
          {
            key: 'identity',
            label: 'Identity review by Qyou (manual)',
            done: profile.identityOutcome === 'PASSED',
            detail: profile.identityOutcome,
            required: true,
          },
          {
            key: 'approval',
            label: 'Approval by Qyou',
            done: profile.status === 'APPROVED',
            required: true,
          },
        ],
      },
      eligibility,
    };
  }

  // ── create and edit ───────────────────────────────────────────────────────
  async createDraft(user: PublicUser, dto: CreateDraftDto, ctx: RequestContext) {
    this.assertMayApply(user);
    const base = slugify(dto.displayName, 40) || 'assistant';
    for (let attempt = 0; attempt < 4; attempt++) {
      const slug = `${base}-${randomBytes(3).toString('hex')}`;
      try {
        await this.prisma.$transaction(async (tx) => {
          const profile = await tx.assistantProfile.create({
            data: {
              userId: user.id,
              slug,
              displayName: dto.displayName,
              privateDetails: { create: {} },
            },
          });
          await this.record('assistant.application.created', user, profile.id, ctx, {}, tx);
        });
        return this.dashboard(user);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // userId is unique too: tell "already applied" apart from a slug collision.
        if (
          await this.prisma.assistantProfile.findUnique({
            where: { userId: user.id },
            select: { id: true },
          })
        ) {
          throw new ConflictException('You have already started an application');
        }
      }
    }
    throw new ConflictException('Could not create your profile. Please try again');
  }

  async updateProfile(user: PublicUser, dto: UpdateProfileDto, ctx: RequestContext) {
    const profile = await this.requireProfile(user.id);
    const scope = this.assertEditable(profile);
    if (
      scope === 'limited' &&
      dto.displayName !== undefined &&
      dto.displayName !== profile.displayName
    ) {
      throw new ConflictException(
        'Your display name is locked after approval. Contact support to change it',
      );
    }
    const changes = changedFields(profile, dto);
    if (Object.keys(changes).length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.assistantProfile.update({
          where: { id: profile.id },
          data: Object.fromEntries(
            Object.entries(changes).map(([k, v]) => [k, v.to]),
          ) as Prisma.AssistantProfileUpdateInput,
        });
        // Field NAMES only: profile text is public anyway, but audit rows stay lean and PII-free.
        await this.record(
          'assistant.profile.updated',
          user,
          profile.id,
          ctx,
          { fields: Object.keys(changes) },
          tx,
        );
      });
    }
    return this.dashboard(user);
  }

  async setServices(user: PublicUser, dto: ServicesDto, ctx: RequestContext) {
    const profile = await this.requireProfile(user.id);
    this.assertEditable(profile);

    const issues: FieldIssue[] = [];
    const cities = dto.cityIds.length
      ? await this.prisma.city.findMany({ where: { id: { in: dto.cityIds } } })
      : [];
    if (cities.length !== dto.cityIds.length || cities.some((c) => !c.isActive)) {
      issues.push({ path: 'cityIds', message: 'Choose only cities that are currently open' });
    }
    const tasks = dto.taskIds.length
      ? await this.prisma.eligibleTask.findMany({
          where: { id: { in: dto.taskIds } },
          include: { category: true },
        })
      : [];
    if (tasks.length !== dto.taskIds.length) {
      issues.push({ path: 'taskIds', message: 'Some selected tasks do not exist' });
    } else if (tasks.some((t) => t.eligibility === 'NOT_DELEGABLE')) {
      // The same rule the database trigger enforces: advertising a non-delegable task is never allowed.
      issues.push({
        path: 'taskIds',
        message: 'Some selected tasks cannot be delegated, so they cannot be offered',
      });
    } else if (tasks.some((t) => !t.isActive || !t.category.isActive)) {
      issues.push({ path: 'taskIds', message: 'Some selected tasks are not currently available' });
    }
    if (issues.length > 0) throw validationFailed(issues);

    await this.prisma.$transaction(async (tx) => {
      await tx.assistantServiceArea.deleteMany({ where: { profileId: profile.id } });
      await tx.assistantTaskOffer.deleteMany({ where: { profileId: profile.id } });
      if (dto.cityIds.length)
        await tx.assistantServiceArea.createMany({
          data: dto.cityIds.map((cityId) => ({ profileId: profile.id, cityId })),
        });
      if (dto.taskIds.length)
        await tx.assistantTaskOffer.createMany({
          data: dto.taskIds.map((taskId) => ({ profileId: profile.id, taskId })),
        });
      await this.record(
        'assistant.services.updated',
        user,
        profile.id,
        ctx,
        { cities: dto.cityIds.length, tasks: dto.taskIds.length },
        tx,
      );
    });
    return this.dashboard(user);
  }

  async setAvailability(user: PublicUser, dto: AvailabilityDto, ctx: RequestContext) {
    const profile = await this.requireProfile(user.id);
    this.assertEditable(profile);

    const result = validateWindows(dto.windows);
    if (!result.ok) throw validationFailed(result.issues);

    await this.prisma.$transaction(async (tx) => {
      await tx.assistantAvailabilityWindow.deleteMany({ where: { profileId: profile.id } });
      if (result.windows.length) {
        await tx.assistantAvailabilityWindow.createMany({
          data: result.windows.map((w) => ({ profileId: profile.id, ...w })),
        });
      }
      if (dto.note !== undefined)
        await tx.assistantProfile.update({
          where: { id: profile.id },
          data: { availabilityNote: dto.note },
        });
      await this.record(
        'assistant.availability.updated',
        user,
        profile.id,
        ctx,
        { windows: result.windows.length },
        tx,
      );
    });
    return this.dashboard(user);
  }

  async setPrivateDetails(user: PublicUser, dto: PrivateDetailsDto, ctx: RequestContext) {
    const profile = await this.requireProfile(user.id);
    const scope = this.assertEditable(profile);
    const current = profile.privateDetails;

    const data: Prisma.AssistantPrivateDetailsUpdateInput = {};
    const changed: string[] = [];

    if (dto.legalName !== undefined && dto.legalName !== current?.legalName) {
      if (scope === 'limited')
        throw new ConflictException(
          'Your legal name is locked after approval. Contact support to change it',
        );
      data.legalName = dto.legalName;
      changed.push('legalName');
    }
    if (dto.phone !== undefined) {
      const phone = normalizeNigerianPhone(dto.phone);
      if (!phone)
        throw validationFailed([
          { path: 'phone', message: 'Enter a Nigerian mobile number, e.g. 0803 123 4567' },
        ]);
      if (phone !== current?.phoneE164) {
        data.phoneE164 = phone;
        data.phoneVerifiedAt = null; // a different number is unverified until its own code is entered
        changed.push('phone');
      }
    }

    if (changed.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.assistantPrivateDetails.update({ where: { profileId: profile.id }, data });
        if (changed.includes('phone')) {
          // Codes sent to the previous number must not verify the new one.
          await tx.phoneVerificationToken.updateMany({
            where: { profileId: profile.id, usedAt: null },
            data: { usedAt: new Date() },
          });
        }
        await this.record(
          'assistant.private.updated',
          user,
          profile.id,
          ctx,
          { fields: changed },
          tx,
        );
      });
    }
    return this.dashboard(user);
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async submit(user: PublicUser, ctx: RequestContext) {
    const profile = await this.requireProfile(user.id);
    if (allowedTransition(profile.status, 'SUBMITTED') !== 'assistant') {
      throw new ConflictException(
        `An application that is ${profile.status.toLowerCase().replace('_', ' ')} cannot be submitted`,
      );
    }

    const [areaCount, offerCount, windowCount] = await Promise.all([
      this.prisma.assistantServiceArea.count({
        where: { profileId: profile.id, city: { isActive: true } },
      }),
      this.prisma.assistantTaskOffer.count({
        where: {
          profileId: profile.id,
          task: {
            isActive: true,
            eligibility: { not: 'NOT_DELEGABLE' },
            category: { isActive: true },
          },
        },
      }),
      this.prisma.assistantAvailabilityWindow.count({ where: { profileId: profile.id } }),
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
    if (missing.length > 0)
      throw validationFailed(missing.map((m) => ({ path: m.key, message: m.message })));

    const from = profile.status;
    await this.prisma.$transaction(async (tx) => {
      // Conditional on the status we read, so a concurrent change cannot be overwritten.
      const moved = await tx.assistantProfile.updateMany({
        where: { id: profile.id, status: from },
        data: {
          status: 'SUBMITTED',
          statusReason: null,
          statusChangedAt: new Date(),
          submittedAt: new Date(),
        },
      });
      if (moved.count !== 1)
        throw new ConflictException('Your application changed. Please refresh and try again');
      await this.record('assistant.application.submitted', user, profile.id, ctx, { from }, tx);
    });
    return this.dashboard(user);
  }
}
