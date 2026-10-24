import { Injectable, NotFoundException } from '@nestjs/common';
import { skipTake, toPage, type Page } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LANGUAGES } from './assistants.schemas.js';
import { formatMinutes } from './availability.js';
import type { PublicAssistantQuery } from './assistants.schemas.js';

/** Offers that may be advertised: active, still delegable, in an active category. */
const EFFECTIVE_TASK = {
  isActive: true,
  eligibility: { not: 'NOT_DELEGABLE' as const },
  category: { isActive: true },
};

/**
 * An assistant is publicly visible only when FULLY eligible: approved, identity passed, phone
 * verified, email verified, active account and role, with at least one open city and offered task.
 * Anything less is indistinguishable from "does not exist".
 */
export function publicAssistantWhere(
  filters: { city?: string | undefined; category?: string | undefined } = {},
): Prisma.AssistantProfileWhereInput {
  return {
    status: 'APPROVED',
    identityOutcome: 'PASSED',
    user: { status: 'ACTIVE', role: 'ASSISTANT', emailVerifiedAt: { not: null } },
    privateDetails: { is: { phoneVerifiedAt: { not: null } } },
    serviceAreas: {
      some: { city: { isActive: true, ...(filters.city ? { slug: filters.city } : {}) } },
    },
    taskOffers: {
      some: {
        task: {
          ...EFFECTIVE_TASK,
          category: { isActive: true, ...(filters.category ? { slug: filters.category } : {}) },
        },
      },
    },
  };
}

/**
 * The ONLY fields ever selected for public output. Note what is absent: userId, email, legal name,
 * phone, status reason, identity notes — the private table is never joined here.
 */
const PUBLIC_SELECT = {
  slug: true,
  displayName: true,
  bio: true,
  languages: true,
  availabilityNote: true,
  timezone: true,
  approvedAt: true,
  serviceAreas: {
    where: { city: { isActive: true } },
    select: { city: { select: { slug: true, name: true, state: true, sortOrder: true } } },
  },
  taskOffers: {
    where: { task: EFFECTIVE_TASK },
    select: {
      task: {
        select: {
          slug: true,
          name: true,
          eligibility: true,
          kind: true,
          sortOrder: true,
          category: { select: { slug: true, name: true, iconKey: true, sortOrder: true } },
        },
      },
    },
  },
  availability: {
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    select: { dayOfWeek: true, startMinute: true, endMinute: true },
  },
} satisfies Prisma.AssistantProfileSelect;

type PublicRow = Prisma.AssistantProfileGetPayload<{ select: typeof PUBLIC_SELECT }>;

const languageList = (codes: string[]) =>
  codes.map((code) => ({ code, name: LANGUAGES[code as keyof typeof LANGUAGES] ?? code }));

function groupOffers(row: PublicRow) {
  const byCategory = new Map<
    string,
    {
      category: { slug: string; name: string; iconKey: string };
      sort: number;
      tasks: { slug: string; name: string; eligibility: string; sort: number }[];
    }
  >();
  for (const { task } of row.taskOffers) {
    const entry = byCategory.get(task.category.slug) ?? {
      category: {
        slug: task.category.slug,
        name: task.category.name,
        iconKey: task.category.iconKey,
      },
      sort: task.category.sortOrder,
      tasks: [],
    };
    entry.tasks.push({
      slug: task.slug,
      name: task.name,
      eligibility: task.eligibility,
      sort: task.sortOrder,
    });
    byCategory.set(task.category.slug, entry);
  }
  return [...byCategory.values()]
    .toSorted((a, b) => a.sort - b.sort)
    .map((entry) => ({
      category: entry.category,
      tasks: entry.tasks
        .toSorted((a, b) => a.sort - b.sort)
        .map(({ slug, name, eligibility }) => ({ slug, name, eligibility })),
    }));
}

function cities(row: PublicRow) {
  return row.serviceAreas
    .map((a) => a.city)
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
    .map(({ slug, name, state }) => ({ slug, name, state }));
}

export function toPublicAssistantCard(row: PublicRow) {
  return {
    slug: row.slug,
    displayName: row.displayName,
    summary: row.bio.length > 140 ? `${row.bio.slice(0, 137).trimEnd()}…` : row.bio,
    languages: languageList(row.languages),
    cities: cities(row),
    categories: groupOffers(row).map((g) => g.category),
  };
}

export function toPublicAssistantProfile(row: PublicRow) {
  return {
    slug: row.slug,
    displayName: row.displayName,
    bio: row.bio,
    languages: languageList(row.languages),
    serviceAreas: cities(row),
    offers: groupOffers(row),
    availability: {
      note: row.availabilityNote,
      timezone: row.timezone,
      windows: row.availability.map((w) => ({
        dayOfWeek: w.dayOfWeek,
        start: formatMinutes(w.startMinute),
        end: formatMinutes(w.endMinute),
      })),
      disclaimer: 'Preferred working times only. They do not guarantee that any job is available.',
    },
    // Truthful, deliberately coarse: what was checked, never the evidence or the contact details.
    verification: { email: true, phone: true, identity: 'Manual review by Qyou' },
    memberSince: row.approvedAt ? row.approvedAt.toISOString().slice(0, 7) : null,
  };
}

@Injectable()
export class AssistantsPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PublicAssistantQuery): Promise<Page<ReturnType<typeof toPublicAssistantCard>>> {
    const where = publicAssistantWhere({ city: query.city, category: query.category });
    const [rows, total] = await Promise.all([
      this.prisma.assistantProfile.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy: [{ approvedAt: 'desc' }, { id: 'asc' }],
        ...skipTake(query.page, query.pageSize),
      }),
      this.prisma.assistantProfile.count({ where }),
    ]);
    return toPage(rows.map(toPublicAssistantCard), total, query.page, query.pageSize);
  }

  async get(slug: string) {
    const row = await this.prisma.assistantProfile.findFirst({
      where: { slug, ...publicAssistantWhere() },
      select: PUBLIC_SELECT,
    });
    if (!row) throw new NotFoundException('Assistant not found');
    return { assistant: toPublicAssistantProfile(row) };
  }
}
