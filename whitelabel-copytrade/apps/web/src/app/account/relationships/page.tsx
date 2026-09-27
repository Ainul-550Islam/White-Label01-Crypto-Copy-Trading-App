'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { RelationshipsPage } from '@/features/account/relationships-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><RelationshipsPage /></AppShell></AuthGuard>;
}
