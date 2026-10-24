import type { EligibleTask, RestrictionRule, TaskEligibility } from '../generated/prisma/client.js';
import { toPublicTask, type PublicTask } from '../service-categories/serializers.js';

export interface VenueRestriction {
  taskId: string | null;
  rule: RestrictionRule;
  note: string;
}

export interface EffectiveTask extends PublicTask {
  /** What actually applies at THIS venue: never more permissive than the task's own eligibility. */
  effectiveEligibility: TaskEligibility;
  venueNotes: { rule: RestrictionRule; note: string }[];
}

const RULE_ORDER: Record<RestrictionRule, number> = {
  PROHIBITED: 0,
  REQUIRES_AUTHORIZATION: 1,
  ADVISORY: 2,
};

/**
 * Overlays venue-specific restrictions on a task. Precedence (strictest wins):
 * NOT_DELEGABLE (task) > PROHIBITED (venue) > REQUIRES_AUTHORIZATION (task or venue) > ELIGIBLE.
 * ADVISORY only adds a note. A restriction can tighten eligibility, never loosen it.
 */
export function applyVenueRestrictions(
  task: EligibleTask,
  restrictions: VenueRestriction[],
): EffectiveTask {
  const relevant = restrictions
    .filter((r) => r.taskId === null || r.taskId === task.id)
    .toSorted((a, b) => RULE_ORDER[a.rule] - RULE_ORDER[b.rule]);

  let effective: TaskEligibility = task.eligibility;
  if (effective !== 'NOT_DELEGABLE') {
    if (relevant.some((r) => r.rule === 'PROHIBITED')) effective = 'NOT_DELEGABLE';
    else if (
      effective === 'ELIGIBLE' &&
      relevant.some((r) => r.rule === 'REQUIRES_AUTHORIZATION')
    ) {
      effective = 'REQUIRES_AUTHORIZATION';
    }
  }

  return {
    ...toPublicTask(task),
    effectiveEligibility: effective,
    venueNotes: relevant.map(({ rule, note }) => ({ rule, note })),
  };
}
