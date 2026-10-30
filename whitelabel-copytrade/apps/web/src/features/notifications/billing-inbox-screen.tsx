// # Responsibility: the billing notification inbox - payment, refund, invoice and dunning messages - with read state, an unread filter and pagination.
//
// Marking read is a PUT with an Idempotency-Key: a message marked read twice must not produce two audit
// rows, and "mark all read" is one request that carries the same guarantee. The unread count comes from
// its own route so the badge in the header and the list agree on the same number.
'use client';
import type { JSX } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { billingNotificationsApi, type InboxNotification, type InboxPage } from '@/api/billing-notifications-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useCopy } from '@/i18n';
import { newIdempotencyKey } from '@/lib/idempotency-key';

export const billingInboxQueryKey = (page: number, unreadOnly: boolean) => ['billing', 'inbox', page, unreadOnly] as const;
export const billingUnreadCountQueryKey = ['billing', 'inbox', 'unread-count'] as const;

export function BillingInboxScreen(): JSX.Element {
  const { t } = useCopy();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const readKey = useRef(newIdempotencyKey('inbox-read'));
  const allKey = useRef(newIdempotencyKey('inbox-read-all'));

  const inboxQuery = useQuery({
    queryKey: billingInboxQueryKey(page, unreadOnly),
    queryFn: () => billingNotificationsApi.listInbox({ page, limit: 20, unreadOnly }),
    retry: false,
  });
  const unreadQuery = useQuery({ queryKey: billingUnreadCountQueryKey, queryFn: () => billingNotificationsApi.unreadCount(), retry: false });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['billing', 'inbox'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => billingNotificationsApi.markRead(id, readKey.current),
    onSuccess: () => { setNotice(t('inbox.markedRead')); readKey.current = newIdempotencyKey('inbox-read'); refresh(); },
    onError: () => setNotice(t('common.error')),
  });
  const markAllRead = useMutation({
    mutationFn: () => billingNotificationsApi.markAllRead(allKey.current),
    onSuccess: () => { setNotice(t('inbox.markedAllRead')); allKey.current = newIdempotencyKey('inbox-read-all'); refresh(); },
    onError: () => setNotice(t('common.error')),
  });

  if (inboxQuery.isPending) return <LoadingState message={t('common.loading')} />;
  if (inboxQuery.isError) return <ErrorState error={inboxQuery.error} onRetry={() => void inboxQuery.refetch()} />;

  const inbox: InboxPage | undefined = inboxQuery.data;
  const rows: InboxNotification[] = inbox?.data ?? [];
  const unread = unreadQuery.data?.unreadCount;

  return (
    <section aria-labelledby="inbox-heading" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="inbox-heading" className="text-lg font-semibold">{t('inbox.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('inbox.intro')}</p>
        </div>
        <p className="text-sm" aria-live="polite">
          {t('inbox.unreadCount')}: {unread ?? t('common.unavailable')}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unreadOnly} onChange={(event) => { setUnreadOnly(event.target.checked); setPage(1); }} />
          {t('inbox.unreadOnly')}
        </label>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending || (unread ?? 0) === 0}>
          {t('inbox.markAllRead')}
        </button>
        <a className="text-sm underline" href="/notifications/preferences/events">{t('inbox.preferenceLink')}</a>
      </div>

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">{notice ?? ''}</p>

      {rows.length === 0 ? (
        <EmptyState title={t('inbox.empty')} description={t('inbox.intro')} />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('inbox.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{t('inbox.event')}</th>
              <th scope="col" className="text-left">{t('inbox.channel')}</th>
              <th scope="col" className="text-left">{t('inbox.created')}</th>
              <th scope="col" className="text-left">{t('common.status')}</th>
              <th scope="col" className="text-left">{t('common.action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.title ?? row.eventKey}</td>
                <td>{row.channel}</td>
                <td>{row.createdAt}</td>
                <td>{row.read ? t('common.saved') : t('inbox.unread')}</td>
                <td>
                  {!row.read && (
                    <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => markRead.mutate(row.id)} disabled={markRead.isPending}>
                      {t('inbox.markRead')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
          {t('common.previous')}
        </button>
        <span className="text-sm">{t('common.page')} {inbox?.page ?? page}</span>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setPage((value) => value + 1)} disabled={rows.length < 20}>
          {t('common.next')}
        </button>
      </div>
    </section>
  );
}
