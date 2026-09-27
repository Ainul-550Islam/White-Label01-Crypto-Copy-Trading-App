'use client';
import { useState } from 'react';
import { fundingApi } from '@/api/funding-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
export function WithdrawalPage(): JSX.Element {
  const [asset, setAsset] = useState<string>('BTC');
  const [network, setNetwork] = useState<string>('bitcoin');
  const [amount, setAmount] = useState<string>('');
  const [dest, setDest] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const handleWithdraw = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fundingApi.createWithdrawalRequest({ asset, network, amount, destinationAddress: dest });
      setSuccess(`Withdrawal ${res.id} requested with state ${res.state}. Approval ≠ settlement.`);
      setConfirmOpen(false);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer title="Withdraw" description="Secure withdrawal workflow with backend validation">
      <div className="max-w-md space-y-3 rounded border bg-card p-4">
        <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="Asset" className="w-full rounded border px-3 py-2 text-sm" />
        <input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Network" className="w-full rounded border px-3 py-2 text-sm" />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className="w-full rounded border px-3 py-2 text-sm" />
        <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Destination address" className="w-full rounded border px-3 py-2 text-sm font-mono" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">{success}</p>}
        <button onClick={() => setConfirmOpen(true)} disabled={!amount || !dest} className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">Request Withdrawal</button>
        <p className="text-xs text-muted">Withdrawal requested does not mean completed. Settlement is backend-authoritative.</p>
      </div>
      <ConfirmationDialog open={confirmOpen} title="Confirm Withdrawal" description={`Withdraw ${amount} ${asset} on ${network} to ${dest}? This requires backend approval, compliance, and risk checks.`} variant="destructive" confirmLabel="Confirm Withdrawal" onConfirm={handleWithdraw} onCancel={() => setConfirmOpen(false)} isLoading={loading} />
    </PageContainer>
  );
}
