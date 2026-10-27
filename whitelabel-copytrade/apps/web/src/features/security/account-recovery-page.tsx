'use client';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { accountRecoveryApi, type RecoveryCompleteResponse } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { recoveryCopy, type RecoveryLocale } from './recovery-copy';

export type RecoveryStep = 'REQUEST' | 'VERIFY' | 'RESET' | 'DONE';
export interface AccountRecoveryPageProps { initialToken?: string; onRecovered?: () => void }
type ErrorKey = 'unavailable' | 'invalid' | 'mismatch' | 'emailError' | 'rate' | 'policyError';

export function AccountRecoveryPage({ initialToken, onRecovered }: AccountRecoveryPageProps): JSX.Element {
  const [locale, setLocale] = useState<RecoveryLocale>('en');
  const [step, setStep] = useState<RecoveryStep>(initialToken ? 'VERIFY' : 'REQUEST');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(initialToken ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [requested, setRequested] = useState(false);
  const [result, setResult] = useState<RecoveryCompleteResponse | null>(null);
  const requestIntent = useRef<{ intent: string; key: string } | null>(null);
  const resetIntent = useRef<{ intent: string; key: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const t = recoveryCopy[locale];

  useEffect(() => {
    const language = navigator.language.split('-')[0] as RecoveryLocale;
    if (Object.prototype.hasOwnProperty.call(recoveryCopy, language)) setLocale(language);
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);

  function keyFor(ref: typeof requestIntent, intent: string): string {
    if (!ref.current || ref.current.intent !== intent) ref.current = { intent, key: newIdempotencyKey('recovery') };
    return ref.current.key;
  }
  function failure(caught: unknown, policy = false): ErrorKey {
    if (caught instanceof ApiError && caught.status === 429) return 'rate';
    if (policy && caught instanceof ApiError && caught.status === 400) return 'policyError';
    return 'unavailable';
  }
  async function requestLink() {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) { setError('emailError'); return; }
    setBusy(true); setError(null);
    try {
      await accountRecoveryApi.request(normalized, keyFor(requestIntent, normalized));
      setRequested(true); setStep('VERIFY');
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }
  async function verifyToken() {
    setBusy(true); setError(null);
    try {
      const response = await accountRecoveryApi.verify(token.trim());
      if (!response.valid) { setError('invalid'); return; }
      setStep('RESET');
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }
  async function complete() {
    if (password !== confirm) { setError('mismatch'); return; }
    if (password.length < 12 || password.length > 128) { setError('policyError'); return; }
    setBusy(true); setError(null);
    try {
      const response = await accountRecoveryApi.complete(token.trim(), password, keyFor(resetIntent, JSON.stringify([token.trim(), password])));
      if (response.status !== 'RECOVERED') { setError('invalid'); setPassword(''); setConfirm(''); resetIntent.current = null; return; }
      setResult(response); setPassword(''); setConfirm(''); setToken(''); resetIntent.current = null;
      setStep('DONE'); onRecovered?.();
    } catch (caught) { setError(failure(caught, true)); }
    finally { setBusy(false); }
  }

  const labels: Record<RecoveryStep, string> = { REQUEST: t.requestStep, VERIFY: t.verifyStep, RESET: t.resetStep, DONE: t.doneStep };
  const stages: RecoveryStep[] = ['REQUEST', 'VERIFY', 'RESET', 'DONE'];
  const button = 'w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50';
  const input = 'rounded border bg-background px-3 py-2';
  return <div className="mx-auto grid max-w-md gap-4 p-4" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <label className="grid w-fit gap-1 text-sm">{t.language}
      <select className={input} value={locale} onChange={(event) => setLocale(event.target.value as RecoveryLocale)}>
        <option value="en">English</option><option value="bn">বাংলা</option><option value="ar">العربية</option><option value="es">Español</option><option value="tr">Türkçe</option>
      </select>
    </label>
    <ol className="flex flex-wrap gap-2 text-xs">
      {stages.map((entry, index) => <li key={entry} aria-current={entry === step ? 'step' : undefined}
        className={`rounded border px-2 py-1 ${stages.indexOf(step) >= index ? 'border-primary font-medium' : 'text-muted'}`}>{labels[entry]}</li>)}
    </ol>
    {error && <p className="rounded border border-red-400 bg-card p-3 text-sm" role="alert">{t[error]}</p>}
    {step === 'REQUEST' && <form className="grid gap-3 rounded border bg-card p-4" onSubmit={(event) => { event.preventDefault(); void requestLink(); }}>
      <h1 ref={heading} tabIndex={-1} className="text-base font-semibold">{t.title}</h1>
      <label className="grid gap-1 text-sm"><span className="font-medium">{t.email}</span>
        <input className={input} dir="ltr" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required />
      </label>
      <p className="text-xs text-muted">{t.privacy}</p>
      <button type="submit" className={button} disabled={busy}>{busy ? t.sending : t.send}</button>
    </form>}
    {step === 'VERIFY' && <form className="grid gap-3 rounded border bg-card p-4" onSubmit={(event) => { event.preventDefault(); void verifyToken(); }}>
      <h1 ref={heading} tabIndex={-1} className="text-base font-semibold">{t.verifyStep}</h1>
      {requested && <p className="rounded border p-2 text-xs" role="status">{t.accepted}</p>}
      <label className="grid gap-1 text-sm"><span className="font-medium">{t.code}</span>
        <input className={`${input} font-mono`} dir="ltr" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} maxLength={128} required aria-describedby="recovery-code-hint" />
        <span id="recovery-code-hint" className="text-xs text-muted">{t.codeHint}</span>
      </label>
      <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={busy || token.trim().length < 40}>{busy ? t.checking : t.continue}</button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => { setStep('REQUEST'); setError(null); setRequested(false); setToken(''); }} disabled={busy}>{t.startAgain}</button></div>
    </form>}
    {step === 'RESET' && <form className="grid gap-3 rounded border bg-card p-4" onSubmit={(event) => { event.preventDefault(); void complete(); }}>
      <h1 ref={heading} tabIndex={-1} className="text-base font-semibold">{t.resetTitle}</h1>
      <label className="grid gap-1 text-sm"><span className="font-medium">{t.password}</span>
        <input className={input} dir="ltr" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} aria-describedby="recovery-password-hint" required />
      </label>
      <label className="grid gap-1 text-sm"><span className="font-medium">{t.confirm}</span>
        <input className={input} dir="ltr" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required />
      </label>
      <p id="recovery-password-hint" className="text-xs text-muted">{t.policy}</p><p className="text-xs text-muted">{t.mfa}</p>
      <button type="submit" className={button} disabled={busy || password.length < 12}>{busy ? t.saving : t.save}</button>
    </form>}
    {step === 'DONE' && result && <div className="grid gap-3 rounded border bg-card p-4 text-sm" role="status">
      <h1 ref={heading} tabIndex={-1} className="text-base font-semibold">{t.doneTitle}</h1><p>{t.recovered}</p>
      <p>{t.sessions}: <bdi>{result.sessionsRevoked}</bdi></p>
      <div className="flex flex-wrap gap-2"><a className={button} href="/login">{t.signIn}</a><a className="rounded border px-3 py-2 text-sm" href="/security">{t.security}</a></div>
    </div>}
  </div>;
}
