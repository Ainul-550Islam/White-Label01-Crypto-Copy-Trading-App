'use client';
import { useQuery } from '@tanstack/react-query';
import { exchangeApi } from '@/api/exchange-api';
import { ApiError } from '@/api/api-errors';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { ExchangeCapabilities } from './exchange-capabilities';
import { useState } from 'react';
export function ExchangeAccountDetail({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exchange', 'account', id],
    queryFn: () => exchangeApi.getAccount(id),
  });
  const connectivity = useQuery({
    queryKey: ['exchange', 'account', id, 'connectivity'],
    queryFn: () => exchangeApi.getAccountHealth(id),
    enabled: !!data,
  });
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [disableOpen, setDisableOpen] = useState<boolean>(false);
  const [notice, setNotice] = useState<string>('');
  if (isLoading) return <LoadingState />;
  if (error && !(error instanceof ApiError && error.isNotFound())) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <div className="p-4 text-sm">Account not found</div>;
  const act = async (action: () => Promise<unknown>, done?: string) => {
    setNotice('');
    try {
      await action();
      if (done) setNotice(done);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.getUserMessage() : 'The action failed.');
    } finally {
      refetch();
      connectivity.refetch();
    }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded border bg-card p-4">
        <div className="flex justify-between"><h3 className="font-semibold">{data.exchange} - {data.label ?? data.id}</h3><StatusBadge status={data.health} /></div>
        <p className="text-xs text-muted">Status: {data.status} | Environment: {data.environment} | Key: {data.maskedApiKey ?? '-'} | Trading: {data.tradingEnabled ? 'Enabled' : 'Disabled'}</p>
        <p className="text-xs">Capabilities: {data.capabilities.length > 0 ? data.capabilities.join(', ') : 'Not discovered yet'}</p>
        {data.lastConnectedAt && <p className="text-xs text-muted">Last connected: {new Date(data.lastConnectedAt).toLocaleString()}</p>}
        {data.errorMessage && <p className="text-xs text-red-600">{data.errorMessage}</p>}
        {connectivity.data && (
          <div className="rounded border p-2 text-xs">
            <p>Connectivity: <StatusBadge status={connectivity.data.health} /></p>
            {connectivity.data.issues.map((issue) => <p key={issue} className="text-muted">{issue}</p>)}
          </div>
        )}
        {notice && <p className="text-xs text-muted">{notice}</p>}
        <div className="flex gap-2">
          <button onClick={() => act(async () => { const res = await exchangeApi.verifyAccount(id); setNotice(res.message ?? 'Verification queued.'); })} className="rounded border px-3 py-1 text-xs">Verify</button>
          {data.status !== 'DISABLED' && <button onClick={() => setDisableOpen(true)} className="rounded border px-3 py-1 text-xs">Disable</button>}
          <button onClick={() => setConfirmOpen(true)} className="rounded bg-red-600 px-3 py-1 text-xs text-white">Disconnect</button>
        </div>
        <ConfirmationDialog open={disableOpen} title="Disable Exchange Account" description="Pause this exchange account? Copy trading on it stops until it is enabled again." variant="destructive" confirmLabel="Disable" onConfirm={async () => { setDisableOpen(false); await act(() => exchangeApi.disableAccount(id, 'Disabled by the account owner'), 'Account disabled.'); }} onCancel={() => setDisableOpen(false)} />
        <ConfirmationDialog open={confirmOpen} title="Disconnect Exchange" description="Are you sure you want to disconnect this exchange account? This will stop trading." variant="destructive" confirmLabel="Disconnect" onConfirm={async () => { setConfirmOpen(false); try { await exchangeApi.disconnectAccount(id); window.location.href='/exchanges'; } catch (err) { setNotice(err instanceof ApiError ? err.getUserMessage() : 'Disconnect failed.'); } }} onCancel={() => setConfirmOpen(false)} />
      </div>

      <ExchangeCapabilities
        venue={data.exchange}
        discoveredCapabilities={data.capabilities}
        tradingEnabled={data.tradingEnabled}
        environment={data.environment}
      />
    </div>
  );
}
