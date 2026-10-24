import { ELIGIBILITY, countLabel, groupByEligibility, placeLabel } from './eligibility';

describe('eligibility presentation', () => {
  it('describes every level with a label, an icon (not colour alone) and a meaning', () => {
    for (const view of Object.values(ELIGIBILITY)) {
      expect(view.label).toBeTruthy();
      expect(view.icon).toBeTruthy();
      expect(view.meaning.endsWith('.')).toBe(true);
    }
    expect(ELIGIBILITY.NOT_DELEGABLE.tone).toBe('blocked');
    expect(ELIGIBILITY.NOT_DELEGABLE.meaning).toMatch(/personally/);
  });

  it('groups available first and not-available last, dropping empty groups', () => {
    const items = [
      { n: 'a', e: 'NOT_DELEGABLE' as const },
      { n: 'b', e: 'ELIGIBLE' as const },
      { n: 'c', e: 'NOT_DELEGABLE' as const },
    ];
    const groups = groupByEligibility(items, (i) => i.e);
    expect(groups.map((g) => g.eligibility)).toEqual(['ELIGIBLE', 'NOT_DELEGABLE']);
    expect(groups[1]?.items.map((i) => i.n)).toEqual(['a', 'c']);
  });

  it('pluralises counts', () => {
    expect(countLabel(0, 'task')).toBe('0 tasks');
    expect(countLabel(1, 'task')).toBe('1 task');
    expect(countLabel(2, 'city', 'cities')).toBe('2 cities');
  });

  it('does not repeat a name when the city and state are the same', () => {
    expect(placeLabel({ name: 'Kaduna', state: 'Kaduna' })).toBe('Kaduna');
    expect(placeLabel({ name: 'Lagos', state: ' lagos ' })).toBe('Lagos');
    expect(placeLabel({ name: 'Abuja', state: 'Federal Capital Territory' })).toBe(
      'Abuja, Federal Capital Territory',
    );
  });
});
