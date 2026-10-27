import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { AssistantEligibilityService } from '../assistants/assistant-eligibility.service.js';
import { validationFailed } from '../common/http/validation-error.js';
import { skipTake, toPage } from '../common/pagination.js';
import { publicLocationWhere } from '../common/public-visibility.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyVenueRestrictions } from '../service-locations/venue-rules.js';
import { lockForEligibilityDecision } from '../assistants/eligibility-locks.js';
import { lockRequest } from './locking.js';
import {
  acceptsQuotes,
  allowedRequestTransition,
  effectiveStatus,
  MAX_LIVE_REQUESTS_PER_CUSTOMER,
} from './request-state.js';
import { resolveSchedule } from './schedule.js';
import type {
  CancelRequestDto,
  CreateRequestDto,
  ListRequestsQuery,
} from './service-requests.schemas.js';
import { QUOTE_SELECT, REQUEST_INCLUDE, toOwnerQuoteView, toRequestView } from './serializers.js';

/** The customer's side: create, list, view, cancel, and select a quote. */
@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: AssistantEligibilityService,
  ) {}

  async create(user: PublicUser, dto: CreateRequestDto, ctx: RequestContext) {
    const now = new Date();

    const task = await this.prisma.eligibleTask.findUnique({
      where: { id: dto.taskId },
      include: { category: { select: { isActive: true } } },
    });
    if (!task || !task.isActive || !task.category.isActive)
      throw validationFailed([{ path: 'taskId', message: 'This task is not available' }]);
    if (task.eligibility === 'NOT_DELEGABLE')
      throw validationFailed([
        { path: 'taskId', message: 'This task cannot be delegated, so it cannot be requested' },
      ]);

    let city: { id: string; timezone: string };
    let restrictions: {
      taskId: string | null;
      rule: 'PROHIBITED' | 'REQUIRES_AUTHORIZATION' | 'ADVISORY';
      note: string;
    }[] = [];
    let locationId: string | null = null;
    if (dto.locationId) {
      const location = await this.prisma.serviceLocation.findFirst({
        where: { id: dto.locationId, ...publicLocationWhere() },
        include: { restrictions: true, city: { select: { id: true, timezone: true } } },
      });
      if (!location)
        throw validationFailed([{ path: 'locationId', message: 'This venue is not available' }]);
      if (location.categoryId !== task.categoryId)
        throw validationFailed([
          { path: 'locationId', message: 'This task is not available at this venue' },
        ]);
      if (dto.cityId && dto.cityId !== location.cityId)
        throw validationFailed([{ path: 'cityId', message: 'The city does not match the venue' }]);
      city = location.city;
      restrictions = location.restrictions;
      locationId = location.id;
    } else {
      const found = await this.prisma.city.findFirst({
        where: { id: dto.cityId ?? '', isActive: true },
        select: { id: true, timezone: true },
      });
      if (!found)
        throw validationFailed([{ path: 'cityId', message: 'This city is not available' }]);
      city = found;
    }

    const effective = applyVenueRestrictions(task, restrictions).effectiveEligibility;
    if (effective === 'NOT_DELEGABLE')
      throw validationFailed([
        { path: 'taskId', message: 'This task cannot be delegated at this venue' },
      ]);
    const needsAuthorization = effective === 'REQUIRES_AUTHORIZATION';
    if (needsAuthorization && dto.confirmsAuthorization !== true)
      throw validationFailed([
        {
          path: 'confirmsAuthorization',
          message: 'Confirm that you will provide the authorization this task needs',
        },
      ]);

    const schedule = resolveSchedule(dto.schedule, now, city.timezone);
    if (!schedule.ok) throw validationFailed([{ path: schedule.path, message: schedule.message }]);

    const id = await this.prisma.$transaction(async (tx) => {
      // Serialise this customer's creations so the live-request cap cannot be raced past.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const live = await tx.serviceRequest.count({
        where: {
          customerId: user.id,
          OR: [
            { status: 'QUOTE_ACCEPTED' },
            { status: { in: ['OPEN', 'QUOTED'] }, expiresAt: { gt: now } },
          ],
        },
      });
      if (live >= MAX_LIVE_REQUESTS_PER_CUSTOMER)
        throw new ConflictException(
          `You already have ${MAX_LIVE_REQUESTS_PER_CUSTOMER} active requests. Cancel one before posting another`,
        );

      const created = await tx.serviceRequest.create({
        data: {
          customerId: user.id,
          taskId: task.id,
          cityId: city.id,
          locationId,
          description: dto.description,
          constraints: dto.constraints ?? null,
          scheduleKind: schedule.scheduleKind,
          preferredDate: schedule.preferredDate,
          preferredPeriod: schedule.preferredPeriod,
          expiresAt: schedule.expiresAt,
          authorizationConfirmedAt: needsAuthorization ? now : null,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'service_request.created',
          actorUserId: user.id,
          targetType: 'ServiceRequest',
          targetId: created.id,
          ...ctx,
          // Ids and enums only: never the description or constraints.
          metadata: {
            taskId: task.id,
            cityId: city.id,
            locationId,
            scheduleKind: schedule.scheduleKind,
          },
        },
        tx,
      );
      return created.id;
    });
    return this.getMine(user, id);
  }

  async list(user: PublicUser, query: ListRequestsQuery) {
    const now = new Date();
    const live = { gt: now };
    const where: Prisma.ServiceRequestWhereInput = { customerId: user.id };
    switch (query.status) {
      case 'OPEN':
      case 'QUOTED':
        where.status = query.status;
        where.expiresAt = live;
        break;
      case 'EXPIRED':
        where.status = { in: ['OPEN', 'QUOTED'] };
        where.expiresAt = { lte: now };
        break;
      case 'QUOTE_ACCEPTED':
      case 'CANCELLED':
        where.status = query.status;
        break;
      default:
        break;
    }
    const [rows, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    return toPage(
      rows.map((r) => toRequestView(r, now)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** The owner's view, including every quote. Anyone else gets exactly what a missing id gets: 404. */
  async getMine(user: PublicUser, id: string) {
    const now = new Date();
    const row = await this.prisma.serviceRequest.findFirst({
      where: { id, customerId: user.id },
      include: {
        ...REQUEST_INCLUDE,
        quotes: { select: QUOTE_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new NotFoundException('Request not found');

    const open = acceptsQuotes(row.status, row.expiresAt, now);
    const quotes = await Promise.all(
      row.quotes.map(async (quote) => {
        const selectable =
          open &&
          quote.status === 'PENDING' &&
          (
            await this.eligibility.canServe(quote.assistant.userId, {
              taskId: row.taskId,
              cityId: row.cityId,
              locationId: row.locationId,
            })
          ).allowed;
        return toOwnerQuoteView(quote, selectable);
      }),
    );
    return { request: toRequestView(row, now), quotes };
  }

  async cancel(user: PublicUser, id: string, dto: CancelRequestDto, ctx: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await lockRequest(tx, id);
      if (!locked || locked.customerId !== user.id)
        throw new NotFoundException('Request not found');
      if (!allowedRequestTransition(locked.status, 'CANCELLED'))
        throw new ConflictException('This request is already cancelled');
      if (locked.status === 'QUOTE_ACCEPTED' && !dto.reason)
        throw validationFailed([
          { path: 'reason', message: 'Say why you are cancelling after accepting a quote' },
        ]);

      const now = new Date();
      await tx.serviceRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          statusChangedAt: now,
          closedAt: now,
          closureReason: dto.reason ?? null,
        },
      });
      const closed = await tx.quote.updateMany({
        where: { requestId: id, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'REQUEST_CLOSED', statusChangedAt: now },
      });
      await this.audit.record(
        {
          action: 'service_request.cancelled',
          actorUserId: user.id,
          targetType: 'ServiceRequest',
          targetId: id,
          ...ctx,
          metadata: {
            from: locked.status,
            quotesClosed: closed.count,
            hadReason: Boolean(dto.reason),
          },
        },
        tx,
      );
    });
    return this.getMine(user, id);
  }

  /**
   * Selects one quote. Under the request's row lock: the request must be QUOTED and unexpired, the
   * quote PENDING and on this request, and the assistant STILL eligible for this exact job. Then the
   * quote becomes ACCEPTED, every other PENDING quote NOT_SELECTED and the request QUOTE_ACCEPTED,
   * all in one transaction with its audit row. A concurrent second selection waits for the lock and
   * then fails with 409; the partial unique index is the backstop.
   */
  async selectQuote(user: PublicUser, requestId: string, quoteId: string, ctx: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await lockRequest(tx, requestId);
      if (!locked || locked.customerId !== user.id)
        throw new NotFoundException('Request not found');

      const now = new Date();
      if (locked.status === 'QUOTE_ACCEPTED')
        throw new ConflictException('A quote has already been accepted for this request');
      if (locked.status === 'CANCELLED') throw new ConflictException('This request was cancelled');
      if (effectiveStatus(locked.status, locked.expiresAt, now) === 'EXPIRED')
        throw new ConflictException('This request has expired');
      if (locked.status !== 'QUOTED') throw new ConflictException('This request has no quotes yet');

      const quote = await tx.quote.findFirst({
        where: { id: quoteId, requestId },
        select: { id: true, status: true, assistant: { select: { userId: true } } },
      });
      if (!quote) throw new NotFoundException('Quote not found');
      if (quote.status !== 'PENDING')
        throw new ConflictException('This quote is no longer available');

      // Hold the eligibility locks (D-052): a suspension (or any revoking change) is either committed
      // before this point and seen below, or waits until this selection commits.
      await lockForEligibilityDecision(tx, quote.assistant.userId, locked);
      const serve = await this.eligibility.canServe(
        quote.assistant.userId,
        { taskId: locked.taskId, cityId: locked.cityId, locationId: locked.locationId },
        tx,
      );
      if (!serve.allowed)
        throw new ConflictException(
          'This assistant can no longer take this job. Choose another quote',
        );

      const accepted = await tx.quote.updateMany({
        where: { id: quoteId, status: 'PENDING' },
        data: { status: 'ACCEPTED', statusChangedAt: now },
      });
      if (accepted.count !== 1) throw new ConflictException('This quote is no longer available');
      const others = await tx.quote.updateMany({
        where: { requestId, status: 'PENDING', id: { not: quoteId } },
        data: { status: 'NOT_SELECTED', statusChangedAt: now },
      });
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { status: 'QUOTE_ACCEPTED', statusChangedAt: now, acceptedAt: now },
      });
      await this.audit.record(
        {
          action: 'quote.accepted',
          actorUserId: user.id,
          targetType: 'Quote',
          targetId: quoteId,
          ...ctx,
          metadata: { requestId, notSelected: others.count },
        },
        tx,
      );
    });
    return this.getMine(user, requestId);
  }
}
