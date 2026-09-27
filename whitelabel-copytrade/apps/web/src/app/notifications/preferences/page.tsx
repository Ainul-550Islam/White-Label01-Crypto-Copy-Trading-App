'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { NotificationPreferencesPage } from '@/features/notifications/notification-preferences-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><NotificationPreferencesPage /></AppShell></AuthGuard>;
}
