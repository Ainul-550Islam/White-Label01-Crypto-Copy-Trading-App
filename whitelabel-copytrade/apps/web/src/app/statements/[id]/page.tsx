'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StatementDetailPage } from '@/features/statements/statement-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><StatementDetailPage id={params.id} /></AppShell></AuthGuard>;
}
