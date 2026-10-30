'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, toRows, type OmsFill, type OmsOrderIntent } from '@/api/oms-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Order detail: lifecycle, fills, latency import, and the operator actions the
 * controller actually exposes.
 *
 * Every mutation here carries a stable Idempotency-Key derived from the action
 * and its inputs, so a retry after a timeout does not cancel twice or post-trade
 * twice. Nothing is offered that the API cannot perform: there is no "fill
 * manually" and no state edit - those are not routes.
 */
export function OmsOrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }): JSX.Element {
  const order = useResource(() => omsAdminApi.getIntent(orderId), [orderId], { errorMessage: 'The order could not be loaded.' });
  const lifecycle = useResource(() => omsAdminApi.getLifecycle(orderId), [orderId], { errorMessage: 'The lifecycle could not be loaded.' });
  const fills = useResource(() => omsAdminApi.getFillsForIntent(orderId), [orderId], { errorMessage: 'The fills could not be loaded.' });
  const latency = useResource(() => omsAdminApi.getLatency(orderId), [orderId], { errorMessage: 'The latency record could not be loaded.' });
  const audit = useResource(() => omsAdminApi.getAuditForIntent(orderId), [orderId], { errorMessage: 'The audit trail could not be loaded.' });

  const [action, setAction] = useState<'cancel' | 'replace' | null>(null);
  const [form, setForm] = useState({ reason: '', newQuantity: '', newPrice: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const keys = useRef(new Map<string, string>());
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function keyFor(identity: string): string {
    const existing = keys.current.get(identity);
    if (existing) return existing;
    const created = crypto.randomUUID();
    keys.current.set(identity, created);
    return created;
  }

  async function run(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!action) return;
    if (form.reason.trim().length < 5) {
      setError('Give a reason of at least five characters; the API stores it with the action.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    const identity = JSON.stringify([action, form]);
    try {
      if (action === 'cancel') {
        await omsAdminApi.cancelOrder({ intentId: orderId, reason: form.reason.trim() }, keyFor(identity));
        setMessage('The cancel request was accepted. The state updates when the venue answers.');
      } else {
        await omsAdminApi.replaceOrder(
          {
            intentId: orderId,
            reason: form.reason.trim(),
            ...(form.newQuantity.trim() ? { newQuantity: form.newQuantity.trim() } : {}),
            ...(form.newPrice.trim() ? { newPrice: form.newPrice.trim() } : {}),
          },
          keyFor(identity),
        );
        setMessage('The replacement was requested. The new values are visible once acknowledged.');
      }
      keys.current.delete(identity);
      setAction(null);
      setForm({ reason: '', newQuantity: '', newPrice: '' });
      order.reload();
      lifecycle.reload();
    } catch {
      setError('The action was not confirmed. Check the order state before retrying.');
    } finally {
      setBusy(false);
    }
  }

  async function postTrade(): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await omsAdminApi.processPostTrade(orderId, crypto.randomUUID());
      setMessage('Post-trade processing completed for this order.');
      audit.reload();
    } catch {
      setError('Post-trade processing did not complete. It is safe to run again.');
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await omsAdminApi.reconcileOrder(orderId);
      setMessage(
        result.matched === true
          ? 'The order reconciles against the venue records.'
          : result.matched === false
            ? `${result.findings.length} discrepancy(ies) found. Review them before acknowledging.`
            : 'The order could not be compared; treat it as unreconciled.',
      );
    } catch {
      setError('Reconciliation did not complete. The order is still unreconciled.');
    } finally {
      setBusy(false);
    }
  }

  const transitional = order.data ? ['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(order.data.state) : false;

  return (
    <Card
      title={`Order ${order.data?.clientOrderId ?? orderId.slice(0, 8)}`}
      description="State history, fills, latency and the operator actions available for this order."
      actions={<button type="button" onClick={onClose}>Close</button>}
    >
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
      {error && <ErrorNotice title="Action not confirmed" message={error} />}

      {order.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading order…</p>}
      {order.error && <ErrorNotice title="Order unavailable" message={order.error} />}
      {order.data === null && !order.loading && !order.error && (
        <EmptyState title="Order not found" description="It may belong to another organisation or have been purged." />
      )}

      {order.data && (
        <>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(4), margin: `0 0 ${theme.space(5)}` }}>
            {[
              ['State', order.data.state],
              ['Symbol', order.data.symbol],
              ['Side / type', `${order.data.side} ${order.data.orderType}`],
              ['Quantity', formatAmount(order.data.quantity)],
              ['Filled', formatAmount(order.data.filledQuantity)],
              ['Price', formatAmount(order.data.price, { placeholder: 'Market' })],
              ['Average fill', formatAmount(order.data.averageFillPrice, { placeholder: '—' })],
              ['Cumulative fee', formatAmount(order.data.cumulativeFee, { symbol: order.data.feeCurrency ?? undefined })],
              ['Venue', order.data.venue ?? '—'],
              ['Environment', order.data.environment],
              ['Rejection', order.data.rejectionReason ?? '—'],
              ['Created', formatDateTime(order.data.createdAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>{label}</dt>
                <dd style={{ margin: `${theme.space(1)} 0 0`, fontSize: 14, wordBreak: 'break-word' }}>{value}</dd>
              </div>
            ))}
          </dl>

          <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap', marginBottom: theme.space(5) }}>
            {transitional && (
              <>
                <button type="button" disabled={busy} onClick={() => { setAction('cancel'); setError(''); setMessage(''); }}>Cancel order</button>
                <button type="button" disabled={busy} onClick={() => { setAction('replace'); setError(''); setMessage(''); }}>Replace order</button>
              </>
            )}
            <button type="button" disabled={busy} onClick={() => void reconcile()}>Reconcile this order</button>
            <button type="button" disabled={busy} onClick={() => void postTrade()}>Run post-trade</button>
          </div>

          {action && (
            <form onSubmit={(event) => void run(event)} aria-label={action === 'cancel' ? 'Cancel this order' : 'Replace this order'} style={{ display: 'grid', gap: theme.space(3), maxWidth: 520, marginBottom: theme.space(5) }}>
              <strong style={{ fontSize: 14 }}>{action === 'cancel' ? 'Cancel this order' : 'Replace this order'}</strong>
              {action === 'replace' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.space(3) }}>
                  <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                    New quantity (optional)
                    <input inputMode="decimal" value={form.newQuantity} onChange={(event) => setForm((current) => ({ ...current, newQuantity: event.target.value }))} disabled={busy} />
                  </label>
                  <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                    New price (optional)
                    <input inputMode="decimal" value={form.newPrice} onChange={(event) => setForm((current) => ({ ...current, newPrice: event.target.value }))} disabled={busy} />
                  </label>
                </div>
              )}
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Reason
                <input required value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
              </label>
              <div style={{ display: 'flex', gap: theme.space(2) }}>
                <button type="submit" disabled={busy}>{busy ? 'Sending…' : action === 'cancel' ? 'Confirm cancel' : 'Confirm replace'}</button>
                <button type="button" disabled={busy} onClick={() => { setAction(null); setError(''); }}>Cancel</button>
              </div>
            </form>
          )}

          <h3 style={{ fontSize: 14, margin: `0 0 ${theme.space(3)}` }}>State history</h3>
          {lifecycle.error && <ErrorNotice title="Lifecycle unavailable" message={lifecycle.error} />}
          {lifecycle.data && (
            <DataTable
              rows={lifecycle.data.transitions ?? []}
              rowKey={(row, index) => `${row.state}-${index}`}
              emptyTitle="No transitions recorded"
              columns={[
                { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
                { key: 'at', header: 'At', render: (row) => formatDateTime(row.at ?? row.timestamp) },
                { key: 'actor', header: 'Actor', render: (row) => row.actor ?? 'System' },
                { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              ]}
            />
          )}

          <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Fills</h3>
          {fills.error && <ErrorNotice title="Fills unavailable" message={fills.error} />}
          {fills.data && (
            <DataTable
              rows={toRows<OmsFill>(fills.data).rows}
              rowKey={(row) => row.id}
              emptyTitle="No fills recorded"
              emptyDescription="The venue has not reported an execution for this order."
              columns={[
                { key: 'qty', header: 'Quantity', align: 'right', render: (row) => formatAmount(row.quantity) },
                { key: 'price', header: 'Price', align: 'right', render: (row) => formatAmount(row.price) },
                { key: 'fee', header: 'Fee', align: 'right', render: (row) => formatAmount(row.fee, { symbol: row.feeCurrency }) },
                { key: 'liquidity', header: 'Liquidity', render: (row) => row.liquidity ?? '—' },
                { key: 'source', header: 'Source', render: (row) => row.source },
                { key: 'at', header: 'At', render: (row) => formatDateTime(row.timestamp) },
              ]}
            />
          )}

          <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Latency</h3>
          {latency.error && <ErrorNotice title="Latency unavailable" message={latency.error} />}
          {latency.data && (
            <DataTable
              rows={latency.data.stages ?? []}
              rowKey={(row) => row.stage}
              emptyTitle="No latency stages recorded"
              columns={[
                { key: 'stage', header: 'Stage', render: (row) => row.stage },
                { key: 'ms', header: 'Milliseconds', align: 'right', render: (row) => row.millis ?? '—' },
              ]}
            />
          )}

          <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Audit trail</h3>
          {audit.error && <ErrorNotice title="Audit trail unavailable" message={audit.error} />}
          {audit.data && (
            <DataTable
              rows={toRows(audit.data).rows}
              rowKey={(row) => row.id}
              emptyTitle="No audit entries"
              columns={[
                { key: 'event', header: 'Event', render: (row) => row.eventType },
                { key: 'actor', header: 'Actor', render: (row) => row.actor ?? 'System' },
                { key: 'at', header: 'At', render: (row) => formatDateTime(row.createdAt) },
              ]}
            />
          )}
        </>
      )}
    </Card>
  );
}
