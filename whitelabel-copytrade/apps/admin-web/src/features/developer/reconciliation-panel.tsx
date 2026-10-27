'use client';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { developerPlatformApi, type ReconciliationReport } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';

const PAGE_SIZE = 50;
export function ReconciliationPanel({ canReconcile }: { canReconcile: boolean }): JSX.Element {
  const { t } = useDeveloperI18n();
  const requestNumber = useRef(0);
  const [tenantId, setTenantId] = useState('');
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { requestNumber.current += 1; }, []);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const request = ++requestNumber.current;
    setLoading(true); setError(''); setReport(null); setPage(0);
    try {
      const next = await developerPlatformApi.reconciliation(tenantId.trim() || undefined);
      if (request === requestNumber.current) setReport(next);
    } catch { if (request === requestNumber.current) setError(t.failed); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }
  return <section className="dev-stack" aria-labelledby="reconciliation-title">
    <h1 id="reconciliation-title">{t.reconciliation}</h1>
    {!canReconcile ? <p role="status">{t.platformOnly}</p> : <>
      <form className="dev-card dev-form" onSubmit={(event) => void submit(event)}>
        <label>{t.tenantId}<input value={tenantId} onChange={(event) => setTenantId(event.target.value)}
          pattern="[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}" maxLength={36} /></label>
        <button type="submit" className="dev-button" disabled={loading}>{loading ? t.loading : t.runReport}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {report && <div className="dev-card">
        <p>{t.tenantId}: <code>{report.tenantId}</code></p><p>{t.scanTime}: {report.scannedAt}</p>
        {report.truncated && <p role="alert">{t.incompleteScan}</p>}
        {report.findings.length === 0 ? <p>{t.noFindings}</p> : <>
          <div className="dev-table-wrap"><table className="dev-table"><thead><tr><th scope="col">{t.findings}</th><th scope="col">{t.severity}</th><th scope="col">{t.subject}</th></tr></thead>
            <tbody>{report.findings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, index) => <tr key={`${item.kind}:${item.subjectId}:${index}`}><td><code>{item.kind}</code></td><td>{item.severity === 'HIGH' ? t.severityHigh : item.severity === 'MEDIUM' ? t.severityMedium : t.severityLow}</td><td><code>{item.subjectType}: {item.subjectId}</code></td></tr>)}</tbody>
          </table></div>
          {report.findings.length > PAGE_SIZE && <div className="dev-actions"><button type="button" className="dev-button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t.previous}</button><span aria-live="polite">{page + 1}</span><button type="button" className="dev-button" disabled={(page + 1) * PAGE_SIZE >= report.findings.length} onClick={() => setPage((value) => value + 1)}>{t.next}</button></div>}
        </>}
      </div>}
    </>}
  </section>;
}
