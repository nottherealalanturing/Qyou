import {
  fetchCategories,
  fetchCategory,
  fetchCities,
  type Category,
  type City,
  type Task,
} from './catalog';

export interface CatalogTree {
  cities: City[];
  categories: { category: Category; tasks: Task[] }[];
}

/** Every city plus every category with its tasks (the public reference data), or `null` if unavailable. */
export async function loadCatalog(): Promise<CatalogTree | null> {
  const [cities, categories] = await Promise.all([fetchCities(), fetchCategories()]);
  if (cities.status !== 'ok' || categories.status !== 'ok') return null;
  const detailed = await Promise.all(categories.data.items.map((c) => fetchCategory(c.slug)));
  return {
    cities: cities.data.items,
    categories: detailed.flatMap((d) =>
      d.status === 'ok' ? [{ category: d.data.category, tasks: d.data.tasks }] : [],
    ),
  };
}
