'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userPositionLimitsApi, type UpdateUserPositionLimitsInput, type UserPositionLimitsView } from '@/api/user-position-limits-api';
import { stepUpApi, type StepUpMethod } from '@/api/security-api';
import { useAuth } from '@/auth/auth.store';
import { LocaleSelector } from '@/features/oauth/locale-selector';
import { positionLimitCopy, type PositionLimitLocale } from './position-limit-copy';

export const USER_POSITION_LIMITS_QUERY_KEY = ['user-position-limits', 'me'] as const;
export const positionLimitsQueryKey = (tenantId: string, userId: string) => [...USER_POSITION_LIMITS_QUERY_KEY, tenantId, userId] as const;
const MAX_INTEGER = 2_147_483_647;
type Owner = { tenantId: string; userId: string };
type CompleteUpdate = Required<UpdateUserPositionLimitsInput>;

/** Mount separately for each authenticated owner; cached settings never cross sessions. */
export function PositionLimitSettings(): JSX.Element {
  const { session } = useAuth();
  if (!session) return <p role="status">{positionLimitCopy.en.signedOut}</p>;
  const owner = { tenantId: session.tenant.id, userId: session.user.id };
  return <PositionLimitsForOwner key={`${owner.tenantId}:${owner.userId}`} owner={owner} />;
}

function validCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INTEGER);
}
function validateView(value: UserPositionLimitsView, owner: Owner): UserPositionLimitsView {
  const validVersion = value?.updatedAt === null || (typeof value?.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) && new Date(value.updatedAt).toISOString() === value.updatedAt);
  const usage = value?.usage;
  if (!value || value.tenantId !== owner.tenantId || value.accountScope !== 'USER_OWNED_NON_DELETED_ACCOUNTS_INCLUDING_PAPER_AND_LIVE' ||
      typeof value.configured !== 'boolean' || !validVersion || !Number.isFinite(Date.parse(value.asOf)) ||
      !value.limits || !validCount(value.limits.maxConcurrentPositions) || !validCount(value.limits.maxOpenOrders) ||
      value.configured !== (value.limits.maxConcurrentPositions !== null || value.limits.maxOpenOrders !== null) ||
      !['CURRENT', 'UNKNOWN'].includes(value.usageState) || (value.usageState === 'UNKNOWN' && usage !== null) ||
      (value.usageState === 'CURRENT' && (!usage || !Number.isSafeInteger(usage.ownedAccountCount) || usage.ownedAccountCount < 0 ||
        !Number.isSafeInteger(usage.openPositionSlots) || usage.openPositionSlots < 0 || !Number.isSafeInteger(usage.openOrderCount) || usage.openOrderCount < 0))) {
    throw new Error('Invalid limits response');
  }
  return value;
}

/** Persist the same intent key across ambiguous failures and page reloads. */
async function retryKey(owner: Owner, input: CompleteUpdate): Promise<string> {
  if (!window.crypto.subtle || typeof window.crypto.randomUUID !== 'function') throw new Error('Secure retry storage unavailable');
  const fingerprint = JSON.stringify([owner.tenantId, owner.userId, input.maxConcurrentPositions, input.maxOpenOrders, input.expectedUpdatedAt]);
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const slot = `position-limits:${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('')}`;
  const existing = window.sessionStorage.getItem(slot);
  if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) return existing;
  if (existing) throw new Error('Invalid retry state');
  const key = window.crypto.randomUUID();
  window.sessionStorage.setItem(slot, key);
  return key;
}

function parseLimit(value: string): number | null {
  if (value === '') return null;
  if (!/^\d+$/.test(value)) throw new Error('Invalid integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_INTEGER) throw new Error('Invalid integer');
  return parsed;
}

function PositionLimitsForOwner({ owner }: { owner: Owner }): JSX.Element {
  const [locale, setLocale] = useState<PositionLimitLocale>('en');
  const [positionsInput, setPositionsInput] = useState<string | null>(null), [ordersInput, setOrdersInput] = useState<string | null>(null);
  // Capture the read version on the first edit; a later background refresh
  // must not silently rebase a partly edited form onto someone else's change.
  const [editVersion, setEditVersion] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<CompleteUpdate | null>(null);
  const [method, setMethod] = useState<StepUpMethod>('PASSWORD'), [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [invalid, setInvalid] = useState(false), [saved, setSaved] = useState(false);
  const credentialRef = useRef<HTMLInputElement>(null);
  const id = useId(), cache = useQueryClient();
  const key = positionLimitsQueryKey(owner.tenantId, owner.userId);
  const query = useQuery({ queryKey: key, queryFn: async () => validateView(await userPositionLimitsApi.getMyLimits(), owner), retry: false, staleTime: 0 });
  useEffect(() => {
    const language = navigator.language.split('-')[0] as PositionLimitLocale;
    if (Object.hasOwn(positionLimitCopy, language)) setLocale(language);
  }, []);
  useEffect(() => { if (draft) credentialRef.current?.focus(); }, [draft]);
  const t = positionLimitCopy[locale], view = query.data;
  const validCredential = method === 'TOTP' ? /^\d{6}$/.test(credential.trim()) : method === 'PASSWORD'
    ? credential.length >= 8 && credential.length <= 256 : credential.trim().length >= 8 && credential.trim().length <= 64;

  function startUpdate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!view || busy || draft) return;
    try {
      setDraft({ maxConcurrentPositions: parseLimit(positionsInput ?? view.limits.maxConcurrentPositions?.toString() ?? ''),
        maxOpenOrders: parseLimit(ordersInput ?? view.limits.maxOpenOrders?.toString() ?? ''),
        expectedUpdatedAt: editVersion === undefined ? view.updatedAt : editVersion });
      setCredential(''); setInvalid(false); setFailed(false); setSaved(false);
    } catch { setInvalid(true); }
  }
  async function verifyAndSave(): Promise<void> {
    if (!draft || busy || !validCredential) return;
    setBusy(true); setFailed(false);
    try {
      const idempotencyKey = await retryKey(owner, draft);
      const proof = await stepUpApi.issue({ action: 'USER_POSITION_LIMIT_UPDATE', method,
        ...(method === 'PASSWORD' ? { password: credential } : method === 'TOTP' ? { code: credential.trim() } : { recoveryCode: credential.trim() }) });
      setCredential('');
      if (!proof || !proof.proofId || proof.action !== 'USER_POSITION_LIMIT_UPDATE' || proof.method !== method ||
          !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()) throw new Error('Invalid verification response');
      const result = validateView(await userPositionLimitsApi.updateMyLimits(draft, idempotencyKey), owner);
      // A replay after a later edit returns current state, never the older edit.
      if (result.limits.maxConcurrentPositions !== draft.maxConcurrentPositions || result.limits.maxOpenOrders !== draft.maxOpenOrders) {
        throw new Error('Settings changed');
      }
      cache.setQueryData(key, result);
      setDraft(null); setSaved(true); setPositionsInput(null); setOrdersInput(null); setEditVersion(undefined);
    } catch { setCredential(''); setFailed(true); }
    finally { setBusy(false); }
  }
  async function refresh(): Promise<void> {
    if (busy) return;
    setDraft(null); setCredential(''); setFailed(false); setSaved(false); setPositionsInput(null); setOrdersInput(null); setEditVersion(undefined);
    await query.refetch();
  }

  return <section className="space-y-4" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <LocaleSelector locale={locale} onChange={setLocale} label={t.language} />
    {query.isLoading ? <p role="status">{t.loading}</p> : query.isError || !view ? <div role="alert">{t.unavailable} <button type="button" className="underline" onClick={() => void query.refetch()}>{t.retry}</button></div> : <>
      <div className="rounded border bg-card p-4 space-y-4">
        <div><h1 className="text-xl font-semibold">{t.title}</h1><p className="text-sm text-muted-foreground">{t.intro}</p></div>
        <span className="inline-block rounded border px-2 py-1 text-xs">{view.configured ? t.configured : t.noCeiling}</span>
        <form onSubmit={startUpdate} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><label htmlFor={`${id}-positions`} className="text-sm font-medium">{t.positions}</label>
              <input id={`${id}-positions`} type="number" inputMode="numeric" min={0} max={MAX_INTEGER} step={1} value={positionsInput ?? view.limits.maxConcurrentPositions?.toString() ?? ''}
                onChange={(event) => { if (editVersion === undefined) setEditVersion(view.updatedAt); setPositionsInput(event.target.value); }} disabled={busy || !!draft}
                placeholder={t.noLimit} className="w-full rounded border bg-background px-2 py-1 text-sm" />
              <p className="text-xs text-muted-foreground">{t.positionsHelp}</p></div>
            <div className="space-y-1"><label htmlFor={`${id}-orders`} className="text-sm font-medium">{t.orders}</label>
              <input id={`${id}-orders`} type="number" inputMode="numeric" min={0} max={MAX_INTEGER} step={1} value={ordersInput ?? view.limits.maxOpenOrders?.toString() ?? ''}
                onChange={(event) => { if (editVersion === undefined) setEditVersion(view.updatedAt); setOrdersInput(event.target.value); }} disabled={busy || !!draft}
                placeholder={t.noLimit} className="w-full rounded border bg-background px-2 py-1 text-sm" />
              <p className="text-xs text-muted-foreground">{t.ordersHelp}</p></div>
          </div>
          {!draft && <div className="flex flex-wrap gap-2"><button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">{t.save}</button>
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => { if (editVersion === undefined) setEditVersion(view.updatedAt); setPositionsInput(''); setOrdersInput(''); setInvalid(false); }}>{t.clear}</button></div>}
          {invalid && <p role="alert">{t.invalid}</p>}
          {draft && <div className="grid max-w-xl gap-2 rounded border p-3">
            <h2 className="font-semibold">{t.verifyTitle}</h2><p>{t.verifyHelp}</p>
            <label htmlFor={`${id}-method`}>{t.method}</label><select id={`${id}-method`} className="rounded border bg-background p-2" value={method} disabled={busy}
              onChange={(event) => { setMethod(event.target.value as StepUpMethod); setCredential(''); setFailed(false); }}>
              <option value="PASSWORD">{t.password}</option><option value="TOTP">{t.totp}</option><option value="RECOVERY_CODE">{t.recovery}</option></select>
            <label htmlFor={`${id}-credential`}>{method === 'PASSWORD' ? t.password : method === 'TOTP' ? t.totp : t.recovery}</label>
            <input ref={credentialRef} id={`${id}-credential`} type="password" autoComplete={method === 'PASSWORD' ? 'current-password' : 'one-time-code'}
              inputMode={method === 'TOTP' ? 'numeric' : 'text'} className="rounded border bg-background p-2" value={credential} disabled={busy} aria-invalid={failed}
              onChange={(event) => setCredential(event.target.value)} />
            {failed && <p role="alert">{t.failed}</p>}
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !validCredential} onClick={() => void verifyAndSave()} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{busy ? t.working : t.verify}</button>
              <button type="button" disabled={busy} onClick={() => { setDraft(null); setCredential(''); setFailed(false); }} className="rounded border px-3 py-2">{t.cancel}</button>
              {failed && <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded border px-3 py-2">{t.refresh}</button>}</div>
          </div>}
          {saved && <p role="status" aria-live="polite">{t.saved}</p>}
        </form>
      </div>
      <div className="rounded border bg-card p-4 space-y-2"><h2 className="font-semibold">{t.usage}</h2>
        {view.usage ? <dl className="grid gap-2 text-sm md:grid-cols-3"><div><dt>{t.slots}</dt><dd>{view.usage.openPositionSlots}</dd></div>
          <div><dt>{t.openOrders}</dt><dd>{view.usage.openOrderCount}</dd></div><div><dt>{t.accounts}</dt><dd>{view.usage.ownedAccountCount}</dd></div></dl>
          : <p role="status" className="text-sm text-muted-foreground">{t.unknown}</p>}
        <p className="text-xs text-muted-foreground">{t.sampled} <time dateTime={view.asOf}>{new Date(view.asOf).toLocaleString(locale)}</time></p>
      </div>
      <div className="rounded border bg-card p-4 space-y-2 text-sm"><h2 className="font-semibold">{t.how}</h2>
        <ul className="list-disc space-y-1 ps-5"><li>{t.how1}</li><li>{t.how2}</li><li>{t.how3}</li><li>{t.how4}</li><li>{t.how5}</li><li>{t.how6}</li></ul></div>
    </>}
  </section>;
}
