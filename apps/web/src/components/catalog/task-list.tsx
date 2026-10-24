import type { Eligibility, VenueNote } from '@/lib/catalog';
import { ELIGIBILITY, groupByEligibility } from '@/lib/eligibility';
import { EligibilityBadge } from './eligibility-badge';

export interface TaskRow {
  id: string;
  name: string;
  description: string;
  eligibility: Eligibility;
  authorizationNotes: string | null;
  restrictionNotes: string | null;
  venueNotes?: VenueNote[];
  /** At a venue the effective eligibility may be stricter than the task's own. */
  taskEligibility?: Eligibility;
}

const VENUE_LABEL: Record<VenueNote['rule'], string> = {
  PROHIBITED: 'Not allowed at this venue',
  REQUIRES_AUTHORIZATION: 'Authorization required at this venue',
  ADVISORY: 'Good to know',
};

/** Tasks grouped by what a customer can actually expect: available → needs authorization → not available. */
export function TaskList({ tasks }: { tasks: TaskRow[] }) {
  const groups = groupByEligibility(tasks, (task) => task.eligibility);
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.eligibility} aria-labelledby={`group-${group.eligibility}`}>
          <h3
            id={`group-${group.eligibility}`}
            className="text-sm font-semibold uppercase tracking-wide text-ink-muted"
          >
            {ELIGIBILITY[group.eligibility].label}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">{ELIGIBILITY[group.eligibility].meaning}</p>
          <ul className="mt-3 space-y-3">
            {group.items.map((task) => (
              <li key={task.id} className="rounded-card border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">{task.name}</h4>
                  <EligibilityBadge eligibility={task.eligibility} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">{task.description}</p>
                {task.taskEligibility && task.taskEligibility !== task.eligibility ? (
                  <p className="mt-2 text-sm font-medium text-warning">
                    Stricter at this venue than the usual rule (
                    {ELIGIBILITY[task.taskEligibility].label.toLowerCase()}).
                  </p>
                ) : null}
                {task.authorizationNotes && task.eligibility === 'REQUIRES_AUTHORIZATION' ? (
                  <p className="mt-3 rounded-xl bg-canvas p-3 text-sm">
                    <strong>What you’d need to provide: </strong>
                    {task.authorizationNotes}
                  </p>
                ) : null}
                {task.restrictionNotes && task.eligibility === 'NOT_DELEGABLE' ? (
                  <p className="mt-3 rounded-xl bg-canvas p-3 text-sm">
                    <strong>Why not: </strong>
                    {task.restrictionNotes}
                  </p>
                ) : null}
                {task.venueNotes?.map((note) => (
                  <p key={`${note.rule}-${note.note}`} className="mt-2 text-sm">
                    <strong>{VENUE_LABEL[note.rule]}: </strong>
                    {note.note}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
