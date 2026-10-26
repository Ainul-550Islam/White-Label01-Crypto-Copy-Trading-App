// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Provides canonical marketplace metadata while leaving dynamic trader pages responsible for their own canonical URL and privacy policy.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { publicUrlFor } from '@/lib/public-origin';

export const metadata: Metadata = {
  title: 'Copy-trading marketplace',
  description: 'Explore verified copy-trading profiles, compare public performance methodology, and review risk information.',
  alternates: { canonical: publicUrlFor('/traders') ?? undefined },
  openGraph: {
    title: 'Copy-trading marketplace',
    description: 'Explore copy-trading profiles and review risk information.',
    type: 'website',
    url: publicUrlFor('/traders') ?? undefined,
  },
  robots: { index: true, follow: true },
};

export default function TradersLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
