import { SLUG_PATTERN } from '../common/text.js';
import { validateTaskRules } from '../service-categories/task-rules.js';
import { SEED_CATEGORIES, SEED_CITIES } from './reference-data.js';

describe('seed reference data', () => {
  it('seeds exactly the four launch cities, in the requested order', () => {
    expect(SEED_CITIES.map((c) => c.slug)).toEqual(['kaduna', 'abuja', 'kano', 'lagos']);
    for (const city of SEED_CITIES) {
      expect(city.latitude).toBeGreaterThan(-90);
      expect(city.latitude).toBeLessThan(90);
      expect(city.longitude).toBeGreaterThan(-180);
      expect(city.longitude).toBeLessThan(180);
      expect(city.state).toBeTruthy();
    }
    // Nigeria's bounding box: a typo in a coordinate would land somewhere else entirely.
    for (const city of SEED_CITIES) {
      expect(city.latitude).toBeGreaterThan(4);
      expect(city.latitude).toBeLessThan(14);
      expect(city.longitude).toBeGreaterThan(2.5);
      expect(city.longitude).toBeLessThan(15);
    }
  });

  it('uses valid, unique slugs and names', () => {
    const catSlugs = SEED_CATEGORIES.map((c) => c.slug);
    expect(new Set(catSlugs).size).toBe(catSlugs.length);
    expect(new Set(SEED_CATEGORIES.map((c) => c.name.toLowerCase())).size).toBe(
      SEED_CATEGORIES.length,
    );
    for (const slug of [...catSlugs, ...SEED_CITIES.map((c) => c.slug)])
      expect(slug).toMatch(SLUG_PATTERN);
    for (const category of SEED_CATEGORIES) {
      const slugs = category.tasks.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(new Set(category.tasks.map((t) => t.name.toLowerCase())).size).toBe(slugs.length);
      for (const slug of slugs) expect(slug).toMatch(SLUG_PATTERN);
    }
  });

  it('every task satisfies the delegation rules (the same ones the DB enforces)', () => {
    for (const category of SEED_CATEGORIES) {
      for (const task of category.tasks) {
        const issues = validateTaskRules({
          eligibility: task.eligibility,
          requiresPersonalPresence: task.requiresPersonalPresence ?? false,
          requiresCredentials: task.requiresCredentials ?? false,
          authorizationNotes: task.authorizationNotes ?? null,
          restrictionNotes: task.restrictionNotes ?? null,
        });
        expect([`${category.slug}/${task.slug}`, issues]).toEqual([
          `${category.slug}/${task.slug}`,
          [],
        ]);
      }
    }
  });

  it('every category offers queue holding, and lists what cannot be delegated', () => {
    for (const category of SEED_CATEGORIES) {
      expect(
        category.tasks.some((t) => t.kind === 'QUEUE_HOLDING' && t.eligibility === 'ELIGIBLE'),
      ).toBe(true);
      expect(category.tasks.some((t) => t.eligibility === 'NOT_DELEGABLE')).toBe(true);
    }
  });

  it('contains no businesses, people, reviews or wait times', () => {
    const text = JSON.stringify({ SEED_CATEGORIES, SEED_CITIES }).toLowerCase();
    for (const forbidden of [
      'review',
      'rating',
      'wait time',
      'minutes wait',
      'gtbank',
      'access bank',
      'first bank',
      'zenith',
      'uba',
      'nnpc',
    ]) {
      expect(text.includes(forbidden)).toBe(false);
    }
    expect(Object.keys(SEED_CATEGORIES[0] ?? {})).not.toContain('locations');
  });
});
