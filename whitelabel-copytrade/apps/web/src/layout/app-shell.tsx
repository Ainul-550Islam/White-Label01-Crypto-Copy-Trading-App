'use client';

import { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileNavigation } from './mobile-navigation';
import { MaintenanceBanner } from '@/components/maintenance-banner';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  return (
    <div className="min-h-screen bg-background">
      <MaintenanceBanner />
      <Topbar />
      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r bg-card md:block">
          <Sidebar />
        </aside>
        <main className="flex-1">
          <div className="md:hidden">
            <MobileNavigation />
          </div>
          <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
