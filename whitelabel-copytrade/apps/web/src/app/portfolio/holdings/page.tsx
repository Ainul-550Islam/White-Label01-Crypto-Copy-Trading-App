'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { HoldingsTable } from '@/features/portfolio/holdings-table';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Holdings" description="Real persisted holdings"><HoldingsTable /></PageContainer></AppShell></AuthGuard>;
}
