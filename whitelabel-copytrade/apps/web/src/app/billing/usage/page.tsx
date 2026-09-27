'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { UsagePage } from '@/features/billing/usage-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><UsagePage /></AppShell></AuthGuard>;
}
