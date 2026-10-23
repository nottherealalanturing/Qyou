import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-ink-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div> : null}
        </div>
      </div>
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden lg:m-6 lg:flex lg:flex-col lg:justify-end lg:rounded-[2rem] lg:bg-gradient-to-br lg:from-brand-500 lg:to-brand-700 lg:p-12 lg:text-white"
      >
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-black/10" />
        <p className="relative text-4xl font-bold leading-tight tracking-tight">
          Hand off the wait.
          <br />
          Get your time back.
        </p>
        <p className="relative mt-4 max-w-sm text-lg text-white/90">
          Qyou connects you with trusted people who wait in line for you.
        </p>
      </aside>
    </main>
  );
}
