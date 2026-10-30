// # Responsibility: the withdrawal-destination page - the address allowlist itself (the manager component already owns add/verify/revoke) plus the explanation of why a new address is not usable immediately.
//
// This wrapper exists so the allowlist has its own page, reachable from the sidebar and linkable from a
// refused withdrawal, without duplicating the manager: the cooldown countdown, the step-up dialog and the
// validation live in one place and are shown here unchanged.
'use client';
import type { JSX } from 'react';

import { useCopy } from '@/i18n';
import { WithdrawalDestinationManager } from './withdrawal-destination-manager';

export function DestinationsScreen(): JSX.Element {
  const { t } = useCopy();
  return (
    <section aria-labelledby="destinations-heading" className="space-y-4">
      <header>
        <h2 id="destinations-heading" className="text-lg font-semibold">{t('destinations.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('destinations.intro')}</p>
      </header>
      <p className="rounded border p-3 text-sm">{t('destinations.stepUpNeeded')}</p>
      <WithdrawalDestinationManager />
    </section>
  );
}
