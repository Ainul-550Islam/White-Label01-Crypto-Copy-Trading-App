// # The guided exchange key-rotation route for one connected account.
//
// Rotation is reachable from the account screen and from a security warning, so it
// is a route rather than a modal: a customer who is midway through replacing a
// compromised key must be able to reload the page without losing where they were,
// and a link that says "replace your key" should go somewhere that explains the
// four steps before asking for anything.
//
// The page reads the account first so it can name the venue and environment in the
// copy. If the account cannot be read it says so instead of rendering a form that
// would fail on submit: entering a live secret into a page that cannot tell you
// which environment it applies to is exactly the mistake this screen must prevent.
'use client';
import type { JSX } from 'react';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { exchangeApi } from '@/api/exchange-api';
import { ApiKeyRotationPage } from '@/features/exchanges/api-key-rotation-page';

export interface RotateKeyRouteProps {
  params: Promise<{ id: string }>;
}

export default function RotateExchangeKeyPage({ params }: RotateKeyRouteProps): JSX.Element {
  const accountId = use(params).id;

  const accountQuery = useQuery({
    queryKey: ['exchange-account', accountId],
    queryFn: () => exchangeApi.getAccount(accountId),
    retry: false,
  });

  return (
    <AuthGuard>
      <AppShell>
        <PageContainer
          title="Replace exchange key"
          description="Test the new key against the exchange while the current one still works, then switch over."
        >
          <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-xs text-muted">
            <Link href="/exchanges" className="hover:underline">
              Connected exchanges
            </Link>
            <span>/</span>
            <Link href={`/exchanges/${encodeURIComponent(accountId)}`} className="hover:underline">
              Account {accountId.slice(0, 8)}
            </Link>
            <span>/</span>
            <span className="font-semibold text-slate-900">Replace key</span>
          </nav>

          {accountQuery.isLoading ? (
            <LoadingState />
          ) : accountQuery.error || !accountQuery.data ? (
            <ErrorState
              error={accountQuery.error ?? new Error('That exchange account could not be loaded.')}
              onRetry={() => void accountQuery.refetch()}
            />
          ) : (
            <ApiKeyRotationPage
              accountId={accountId}
              venue={accountQuery.data.exchange}
              environment={accountQuery.data.environment}
            />
          )}
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
