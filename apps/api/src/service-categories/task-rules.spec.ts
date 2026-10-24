import { validateTaskRules, type TaskRuleInput } from './task-rules.js';

const base: TaskRuleInput = {
  eligibility: 'ELIGIBLE',
  requiresPersonalPresence: false,
  requiresCredentials: false,
  authorizationNotes: null,
  restrictionNotes: null,
};

describe('validateTaskRules', () => {
  it('accepts a plain eligible task', () => {
    expect(validateTaskRules(base)).toEqual([]);
  });

  it('forces NOT_DELEGABLE when personal presence or credentials are required', () => {
    for (const flag of ['requiresPersonalPresence', 'requiresCredentials'] as const) {
      for (const eligibility of ['ELIGIBLE', 'REQUIRES_AUTHORIZATION'] as const) {
        const issues = validateTaskRules({
          ...base,
          eligibility,
          [flag]: true,
          authorizationNotes: 'letter',
        });
        expect(issues.map((i) => i.path)).toContain('eligibility');
      }
      expect(
        validateTaskRules({
          ...base,
          eligibility: 'NOT_DELEGABLE',
          [flag]: true,
          restrictionNotes: 'why',
        }),
      ).toEqual([]);
    }
  });

  it('requires authorization notes for REQUIRES_AUTHORIZATION', () => {
    expect(validateTaskRules({ ...base, eligibility: 'REQUIRES_AUTHORIZATION' })).toEqual([
      expect.objectContaining({ path: 'authorizationNotes' }),
    ]);
    expect(
      validateTaskRules({
        ...base,
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes: '   ',
      }),
    ).toHaveLength(1);
    expect(
      validateTaskRules({
        ...base,
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes: 'Signed letter',
      }),
    ).toEqual([]);
  });

  it('requires a reason for NOT_DELEGABLE', () => {
    expect(validateTaskRules({ ...base, eligibility: 'NOT_DELEGABLE' })).toEqual([
      expect.objectContaining({ path: 'restrictionNotes' }),
    ]);
    expect(
      validateTaskRules({ ...base, eligibility: 'NOT_DELEGABLE', restrictionNotes: 'Policy' }),
    ).toEqual([]);
  });
});
