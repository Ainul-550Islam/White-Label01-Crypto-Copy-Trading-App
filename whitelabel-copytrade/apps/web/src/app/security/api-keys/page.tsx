'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ApiKeysPage } from '@/features/security/api-keys-page';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="API Keys"><ApiKeysPage /></PageContainer></AppShell></AuthGuard>;
}
