import { changedFields, changesToData } from './audit-diff.js';

describe('changedFields', () => {
  const current = { name: 'Banks', isActive: true, sortOrder: 3, notes: null as string | null };

  it('returns only fields that really differ', () => {
    expect(changedFields(current, { name: 'Banks', isActive: false, sortOrder: 3 })).toEqual({
      isActive: { from: true, to: false },
    });
  });

  it('ignores undefined (absent) fields and detects null transitions', () => {
    expect(changedFields(current, { name: undefined })).toEqual({});
    expect(changedFields(current, { notes: 'x' })).toEqual({ notes: { from: null, to: 'x' } });
    expect(changedFields({ notes: 'x' as string | null }, { notes: null })).toEqual({
      notes: { from: 'x', to: null },
    });
  });

  it('returns {} for an identical patch and converts changes to Prisma data', () => {
    expect(changedFields(current, { ...current })).toEqual({});
    expect(changesToData({ name: { from: 'a', to: 'b' }, sortOrder: { from: 1, to: 2 } })).toEqual({
      name: 'b',
      sortOrder: 2,
    });
  });
});
