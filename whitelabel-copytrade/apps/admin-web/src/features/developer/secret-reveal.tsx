'use client';
import { useEffect, useRef, useState, type JSX } from 'react';
import { useDeveloperI18n } from './i18n';

/** The parent keeps the issued value in memory only and removes it on close. */
export function SecretReveal({ secret, keyId, onClose }: { secret: string; keyId?: string; onClose: () => void }): JSX.Element {
  const { t } = useDeveloperI18n();
  const [message, setMessage] = useState('');
  const region = useRef<HTMLElement>(null);
  useEffect(() => { region.current?.focus(); }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setMessage(t.copied);
    } catch {
      setMessage(t.copyFailed);
    }
  }
  return <section ref={region} tabIndex={-1} className="dev-secret" aria-label={t.oneTime}>
    <p role="alert">{t.oneTime}</p>
    {keyId && <p>{t.keyId}: <code>{keyId}</code></p>}
    <code>{secret}</code>
    <div className="dev-actions" style={{ marginTop: '1rem' }}>
      <button className="dev-button" type="button" onClick={() => void copy()}>{t.copy}</button>
      <button className="dev-button" type="button" onClick={onClose}>{t.done}</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
