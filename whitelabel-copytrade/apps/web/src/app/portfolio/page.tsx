'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { PortfolioPage } from '@/features/portfolio/portfolio-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PortfolioPage /></AppShell></AuthGuard>;
}
