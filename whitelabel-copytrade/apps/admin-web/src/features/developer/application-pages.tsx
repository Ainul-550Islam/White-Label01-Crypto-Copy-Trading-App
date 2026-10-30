'use client';
import { useEffect, useState, type JSX } from 'react';
import { developerPlatformApi, type DeveloperApplication } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';

export function useApplicationPages(enabled = true) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<DeveloperApplication[]>([]);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = cursors[cursors.length - 1];
  // The request this render describes. A page is loading until a settled response carries this key,
  // so paging and retry turn the spinner on by changing the key rather than by writing state on the
  // way into an effect - the pattern React 19's lint rules reject, and one that costs an extra
  // render besides.
  const requestKey = `${cursor ?? ''}#${attempt}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const key = `${cursor ?? ''}#${attempt}`;
    developerPlatformApi.listApplications({ limit: 100, cursor }).then((page) => {
      if (live) { setRows(page.rows); setNextCursor(page.nextCursor ?? null); setError(false); }
    }).catch(() => { if (live) { setRows([]); setNextCursor(null); setError(true); } })
      .finally(() => { if (live) setSettledKey(key); });
    return () => { live = false; };
  }, [cursor, attempt, enabled]);
  const loading = enabled && settledKey !== requestKey;
  return {
    rows, loading, error, page: cursors.length, hasPrevious: cursors.length > 1, hasNext: Boolean(nextCursor),
    previous: () => setCursors((value) => value.slice(0, -1)),
    next: () => { if (nextCursor) setCursors((value) => [...value, nextCursor]); },
    retry: () => setAttempt((value) => value + 1),
  };
}

type Pages = ReturnType<typeof useApplicationPages>;
export function ApplicationPageControls({ pages, disabled = false }: { pages: Pages; disabled?: boolean }): JSX.Element | null {
  const { t } = useDeveloperI18n();
  if (!pages.hasPrevious && !pages.hasNext) return null;
  return <div className="dev-actions" role="navigation" aria-label={t.applicationPages}>
    <button type="button" className="dev-button" disabled={disabled || pages.loading || !pages.hasPrevious} onClick={pages.previous}>{t.previous}</button>
    <span aria-live="polite">{pages.page}</span>
    <button type="button" className="dev-button" disabled={disabled || pages.loading || !pages.hasNext} onClick={pages.next}>{t.next}</button>
  </div>;
}
