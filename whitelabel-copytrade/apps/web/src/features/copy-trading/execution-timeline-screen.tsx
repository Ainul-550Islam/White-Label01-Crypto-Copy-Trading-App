// # Responsibility: one copy execution's recorded timeline, in the order the engine recorded it, with retries and failure reasons shown rather than summarised.
'use client';
import type { JSX } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { copyTradingExtendedApi, type CopyExecutionTimeline } from '@/api/copy-trading-extended-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { useCopy } from '@/i18n';

export const executionTimelineQueryKey = (executionId: string) => ['copy-trading', 'timeline', executionId] as const;

export function ExecutionTimelineScreen({ initialExecutionId = '' }: { initialExecutionId?: string }): JSX.Element {
  const { t } = useCopy();
  const [executionId, setExecutionId] = useState(initialExecutionId);
  const [requested, setRequested] = useState(initialExecutionId.trim());
  const query = useQuery({
    queryKey: executionTimelineQueryKey(requested),
    queryFn: () => copyTradingExtendedApi.getExecutionTimeline(requested),
    enabled: requested.length > 0,
    retry: false,
  });
  const timeline: CopyExecutionTimeline | null | undefined = query.data;

  return (
    <section aria-labelledby="timeline-heading" className="space-y-4">
      <header>
        <h2 id="timeline-heading" className="text-lg font-semibold">{t('timeline.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('timeline.intro')}</p>
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequested(executionId.trim());
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t('timeline.executionId')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={executionId} onChange={(event) => setExecutionId(event.target.value)} />
        </label>
        <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-white" disabled={executionId.trim().length === 0}>
          {t('timeline.load')}
        </button>
      </form>

      {requested.length === 0 && <EmptyState title={t('timeline.title')} description={t('timeline.intro')} />}
      {requested.length > 0 && query.isPending && <LoadingState message={t('common.loading')} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {requested.length > 0 && query.isSuccess && timeline === null && (
        <EmptyState title={t('timeline.title')} description={t('timeline.unavailable')} />
      )}

      {timeline && (
        <div aria-live="polite" className="space-y-2">
          <p className="text-sm">
            <span className="text-muted">{t('common.status')}: </span>
            <StatusBadge status={timeline.currentStatus} />
          </p>
          {timeline.entries.length === 0 ? (
            <EmptyState title={t('timeline.title')} description={t('timeline.unavailable')} />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('timeline.title')} {timeline.executionId}</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">{t('timeline.occurredAt')}</th>
                  <th scope="col" className="text-left">{t('timeline.type')}</th>
                  <th scope="col" className="text-left">{t('timeline.event')}</th>
                  <th scope="col" className="text-left">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {timeline.entries.map((entry, index) => (
                  <tr key={`${entry.attempt}-${entry.at}-${index}`}>
                    <td>{entry.at}</td>
                    <td>{t('timeline.event')} {entry.attempt}</td>
                    <td>{entry.failureReasonCode ?? entry.failureReasonText ?? t('common.unavailable')}</td>
                    <td><StatusBadge status={entry.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
