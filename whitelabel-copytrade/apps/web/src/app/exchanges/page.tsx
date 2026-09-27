'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ExchangeAccountsPage } from '@/features/exchanges/exchange-accounts-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ExchangeAccountsPage /></AppShell></AuthGuard>;
}
