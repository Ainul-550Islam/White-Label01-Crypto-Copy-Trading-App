'use client';

import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function SessionsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'sessions'], queryFn: () => securityApi.listSessions() });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>('');
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">Sessions</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const sessions = data ?? [];
  const run = async (action: () => Promise<unknown>) => {
    setActionError('');
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.getUserMessage() : 'The session could not be revoked.');
    } finally {
      refetch();
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <div className="flex justify-between"><h3 className="font-semibold">Sessions</h3>{sessions.some((s) => !s.isCurrent) && <button onClick={() => run(() => securityApi.revokeAllOtherSessions())} className="text-xs text-primary">Revoke Others</button>}</div>
      {actionError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
      <ul className="mt-3 space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border p-2 text-xs">
            <div><p>{s.device ?? 'Unknown device'}{s.platform && s.device !== s.platform ? ` (${s.platform})` : ''} {s.isCurrent && <StatusBadge status="CURRENT" variant="info" />}</p><p className="text-muted">{s.location ? `${s.location} - ` : ''}Last active {new Date(s.lastActiveAt).toLocaleString()}</p></div>
            {!s.isCurrent && <button onClick={() => setConfirmId(s.id)} className="rounded border px-2 py-1">Revoke</button>}
          </li>
        ))}
        {sessions.length===0 && <p className="text-xs text-muted">No active sessions</p>}
      </ul>
      <ConfirmationDialog open={!!confirmId} title="Revoke Session" description="Revoke this session? User will be logged out from that device." variant="destructive" confirmLabel="Revoke" onConfirm={async () => { if (confirmId) { const id = confirmId; setConfirmId(null); await run(() => securityApi.revokeSession(id)); } }} onCancel={() => setConfirmId(null)} />
    </div>
  );
}
