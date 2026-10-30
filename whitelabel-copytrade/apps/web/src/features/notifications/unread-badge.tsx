// # Responsibility: the unread count shown next to the bell in the header, read from the real unread-count route rather than from a list the header happens to have.
//
// The badge renders nothing until the count arrives, and nothing when the count is zero: a placeholder
// zero would be a claim about the inbox the header has not verified. The route is cheap and the badge is
// on every page, so it refreshes on an interval and on focus.
'use client';
import type { JSX } from 'react';

import { useQuery } from '@tanstack/react-query';

import { billingNotificationsApi } from '@/api/billing-notifications-api';
import { useCopy } from '@/i18n';

export const headerUnreadCountQueryKey = ['billing', 'inbox', 'unread-count', 'header'] as const;

export function BillingUnreadBadge(): JSX.Element | null {
  const { t } = useCopy();
  const query = useQuery({
    queryKey: headerUnreadCountQueryKey,
    queryFn: () => billingNotificationsApi.unreadCount(),
    retry: false,
    refetchInterval: 120_000,
    staleTime: 30_000,
  });
  const count = query.data?.unreadCount;
  if (count === undefined || count === 0) return null;
  return (
    <span
      className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-white"
      aria-label={`${t('inbox.unread')}: ${count}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
