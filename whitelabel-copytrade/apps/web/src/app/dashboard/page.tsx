'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><DashboardPage /></AppShell></AuthGuard>;
}
