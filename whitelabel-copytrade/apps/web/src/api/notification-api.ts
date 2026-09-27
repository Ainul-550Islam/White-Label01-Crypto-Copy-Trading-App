import { apiClient } from './api-client';

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

export const notificationApi = {
  list: (params?: { read?: boolean; page?: number; limit?: number }) =>
    apiClient.get<{ data: Notification[]; total: number; unreadCount: number }>('/v1/notifications', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  markAsRead: (id: string) => apiClient.post<void>(`/v1/notifications/${id}/read`),

  markAllAsRead: () => apiClient.post<void>('/v1/notifications/read-all'),

  getPreferences: () => apiClient.get<NotificationPreference[]>('/v1/notifications/preferences'),

  updatePreferences: (data: { preferences: NotificationPreference[] }) =>
    apiClient.put<NotificationPreference[]>('/v1/notifications/preferences', data),
};
