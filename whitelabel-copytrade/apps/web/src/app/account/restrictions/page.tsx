'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { RestrictionsPage } from '@/features/account/restrictions-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><RestrictionsPage /></AppShell></AuthGuard>;
}
