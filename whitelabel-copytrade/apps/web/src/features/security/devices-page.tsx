'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
export function DevicesPage(): JSX.Element {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['security', 'devices'], queryFn: () => securityApi.listDevices() });
  if (isLoading) return <LoadingState />;
  const devices = data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Devices</h3>
      <ul className="mt-3 space-y-2">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
            <div><p>{d.name ?? d.fingerprint.slice(0,12)}</p><p className="text-muted">Last seen {new Date(d.lastSeenAt).toLocaleString()}</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={d.trusted ? 'TRUSTED' : 'UNTRUSTED'} variant={d.trusted ? 'success' : 'warning'} />{!d.trusted ? <button onClick={() => securityApi.trustDevice(d.id).then(() => refetch())} className="rounded border px-2 py-1">Trust</button> : <button onClick={() => securityApi.revokeDevice(d.id).then(() => refetch())} className="rounded border px-2 py-1">Revoke</button>}</div>
          </li>
        ))}
        {devices.length===0 && <p className="text-xs text-muted">No devices</p>}
      </ul>
    </div>
  );
}
