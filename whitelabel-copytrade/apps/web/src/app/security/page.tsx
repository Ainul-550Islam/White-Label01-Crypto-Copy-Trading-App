'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { SecurityPage } from '@/features/security/security-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><SecurityPage /></AppShell></AuthGuard>;
}
