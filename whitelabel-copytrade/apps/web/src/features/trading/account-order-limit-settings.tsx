'use client';

// # Responsibility: owner-scoped account selection and verified, versioned order-size changes.
import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { usePreferredLocale } from '@/lib/preferred-locale';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountOrderLimitsApi, type AccountOrderLimitAccount, type AccountOrderLimitPage, type AccountOrderLimitUpdate, type AccountOrderLimitView } from '@/api/account-order-limits-api';
import { stepUpApi, type StepUpMethod } from '@/api/security-api';
import { useAuth } from '@/auth/auth.store';
import { LocaleSelector } from '@/features/oauth/locale-selector';
import { accountOrderLimitCopy, type AccountOrderLimitLocale } from './account-order-limit-copy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/;
const CURRENCY = /^[A-Z0-9]{2,16}$/;
const PAGE_SIZE = 20;
type Owner = { tenantId: string; userId: string };
export const accountOrderListKey = (owner: Owner, page: number) => ['account-order-limits', owner.tenantId, owner.userId, 'list', page] as const;
export const accountOrderViewKey = (owner: Owner, accountId: string) => ['account-order-limits', owner.tenantId, owner.userId, 'view', accountId] as const;

export function AccountOrderLimitSettings(): JSX.Element {
  const { session } = useAuth();
  if (!session) return <p role="status">{accountOrderLimitCopy.en.signedOut}</p>;
  const owner = { tenantId: session.tenant.id, userId: session.user.id };
  return <AccountOrderLimitsForOwner key={`${owner.tenantId}:${owner.userId}`} owner={owner} />;
}
function validAccount(account: AccountOrderLimitAccount): boolean {
  return !!account && typeof account.id === 'string' && UUID.test(account.id) && typeof account.label === 'string' &&
    typeof account.marketType === 'string' && typeof account.tradingMode === 'string' && typeof account.status === 'string';
}
function validatePage(value: AccountOrderLimitPage, page: number): AccountOrderLimitPage {
  if (!value || !Array.isArray(value.data) || !value.data.every(validAccount) ||
      new Set(value.data.map((a) => a.id)).size !== value.data.length || !Number.isSafeInteger(value.total) || value.total < 0 ||
      value.page !== page || value.limit !== PAGE_SIZE || value.data.length > PAGE_SIZE) throw new Error('Invalid account list');
  return value;
}
function validAmount(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && AMOUNT.test(value));
}
function normalizeAmount(value: string | null): string | null {
  if (value === null || !value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}
function validateView(value: AccountOrderLimitView, owner: Owner, accountId: string): AccountOrderLimitView {
  if (!value || value.tenantId !== owner.tenantId || !validAccount(value.account) || value.account.id !== accountId ||
      !value.limits || !validAmount(value.limits.maxBaseQuantity) || !validAmount(value.limits.maxOrderNotional) ||
      !(value.limits.notionalCurrency === null || (typeof value.limits.notionalCurrency === 'string' && CURRENCY.test(value.limits.notionalCurrency))) ||
      (value.limits.maxOrderNotional === null) !== (value.limits.notionalCurrency === null) ||
      typeof value.configured !== 'boolean' || value.configured !== (value.limits.maxBaseQuantity !== null || value.limits.maxOrderNotional !== null) ||
      !(value.revision === null || (typeof value.revision === 'string' && UUID.test(value.revision))) ||
      (value.revision === null) !== (value.updatedAt === null) || (value.configured && value.revision === null) ||
      !(value.updatedAt === null || (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)))) ||
      typeof value.asOf !== 'string' || !Number.isFinite(Date.parse(value.asOf))) throw new Error('Invalid limit response');
  return value;
}
async function retryKey(owner: Owner, accountId: string, input: AccountOrderLimitUpdate): Promise<string> {
  if (!window.crypto.subtle || typeof window.crypto.randomUUID !== 'function') throw new Error('Secure retry storage unavailable');
  const fingerprint = JSON.stringify([owner.tenantId, owner.userId, accountId, input.expectedRevision, input.maxBaseQuantity, input.maxOrderNotional, input.notionalCurrency]);
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const slot = `account-order-limit:${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('')}`;
  const existing = window.sessionStorage.getItem(slot);
  if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) return existing;
  if (existing) throw new Error('Invalid retry state');
  const key = window.crypto.randomUUID();
  window.sessionStorage.setItem(slot, key);
  return key;
}
function parseAmount(input: string): string | null {
  if (input === '') return null;
  if (!AMOUNT.test(input)) throw new Error('Invalid amount');
  return normalizeAmount(input);
}

function AccountOrderLimitsForOwner({ owner }: { owner: Owner }): JSX.Element {
  const [locale, setLocale] = usePreferredLocale(accountOrderLimitCopy, 'en');
  const [page, setPage] = useState(1), [accountId, setAccountId] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);
  const id = useId();
  const list = useQuery({ queryKey: accountOrderListKey(owner, page), queryFn: async () => validatePage(await accountOrderLimitsApi.list(page), page), retry: false });
  const t = accountOrderLimitCopy[locale];
  function changePage(nextPage: number): void { setAccountId(''); setPage(nextPage); }
  return <section className="space-y-4" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <div className="rounded border bg-card p-4 space-y-4">
      <LocaleSelector locale={locale} onChange={setLocale} label={t.language} />
      <div><h2 className="text-xl font-semibold">{t.title}</h2><p className="text-sm text-muted-foreground">{t.intro}</p></div>
      {list.isLoading ? <p role="status">{t.accountsLoading}</p> : list.isError || !list.data ?
        <p role="alert">{t.accountsFailed} <button type="button" className="underline" onClick={() => void list.refetch()}>{t.retry}</button></p> : <>
          {list.data.total === 0 ? <p>{t.empty}</p> : <>
            <label htmlFor={`${id}-account`} className="block text-sm font-medium">{t.account}</label>
            <select id={`${id}-account`} value={accountId} disabled={editorBusy} onChange={(event) => setAccountId(event.target.value)} className="w-full max-w-xl rounded border bg-background p-2">
              <option value="">{t.choose}</option>{list.data.data.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.marketType} · {account.tradingMode} · {account.status}</option>)}
            </select>
            {list.data.total > PAGE_SIZE && <div className="flex items-center gap-3 text-sm">
              <button type="button" disabled={editorBusy || page === 1} onClick={() => changePage(page - 1)} className="rounded border px-2 py-1 disabled:opacity-50">{t.previous}</button>
              <span>{t.page} {page}</span>
              <button type="button" disabled={editorBusy || page * PAGE_SIZE >= list.data.total} onClick={() => changePage(page + 1)} className="rounded border px-2 py-1 disabled:opacity-50">{t.next}</button>
            </div>}
          </>}
          {accountId && list.data.data.some((account) => account.id === accountId) && <LimitEditor key={accountId} owner={owner} accountId={accountId} locale={locale} onBusyChange={setEditorBusy} />}
        </>}
    </div>
    <div className="rounded border bg-card p-4 space-y-2 text-sm"><h3 className="font-semibold">{t.safetyTitle}</h3>
      <ul className="list-disc space-y-1 ps-5"><li>{t.safety1}</li><li>{t.safety2}</li><li>{t.safety3}</li></ul>
    </div>
  </section>;
}

function LimitEditor({ owner, accountId, locale, onBusyChange }: { owner: Owner; accountId: string; locale: AccountOrderLimitLocale; onBusyChange: (busy: boolean) => void }): JSX.Element {
  const [quantity, setQuantity] = useState<string | null>(null), [notional, setNotional] = useState<string | null>(null), [currency, setCurrency] = useState<string | null>(null);
  const [editRevision, setEditRevision] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<AccountOrderLimitUpdate | null>(null);
  const [method, setMethod] = useState<StepUpMethod>('PASSWORD'), [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [invalid, setInvalid] = useState(false), [saved, setSaved] = useState(false);
  const credentialRef = useRef<HTMLInputElement>(null), id = useId(), cache = useQueryClient();
  const key = accountOrderViewKey(owner, accountId);
  const query = useQuery({ queryKey: key, queryFn: async () => validateView(await accountOrderLimitsApi.get(accountId), owner, accountId), retry: false, staleTime: 0 });
  useEffect(() => { if (draft) credentialRef.current?.focus(); }, [draft]);
  const t = accountOrderLimitCopy[locale], view = query.data;
  const validCredential = method === 'TOTP' ? /^\d{6}$/.test(credential.trim()) : method === 'PASSWORD'
    ? credential.length >= 8 && credential.length <= 256 : credential.trim().length >= 8 && credential.trim().length <= 64;
  function rememberRevision(): void { if (editRevision === undefined && view) setEditRevision(view.revision); }
  function startUpdate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!view || busy || draft) return;
    try {
      const amount = parseAmount(notional ?? view.limits.maxOrderNotional ?? '');
      const asset = (currency ?? view.limits.notionalCurrency ?? '').trim().toUpperCase();
      if ((amount === null) !== (asset === '') || (asset !== '' && !CURRENCY.test(asset))) throw new Error('Invalid currency');
      setDraft({ expectedRevision: editRevision === undefined ? view.revision : editRevision,
        maxBaseQuantity: parseAmount(quantity ?? view.limits.maxBaseQuantity ?? ''), maxOrderNotional: amount, notionalCurrency: asset || null });
      setCredential(''); setInvalid(false); setFailed(false); setSaved(false);
    } catch { setInvalid(true); }
  }
  async function verifyAndSave(): Promise<void> {
    if (!draft || busy || !validCredential) return;
    setBusy(true); onBusyChange(true); setFailed(false);
    try {
      const idempotencyKey = await retryKey(owner, accountId, draft);
      const proof = await stepUpApi.issue({ action: 'USER_ACCOUNT_ORDER_LIMIT_UPDATE', method,
        ...(method === 'PASSWORD' ? { password: credential } : method === 'TOTP' ? { code: credential.trim() } : { recoveryCode: credential.trim() }) });
      setCredential('');
      if (!proof || !proof.proofId || proof.action !== 'USER_ACCOUNT_ORDER_LIMIT_UPDATE' || proof.method !== method ||
          !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()) throw new Error('Invalid verification response');
      const result = validateView(await accountOrderLimitsApi.update(accountId, draft, idempotencyKey), owner, accountId);
      if (normalizeAmount(result.limits.maxBaseQuantity) !== draft.maxBaseQuantity || normalizeAmount(result.limits.maxOrderNotional) !== draft.maxOrderNotional ||
          result.limits.notionalCurrency !== draft.notionalCurrency) throw new Error('Settings changed');
      cache.setQueryData(key, result);
      setDraft(null); setSaved(true); setQuantity(null); setNotional(null); setCurrency(null); setEditRevision(undefined);
    } catch { setCredential(''); setFailed(true); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function refresh(): Promise<void> {
    if (busy) return;
    setDraft(null); setCredential(''); setFailed(false); setSaved(false); setQuantity(null); setNotional(null); setCurrency(null); setEditRevision(undefined);
    await query.refetch();
  }
  if (query.isLoading) return <p role="status">{t.loading}</p>;
  if (query.isError || !view) return <p role="alert">{t.failed} <button type="button" className="underline" onClick={() => void query.refetch()}>{t.retry}</button></p>;
  return <form className="space-y-3" onSubmit={startUpdate}>
    <span className="inline-block rounded border px-2 py-1 text-xs">{view.configured ? t.configured : t.unconfigured}</span>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1"><label htmlFor={`${id}-quantity`} className="text-sm font-medium">{t.quantity}</label>
        <input id={`${id}-quantity`} inputMode="decimal" value={quantity ?? view.limits.maxBaseQuantity ?? ''} disabled={busy || !!draft} placeholder={t.blank}
          onChange={(event) => { rememberRevision(); setQuantity(event.target.value); }} className="w-full rounded border bg-background px-2 py-1 text-sm" />
        <p className="text-xs text-muted-foreground">{t.quantityHelp}</p></div>
      <div className="space-y-1"><label htmlFor={`${id}-notional`} className="text-sm font-medium">{t.notional}</label>
        <input id={`${id}-notional`} inputMode="decimal" value={notional ?? view.limits.maxOrderNotional ?? ''} disabled={busy || !!draft} placeholder={t.blank}
          onChange={(event) => { rememberRevision(); setNotional(event.target.value); }} className="w-full rounded border bg-background px-2 py-1 text-sm" />
        <p className="text-xs text-muted-foreground">{t.notionalHelp}</p></div>
      <div className="space-y-1"><label htmlFor={`${id}-currency`} className="text-sm font-medium">{t.currency}</label>
        <input id={`${id}-currency`} value={currency ?? view.limits.notionalCurrency ?? ''} disabled={busy || !!draft} maxLength={16} autoCapitalize="characters"
          onChange={(event) => { rememberRevision(); setCurrency(event.target.value.toUpperCase()); }} className="w-full rounded border bg-background px-2 py-1 text-sm" /></div>
    </div>
    {!draft && <div className="flex flex-wrap gap-2"><button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">{t.save}</button>
      <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => { rememberRevision(); setQuantity(''); setNotional(''); setCurrency(''); setInvalid(false); }}>{t.clear}</button></div>}
    {invalid && <p role="alert">{t.invalid}</p>}
    {draft && <div className="grid max-w-xl gap-2 rounded border p-3">
      <h3 className="font-semibold">{t.verifyTitle}</h3><p>{t.verifyHelp}</p>
      <label htmlFor={`${id}-method`}>{t.method}</label><select id={`${id}-method`} className="rounded border bg-background p-2" value={method} disabled={busy}
        onChange={(event) => { setMethod(event.target.value as StepUpMethod); setCredential(''); setFailed(false); }}>
        <option value="PASSWORD">{t.password}</option><option value="TOTP">{t.totp}</option><option value="RECOVERY_CODE">{t.recovery}</option></select>
      <label htmlFor={`${id}-credential`}>{method === 'PASSWORD' ? t.password : method === 'TOTP' ? t.totp : t.recovery}</label>
      <input ref={credentialRef} id={`${id}-credential`} type="password" autoComplete={method === 'PASSWORD' ? 'current-password' : 'one-time-code'}
        inputMode={method === 'TOTP' ? 'numeric' : 'text'} className="rounded border bg-background p-2" value={credential} disabled={busy} aria-invalid={failed}
        onChange={(event) => setCredential(event.target.value)} />
      {failed && <p role="alert">{t.saveFailed}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !validCredential} onClick={() => void verifyAndSave()} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{busy ? t.busy : t.verify}</button>
        <button type="button" disabled={busy} onClick={() => { setDraft(null); setCredential(''); setFailed(false); }} className="rounded border px-3 py-2">{t.cancel}</button>
        {failed && <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded border px-3 py-2">{t.refresh}</button>}</div>
    </div>}
    {saved && <p role="status" aria-live="polite">{t.saved}</p>}
  </form>;
}
