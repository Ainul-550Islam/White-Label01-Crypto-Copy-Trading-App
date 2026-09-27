import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
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
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
