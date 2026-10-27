'use client';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { developerPlatformApi, type ApiVersion, type StepUpMethod } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';
import { ApplicationPageControls, useApplicationPages } from './application-pages';
import { StepUpDialog } from './step-up-dialog';
import { confirmVersion } from './mutation-response';

type PendingPin = { applicationId: string; version: string; identity: string; key: string };

export function ApiVersionPanel({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useDeveloperI18n();
  const applications = useApplicationPages();
  const intentKeys = useRef(new Map<string, string>());
  const [versions, setVersions] = useState<ApiVersion[] | null>(null);
  const [applicationId, setApplicationId] = useState('');
  const [current, setCurrent] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [loadingPin, setLoadingPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPin | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [versionsAttempt, setVersionsAttempt] = useState(0);
  const selectedApp = applications.rows.find((app) => app.id === applicationId && app.state !== 'REVOKED');

  useEffect(() => {
    let live = true;
    setVersions(null);
    developerPlatformApi.versions().then((result) => { if (live) setVersions(result.versions); })
      .catch(() => { if (live) setError(t.failed); });
    return () => { live = false; };
  }, [versionsAttempt, t.failed]);
  useEffect(() => {
    if (applications.loading || applications.error) return;
    const eligible = applications.rows.filter((app) => app.state !== 'REVOKED');
    setApplicationId((currentId) => eligible.some((app) => app.id === currentId) ? currentId : (eligible[0]?.id ?? ''));
  }, [applications.rows, applications.loading, applications.error]);
  useEffect(() => {
    if (!applicationId || !selectedApp) { setCurrent(''); setSelected(''); return; }
    let live = true;
    setCurrent(''); setSelected(''); setLoadingPin(true);
    developerPlatformApi.applicationVersion(applicationId).then((result) => {
      if (live) { setCurrent(result.version); setSelected(result.version); }
    }).catch(() => { if (live) setError(t.failed); })
      .finally(() => { if (live) setLoadingPin(false); });
    return () => { live = false; };
  }, [applicationId, selectedApp?.id, attempt, t.failed]);

  function prepare(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canManage || busy || !selectedApp || !current || selected === current || !versions?.some((v) => v.version === selected)) return;
    const identity = `${selectedApp.id}:${selected}`;
    const key = intentKeys.current.get(identity) ?? crypto.randomUUID();
    intentKeys.current.set(identity, key);
    setVerificationError('');
    setPending({ applicationId: selectedApp.id, version: selected, identity, key });
  }
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError(''); setError(''); setNotice('');
    try {
      await developerPlatformApi.verifyStepUp('DEVELOPER_APPLICATION_VERSION_PIN', method, value, crypto.randomUUID());
    } catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const intent = pending;
    setPending(null);
    try {
      const result = await developerPlatformApi.pinApplicationVersion(intent.applicationId, intent.version, intent.key);
      confirmVersion(result, intent.applicationId, intent.version);
      intentKeys.current.delete(intent.identity);
      setNotice(t.versionSaved);
    } catch { setError(t.uncertain); }
    finally { setBusy(false); setAttempt((count) => count + 1); }
  }

  return <section className="dev-stack" aria-labelledby="api-versions-title">
    <h1 id="api-versions-title">{t.versions}</h1>
    {error && <div role="alert">{error} <button type="button" className="dev-button" onClick={() => { setError(''); setAttempt((v) => v + 1); if (!versions) setVersionsAttempt((v) => v + 1); }}>{t.retry}</button></div>}
    {notice && <p role="status">{notice}</p>}
    {pending && <StepUpDialog description={t.confirmVersion} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    {!versions && !error && <p role="status">{t.loading}</p>}
    <form onSubmit={prepare} className="dev-card dev-form">
      <label>{t.application}<select value={applicationId} onChange={(event) => { setApplicationId(event.target.value); setNotice(''); }} disabled={busy || applications.loading}>
        <option value="">{t.chooseApplication}</option>{applications.rows.filter((app) => app.state !== 'REVOKED').map((app) => <option key={app.id} value={app.id}>{app.name} · {app.environment}</option>)}
      </select></label>
      <ApplicationPageControls pages={applications} disabled={busy} />
      {applications.error && <div role="alert">{t.failed} <button type="button" className="dev-button" onClick={applications.retry}>{t.retry}</button></div>}
      {!applications.loading && !applications.error && !selectedApp && <p>{t.noEligibleOnPage}</p>}
      {loadingPin && <p role="status">{t.loading}</p>}
      {current && <p>{t.currentVersion}: <strong>{current}</strong></p>}
      {versions && current && <label>{t.selectVersion}<select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={!canManage || busy}>
        {versions.map((version) => <option value={version.version} key={version.version} disabled={version.state === 'SUNSET'}>{version.version} · {version.state}</option>)}
      </select></label>}
      <p>{t.versionNotice}</p>{current && <code>X-Api-Version: {current}</code>}
      {canManage ? <button className="dev-button" type="submit" disabled={busy || applications.loading || applications.error || loadingPin || !selectedApp || !current || selected === current}>{busy ? t.saving : t.saveVersion}</button> : <p className="dev-muted">{t.manageNeeded}</p>}
    </form>
    {versions && <div className="dev-card"><h2>{t.deprecation}</h2>
      {versions.map((version) => <p key={version.version}><strong>{version.version}</strong> · {version.state} · {version.deprecatedAt ?? t.none} / {version.sunsetAt ?? t.none} · {t.replacement}: {version.replacement ?? t.none}</p>)}
    </div>}
  </section>;
}
