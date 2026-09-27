'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { WithdrawalPage } from '@/features/funding/withdrawal-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><WithdrawalPage /></AppShell></AuthGuard>;
}
