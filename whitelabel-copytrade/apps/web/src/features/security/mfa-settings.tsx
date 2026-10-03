'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { MfaEnrollFlow } from '@/auth/mfa-flow';
import { useAuth } from '@/auth/auth.store';
import { useState } from 'react';
export function MfaSettings(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'mfa'], queryFn: () => securityApi.getMfaStatus() });
  const { refreshSession } = useAuth();
  const [enrollOpen, setEnrollOpen] = useState<boolean>(false);
  const [disableOpen, setDisableOpen] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [useRecovery, setUseRecovery] = useState<boolean>(false);
  const [disableError, setDisableError] = useState<string>('');
  const [disabling, setDisabling] = useState<boolean>(false);
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">MFA</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const handleDisable = async () => {
    setDisabling(true);
    setDisableError('');
    try {
      await securityApi.disableMfa(useRecovery ? { password, recoveryCode: code.trim().toUpperCase() } : { password, code: code.replace(/\s+/g, '') });
      setPassword('');
      setCode('');
      setDisableOpen(false);
      await refetch();
      await refreshSession();
    } catch (err) {
      setDisableError(err instanceof ApiError ? err.getUserMessage() : 'Could not disable MFA.');
    } finally {
      setDisabling(false);
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">MFA</h3>
      <div className="mt-2 flex items-center gap-2"><span className="text-sm">Status:</span><StatusBadge status={data?.enabled ? 'ENABLED' : 'DISABLED'} variant={data?.enabled ? 'success' : 'warning'} /></div>
      {data?.method && <p className="text-xs text-muted">Method: {data.method}</p>}
      {!data?.enabled ? <button onClick={() => setEnrollOpen(true)} className="mt-3 rounded bg-primary px-3 py-1 text-xs text-white">Enable MFA</button> : <div className="mt-2 space-y-2"><p className="text-xs text-muted">MFA is enabled. Last used: {data.lastUsedAt ? new Date(data.lastUsedAt).toLocaleString() : 'Never'}</p>{!disableOpen && <button onClick={() => setDisableOpen(true)} className="rounded border px-3 py-1 text-xs">Disable MFA</button>}</div>}
      {enrollOpen && <div className="mt-4"><MfaEnrollFlow onSuccess={() => { setEnrollOpen(false); refetch(); refreshSession(); }} onCancel={() => setEnrollOpen(false)} /></div>}
      {disableOpen && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted">Confirm with your password and a current {useRecovery ? 'recovery code' : 'authenticator code'}.</p>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" className="w-full rounded border px-2 py-1 text-xs" />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '123456'} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" className="w-full rounded border px-2 py-1 font-mono text-xs" />
          <button onClick={() => { setUseRecovery(!useRecovery); setCode(''); }} className="text-xs text-primary">{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>
          {disableError && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{disableError}</div>}
          <div className="flex gap-2">
            <button onClick={handleDisable} disabled={disabling || !password || !code} className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50">{disabling ? 'Disabling...' : 'Disable'}</button>
            <button onClick={() => { setDisableOpen(false); setDisableError(''); }} className="rounded border px-3 py-1 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
