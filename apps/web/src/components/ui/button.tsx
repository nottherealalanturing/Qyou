import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-ink/25 bg-surface text-ink hover:border-ink hover:bg-canvas',
  ghost: 'text-ink hover:bg-ink/5',
};

const sizes = { md: 'h-12 px-6 text-base', sm: 'h-10 px-4 text-sm' } as const;

/** Class names for anything that should look like a button (e.g. a Next `<Link>`). */
export function buttonClasses(
  variant: Variant = 'primary',
  size: keyof typeof sizes = 'md',
  fullWidth = false,
): string {
  return [base, variants[variant], sizes[size], fullWidth ? 'w-full' : '']
    .filter(Boolean)
    .join(' ');
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof sizes;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[buttonClasses(variant, size, fullWidth), className].filter(Boolean).join(' ')}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
