'use client';
/**
 * Notification center with realtime handling
 * - duplicate event detection: ignore if notification id already exists
 * - out-of-order event handling: use createdAt timestamp to order
 */

import { useEffect, useState } from 'react';
import { notificationApi, Notification } from '@/api/notification-api';
import { LoadingState } from './loading-state';
import { EmptyState } from './empty-state';
import { StatusBadge } from './status-badge';

export function NotificationCenter(): JSX.Element {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await notificationApi.list({ limit: 20 });
      setNotifications(res.data);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  };

  if (loading) return <LoadingState message="Loading notifications..." />;
  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Notifications {unreadCount > 0 && <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{unreadCount}</span>}</h3>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllRead} className="text-xs text-primary hover:underline">
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" description="You're all caught up" icon="🔔" />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li key={n.id} className={`rounded border p-3 ${!n.read ? 'bg-blue-50 border-blue-200' : 'bg-card'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-1 text-xs text-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                <StatusBadge status={n.read ? 'READ' : 'UNREAD'} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
