import { billingNotificationsAdminApi as api, webhookRows } from '@/api/billing-notifications-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const base = '/v1/billing/notifications';
const key = 'notify-intent-1';
const opts = { idempotencyKey: key };

afterEach(() => jest.clearAllMocks());

describe('notification history', () => {
  it('lists history with the filters the DTO declares', () => {
    void api.getHistory({ status: 'FAILED', channel: 'EMAIL', page: 2, limit: 50, search: '' });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/history`, {
      searchParams: { status: 'FAILED', channel: 'EMAIL', page: 2, limit: 50 },
    });
  });

  it('reads one history record by encoded id', () => {
    void api.getHistoryById('n/1');

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/history/n%2F1`);
  });
});

describe('webhook management', () => {
  it('creates a webhook with the required DTO fields and a key', () => {
    const input = { endpointUrl: 'https://hooks.example.test/billing', eventTypes: ['invoice.paid'], secret: 'whsec_1', enabled: true };
    void api.createWebhook(input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${base}/webhooks`, input, opts);
  });

  it('updates, rotates and deletes with keys, sending only the DTO fields', () => {
    void api.updateWebhook('w/1', { enabled: false }, key);
    void api.rotateSecret('w-1', { newSecret: 'whsec_2' }, key);
    void api.deleteWebhook('w-1', key);

    expect(apiClient.put).toHaveBeenCalledWith(`${base}/webhooks/w%2F1`, { enabled: false }, opts);
    expect(apiClient.post).toHaveBeenCalledWith(`${base}/webhooks/w-1/rotate-secret`, { newSecret: 'whsec_2' }, opts);
    expect(apiClient.delete).toHaveBeenCalledWith(`${base}/webhooks/w-1`, opts);
  });

  it('lists webhooks', () => {
    void api.listWebhooks();

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/webhooks`);
  });
});

describe('worker and reconciliation (platform only)', () => {
  it('runs the worker for an explicit batch size', () => {
    void api.processWorker(100, 'worker-key');

    // The key travels with the batch size: a retried click must not process a second batch.
    expect(apiClient.post).toHaveBeenCalledWith(`${base}/worker/process`, undefined, { searchParams: { batchSize: 100 }, idempotencyKey: 'worker-key' });
  });

  it('detects stuck notifications for an explicit threshold', () => {
    void api.detectStuck(6);

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/worker/stuck`, { searchParams: { thresholdHours: 6 } });
  });

  it('reconciles one tenant and all tenants', () => {
    void api.reconcileTenant('t/1');
    void api.reconcileAll(50, 'reconcile-key');

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/reconciliation/t%2F1`);
    expect(apiClient.post).toHaveBeenCalledWith(`${base}/reconciliation/all`, undefined, { searchParams: { limit: 50 }, idempotencyKey: 'reconcile-key' });
  });
});

describe('row shapes', () => {
  it('accepts a bare array or a data envelope', () => {
    expect(webhookRows([{ id: 'w' } as never])).toEqual([{ id: 'w' }]);
    expect(webhookRows({ data: [{ id: 'w' } as never] })).toEqual([{ id: 'w' }]);
    expect(webhookRows(null)).toEqual([]);
  });
});
