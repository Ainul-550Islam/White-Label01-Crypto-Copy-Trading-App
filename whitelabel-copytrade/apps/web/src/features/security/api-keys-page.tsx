'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { useState } from 'react';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
export function ApiKeysPage(): JSX.Element {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['security', 'api-keys'], queryFn: () => securityApi.listApiKeys() });
  const [name, setName] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (isLoading) return <LoadingState />;
  const keys = data ?? [];
  const handleCreate = async () => {
    const res = await securityApi.createApiKey({ name, scopes: ['read'] });
    setSecret(res.secret);
    setName('');
    refetch();
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">API Keys</h3>
      <p className="text-xs text-muted">Secrets shown only once when backend allows. Never persisted client-side.</p>
      <div className="mt-3 flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" className="rounded border px-2 py-1 text-xs" /><button onClick={handleCreate} disabled={!name} className="rounded bg-primary px-3 py-1 text-xs text-white disabled:opacity-50">Create</button></div>
      {secret && <div className="mt-2 rounded bg-yellow-50 p-2 font-mono text-xs break-all">Secret (copy now, will not be shown again): {secret}</div>}
      <ul className="mt-3 space-y-1">
        {keys.map((k) => (
          <li key={k.id} className="flex justify-between rounded border p-2 text-xs"><span>{k.name} {k.prefix}...</span><div className="flex gap-2"><span className="text-muted">{new Date(k.createdAt).toLocaleDateString()}</span><button onClick={() => setConfirmId(k.id)} className="text-red-600">Revoke</button></div></li>
        ))}
      </ul>
      <ConfirmationDialog open={!!confirmId} title="Revoke API Key" description="Revoke this API key? This action cannot be undone." variant="destructive" confirmLabel="Revoke" onConfirm={async () => { if (confirmId) { await securityApi.revokeApiKey(confirmId); setConfirmId(null); refetch(); } }} onCancel={() => setConfirmId(null)} />
    </div>
  );
}
