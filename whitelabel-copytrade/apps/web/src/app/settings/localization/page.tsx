// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Mounts the authenticated locale and display-preference page inside the customer application shell.
import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import LocalizationSettingsPage from '@/features/settings/localization-settings-page';
import { AppShell } from '@/layout/app-shell';

export default function LocalizationRoute(): JSX.Element {
  return <AuthGuard><AppShell><LocalizationSettingsPage /></AppShell></AuthGuard>;
}
