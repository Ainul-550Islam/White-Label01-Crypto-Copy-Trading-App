'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { AttributionTable } from '@/features/portfolio/attribution-table';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Attribution" description="Strategy/trader/symbol/venue attribution"><AttributionTable /></PageContainer></AppShell></AuthGuard>;
}
