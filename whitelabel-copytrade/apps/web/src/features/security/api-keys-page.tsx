'use client';

import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@wlct/shared-types';
import { securityApi } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/auth/auth.store';
import { permissionsAllowAny } from '@/auth/permissions';
import { useState } from 'react';
import { ConfirmationDialog } from '@/components/confirmation-dialog';

/**
 * API keys are an organisation feature on the backend (/v1/security/api-keys,
 * api_key:read to list, api_key:write to create or revoke). A key's scopes
 * must be permission keys its creator holds, so the choices offered here are
 * the read permissions of the signed-in user.
 */
const READ_SCOPES: readonly string[] = (Object.values(Permission) as string[]).filter((p) => p.endsWith(':read'));

export function ApiKeysPage(): JSX.Element {
  const { session } = useAuth();
  const granted = session?.user.permissions ?? [];
  const canRead = permissionsAllowAny(granted, [Permission.API_KEY_READ, Permission.API_KEY_MANAGE]);
  const canWrite = permissionsAllowAny(granted, [Permission.API_KEY_WRITE, Permission.API_KEY_MANAGE]);
  const scopeChoices = READ_SCOPES.filter((scope) => permissionsAllowAny(granted, [scope]));
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'api-keys'], queryFn: () => securityApi.listApiKeys(), enabled: canRead });
  const [name, setName] = useState<string>('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!canRead) {
    return (
      <div className="rounded border bg-card p-4">
        <h3 className="font-semibold">API Keys</h3>
        <p className="mt-2 text-xs text-muted">API keys are managed by your organisation&apos;s administrators.</p>
      </div>
    );
  }
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">API Keys</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const keys = data ?? [];
  const toggleScope = (scope: string) => setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  const handleCreate = async () => {
    setActionError('');
    try {
      const res = await securityApi.createApiKey({ name, scopes });
      setSecret(res.secret);
      setName('');
      setScopes([]);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.getUserMessage() : 'The API key could not be created.');
    } finally {
      refetch();
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">API Keys</h3>
      <p className="text-xs text-muted">Secrets shown only once when backend allows. Never persisted client-side.</p>
      {canWrite && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" maxLength={120} className="rounded border px-2 py-1 text-xs" /><button onClick={handleCreate} disabled={!name || scopes.length === 0} className="rounded bg-primary px-3 py-1 text-xs text-white disabled:opacity-50">Create</button></div>
          <details className="text-xs"><summary className="cursor-pointer text-muted">Scopes ({scopes.length} selected)</summary><div className="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">{scopeChoices.map((scope) => (<label key={scope} className="flex items-center gap-1"><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /><span className="font-mono">{scope}</span></label>))}</div></details>
        </div>
      )}
      {actionError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
      {secret && <div className="mt-2 rounded bg-yellow-50 p-2 font-mono text-xs break-all">Secret (copy now, will not be shown again): {secret}</div>}
      <ul className="mt-3 space-y-1">
        {keys.map((k) => (
          <li key={k.id} className="flex justify-between rounded border p-2 text-xs"><span>{k.name} <span className="font-mono">{k.prefix}...</span> <span className="text-muted">{k.scopes.join(', ')}</span></span><div className="flex items-center gap-2"><StatusBadge status={k.state} variant={k.state === 'ACTIVE' ? 'success' : 'warning'} /><span className="text-muted">{new Date(k.createdAt).toLocaleDateString()}</span>{canWrite && k.state === 'ACTIVE' && <button onClick={() => setConfirmId(k.id)} className="text-red-600">Revoke</button>}</div></li>
        ))}
        {keys.length === 0 && <p className="text-xs text-muted">No API keys</p>}
      </ul>
      <ConfirmationDialog open={!!confirmId} title="Revoke API Key" description="Revoke this API key? This action cannot be undone." variant="destructive" confirmLabel="Revoke" onConfirm={async () => { if (confirmId) { const id = confirmId; setConfirmId(null); setActionError(''); try { await securityApi.revokeApiKey(id, 'Revoked from the security settings page'); } catch (err) { setActionError(err instanceof ApiError ? err.getUserMessage() : 'The API key could not be revoked.'); } finally { refetch(); } } }} onCancel={() => setConfirmId(null)} />
    </div>
  );
}
