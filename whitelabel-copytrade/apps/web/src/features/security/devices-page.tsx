'use client';

import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { securityApi, Device } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function DevicesPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'devices'], queryFn: () => securityApi.listDevices() });
  const [confirmDevice, setConfirmDevice] = useState<Device | null>(null);
  const [actionError, setActionError] = useState<string>('');
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">Devices</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const devices = data ?? [];
  const revoke = async (device: Device) => {
    setActionError('');
    try {
      await securityApi.revokeDevice(device);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.getUserMessage() : 'The device could not be signed out.');
    } finally {
      refetch();
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Devices</h3>
      <p className="text-xs text-muted">A device becomes trusted when you tick &quot;Trust this device&quot; while signing in with two-factor authentication.</p>
      {actionError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
      <ul className="mt-3 space-y-2">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
            <div><p>{d.name ?? d.fingerprint.slice(0,12)}{d.platform && d.name !== d.platform ? ` (${d.platform})` : ''} {d.isCurrent && <StatusBadge status="CURRENT" variant="info" />}</p><p className="text-muted">Last seen {new Date(d.lastSeenAt).toLocaleString()} - {d.sessionIds.length} session{d.sessionIds.length === 1 ? '' : 's'}</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={d.trusted ? 'TRUSTED' : 'UNTRUSTED'} variant={d.trusted ? 'success' : 'warning'} />{!d.isCurrent && <button onClick={() => setConfirmDevice(d)} className="rounded border px-2 py-1">Revoke</button>}</div>
          </li>
        ))}
        {devices.length===0 && <p className="text-xs text-muted">No devices</p>}
      </ul>
      <ConfirmationDialog open={!!confirmDevice} title="Sign Out Device" description="Sign this device out? Every session on it will end." variant="destructive" confirmLabel="Sign out" onConfirm={async () => { if (confirmDevice) { const device = confirmDevice; setConfirmDevice(null); await revoke(device); } }} onCancel={() => setConfirmDevice(null)} />
    </div>
  );
}
