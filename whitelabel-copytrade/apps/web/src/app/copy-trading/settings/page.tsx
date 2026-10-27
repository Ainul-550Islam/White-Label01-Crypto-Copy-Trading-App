'use client';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuthGuard } from '@/auth/auth.guard';
import { useAuth } from '@/auth/auth.store';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { LocaleSelector } from '@/features/oauth/locale-selector';
import { CopyBudgetSettings } from '@/features/trading/copy-budget-settings';
import { LiquidationRiskAlert } from '@/features/trading/liquidation-risk-alert';
import { liquidationCopy, type LiquidationLocale } from '@/features/trading/liquidation-copy';
import { copyOpsApi } from '@/api/copy-ops-api';

export default function CopyTradingSettingsPage(): JSX.Element {
  const { session, isAuthenticated } = useAuth();
  const [locale, setLocale] = useState<LiquidationLocale>('en');
  useEffect(() => {
    const language = navigator.language.split('-')[0] as LiquidationLocale;
    if (Object.hasOwn(liquidationCopy, language)) setLocale(language);
  }, []);
  const t = liquidationCopy[locale];
  const tenantId = session?.tenant.id;
  const userId = session?.user.id;
  const alerts = useQuery({
    queryKey: ['liquidation-alerts', tenantId, userId],
    queryFn: () => copyOpsApi.listLiquidationAlerts({ tenantId: tenantId!, userId: userId! }),
    enabled: Boolean(isAuthenticated && tenantId && userId),
    retry: false,
    refetchInterval: 30_000,
  });
  return <AuthGuard><AppShell><div lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <PageContainer title={t.title} description={t.description}>
      <div className="grid gap-6">
        <LocaleSelector locale={locale} onChange={setLocale} label={t.language} />
        <section aria-label={t.section} className="grid gap-2">
          {alerts.isError ? <div role="alert" className="rounded border bg-card p-3 text-sm"><p>{t.unavailable}</p>
            <button type="button" className="mt-2 rounded border px-3 py-1" onClick={() => void alerts.refetch()}>{t.retry}</button></div>
            : alerts.data ? <LiquidationRiskAlert alerts={alerts.data} hideSafe locale={locale} />
            : <p role="status">{t.loading}</p>}
        </section>
        <section aria-label={t.budget}><CopyBudgetSettings locale={locale} /></section>
      </div>
    </PageContainer>
  </div></AppShell></AuthGuard>;
}
