'use client';

import type { JSX } from 'react';
import { use } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { StatementDetailPage } from '@/features/statements/statement-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  return <AuthGuard><AppShell><StatementDetailPage id={id} /></AppShell></AuthGuard>;
}
