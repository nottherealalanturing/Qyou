import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { changedFields, changesToData } from '../common/audit-diff.js';
import { lockVenueForChange } from '../assistants/eligibility-locks.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { validationFailed } from '../common/http/validation-error.js';
import { skipTake, toPage } from '../common/pagination.js';
import { escapeLike, slugify } from '../common/text.js';
import type { LocationStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toAdminCity, toAdminLocation, toAdminRestriction } from './serializers.js';
import type {
  AdminLocationQuery,
  CreateCityDto,
  CreateLocationDto,
  CreateRestrictionDto,
  UpdateCityDto,
  UpdateLocationDto,
} from './service-locations.schemas.js';

/**
 * Explicit location lifecycle. Anything not listed is rejected with 409, so a record cannot jump
 * (for example) from REJECTED straight to public without passing through review again.
 */
export const LOCATION_TRANSITIONS: Record<LocationStatus, LocationStatus[]> = {
  PENDING_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['ARCHIVED'],
  REJECTED: ['PENDING_REVIEW'],
  ARCHIVED: ['APPROVED'],
};

@Injectable()
export class ServiceLocationsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── cities ──────────────────────────────────────────────────────────────────
  private async cityCounts(ids: string[]) {
    const rows = await this.prisma.serviceLocation.groupBy({
      by: ['cityId'],
      where: { cityId: { in: ids } },
      _count: { _all: true },
    });
    const byCity = new Map(rows.map((r) => [r.cityId, r._count._all]));
    return (id: string) => byCity.get(id) ?? 0;
  }

  async listCities(includeInactive: boolean) {
    const cities = await this.prisma.city.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const count = await this.cityCounts(cities.map((c) => c.id));
    return cities.map((c) => toAdminCity(c, count(c.id)));
  }

  async createCity(actor: PublicUser, dto: CreateCityDto, ctx: RequestContext) {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug)
      throw validationFailed([
        { path: 'slug', message: 'Provide a slug (the name has no usable letters or digits)' },
      ]);
    try {
      const city = await this.prisma.$transaction(async (tx) => {
        const created = await tx.city.create({
          data: {
            slug,
            name: dto.name,
            state: dto.state,
            latitude: dto.latitude,
            longitude: dto.longitude,
            timezone: dto.timezone,
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
          },
        });
        await this.audit.record(
          {
            action: 'admin.city.created',
            actorUserId: actor.id,
            targetType: 'city',
            targetId: created.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { slug, name: dto.name, state: dto.state, isActive: dto.isActive },
          },
          tx,
        );
        return created;
      });
      return toAdminCity(city, 0);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'A city with this slug, or this name in this state, already exists',
        );
      throw error;
    }
  }

  async updateCity(actor: PublicUser, id: string, dto: UpdateCityDto, ctx: RequestContext) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.city.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('City not found');
        const comparable = {
          ...current,
          latitude: current.latitude.toNumber(),
          longitude: current.longitude.toNumber(),
        };
        const changes = changedFields(comparable, dto);
        if (Object.keys(changes).length === 0) return;
        await tx.city.update({
          where: { id },
          data: changesToData(changes) as Prisma.CityUpdateInput,
        });
        await this.audit.record(
          {
            action: 'admin.city.updated',
            actorUserId: actor.id,
            targetType: 'city',
            targetId: id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { slug: current.slug, changes: changes as unknown as Prisma.InputJsonObject },
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('A city with this name already exists in this state');
      throw error;
    }
    const city = await this.prisma.city.findUniqueOrThrow({ where: { id } });
    const count = await this.cityCounts([id]);
    return toAdminCity(city, count(id));
  }

  // ── locations ───────────────────────────────────────────────────────────────
  async listLocations(query: AdminLocationQuery) {
    const where: Prisma.ServiceLocationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.city ? { city: { slug: query.city } } : {}),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: escapeLike(query.q), mode: 'insensitive' } },
              { address: { contains: escapeLike(query.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.serviceLocation.findMany({
        where,
        include: { city: true, category: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.serviceLocation.count({ where }),
    ]);
    return toPage(rows.map(toAdminLocation), total, query.page, query.pageSize);
  }

  async getLocation(id: string) {
    const location = await this.prisma.serviceLocation.findUnique({
      where: { id },
      include: { city: true, category: true, restrictions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!location) throw new NotFoundException('Location not found');
    return {
      location: toAdminLocation(location),
      restrictions: location.restrictions.map(toAdminRestriction),
    };
  }

  async createLocation(actor: PublicUser, dto: CreateLocationDto, ctx: RequestContext) {
    const [city, category] = await Promise.all([
      this.prisma.city.findUnique({ where: { id: dto.cityId } }),
      this.prisma.serviceCategory.findUnique({ where: { id: dto.categoryId } }),
    ]);
    const issues = [];
    if (!city) issues.push({ path: 'cityId', message: 'Unknown city' });
    if (!category) issues.push({ path: 'categoryId', message: 'Unknown category' });
    if (!city || !category) throw validationFailed(issues);

    const slug =
      dto.slug ??
      `${slugify(dto.name, 100 - city.slug.length - 1)}-${city.slug}`.replace(/^-+/, '');
    if (!dto.slug && slugify(dto.name) === '') {
      throw validationFailed([
        { path: 'slug', message: 'Provide a slug (the name has no usable letters or digits)' },
      ]);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const location = await tx.serviceLocation.create({
          data: {
            cityId: city.id,
            categoryId: category.id,
            slug,
            name: dto.name,
            address: dto.address,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
            status: dto.status,
          },
          include: { city: true, category: true },
        });
        await this.audit.record(
          {
            action: 'admin.service_location.created',
            actorUserId: actor.id,
            targetType: 'service_location',
            targetId: location.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: {
              slug,
              name: dto.name,
              city: city.slug,
              category: category.slug,
              status: dto.status,
            },
          },
          tx,
        );
        return location;
      });
      return toAdminLocation(created);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'A location with this slug already exists; choose a different slug',
        );
      throw error;
    }
  }

  async updateLocation(actor: PublicUser, id: string, dto: UpdateLocationDto, ctx: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceLocation.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Location not found');

      const comparable = {
        ...current,
        latitude: current.latitude?.toNumber() ?? null,
        longitude: current.longitude?.toNumber() ?? null,
      };
      const changes = changedFields(comparable, dto);
      if (Object.keys(changes).length === 0) return;

      // Coordinates are a pair: validate the merged result, not just the patch.
      const merged = { ...comparable, ...changesToData(changes) } as typeof comparable;
      if ((merged.latitude === null) !== (merged.longitude === null)) {
        throw validationFailed([
          { path: 'latitude', message: 'Provide both latitude and longitude, or neither' },
        ]);
      }
      if (changes.status) {
        const to = dto.status as LocationStatus;
        if (!LOCATION_TRANSITIONS[current.status].includes(to)) {
          throw new ConflictException(`A location cannot move from ${current.status} to ${to}`);
        }
      }

      await tx.serviceLocation.update({
        where: { id },
        data: changesToData(changes) as Prisma.ServiceLocationUpdateInput,
      });
      await this.audit.record(
        {
          action: 'admin.service_location.updated',
          actorUserId: actor.id,
          targetType: 'service_location',
          targetId: id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { slug: current.slug, changes: changes as unknown as Prisma.InputJsonObject },
        },
        tx,
      );
    });
    const location = await this.prisma.serviceLocation.findUniqueOrThrow({
      where: { id },
      include: { city: true, category: true },
    });
    return toAdminLocation(location);
  }

  // ── restrictions ────────────────────────────────────────────────────────────
  async addRestriction(
    actor: PublicUser,
    locationId: string,
    dto: CreateRestrictionDto,
    ctx: RequestContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockVenueForChange(tx, locationId);
        const location = await tx.serviceLocation.findUnique({ where: { id: locationId } });
        if (!location) throw new NotFoundException('Location not found');

        let taskSlug: string | null = null;
        if (dto.taskId) {
          const task = await tx.eligibleTask.findUnique({ where: { id: dto.taskId } });
          // A venue can only restrict tasks of its own category.
          if (!task || task.categoryId !== location.categoryId) {
            throw validationFailed([
              { path: 'taskId', message: 'Unknown task for this location’s category' },
            ]);
          }
          taskSlug = task.slug;
        }

        const restriction = await tx.locationRestriction.create({
          data: { locationId, taskId: dto.taskId ?? null, rule: dto.rule, note: dto.note },
        });
        await this.audit.record(
          {
            action: 'admin.location_restriction.created',
            actorUserId: actor.id,
            targetType: 'location_restriction',
            targetId: restriction.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { locationSlug: location.slug, taskSlug, rule: dto.rule },
          },
          tx,
        );
        return toAdminRestriction(restriction);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('That restriction already exists for this location');
      throw error;
    }
  }

  async removeRestriction(
    actor: PublicUser,
    locationId: string,
    restrictionId: string,
    ctx: RequestContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockVenueForChange(tx, locationId);
      const existing = await tx.locationRestriction.findFirst({
        where: { id: restrictionId, locationId },
        include: { location: true },
      });
      if (!existing) throw new NotFoundException('Restriction not found');
      await tx.locationRestriction.delete({ where: { id: restrictionId } });
      await this.audit.record(
        {
          action: 'admin.location_restriction.deleted',
          actorUserId: actor.id,
          targetType: 'location_restriction',
          targetId: restrictionId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            locationSlug: existing.location.slug,
            taskId: existing.taskId,
            rule: existing.rule,
          },
        },
        tx,
      );
    });
  }
}
