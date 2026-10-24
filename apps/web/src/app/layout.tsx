import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Qyou — get your time back', template: '%s · Qyou' },
  description: 'Hire trusted people to wait in line or run eligible errands for you.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh antialiased">
        <SiteHeader />
        {children}
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-muted sm:px-6">
            <p>
              Qyou is in early development: places and rules are listed, assistants and booking are
              not live yet.
            </p>
            <Link href="/status" className="underline underline-offset-2">
              System status
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
