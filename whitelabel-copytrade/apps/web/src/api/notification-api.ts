import { apiClient } from './api-client';

/**
 * In-app notifications and delivery preferences of the signed-in user.
 *
 * Backend (NotificationsController, /v1/notifications):
 *   GET   /                 ?page&limit&unreadOnly&channel -> { items, pagination }
 *   GET   /unread-count     -> { unread }
 *   PATCH /:id/read
 *   POST  /read-all
 *   GET   /preferences      -> [{ category, channel, enabled }]   (only stored rows)
 *   PATCH /preferences      { preferences: [{ category, channel, enabled }] }
 * A category/channel pair without a stored row is delivered (enabled), and
 * security-critical messages always reach IN_APP and EMAIL regardless.
 */

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  channel: string;
  read: boolean;
  priority: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationPreference {
  channel: string;
  enabled: boolean;
  categories: Record<string, boolean>;
}

/** NotificationCategory in @wlct/shared-types. */
export const NOTIFICATION_CATEGORIES = ['account', 'security', 'billing', 'trading', 'general'] as const;

/** Channels a customer can switch per category (NotificationChannel values). */
export const PREFERENCE_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'SMS'] as const;

interface BackendNotification {
  id: string;
  channel: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface BackendNotificationPage {
  items: BackendNotification[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface BackendPreference {
  category: string;
  channel: string;
  enabled: boolean;
}

export function toNotification(raw: BackendNotification): Notification {
  const priority = typeof raw.data?.priority === 'string' ? (raw.data.priority as string) : 'NORMAL';
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    message: raw.body,
    channel: raw.channel,
    read: raw.readAt !== null,
    priority,
    data: raw.data ?? undefined,
    createdAt: raw.createdAt,
  };
}

/** One entry per channel with every category filled in (missing rows are enabled). */
export function toPreferenceMatrix(rows: readonly BackendPreference[]): NotificationPreference[] {
  return PREFERENCE_CHANNELS.map((channel) => {
    const categories: Record<string, boolean> = {};
    for (const category of NOTIFICATION_CATEGORIES) {
      const stored = rows.find((row) => row.channel === channel && row.category === category);
      categories[category] = stored ? stored.enabled : true;
    }
    return { channel, enabled: Object.values(categories).some(Boolean), categories };
  });
}

/**
 * Flattens the matrix into backend entries. A channel switched off entirely
 * stores every category as disabled for that channel.
 */
export function toPreferenceEntries(preferences: readonly NotificationPreference[]): BackendPreference[] {
  const entries: BackendPreference[] = [];
  for (const preference of preferences) {
    for (const category of NOTIFICATION_CATEGORIES) {
      entries.push({
        category,
        channel: preference.channel,
        enabled: preference.enabled && (preference.categories[category] ?? true),
      });
    }
  }
  return entries;
}

export const notificationApi = {
  list: async (params?: { read?: boolean; page?: number; limit?: number }) => {
    const [page, unread] = await Promise.all([
      apiClient.get<BackendNotificationPage>('/v1/notifications', {
        searchParams: {
          page: params?.page,
          limit: params?.limit,
          unreadOnly: params?.read === false ? true : undefined,
        },
      }),
      apiClient.get<{ unread: number }>('/v1/notifications/unread-count'),
    ]);
    const data = (page?.items ?? []).map(toNotification);
    const items = params?.read === true ? data.filter((n) => n.read) : data;
    return { data: items, total: page?.pagination?.totalItems ?? items.length, unreadCount: unread?.unread ?? 0 };
  },

  getUnreadCount: async (): Promise<number> => {
    const res = await apiClient.get<{ unread: number }>('/v1/notifications/unread-count');
    return res?.unread ?? 0;
  },

  markAsRead: (id: string) => apiClient.patch<void>(`/v1/notifications/${encodeURIComponent(id)}/read`),

  markAllAsRead: () => apiClient.post<void>('/v1/notifications/read-all'),

  getPreferences: async (): Promise<NotificationPreference[]> => {
    const rows = await apiClient.get<BackendPreference[]>('/v1/notifications/preferences');
    return toPreferenceMatrix(rows ?? []);
  },

  updatePreferences: async (data: { preferences: NotificationPreference[] }): Promise<NotificationPreference[]> => {
    const rows = await apiClient.patch<BackendPreference[]>('/v1/notifications/preferences', {
      preferences: toPreferenceEntries(data.preferences),
    });
    return toPreferenceMatrix(rows ?? []);
  },
};
