// # The copy-trading settings screen: the follower's global exposure budget, and the liquidation risk on the positions that budget covers.
//
// These two belong on one screen because they answer the same question from both
// sides: how much money is at risk right now. The budget says how much the follower
// allowed; the liquidation panel says how close the open positions are to the line.
// Splitting them would let a follower raise the budget while looking at a screen
// that says nothing about the positions it applies to.
//
// The layout opens with the risk, not the form: a customer who came here to raise
// their limit should see the state of their exposure before the input that changes
// it.
'use client';
import type { JSX } from 'react';

import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { CopyBudgetSettings } from '@/features/trading/copy-budget-settings';
import { LiquidationRiskAlert } from '@/features/trading/liquidation-risk-alert';
import { useQuery } from '@tanstack/react-query';
import { copyOpsApi, liquidationSeverity } from '@/api/copy-ops-api';

export default function CopyTradingSettingsPage(): JSX.Element {
  // Same query key the alert uses everywhere else, so a banner dismissed on another
  // screen is not refetched into existence here.
  const alertsQuery = useQuery({
    queryKey: ['liquidation-alerts'],
    queryFn: () => copyOpsApi.listLiquidationAlerts(),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });

  const alerts = [...(alertsQuery.data ?? [])].sort((a, b) => liquidationSeverity(b.bucket) - liquidationSeverity(a.bucket));

  return (
    <AuthGuard>
      <AppShell>
        <PageContainer
          title="Copy trading settings"
          description="Set how much capital copy trading may use, and see how close your open positions are to liquidation."
        >
          <div className="grid gap-6">
            <section aria-label="Liquidation risk" className="grid gap-2">
              {alertsQuery.isError && (
                <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
                  Margin health could not be read just now. That is not the same as “all positions are safe” — do not
                  treat this screen as reassurance until it loads.
                </p>
              )}
              <LiquidationRiskAlert alerts={alerts} hideSafe />
            </section>

            <section aria-label="Copy budget">
              <CopyBudgetSettings />
            </section>
          </div>
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
