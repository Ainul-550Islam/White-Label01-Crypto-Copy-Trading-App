'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function SessionsPage(): JSX.Element {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['security', 'sessions'], queryFn: () => securityApi.listSessions() });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (isLoading) return <LoadingState />;
  const sessions = data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <div className="flex justify-between"><h3 className="font-semibold">Sessions</h3><button onClick={() => securityApi.revokeAllOtherSessions().then(() => refetch())} className="text-xs text-primary">Revoke Others</button></div>
      <ul className="mt-3 space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border p-2 text-xs">
            <div><p>{s.device ?? 'Unknown device'} {s.isCurrent && <StatusBadge status="CURRENT" variant="info" />}</p><p className="text-muted">{s.ip} - {new Date(s.lastActiveAt).toLocaleString()}</p></div>
            {!s.isCurrent && <button onClick={() => setConfirmId(s.id)} className="rounded border px-2 py-1">Revoke</button>}
          </li>
        ))}
        {sessions.length===0 && <p className="text-xs text-muted">No active sessions</p>}
      </ul>
      <ConfirmationDialog open={!!confirmId} title="Revoke Session" description="Revoke this session? User will be logged out from that device." variant="destructive" confirmLabel="Revoke" onConfirm={async () => { if (confirmId) { await securityApi.revokeSession(confirmId); setConfirmId(null); refetch(); } }} onCancel={() => setConfirmId(null)} />
    </div>
  );
}
