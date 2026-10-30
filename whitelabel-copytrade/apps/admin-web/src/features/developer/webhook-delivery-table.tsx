'use client';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { developerPlatformApi, type Delivery, type StepUpMethod } from '@/api/developer-platform-api';
import { localizedState, useDeveloperI18n } from './i18n';
import { StepUpDialog } from './step-up-dialog';
import { confirmReplay } from './mutation-response';

const states = ['QUEUED', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'EXHAUSTED', 'CANCELLED'];
const PAGE_SIZE = 10;
export function WebhookDeliveryTable({ endpointId, canManage }: { endpointId: string; canManage: boolean }): JSX.Element {
  const { t } = useDeveloperI18n();
  const requestNumber = useRef(0);
  const keys = useRef(new Map<string, string>());
  const [state, setState] = useState('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [pending, setPending] = useState<{ eventId: string; key: string } | null>(null);
  const [verificationError, setVerificationError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cursor = cursors[page];
  // A promise chain rather than an async function, because the effect below calls it and React 19
  // refuses a function that writes state synchronously on the way in.
  const load = useCallback((): Promise<void> => {
    const request = ++requestNumber.current;
    return developerPlatformApi.listDeliveries(endpointId, { ...(state ? { state } : {}), limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      .then((result) => {
        if (request === requestNumber.current) { setRows(result.rows); setNextCursor(result.nextCursor ?? null); setError(''); }
      })
      .catch(() => { if (request === requestNumber.current) { setRows([]); setNextCursor(null); setError(t.failed); } })
      .finally(() => { if (request === requestNumber.current) setLoading(false); });
  }, [endpointId, state, cursor, t.failed]);
  useEffect(() => { void load(); return () => { requestNumber.current += 1; }; }, [load]);
  function prepare(eventId: string): void {
    if (busy) return;
    const key = keys.current.get(eventId) ?? crypto.randomUUID();
    keys.current.set(eventId, key); setVerificationError(''); setPending({ eventId, key });
  }
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError(''); setError(''); setNotice('');
    try { await developerPlatformApi.verifyStepUp('WEBHOOK_REPLAY', method, value, crypto.randomUUID()); }
    catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const intent = pending; setPending(null);
    try {
      const result = await developerPlatformApi.replayWebhook(endpointId, intent.eventId, intent.key);
      confirmReplay(result, intent.eventId);
      keys.current.delete(intent.eventId);
      setNotice(`${t.replayAccepted} ${result.deliveryId}`);
      await load();
    } catch { setError(t.uncertain); }
    finally { setBusy(false); }
  }
  return <section className="dev-stack" aria-labelledby="delivery-title">
    <h1 id="delivery-title">{t.deliveries}</h1>
    <p className="dev-muted">{t.redactionNotice}</p>
    {pending && <StepUpDialog description={t.confirmReplay} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    <label className="dev-filter">{t.filter}{' '}<select value={state} onChange={(event) => { setState(event.target.value); setCursors([undefined]); setPage(0); }}>
      <option value="">{t.all}</option>{states.map((value) => <option value={value} key={value}>{localizedState(value, t)}</option>)}
    </select></label>
    {error && <div role="alert">{error} <button type="button" className="dev-button" onClick={() => void load()}>{t.retry}</button></div>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {loading ? <p role="status">{t.loading}</p> : rows.length === 0 && !error ? <p>{t.noDeliveries}</p> : <div className="dev-table-wrap"><table className="dev-table">
      <thead><tr><th scope="col">{t.event}</th><th scope="col">{t.status}</th><th scope="col">{t.attempts}</th><th scope="col">{t.response}</th><th scope="col">{t.time}</th><th scope="col">{t.payload}</th>{canManage && <th scope="col">{t.replay}</th>}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        <td>{row.eventType}<br /><code>{row.eventId}</code></td><td>{localizedState(row.state, t)}</td><td>{row.attempt}</td><td>{row.responseStatus ?? '—'}</td><td>{row.createdAt}</td>
        <td>{row.payload ? <details><summary>{t.payload}</summary><pre>{JSON.stringify(row.payload, null, 2)}</pre></details> : t.payloadUnavailable}</td>
        {canManage && <td><button className="dev-button" type="button" disabled={busy} onClick={() => prepare(row.eventId)}>{t.replay}</button></td>}
      </tr>)}</tbody>
    </table></div>}
    <div className="dev-actions"><button type="button" className="dev-button" disabled={loading || page <= 0} onClick={() => setPage((value) => value - 1)}>{t.previous}</button><span>{page + 1}</span><button type="button" className="dev-button" disabled={loading || !nextCursor} onClick={() => { if (!nextCursor) return; setCursors((prior) => [...prior.slice(0, page + 1), nextCursor]); setPage((value) => value + 1); }}>{t.next}</button></div>
  </section>;
}
