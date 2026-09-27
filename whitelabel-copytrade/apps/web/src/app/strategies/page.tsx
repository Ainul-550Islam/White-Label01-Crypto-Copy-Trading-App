'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StrategiesPage } from '@/features/trading/strategies-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><StrategiesPage /></AppShell></AuthGuard>;
}
