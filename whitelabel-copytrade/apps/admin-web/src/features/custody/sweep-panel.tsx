'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { custodyAdminApi, type CustodySweep } from '@/api/custody-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { StepUpDialog } from '@/features/developer/step-up-dialog';

import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Sweeps move funds between the tenant's own wallets, which is why all three
 * mutations are step-up protected on the API - and each with a DIFFERENT
 * action, so a proof minted for creating a sweep cannot approve one:
 *
 *   POST custody/sweeps           -> CUSTODY_SWEEP
 *   POST custody/sweeps/approve   -> PAYOUT_APPROVE   (second operator)
 *   POST custody/sweeps/execute   -> CUSTODY_SWEEP
 *
 * The dialog is opened immediately before the mutation, the proof is minted
 * inside it, and the mutation is sent once with a stable Idempotency-Key so a
 * retried request cannot create two sweeps.
 */
type PendingAction = {
  sweep: CustodySweep;
  kind: 'approve' | 'execute';
  action: 'PAYOUT_APPROVE' | 'CUSTODY_SWEEP';
};

export function SweepPanel({ operatorId }: { operatorId: string }): JSX.Element {
  const sweeps = useResource(() => custodyAdminApi.listSweeps({ limit: 25 }), []);

  const [form, setForm] = useState({
    sourceWalletId: '',
    destinationWalletId: '',
    assetId: '',
    networkId: '',
    amount: '',
    reason: '',
  });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  const keys = useRef(new Map<string, string>());
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function set(field: keyof typeof form, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  /** The key is stable per attempted create, so a retry after a timeout is the same sweep. */
  function keyFor(identity: string): string {
    const existing = keys.current.get(identity);
    if (existing) return existing;
    const created = crypto.randomUUID();
    keys.current.set(identity, created);
    return created;
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!confirmingCreate) {
      setConfirmingCreate(true);
      setMessage('');
      setError('');
      return;
    }

    const amount = form.amount.trim();
    if (!/^\d+(?:\.\d+)?$/.test(amount) || /^0+(?:\.0+)?$/.test(amount)) {
      setError('Enter the amount to sweep as a positive decimal, for example 0.50000000.');
      return;
    }
    if (form.reason.trim().length < 5) {
      setError('Give a reason of at least five characters; it is stored with the sweep.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await custodyAdminApi.createSweep(
        {
          sourceWalletId: form.sourceWalletId.trim(),
          destinationWalletId: form.destinationWalletId.trim(),
          assetId: form.assetId.trim(),
          networkId: form.networkId.trim(),
          amount,
          reason: form.reason.trim(),
          operatorId,
        },
        keyFor(JSON.stringify(form)),
      );
      keys.current.clear();
      setForm({ sourceWalletId: '', destinationWalletId: '', assetId: '', networkId: '', amount: '', reason: '' });
      setConfirmingCreate(false);
      setMessage('The sweep request was recorded and is awaiting approval.');
      sweeps.reload();
    } catch {
      setError('The sweep could not be requested. Check the wallets, asset and network, then try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await custodyAdminApi.requestStepUp(pending.action, method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      if (intent.kind === 'approve') {
        await custodyAdminApi.approveSweep({ sweepId: intent.sweep.id, approverId: operatorId }, crypto.randomUUID());
        setMessage('The sweep was approved. A second operator must execute it.');
      } else {
        await custodyAdminApi.executeSweep({ sweepId: intent.sweep.id, operatorId }, crypto.randomUUID());
        setMessage('The sweep was submitted for execution. Track it in transactions.');
      }
      sweeps.reload();
    } catch {
      setError('The sweep action could not be completed. Check its current state before retrying.');
    } finally {
      setBusy(false);
    }
  }

  const rows = sweeps.data?.data ?? [];

  return (
    <Card
      title="Sweeps"
      description="Consolidation between the organisation's own custody wallets. Creating and executing need a verification; approving needs a second operator."
    >
      <form onSubmit={(event) => void create(event)} aria-label="Request a sweep" style={{ display: 'grid', gap: theme.space(3), marginBottom: theme.space(5) }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Source wallet ID
            <input required value={form.sourceWalletId} onChange={(event) => set('sourceWalletId', event.target.value)} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Destination wallet ID
            <input required value={form.destinationWalletId} onChange={(event) => set('destinationWalletId', event.target.value)} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Asset
            <input required value={form.assetId} onChange={(event) => set('assetId', event.target.value)} disabled={busy} placeholder="BTC" />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Network
            <input required value={form.networkId} onChange={(event) => set('networkId', event.target.value)} disabled={busy} placeholder="bitcoin" />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Amount
            <input required inputMode="decimal" value={form.amount} onChange={(event) => set('amount', event.target.value)} disabled={busy} placeholder="0.50000000" />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Reason
            <input required value={form.reason} onChange={(event) => set('reason', event.target.value)} disabled={busy} placeholder="Consolidate hot wallet" />
          </label>
        </div>
        {confirmingCreate && (
          <p role="note" style={{ margin: 0, fontSize: 13, color: theme.color.warning }}>
            Confirm the request: {formatAmount(form.amount || null, { symbol: form.assetId || undefined })} from {form.sourceWalletId || 'the source wallet'} to{' '}
            {form.destinationWalletId || 'the destination wallet'}. You will be asked to verify your identity.
          </p>
        )}
        <div style={{ display: 'flex', gap: theme.space(2) }}>
          <button type="submit" disabled={busy}>{confirmingCreate ? 'Confirm sweep request' : 'Review sweep request'}</button>
          {confirmingCreate && (
            <button type="button" disabled={busy} onClick={() => setConfirmingCreate(false)}>Cancel</button>
          )}
        </div>
      </form>

      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>
        {message}
      </p>
      {error && <ErrorNotice title="Sweep not completed" message={error} />}

      {sweeps.loading && rows.length === 0 ? (
        <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading sweeps…</p>
      ) : sweeps.error ? (
        <ErrorNotice title="Sweeps unavailable" message={sweeps.error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No sweeps requested" description="Sweeps appear here once a source wallet requests consolidation." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          emptyTitle="No sweeps requested"
          columns={[
            { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount, { symbol: row.assetId }) },
            { key: 'route', header: 'Wallets', render: (row) => <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.sourceWalletId.slice(0, 8)} → {row.destinationWalletId.slice(0, 8)}</span> },
            { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
            { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
            { key: 'requested', header: 'Requested', render: (row) => formatDateTime(row.requestedAt) },
            {
              key: 'actions',
              header: 'Actions',
              render: (row) => (
                <div style={{ display: 'flex', gap: theme.space(2) }}>
                  {row.state === 'REQUESTED' && (
                    <button type="button" disabled={busy} onClick={() => { setError(''); setMessage(''); setPending({ sweep: row, kind: 'approve', action: 'PAYOUT_APPROVE' }); }}>
                      Approve
                    </button>
                  )}
                  {row.state === 'APPROVED' && (
                    <button type="button" disabled={busy} onClick={() => { setError(''); setMessage(''); setPending({ sweep: row, kind: 'execute', action: 'CUSTODY_SWEEP' }); }}>
                      Execute
                    </button>
                  )}
                  {row.state !== 'REQUESTED' && row.state !== 'APPROVED' && <span style={{ color: theme.color.textMuted }}>—</span>}
                </div>
              ),
            },
          ]}
        />
      )}

      {pending && (
        <StepUpDialog
          description={`${pending.kind === 'approve' ? 'Approve' : 'Execute'} the sweep of ${formatAmount(pending.sweep.amount, { symbol: pending.sweep.assetId })}. This verification is used once, for this action only.`}
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}

      {sweeps.data && sweeps.data.total > rows.length && (
        <p style={{ marginTop: theme.space(3), fontSize: 12, color: theme.color.textMuted }}>
          Showing {rows.length} of {sweeps.data.total} sweeps. Refine the filters on the API to see older ones.
        </p>
      )}
    </Card>
  );
}
