import type { OnboardingStep } from '@/lib/assistants';

export function Checklist({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div>
      <p className="text-sm font-semibold">
        {done} of {steps.length} steps complete
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? 'bg-success text-white' : 'border border-ink/30 text-ink-muted'}`}
            >
              {step.done ? '✓' : ''}
            </span>
            <span className={step.done ? 'text-ink' : 'text-ink-muted'}>
              {step.label}
              <span className="sr-only">{step.done ? ' — done' : ' — not done yet'}</span>
              {step.detail && step.key === 'identity' && !step.done ? (
                <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-xs">
                  {step.detail.toLowerCase()}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
