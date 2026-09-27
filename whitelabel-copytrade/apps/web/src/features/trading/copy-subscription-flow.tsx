'use client';
import { useState } from 'react';
import { tradingApi } from '@/api/trading-api';
import { ApiError } from '@/api/api-errors';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
export function CopySubscriptionFlow({ strategyId }: { strategyId: string }): JSX.Element {
  const [amount, setAmount] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await tradingApi.createCopySubscription({ strategyId, allocationAmount: amount, sizingMode: 'FIXED' });
      setSuccess(`Subscription ${res.id} created with status ${res.status}`);
      setConfirmOpen(false);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Copy This Strategy</h3>
      <p className="text-xs text-muted">Backend validates risk, compliance, and eligibility. No trusted values submitted from frontend.</p>
      <div className="mt-3 flex gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Allocation amount" className="rounded border px-3 py-2 text-sm" />
        <button onClick={() => setConfirmOpen(true)} disabled={!amount} className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">Copy</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {success && <p className="mt-2 text-xs text-green-600">{success}</p>}
      <ConfirmationDialog open={confirmOpen} title="Confirm Copy Subscription" description={`Allocate ${amount} to strategy ${strategyId}? Backend will validate eligibility, risk, and compliance.`} confirmLabel="Confirm Copy" onConfirm={handleSubmit} onCancel={() => setConfirmOpen(false)} isLoading={loading} />
    </div>
  );
}
