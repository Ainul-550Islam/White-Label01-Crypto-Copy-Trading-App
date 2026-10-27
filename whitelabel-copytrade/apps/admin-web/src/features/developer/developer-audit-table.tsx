'use client';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { developerPlatformApi, type AuditRecord } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';

export function DeveloperAuditTable(): JSX.Element {
  const { t } = useDeveloperI18n();
  const requestNumber = useRef(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const cursor = cursors[cursors.length - 1];
  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    try {
      const page = await developerPlatformApi.audit({ cursor });
      if (request !== requestNumber.current) return;
      setRows(page.rows); setNextCursor(page.nextCursor ?? null); setError('');
    } catch { if (request === requestNumber.current) setError(t.failed); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }, [cursor, t.failed]);
  useEffect(() => { void load(); return () => { requestNumber.current += 1; }; }, [load]);
  return <section className="dev-stack" aria-labelledby="developer-audit-title">
    <h1 id="developer-audit-title">{t.audit}</h1>
    {error && <div role="alert">{error} <button type="button" className="dev-button" onClick={() => void load()}>{t.retry}</button></div>}
    {loading ? <p role="status">{t.loading}</p> : rows.length === 0 && !error ? <p>{t.noAudit}</p> : <div className="dev-table-wrap"><table className="dev-table">
      <thead><tr><th scope="col">{t.auditAction}</th><th scope="col">{t.auditActor}</th><th scope="col">{t.time}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td><code>{row.action}</code></td><td>{row.actorType} · {row.actorId}</td><td>{row.createdAt}</td></tr>)}</tbody>
    </table></div>}
    {(cursors.length > 1 || nextCursor) && <div className="dev-actions">
      <button type="button" className="dev-button" disabled={loading || cursors.length <= 1} onClick={() => setCursors((value) => value.slice(0, -1))}>{t.previous}</button>
      <span aria-live="polite">{cursors.length}</span>
      <button type="button" className="dev-button" disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setCursors((value) => [...value, nextCursor]); }}>{t.next}</button>
    </div>}
  </section>;
}
