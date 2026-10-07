// # Passes URL search params into TradersPage
'use client';

import { AuthGuard } from '@/auth/auth.guard';
import { TradersPage } from '@/features/trading/traders-page';
import { AppShell } from '@/layout/app-shell';

export default function Page({
  searchParams,
}: {
  searchParams?: {
    search?: string;
    verificationState?: string;
    isFeatured?: string;
    venue?: string;
    symbol?: string;
    minWinRate?: string;
    maxDrawdown?: string;
    sortBy?: 'followers' | 'volume' | 'pnl' | 'winRate';
  };
}): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <TradersPage
          initialFilters={{
            search: searchParams?.search,
            verificationState: searchParams?.verificationState,
            isFeatured: searchParams?.isFeatured === 'true',
            venue: searchParams?.venue,
            symbol: searchParams?.symbol,
            minWinRate: searchParams?.minWinRate ? Number(searchParams.minWinRate) : undefined,
            maxDrawdown: searchParams?.maxDrawdown ? Number(searchParams.maxDrawdown) : undefined,
            sortBy: searchParams?.sortBy,
          }}
        />
      </AppShell>
    </AuthGuard>
  );
}
