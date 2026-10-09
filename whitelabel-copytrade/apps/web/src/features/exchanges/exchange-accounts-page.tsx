'use client';

import type { JSX } from 'react';
/**
 * Exchange accounts list
 * Security: Never exposes exchange secrets, only backend-verified status
 */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { exchangeApi } from '@/api/exchange-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { ExchangeSecurityWarning } from './exchange-security-warning';

export function ExchangeAccountsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exchanges', 'accounts'],
    queryFn: () => exchangeApi.listAccounts(),
  });
  const accounts = data?.data ?? [];

  return (
    <PageContainer
      title="Exchange Accounts"
      description="Customer exchange-account list, no secret exposure"
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded border px-3 py-2 text-xs hover:bg-accent"
          >
            Refresh Status
          </button>
          <Link href="/exchanges/connect" className="rounded bg-primary px-4 py-2 text-sm text-white">
            Connect Exchange
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <ExchangeSecurityWarning />

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="No exchange accounts"
            description="Connect your exchange to start trading"
            action={{ label: 'Connect', href: '/exchanges/connect' }}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {accounts.map((a) => (
              <Link
                key={a.id}
                href={`/exchanges/${a.id}`}
                className="rounded border bg-card p-4 hover:shadow transition-shadow space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.exchange}</span>
                  <div className="flex gap-1.5">
                    <StatusBadge status={a.status} />
                    <StatusBadge status={a.health} />
                  </div>
                </div>
                <p className="text-xs text-muted">
                  {a.label ?? a.id} · Environment: {a.environment}
                </p>
                {a.maskedApiKey && (
                  <p className="font-mono text-xs text-muted">Key: {a.maskedApiKey}</p>
                )}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span>Trading: {a.tradingEnabled ? 'Enabled' : 'Disabled'}</span>
                  <span className="text-primary underline">Manage connection →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
