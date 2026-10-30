// # Responsibility: pins the billing notification inbox and preference routes - including the bulk preference write - and proves the four PUTs carry an idempotency key.

import { apiClient } from '@/api/api-client';
import { billingNotificationsApi, NOTIFICATION_CHANNELS } from '@/api/billing-notifications-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const put = apiClient.put as jest.Mock;

beforeEach(() => {
  get.mockResolvedValue({ data: [], page: 1, limit: 20 });
  put.mockResolvedValue({});
});
afterEach(() => jest.resetAllMocks());

const BASE = '/v1/billing/notifications';

test('reads the inbox with its filters as search params', async () => {
  await billingNotificationsApi.listInbox({ unreadOnly: true, eventKey: 'PAYMENT_FAILED', channel: 'EMAIL', page: 2, limit: 20 });

  expect(get).toHaveBeenCalledWith(`${BASE}/inbox`, { searchParams: { unreadOnly: true, eventKey: 'PAYMENT_FAILED', channel: 'EMAIL', page: 2, limit: 20 } });
});

test('reads the unread count from its own route', async () => {
  get.mockResolvedValue({ unreadCount: 3 });

  await expect(billingNotificationsApi.unreadCount()).resolves.toEqual({ unreadCount: 3 });

  expect(get).toHaveBeenCalledWith(`${BASE}/inbox/unread-count`);
});

test.each([
  ['markRead', () => billingNotificationsApi.markRead('message/1', 'key-read'), `${BASE}/inbox/message%2F1/read`],
  ['markAllRead', () => billingNotificationsApi.markAllRead('key-read-all'), `${BASE}/inbox/read-all`],
  ['updatePreference', () => billingNotificationsApi.updatePreference({ eventKey: 'INVOICE_PAID', channel: 'EMAIL', enabled: false }, 'key-pref'), `${BASE}/preferences`],
  ['bulkUpdatePreferences', () => billingNotificationsApi.bulkUpdatePreferences([{ channel: 'EMAIL', enabled: true }], 'key-bulk'), `${BASE}/preferences/bulk`],
])('%s puts to %s with the caller key', async (_name, call, path) => {
  await call();

  const [calledPath, , options] = put.mock.calls[0] as [string, unknown, { idempotencyKey: string }];
  expect(calledPath).toBe(path);
  expect(options.idempotencyKey).toMatch(/^key-/);
});

test('sends the bulk save as one preferences array', async () => {
  const preferences = [
    { eventKey: 'INVOICE_PAID', channel: 'EMAIL', enabled: false },
    { channel: 'SMS', enabled: true },
  ];

  await billingNotificationsApi.bulkUpdatePreferences(preferences, 'key-bulk-2');

  expect(put).toHaveBeenCalledWith(`${BASE}/preferences/bulk`, { preferences }, { idempotencyKey: 'key-bulk-2' });
});

test('reads preferences and exposes the channels the API can deliver on', async () => {
  await billingNotificationsApi.getPreferences({ category: 'billing' });

  expect(get).toHaveBeenCalledWith(`${BASE}/preferences`, { searchParams: { category: 'billing' } });
  expect(NOTIFICATION_CHANNELS).toEqual(['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'WEBHOOK']);
});
