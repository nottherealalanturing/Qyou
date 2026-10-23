import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** Rendered inside the input box on the right (e.g. a show/hide toggle). */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** Labelled input with accessible error/hint wiring (aria-invalid + aria-describedby). */
export function TextField({
  label,
  error,
  hint,
  trailing,
  className,
  ref,
  ...input
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          {...input}
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={[
            'h-12 w-full rounded-xl border bg-surface px-4 text-base text-ink placeholder:text-ink-muted/70',
            'hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-0',
            error ? 'border-danger' : 'border-ink/25',
            trailing ? 'pr-20' : '',
            className ?? '',
          ].join(' ')}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>
        ) : null}
      </div>
      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
          <span aria-hidden="true">▲</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
