// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Mounts the compliance-permission-protected data retention and legal hold control center.
import type { JSX } from 'react';
import type { Metadata } from 'next';
import DataRetentionConsole from '@/features/privacy/data-retention-console';

export const metadata: Metadata = { title: 'Privacy and data retention' };
export const dynamic = 'force-dynamic';

export default function PrivacyConsolePage(): JSX.Element {
  return <DataRetentionConsole />;
}
