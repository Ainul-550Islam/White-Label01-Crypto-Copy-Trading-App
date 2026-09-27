'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><NotificationsPage /></AppShell></AuthGuard>;
}
