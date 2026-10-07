// # Responsibility: sends user-supplied allocation values to a non-executable preview API; never submits orders or transfers.

import React, { FormEvent, useEffect, useState } from 'react';
import { tradingApi, type RebalancePreviewLine, type RebalancePreviewRequest } from '@/api/trading-api';

export type RebalancePreviewRow = RebalancePreviewLine;
export type RebalanceAllocationInput = RebalancePreviewRequest['allocations'][number];

export function AllocationRebalancePage({
  initialTotalValue,
  initialAllocations,
  onPreview,
}: {
  initialTotalValue: string;
  initialAllocations: RebalanceAllocationInput[];
  onPreview?: (input: RebalancePreviewRequest) => Promise<RebalancePreviewRow[]>;
}): JSX.Element {
  const [totalValue, setTotalValue] = useState(initialTotalValue);
  const [allocations, setAllocations] = useState(initialAllocations);
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<RebalancePreviewRow[]>([]);
  const preview = onPreview ?? tradingApi.previewAllocationRebalance;

  useEffect(() => {
    setTotalValue(initialTotalValue);
    setAllocations(initialAllocations);
  }, [initialTotalValue, initialAllocations]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    try {
      const next = await preview({ totalValue, allocations: allocations.map((allocation) => ({ ...allocation })) });
      setRows(next);
      setMessage('Preview refreshed. No orders or transfers were submitted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preview unavailable.');
    }
  };

  return (
    <section className="space-y-4" data-testid="allocation-rebalance-page">
      <header><h2 className="text-lg font-semibold">Allocation rebalance planner</h2><p className="text-sm text-muted">Preview only. Values and price-availability flags are user supplied and are not checked against exchange balances or positions. This page never creates an order or transfers funds.</p></header>
      <form onSubmit={submit} className="grid gap-4 rounded border p-4">
        <label className="grid max-w-sm gap-1 text-sm">Preview portfolio value (unverified)<input aria-label="Preview portfolio value (unverified)" inputMode="decimal" value={totalValue} onChange={(event) => setTotalValue(event.target.value)} className="rounded border px-3 py-2" /></label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Target allocation (basis points)</legend>
          {allocations.length === 0 && <p role="alert" className="text-sm">No allocation rows were supplied. A preview requires at least one allocation.</p>}
          {allocations.map((allocation, index) => (
            <div key={allocation.traderId} className="grid grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_8rem] items-center gap-3 rounded border p-3 text-sm">
              <span>{allocation.traderId}</span>
              <span>Provided current value: {allocation.currentValue}{allocation.priceAvailable ? '' : ' (valuation unavailable)'}</span>
              <label className="grid gap-1">Weight bps<input
                aria-label={`${allocation.traderId} target weight in basis points`}
                type="number"
                min="0"
                max="10000"
                step="1"
                value={allocation.targetWeightBps}
                onChange={(event) => {
                  const nextWeight = event.target.value === '' ? 0 : Number(event.target.value);
                  setAllocations((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, targetWeightBps: nextWeight } : item
                  )));
                }}
                className="rounded border px-2 py-1"
              /></label>
            </div>
          ))}
        </fieldset>
        <button type="submit" disabled={allocations.length === 0} className="w-fit rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">Preview rebalance</button>
      </form>
      {message && <p role="status" className="text-sm">{message}</p>}
      <ul className="space-y-2">{rows.map((row) => <li key={row.traderId} className="rounded border p-3 text-sm">
        <strong>{row.traderId}</strong>: {row.status === 'PREVIEW' ? `current ${row.currentValue}, target ${row.targetValue}, delta ${row.deltaValue}` : 'valuation unavailable; no target estimated'}
      </li>)}</ul>
    </section>
  );
}
