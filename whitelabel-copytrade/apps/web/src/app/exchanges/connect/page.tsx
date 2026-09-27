'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ConnectExchangePage } from '@/features/exchanges/connect-exchange-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ConnectExchangePage /></AppShell></AuthGuard>;
}
