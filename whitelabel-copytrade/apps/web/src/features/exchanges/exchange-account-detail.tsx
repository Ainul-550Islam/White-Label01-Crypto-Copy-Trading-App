'use client';
import { useQuery } from '@tanstack/react-query';
import { exchangeApi } from '@/api/exchange-api';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function ExchangeAccountDetail({ id }: { id: string }): JSX.Element {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['exchange', 'account', id],
    queryFn: () => exchangeApi.getAccount(id),
  });
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  if (isLoading) return <LoadingState />;
  if (!data) return <div className="p-4 text-sm">Account not found</div>;
  return (
    <div className="space-y-4 rounded border bg-card p-4">
      <div className="flex justify-between"><h3 className="font-semibold">{data.exchange} - {data.label ?? data.id}</h3><StatusBadge status={data.health} /></div>
      <p className="text-xs text-muted">Status: {data.status} | Trading: {data.tradingEnabled ? 'Enabled' : 'Disabled'}</p>
      <p className="text-xs">Capabilities: {data.capabilities.join(', ')}</p>
      <p className="text-xs">Permissions: {data.permissions.join(', ')}</p>
      {data.lastConnectedAt && <p className="text-xs text-muted">Last connected: {new Date(data.lastConnectedAt).toLocaleString()}</p>}
      {data.errorMessage && <p className="text-xs text-red-600">{data.errorMessage}</p>}
      <div className="flex gap-2">
        <button onClick={() => exchangeApi.verifyAccount(id).then(() => refetch())} className="rounded border px-3 py-1 text-xs">Verify</button>
        <button onClick={() => setConfirmOpen(true)} className="rounded bg-red-600 px-3 py-1 text-xs text-white">Disconnect</button>
      </div>
      <ConfirmationDialog open={confirmOpen} title="Disconnect Exchange" description="Are you sure you want to disconnect this exchange account? This will stop trading." variant="destructive" confirmLabel="Disconnect" onConfirm={async () => { await exchangeApi.disconnectAccount(id); setConfirmOpen(false); window.location.href='/exchanges'; }} onCancel={() => setConfirmOpen(false)} />
    </div>
  );
}
