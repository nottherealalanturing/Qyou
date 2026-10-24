import { Injectable, NotFoundException } from '@nestjs/common';
import { publicLocationWhere } from '../common/public-visibility.js';
import { skipTake, toPage, type Page } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPublicCity, toPublicLocation } from './serializers.js';
import type { PublicLocationQuery } from './service-locations.schemas.js';
import { applyVenueRestrictions, type EffectiveTask } from './venue-rules.js';

export type PublicLocation = ReturnType<typeof toPublicLocation>;
export type PublicCity = ReturnType<typeof toPublicCity>;

@Injectable()
export class ServiceLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active cities with how many approved locations each has (0 until locations are added). */
  async listCities(): Promise<PublicCity[]> {
    const [cities, counts] = await Promise.all([
      this.prisma.city.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.serviceLocation.groupBy({
        by: ['cityId'],
        where: publicLocationWhere(),
        _count: { _all: true },
      }),
    ]);
    const byCity = new Map(counts.map((row) => [row.cityId, row._count._all]));
    return cities.map((city) => toPublicCity(city, byCity.get(city.id) ?? 0));
  }

  async getCity(slug: string): Promise<PublicCity> {
    const city = await this.prisma.city.findFirst({ where: { slug, isActive: true } });
    if (!city) throw new NotFoundException('City not found');
    const count = await this.prisma.serviceLocation.count({
      where: { ...publicLocationWhere(), cityId: city.id },
    });
    return toPublicCity(city, count);
  }

  async listLocations(query: PublicLocationQuery): Promise<Page<PublicLocation>> {
    const where = publicLocationWhere({ city: query.city, category: query.category, q: query.q });
    const [rows, total] = await Promise.all([
      this.prisma.serviceLocation.findMany({
        where,
        include: { city: true, category: true },
        // `id` makes the order total, so pages never overlap or skip rows on equal names.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.serviceLocation.count({ where }),
    ]);
    return toPage(rows.map(toPublicLocation), total, query.page, query.pageSize);
  }

  /** One approved location with the tasks available there and every venue-specific rule applied. */
  async getLocation(slug: string): Promise<{
    location: PublicLocation;
    tasks: EffectiveTask[];
    restrictions: { rule: string; note: string; task: { slug: string; name: string } | null }[];
  }> {
    const location = await this.prisma.serviceLocation.findFirst({
      where: { slug, ...publicLocationWhere() },
      include: {
        city: true,
        category: true,
        restrictions: { include: { task: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!location) throw new NotFoundException('Location not found');

    const tasks = await this.prisma.eligibleTask.findMany({
      where: { categoryId: location.categoryId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const venueRules = location.restrictions.map((r) => ({
      taskId: r.taskId,
      rule: r.rule,
      note: r.note,
    }));

    return {
      location: toPublicLocation(location),
      tasks: tasks.map((task) => applyVenueRestrictions(task, venueRules)),
      restrictions: location.restrictions.map((r) => ({
        rule: r.rule,
        note: r.note,
        task: r.task ? { slug: r.task.slug, name: r.task.name } : null,
      })),
    };
  }
}
