'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { CheckoutPage } from '@/features/billing/checkout-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><CheckoutPage /></AppShell></AuthGuard>;
}
