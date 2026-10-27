import type { JSX } from 'react';
import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import AdminFocusAnnouncer from '@/components/focus-announcer';

import '@/styles/globals.css';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: {
    default: publicEnv.appName,
    template: `%s · ${publicEnv.appName}`,
  },
  description: 'Administration console for the white-label copy-trading platform.',
  // The console must never be indexed: it is an internal operator surface.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1020',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <a className="wlct-skip-link" href="#main-content">Skip to main content</a>
        <Suspense fallback={null}><AdminFocusAnnouncer /></Suspense>
        {children}
      </body>
    </html>
  );
}
