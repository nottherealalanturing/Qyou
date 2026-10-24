import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { PublicUser, RequestContext } from '../auth/auth.types.js';
import { changedFields, changesToData } from '../common/audit-diff.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { validationFailed } from '../common/http/validation-error.js';
import { nameKey, slugify } from '../common/text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCategoryDto,
  CreateTaskDto,
  UpdateCategoryDto,
  UpdateTaskDto,
} from './service-categories.schemas.js';
import { toAdminCategory, toAdminTask } from './serializers.js';
import { validateTaskRules } from './task-rules.js';

@Injectable()
export class ServiceCategoriesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async categoryCounts(ids: string[]) {
    const [tasks, locations] = await Promise.all([
      this.prisma.eligibleTask.groupBy({
        by: ['categoryId'],
        where: { categoryId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.serviceLocation.groupBy({
        by: ['categoryId'],
        where: { categoryId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const t = new Map(tasks.map((r) => [r.categoryId, r._count._all]));
    const l = new Map(locations.map((r) => [r.categoryId, r._count._all]));
    return (id: string) => ({ tasks: t.get(id) ?? 0, locations: l.get(id) ?? 0 });
  }

  async list(includeInactive: boolean) {
    const categories = await this.prisma.serviceCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const counts = await this.categoryCounts(categories.map((c) => c.id));
    return categories.map((c) => toAdminCategory(c, counts(c.id)));
  }

  async get(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    const counts = await this.categoryCounts([id]);
    return toAdminCategory(category, counts(id));
  }

  async create(actor: PublicUser, dto: CreateCategoryDto, ctx: RequestContext) {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug)
      throw validationFailed([
        { path: 'slug', message: 'Provide a slug (the name has no usable letters or digits)' },
      ]);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.create({
          data: {
            slug,
            name: dto.name,
            nameKey: nameKey(dto.name),
            description: dto.description,
            iconKey: dto.iconKey,
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
          },
        });
        await this.audit.record(
          {
            action: 'admin.service_category.created',
            actorUserId: actor.id,
            targetType: 'service_category',
            targetId: category.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { slug, name: dto.name, isActive: dto.isActive },
          },
          tx,
        );
        return category;
      });
      return toAdminCategory(created, { tasks: 0, locations: 0 });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A category with this name or slug already exists');
      }
      throw error;
    }
  }

  async update(actor: PublicUser, id: string, dto: UpdateCategoryDto, ctx: RequestContext) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.serviceCategory.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Category not found');
        const changes = changedFields(current, dto);
        if (Object.keys(changes).length === 0) return; // nothing to write, nothing to audit

        await tx.serviceCategory.update({
          where: { id },
          data: {
            ...(changesToData(changes) as Prisma.ServiceCategoryUpdateInput),
            ...(changes.name ? { nameKey: nameKey(dto.name as string) } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'admin.service_category.updated',
            actorUserId: actor.id,
            targetType: 'service_category',
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
        throw new ConflictException('A category with this name already exists');
      throw error;
    }
    return this.get(id);
  }

  // ── tasks ───────────────────────────────────────────────────────────────────
  async listTasks(categoryId: string, includeInactive: boolean) {
    await this.get(categoryId); // 404 for an unknown category
    const tasks = await this.prisma.eligibleTask.findMany({
      where: { categoryId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return tasks.map(toAdminTask);
  }

  async createTask(actor: PublicUser, categoryId: string, dto: CreateTaskDto, ctx: RequestContext) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found');

    const slug = dto.slug ?? slugify(dto.name);
    const issues = validateTaskRules({
      eligibility: dto.eligibility,
      requiresPersonalPresence: dto.requiresPersonalPresence,
      requiresCredentials: dto.requiresCredentials,
      authorizationNotes: dto.authorizationNotes ?? null,
      restrictionNotes: dto.restrictionNotes ?? null,
    });
    if (!slug)
      issues.push({
        path: 'slug',
        message: 'Provide a slug (the name has no usable letters or digits)',
      });
    if (issues.length > 0) throw validationFailed(issues);

    try {
      const task = await this.prisma.$transaction(async (tx) => {
        const created = await tx.eligibleTask.create({
          data: {
            categoryId,
            slug,
            name: dto.name,
            nameKey: nameKey(dto.name),
            description: dto.description,
            kind: dto.kind,
            eligibility: dto.eligibility,
            requiresPersonalPresence: dto.requiresPersonalPresence,
            requiresCredentials: dto.requiresCredentials,
            authorizationNotes: dto.authorizationNotes ?? null,
            restrictionNotes: dto.restrictionNotes ?? null,
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
          },
        });
        await this.audit.record(
          {
            action: 'admin.eligible_task.created',
            actorUserId: actor.id,
            targetType: 'eligible_task',
            targetId: created.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: {
              categorySlug: category.slug,
              slug,
              name: dto.name,
              eligibility: dto.eligibility,
              kind: dto.kind,
            },
          },
          tx,
        );
        return created;
      });
      return toAdminTask(task);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A task with this name or slug already exists in this category',
        );
      }
      throw error;
    }
  }

  async updateTask(actor: PublicUser, taskId: string, dto: UpdateTaskDto, ctx: RequestContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.eligibleTask.findUnique({
          where: { id: taskId },
          include: { category: true },
        });
        if (!current) throw new NotFoundException('Task not found');

        const changes = changedFields(current, dto);
        if (Object.keys(changes).length === 0) return toAdminTask(current);

        // The rules apply to the state AFTER the patch (e.g. flipping requiresCredentials alone
        // must be rejected unless the task is, or becomes, NOT_DELEGABLE).
        const merged = { ...current, ...changesToData(changes) } as typeof current;
        const issues = validateTaskRules(merged);
        if (issues.length > 0) throw validationFailed(issues);

        const updated = await tx.eligibleTask.update({
          where: { id: taskId },
          data: {
            ...(changesToData(changes) as Prisma.EligibleTaskUpdateInput),
            ...(changes.name ? { nameKey: nameKey(dto.name as string) } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'admin.eligible_task.updated',
            actorUserId: actor.id,
            targetType: 'eligible_task',
            targetId: taskId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: {
              categorySlug: current.category.slug,
              slug: current.slug,
              changes: changes as unknown as Prisma.InputJsonObject,
            },
          },
          tx,
        );
        return toAdminTask(updated);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('A task with this name already exists in this category');
      throw error;
    }
  }
}
