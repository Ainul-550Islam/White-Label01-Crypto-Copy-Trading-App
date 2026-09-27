'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { TradersPage } from '@/features/trading/traders-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><TradersPage /></AppShell></AuthGuard>;
}
