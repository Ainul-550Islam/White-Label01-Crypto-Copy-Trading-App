'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { tradingApi } from '@/api/trading-api';
import { exchangeApi } from '@/api/exchange-api';
import { fundingApi } from '@/api/funding-api';
import { billingApi } from '@/api/billing-api';
import { notificationApi } from '@/api/notification-api';
import { getRuntimeConfig } from '@/config/runtime-config';
import { usePortfolioProfile } from '@/features/portfolio/use-portfolio-profile';
import { useTradingStatus } from '@/features/trading/use-trading-status';
import { useAuth } from '@/auth/auth.store';
import { sessionHasAnyPermission } from '@/auth/permissions';
import { Permission } from '@wlct/shared-types';

const config = getRuntimeConfig();

export function useDashboardData() {
  const { session } = useAuth();
  // Tenant billing is only readable with subscription:read (tenant admin, finance);
  // other roles would get 403 on every dashboard load, so they skip the call.
  const canViewBilling = sessionHasAnyPermission(session, [Permission.SUBSCRIPTION_READ]);

  // Portfolio figures are per profile: wait for the user's profile; without one
  // the query stays disabled and the widget shows its empty state.
  const { profileId, isLoading: profileLoading, error: profileError } = usePortfolioProfile();
  const portfolioQuery = useQuery({
    queryKey: ['dashboard', 'portfolio', 'overview', profileId ?? 'none'],
    queryFn: () => portfolioApi.getOverview(profileId as string),
    enabled: Boolean(profileId),
    staleTime: config.queryStaleTimeMs,
  });
  const portfolio = {
    data: portfolioQuery.data,
    isLoading: profileLoading || portfolioQuery.isLoading,
    isError: Boolean(profileError) || portfolioQuery.isError,
    error: profileError ?? portfolioQuery.error,
    refetch: portfolioQuery.refetch,
  };

  // Composed from the maintenance notice, the caller's own restrictions and
  // the role (there is no trading-status route); shared with the trading pages.
  const tradingStatus = useTradingStatus();

  const subscriptions = useQuery({
    queryKey: ['dashboard', 'copy', 'subscriptions'],
    queryFn: () => tradingApi.listCopySubscriptions({ limit: 5 }),
    staleTime: config.queryStaleTimeMs,
  });

  const exchanges = useQuery({
    queryKey: ['dashboard', 'exchanges', 'accounts'],
    queryFn: () => exchangeApi.listAccounts(),
    staleTime: config.queryStaleTimeMs,
  });

  const funding = useQuery({
    queryKey: ['dashboard', 'funding', 'recent'],
    queryFn: () => fundingApi.listHistory({ limit: 5 }),
    staleTime: config.queryStaleTimeMs,
  });

  const billing = useQuery({
    queryKey: ['dashboard', 'billing', 'overview'],
    queryFn: () => billingApi.getOverview(),
    enabled: canViewBilling,
    staleTime: config.queryStaleTimeMs,
  });

  const notifications = useQuery({
    queryKey: ['dashboard', 'notifications', 'unread'],
    queryFn: () => notificationApi.list({ limit: 5 }),
    staleTime: 15 * 1000,
  });

  return {
    portfolio,
    tradingStatus,
    subscriptions,
    exchanges,
    funding,
    billing,
    canViewBilling,
    notifications,
    isLoading: portfolio.isLoading || tradingStatus.isLoading,
    hasError: portfolio.isError || tradingStatus.isError,
  };
}
