'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [mfaRequired, setMfaRequired] = useState<boolean>(false);
  const [ssoLoading, setSsoLoading] = useState<boolean>(false);
  const router = useRouter();
  const { refreshSession } = useAuth();
  const { tenant } = useTenant();

  // Return from /api/auth/sso/callback: ?sso=mfa (challenge cookies already set) or ?sso=failed.
  // Return from SAML Single Logout: ?sso=logout_unconfirmed when the identity provider did not
  // confirm the sign-out (this app's session was already ended before the IdP was involved).
  useEffect(() => {
    const sso = new URLSearchParams(window.location.search).get('sso');
    if (sso === 'mfa') {
      setMfaMethods(['TOTP', 'RECOVERY_CODE']);
      setMfaRequired(true);
    } else if (sso === 'failed') {
      setError('Single sign-on could not be completed. Please try again or contact your administrator.');
    } else if (sso === 'logout_unconfirmed') {
      setError(
        'You are signed out of this app, but your identity provider did not confirm the sign-out. Close your browser to end that session too.',
      );
    }
  }, []);

  const handleSso = async () => {
    setSsoLoading(true);
    setError('');
    try {
      // No providerType: the API starts this tenant's enabled provider (OIDC or SAML).
      const res = await authApi.ssoStart({});
      window.location.assign(res.authorizationUrl);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
      setSsoLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login({ email, password });
      if (res.requiresMfa) {
        setMfaMethods(res.methods ?? []);
        setMfaRequired(true);
      } else {
        await refreshSession();
        router.push('/dashboard');
      }
    } catch (err) {
      const apiErr = err as ApiError;
      // The tenant enforces single sign-on for this account: point at the SSO
      // button instead of suggesting the password was wrong.
      setError(
        apiErr.backendCode === 'SSO_REQUIRED'
          ? 'Your organisation requires single sign-on. Use "Sign in with single sign-on" below.'
          : apiErr.getUserMessage(),
      );
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
          <MfaChallengeFlow methods={mfaMethods} onSuccess={handleMfaSuccess} onCancel={() => setMfaRequired(false)} />
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
        <div className="mt-4">
          <button type="button" onClick={handleSso} disabled={ssoLoading || loading} className="w-full rounded border px-4 py-2 text-sm font-medium disabled:opacity-50">{ssoLoading ? 'Redirecting...' : 'Sign in with single sign-on'}</button>
        </div>
        <div className="mt-6 border-t pt-4 text-center text-xs text-muted">
          <p>
            New to {tenant?.branding?.appName ?? tenant?.name ?? 'the platform'}?{' '}
            <Link href="/register" className="font-medium text-primary underline">
              Create an account
            </Link>
          </p>
          <div className="mt-3 flex justify-center gap-4">
            <Link href="/" className="hover:underline">Home</Link>
            <Link href="/pricing" className="hover:underline">Pricing</Link>
            <Link href="/status" className="hover:underline">Status</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
