'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { tradingApi } from '@/api/trading-api';
import { exchangeApi } from '@/api/exchange-api';
import { fundingApi } from '@/api/funding-api';
import { billingApi } from '@/api/billing-api';
import { notificationApi } from '@/api/notification-api';
import { getRuntimeConfig } from '@/config/runtime-config';

const config = getRuntimeConfig();

export function useDashboardData() {
  const portfolio = useQuery({
    queryKey: ['dashboard', 'portfolio', 'overview'],
    queryFn: () => portfolioApi.getOverview(),
    staleTime: config.queryStaleTimeMs,
  });

  const tradingStatus = useQuery({
    queryKey: ['dashboard', 'trading', 'status'],
    queryFn: () => tradingApi.getTradingStatus(),
    staleTime: config.queryStaleTimeMs,
  });

  const subscriptions = useQuery({
    queryKey: ['dashboard', 'copy', 'subscriptions'],
    queryFn: () => tradingApi.listCopySubscriptions(),
    staleTime: config.queryStaleTimeMs,
  });

  const exchanges = useQuery({
    queryKey: ['dashboard', 'exchanges', 'accounts'],
    queryFn: () => exchangeApi.listAccounts(),
    staleTime: config.queryStaleTimeMs,
  });

  const funding = useQuery({
    queryKey: ['dashboard', 'funding', 'recent'],
    queryFn: () => fundingApi.listFundingRequests({ page: 1, limit: 5 }),
    staleTime: config.queryStaleTimeMs,
  });

  const subscription = useQuery({
    queryKey: ['dashboard', 'billing', 'subscription'],
    queryFn: () => billingApi.getCurrentSubscription(),
    staleTime: config.queryStaleTimeMs,
  });

  const usage = useQuery({
    queryKey: ['dashboard', 'billing', 'usage'],
    queryFn: () => billingApi.getUsage(),
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
    subscription,
    usage,
    notifications,
    isLoading: portfolio.isLoading || tradingStatus.isLoading,
    hasError: portfolio.isError || tradingStatus.isError,
  };
}
