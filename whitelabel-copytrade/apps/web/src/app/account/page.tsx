'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { AccountPage } from '@/features/account/account-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><AccountPage /></AppShell></AuthGuard>;
}
