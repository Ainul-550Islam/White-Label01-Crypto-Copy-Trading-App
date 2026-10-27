'use client';
import type { JSX } from 'react';

import { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileNavigation } from './mobile-navigation';
import { MaintenanceBanner } from '@/components/maintenance-banner';
import { VenueStatusBanner } from '@/features/trading/venue-status-banner';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  return (
    <div className="min-h-screen bg-background">
      <MaintenanceBanner />
      {/* Above the topbar: a customer must learn the exchange is paused before
          they reach an order ticket, not after the order fails to fill. */}
      <VenueStatusBanner />
      <Topbar />
      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r bg-card md:block">
          <Sidebar />
        </aside>
        <div className="flex-1">
          <div className="md:hidden">
            <MobileNavigation />
          </div>
          <div data-skip-target tabIndex={-1} className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
