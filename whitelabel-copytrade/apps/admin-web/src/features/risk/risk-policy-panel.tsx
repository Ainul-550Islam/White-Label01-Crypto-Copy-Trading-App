'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { riskAdminApi, riskRows, type RiskPolicy } from '@/api/risk-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { useResource } from '@/features/shared/use-resource';

/**
 * Institutional risk policy editing.
 *
 * The thresholds are an opaque `Record<string, unknown>` on the wire, so this
 * form treats them as JSON and validates locally before the API ever sees them:
 * a malformed body would otherwise be a 400 with no useful pointer. Two further
 * rules come straight from the service:
 *
 *  * `expectedVersion` is sent on every save. If another operator saved in the
 *    meantime the API answers 409 and this form says so instead of silently
 *    overwriting their policy.
 *  * The write is step-up protected (`INSTITUTIONAL_RISK_POLICY_UPDATE`), so the
 *    verification is requested after the form is valid and immediately before
 *    the call.
 */
const SCOPES = ['TENANT', 'TRADER', 'STRATEGY', 'FOLLOWER', 'ACCOUNT'] as const;

function parseThresholds(text: string): { value?: Record<string, unknown>; error?: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { error: 'Thresholds cannot be empty. Send at least one limit.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: 'The thresholds are not valid JSON. Check for a missing comma, quote or brace.' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Thresholds must be a JSON object of limit names to values.' };
  }
  if (Object.keys(parsed as Record<string, unknown>).length === 0) {
    return { error: 'Add at least one threshold, or cancel without saving.' };
  }
  return { value: parsed as Record<string, unknown> };
}

export function RiskPolicyPanel(): JSX.Element {
  const [scope, setScope] = useState<string>('TENANT');
  const [scopeId, setScopeId] = useState('');
  const [version, setVersion] = useState(0);

  const query = scopeId.trim() ? { traderId: scopeId.trim() } : {};
  const policy = useResource(() => riskAdminApi.getPolicy(query), [scope, scopeId, version], { errorMessage: 'The risk policy could not be loaded.' });
  const history = useResource(
    () => riskAdminApi.getPolicyHistory(scopeId.trim() ? { scope, scopeId: scopeId.trim() } : { scope }),
    [scope, scopeId, version],
    { errorMessage: 'The policy history could not be loaded.' },
  );

  const [thresholds, setThresholds] = useState('');
  const [reason, setReason] = useState('');
  const [seededFor, setSeededFor] = useState('');
  const [errors, setErrors] = useState<{ thresholds?: string; reason?: string }>({});
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<{ body: { scope: string; scopeId?: string; thresholds: Record<string, unknown>; changeReason: string; expectedVersion?: number }; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  // Seed the editor from the loaded policy exactly once per (scope, version),
  // so a background refresh cannot overwrite text the operator is typing.
  const seedIdentity = policy.data ? `${policy.data.scope}:${policy.data.scopeId ?? ''}:${policy.data.version}` : '';
  if (seedIdentity !== '' && seedIdentity !== seededFor) {
    setSeededFor(seedIdentity);
    setThresholds(JSON.stringify(policy.data?.thresholds ?? {}, null, 2));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    setMessage('');
    setConflict(false);

    const parsedThresholds = parseThresholds(thresholds);
    const trimmedReason = reason.trim();
    const next: typeof errors = {};
    if (parsedThresholds.error) next.thresholds = parsedThresholds.error;
    if (trimmedReason.length < 10) next.reason = 'Give a change reason of at least ten characters; it is kept in the policy history.';
    if (scope !== 'TENANT' && scopeId.trim() === '') next.reason = 'Choose a scope id for a non-tenant policy.';

    setErrors(next);
    if (Object.keys(next).length > 0 || !parsedThresholds.value) return;

    setPending({
      body: {
        scope,
        ...(scopeId.trim() ? { scopeId: scopeId.trim() } : {}),
        thresholds: parsedThresholds.value,
        changeReason: trimmedReason,
        ...(policy.data?.version !== undefined ? { expectedVersion: policy.data.version } : {}),
      },
      key: crypto.randomUUID(),
    });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await riskAdminApi.requestPolicyProof(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      const saved = await riskAdminApi.upsertPolicy(intent.body, intent.key);
      setMessage(`Policy version ${saved.version} was saved.`);
      setReason('');
      setVersion((current) => current + 1);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true);
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('You do not have permission to change the institutional risk policy.');
      } else if (caught instanceof ApiError && caught.status === 422) {
        setErrors({ thresholds: 'The service rejected these thresholds. Review their ranges before saving again.' });
      } else {
        setError('The policy was not saved. The previous version is still in force.');
      }
    } finally {
      setBusy(false);
    }
  }

  const historyRows = riskRows<RiskPolicy>(history.data);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Policy scope" description="Choose whose policy you are reading. A tenant-wide policy applies wherever no narrower policy exists.">
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Scope
            <select value={scope} onChange={(event) => setScope(event.target.value)} disabled={busy}>
              {SCOPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 260 }}>
            Scope id {scope === 'TENANT' ? '(not needed)' : ''}
            <input value={scopeId} onChange={(event) => setScopeId(event.target.value)} disabled={busy || scope === 'TENANT'} />
          </label>
        </div>
      </Card>

      <Card
        title="Current policy"
        description="Thresholds are the limits the risk engine enforces. Saving requires a verification and a written reason."
      >
        {policy.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading policy…</p>}
        {policy.error && <ErrorNotice title="Policy unavailable" message={policy.error} />}

        {policy.data && (
          <>
            <p style={{ marginTop: 0, fontSize: 13, color: theme.color.textMuted }}>
              Version {policy.data.version}
              {policy.data.createdAt ? ` · saved ${formatDateTime(policy.data.createdAt)}` : ''}
              {policy.data.changeReason ? ` · reason: ${policy.data.changeReason}` : ''}
            </p>

            <form onSubmit={submit} aria-label="Edit the institutional risk policy" style={{ display: 'grid', gap: theme.space(3) }}>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Thresholds (JSON object)
                <textarea
                  rows={12}
                  spellCheck={false}
                  value={thresholds}
                  onChange={(event) => setThresholds(event.target.value)}
                  disabled={busy}
                  aria-invalid={errors.thresholds ? true : undefined}
                  aria-describedby={errors.thresholds ? 'thresholds-error' : undefined}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
                />
              </label>
              {errors.thresholds && (
                <p id="thresholds-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{errors.thresholds}</p>
              )}

              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, maxWidth: 520 }}>
                Change reason
                <input
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy}
                  aria-invalid={errors.reason ? true : undefined}
                  aria-describedby={errors.reason ? 'reason-error' : undefined}
                />
              </label>
              {errors.reason && <p id="reason-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{errors.reason}</p>}

              <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>

              {conflict && (
                <ErrorNotice
                  title="Someone else saved first"
                  message="The policy changed while this page was open. Reload to see the new version, then reapply your edit."
                />
              )}
              {error && <ErrorNotice title="Policy not saved" message={error} />}

              <div style={{ display: 'flex', gap: theme.space(2) }}>
                <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</button>
                <button type="button" disabled={busy} onClick={() => { setVersion((current) => current + 1); setConflict(false); setMessage(''); setError(''); }}>Reload</button>
              </div>
            </form>
          </>
        )}
      </Card>

      <Card title="Policy history" description="Every saved version with the reason recorded at the time.">
        {history.error && <ErrorNotice title="History unavailable" message={history.error} />}
        {history.data && (
          <DataTable
            rows={historyRows}
            rowKey={(row, index) => `${row.version}-${row.createdAt ?? index}`}
            emptyTitle="No policy versions yet"
            emptyDescription="Saving a policy will record its first version here."
            columns={[
              { key: 'version', header: 'Version', render: (row) => <Badge tone="neutral">v{row.version}</Badge> },
              { key: 'scope', header: 'Scope', render: (row) => `${row.scope}${row.scopeId ? ` · ${row.scopeId}` : ''}` },
              { key: 'reason', header: 'Reason', render: (row) => row.changeReason ?? '—' },
              { key: 'keys', header: 'Thresholds', render: (row) => Object.keys(row.thresholds ?? {}).join(', ') || '—' },
              { key: 'at', header: 'Saved', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </Card>

      {pending && (
        <StepUpDialog
          description="Verify your identity to save the institutional risk policy. This verification is single-use."
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </div>
  );
}
