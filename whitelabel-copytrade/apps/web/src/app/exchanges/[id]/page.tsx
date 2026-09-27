'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ExchangeAccountDetail } from '@/features/exchanges/exchange-account-detail';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Exchange Account Detail"><ExchangeAccountDetail id={params.id} /></PageContainer></AppShell></AuthGuard>;
}
