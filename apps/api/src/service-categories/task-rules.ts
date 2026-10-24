import type { TaskEligibility } from '../generated/prisma/client.js';

export interface TaskRuleInput {
  eligibility: TaskEligibility;
  requiresPersonalPresence: boolean;
  requiresCredentials: boolean;
  authorizationNotes: string | null;
  restrictionNotes: string | null;
}

export interface RuleIssue {
  path: string;
  message: string;
}

/**
 * The delegation rules from docs/PRODUCT.md, as code. The SAME rules are enforced by CHECK
 * constraints in the database (migration 20261023223410); this function exists to return precise,
 * friendly errors before a write is attempted, and to validate the merged state of a PATCH.
 */
const blank = (value: string | null) => value === null || value.trim().length === 0;

export function validateTaskRules(task: TaskRuleInput): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (
    (task.requiresPersonalPresence || task.requiresCredentials) &&
    task.eligibility !== 'NOT_DELEGABLE'
  ) {
    issues.push({
      path: 'eligibility',
      message:
        'A task that needs the customer’s personal presence or credentials cannot be delegated: use NOT_DELEGABLE',
    });
  }
  if (task.eligibility === 'REQUIRES_AUTHORIZATION' && blank(task.authorizationNotes)) {
    issues.push({
      path: 'authorizationNotes',
      message: 'Explain what authorization the customer must provide',
    });
  }
  if (task.eligibility === 'NOT_DELEGABLE' && blank(task.restrictionNotes)) {
    issues.push({ path: 'restrictionNotes', message: 'Explain why this task cannot be delegated' });
  }
  return issues;
}
