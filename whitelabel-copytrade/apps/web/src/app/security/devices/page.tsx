'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { DevicesPage } from '@/features/security/devices-page';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Devices"><DevicesPage /></PageContainer></AppShell></AuthGuard>;
}
