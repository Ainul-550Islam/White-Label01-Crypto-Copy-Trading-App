'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { usePreferredLocale } from '@/lib/preferred-locale';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { compareCopyBudgetDecimals, copyOpsApi, type CopyBudget } from '@/api/copy-ops-api';
import { useAuth } from '@/auth/auth.store';
import { copyBudgetRetryKey } from './copy-budget-intents';
import { LocaleSelector } from '@/features/oauth/locale-selector';
import { copyBudgetCopy, type CopyBudgetLocale } from './copy-budget-copy';

export const COPY_BUDGET_QUERY_KEY = ['copy-trading', 'budget'] as const;
const DECIMAL_INPUT = /^\d{1,16}(?:\.\d{1,12})?$/;

/** Normalise local digit shapes without interpreting thousands separators. */
export function normaliseBudgetInput(input: string): string {
  return Array.from(input.trim(), (char) => {
    const point = char.codePointAt(0) ?? 0;
    for (const start of [0x0660, 0x06f0, 0x09e6]) {
      if (point >= start && point <= start + 9) return String(point - start);
    }
    return point === 0x066b ? '.' : char;
  }).join('');
}

export const compareDecimals = compareCopyBudgetDecimals;

function percentage(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}%`;
}

export function CopyBudgetSettings({ locale: controlledLocale }: { locale?: CopyBudgetLocale } = {}): JSX.Element {
  const { session, isLoading } = useAuth();
  if (isLoading) return <p role="status">Loading…</p>;
  if (!session) return <p role="alert">Sign in to view your copy budget.</p>;
  const identity = `${session.tenant.id}:${session.user.id}`;
  // The keyed child also discards drafts and retry keys when the identity changes.
  return <BudgetForUser key={identity} tenantId={session.tenant.id} userId={session.user.id} controlledLocale={controlledLocale} />;
}

function BudgetForUser({ tenantId, userId, controlledLocale }: { tenantId: string; userId: string; controlledLocale?: CopyBudgetLocale }): JSX.Element {
  const [localLocale, setLocale] = usePreferredLocale(copyBudgetCopy, 'en');
  const locale = controlledLocale ?? localLocale;
  const t = copyBudgetCopy[locale];
  const queryClient = useQueryClient();
  const queryKey = [...COPY_BUDGET_QUERY_KEY, tenantId, userId] as const;
  const query = useQuery({ queryKey, queryFn: async () => {
    const result = await copyOpsApi.getBudget();
    if (result.tenantId !== tenantId || result.userId !== userId) throw new Error('Budget owner mismatch');
    return result;
  }, staleTime: 30_000, retry: false });
  const [draft, setDraft] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const budget = query.data;
  const value = normaliseBudgetInput(draft);
  const invalid = !DECIMAL_INPUT.test(value);
  const tooHigh = !invalid && budget?.effectiveCap !== null && budget?.effectiveCap !== undefined &&
    compareCopyBudgetDecimals(value, budget.effectiveCap) > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!budget || !budget.currency || invalid || tooHigh) throw new Error('Invalid reduction');
      const input = { maxActiveExposure: value, currency: budget.currency };
      const { key, slot } = await copyBudgetRetryKey({ tenantId, userId }, input, window.sessionStorage, window.crypto);
      const result = await copyOpsApi.reduceBudget(input, key, { tenantId, userId });
      // A cleanup failure cannot undo the confirmed server result. Retaining the
      // key is safe; subsequent replays still validate the current cap.
      try { window.sessionStorage.removeItem(slot); } catch { /* retain retry key */ }
      return result;
    },
    onSuccess: (updated: CopyBudget) => {
      setDraft(''); setAttempted(false); setFailed(false); setSaved(true);
      queryClient.setQueryData(queryKey, updated);
    },
    onError: () => { setSaved(false); setFailed(true); },
  });

  return <section lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="grid gap-4">
    {!controlledLocale && <LocaleSelector locale={locale} onChange={setLocale} label={t.language} />}
    {query.isLoading ? <p role="status">{t.loading}</p> : query.error || !budget ?
      <div role="alert"><p>{t.unavailable}</p><button type="button" onClick={() => void query.refetch()} className="rounded border p-2">{t.retry}</button></div> : <>
      <div className="rounded border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{t.title}</h2>
          {budget.updatedAt && <span className="text-xs text-muted">{t.updated} <time dateTime={budget.updatedAt}>{new Date(budget.updatedAt).toLocaleString(locale)}</time></span>}
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Amount label={t.effective} amount={budget.effectiveCap} currency={budget.currency} missing={t.unlimited}/>
          <Amount label={t.personal} amount={budget.maxActiveExposure} currency={budget.currency} missing={t.unlimited}/>
          <Amount label={t.tenant} amount={budget.tenantCeiling} currency={budget.currency} missing={t.unlimited}/>
          <Amount label={t.trader} amount={budget.perTraderCap} currency={budget.currency} missing={t.unlimited}/>
          <Amount label={t.committed} amount={budget.currentExposure} currency={null} missing={t.metricUnavailable}/>
          <Amount label={t.remaining} amount={budget.remaining} currency={null} missing={budget.exposureStatus === 'UNAVAILABLE' ? t.metricUnavailable : t.noRemaining}/>
        </dl>
        <p className="mt-3 text-xs text-muted">{t.warning}</p>
        {(budget.effectiveCap !== null || budget.perTraderCap !== null) && <p role="status" className="mt-2 text-sm">{t.enforcementUnavailable}</p>}
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="meter" aria-label={t.meter}
            aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={budget.utilisationBps === null ? undefined : Math.min(100, budget.utilisationBps / 100)}
            aria-valuetext={budget.utilisationBps === null ? t.unknown : `${percentage(budget.utilisationBps)} ${t.usage}`}>
            <div className={`h-full ${budget.utilisationBps === null ? 'bg-slate-300' : budget.utilisationBps >= 10000 ? 'bg-red-500' : budget.utilisationBps >= 8000 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${budget.utilisationBps === null ? 0 : Math.min(100, budget.utilisationBps / 100)}%` }}/>
          </div>
          <p className="mt-1 text-xs text-muted">{budget.utilisationBps === null ? t.unknown : `${percentage(budget.utilisationBps)} ${t.usage}.`}</p>
        </div>
      </div>
      <form className="rounded border bg-card p-4" onSubmit={(event) => { event.preventDefault(); setAttempted(true); if (budget.currency && !invalid && !tooHigh && !mutation.isPending) mutation.mutate(); }}>
        <h2 className="text-sm font-semibold">{t.reduce}</h2><p className="mt-1 text-xs text-muted">{t.about}</p>
        {!budget.currency && <p role="status" className="mt-2 text-sm">{t.currencyUnavailable}</p>}
        <label htmlFor="copy-budget-max" className="mt-3 block text-sm font-medium">{t.maximum}{budget.currency ? ` (${budget.currency})` : ''}</label>
        <input id="copy-budget-max" dir="ltr" className="mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono" inputMode="decimal" value={draft} disabled={mutation.isPending || !budget.currency}
          onChange={(event) => { setDraft(event.target.value); setSaved(false); setFailed(false); }} aria-describedby="copy-budget-help copy-budget-error" aria-invalid={attempted && (invalid || tooHigh)} />
        <p id="copy-budget-help" className="mt-1 text-xs text-muted">{t.help}</p>
        <div id="copy-budget-error" aria-live="polite">{attempted && (invalid || tooHigh) && <p role="alert" className="mt-2 text-xs text-red-700">{invalid ? t.invalid : t.tooHigh}</p>}</div>
        {failed && <div role="alert" className="mt-2 text-xs text-red-700"><p>{t.failed}</p><button type="button" onClick={() => void query.refetch()} className="underline">{t.retry}</button></div>}
        {saved && <p role="status" className="mt-2 text-xs text-emerald-700">{t.saved}</p>}
        <button type="submit" className="mt-3 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={mutation.isPending || !budget.currency}>{mutation.isPending ? t.saving : t.reduce}</button>
      </form>
    </>}
  </section>;
}

function Amount({ label, amount, currency, missing }: { label: string; amount: string | null; currency: string | null; missing: string }): JSX.Element {
  return <div><dt className="text-xs uppercase tracking-wide text-muted">{label}</dt><dd className="font-mono">{amount === null ? missing : <bdi>{amount}{currency ? ` ${currency}` : ''}</bdi>}</dd></div>;
}
