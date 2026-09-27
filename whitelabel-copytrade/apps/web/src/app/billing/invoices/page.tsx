'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { InvoicesPage } from '@/features/billing/invoices-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><InvoicesPage /></AppShell></AuthGuard>;
}
