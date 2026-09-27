'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StrategyDetailPage } from '@/features/trading/strategy-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><StrategyDetailPage id={params.id} /></AppShell></AuthGuard>;
}
