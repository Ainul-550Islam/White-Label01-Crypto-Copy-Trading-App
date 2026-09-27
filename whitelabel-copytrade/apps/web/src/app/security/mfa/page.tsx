'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { MfaSettings } from '@/features/security/mfa-settings';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="MFA Settings"><MfaSettings /></PageContainer></AppShell></AuthGuard>;
}
