// # Responsibility: typed admin client for billing-notification.controller admin routes (history, reconciliation, worker, webhooks).
//
// The inbox and preference routes on the same controller are the customer's own
// surface and belong to the web app; the console uses the admin-facing routes
// here. Mutation bodies match the DTOs exactly: webhook creation requires
// `endpointUrl`, `eventTypes` and `secret`, and a rotation requires
// `newSecret`. A one-time secret is returned once and is never re-read.
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

/** `GET billing/notifications/history` rows. */
export interface NotificationHistoryRow {
  id: string;
  tenantId?: string;
  userId?: string | null;
  eventKey: string;
  channel: string;
  status: string;
  category?: string | null;
  recipient?: string | null;
  subject?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  sentAt?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface NotificationHistoryPage {
  data: NotificationHistoryRow[];
  total: number;
  page?: number;
  limit?: number;
}

/** `GET billing/notifications/webhooks` rows. Secrets are never included. */
export interface BillingWebhook {
  id: string;
  tenantId?: string;
  endpointUrl: string;
  eventTypes: string[];
  enabled: boolean;
  description?: string | null;
  lastDeliveryAt?: string | null;
  failureCount?: number;
  createdAt: string;
  updatedAt?: string;
}

/** `POST billing/notifications/webhooks` result: the row plus the one-time secret. */
export interface BillingWebhookCreated extends BillingWebhook {
  secret: string;
}

/** `POST webhooks/:id/rotate-secret` result: the new secret, shown once. */
export interface BillingWebhookRotated {
  id: string;
  secret: string;
}

/** `GET billing/notifications/worker/stuck`. */
export interface StuckNotifications {
  thresholdHours: number;
  stuck: Array<{ id: string; eventKey: string; channel: string; status: string; createdAt: string }>;
  count: number;
}

/** `POST billing/notifications/worker/process`. */
export interface WorkerRun {
  processed: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  [key: string]: unknown;
}

/** `GET billing/notifications/reconciliation/:tenantId`. */
export interface NotificationReconciliation {
  tenantId: string;
  matched: boolean | null;
  discrepancies: Array<{ type: string; reference?: string; expected?: string; actual?: string }>;
  checked?: number;
}

/** `POST billing/notifications/reconciliation/all`. */
export interface ReconciliationAllResult {
  tenantsChecked: number;
  discrepanciesFound: number;
  results?: Array<{ tenantId: string; discrepancies: number }>;
}

/* ------------------------------------------------------------------ inputs */

export interface HistoryQuery {
  eventKey?: string;
  channel?: string;
  status?: string;
  userId?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateBillingWebhookInput {
  endpointUrl: string;
  eventTypes: string[];
  secret: string;
  enabled?: boolean;
  description?: string;
}

export interface UpdateBillingWebhookInput {
  endpointUrl?: string;
  eventTypes?: string[];
  enabled?: boolean;
  description?: string;
}

export interface RotateBillingWebhookSecretInput {
  newSecret: string;
}

/** `GET billing/notifications/inbox` row: the caller's own in-app messages. */
export interface InboxNotification {
  id: string;
  eventKey: string;
  channel: string;
  category?: string | null;
  subject?: string | null;
  body?: string | null;
  read: boolean;
  readAt?: string | null;
  createdAt: string;
  [key: string]: unknown;
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

/** `GET billing/notifications/preferences` rows. */
export interface NotificationPreference {
  id?: string;
  tenantId?: string;
  userId?: string | null;
  eventKey?: string | null;
  channel: string;
  enabled: boolean;
  category?: string;
  locale?: string | null;
  [key: string]: unknown;
}

/** `PUT billing/notifications/preferences`. `channel` and `enabled` are required. */
export interface UpdatePreferenceInput {
  channel: string;
  enabled: boolean;
  eventKey?: string;
  category?: string;
  locale?: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/billing/notifications';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  const cleaned: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/* ------------------------------------------------------------------ client */

export const billingNotificationsAdminApi = {
  /* the caller's own in-app inbox */
  getInbox: (query: InboxQuery = {}) =>
    apiClient.get<{ tenantId?: string; userId?: string; data: InboxNotification[]; page?: number; limit?: number }>(`${API_BASE}/inbox`, {
      searchParams: params({ ...query }),
    }),
  getUnreadCount: () => apiClient.get<{ unreadCount: number }>(`${API_BASE}/inbox/unread-count`),
  markInboxRead: (id: string, idempotencyKey: string) =>
    apiClient.put<InboxNotification>(`${API_BASE}/inbox/${segment(id)}/read`, undefined, { idempotencyKey }),
  markAllInboxRead: (idempotencyKey: string) =>
    apiClient.put<{ updated: number }>(`${API_BASE}/inbox/read-all`, undefined, { idempotencyKey }),

  /* the caller's own notification preferences */
  getPreferences: (userId?: string) =>
    apiClient.get<{ data: NotificationPreference[] }>(`${API_BASE}/preferences`, { searchParams: params({ userId }) }),
  updatePreference: (input: UpdatePreferenceInput, idempotencyKey: string) =>
    apiClient.put<NotificationPreference>(`${API_BASE}/preferences`, input, { idempotencyKey }),
  bulkUpdatePreferences: (preferences: UpdatePreferenceInput[], idempotencyKey: string) =>
    apiClient.put<{ data: NotificationPreference[] }>(`${API_BASE}/preferences/bulk`, { preferences }, { idempotencyKey }),

  /* history */
  getHistory: (query: HistoryQuery = {}) =>
    apiClient.get<NotificationHistoryPage>(`${API_BASE}/history`, { searchParams: params({ ...query }) }),
  getHistoryById: (id: string) => apiClient.get<NotificationHistoryRow>(`${API_BASE}/history/${segment(id)}`),

  /* webhook CRUD */
  listWebhooks: () => apiClient.get<BillingWebhook[] | { data: BillingWebhook[] }>(`${API_BASE}/webhooks`),
  createWebhook: (input: CreateBillingWebhookInput, idempotencyKey: string) =>
    apiClient.post<BillingWebhookCreated>(`${API_BASE}/webhooks`, input, { idempotencyKey }),
  updateWebhook: (id: string, input: UpdateBillingWebhookInput, idempotencyKey: string) =>
    apiClient.put<BillingWebhook>(`${API_BASE}/webhooks/${segment(id)}`, input, { idempotencyKey }),
  rotateSecret: (id: string, input: RotateBillingWebhookSecretInput, idempotencyKey: string) =>
    apiClient.post<BillingWebhookRotated>(`${API_BASE}/webhooks/${segment(id)}/rotate-secret`, input, { idempotencyKey }),
  deleteWebhook: (id: string, idempotencyKey: string) =>
    apiClient.delete<void>(`${API_BASE}/webhooks/${segment(id)}`, { idempotencyKey }),

  /* worker (platform only) */
  // Every click of "run the worker" is one intent; a retried request must not process a second batch.
  processWorker: (batchSize: number | undefined, idempotencyKey: string) =>
    apiClient.post<WorkerRun>(`${API_BASE}/worker/process`, undefined, { searchParams: params({ batchSize }), idempotencyKey }),
  detectStuck: (thresholdHours?: number) =>
    apiClient.get<StuckNotifications>(`${API_BASE}/worker/stuck`, { searchParams: params({ thresholdHours }) }),

  /* reconciliation (platform only) */
  reconcileTenant: (tenantId: string) =>
    apiClient.get<NotificationReconciliation>(`${API_BASE}/reconciliation/${segment(tenantId)}`),
  reconcileAll: (limit: number | undefined, idempotencyKey: string) =>
    apiClient.post<ReconciliationAllResult>(`${API_BASE}/reconciliation/all`, undefined, { searchParams: params({ limit }), idempotencyKey }),
};

/** Rows from a bare array or a `{ data }` envelope. */
export function webhookRows(payload: BillingWebhook[] | { data: BillingWebhook[] } | null): BillingWebhook[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}
