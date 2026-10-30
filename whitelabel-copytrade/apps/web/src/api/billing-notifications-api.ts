// # Responsibility: typed client for the billing notification inbox and preferences (billing-notification.controller), including the bulk preference write.
//
//   GET /v1/billing/notifications/inbox                inbox, newest first
//   GET /v1/billing/notifications/inbox/unread-count    { unreadCount }
//   PUT /v1/billing/notifications/inbox/:id/read
//   PUT /v1/billing/notifications/inbox/read-all
//   GET /v1/billing/notifications/preferences           { data: rows }
//   PUT /v1/billing/notifications/preferences           one row
//   PUT /v1/billing/notifications/preferences/bulk      many rows in one request
//
// The four writes are PUTs and therefore carry an Idempotency-Key: marking a message read twice must
// not produce two audit rows, and a bulk save retried after a timeout must not be applied twice.

import { apiClient } from './api-client';

const API_BASE = '/v1/billing/notifications';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  return query;
}

/** Channels the API can deliver on (NotificationChannel). */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'WEBHOOK'] as const;

export interface InboxNotification {
  id: string;
  eventKey: string;
  channel: string;
  title?: string | null;
  body?: string | null;
  read: boolean;
  createdAt: string;
  readAt?: string | null;
}

export interface InboxPage {
  tenantId: string;
  userId: string;
  data: InboxNotification[];
  page: number;
  limit: number;
}

export interface NotificationPreference {
  id: string;
  eventKey?: string | null;
  channel: string;
  enabled: boolean;
  category?: string | null;
  locale?: string | null;
}

export interface InboxQuery {
  unreadOnly?: boolean;
  eventKey?: string;
  channel?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface PreferenceInput {
  eventKey?: string;
  channel: string;
  enabled: boolean;
  category?: string;
  locale?: string;
}

export const billingNotificationsApi = {
  listInbox: (query: InboxQuery = {}) =>
    apiClient.get<InboxPage>(`${API_BASE}/inbox`, { searchParams: params({ ...query }) }),

  unreadCount: () => apiClient.get<{ unreadCount: number }>(`${API_BASE}/inbox/unread-count`),

  markRead: (id: string, idempotencyKey: string) =>
    apiClient.put<InboxNotification>(`${API_BASE}/inbox/${encodeURIComponent(id)}/read`, undefined, { idempotencyKey }),

  markAllRead: (idempotencyKey: string) =>
    apiClient.put<{ updated: number }>(`${API_BASE}/inbox/read-all`, undefined, { idempotencyKey }),

  getPreferences: (query: { category?: string; eventKey?: string } = {}) =>
    apiClient.get<{ tenantId: string; userId: string; data: NotificationPreference[] }>(`${API_BASE}/preferences`, {
      searchParams: params({ ...query }),
    }),

  updatePreference: (input: PreferenceInput, idempotencyKey: string) =>
    apiClient.put<NotificationPreference>(`${API_BASE}/preferences`, input, { idempotencyKey }),

  bulkUpdatePreferences: (preferences: PreferenceInput[], idempotencyKey: string) =>
    apiClient.put<{ data: NotificationPreference[] }>(`${API_BASE}/preferences/bulk`, { preferences }, { idempotencyKey }),
};
