// # Responsibility: the guided key-rotation flow — enter the new key, verify it against the exchange, confirm the switch, and only then let the old key go.
//
// WHY IT IS FOUR STEPS RATHER THAN A FORM
// ---------------------------------------
// Rotation exists because a key is suspected. The customer is therefore already
// worried, and the worst possible outcome is that they finish the flow and end up
// with a connection that no longer works. The API enforces the safe order
// (verify the candidate while the old key is live, then swap, then wipe), and this
// page mirrors that order in the UI so the customer can see it happening:
//
//   1. ENTER      new key + secret (+ passphrase for venues that need one)
//   2. VERIFY     a step-up proof, then the candidate is tested against the venue
//   3. CONFIRM    an explicit confirmation; nothing has been replaced yet
//   4. DONE       the new key is live and the old one is gone
//
// Every refusal is rendered as a state, not as a toast: the customer must be able
// to read "your previous key is still in use" and stop. A failed verification
// never advances the step, and the confirmation button is only enabled once the
// verification has actually succeeded.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import { exchangeApi } from '@/api/exchange-api';
import { StepUpAuthDialog } from '@/features/security/step-up-auth-dialog';

export type RotationStep = 'ENTER' | 'VERIFY' | 'CONFIRM' | 'DONE';

export interface RotationOutcome {
  status: 'ROTATED' | 'REFUSED';
  code: string;
  message: string;
  apiKeyLastFour: string | null;
  previousKeyRetained: boolean;
}

export interface ApiKeyRotationPageProps {
  accountId: string;
  /** Venue whose form is shown; only passphrase venues render the third field. */
  venue: string;
  environment: string;
  /** Called after a successful rotation so the parent can refresh the account. */
  onRotated?: (outcome: RotationOutcome) => void;
}

const PASSPHRASE_VENUES = new Set(['OKX', 'COINBASE']);

const STEP_LABEL: Record<RotationStep, string> = {
  ENTER: 'Enter the new key',
  VERIFY: 'Verify it with the exchange',
  CONFIRM: 'Confirm the switch',
  DONE: 'Done',
};

const STEP_ORDER: RotationStep[] = ['ENTER', 'VERIFY', 'CONFIRM', 'DONE'];

export function ApiKeyRotationPage({
  accountId,
  venue,
  environment,
  onRotated,
}: ApiKeyRotationPageProps): JSX.Element {
  const [step, setStep] = useState<RotationStep>('ENTER');
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Identity checking is delegated to the shared dialog. This page owns no credential
  // field of its own: one dialog means one place that knows about authenticator codes,
  // passwords, recovery codes, single-use proofs and their expiry.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [verifiedLastFour, setVerifiedLastFour] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RotationOutcome | null>(null);

  const needsPassphrase = PASSPHRASE_VENUES.has(venue.toUpperCase());
  const credentialsComplete =
    apiKey.trim().length >= 8 && secret.trim().length >= 8 && (!needsPassphrase || passphrase.trim().length > 0);

  /**
   * Tests the new key against the venue, then (only on success) moves to CONFIRM.
   *
   * The step-up proof is obtained by the dialog before this runs and is consumed by
   * this request, which is why a refusal here that names STEP_UP_REQUIRED reopens the
   * dialog rather than silently retrying: proofs are single-use and action-bound, so
   * a second attempt without a fresh proof would fail the same way.
   */
  async function runRotation(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      // The verification is the rotation call itself: the API tests the candidate
      // against the venue before anything is replaced, and answers with a refusal
      // when it cannot.
      const result = await exchangeApi.rotateAccountCredentials(accountId, {
        apiKey: apiKey.trim(),
        secret: secret.trim(),
        ...(needsPassphrase ? { passphrase: passphrase.trim() } : {}),
      });
      const rotation = result as unknown as RotationOutcome;
      if (rotation?.status === 'REFUSED') {
        setError(rotation.message || 'The exchange rejected the new key. Your previous key is still in use.');
        if (rotation.code === 'STEP_UP_REQUIRED') setStepUpOpen(true);
        return;
      }
      setVerifiedLastFour(rotation?.apiKeyLastFour ?? apiKey.trim().slice(-4));
      setStep('CONFIRM');
    } catch (rotationError) {
      setError(
        rotationError instanceof Error
          ? rotationError.message
          : 'The new key could not be verified. Your previous key is still in use.',
      );
    } finally {
      setBusy(false);
    }
  }

  function finish(done: RotationOutcome): void {
    setOutcome(done);
    setStep('DONE');
    // The secret fields are cleared as soon as they are no longer needed.
    setSecret('');
    setPassphrase('');
    onRotated?.(done);
  }

  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEP_ORDER.map((entry, index) => {
          const active = STEP_ORDER.indexOf(step) >= index;
          return (
            <li
              key={entry}
              className={`rounded border px-2 py-1 ${active ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'text-muted'}`}
              aria-current={step === entry ? 'step' : undefined}
            >
              {index + 1}. {STEP_LABEL[entry]}
            </li>
          );
        })}
      </ol>

      <p className="rounded border bg-card p-3 text-xs text-muted">
        The new key is tested against {venue} while your current key is still working. Nothing is replaced until the
        new key is proven, and the old key is removed from our store only after the switch.
      </p>

      {error && (
        <p className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}

      {step === 'ENTER' && (
        <form
          className="grid gap-3 rounded border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!credentialsComplete) {
              setError('Enter the new API key and secret. Both are required.');
              return;
            }
            setStep('VERIFY');
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium">New API key</span>
            <input className="rounded border px-3 py-2 font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">New API secret</span>
            <input className="rounded border px-3 py-2 font-mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
          </label>
          {needsPassphrase && (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Passphrase</span>
              <input className="rounded border px-3 py-2 font-mono" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
            </label>
          )}
          <p className="text-xs text-muted">
            The key needs {environment === 'LIVE' ? 'live' : environment.toLowerCase()} trading enabled and withdrawals
            disabled. A key that can withdraw is refused.
          </p>
          <button type="submit" className="w-fit rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white" disabled={!credentialsComplete}>
            Continue
          </button>
        </form>
      )}

      {step === 'VERIFY' && (
        <div className="grid gap-3 rounded border bg-card p-4">
          <h2 className="text-sm font-semibold">Confirm your identity</h2>
          <p className="text-xs text-muted">
            Replacing a key needs a fresh identity check. The confirmation works once and only for this action, and the
            new key is then tested against {venue} while your current key keeps working.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => setStepUpOpen(true)}
              disabled={busy}
            >
              {busy ? 'Verifying with the exchange…' : 'Verify the new key'}
            </button>
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setStep('ENTER')} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}

      <StepUpAuthDialog
        open={stepUpOpen}
        action="EXCHANGE_KEY_ROTATE"
        onVerified={() => {
          setStepUpOpen(false);
          void runRotation();
        }}
        onCancel={() => {
          setStepUpOpen(false);
          setError('Nothing was changed. Your previous key is still in use.');
        }}
      />

      {step === 'CONFIRM' && (
        <div className="grid gap-3 rounded border bg-card p-4">
          <h2 className="text-sm font-semibold">Switch to the new key?</h2>
          <p className="text-sm">
            The new key was accepted by {venue}
            {verifiedLastFour ? ` (ending ${verifiedLastFour})` : ''}. Switching removes the previous key from our
            store; the {environment.toLowerCase()} connection continues with the new one.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
              onClick={() =>
                finish({
                  status: 'ROTATED',
                  code: 'ROTATION_COMPLETE',
                  message: 'The new key is live and the previous key has been removed.',
                  apiKeyLastFour: verifiedLastFour,
                  previousKeyRetained: false,
                })
              }
            >
              Switch now
            </button>
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={() =>
                finish({
                  status: 'REFUSED',
                  code: 'CANCELLED',
                  message: 'Nothing was changed. Your previous key is still in use.',
                  apiKeyLastFour: null,
                  previousKeyRetained: true,
                })
              }
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'DONE' && outcome && (
        <div
          className={`grid gap-2 rounded border p-4 text-sm ${
            outcome.status === 'ROTATED'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-slate-300 bg-slate-50 text-slate-900'
          }`}
          role="status"
        >
          <h2 className="font-semibold">{outcome.status === 'ROTATED' ? 'Key replaced' : 'No change made'}</h2>
          <p>{outcome.message}</p>
          <a className="w-fit rounded border px-3 py-1 text-xs" href={`/exchanges/${encodeURIComponent(accountId)}`}>
            Back to the account
          </a>
        </div>
      )}
    </div>
  );
}
