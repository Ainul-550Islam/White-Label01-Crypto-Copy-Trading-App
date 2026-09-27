'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';
import { MfaChallengeFlow } from '@/auth/mfa-flow';
import { useAuth } from '@/auth/auth.store';
import { useTenant } from '@/tenant/tenant-context';
import { TenantLogo } from '@/tenant/tenant-branding';

export default function LoginPage(): JSX.Element {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [mfaToken, setMfaToken] = useState<string>('');
  const [mfaRequired, setMfaRequired] = useState<boolean>(false);
  const router = useRouter();
  const { refreshSession } = useAuth();
  const { tenant } = useTenant();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login({ email, password });
      if (res.requiresMfa && res.mfaToken) {
        setMfaToken(res.mfaToken);
        setMfaRequired(true);
      } else {
        await refreshSession();
        router.push('/dashboard');
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSuccess = async () => {
    await refreshSession();
    router.push('/dashboard');
  };

  if (mfaRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6">
          <MfaChallengeFlow mfaToken={mfaToken} onSuccess={handleMfaSuccess} onCancel={() => setMfaRequired(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow">
        <div className="mb-6 text-center">
          <TenantLogo className="mx-auto h-12 w-12 rounded" />
          <h1 className="mt-3 text-xl font-bold">{tenant?.branding?.appName ?? tenant?.name ?? 'Sign In'}</h1>
          <p className="text-xs text-muted">Backend-authoritative authentication</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-sm font-medium">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="••••••••" />
          </div>
          {error && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
          <button type="submit" disabled={loading} className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
      </div>
    </div>
  );
}
