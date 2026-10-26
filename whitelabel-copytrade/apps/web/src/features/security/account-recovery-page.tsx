// # Responsibility: the public three-step recovery flow — request a link, prove you hold it, set new credentials — with states that never confirm whether an account exists.
//
// THE COPY IS PART OF THE SECURITY
// --------------------------------
// The request step must not say "no account with that address", in any wording, for
// any input. So the page always shows the same confirmation, and it explains why:
// a customer who is told the platform will not reveal it has no reason to feel
// stonewalled. That single sentence is what lets the identical response stay
// honest instead of merely evasive.
//
// The other rules:
//   * The token arrives in the URL fragment or is pasted; it is sent to the API and
//     never displayed back, never stored, and never put in a query string here.
//   * A refusal is rendered with the API's own reason sentence, because "expired"
//     and "already used" lead to different next actions.
//   * On success the page says every other device has been signed out and that
//     two-factor enrolment is the next step. Leaving that out would leave a
//     half-secured account that looks recovered.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import { accountRecoveryApi, type RecoveryCompleteResponse } from '@/api/security-api';

export type RecoveryStep = 'REQUEST' | 'VERIFY' | 'RESET' | 'DONE';

export interface AccountRecoveryPageProps {
  /** Token from the emailed link, when the page was opened directly from it. */
  initialToken?: string;
  /** Called after a successful reset so the host app can route to sign-in. */
  onRecovered?: () => void;
}

const STEP_LABEL: Record<RecoveryStep, string> = {
  REQUEST: '1. Request a link',
  VERIFY: '2. Confirm the link',
  RESET: '3. Set new credentials',
  DONE: 'Done',
};

export function AccountRecoveryPage({ initialToken, onRecovered }: AccountRecoveryPageProps): JSX.Element {
  const [step, setStep] = useState<RecoveryStep>(initialToken ? 'VERIFY' : 'REQUEST');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(initialToken ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RecoveryCompleteResponse | null>(null);

  async function requestLink(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await accountRecoveryApi.request(email.trim().toLowerCase());
      // The API's message is deliberately identical for every address.
      setRequestMessage(response.message);
      setStep('VERIFY');
    } catch {
      setError('The request could not be sent. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyToken(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await accountRecoveryApi.verify(token.trim());
      if (!response.valid) {
        setError(response.message);
        return;
      }
      setStep('RESET');
    } catch {
      setError('That link could not be checked. Try again, or request a new one.');
    } finally {
      setBusy(false);
    }
  }

  async function complete(): Promise<void> {
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < 12) {
      setError('Use at least 12 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await accountRecoveryApi.complete(token.trim(), password);
      if (response.status !== 'RECOVERED') {
        setError(response.message);
        setPassword('');
        setConfirm('');
        return;
      }
      setResult(response);
      setPassword('');
      setConfirm('');
      setToken('');
      setStep('DONE');
      onRecovered?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your password could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-md gap-4 p-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {(['REQUEST', 'VERIFY', 'RESET', 'DONE'] as RecoveryStep[]).map((entry, index) => (
          <li
            key={entry}
            className={`rounded border px-2 py-1 ${
              (['REQUEST', 'VERIFY', 'RESET', 'DONE'] as RecoveryStep[]).indexOf(step) >= index
                ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                : 'text-muted'
            }`}
          >
            {STEP_LABEL[entry]}
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}

      {step === 'REQUEST' && (
        <form
          className="grid gap-3 rounded border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.includes('@')) {
              setError('Enter the email address on your account.');
              return;
            }
            void requestLink();
          }}
        >
          <h1 className="text-base font-semibold">Recover your account</h1>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Email address</span>
            <input
              className="rounded border px-3 py-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <p className="text-xs text-muted">
            For everyone&apos;s safety this page never confirms whether an address is registered — the answer is the
            same either way, so an attacker cannot use this form to discover which addresses have accounts here.
          </p>
          <button
            type="submit"
            className="w-fit rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send the link'}
          </button>
        </form>
      )}

      {step === 'VERIFY' && (
        <form
          className="grid gap-3 rounded border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyToken();
          }}
        >
          {requestMessage && (
            <p className="rounded border border-slate-300 bg-slate-50 p-2 text-xs" role="status">
              {requestMessage}
            </p>
          )}
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Recovery code from the link</span>
            <input
              className="rounded border px-3 py-2 font-mono"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-xs text-muted">
              Open the link on the same device, or paste the code it contains. It works once and expires after 30
              minutes.
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy || token.trim().length < 16}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={() => {
                setStep('REQUEST');
                setError(null);
                setRequestMessage(null);
              }}
            >
              Start again
            </button>
          </div>
        </form>
      )}

      {step === 'RESET' && (
        <form
          className="grid gap-3 rounded border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void complete();
          }}
        >
          <h1 className="text-base font-semibold">Choose a new password</h1>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">New password</span>
            <input
              className="rounded border px-3 py-2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Repeat it</span>
            <input
              className="rounded border px-3 py-2"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <p className="text-xs text-muted">
            Recovering your account signs out every other device and resets the confirmations issued for sensitive
            actions. You will be asked to set up two-factor authentication again.
          </p>
          <button
            type="submit"
            className="w-fit rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || password.length < 12}
          >
            {busy ? 'Saving…' : 'Set password and secure the account'}
          </button>
        </form>
      )}

      {step === 'DONE' && result && (
        <div className="grid gap-3 rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
          <h1 className="text-base font-semibold">Account recovered</h1>
          <p>{result.message}</p>
          <p>
            {result.sessionsRevoked} session{result.sessionsRevoked === 1 ? '' : 's'} were signed out.
          </p>
          {result.requiresTwoFactorEnrolment && (
            <p className="text-xs">
              Set up two-factor authentication now — whoever had your account may also have had access to your old
              authenticator.
            </p>
          )}
          <div className="flex gap-2">
            <a className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white" href="/login">
              Sign in
            </a>
            <a className="rounded border border-current px-3 py-2 text-xs font-medium" href="/security">
              Open security settings
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
