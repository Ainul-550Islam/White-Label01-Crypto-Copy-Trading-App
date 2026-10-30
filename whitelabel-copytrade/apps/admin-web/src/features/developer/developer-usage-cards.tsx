'use client';
import { useEffect, useState, type JSX } from 'react';
import { developerPlatformApi, type Usage } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';
import { ApplicationPageControls, useApplicationPages } from './application-pages';

interface UsageReport {
  appId: string; usage: Usage; webhookFailures: number; deliveryTruncated: boolean; activeKeys: number;
}

export function DeveloperUsageCards(): JSX.Element {
  const { t } = useDeveloperI18n();
  const applications = useApplicationPages();
  const [appId, setAppId] = useState('');
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // The selection follows the loaded page without an effect: when that page changes, an id that is no
  // longer on it is replaced with the first one during the same render.
  const [seenRows, setSeenRows] = useState(applications.rows);
  if (seenRows !== applications.rows) {
    setSeenRows(applications.rows);
    setAppId((current) => applications.rows.some((row) => row.id === current) ? current : (applications.rows[0]?.id ?? ''));
  }

  useEffect(() => {
    if (!appId || applications.loading || applications.error) return;
    let live = true;
    Promise.all([developerPlatformApi.usage({ applicationId: appId }), developerPlatformApi.analytics({ applicationId: appId })])
      .then(([usage, analytics]) => {
        if (!live) return;
        setReport({ appId, usage, webhookFailures: analytics.webhookFailures, deliveryTruncated: analytics.deliveryTruncated, activeKeys: analytics.activeApiKeys });
        setError('');
      })
      .catch(() => { if (live) setError(t.failed); });
    return () => { live = false; };
  }, [appId, t.failed, attempt, applications.loading, applications.error]);

  // Loading, the numbers and the empty state are derived rather than stored. A report belongs to the
  // application it was fetched for, so switching applications can never show the previous one's
  // numbers and nothing has to be cleared when the selection changes.
  const current = report && report.appId === appId ? report : null;
  const loading = applications.loading || (Boolean(appId) && !current && !error && !applications.error);
  const shownError = error || (applications.error ? t.failed : '');
  const usage = current?.usage ?? null;
  const webhookFailures = current?.webhookFailures ?? null;
  const deliveryTruncated = current?.deliveryTruncated ?? false;
  const activeKeys = current?.activeKeys ?? null;
  const errors = usage?.byEndpoint.reduce((sum, item) => sum + item.errors4xx + item.errors5xx, 0) ?? 0;
  const failures = usage?.byEndpoint.filter((item) => item.errors4xx + item.errors5xx > 0) ?? [];
  return <section className="dev-stack" aria-labelledby="developer-overview-title">
    <h1 id="developer-overview-title">{t.developer} · {t.overview}</h1>
    {applications.rows.length > 0 && <label className="dev-filter">{t.application}{' '}
      <select value={appId} onChange={(event) => setAppId(event.target.value)}>{applications.rows.map((app) => <option value={app.id} key={app.id}>{app.name} · {app.environment}</option>)}</select>
    </label>}
    <ApplicationPageControls pages={applications} />
    {shownError && <div role="alert">{shownError} <button type="button" className="dev-button" onClick={() => { setReport(null); setError(''); applications.retry(); setAttempt((value) => value + 1); }}>{t.retry}</button></div>}
    {loading && <p role="status">{t.loading}</p>}
    {!loading && applications.rows.length === 0 && !shownError && <p>{t.noApplications}</p>}
    {!loading && !shownError && usage && activeKeys !== null && <>
      <p className="dev-muted">{t.period}: {usage.periodId}</p>
      <p className="dev-muted">{t.usageNote}</p>
      {(usage.truncated || deliveryTruncated) && <p role="status">{t.usageTruncated}</p>}
      <div className="dev-grid">
        <div className="dev-card">{t.requests}<h2>{usage.totalRequests}</h2></div>
        <div className="dev-card">{t.errorRate}<h2>{usage.totalRequests ? `${(100 * errors / usage.totalRequests).toFixed(1)}%` : '—'}</h2></div>
        <div className="dev-card">{t.activeKeys}<h2>{activeKeys}</h2></div>
        <div className="dev-card">{t.webhookFailures}<h2>{webhookFailures ?? '—'}</h2></div>
      </div>
      {usage.totalRequests === 0 && <p>{t.noRequests}</p>}
      <div className="dev-card"><h2>{t.failingEndpoints}</h2>
        {failures.length === 0 ? <p>{t.noFailures}</p> : <ul>{failures.map((item) => <li key={item.endpoint}><code>{item.endpoint.split('?')[0]?.replace(/(?:devsec|whsec|devkey)_[A-Za-z0-9]+/gi, '[redacted]')}</code> · {item.errors4xx + item.errors5xx} / {item.requests}</li>)}</ul>}
      </div>
    </>}
  </section>;
}
