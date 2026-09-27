'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { PlanComparison } from '@/features/billing/plan-comparison';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Plans" description="Real plan/entitlement/limit information from backend"><PlanComparison /></PageContainer></AppShell></AuthGuard>;
}
