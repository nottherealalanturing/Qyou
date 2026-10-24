import type { EligibleTask, ServiceCategory } from '../generated/prisma/client.js';

export interface PublicTask {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: EligibleTask['kind'];
  eligibility: EligibleTask['eligibility'];
  requiresPersonalPresence: boolean;
  requiresCredentials: boolean;
  authorizationNotes: string | null;
  restrictionNotes: string | null;
}

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconKey: string;
  taskCount: number;
  locationCount: number;
}

export function toPublicTask(task: EligibleTask): PublicTask {
  return {
    id: task.id,
    slug: task.slug,
    name: task.name,
    description: task.description,
    kind: task.kind,
    eligibility: task.eligibility,
    requiresPersonalPresence: task.requiresPersonalPresence,
    requiresCredentials: task.requiresCredentials,
    authorizationNotes: task.authorizationNotes,
    restrictionNotes: task.restrictionNotes,
  };
}

export function toPublicCategory(
  category: ServiceCategory,
  taskCount: number,
  locationCount: number,
): PublicCategory {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    iconKey: category.iconKey,
    taskCount,
    locationCount,
  };
}

/** Admin view: everything, including internal flags and timestamps. */
export function toAdminCategory(
  category: ServiceCategory,
  counts: { tasks: number; locations: number },
) {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    iconKey: category.iconKey,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    taskCount: counts.tasks,
    locationCount: counts.locations,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export function toAdminTask(task: EligibleTask) {
  return {
    ...toPublicTask(task),
    categoryId: task.categoryId,
    sortOrder: task.sortOrder,
    isActive: task.isActive,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
