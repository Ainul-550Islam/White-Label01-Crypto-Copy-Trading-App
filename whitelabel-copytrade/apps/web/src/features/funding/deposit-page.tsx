'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fundingApi } from '@/api/funding-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function DepositPage(): JSX.Element {
  const [asset, setAsset] = useState<string>('BTC');
  const [network, setNetwork] = useState<string>('bitcoin');
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const { data: addresses, isLoading } = useQuery({
    queryKey: ['funding', 'deposit-addresses', asset, network],
    queryFn: () => fundingApi.getDepositAddresses({ asset, network }),
  });
  const handleGetAddress = async () => {
    setLoading(true);
    try {
      const res = await fundingApi.getOrCreateDepositAddress({ assetId: `${asset}-${network}`, networkId: network });
      setAddress(res.address);
    } catch {
      // error handled via UI
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer title="Deposit" description="Deposit instructions using Custody/Funding APIs">
      <div className="max-w-md space-y-4 rounded border bg-card p-4">
        <div className="flex gap-2">
          <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="Asset" className="rounded border px-2 py-1 text-sm" />
          <input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Network" className="rounded border px-2 py-1 text-sm" />
        </div>
        <button onClick={handleGetAddress} disabled={loading} className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Generating...' : 'Get Deposit Address'}</button>
        {address && <div className="rounded bg-gray-50 p-2 font-mono text-sm break-all">{address}</div>}
        <p className="text-xs text-muted">Address generation is not proof of funds. Deposit status is backend-authoritative.</p>
        <div>
          <h4 className="text-sm font-medium">Existing Addresses</h4>
          {isLoading ? <LoadingState /> : <ul className="mt-2 space-y-1 text-xs">{(addresses ?? []).map((a,i) => <li key={i} className="flex justify-between"><span className="font-mono">{a.address.slice(0,20)}...</span><StatusBadge status={a.isActive ? 'ACTIVE' : 'INACTIVE'} /></li>)}</ul>}
        </div>
      </div>
    </PageContainer>
  );
}
