import type { Eligibility } from '@/lib/catalog';
import { ELIGIBILITY } from '@/lib/eligibility';

const TONES = {
  good: 'border-success/30 bg-success/5 text-success',
  caution: 'border-warning/30 bg-warning/5 text-warning',
  blocked: 'border-danger/30 bg-danger/5 text-danger',
} as const;

export function EligibilityBadge({ eligibility }: { eligibility: Eligibility }) {
  const view = ELIGIBILITY[eligibility];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${TONES[view.tone]}`}
    >
      <span aria-hidden="true">{view.icon}</span>
      {view.label}
    </span>
  );
}
