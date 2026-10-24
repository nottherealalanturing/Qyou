import type {
  City,
  LocationRestriction,
  Prisma,
  ServiceCategory,
  ServiceLocation,
} from '../generated/prisma/client.js';

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : value.toNumber();

export function toPublicCity(city: City, locationCount: number) {
  return {
    id: city.id,
    slug: city.slug,
    name: city.name,
    state: city.state,
    latitude: num(city.latitude),
    longitude: num(city.longitude),
    timezone: city.timezone,
    locationCount,
  };
}

export function toAdminCity(city: City, locationCount: number) {
  return {
    ...toPublicCity(city, locationCount),
    sortOrder: city.sortOrder,
    isActive: city.isActive,
    createdAt: city.createdAt,
    updatedAt: city.updatedAt,
  };
}

type LocationWithRefs = ServiceLocation & { city: City; category: ServiceCategory };

export function toPublicLocation(location: LocationWithRefs) {
  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    address: location.address,
    latitude: num(location.latitude),
    longitude: num(location.longitude),
    city: { slug: location.city.slug, name: location.city.name, state: location.city.state },
    category: {
      slug: location.category.slug,
      name: location.category.name,
      iconKey: location.category.iconKey,
    },
  };
}

export function toAdminLocation(location: LocationWithRefs) {
  return {
    ...toPublicLocation(location),
    cityId: location.cityId,
    categoryId: location.categoryId,
    status: location.status,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}

export function toAdminRestriction(restriction: LocationRestriction) {
  return {
    id: restriction.id,
    locationId: restriction.locationId,
    taskId: restriction.taskId,
    rule: restriction.rule,
    note: restriction.note,
    createdAt: restriction.createdAt,
  };
}
