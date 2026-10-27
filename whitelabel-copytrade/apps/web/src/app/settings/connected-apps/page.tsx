import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import ConnectedAppsPage from '@/features/oauth/connected-apps-page';
export default function ConnectedAppsRoute(): JSX.Element {
  return <AuthGuard><AppShell><ConnectedAppsPage /></AppShell></AuthGuard>;
}
