'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { PerformanceChart } from '@/features/portfolio/performance-chart';
import { PnlPanel } from '@/features/portfolio/pnl-panel';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Performance" description="Backend performance series"><div className="grid gap-6 md:grid-cols-2"><PnlPanel /><PerformanceChart /></div></PageContainer></AppShell></AuthGuard>;
}
