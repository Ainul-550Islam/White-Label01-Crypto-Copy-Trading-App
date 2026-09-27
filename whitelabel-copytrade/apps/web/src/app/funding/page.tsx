'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { FundingPage } from '@/features/funding/funding-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><FundingPage /></AppShell></AuthGuard>;
}
