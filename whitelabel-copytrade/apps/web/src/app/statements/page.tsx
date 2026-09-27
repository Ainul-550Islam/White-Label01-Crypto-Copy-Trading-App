'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StatementsPage } from '@/features/statements/statements-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><StatementsPage /></AppShell></AuthGuard>;
}
