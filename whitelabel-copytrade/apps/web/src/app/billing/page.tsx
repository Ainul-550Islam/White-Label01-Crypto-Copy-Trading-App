'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { BillingPage } from '@/features/billing/billing-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><BillingPage /></AppShell></AuthGuard>;
}
