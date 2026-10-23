import type { ReactNode, Ref } from 'react';

const tones = {
  error: 'border-danger/30 bg-danger/5 text-danger',
  success: 'border-success/30 bg-success/5 text-success',
  info: 'border-line bg-canvas text-ink',
} as const;

const icons = { error: '▲', success: '✓', info: 'ℹ' } as const;

interface AlertProps {
  tone: keyof typeof tones;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** Errors use role="alert" (announced immediately); other tones use role="status". */
export function Alert({ tone, children, ref }: AlertProps) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${tones[tone]}`}
    >
      <span aria-hidden="true">{icons[tone]}</span>
      <div>{children}</div>
    </div>
  );
}
