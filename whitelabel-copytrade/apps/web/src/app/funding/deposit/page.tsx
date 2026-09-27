'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { DepositPage } from '@/features/funding/deposit-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><DepositPage /></AppShell></AuthGuard>;
}
