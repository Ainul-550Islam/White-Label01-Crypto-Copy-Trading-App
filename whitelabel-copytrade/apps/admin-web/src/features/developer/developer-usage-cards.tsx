'use client';
import { useEffect, useState, type JSX } from 'react';
import { developerPlatformApi, type Usage } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';
import { ApplicationPageControls, useApplicationPages } from './application-pages';

export function DeveloperUsageCards(): JSX.Element {
  const { t } = useDeveloperI18n();
  const applications = useApplicationPages();
  const [appId, setAppId] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [webhookFailures, setWebhookFailures] = useState<number | null>(null);
  const [deliveryTruncated, setDeliveryTruncated] = useState(false);
  const [activeKeys, setActiveKeys] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (applications.loading) { setLoading(true); return; }
    if (applications.error) { setAppId(''); setError(t.failed); setLoading(false); return; }
    setError('');
    setAppId((current) => applications.rows.some((row) => row.id === current) ? current : (applications.rows[0]?.id ?? ''));
    if (applications.rows.length === 0) { setUsage(null); setActiveKeys(null); setLoading(false); }
  }, [applications.rows, applications.loading, applications.error, t.failed]);
  useEffect(() => {
    if (!appId || applications.loading || applications.error) return;
    let live = true;
    setLoading(true); setUsage(null); setWebhookFailures(null); setActiveKeys(null); setDeliveryTruncated(false); setError('');
    Promise.all([developerPlatformApi.usage({ applicationId: appId }), developerPlatformApi.analytics({ applicationId: appId })])
      .then(([report, analytics]) => { if (live) { setUsage(report); setWebhookFailures(analytics.webhookFailures); setDeliveryTruncated(analytics.deliveryTruncated); setActiveKeys(analytics.activeApiKeys); } })
      .catch(() => { if (live) setError(t.failed); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [appId, t.failed, attempt, applications.loading, applications.error]);
  const errors = usage?.byEndpoint.reduce((sum, item) => sum + item.errors4xx + item.errors5xx, 0) ?? 0;
  const failures = usage?.byEndpoint.filter((item) => item.errors4xx + item.errors5xx > 0) ?? [];
  return <section className="dev-stack" aria-labelledby="developer-overview-title">
    <h1 id="developer-overview-title">{t.developer} · {t.overview}</h1>
    {applications.rows.length > 0 && <label className="dev-filter">{t.application}{' '}
      <select value={appId} onChange={(event) => setAppId(event.target.value)}>{applications.rows.map((app) => <option value={app.id} key={app.id}>{app.name} · {app.environment}</option>)}</select>
    </label>}
    <ApplicationPageControls pages={applications} />
    {error && <div role="alert">{error} <button type="button" className="dev-button" onClick={() => { applications.retry(); setAttempt((value) => value + 1); }}>{t.retry}</button></div>}
    {loading && <p role="status">{t.loading}</p>}
    {!loading && applications.rows.length === 0 && !error && <p>{t.noApplications}</p>}
    {!loading && !error && usage && activeKeys !== null && <>
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
