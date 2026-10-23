import type { Metadata, Viewport } from 'next';
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
      </body>
    </html>
  );
}
