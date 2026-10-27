import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { AssistantEligibilityService } from '../assistants/assistant-eligibility.service.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { skipTake, toPage } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockForEligibilityDecision } from '../assistants/eligibility-locks.js';
import { lockRequest } from './locking.js';
import {
  acceptsQuotes,
  MAX_PENDING_QUOTES_PER_REQUEST,
  MAX_QUOTES_PER_ASSISTANT_PER_REQUEST,
} from './request-state.js';
import type { FeedQuery, SubmitQuoteDto } from './service-requests.schemas.js';
import { REQUEST_INCLUDE, toAssistantQuoteView, toRequestView } from './serializers.js';

const MY_QUOTE_SELECT = {
  id: true,
  amountKobo: true,
  currency: true,
  message: true,
  status: true,
  createdAt: true,
} satisfies Prisma.QuoteSelect;

/** The assistant's side: what they may see and quote, and their own quotes. */
@Injectable()
export class AssistantRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: AssistantEligibilityService,
  ) {}

  private async profileOf(userId: string) {
    return this.prisma.assistantProfile.findUnique({ where: { userId }, select: { id: true } });
  }

  /**
   * Requests this assistant may quote on, as a database predicate. It must agree EXACTLY with
   * `AssistantEligibilityService.canServe` (same task offered, same city served, same venue rule);
   * the equivalence is asserted by a test over every combination. Eligibility itself is enforced
   * before this runs (`@RequireAssistantEligibility()`).
   */
  private async feedWhere(userId: string, profileId: string, now: Date) {
    const [offers, areas] = await Promise.all([
      this.prisma.assistantTaskOffer.findMany({
        where: {
          profileId,
          task: {
            isActive: true,
            eligibility: { not: 'NOT_DELEGABLE' },
            category: { isActive: true },
          },
        },
        select: { taskId: true },
      }),
      this.prisma.assistantServiceArea.findMany({
        where: { profileId, city: { isActive: true } },
        select: { cityId: true },
      }),
    ]);
    const taskIds = offers.map((o) => o.taskId);

    // Venue rules that make a task NOT_DELEGABLE for this assistant's tasks.
    const prohibited = await this.prisma.locationRestriction.findMany({
      where: { rule: 'PROHIBITED', OR: [{ taskId: null }, { taskId: { in: taskIds } }] },
      select: { locationId: true, taskId: true },
    });
    const venueWide = prohibited.filter((r) => r.taskId === null).map((r) => r.locationId);
    const byTask = new Map<string, string[]>();
    for (const r of prohibited) {
      if (r.taskId) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r.locationId]);
    }
    const plain = taskIds.filter((id) => !byTask.has(id));
    // Positive conditions only: `notIn` is false for NULL, so "no venue" is its own branch.
    const allowedAtVenue = (extra: string[]): Prisma.ServiceRequestWhereInput => ({
      OR: [{ locationId: null }, { locationId: { notIn: [...venueWide, ...extra] } }],
    });
    const perTask: Prisma.ServiceRequestWhereInput[] = [
      ...(plain.length > 0 ? [{ taskId: { in: plain }, ...allowedAtVenue([]) }] : []),
      ...[...byTask.entries()].map(([taskId, extra]) => ({ taskId, ...allowedAtVenue(extra) })),
    ];

    return {
      status: { in: ['OPEN', 'QUOTED'] },
      expiresAt: { gt: now },
      customerId: { not: userId },
      cityId: { in: areas.map((a) => a.cityId) },
      OR: perTask,
    } satisfies Prisma.ServiceRequestWhereInput;
  }

  async feed(user: PublicUser, query: FeedQuery) {
    const now = new Date();
    const profile = await this.profileOf(user.id);
    if (!profile) return toPage([], 0, query.page, query.pageSize);
    const where = await this.feedWhere(user.id, profile.id, now);
    if (where.OR.length === 0 || where.cityId.in.length === 0)
      return toPage([], 0, query.page, query.pageSize);

    const [rows, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where,
        include: {
          ...REQUEST_INCLUDE,
          quotes: {
            where: { assistantId: profile.id },
            select: MY_QUOTE_SELECT,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    return toPage(
      rows.map((r) => ({
        ...toRequestView(r, now),
        myQuote: r.quotes[0] ? toAssistantQuoteView(r.quotes[0]) : null,
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * One request, visible to (a) an eligible assistant it matches while it is live, or (b) an
   * assistant who already quoted on it. Everyone else gets 404, exactly like a missing id.
   */
  async getForAssistant(user: PublicUser, id: string) {
    const now = new Date();
    const profile = await this.profileOf(user.id);
    if (!profile) throw new NotFoundException('Request not found');
    const row = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        ...REQUEST_INCLUDE,
        quotes: {
          where: { assistantId: profile.id },
          select: MY_QUOTE_SELECT,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!row || row.customerId === user.id) throw new NotFoundException('Request not found');

    if (row.quotes.length === 0) {
      const matches =
        acceptsQuotes(row.status, row.expiresAt, now) &&
        (
          await this.eligibility.canServe(user.id, {
            taskId: row.taskId,
            cityId: row.cityId,
            locationId: row.locationId,
          })
        ).allowed;
      if (!matches) throw new NotFoundException('Request not found');
    }
    return {
      request: toRequestView(row, now),
      myQuotes: row.quotes.map(toAssistantQuoteView),
    };
  }

  async submitQuote(user: PublicUser, requestId: string, dto: SubmitQuoteDto, ctx: RequestContext) {
    const profile = await this.profileOf(user.id);
    if (!profile) throw new NotFoundException('Request not found');

    let quoteId: string;
    try {
      quoteId = await this.prisma.$transaction(async (tx) => {
        const locked = await lockRequest(tx, requestId);
        // A request that does not exist, or that this assistant may not see, looks the same: 404.
        if (!locked) throw new NotFoundException('Request not found');
        if (locked.customerId === user.id)
          throw new ForbiddenException('You cannot quote on your own request');

        const now = new Date();
        // Hold the eligibility locks (D-052) so no revoking change can commit before we do.
        await lockForEligibilityDecision(tx, user.id, locked);
        const serve = await this.eligibility.canServe(
          user.id,
          { taskId: locked.taskId, cityId: locked.cityId, locationId: locked.locationId },
          tx,
        );
        if (!serve.allowed) throw new NotFoundException('Request not found');
        if (!acceptsQuotes(locked.status, locked.expiresAt, now))
          throw new ConflictException('This request is no longer accepting quotes');

        const [mine, pending] = await Promise.all([
          tx.quote.findMany({
            where: { requestId, assistantId: profile.id },
            select: { status: true },
          }),
          tx.quote.count({ where: { requestId, status: 'PENDING' } }),
        ]);
        if (mine.some((q) => q.status === 'PENDING' || q.status === 'ACCEPTED'))
          throw new ConflictException('You already have an active quote on this request');
        if (mine.length >= MAX_QUOTES_PER_ASSISTANT_PER_REQUEST)
          throw new ConflictException('You have reached the quote limit for this request');
        if (pending >= MAX_PENDING_QUOTES_PER_REQUEST)
          throw new ConflictException('This request already has the maximum number of quotes');

        const quote = await tx.quote.create({
          data: {
            requestId,
            assistantId: profile.id,
            amountKobo: dto.amountKobo,
            currency: dto.currency,
            message: dto.message ?? null,
          },
          select: { id: true },
        });
        if (locked.status === 'OPEN')
          await tx.serviceRequest.update({
            where: { id: requestId },
            data: { status: 'QUOTED', statusChangedAt: now },
          });
        await this.audit.record(
          {
            action: 'quote.submitted',
            actorUserId: user.id,
            targetType: 'Quote',
            targetId: quote.id,
            ...ctx,
            // The amount is business data; the message is private and never audited.
            metadata: { requestId, amountKobo: dto.amountKobo },
          },
          tx,
        );
        return quote.id;
      });
    } catch (error) {
      // Backstop for the partial unique index if the application check were ever bypassed.
      if (isUniqueViolation(error))
        throw new ConflictException('You already have an active quote on this request');
      throw error;
    }
    const quote = await this.prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      select: MY_QUOTE_SELECT,
    });
    return { quote: toAssistantQuoteView(quote) };
  }

  async withdraw(user: PublicUser, quoteId: string, ctx: RequestContext) {
    const found = await this.prisma.quote.findFirst({
      where: { id: quoteId, assistant: { userId: user.id } },
      select: { requestId: true },
    });
    if (!found) throw new NotFoundException('Quote not found');

    await this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, found.requestId);
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id: quoteId },
        select: { status: true },
      });
      if (quote.status !== 'PENDING')
        throw new ConflictException(
          quote.status === 'ACCEPTED'
            ? 'This quote was accepted and can no longer be withdrawn here'
            : 'This quote is no longer pending',
        );
      const now = new Date();
      await tx.quote.update({
        where: { id: quoteId },
        data: { status: 'WITHDRAWN', statusChangedAt: now },
      });
      // Reversible: when the last pending quote goes, the request is simply OPEN again.
      const remaining = await tx.quote.count({
        where: { requestId: found.requestId, status: 'PENDING' },
      });
      if (remaining === 0)
        await tx.serviceRequest.updateMany({
          where: { id: found.requestId, status: 'QUOTED' },
          data: { status: 'OPEN', statusChangedAt: now },
        });
      await this.audit.record(
        {
          action: 'quote.withdrawn',
          actorUserId: user.id,
          targetType: 'Quote',
          targetId: quoteId,
          ...ctx,
          metadata: { requestId: found.requestId },
        },
        tx,
      );
    });
    const quote = await this.prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      select: MY_QUOTE_SELECT,
    });
    return { quote: toAssistantQuoteView(quote) };
  }

  async myQuotes(user: PublicUser, query: FeedQuery) {
    const now = new Date();
    const where = { assistant: { userId: user.id } } satisfies Prisma.QuoteWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        select: { ...MY_QUOTE_SELECT, request: { include: REQUEST_INCLUDE } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.quote.count({ where }),
    ]);
    return toPage(
      rows.map(({ request, ...quote }) => ({
        quote: toAssistantQuoteView(quote),
        request: toRequestView(request, now),
      })),
      total,
      query.page,
      query.pageSize,
    );
  }
}
