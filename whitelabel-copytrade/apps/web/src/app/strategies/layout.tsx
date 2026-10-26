// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Provides canonical SEO metadata for the public strategy marketplace; detail pages own their canonical identity.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { publicUrlFor } from '@/lib/public-origin';

export const metadata: Metadata = {
  title: 'Trading strategies',
  description: 'Compare copy-trading strategies, their risk controls, methodology, and verified history.',
  alternates: { canonical: publicUrlFor('/strategies') ?? undefined },
  openGraph: {
    title: 'Trading strategies',
    description: 'Compare strategy methodology and risk controls.',
    type: 'website',
    url: publicUrlFor('/strategies') ?? undefined,
  },
  robots: { index: true, follow: true },
};

export default function StrategiesLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
