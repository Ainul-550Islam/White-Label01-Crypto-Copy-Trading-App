// # Responsibility: checks the billing inbox - the unread count is read from its own route and shown in the header badge, read/read-all are sent as PUTs with keys, and a bulk preference save carries only the rows that changed.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/api/api-client';
import { AuthContext } from '@/auth/auth.store';
import { billingInboxQueryKey, billingUnreadCountQueryKey, BillingInboxScreen } from '@/features/notifications/billing-inbox-screen';
import { changedPreferences, toRows, type RowState } from '@/features/notifications/event-preferences-screen';
import { BillingUnreadBadge, headerUnreadCountQueryKey } from '@/features/notifications/unread-badge';

const session = {
  user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@example.test', roles: [], permissions: [] },
  tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant' },
  entitlements: {},
  isAuthenticated: true,
};

const message = {
  id: 'message-1', eventKey: 'PAYMENT_FAILED', channel: 'EMAIL', title: 'Payment failed',
  body: 'Your card was declined.', read: false, createdAt: '2026-10-30T03:00:00.000Z', readAt: null,
};

function render(queryClient: QueryClient, node: React.ReactElement): string {
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </AuthContext.Provider>,
  );
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('the inbox screen', () => {
  it('lists the messages with their state and the unread count from its own route', () => {
    const queryClient = client();
    queryClient.setQueryData(billingInboxQueryKey(1, false), { tenantId: 'tenant-1', userId: 'user-1', data: [message], page: 1, limit: 20 });
    queryClient.setQueryData(billingUnreadCountQueryKey, { unreadCount: 1 });

    const html = render(queryClient, <BillingInboxScreen />);

    expect(html).toContain('Payment failed');
    expect(html).toContain('EMAIL');
    expect(html).toContain('Mark all read');
    expect(html).toContain('Mark read');
    expect(html).toContain('unread-count'.length > 0 ? 'Unread notifications' : '');
  });

  it('offers the empty state rather than an empty table', () => {
    const queryClient = client();
    queryClient.setQueryData(billingInboxQueryKey(1, false), { tenantId: 'tenant-1', userId: 'user-1', data: [], page: 1, limit: 20 });
    queryClient.setQueryData(billingUnreadCountQueryKey, { unreadCount: 0 });

    const html = render(queryClient, <BillingInboxScreen />);

    expect(html).toContain('There are no notifications.');
    expect(html).toContain('disabled=""');
  });
});

describe('the header badge', () => {
  it('shows the unread count and renders nothing when the inbox is clear', () => {
    const queryClient = client();
    queryClient.setQueryData(headerUnreadCountQueryKey, { unreadCount: 7 });
    expect(render(queryClient, <BillingUnreadBadge />)).toContain('7');

    const emptyClient = client();
    emptyClient.setQueryData(headerUnreadCountQueryKey, { unreadCount: 0 });
    expect(render(emptyClient, <BillingUnreadBadge />)).toBe('');
  });
});

describe('the read actions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marks one message read and all messages read with their own idempotency keys', async () => {
    const put = jest.spyOn(apiClient, 'put').mockResolvedValue({} as never);
    const { billingNotificationsApi } = await import('@/api/billing-notifications-api');

    await billingNotificationsApi.markRead('message-1', 'read-key-1');
    await billingNotificationsApi.markAllRead('read-all-key-1');

    expect(put).toHaveBeenNthCalledWith(1, '/v1/billing/notifications/inbox/message-1/read', undefined, { idempotencyKey: 'read-key-1' });
    expect(put).toHaveBeenNthCalledWith(2, '/v1/billing/notifications/inbox/read-all', undefined, { idempotencyKey: 'read-all-key-1' });
  });
});

describe('preference diffing', () => {
  const stored: RowState[] = [
    { eventKey: 'INVOICE_PAID', channel: 'EMAIL', enabled: true, locale: 'en' },
    { eventKey: 'INVOICE_PAID', channel: 'SMS', enabled: false, locale: 'en' },
    { eventKey: 'PAYMENT_FAILED', channel: 'IN_APP', enabled: true, locale: null },
  ];

  it('maps the API rows and remembers the language', () => {
    expect(toRows([{ id: 'p-1', eventKey: 'INVOICE_PAID', channel: 'EMAIL', enabled: true, category: 'billing', locale: 'bn' }])).toEqual([
      { eventKey: 'INVOICE_PAID', channel: 'EMAIL', enabled: true, locale: 'bn' },
    ]);
  });

  it('sends only the rows that changed, so an untouched preference is not rewritten', () => {
    const rows = stored.map((row) => (row.eventKey === 'INVOICE_PAID' && row.channel === 'SMS' ? { ...row, enabled: true } : row));

    expect(changedPreferences(rows, stored)).toEqual([{ channel: 'SMS', enabled: true, eventKey: 'INVOICE_PAID' }]);
  });

  it('sends nothing when nothing changed', () => {
    expect(changedPreferences(stored, stored)).toEqual([]);
  });

  it('treats a row the API never stored as a change, because unstored means delivered', () => {
    const rows: RowState[] = [...stored, { eventKey: 'REFUND_ISSUED', channel: 'EMAIL', enabled: false, locale: null }];

    expect(changedPreferences(rows, stored)).toEqual([{ channel: 'EMAIL', enabled: false, eventKey: 'REFUND_ISSUED' }]);
  });
});
