import { Injectable, NotFoundException } from '@nestjs/common';
import { publicLocationWhere } from '../common/public-visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  toPublicCategory,
  toPublicTask,
  type PublicCategory,
  type PublicTask,
} from './serializers.js';

@Injectable()
export class ServiceCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active categories with honest counts. A handful of rows, so no pagination (documented). */
  async listPublic(): Promise<PublicCategory[]> {
    const [categories, locationCounts] = await Promise.all([
      this.prisma.serviceCategory.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { tasks: { where: { isActive: true } } } } },
      }),
      this.prisma.serviceLocation.groupBy({
        by: ['categoryId'],
        where: publicLocationWhere(),
        _count: { _all: true },
      }),
    ]);
    const byCategory = new Map(locationCounts.map((row) => [row.categoryId, row._count._all]));
    return categories.map((category) =>
      toPublicCategory(category, category._count.tasks, byCategory.get(category.id) ?? 0),
    );
  }

  async getPublicBySlug(slug: string): Promise<{ category: PublicCategory; tasks: PublicTask[] }> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { slug, isActive: true },
      include: {
        tasks: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      },
    });
    if (!category) throw new NotFoundException('Category not found');
    const locationCount = await this.prisma.serviceLocation.count({
      where: { ...publicLocationWhere(), categoryId: category.id },
    });
    return {
      category: toPublicCategory(category, category.tasks.length, locationCount),
      tasks: category.tasks.map(toPublicTask),
    };
  }
}
