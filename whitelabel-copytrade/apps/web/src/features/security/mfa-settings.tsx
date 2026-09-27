'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { MfaEnrollFlow } from '@/auth/mfa-flow';
import { useState } from 'react';
export function MfaSettings(): JSX.Element {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['security', 'mfa'], queryFn: () => securityApi.getMfaStatus() });
  const [enrollOpen, setEnrollOpen] = useState<boolean>(false);
  if (isLoading) return <LoadingState />;
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">MFA</h3>
      <div className="mt-2 flex items-center gap-2"><span className="text-sm">Status:</span><StatusBadge status={data?.enabled ? 'ENABLED' : 'DISABLED'} variant={data?.enabled ? 'success' : 'warning'} /></div>
      {data?.method && <p className="text-xs text-muted">Method: {data.method}</p>}
      {!data?.enabled ? <button onClick={() => setEnrollOpen(true)} className="mt-3 rounded bg-primary px-3 py-1 text-xs text-white">Enable MFA</button> : <p className="mt-2 text-xs text-muted">MFA is enabled. Last used: {data.lastUsedAt ? new Date(data.lastUsedAt).toLocaleString() : 'Never'}</p>}
      {enrollOpen && <div className="mt-4"><MfaEnrollFlow onSuccess={() => { setEnrollOpen(false); refetch(); }} onCancel={() => setEnrollOpen(false)} /></div>}
    </div>
  );
}
