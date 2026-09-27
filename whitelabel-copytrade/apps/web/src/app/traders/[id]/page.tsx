'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { TraderDetailPage } from '@/features/trading/trader-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><TraderDetailPage id={params.id} /></AppShell></AuthGuard>;
}
