// # Passes URL search params into TradersPage
import type { JSX } from 'react';

import { AuthGuard } from '@/auth/auth.guard';
import { TradersPage } from '@/features/trading/traders-page';
import { AppShell } from '@/layout/app-shell';

interface TradersSearchParams {
  search?: string;
  verificationState?: string;
  isFeatured?: string;
  venue?: string;
  symbol?: string;
  minWinRate?: string;
  maxDrawdown?: string;
  sortBy?: 'followers' | 'volume' | 'pnl' | 'winRate';
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<TradersSearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  return (
    <AuthGuard>
      <AppShell>
        <TradersPage
          initialFilters={{
            search: params.search,
            verificationState: params.verificationState,
            isFeatured: params.isFeatured === 'true',
            venue: params.venue,
            symbol: params.symbol,
            minWinRate: params.minWinRate ? Number(params.minWinRate) : undefined,
            maxDrawdown: params.maxDrawdown ? Number(params.maxDrawdown) : undefined,
            sortBy: params.sortBy,
          }}
        />
      </AppShell>
    </AuthGuard>
  );
}
