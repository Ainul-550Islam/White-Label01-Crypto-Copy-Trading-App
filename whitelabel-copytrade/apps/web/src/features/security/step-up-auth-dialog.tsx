// # Responsibility: the one dialog every sensitive action shares — asks for a TOTP code, password or recovery code for the named action, then hands back a single-use proof.
//
// HOW IT IS USED
// --------------
// A sensitive request fails with 403 STEP_UP_REQUIRED and an `action`. The caller
// opens this dialog with that action, and the dialog obtains a proof; the caller
// then retries its request, which consumes the proof. The dialog never retries on
// its own: the caller knows what to re-send, and an automatic retry would spend the
// proof on a request the customer may no longer want.
//
// WHAT IT REFUSES TO DO
// ---------------------
//   * It does not cache a proof or keep one "warm". Proofs are single-use and
//     action-bound; a dialog that pre-fetched one would hold a live grant on a
//     screen nobody is looking at.
//   * It does not close on a failed verification. The attempt counter and the
//     error stay visible, because a customer who has mistyped a code needs to see
//     that it was the code that failed, not their account.
//   * It does not invent an expiry. The countdown uses the `expiresAt` the API
//     returned, so a proof that has lapsed is replaced rather than reused.
//
// WHY THERE ARE TWO COMPONENTS IN THIS FILE
// -----------------------------------------
// Everything the form holds — the half-typed code, the attempt count, the proof —
// belongs to one opening of the dialog and must be gone the next time it opens, or a
// customer would find a previous proof (or a previous person's typed password) still
// on screen. The obvious implementation is an effect that clears the fields when
// `open` flips to false, and that is exactly what React now rejects: a synchronous
// `setState` in an effect body cascades a second render and is flagged by
// `react-hooks/set-state-in-effect`. Unmounting is the honest version of "clear
// everything": the outer component renders nothing while closed, so the inner form
// is destroyed with its state and rebuilt empty on the next open. The countdown
// follows the same rule — it is derived from a clock that only moves inside the
// interval callback, never during render.
'use client';
import type { JSX } from 'react';

import { useEffect, useMemo, useState } from 'react';

import { stepUpApi, type StepUpMethod, type StepUpProof } from '@/api/security-api';

/** Human wording for the actions the platform binds a proof to. */
const ACTION_LABEL: Record<string, string> = {
  EXCHANGE_KEY_ROTATE: 'replacing an exchange key',
  EXCHANGE_KEY_REVOKE: 'revoking an exchange key',
  EXCHANGE_ACCOUNT_DISABLE: 'disabling an exchange account',
  TWO_FACTOR_DISABLE: 'turning off two-factor authentication',
  RECOVERY_CODES_REGENERATE: 'regenerating recovery codes',
  API_KEY_CREATE: 'creating an API key',
  API_KEY_REVOKE: 'revoking an API key',
  PAYOUT_CREATE: 'adding a withdrawal address or requesting a payout',
  PAYOUT_APPROVE: 'approving a payout',
  CUSTODY_ADDRESS_ISSUE: 'issuing a deposit address',
  CUSTODY_SWEEP: 'sweeping funds',
};

export interface StepUpAuthDialogProps {
  open: boolean;
  /** The action the API demanded. Unknown actions still work; they just read as raw codes. */
  action: string;
  /** Called with the proof after a successful verification. */
  onVerified: (proof: StepUpProof) => void;
  onCancel: () => void;
  /** Prefer password for customers without an authenticator. */
  defaultMethod?: StepUpMethod;
  /** Attempts already used in this dialog's lifetime, shown as a warning at 3. */
  maxAttemptsWarning?: number;
  /** Restrict methods when a sensitive action requires a second factor. */
  allowedMethods?: StepUpMethod[];
}

/**
 * Mounts the verification form only while the dialog is open.
 *
 * The `key` is the action: if the caller switches to a different sensitive action
 * without closing (two failures in a row from the same screen), a proof obtained for
 * the first action is not silently reused for the second — the form starts over.
 */
export function StepUpAuthDialog(props: StepUpAuthDialogProps): JSX.Element | null {
  if (!props.open) return null;
  return (
    <StepUpAuthForm
      key={props.action}
      action={props.action}
      onVerified={props.onVerified}
      onCancel={props.onCancel}
      defaultMethod={props.defaultMethod ?? 'TOTP'}
      maxAttemptsWarning={props.maxAttemptsWarning ?? 3}
      allowedMethods={props.allowedMethods}
    />
  );
}

interface StepUpAuthFormProps extends Omit<StepUpAuthDialogProps, 'open'> {
  defaultMethod: StepUpMethod;
  maxAttemptsWarning: number;
}

function StepUpAuthForm({
  action,
  onVerified,
  onCancel,
  defaultMethod,
  maxAttemptsWarning,
  allowedMethods,
}: StepUpAuthFormProps): JSX.Element {
  const [method, setMethod] = useState<StepUpMethod>(defaultMethod);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<StepUpProof | null>(null);
  // The clock starts as "unknown": the first reading arrives one tick after the proof
  // is issued, which is why the countdown text is conditional below. Reading the time
  // during render instead would make the markup depend on something React cannot see
  // change, and the purity rule correctly refuses it.
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!proof) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [proof]);

  const expiresAtMs = proof ? Date.parse(proof.expiresAt) : Number.NaN;
  const secondsLeft =
    proof !== null && nowMs !== null && Number.isFinite(expiresAtMs)
      ? Math.max(0, Math.floor((expiresAtMs - nowMs) / 1_000))
      : null;

  const actionLabel = useMemo(() => ACTION_LABEL[action] ?? action.replace(/_/g, ' ').toLowerCase(), [action]);
  const ready =
    (method === 'TOTP' && /^\d{6}$/.test(code.trim())) ||
    (method === 'PASSWORD' && password.length >= 8) ||
    (method === 'RECOVERY_CODE' && recoveryCode.trim().length >= 8);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const issued = await stepUpApi.issue({
        action,
        method,
        ...(method === 'TOTP' ? { code: code.trim() } : {}),
        ...(method === 'PASSWORD' ? { password } : {}),
        ...(method === 'RECOVERY_CODE' ? { recoveryCode: recoveryCode.trim() } : {}),
      });
      if (!issued || !issued.proofId || issued.action !== action || issued.method !== method || !Number.isFinite(Date.parse(issued.expiresAt)) || Date.parse(issued.expiresAt) <= Date.now()) throw new Error('Invalid verification response');
      setProof(issued);
      setAttempts(0);
      // The credential is dropped the instant it has been exchanged for a proof.
      setCode('');
      setPassword('');
      setRecoveryCode('');
      onVerified(issued);
    } catch {
      setAttempts((count) => count + 1);
      setError('Verification was not accepted. Check your details and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div
        className="w-full max-w-md rounded-lg border bg-card p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        aria-describedby="step-up-description"
      >
        <h2 id="step-up-title" className="text-base font-semibold">
          Confirm it is you
        </h2>
        <p id="step-up-description" className="mt-1 text-xs text-muted">
          {actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} needs a fresh identity check. The confirmation
          works once and only for this action.
        </p>

        <div className="mt-3 flex gap-1 text-xs" role="tablist" aria-label="Verification method">
          {(allowedMethods ?? (['TOTP', 'PASSWORD', 'RECOVERY_CODE'] as StepUpMethod[])).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={method === option}
              className={`rounded border px-2 py-1 ${method === option ? 'bg-slate-900 text-white' : ''}`}
              onClick={() => {
                setMethod(option);
                setError(null);
              }}
            >
              {option === 'TOTP' ? 'Authenticator' : option === 'PASSWORD' ? 'Password' : 'Recovery code'}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {method === 'TOTP' && (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">6-digit code</span>
              <input
                className="w-40 rounded border px-3 py-2 font-mono text-lg tracking-widest"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                autoFocus
              />
            </label>
          )}
          {method === 'PASSWORD' && (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Account password</span>
              <input
                className="rounded border px-3 py-2"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </label>
          )}
          {method === 'RECOVERY_CODE' && (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Recovery code</span>
              <input
                className="rounded border px-3 py-2 font-mono"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                autoComplete="off"
                autoFocus
              />
              <span className="text-xs text-muted">A recovery code is used up when it is accepted.</span>
            </label>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="alert">
            {error}
            {attempts >= maxAttemptsWarning && ' Several attempts have failed. If you cannot verify, your account may be locked shortly.'}
          </p>
        )}

        {proof && (
          <p className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900" role="status">
            Verified. Continue with the action
            {secondsLeft !== null ? ` — this confirmation expires in ${secondsLeft}s.` : '.'}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submit()}
            disabled={!ready || busy || (proof !== null && secondsLeft === 0)}
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </div>

        {attempts > 0 && (
          <p className="mt-2 text-[11px] text-muted">
            {attempts} failed attempt{attempts === 1 ? '' : 's'} in this dialog.
          </p>
        )}
      </div>
    </div>
  );
}
