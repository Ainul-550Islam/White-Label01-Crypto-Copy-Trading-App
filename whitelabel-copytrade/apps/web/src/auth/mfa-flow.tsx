'use client';

import { useState } from 'react';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';

/**
 * MFA enrollment/challenge/recovery UI integrated with existing SecurityModule.
 */

interface MfaEnrollProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function MfaEnrollFlow({ onSuccess, onCancel }: MfaEnrollProps): JSX.Element {
  const [step, setStep] = useState<'init' | 'qr' | 'verify'>('init');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleEnroll = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authApi.mfaEnroll();
      setQrUrl(res.qrCodeUrl ?? '');
      setSecret(res.secret ?? '');
      setRecoveryCodes(res.recoveryCodes ?? []);
      setStep('qr');
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      await authApi.mfaVerifyEnroll(code);
      setStep('verify');
      onSuccess();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  if (step === 'init') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Enable Two-Factor Authentication</h3>
        <p className="text-sm text-muted">
          Add an extra layer of security to your account. You will need an authenticator app.
        </p>
        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={handleEnroll}
            disabled={loading}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Enrollment'}
          </button>
          <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === 'qr') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Scan QR Code</h3>
        {qrUrl && (
          <div className="flex justify-center">
            <img src={qrUrl} alt="MFA QR Code" className="h-48 w-48" />
          </div>
        )}
        {secret && (
          <div className="rounded bg-gray-50 p-3">
            <p className="text-xs text-muted">Manual entry secret:</p>
            <p className="font-mono text-sm">{secret}</p>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium">Enter code from authenticator app</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="w-full rounded border px-3 py-2 font-mono"
            maxLength={6}
          />
        </div>
        {recoveryCodes.length > 0 && (
          <div className="rounded bg-yellow-50 p-3">
            <p className="text-sm font-medium">Save your recovery codes securely:</p>
            <ul className="mt-2 font-mono text-xs">
              {recoveryCodes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify and Enable'}
          </button>
          <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">MFA Enabled</h3>
      <p className="text-sm text-muted">Two-factor authentication has been enabled successfully.</p>
      <button onClick={onSuccess} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
        Done
      </button>
    </div>
  );
}

interface MfaChallengeProps {
  mfaToken: string;
  onSuccess: (response: { user: { id: string; email: string; tenantId: string; roles: string[] } }) => void;
  onCancel: () => void;
}

export function MfaChallengeFlow({ mfaToken, onSuccess, onCancel }: MfaChallengeProps): JSX.Element {
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [method, setMethod] = useState<'TOTP' | 'RECOVERY'>('TOTP');

  const handleChallenge = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authApi.mfaChallenge({ mfaToken, code, method });
      onSuccess(res);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Two-Factor Authentication</h3>
      <p className="text-sm text-muted">
        Enter the code from your authenticator app{method === 'RECOVERY' ? ' or recovery code' : ''}.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setMethod('TOTP')}
          className={`rounded px-3 py-1 text-xs ${method === 'TOTP' ? 'bg-primary text-white' : 'border'}`}
        >
          Authenticator
        </button>
        <button
          onClick={() => setMethod('RECOVERY')}
          className={`rounded px-3 py-1 text-xs ${method === 'RECOVERY' ? 'bg-primary text-white' : 'border'}`}
        >
          Recovery
        </button>
      </div>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={method === 'TOTP' ? '123456' : 'Recovery code'}
        className="w-full rounded border px-3 py-2 font-mono"
      />
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={handleChallenge}
          disabled={loading || !code}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
        <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
