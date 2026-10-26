// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Mounts the authenticated self-service data access, export, and deletion workflow.
import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import DataExportPage from '@/features/security/data-export-page';
import { AppShell } from '@/layout/app-shell';

export default function PrivacyDataExportRoute(): JSX.Element {
  return <AuthGuard><AppShell><DataExportPage /></AppShell></AuthGuard>;
}
