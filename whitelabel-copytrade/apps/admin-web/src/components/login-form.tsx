'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { theme } from '@/lib/theme';

interface LoginResponse {
  success: boolean;
  data?: { twoFactorRequired: boolean; redirectTo?: string; methods?: string[] };
  error?: { code: string; message: string; details?: Array<{ field: string; message: string }> };
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  background: theme.color.bg,
  color: theme.color.text,
  marginTop: 6,
} as const;

const labelStyle = { fontSize: 13, color: theme.color.textMuted, fontWeight: 600 } as const;

/**
 * Sign-in form.
 *
 * Credentials go to this app's own route handler, which performs the API call
 * server-side and sets httpOnly cookies. No token ever reaches this component.
 */
export function LoginForm(): JSX.Element {
  const router = useRouter();

  const [stage, setStage] = useState<'credentials' | 'two-factor'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function submitCredentials(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'same-origin',
      });

      const payload = (await response.json()) as LoginResponse;

      if (!response.ok || !payload.success) {
        setError(payload.error?.message ?? 'Sign-in failed. Please try again.');
        const map: Record<string, string> = {};
        for (const detail of payload.error?.details ?? []) {
          map[detail.field] = detail.message;
        }
        setFieldErrors(map);
        return;
      }

      if (payload.data?.twoFactorRequired) {
        setStage('two-factor');
        setPassword('');
        return;
      }

      router.replace(payload.data?.redirectTo ?? '/dashboard');
      router.refresh();
    } catch {
      setError('Unable to reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTwoFactor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/two-factor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, method: useRecoveryCode ? 'RECOVERY_CODE' : 'TOTP' }),
        credentials: 'same-origin',
      });

      const payload = (await response.json()) as LoginResponse;

      if (!response.ok || !payload.success) {
        setError(payload.error?.message ?? 'Verification failed.');
        return;
      }

      router.replace(payload.data?.redirectTo ?? '/dashboard');
      router.refresh();
    } catch {
      setError('Unable to reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const buttonStyle = {
    width: '100%',
    marginTop: theme.space(5),
    padding: '11px 16px',
    borderRadius: theme.radius.sm,
    border: 'none',
    background: theme.color.primary,
    color: theme.color.primaryContrast,
    fontWeight: 600,
    cursor: submitting ? 'not-allowed' : 'pointer',
    opacity: submitting ? 0.7 : 1,
  } as const;

  if (stage === 'two-factor') {
    return (
      <form onSubmit={submitTwoFactor} noValidate>
        <p style={{ color: theme.color.textMuted, fontSize: 14, marginTop: 0 }}>
          {useRecoveryCode
            ? 'Enter one of the recovery codes you saved when you enabled two-factor authentication.'
            : 'Enter the six-digit code from your authenticator app.'}
        </p>

        <label style={labelStyle} htmlFor="code">
          {useRecoveryCode ? 'Recovery code' : 'Authentication code'}
          <input
            id="code"
            name="code"
            style={inputStyle}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode={useRecoveryCode ? 'text' : 'numeric'}
            required
            minLength={6}
            maxLength={32}
          />
        </label>

        {error && (
          <p role="alert" style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.space(3) }}>
            {error}
          </p>
        )}

        <button type="submit" style={buttonStyle} disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify and continue'}
        </button>

        <button
          type="button"
          onClick={() => {
            setUseRecoveryCode((current) => !current);
            setCode('');
            setError(null);
          }}
          style={{
            width: '100%',
            marginTop: theme.space(3),
            background: 'transparent',
            border: 'none',
            color: theme.color.primary,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {useRecoveryCode ? 'Use my authenticator app instead' : 'Use a recovery code instead'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} noValidate>
      <label style={labelStyle} htmlFor="email">
        Work email
        <input
          id="email"
          name="email"
          type="email"
          style={inputStyle}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      {fieldErrors.email && (
        <p style={{ color: theme.color.danger, fontSize: 12, margin: '6px 0 0' }}>{fieldErrors.email}</p>
      )}

      <div style={{ marginTop: theme.space(4) }}>
        <label style={labelStyle} htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            type="password"
            style={inputStyle}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        {fieldErrors.password && (
          <p style={{ color: theme.color.danger, fontSize: 12, margin: '6px 0 0' }}>
            {fieldErrors.password}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.space(3) }}>
          {error}
        </p>
      )}

      <button type="submit" style={buttonStyle} disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
