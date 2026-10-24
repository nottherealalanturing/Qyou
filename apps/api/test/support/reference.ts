import type { Prisma } from '../../src/generated/prisma/client.js';
import { ownerPrisma } from './test-app.js';

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter += 1)}`;

/** Builders insert directly (as the DB owner) so public-read tests control state exactly. */
export async function makeCity(over: Partial<Prisma.CityUncheckedCreateInput> = {}) {
  const u = uniq();
  return ownerPrisma().city.create({
    data: {
      slug: `city-${u}`,
      name: `City ${u}`,
      state: `State ${u}`,
      latitude: 9.0765,
      longitude: 7.3986,
      ...over,
    },
  });
}

export async function makeCategory(over: Partial<Prisma.ServiceCategoryUncheckedCreateInput> = {}) {
  const u = uniq();
  const name = over.name ?? `Category ${u}`;
  return ownerPrisma().serviceCategory.create({
    data: {
      slug: `category-${u}`,
      name,
      nameKey: name.toLowerCase(),
      description: 'A category used in tests.',
      iconKey: 'landmark',
      ...over,
    },
  });
}

export async function makeTask(
  categoryId: string,
  over: Partial<Prisma.EligibleTaskUncheckedCreateInput> = {},
) {
  const u = uniq();
  const name = over.name ?? `Task ${u}`;
  return ownerPrisma().eligibleTask.create({
    data: {
      categoryId,
      slug: `task-${u}`,
      name,
      nameKey: name.toLowerCase(),
      description: 'A task used in tests.',
      kind: 'QUEUE_HOLDING',
      eligibility: 'ELIGIBLE',
      ...over,
    },
  });
}

export async function makeLocation(
  input: {
    cityId: string;
    categoryId: string;
  } & Partial<Prisma.ServiceLocationUncheckedCreateInput>,
) {
  const u = uniq();
  return ownerPrisma().serviceLocation.create({
    data: {
      slug: `location-${u}`,
      name: `Location ${u}`,
      address: `${counter} Test Street`,
      status: 'APPROVED',
      ...input,
    },
  });
}

/** A fully public-visible location with its city and category, ready to query. */
export async function makeVisibleLocation(
  over: Partial<Prisma.ServiceLocationUncheckedCreateInput> = {},
) {
  const city = await makeCity();
  const category = await makeCategory();
  const location = await makeLocation({ cityId: city.id, categoryId: category.id, ...over });
  return { city, category, location };
}
