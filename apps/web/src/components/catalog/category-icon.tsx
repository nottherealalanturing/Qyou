import type { ReactNode } from 'react';

/** Simple stroke icons keyed by `ServiceCategory.iconKey` (a presentation hint from the API). */
const PATHS: Record<string, ReactNode> = {
  landmark: <path d="M3 21h18M5 21V10m4 11V10m6 11V10m4 11V10M2 10l10-7 10 7H2z" />,
  bank: (
    <>
      <path d="M4 21V5l8-3 8 3v16M9 21v-4h6v4" />
      <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01" />
    </>
  ),
  'heart-pulse': (
    <>
      <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
      <path d="M3 12h4l2-3 3 6 2-3h7" />
    </>
  ),
  bus: (
    <>
      <rect x="4" y="3" width="16" height="14" rx="2" />
      <path d="M4 11h16M8 21v-4m8 4v-4M8 14h.01M16 14h.01" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  'graduation-cap': (
    <>
      <path d="M22 9 12 4 2 9l10 5 10-5z" />
      <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
    </>
  ),
  'shopping-bag': (
    <>
      <path d="M6 7h12l1 14H5L6 7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </>
  ),
};

const FALLBACK = (
  <>
    <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </>
);

export function CategoryIcon({
  iconKey,
  className = 'h-7 w-7',
}: {
  iconKey: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[iconKey] ?? FALLBACK}
    </svg>
  );
}
