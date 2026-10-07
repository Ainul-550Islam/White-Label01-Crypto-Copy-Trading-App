'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '@/api/notification-api';
import { PageContainer } from '@/layout/page-container';
import { NotificationCenter } from '@/components/notification-center';
import { StatusBadge } from '@/components/status-badge';

export function NotificationsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data: unreadCount } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationApi.getUnreadCount(),
  });

  const handleMarkAllRead = async () => {
    await notificationApi.markAllAsRead();
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <PageContainer
      title="Notifications"
      description="Full customer notification inbox and delivery channel preferences from backend"
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {typeof unreadCount === 'number' && (
            <StatusBadge
              status={`${unreadCount} UNREAD`}
              variant={unreadCount > 0 ? 'info' : 'neutral'}
            />
          )}
          {typeof unreadCount === 'number' && unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="rounded border px-3 py-1.5 hover:bg-accent"
            >
              Mark All Read
            </button>
          )}
          <Link
            href="/notifications/preferences"
            className="rounded bg-primary px-3 py-1.5 text-white"
          >
            Delivery Preferences
          </Link>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded border bg-card p-3 text-xs text-muted">
          Security-critical alerts (login from a new device, MFA changes, API key events, and kill-switch notices) are
          always delivered to your in-app inbox and verified email address. Customize non-critical category channels in{' '}
          <Link href="/notifications/preferences" className="text-primary underline">
            Delivery Preferences
          </Link>
          .
        </div>
        <NotificationCenter />
      </div>
    </PageContainer>
  );
}
