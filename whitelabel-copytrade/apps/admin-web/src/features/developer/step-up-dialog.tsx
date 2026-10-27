'use client';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';

/** A fresh, single-use verification is requested immediately before mutation. */
export function StepUpDialog({ description, busy, error, onCancel, onVerify }: {
  description: string; busy: boolean; error: string; onCancel: () => void;
  onVerify: (method: StepUpMethod, value: string) => Promise<void>;
}): JSX.Element {
  const { t } = useDeveloperI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<StepUpMethod>('TOTP');
  const [value, setValue] = useState('');
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    input.current?.focus();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (error && !busy) input.current?.focus();
  }, [error, busy]);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !value) return;
    const submitted = value;
    setValue('');
    await onVerify(method, submitted);
  }
  return <dialog ref={dialog} className="dev-dialog" aria-labelledby="developer-step-up-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={(event) => void submit(event)} className="dev-form">
      <h2 id="developer-step-up-title">{t.verifyIdentity}</h2>
      <p>{description}</p>
      <label>{t.method}<select value={method} disabled={busy} onChange={(event) => { setMethod(event.target.value as StepUpMethod); setValue(''); }}>
        <option value="TOTP">{t.authenticator}</option><option value="PASSWORD">{t.password}</option><option value="RECOVERY_CODE">{t.recoveryCode}</option>
      </select></label>
      <label>{method === 'TOTP' ? t.authenticator : method === 'PASSWORD' ? t.password : t.recoveryCode}
        <input ref={input} required disabled={busy} type={method === 'TOTP' ? 'text' : 'password'} autoComplete={method === 'TOTP' ? 'one-time-code' : method === 'PASSWORD' ? 'current-password' : 'off'} value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="dev-actions"><button className="dev-button" type="submit" disabled={busy}>{busy ? t.saving : t.verifyAndContinue}</button><button className="dev-button" type="button" disabled={busy} onClick={onCancel}>{t.cancel}</button></div>
    </form>
  </dialog>;
}
