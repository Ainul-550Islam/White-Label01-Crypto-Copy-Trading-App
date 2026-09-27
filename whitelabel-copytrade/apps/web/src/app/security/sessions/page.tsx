'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { SessionsPage } from '@/features/security/sessions-page';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Sessions"><SessionsPage /></PageContainer></AppShell></AuthGuard>;
}
