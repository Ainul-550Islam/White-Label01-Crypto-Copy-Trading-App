import type { JSX } from 'react';
import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import FocusAnnouncer from '@/components/ui/focus-announcer';
import { SkipLink } from '@/components/ui/skip-link';
import '@/styles/globals.css';
import '@/styles/branding.css';
import { Providers } from './providers';
import { ErrorBoundary } from './error-boundary';

export const metadata: Metadata = {
  title: {
    default: 'Copy Trading',
    template: `%s · Copy Trading`,
  },
  description: 'Customer-facing multi-tenant SaaS copy-trading platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <SkipLink>Skip to main content</SkipLink>
        <Suspense fallback={null}><FocusAnnouncer /></Suspense>
        <ErrorBoundary>
          <Providers><main id="main-content" tabIndex={-1}>{children}</main></Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
