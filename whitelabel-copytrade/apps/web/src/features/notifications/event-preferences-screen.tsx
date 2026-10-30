// # Responsibility: per-event, per-channel billing notification preferences, changed locally and saved in one bulk request.
//
// The preference rows are keyed by (eventKey, channel); a row that was never stored is delivered, which
// the empty state says out loud instead of showing an empty list that reads as "nothing enabled". Only
// rows the customer changed are sent, so a bulk save cannot silently rewrite a preference they did not
// touch - and the whole set travels under one Idempotency-Key.
'use client';
import type { JSX } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  billingNotificationsApi,
  NOTIFICATION_CHANNELS,
  type NotificationPreference,
  type PreferenceInput,
} from '@/api/billing-notifications-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useCopy } from '@/i18n';
import { newIdempotencyKey } from '@/lib/idempotency-key';

export const billingPreferencesQueryKey = ['billing', 'preferences'] as const;

export interface RowState {
  eventKey: string;
  channel: string;
  enabled: boolean;
  locale: string | null;
}

export function changedPreferences(rows: readonly RowState[], stored: readonly RowState[]): PreferenceInput[] {
  const result: PreferenceInput[] = [];
  for (const row of rows) {
    const before = stored.find((candidate) => candidate.eventKey === row.eventKey && candidate.channel === row.channel);
    if (!before || before.enabled !== row.enabled) {
      result.push({ channel: row.channel, enabled: row.enabled, ...(row.eventKey ? { eventKey: row.eventKey } : {}) });
    }
  }
  return result;
}

export function toRows(rows: readonly NotificationPreference[]): RowState[] {
  return rows.map((row) => ({ eventKey: row.eventKey ?? '', channel: row.channel, enabled: row.enabled, locale: row.locale ?? null }));
}

export function EventPreferencesScreen(): JSX.Element {
  const { t } = useCopy();
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({ queryKey: billingPreferencesQueryKey, queryFn: () => billingNotificationsApi.getPreferences(), retry: false });
  const [draft, setDraft] = useState<RowState[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey('preferences-bulk'));

  const stored = toRows(preferencesQuery.data?.data ?? []);
  const rows = draft ?? stored;

  const save = useMutation({
    mutationFn: () => {
      const payload = changedPreferences(rows, stored);
      if (payload.length === 0) throw new Error(t('preferences.noChanges'));
      return billingNotificationsApi.bulkUpdatePreferences(payload, key.current);
    },
    onSuccess: () => {
      setProblem(null);
      setNotice(t('preferences.savedAll'));
      key.current = newIdempotencyKey('preferences-bulk');
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: billingPreferencesQueryKey });
    },
    onError: (error) => { setNotice(null); setProblem(error instanceof Error ? error.message : t('common.error')); },
  });

  if (preferencesQuery.isPending) return <LoadingState message={t('common.loading')} />;
  if (preferencesQuery.isError) return <ErrorState error={preferencesQuery.error} onRetry={() => void preferencesQuery.refetch()} />;

  const toggle = (eventKey: string, channel: string): void => {
    setDraft(rows.map((row) => (row.eventKey === eventKey && row.channel === channel ? { ...row, enabled: !row.enabled } : row)));
  };

  return (
    <section aria-labelledby="preferences-heading" className="space-y-4">
      <header>
        <h2 id="preferences-heading" className="text-lg font-semibold">{t('preferences.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('preferences.intro')}</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState title={t('preferences.empty')} description={t('preferences.empty')} />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('preferences.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{t('preferences.event')}</th>
              <th scope="col" className="text-left">{t('preferences.channel')}</th>
              <th scope="col" className="text-left">{t('preferences.enabled')}</th>
              <th scope="col" className="text-left">{t('preferences.locale')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.eventKey}-${row.channel}`}>
                <td>{row.eventKey || t('inbox.event')}</td>
                <td>{row.channel}</td>
                <td>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${row.eventKey || t('inbox.event')} ${row.channel}`}
                      checked={row.enabled}
                      onChange={() => toggle(row.eventKey, row.channel)}
                    />
                    {row.enabled ? t('preferences.enabled') : t('common.unavailable')}
                  </label>
                </td>
                <td>{row.locale ?? t('common.unavailable')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-white" onClick={() => save.mutate()} disabled={save.isPending || rows.length === 0}>
          {t('preferences.bulkSave')}
        </button>
        <span className="text-xs text-muted">{t('preferences.note')}</span>
      </div>

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
        {problem ? <span className="text-danger">{problem}</span> : notice ?? ''}
      </p>

      <p className="text-xs text-muted">{NOTIFICATION_CHANNELS.join(' · ')}</p>
    </section>
  );
}
