'use client';

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { depositAddressApi, type DepositAddress, type DepositAssetOption, type DepositObservation } from '@/api/deposit-address-api';
import { ApiError } from '@/api/api-errors';
import { stepUpApi, type StepUpMethod } from '@/api/security-api';
import { useAuth } from '@/auth/auth.store';
import { LocaleSelector } from '@/features/oauth/locale-selector';
import { depositAddressCopy, type DepositAddressLocale } from './deposit-address-copy';

interface FundingIdentity { id: string; accountId: string; currency: string }

/** One customer-owned request only. Changing identity drops the entire panel. */
export function DepositAddressPanel({ request }: { request: FundingIdentity }): JSX.Element | null {
  const { session } = useAuth();
  if (!session) return null;
  return <DepositForOwner key={`${session.tenant.id}:${session.user.id}:${request.id}`}
    owner={{ tenantId: session.tenant.id, userId: session.user.id }} request={request} />;
}

async function retryKey(owner: { tenantId: string; userId: string }, requestId: string, choice: DepositAssetOption): Promise<string> {
  if (!window.crypto.subtle || typeof window.crypto.randomUUID !== 'function') throw new Error('Secure retry storage unavailable');
  const fingerprint = JSON.stringify([owner.tenantId, owner.userId, requestId, choice.assetId, choice.networkId]);
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const slot = `deposit-address:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`;
  const existing = window.sessionStorage.getItem(slot);
  if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) return existing;
  if (existing) throw new Error('Invalid retry state');
  const key = window.crypto.randomUUID();
  window.sessionStorage.setItem(slot, key);
  return key;
}

function DepositForOwner({ owner, request }: { owner: { tenantId: string; userId: string }; request: FundingIdentity }): JSX.Element {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState('');
  const [locale, setLocale] = useState<DepositAddressLocale>('en');
  const [verifyOpen, setVerifyOpen] = useState(false), [method, setMethod] = useState<StepUpMethod>('PASSWORD');
  const [credential, setCredential] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const [transactionHash, setTransactionHash] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<'missing' | 'failed' | null>(null);
  const [observation, setObservation] = useState<DepositObservation | null>(null);
  const id = useId();
  const cache = useQueryClient();
  useEffect(() => {
    const language = navigator.language.split('-')[0] as DepositAddressLocale;
    if (Object.hasOwn(depositAddressCopy, language)) setLocale(language);
  }, []);
  const t = depositAddressCopy[locale];
  const assetsKey = ['deposit-address-assets', owner.tenantId, owner.userId, request.id] as const;
  const assets = useQuery({ queryKey: assetsKey, queryFn: () => depositAddressApi.listAssets(request.id), enabled: open, retry: false });
  const choices = assets.data ?? [];
  const choice = choices.find((item) => item.assetId === selected && item.currency === request.currency);
  const addressKey = ['deposit-address', owner.tenantId, owner.userId, request.id, choice?.assetId ?? '', choice?.networkId ?? ''] as const;
  const current = useQuery({ queryKey: addressKey, queryFn: async () => {
    if (!choice) throw new Error('Missing asset');
    const result = await depositAddressApi.get(request.id, choice);
    if (result.accountId !== request.accountId) throw new Error('Account mismatch');
    return result;
  }, enabled: open && Boolean(choice), retry: false, staleTime: 0 });
  const notIssued = current.error instanceof ApiError && current.error.status === 404;
  const error = current.error && !notIssued;
  const validCredential = method === 'TOTP' ? /^\d{6}$/.test(credential.trim()) :
    method === 'PASSWORD' ? credential.length >= 8 && credential.length <= 256 : credential.trim().length >= 8 && credential.trim().length <= 64;

  async function issue(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!choice || busy || !validCredential) return;
    setBusy(true); setFailed(false);
    try {
      const key = await retryKey(owner, request.id, choice);
      const proof = await stepUpApi.issue({ action: 'CUSTODY_ADDRESS_ISSUE', method,
        ...(method === 'PASSWORD' ? { password: credential } : method === 'TOTP' ? { code: credential.trim() } : { recoveryCode: credential.trim() }) });
      setCredential('');
      if (!proof || !proof.proofId || proof.action !== 'CUSTODY_ADDRESS_ISSUE' || proof.method !== method ||
          !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()) throw new Error('Invalid verification response');
      const result = await depositAddressApi.issue(request.id, choice, key);
      if (result.accountId !== request.accountId) throw new Error('Account mismatch');
      cache.setQueryData<DepositAddress>(addressKey, result);
      setVerifyOpen(false); setCopyStatus(null);
    } catch {
      setCredential(''); setFailed(true);
    } finally { setBusy(false); }
  }

  async function lookup(event: FormEvent): Promise<void> {
    event.preventDefault();
    const hash = transactionHash.trim();
    if (!choice || !current.data || lookupBusy || !/^0x[0-9a-f]{64}$/i.test(hash)) return;
    setLookupBusy(true); setLookupError(null); setObservation(null);
    try {
      const result = await depositAddressApi.observeTransfer(request.id, choice, current.data.address, hash);
      setObservation(result);
    } catch (error) {
      setLookupError(error instanceof ApiError && error.status === 404 ? 'missing' : 'failed');
    } finally { setLookupBusy(false); }
  }

  async function copyAddress(value: string): Promise<void> {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopyStatus('copied');
    } catch { setCopyStatus('failed'); }
  }

  return <section className="my-2 text-sm" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <button type="button" className="rounded border px-3 py-2" aria-expanded={open} aria-controls={`${id}-body`} disabled={busy || lookupBusy}
      onClick={() => { setOpen(!open); setVerifyOpen(false); setCredential(''); setFailed(false); setTransactionHash(''); setObservation(null); setLookupError(null); }}>{open ? t.close : t.open}</button>
    {open && <div id={`${id}-body`} className="mt-2 grid max-w-xl gap-3 rounded border bg-card p-3">
      <h3 className="font-semibold">{t.title}</h3><LocaleSelector locale={locale} onChange={setLocale} label={t.language} />
      <p className="rounded border border-amber-500 p-3" role="alert">{t.warning}</p><p>{t.pending}</p>
      {assets.isLoading ? <p role="status">{t.loading}</p> : assets.error ? <div role="alert">{t.unavailable} <button type="button" className="underline" onClick={() => void assets.refetch()}>{t.retry}</button></div> :
        choices.length === 0 ? <p role="status">{t.empty}</p> : <>
          <label htmlFor={`${id}-asset`}>{t.asset}</label>
          <select id={`${id}-asset`} className="rounded border bg-card p-2" value={selected} disabled={busy || lookupBusy}
            onChange={(event) => { setSelected(event.target.value); setVerifyOpen(false); setCredential(''); setFailed(false); setCopyStatus(null); setTransactionHash(''); setObservation(null); setLookupError(null); }}>
            <option value="">{t.select}</option>
            {choices.filter((item) => item.currency === request.currency).map((item) => <option key={`${item.assetId}:${item.networkId}`} value={item.assetId}>{item.currency} · {item.networkName} · {item.assetId}</option>)}
          </select>
          {choice && <p>{choice.contractAddress ? <>{t.contract}: <bdi className="break-all font-mono" dir="ltr">{choice.contractAddress}</bdi></> : t.native}</p>}
          {choice && current.isLoading && <p role="status">{t.loading}</p>}
          {choice && error && <div role="alert">{t.unavailable} <button type="button" className="underline" onClick={() => void current.refetch()}>{t.retry}</button></div>}
          {choice && notIssued && <p role="status">{t.noAddress}</p>}
          {choice && current.data && <div className="rounded border p-3">
            <p className="font-medium" role="status">{t.verified}</p><p><bdi dir="ltr" className="break-all font-mono">{current.data.address}</bdi></p>
            <button type="button" className="mt-2 rounded border px-3 py-2" onClick={() => void copyAddress(current.data.address)}>{t.copy}</button>
            {copyStatus && <p aria-live="polite">{copyStatus === 'copied' ? t.copied : t.copyFailed}</p>}
          </div>}
          {choice && current.data && <form className="grid gap-2 rounded border p-3" onSubmit={(event) => void lookup(event)}>
            <h4 className="font-semibold">{t.lookupTitle}</h4>
            <p className="rounded border border-amber-500 p-2">{t.lookupWarning}</p>
            <label htmlFor={`${id}-hash`}>{t.hashLabel}</label>
            <input id={`${id}-hash`} dir="ltr" autoComplete="off" spellCheck={false} maxLength={66}
              className="rounded border bg-card p-2 font-mono" value={transactionHash} disabled={lookupBusy}
              onChange={(event) => { setTransactionHash(event.target.value); setObservation(null); setLookupError(null); }} />
            <button type="submit" className="rounded border px-3 py-2 disabled:opacity-50"
              disabled={lookupBusy || !/^0x[0-9a-f]{64}$/i.test(transactionHash.trim())}>{lookupBusy ? t.lookupWorking : t.lookupButton}</button>
            {lookupError && <p role="alert">{lookupError === 'missing' ? t.lookupMissing : t.lookupFailed}</p>}
            {observation && observation.destinationAddress.toLowerCase() === current.data.address.toLowerCase() && <div role="status" aria-live="polite" className="grid gap-1 rounded border p-2">
              <p className="font-medium">{t.observed}</p>
              <p>{t.observedAmount}: <bdi dir="ltr">{observation.amount} {observation.currency}</bdi></p>
              <p>{t.confirmations}: {observation.confirmationCount}</p>
              <p>{observation.amountEvidence === 'PROVIDER_REPORTED' ? t.nativeEvidence : t.tokenEvidence}</p>
              <p>{t.lookupWarning}</p>
            </div>}
          </form>}
          {choice && !current.isLoading && !error && !current.data && !verifyOpen && <button type="button" className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={() => setVerifyOpen(true)}>{t.issue}</button>}
          {choice && verifyOpen && <form className="grid gap-2 rounded border p-3" onSubmit={(event) => void issue(event)}>
            <h4 className="font-semibold">{t.verifyTitle}</h4><p>{t.verifyHelp}</p>
            <label htmlFor={`${id}-method`}>{t.method}</label><select id={`${id}-method`} className="rounded border bg-card p-2" value={method} disabled={busy}
              onChange={(event) => { setMethod(event.target.value as StepUpMethod); setCredential(''); setFailed(false); }}>
              <option value="PASSWORD">{t.password}</option><option value="TOTP">{t.totp}</option><option value="RECOVERY_CODE">{t.recovery}</option>
            </select>
            <label htmlFor={`${id}-credential`}>{method === 'PASSWORD' ? t.password : method === 'TOTP' ? t.totp : t.recovery}</label>
            <input id={`${id}-credential`} type="password" autoComplete={method === 'PASSWORD' ? 'current-password' : 'one-time-code'}
              inputMode={method === 'TOTP' ? 'numeric' : 'text'} className="rounded border bg-card p-2" value={credential} disabled={busy}
              onChange={(event) => setCredential(event.target.value)} aria-invalid={failed} />
            {failed && <p role="alert">{t.failed}</p>}
            <div className="flex gap-2"><button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" disabled={busy || !validCredential}>{busy ? t.working : t.submit}</button>
              <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => { setVerifyOpen(false); setCredential(''); setFailed(false); }}>{t.back}</button></div>
          </form>}
        </>}
    </div>}
  </section>;
}
