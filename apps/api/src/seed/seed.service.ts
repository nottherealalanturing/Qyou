import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { nameKey } from '../common/text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { validateTaskRules } from '../service-categories/task-rules.js';
import { SEED_CATEGORIES, SEED_CITIES } from './reference-data.js';

export interface SeedReport {
  citiesCreated: number;
  categoriesCreated: number;
  tasksCreated: number;
}

/**
 * Loads the launch reference data. Idempotent and non-destructive by design:
 *  - it only INSERTS missing rows (`ON CONFLICT DO NOTHING`); an existing row — including one an
 *    administrator has since edited or deactivated — is never touched;
 *  - everything happens in one transaction, with a single audit event when something changed;
 *  - it seeds no locations.
 */
@Injectable()
export class SeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async seedReferenceData(): Promise<SeedReport> {
    // Fail loudly if the seed file itself ever contradicts the delegation rules.
    for (const category of SEED_CATEGORIES) {
      for (const task of category.tasks) {
        const issues = validateTaskRules({
          eligibility: task.eligibility,
          requiresPersonalPresence: task.requiresPersonalPresence ?? false,
          requiresCredentials: task.requiresCredentials ?? false,
          authorizationNotes: task.authorizationNotes ?? null,
          restrictionNotes: task.restrictionNotes ?? null,
        });
        if (issues.length > 0) {
          throw new Error(
            `Seed task ${category.slug}/${task.slug} is invalid: ${issues[0]?.message}`,
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const cities = await tx.city.createMany({
        data: SEED_CITIES.map((c) => ({ ...c })),
        skipDuplicates: true,
      });
      const categories = await tx.serviceCategory.createMany({
        data: SEED_CATEGORIES.map((c, index) => ({
          slug: c.slug,
          name: c.name,
          nameKey: nameKey(c.name),
          description: c.description,
          iconKey: c.iconKey,
          sortOrder: index + 1,
        })),
        skipDuplicates: true,
      });

      const stored = await tx.serviceCategory.findMany({
        where: { slug: { in: SEED_CATEGORIES.map((c) => c.slug) } },
        select: { id: true, slug: true },
      });
      const idBySlug = new Map(stored.map((c) => [c.slug, c.id]));

      let tasksCreated = 0;
      for (const category of SEED_CATEGORIES) {
        const categoryId = idBySlug.get(category.slug);
        if (!categoryId) continue;
        const result = await tx.eligibleTask.createMany({
          data: category.tasks.map((t, index) => ({
            categoryId,
            slug: t.slug,
            name: t.name,
            nameKey: nameKey(t.name),
            description: t.description,
            kind: t.kind,
            eligibility: t.eligibility,
            requiresPersonalPresence: t.requiresPersonalPresence ?? false,
            requiresCredentials: t.requiresCredentials ?? false,
            authorizationNotes: t.authorizationNotes ?? null,
            restrictionNotes: t.restrictionNotes ?? null,
            sortOrder: index + 1,
          })),
          skipDuplicates: true,
        });
        tasksCreated += result.count;
      }

      const report: SeedReport = {
        citiesCreated: cities.count,
        categoriesCreated: categories.count,
        tasksCreated,
      };
      if (report.citiesCreated + report.categoriesCreated + report.tasksCreated > 0) {
        await this.audit.record(
          { action: 'system.reference_data_seeded', metadata: { ...report } },
          tx,
        );
      }
      return report;
    });
  }
}
