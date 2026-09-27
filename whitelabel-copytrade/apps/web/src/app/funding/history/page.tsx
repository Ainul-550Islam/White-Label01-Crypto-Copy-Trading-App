'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { TransactionHistory } from '@/features/funding/transaction-history';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Funding History" description="Persisted history"><TransactionHistory /></PageContainer></AppShell></AuthGuard>;
}
